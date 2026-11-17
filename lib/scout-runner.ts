import { CandidateProfile, DEFAULT_ATS_COMPANIES, getCandidateProfile } from './profile';
import { evaluateRoleWithLLM } from './llm';
import {
  getAllSheetRows,
  appendLocalJobRecord,
  isCloudSheetsConfigured,
  appendCloudSheetRecord,
} from './sheets';
import { deriveDynamicSearchParams, normalizeCanonicalFingerprint } from './utils';

export interface RawScoutedJob {
  id: string;
  title: string;
  company: string;
  location: string;
  salary: string;
  description: string;
  url: string;
  source: string;
}

export interface SourceHealthMetric {
  status: 'ok' | 'empty' | 'error';
  count: number;
  durationMs: number;
  error?: string;
}

export interface ScoutRunSummary {
  timestamp: string;
  sources_queried: string[];
  source_counts: Record<string, number>;
  source_health: Record<string, SourceHealthMetric>;
  total_fetched: number;
  new_after_dedup: number;
  evaluated_count: number;
  committed_count: number;
  committed_jobs: Array<{
    id: string;
    title: string;
    company: string;
    source: string;
    score: number;
    status: string;
    url: string;
  }>;
}

// Uses canonical DEFAULT_ATS_COMPANIES imported from ./profile-presets

function stripHtml(html: string): string {
  if (!html) return '';
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

async function timedFetch(
  sourceKey: string,
  fn: () => Promise<RawScoutedJob[]>,
  healthMap: Record<string, SourceHealthMetric>
): Promise<RawScoutedJob[]> {
  const start = Date.now();
  try {
    const items = await fn();
    healthMap[sourceKey] = {
      status: items.length > 0 ? 'ok' : 'empty',
      count: items.length,
      durationMs: Date.now() - start,
    };
    return items;
  } catch (err) {
    healthMap[sourceKey] = {
      status: 'error',
      count: 0,
      durationMs: Date.now() - start,
      error: (err as Error).message.slice(0, 100),
    };
    return [];
  }
}

async function fetchRemoteOK(tags: string[]): Promise<RawScoutedJob[]> {
  const tagParam = encodeURIComponent((tags.length > 0 ? tags : ['product', 'growth', 'dev']).join(','));
  const res = await fetch(`https://remoteok.com/api?tags=${tagParam}`, {
    headers: {
      'User-Agent': 'KaisifOS-FreeHire-Scout/3.2',
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(7000),
  });
  if (!res.ok) throw new Error(`RemoteOK HTTP ${res.status}`);
  const raw = await res.json();
  const list = Array.isArray(raw) ? raw.slice(1, 16) : [];
  return list
    .filter((item: any) => item?.position && item?.company)
    .map((item: any) => ({
      id: `remoteok_${item.id || item.slug}`,
      title: String(item.position),
      company: String(item.company),
      location: String(item.location || 'Remote / Worldwide'),
      salary: item.salary_min
        ? `$${item.salary_min} - $${item.salary_max || item.salary_min}`
        : 'Not listed',
      description: stripHtml(item.description || '').substring(0, 1200),
      url: item.url || `https://remoteok.com/l/${item.slug}`,
      source: 'RemoteOK',
    }));
}

async function fetchRemotive(categories: string[], keywords: string[]): Promise<RawScoutedJob[]> {
  const jobs: RawScoutedJob[] = [];
  const seenLocal = new Set<string>();

  await Promise.all(
    categories.slice(0, 3).map(async (cat) => {
      try {
        const url = new URL('https://remotive.com/api/remote-jobs');
        url.searchParams.set('category', cat);
        url.searchParams.set('limit', '8');
        const res = await fetch(url.toString(), { signal: AbortSignal.timeout(7000) });
        if (!res.ok) return;
        const data = await res.json();
        for (const item of data.jobs || []) {
          const id = `remotive_${item.id}`;
          if (seenLocal.has(id)) continue;
          seenLocal.add(id);
          jobs.push({
            id,
            title: String(item.title || ''),
            company: String(item.company_name || 'Unknown'),
            location: String(item.candidate_required_location || 'Remote / Worldwide'),
            salary: String(item.salary || 'Not listed'),
            description: stripHtml(item.description || '').substring(0, 1200),
            url: String(item.url || ''),
            source: 'Remotive',
          });
        }
      } catch {}
    })
  );

  if (keywords.length > 0) {
    try {
      const url = new URL('https://remotive.com/api/remote-jobs');
      url.searchParams.set('search', keywords[0]);
      url.searchParams.set('limit', '6');
      const res = await fetch(url.toString(), { signal: AbortSignal.timeout(7000) });
      if (res.ok) {
        const data = await res.json();
        for (const item of data.jobs || []) {
          const id = `remotive_${item.id}`;
          if (seenLocal.has(id)) continue;
          seenLocal.add(id);
          jobs.push({
            id,
            title: String(item.title || ''),
            company: String(item.company_name || 'Unknown'),
            location: String(item.candidate_required_location || 'Remote / Worldwide'),
            salary: String(item.salary || 'Not listed'),
            description: stripHtml(item.description || '').substring(0, 1200),
            url: String(item.url || ''),
            source: 'Remotive',
          });
        }
      }
    } catch {}
  }

  return jobs;
}

async function fetchHimalayas(): Promise<RawScoutedJob[]> {
  const res = await fetch('https://himalayas.app/jobs/api?limit=15', {
    headers: { Accept: 'application/json', 'User-Agent': 'KaisifOS-FreeHire-Scout/3.2' },
    signal: AbortSignal.timeout(7000),
  });
  if (!res.ok) throw new Error(`Himalayas HTTP ${res.status}`);
  const data = await res.json();
  return (data.jobs || []).slice(0, 15).map((item: any) => {
    const slugFallback = `${String(item.companyName || 'co')}_${String(item.title || 'role')}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .slice(0, 48);
    const minSal = item.minSalary;
    const maxSal = item.maxSalary;
    const salStr = minSal
      ? `${item.currency || '$'}${minSal}${maxSal ? ` - ${maxSal}` : ''}`
      : 'Not listed';
    const locs = Array.isArray(item.locationRestrictions) && item.locationRestrictions.length > 0
      ? item.locationRestrictions.join(', ')
      : 'Remote / Worldwide';
    return {
      id: `himalayas_${item.guid || item.slug || slugFallback}`,
      title: String(item.title || ''),
      company: String(item.companyName || 'Unknown'),
      location: locs,
      salary: salStr,
      description: stripHtml(item.description || item.excerpt || '').substring(0, 1200),
      url: String(item.applicationLink || item.guid || ''),
      source: 'Himalayas',
    };
  });
}

async function fetchArbeitnow(): Promise<RawScoutedJob[]> {
  const res = await fetch('https://www.arbeitnow.com/api/job-board-api', {
    signal: AbortSignal.timeout(7000),
  });
  if (!res.ok) throw new Error(`Arbeitnow HTTP ${res.status}`);
  const data = await res.json();
  return (data.data || []).slice(0, 12).map((item: any) => {
    const slugFallback = `${String(item.company_name || 'co')}_${String(item.title || 'role')}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .slice(0, 48);
    return {
      id: `arbeitnow_${item.slug || slugFallback}`,
      title: String(item.title || ''),
      company: String(item.company_name || 'Unknown'),
      location: `${item.location || 'Europe'}${item.remote ? ' (Remote / Visa Friendly)' : ''}`,
      salary: 'Standard EU Package',
      description: stripHtml(item.description || '').substring(0, 1200),
      url: String(item.url || ''),
      source: 'Arbeitnow',
    };
  });
}

async function fetchTheMuse(): Promise<RawScoutedJob[]> {
  const res = await fetch('https://www.themuse.com/api/public/jobs?page=1', {
    signal: AbortSignal.timeout(7000),
  });
  if (!res.ok) throw new Error(`TheMuse HTTP ${res.status}`);
  const data = await res.json();
  return (data.results || []).slice(0, 10).map((item: any) => ({
    id: `themuse_${item.id}`,
    title: String(item.name || ''),
    company: String(item.company?.name || 'Unknown'),
    location: (item.locations || []).map((l: any) => l.name).join(', ') || 'Flexible / Remote',
    salary: 'Competitive',
    description: stripHtml(item.contents || '').substring(0, 1200),
    url: String(item.refs?.landing_page || ''),
    source: 'TheMuse',
  }));
}

async function fetchFreeHireOptionalApi(): Promise<RawScoutedJob[]> {
  const endpoint = process.env.FREEHIRE_API_URL;
  if (!endpoint) return [];
  const res = await fetch(endpoint, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(7000),
  });
  if (!res.ok) throw new Error(`FreeHire API HTTP ${res.status}`);
  const data = await res.json();
  const list = Array.isArray(data) ? data : data.jobs || [];
  return list.slice(0, 20).map((item: any) => {
    const slug = `${item.company || 'co'}_${item.title || item.position || 'role'}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .slice(0, 48);
    return {
      id: `freehire_${item.id || slug}`,
      title: String(item.title || item.position || ''),
      company: String(item.company || 'FreeHire Partner'),
      location: String(item.location || 'Remote'),
      salary: String(item.salary || 'Not listed'),
      description: stripHtml(item.description || '').substring(0, 1200),
      url: String(item.url || item.apply_url || ''),
      source: 'FreeHire API',
    };
  });
}

/**
 * FreeHire Direct ATS Connector 1: Greenhouse Public Job Board API
 */
async function fetchGreenhouseBoards(boards: string[]): Promise<RawScoutedJob[]> {
  const results: RawScoutedJob[] = [];
  await Promise.all(
    boards.slice(0, 5).map(async (board) => {
      try {
        const res = await fetch(
          `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs?content=true`,
          { signal: AbortSignal.timeout(6500) }
        );
        if (!res.ok) return;
        const data = await res.json();
        for (const job of (data.jobs || []).slice(0, 6)) {
          results.push({
            id: `greenhouse_${board}_${job.id}`,
            title: String(job.title || ''),
            company: board.charAt(0).toUpperCase() + board.slice(1),
            location: String(job.location?.name || 'Remote / Hybrid'),
            salary: 'Direct ATS Band',
            description: stripHtml(job.content || `${job.title} at ${board}`).substring(0, 1200),
            url: String(job.absolute_url || ''),
            source: 'Greenhouse',
          });
        }
      } catch {}
    })
  );
  return results;
}

/**
 * FreeHire Direct ATS Connector 2: Lever Postings API
 */
async function fetchLeverBoards(boards: string[]): Promise<RawScoutedJob[]> {
  const results: RawScoutedJob[] = [];
  await Promise.all(
    boards.slice(0, 4).map(async (board) => {
      try {
        const res = await fetch(
          `https://api.lever.co/v0/postings/${encodeURIComponent(board)}?mode=json`,
          { signal: AbortSignal.timeout(6500) }
        );
        if (!res.ok) return;
        const data = await res.json();
        if (!Array.isArray(data)) return;
        for (const job of data.slice(0, 5)) {
          results.push({
            id: `lever_${board}_${job.id}`,
            title: String(job.text || ''),
            company: board.charAt(0).toUpperCase() + board.slice(1),
            location: String(job.categories?.location || 'Remote / Global'),
            salary: job.salaryRange
              ? `${job.salaryRange.min} - ${job.salaryRange.max} ${job.salaryRange.currency || 'USD'}`
              : 'Direct ATS Band',
            description: stripHtml(job.descriptionPlain || job.description || '').substring(0, 1200),
            url: String(job.hostedUrl || ''),
            source: 'Lever',
          });
        }
      } catch {}
    })
  );
  return results;
}

/**
 * FreeHire Direct ATS Connector 3: Ashby Public Posting API
 */
async function fetchAshbyBoards(boards: string[]): Promise<RawScoutedJob[]> {
  const results: RawScoutedJob[] = [];
  await Promise.all(
    boards.slice(0, 4).map(async (board) => {
      try {
        const res = await fetch(
          `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(board)}`,
          { signal: AbortSignal.timeout(6500) }
        );
        if (!res.ok) return;
        const data = await res.json();
        for (const job of (data.jobs || []).slice(0, 6)) {
          results.push({
            id: `ashby_${board}_${job.id}`,
            title: String(job.title || ''),
            company: board.charAt(0).toUpperCase() + board.slice(1),
            location: String(job.location || 'Remote / Hybrid'),
            salary: 'Direct ATS Band',
            description: stripHtml(job.descriptionHtml || `${job.title} at ${board}`).substring(0, 1200),
            url: String(job.jobUrl || ''),
            source: 'Ashby',
          });
        }
      } catch {}
    })
  );
  return results;
}

/**
 * Executes a live multi-source + direct ATS job scout run driven by profile targeting,
 * deduplicates canonically across boards and existing ledger, evaluates top candidates, and persists matches.
 */
export async function executeLiveScoutRun(options?: {
  minScoreToCommit?: number;
  maxToEvaluate?: number;
  customBoards?: { greenhouse?: string[]; lever?: string[]; ashby?: string[] };
}): Promise<ScoutRunSummary> {
  const profile: CandidateProfile = getCandidateProfile();
  const minScore = options?.minScoreToCommit ?? 82;
  const maxToEvaluate = options?.maxToEvaluate ?? 6;
  const { remoteOkTags, remotiveCategories, remotiveKeywords } = deriveDynamicSearchParams(profile);

  const ghBoards =
    options?.customBoards?.greenhouse ||
    profile.ats_companies?.greenhouse ||
    DEFAULT_ATS_COMPANIES.greenhouse;
  const leverBoards =
    options?.customBoards?.lever ||
    profile.ats_companies?.lever ||
    DEFAULT_ATS_COMPANIES.lever;
  const ashbyBoards =
    options?.customBoards?.ashby ||
    profile.ats_companies?.ashby ||
    DEFAULT_ATS_COMPANIES.ashby;

  const sourceHealth: Record<string, SourceHealthMetric> = {};

  const [greenhouse, ashby, lever, remoteOk, remotive, himalayas, arbeitnow, theMuse, freeHire] =
    await Promise.all([
      timedFetch('Greenhouse', () => fetchGreenhouseBoards(ghBoards), sourceHealth),
      timedFetch('Ashby', () => fetchAshbyBoards(ashbyBoards), sourceHealth),
      timedFetch('Lever', () => fetchLeverBoards(leverBoards), sourceHealth),
      timedFetch('RemoteOK', () => fetchRemoteOK(remoteOkTags), sourceHealth),
      timedFetch('Remotive', () => fetchRemotive(remotiveCategories, remotiveKeywords), sourceHealth),
      timedFetch('Himalayas', () => fetchHimalayas(), sourceHealth),
      timedFetch('Arbeitnow', () => fetchArbeitnow(), sourceHealth),
      timedFetch('TheMuse', () => fetchTheMuse(), sourceHealth),
      process.env.FREEHIRE_API_URL
        ? timedFetch('FreeHire API', () => fetchFreeHireOptionalApi(), sourceHealth)
        : Promise.resolve([]),
    ]);

  const rawCombined: RawScoutedJob[] = [
    ...freeHire,
    ...greenhouse,
    ...ashby,
    ...lever,
    ...remoteOk,
    ...remotive,
    ...himalayas,
    ...arbeitnow,
    ...theMuse,
  ];

  const sourceCounts: Record<string, number> = {};
  for (const j of rawCombined) {
    sourceCounts[j.source] = (sourceCounts[j.source] || 0) + 1;
  }

  // Ledger deduplication + In-Batch Canonical Fingerprint Deduplication
  const { rows } = await getAllSheetRows();
  const existingIds = new Set(rows.slice(1).map((r) => String(r[1] || '')));
  const existingFingerprints = new Set(
    rows.slice(1).map((r) => normalizeCanonicalFingerprint(String(r[3] || ''), String(r[2] || '')))
  );

  const seenBatchIds = new Set<string>();
  const seenBatchFingerprints = new Set<string>();
  const unseen: RawScoutedJob[] = [];

  for (const j of rawCombined) {
    if (!j.title || !j.id) continue;
    const fp = normalizeCanonicalFingerprint(j.company, j.title);
    if (
      existingIds.has(j.id) ||
      existingFingerprints.has(fp) ||
      seenBatchIds.has(j.id) ||
      seenBatchFingerprints.has(fp)
    ) {
      continue;
    }
    seenBatchIds.add(j.id);
    seenBatchFingerprints.add(fp);
    unseen.push(j);
  }

  const candidateYears = profile.experience_years ?? 0;
  const seniorBlockerRegex =
    /\b(director|vp|vice president|principal|head of|chief|staff engineer)\b|\b([5-9]|1\d)\+?\s*years?\b/i;
  const eligibilityFiltered =
    candidateYears <= 1
      ? unseen.filter(
          (j) =>
            !seniorBlockerRegex.test(j.title) &&
            !(candidateYears === 0 && /\b(senior|sr\.?)\b/i.test(j.title))
        )
      : unseen;

  const poolToRank = eligibilityFiltered.length > 0 ? eligibilityFiltered : unseen;

  const genericWords = new Set([
    'manager',
    'associate',
    'lead',
    'analyst',
    'engineer',
    'developer',
    'team',
    'staff',
  ]);
  const roleTokens = Array.from(
    new Set(
      profile.target_roles
        .join(' ')
        .toLowerCase()
        .split(/\W+/)
        .filter((w) => w.length >= 3 && !genericWords.has(w))
    )
  );

  const countTokenHits = (text: string, tokens: string[]) =>
    tokens.reduce(
      (acc, t) =>
        acc + (new RegExp(`(?:^|[^a-z0-9])${t}(?:$|[^a-z0-9])`, 'i').test(text) ? 1 : 0),
      0
    );

  const ranked = [...poolToRank].sort((a, b) => {
    const aScore =
      countTokenHits(a.title, roleTokens) * 3 + countTokenHits(a.description, roleTokens);
    const bScore =
      countTokenHits(b.title, roleTokens) * 3 + countTokenHits(b.description, roleTokens);
    return bScore - aScore;
  });

  const candidatesToScore = ranked.slice(0, maxToEvaluate);
  const committedJobs: ScoutRunSummary['committed_jobs'] = [];
  const todayStr = new Date().toISOString().split('T')[0];

  for (const candidate of candidatesToScore) {
    const evalResult = await evaluateRoleWithLLM(
      {
        title: candidate.title,
        company: candidate.company,
        location: candidate.location,
        salary: candidate.salary,
        description: candidate.description,
      },
      profile
    );

    if (evalResult.score >= minScore) {
      const status = evalResult.score >= 90 ? 'SHORTLISTED' : 'NEW';
      const record = {
        date: todayStr,
        id: candidate.id,
        title: candidate.title,
        company: candidate.company,
        score: evalResult.score,
        reasons: evalResult.match_reasons.join(' | '),
        gap: evalResult.gap,
        url: candidate.url,
        dm: evalResult.dm_draft,
        resumeAngle: evalResult.resume_angle,
        status,
      };

      appendLocalJobRecord(record);

      if (isCloudSheetsConfigured()) {
        try {
          await appendCloudSheetRecord(record);
        } catch (e) {
          console.warn('[LiveScout] Cloud sheet append skipped, stored locally:', e);
        }
      }

      committedJobs.push({
        id: record.id,
        title: record.title,
        company: record.company,
        source: candidate.source,
        score: record.score,
        status: record.status,
        url: record.url,
      });
    }
  }

  const sourcesQueried = [
    'Greenhouse Direct ATS',
    'Ashby Direct ATS',
    'Lever Direct ATS',
    'RemoteOK API',
    'Remotive API',
    'Himalayas API',
    'Arbeitnow Visa Board',
    'TheMuse Public API',
  ];
  if (process.env.FREEHIRE_API_URL) {
    sourcesQueried.unshift('FreeHire API Endpoint');
  }

  return {
    timestamp: new Date().toISOString(),
    sources_queried: sourcesQueried,
    source_counts: sourceCounts,
    source_health: sourceHealth,
    total_fetched: rawCombined.length,
    new_after_dedup: unseen.length,
    evaluated_count: candidatesToScore.length,
    committed_count: committedJobs.length,
    committed_jobs: committedJobs,
  };
}
