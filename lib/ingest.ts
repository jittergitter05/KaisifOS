import crypto from 'crypto';
import { CandidateProfile } from './profile-presets';
import {
  buildCanonicalJobKey,
  decodeAndStripHtml,
  evaluateHardEligibility,
  getSourceUrlPriority,
} from './eligibility';
import {
  deterministicEvaluateJob,
  evaluateJobWithFreeChain,
} from './llm';
import {
  appendCloudSheetRecord,
  appendLocalJobRecordDetailed,
  isCloudSheetsConfigured,
  isNeonPostgresConfigured,
  readLocalJobRecords,
  upsertNeonCanonicalJob,
} from './sheets';
import { getNeonCanonicalStateMap } from './neon-db.js';
import { enrichThinJobDescriptions } from './career-scraper';
import { validateSafePublicUrl } from './utils';

export interface IngestJobCandidate {
  id: string;
  title: string;
  company: string;
  location: string;
  salary: string;
  description: string;
  url: string;
  source: string;
}

export interface IngestedJobOutcome {
  id: string;
  canonicalKey: string;
  title: string;
  company: string;
  location: string;
  url: string;
  source: string;
  score: number;
  status: string;
  evaluationStatus: string;
  needsLlmRetry: boolean;
  eligible: boolean;
  rejectReason?: string;
  mergedDuplicate?: boolean;
  dmDraft?: string;
  resumeAngle?: string;
  gap?: string;
  reasons?: string[];
  engineUsed?: string;
}

export interface IngestPipelineSummary {
  receivedCount: number;
  ingestedCount: number;
  duplicatesMerged: number;
  rejectedByGate: number;
  queuedForRetry: number;
  persistenceMode: 'neon-postgres' | 'cloud-sheets' | 'local-disk' | 'ephemeral-tmp';
  results: IngestedJobOutcome[];
  warnings: string[];
}

function stableIngestHash(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex').slice(0, 14);
}

function inferPlatformLabel(url: string, fromText = '', explicitSource = ''): string {
  const explicit = explicitSource.trim();
  if (explicit) return explicit;
  const check = `${url} ${fromText}`.toLowerCase();
  if (check.includes('naukri')) return 'Naukri Alert';
  if (check.includes('linkedin')) return 'LinkedIn Alert';
  if (check.includes('wellfound') || check.includes('angel.co')) return 'Wellfound Alert';
  if (check.includes('instahire') || check.includes('instahyre')) return 'Instahire Alert';
  if (check.includes('cutshort')) return 'Cutshort Alert';
  if (check.includes('hirist')) return 'Hirist Alert';
  if (check.includes('myworkdayjobs')) return 'Workday ATS';
  if (check.includes('greenhouse')) return 'Greenhouse';
  if (check.includes('lever.co')) return 'Lever';
  if (check.includes('ashbyhq')) return 'Ashby';
  return 'Webhook / Clipper';
}

const NOISE_LINK_REGEX =
  /\b(unsubscribe|manage[-_ ]?alerts?|preferences|privacy|terms|cookie|help|support|optout|tracking|click\.|open\.|pixel|settings|login|signin|logo)\b|\.(?:png|jpe?g|gif|svg|webp|css|js)(?:$|\?)/i;

const JOB_LINK_SIGNAL_REGEX =
  /(naukri\.com\/job-listings|naukri\.com\/.*?jobs|linkedin\.com\/(?:comm\/)?jobs\/view|wellfound\.com\/jobs|angel\.co\/jobs|instahyre\.com\/job|cutshort\.io\/job|hirist\.tech\/j|myworkdayjobs\.com\/|boards\.greenhouse\.io\/|jobs\.lever\.co\/|jobs\.ashbyhq\.com\/|apply\.workable\.com\/|jobs\.smartrecruiters\.com\/|recruitee\.com\/o\/|keka\.com\/careers|darwinbox\.in\/|\/jobs?\/|\/careers?\/)/i;

/**
 * Parses direct job JSON, batch `{ jobs: [...] }`, or forwarded Naukri/LinkedIn/Wellfound alert emails
 * into normalized, SSRF-validated IngestJobCandidate objects.
 */
export function parseAlertEmailToJobs(
  payload: unknown,
  channel: 'webhook' | 'clipper' = 'webhook'
): IngestJobCandidate[] {
  if (!payload || typeof payload !== 'object') return [];
  const obj = payload as Record<string, unknown>;
  const idPrefix = channel === 'clipper' ? 'clipper' : 'webhook';
  const defaultSource = channel === 'clipper' ? '1-Click Clipper' : 'Email Alert Webhook';

  // Case 1: Batch array `{ jobs: [...] }`
  if (Array.isArray(obj.jobs)) {
    const out: IngestJobCandidate[] = [];
    for (const item of obj.jobs.slice(0, 25)) {
      out.push(...parseAlertEmailToJobs(item, channel));
    }
    return out;
  }

  // Case 2: Single structured job `{ title, company, url, description, location, salary }`
  if (typeof obj.title === 'string' && obj.title.trim().length >= 3) {
    const title = decodeAndStripHtml(obj.title).trim().slice(0, 180);
    const company = decodeAndStripHtml(String(obj.company || 'Unknown Company')).trim().slice(0, 120) || 'Unknown Company';
    const rawUrl = String(obj.url || obj.applyUrl || '').trim();
    const urlCheck = rawUrl ? validateSafePublicUrl(rawUrl, { allowLocalDev: false }) : { ok: false };
    const safeUrl = urlCheck.ok && urlCheck.url ? urlCheck.url.toString() : '';
    const location = decodeAndStripHtml(String(obj.location || 'Hyderabad / India')).trim().slice(0, 120);
    const salary = decodeAndStripHtml(String(obj.salary || 'Not listed')).trim().slice(0, 80);
    const description = decodeAndStripHtml(
      String(obj.description || `${title} at ${company} (${location}).`)
    )
      .trim()
      .slice(0, 12000);
    const source = inferPlatformLabel(safeUrl, String(obj.from || ''), String(obj.source || defaultSource));
    return [
      {
        id: `${idPrefix}_${stableIngestHash(`${safeUrl}::${company}::${title}`)}`,
        title,
        company,
        location,
        salary,
        description,
        url: safeUrl,
        source,
      },
    ];
  }

  // Case 3: Forwarded Alert Email (`{ from, subject, textBody, htmlBody }`)
  const fromStr = String(obj.from || obj.sender || '').trim();
  const subjectStr = decodeAndStripHtml(String(obj.subject || '')).trim();
  const htmlBody = String(obj.htmlBody || obj.html || '');
  const textBody = decodeAndStripHtml(String(obj.textBody || obj.text || obj.body || '')).trim();
  const combinedPlain = `${subjectStr}\n${textBody || decodeAndStripHtml(htmlBody)}`.trim();

  if (!combinedPlain && !htmlBody) return [];

  const extracted: IngestJobCandidate[] = [];
  const seenUrls = new Set<string>();

  // 3A. Scan HTML anchor tags first so title + context stay tied to exact job link
  const anchorRegex = /<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of htmlBody.matchAll(anchorRegex)) {
    const rawHref = (match[1] || '').trim();
    const anchorLabel = decodeAndStripHtml(match[2] || '').replace(/\s+/g, ' ').trim();
    if (!rawHref || NOISE_LINK_REGEX.test(rawHref) || NOISE_LINK_REGEX.test(anchorLabel)) continue;

    const urlCheck = validateSafePublicUrl(rawHref, { allowLocalDev: false });
    if (!urlCheck.ok || !urlCheck.url) continue;
    const absUrl = urlCheck.url.toString();
    if (!JOB_LINK_SIGNAL_REGEX.test(absUrl) || seenUrls.has(absUrl)) continue;
    if (anchorLabel.length < 4 || /^(apply|view job|see more|click here|open)$/i.test(anchorLabel)) continue;

    seenUrls.add(absUrl);
    const matchIdx = match.index ?? 0;
    const contextText = decodeAndStripHtml(
      htmlBody.slice(Math.max(0, matchIdx - 120), Math.min(htmlBody.length, matchIdx + match[0].length + 280))
    );

    // Attempt clean "Title - Company - Location" split or extract company/location from surrounding email snippet
    const titleCompanySplit = anchorLabel.split(/\s+(?:at|@|-|\|)\s+/i);
    const title = (titleCompanySplit[0] || anchorLabel).trim().slice(0, 160);
    let company = titleCompanySplit[1]?.trim() || '';
    if (!company) {
      const compMatch = contextText.match(/\b(?:at|company[:\s]+)\s*([A-Z][A-Za-z0-9&.,' -]{2,45})/);
      company = compMatch?.[1]?.trim() || inferPlatformLabel(absUrl, fromStr);
    }
    const locMatch = contextText.match(
      /\b(Hyderabad|Telangana|Bengaluru|Bangalore|Mumbai|Pune|Chennai|Noida|Gurugram|India|Remote(?:\s*\/\s*Hybrid)?|Hybrid)\b/i
    );
    const location = locMatch ? locMatch[1] : 'India / Remote';
    const salMatch = contextText.match(/(?:₹\s*\d[\d,.]*(?:\s*-\s*\d[\d,.]*)?\s*(?:LPA|Lakhs?)|\d+(?:\.\d+)?\s*-\s*\d+(?:\.\d+)?\s*LPA)/i);

    extracted.push({
      id: `${idPrefix}_${stableIngestHash(absUrl)}`,
      title,
      company: company.slice(0, 120),
      location,
      salary: salMatch ? salMatch[0] : 'Alert Feed',
      description: `${title} at ${company} (${location}). Subject: ${subjectStr}. ${contextText}`.slice(0, 12000),
      url: absUrl,
      source: inferPlatformLabel(absUrl, fromStr),
    });
    if (extracted.length >= 15) break;
  }

  // 3B. Fallback: extract plain-text job URLs paired with nearby lines or subject
  if (extracted.length === 0) {
    const urlRegex = /https?:\/\/[^\s<>"')]+/gi;
    for (const match of combinedPlain.matchAll(urlRegex)) {
      const candidateUrl = match[0].replace(/[.,;!?]+$/, '');
      if (NOISE_LINK_REGEX.test(candidateUrl)) continue;
      const urlCheck = validateSafePublicUrl(candidateUrl, { allowLocalDev: false });
      if (!urlCheck.ok || !urlCheck.url) continue;
      const absUrl = urlCheck.url.toString();
      if (!JOB_LINK_SIGNAL_REGEX.test(absUrl) || seenUrls.has(absUrl)) continue;

      seenUrls.add(absUrl);
      const idx = match.index ?? 0;
      const snippet = combinedPlain.slice(Math.max(0, idx - 220), Math.min(combinedPlain.length, idx + 240));
      const cleanLines = snippet
        .split(/\n+/)
        .map((l) => l.trim())
        .filter((l) => l.length >= 4 && !/^https?:\/\//i.test(l));

      const guessedTitle =
        cleanLines[0]?.slice(0, 140) ||
        subjectStr.replace(/^(?:job alert|new jobs?|naukri|linkedin)[:\s-]*/i, '').trim() ||
        'Clipped Job Opportunity';
      const locMatch = `${snippet} ${subjectStr}`.match(
        /\b(Hyderabad|Telangana|Bengaluru|Bangalore|Mumbai|Pune|Chennai|Noida|Gurugram|India|Remote(?:\s*\/\s*Hybrid)?|Hybrid)\b/i
      );

      extracted.push({
        id: `${idPrefix}_${stableIngestHash(absUrl)}`,
        title: guessedTitle,
        company: cleanLines[1]?.slice(0, 80) || inferPlatformLabel(absUrl, fromStr),
        location: locMatch ? locMatch[1] : 'India / Remote',
        salary: 'Alert Feed',
        description: `${subjectStr}\n${snippet}`.trim().slice(0, 12000),
        url: absUrl,
        source: inferPlatformLabel(absUrl, fromStr),
      });
      if (extracted.length >= 12) break;
    }
  }

  return extracted;
}

/**
 * Evaluates & commits ingested jobs (from Webhook or 1-Click Clipper) into the shared Neon / Sheets / Local pipeline
 * using canonical deduplication, eligibility gating, bounded LLM evaluation, and retry queueing.
 */
export async function ingestJobsIntoPipeline(
  candidates: IngestJobCandidate[],
  profile: CandidateProfile,
  options?: {
    channel?: 'webhook' | 'clipper';
    allowBelowThresholdCommit?: boolean;
    skipDuplicateCheck?: boolean;
    autoEnrichUrls?: boolean;
  }
): Promise<IngestPipelineSummary> {
  const warnings: string[] = [];
  const neonConfigured = isNeonPostgresConfigured();
  const cloudConfigured = isCloudSheetsConfigured();
  const channel = options?.channel ?? 'webhook';
  const allowBelowThreshold = Boolean(options?.allowBelowThresholdCommit);

  const uniqueByCanonical = new Map<string, IngestJobCandidate>();
  for (const item of candidates) {
    if (!item.title) continue;
    const cKey = buildCanonicalJobKey(item.company, item.title, item.location);
    if (!uniqueByCanonical.has(cKey)) {
      uniqueByCanonical.set(cKey, item);
    }
  }

  const uniqueCandidates = Array.from(uniqueByCanonical.values());
  if (options?.autoEnrichUrls !== false && uniqueCandidates.length > 0) {
    await enrichThinJobDescriptions(uniqueCandidates, Math.min(5, uniqueCandidates.length));
  }

  const neonStateMap = neonConfigured ? await getNeonCanonicalStateMap() : new Map();
  const localRecords = neonConfigured ? [] : readLocalJobRecords();
  const localKeySet = new Set(
    localRecords.map((r) => r.canonicalKey || buildCanonicalJobKey(r.company, r.title, r.location))
  );

  const results: IngestedJobOutcome[] = [];
  let ingestedCount = 0;
  let duplicatesMerged = 0;
  let rejectedByGate = 0;
  let queuedForRetry = 0;
  let llmCallsUsed = 0;
  const MAX_LLM_CALLS_PER_INGEST = 5;

  let persistenceMode: IngestPipelineSummary['persistenceMode'] = neonConfigured
    ? 'neon-postgres'
    : cloudConfigured
    ? 'cloud-sheets'
    : 'local-disk';

  const todayStr = new Date().toISOString().split('T')[0];

  for (const candidate of uniqueCandidates) {
    const canonicalKey = buildCanonicalJobKey(candidate.company, candidate.title, candidate.location);
    const neonExisting = neonStateMap.get(canonicalKey);
    const localExisting = localKeySet.has(canonicalKey);

    if (!options?.skipDuplicateCheck && ((neonExisting && !neonExisting.needsLlmRetry) || localExisting)) {
      duplicatesMerged += 1;
      // Record cross-source sighting metadata in Neon even on duplicate skip
      if (neonConfigured && neonExisting) {
        const mergedSources = Array.isArray(neonExisting.sourcesSeen) ? [...neonExisting.sourcesSeen] : [];
        if (!mergedSources.some((s) => s.source === candidate.source && s.url === candidate.url)) {
          mergedSources.push({
            source: candidate.source,
            url: candidate.url,
            id: candidate.id,
            seenAt: new Date().toISOString(),
          });
          await upsertNeonCanonicalJob({
            id:
              getSourceUrlPriority(candidate.url || candidate.source) >
              getSourceUrlPriority(neonExisting.url || '')
                ? candidate.id
                : neonExisting.id,
            canonicalKey,
            title: candidate.title,
            company: candidate.company,
            location: candidate.location,
            url:
              getSourceUrlPriority(candidate.url || candidate.source) >
              getSourceUrlPriority(neonExisting.url || '')
                ? candidate.url
                : neonExisting.url,
            source: candidate.source,
            sourcesSeen: mergedSources,
            score: neonExisting.score,
            evaluationStatus: neonExisting.evaluationStatus,
            needsLlmRetry: neonExisting.needsLlmRetry,
            pipelineStage: neonExisting.status,
          }).catch(() => {});
        }
      }

      results.push({
        id: neonExisting?.id || candidate.id,
        canonicalKey,
        title: candidate.title,
        company: candidate.company,
        location: candidate.location,
        url: candidate.url,
        source: candidate.source,
        score: neonExisting?.score || 0,
        status: neonExisting?.status || 'EXISTING',
        evaluationStatus: neonExisting?.evaluationStatus || 'DEDUPLICATED',
        needsLlmRetry: Boolean(neonExisting?.needsLlmRetry),
        eligible: true,
        mergedDuplicate: true,
      });
      continue;
    }

    const eligibility = evaluateHardEligibility(
      {
        title: candidate.title,
        location: candidate.location,
        description: candidate.description,
      },
      profile
    );

    if (!eligibility.eligible && channel === 'webhook') {
      rejectedByGate += 1;
      const reason = eligibility.reasons[0] || 'Filtered by eligibility gate';
      if (neonConfigured) {
        await upsertNeonCanonicalJob({
          id: candidate.id,
          canonicalKey,
          title: candidate.title,
          company: candidate.company,
          location: candidate.location,
          salary: candidate.salary,
          description: candidate.description,
          url: candidate.url,
          source: candidate.source,
          sourcesSeen: [{ source: candidate.source, url: candidate.url, id: candidate.id, seenAt: new Date().toISOString() }],
          score: 0,
          evaluationStatus: 'REJECTED_GATE',
          needsLlmRetry: false,
          pipelineStage: 'REJECTED',
          hardRejectReason: reason,
        }).catch(() => {});
      }

      results.push({
        id: candidate.id,
        canonicalKey,
        title: candidate.title,
        company: candidate.company,
        location: candidate.location,
        url: candidate.url,
        source: candidate.source,
        score: 0,
        status: 'REJECTED',
        evaluationStatus: 'REJECTED_GATE',
        needsLlmRetry: false,
        eligible: false,
        rejectReason: reason,
      });
      continue;
    }

    const evalResult =
      llmCallsUsed < MAX_LLM_CALLS_PER_INGEST
        ? await (async () => {
            llmCallsUsed += 1;
            return evaluateJobWithFreeChain(
              {
                title: candidate.title,
                company: candidate.company,
                location: candidate.location,
                salary: candidate.salary,
                description: candidate.description,
              },
              profile
            );
          })()
        : deterministicEvaluateJob(
            {
              title: candidate.title,
              company: candidate.company,
              location: candidate.location,
              salary: candidate.salary,
              description: candidate.description,
            },
            profile
          );

    const isDet = String(evalResult.engine_used || '').toLowerCase().includes('deterministic');
    const evaluationStatus = isDet ? 'DETERMINISTIC_ONLY' : 'LLM_SCORED';
    const needsLlmRetry = isDet && evalResult.score >= 55;
    if (needsLlmRetry) queuedForRetry += 1;

    const minCommitThreshold = isDet ? 68 : 72;
    const shouldCommit = allowBelowThreshold || evalResult.score >= minCommitThreshold || needsLlmRetry;
    const stage = evalResult.score >= 90 ? 'SHORTLISTED' : 'NEW';
    const sourcesSeen = [
      { source: candidate.source, url: candidate.url, id: candidate.id, seenAt: new Date().toISOString() },
    ];

    if (shouldCommit) {
      const record = {
        date: todayStr,
        id: candidate.id,
        canonicalKey,
        title: candidate.title,
        company: candidate.company,
        location: candidate.location,
        salary: candidate.salary,
        score: evalResult.score,
        reasons: evalResult.match_reasons.join(' | '),
        gap: evalResult.gap,
        url: candidate.url,
        dm: evalResult.dm_draft,
        emailDraft: `Subject: ${evalResult.cold_email_subject}\n\n${evalResult.cold_email_body}`,
        resumeAngle: evalResult.resume_angle,
        status: stage,
        evaluationStatus,
        needsLlmRetry,
        sourcesSeen,
      };

      const localRes = appendLocalJobRecordDetailed(record);
      let neonOk = false;
      let cloudOk = false;

      if (neonConfigured) {
        const nRes = await upsertNeonCanonicalJob({
          id: record.id,
          canonicalKey,
          title: record.title,
          company: record.company,
          location: record.location,
          salary: record.salary,
          description: candidate.description,
          url: record.url,
          source: candidate.source,
          sourcesSeen,
          score: record.score,
          evaluationStatus,
          needsLlmRetry,
          pipelineStage: stage,
          reasons: record.reasons,
          gap: record.gap,
          dmDraft: record.dm,
          emailDraft: record.emailDraft,
          resumeAngle: record.resumeAngle,
          subscores: evalResult.subscores
            ? ({ ...evalResult.subscores } as Record<string, unknown>)
            : undefined,
        }).catch(() => ({ ok: false }));
        neonOk = Boolean(nRes.ok);
      }

      if (cloudConfigured) {
        try {
          await appendCloudSheetRecord(record);
          cloudOk = true;
        } catch (e) {
          if (!neonOk) warnings.push(`Cloud Sheets warning: ${(e as Error).message}`);
        }
      }

      if (neonOk) persistenceMode = 'neon-postgres';
      else if (cloudOk) persistenceMode = 'cloud-sheets';
      else if (localRes.ok) {
        persistenceMode = localRes.mode === 'ephemeral-tmp' ? 'ephemeral-tmp' : 'local-disk';
      }

      ingestedCount += 1;
    }

    results.push({
      id: candidate.id,
      canonicalKey,
      title: candidate.title,
      company: candidate.company,
      location: candidate.location,
      url: candidate.url,
      source: candidate.source,
      score: evalResult.score,
      status: shouldCommit ? stage : 'SKIPPED_LOW_SCORE',
      evaluationStatus,
      needsLlmRetry,
      eligible: eligibility.eligible,
      rejectReason: !eligibility.eligible ? eligibility.reasons[0] : undefined,
      dmDraft: evalResult.dm_draft,
      resumeAngle: evalResult.resume_angle,
      gap: evalResult.gap,
      reasons: evalResult.match_reasons,
      engineUsed: evalResult.engine_used,
    });
  }

  return {
    receivedCount: candidates.length,
    ingestedCount,
    duplicatesMerged,
    rejectedByGate,
    queuedForRetry,
    persistenceMode,
    results,
    warnings,
  };
}
