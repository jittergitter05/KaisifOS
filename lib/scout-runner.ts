import {
  CandidateProfile,
  DEFAULT_ATS_COMPANIES,
  DEFAULT_CAREER_URLS,
  getCandidateProfileAsync,
} from './profile';
import {
  fetchCompanyCareerPages,
  fetchWorkableBoards,
  fetchSmartRecruitersBoards,
  fetchRecruiteeBoards,
  enrichThinJobDescriptions,
} from './career-scraper';
import { decodeAndStripHtml, evaluateHardEligibility } from './eligibility';
import { deterministicEvaluateJob, evaluateRoleWithLLM } from './llm';
import {
  appendCloudSeenJobIds,
  appendCloudSheetRecord,
  appendLocalJobRecordDetailed,
  appendLocalSeenJobIds,
  getAllSheetRows,
  getCloudSeenJobIds,
  isCloudSheetsConfigured,
  readLocalSeenJobIds,
} from './sheets';
import {
  deriveDynamicSearchParams,
  normalizeCanonicalFingerprint,
  validateSafePublicUrl,
} from './utils';

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
  failedBoards?: string[];
  truncatedBoards?: number;
}

export interface ScoutRunSummary {
  timestamp: string;
  sources_queried: string[];
  source_counts: Record<string, number>;
  source_health: Record<string, SourceHealthMetric>;
  persistence_mode: 'cloud-sheets' | 'local-disk' | 'ephemeral-tmp';
  warnings: string[];
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

const MAX_ATS_BOARDS_PER_PROVIDER = 12;
const SWEEP_DEADLINE_MS = 42000;

function stripHtml(html: string): string {
  return decodeAndStripHtml(html);
}

interface BoardFetchResult {
  jobs: RawScoutedJob[];
  failedBoards?: string[];
  truncatedBoards?: number;
}

async function timedFetch(
  sourceKey: string,
  fn: () => Promise<RawScoutedJob[] | BoardFetchResult>,
  healthMap: Record<string, SourceHealthMetric>
): Promise<RawScoutedJob[]> {
  const start = Date.now();
  try {
    const raw = await fn();
    const items = Array.isArray(raw) ? raw : raw.jobs;
    const failedBoards = Array.isArray(raw) ? undefined : raw.failedBoards;
    const truncatedBoards = Array.isArray(raw) ? undefined : raw.truncatedBoards;

    healthMap[sourceKey] = {
      status: items.length > 0 ? 'ok' : failedBoards && failedBoards.length > 0 ? 'error' : 'empty',
      count: items.length,
      durationMs: Date.now() - start,
      failedBoards: failedBoards && failedBoards.length > 0 ? failedBoards : undefined,
      truncatedBoards: truncatedBoards && truncatedBoards > 0 ? truncatedBoards : undefined,
      error:
        failedBoards && failedBoards.length > 0 && items.length === 0
          ? `Failed boards: ${failedBoards.slice(0, 3).join(', ')}`
          : undefined,
    };
    return items;
  } catch (err) {
    healthMap[sourceKey] = {
      status: 'error',
      count: 0,
      durationMs: Date.now() - start,
      error: (err as Error).message.slice(0, 140),
    };
    return [];
  }
}

async function fetchRemoteOK(tags: string[]): Promise<RawScoutedJob[]> {
  const tagParam = encodeURIComponent(
    (tags.length > 0 ? tags : ['product', 'growth', 'dev']).join(',')
  );
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
      description: stripHtml(item.description || '').substring(0, 12000),
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
            description: stripHtml(item.description || '').substring(0, 12000),
            url: String(item.url || ''),
            source: 'Remotive',
          });
        }
      } catch {
        // Ignore transient per-category fetch errors so peer categories succeed
      }
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
            description: stripHtml(item.description || '').substring(0, 12000),
            url: String(item.url || ''),
            source: 'Remotive',
          });
        }
      }
    } catch {
      // Non-fatal
    }
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
    const locs =
      Array.isArray(item.locationRestrictions) && item.locationRestrictions.length > 0
        ? item.locationRestrictions.join(', ')
        : 'Remote / Worldwide';
    return {
      id: `himalayas_${item.guid || item.slug || slugFallback}`,
      title: String(item.title || ''),
      company: String(item.companyName || 'Unknown'),
      location: locs,
      salary: salStr,
      description: stripHtml(item.description || item.excerpt || '').substring(0, 12000),
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
      description: stripHtml(item.description || '').substring(0, 12000),
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
    description: stripHtml(item.contents || '').substring(0, 12000),
    url: String(item.refs?.landing_page || ''),
    source: 'TheMuse',
  }));
}

async function fetchFreeHireOptionalApi(): Promise<RawScoutedJob[]> {
  const endpoint = process.env.FREEHIRE_API_URL?.trim();
  if (!endpoint) return [];

  const check = validateSafePublicUrl(endpoint, { allowLocalDev: true });
  if (!check.ok || !check.url) {
    throw new Error(`FREEHIRE_API_URL rejected: ${check.reason}`);
  }

  const res = await fetch(check.url.toString(), {
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
      description: stripHtml(item.description || '').substring(0, 12000),
      url: String(item.url || item.apply_url || ''),
      source: 'FreeHire API',
    };
  });
}

async function fetchGreenhouseBoards(boards: string[]): Promise<BoardFetchResult> {
  const results: RawScoutedJob[] = [];
  const failedBoards: string[] = [];
  const activeBoards = boards.slice(0, MAX_ATS_BOARDS_PER_PROVIDER);
  const truncatedBoards = Math.max(0, boards.length - activeBoards.length);

  await Promise.all(
    activeBoards.map(async (board) => {
      try {
        const res = await fetch(
          `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs?content=true`,
          { signal: AbortSignal.timeout(6500) }
        );
        if (!res.ok) {
          failedBoards.push(`${board} (${res.status})`);
          return;
        }
        const data = await res.json();
        for (const job of (data.jobs || []).slice(0, 12)) {
          results.push({
            id: `greenhouse_${board}_${job.id}`,
            title: String(job.title || ''),
            company: board.charAt(0).toUpperCase() + board.slice(1),
            location: String(job.location?.name || 'Remote / Hybrid'),
            salary: 'Direct ATS Band',
            description: stripHtml(job.content || `${job.title} at ${board}`).substring(0, 12000),
            url: String(job.absolute_url || ''),
            source: 'Greenhouse',
          });
        }
      } catch (err) {
        failedBoards.push(`${board} (${(err as Error).message.slice(0, 24)})`);
      }
    })
  );

  return { jobs: results, failedBoards, truncatedBoards };
}

async function fetchLeverBoards(boards: string[]): Promise<BoardFetchResult> {
  const results: RawScoutedJob[] = [];
  const failedBoards: string[] = [];
  const activeBoards = boards.slice(0, MAX_ATS_BOARDS_PER_PROVIDER);
  const truncatedBoards = Math.max(0, boards.length - activeBoards.length);

  await Promise.all(
    activeBoards.map(async (board) => {
      try {
        const res = await fetch(
          `https://api.lever.co/v0/postings/${encodeURIComponent(board)}?mode=json`,
          { signal: AbortSignal.timeout(6500) }
        );
        if (!res.ok) {
          failedBoards.push(`${board} (${res.status})`);
          return;
        }
        const data = await res.json();
        if (!Array.isArray(data)) return;
        for (const job of data.slice(0, 10)) {
          results.push({
            id: `lever_${board}_${job.id}`,
            title: String(job.text || ''),
            company: board.charAt(0).toUpperCase() + board.slice(1),
            location: String(job.categories?.location || 'Remote / Global'),
            salary: job.salaryRange
              ? `${job.salaryRange.min} - ${job.salaryRange.max} ${job.salaryRange.currency || 'USD'}`
              : 'Direct ATS Band',
            description: stripHtml(job.descriptionPlain || job.description || '').substring(0, 12000),
            url: String(job.hostedUrl || ''),
            source: 'Lever',
          });
        }
      } catch (err) {
        failedBoards.push(`${board} (${(err as Error).message.slice(0, 24)})`);
      }
    })
  );

  return { jobs: results, failedBoards, truncatedBoards };
}

async function fetchAshbyBoards(boards: string[]): Promise<BoardFetchResult> {
  const results: RawScoutedJob[] = [];
  const failedBoards: string[] = [];
  const activeBoards = boards.slice(0, MAX_ATS_BOARDS_PER_PROVIDER);
  const truncatedBoards = Math.max(0, boards.length - activeBoards.length);

  await Promise.all(
    activeBoards.map(async (board) => {
      try {
        const res = await fetch(
          `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(board)}`,
          { signal: AbortSignal.timeout(6500) }
        );
        if (!res.ok) {
          failedBoards.push(`${board} (${res.status})`);
          return;
        }
        const data = await res.json();
        for (const job of (data.jobs || []).slice(0, 12)) {
          results.push({
            id: `ashby_${board}_${job.id}`,
            title: String(job.title || ''),
            company: board.charAt(0).toUpperCase() + board.slice(1),
            location: String(job.location || 'Remote / Hybrid'),
            salary: 'Direct ATS Band',
            description: stripHtml(job.descriptionHtml || `${job.title} at ${board}`).substring(0, 12000),
            url: String(job.jobUrl || ''),
            source: 'Ashby',
          });
        }
      } catch (err) {
        failedBoards.push(`${board} (${(err as Error).message.slice(0, 24)})`);
      }
    })
  );

  return { jobs: results, failedBoards, truncatedBoards };
}

async function fetchInternshalaHyderabad(profile: CandidateProfile): Promise<RawScoutedJob[]> {
  const jobs: RawScoutedJob[] = [];
  const { internshalaSlugs } = deriveDynamicSearchParams(profile);
  const rawCities = (profile.target_cities || [])
    .map((c) => c.toLowerCase().replace('bengaluru', 'bangalore').trim())
    .filter((c) => c && c !== 'remote');
  const cities = rawCities.length > 0 ? rawCities : ['hyderabad'];
  const seen = new Set<string>();

  for (const category of internshalaSlugs.slice(0, 3)) {
    for (const city of cities.slice(0, 2)) {
      try {
        const res = await fetch(`https://internshala.com/jobs/${category}-jobs/${city}-city/`, {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          },
          signal: AbortSignal.timeout(7000),
        });
        if (!res.ok) continue;
        const html = await res.text();
        const nextMatch = html.match(
          /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/
        );
        if (nextMatch) {
          try {
            const d = JSON.parse(nextMatch[1]);
            const list =
              d?.props?.pageProps?.jobs ||
              d?.props?.pageProps?.data?.jobs ||
              d?.props?.pageProps?.listings ||
              [];
            for (const item of list.slice(0, 10)) {
              const title = String(item.profile || item.title || item.job_title || '').trim();
              if (!title) continue;
              const company = String(
                item.company_name || item.employer_name || item.company || 'Unknown'
              ).trim();
              const id = `internshala_${item.id || item.job_id || `${category}_${city}_${company}_${title}`.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 48)}`;
              if (seen.has(id)) continue;
              seen.add(id);
              const rawDesc = decodeAndStripHtml(
                item.description || item.job_description || `${title} at ${company} in ${city}.`
              );
              jobs.push({
                id,
                title,
                company,
                location: String(item.location || city),
                salary: String(item.salary || item.ctc || 'Not listed'),
                description: rawDesc.substring(0, 12000),
                url: item.url
                  ? item.url.startsWith('http')
                    ? item.url
                    : `https://internshala.com${item.url}`
                  : `https://internshala.com/jobs/${category}-jobs/${city}-city/`,
                source: 'Internshala',
              });
            }
            continue;
          } catch {
            // Fall through to HTML parsing
          }
        }

        const parts = html.split('class="company generic_company');
        for (let i = 1; i < parts.length && i <= 8; i++) {
          const p = parts[i];
          const hrefMatch = p.match(/class="job-title-href"[^>]*href="([^"]+)"[^>]*>\s*([^<]+)/);
          if (!hrefMatch) continue;
          const href = hrefMatch[1];
          const title = decodeAndStripHtml(hrefMatch[2] || '').trim();
          const company =
            decodeAndStripHtml(
              p.match(/class="company-name">\s*(?:<[^>]+>\s*)*([^<\n]+)/)?.[1] || ''
            ).trim() || 'Unknown';
          const rawId = href.match(/(\d+)$/)?.[1] || `${category}_${city}_${i}`;
          const id = `internshala_${rawId}`;
          if (title.length <= 3 || seen.has(id)) continue;
          seen.add(id);
          jobs.push({
            id,
            title,
            company,
            location: city,
            salary: 'Not listed',
            description: `${title} role at ${company}, ${city}. Via Internshala.`,
            url: href.startsWith('http') ? href : `https://internshala.com${href}`,
            source: 'Internshala',
          });
        }
      } catch {
        // Non-fatal per-city Internshala fetch error
      }
    }
  }

  return jobs;
}

/**
 * Executes a bounded-concurrency live multi-source + direct ATS job scout run driven by profile targeting,
 * deduplicates canonically across Sheet1 + SeenJobs, evaluates top candidates within a 42s budget,
 * and honestly reports persistence status.
 */
export async function executeLiveScoutRun(options?: {
  minScoreToCommit?: number;
  maxToEvaluate?: number;
  customBoards?: {
    greenhouse?: string[];
    lever?: string[];
    ashby?: string[];
    workable?: string[];
    smartrecruiters?: string[];
    recruitee?: string[];
    career_urls?: string[];
  };
}): Promise<ScoutRunSummary> {
  const sweepStartMs = Date.now();
  const warnings: string[] = [];
  const profile: CandidateProfile = await getCandidateProfileAsync();
  const minScore = options?.minScoreToCommit ?? 82;
  const maxToEvaluate = Math.min(20, Math.max(1, options?.maxToEvaluate ?? 6));
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
  const workableBoards =
    options?.customBoards?.workable ||
    profile.ats_companies?.workable ||
    DEFAULT_ATS_COMPANIES.workable ||
    [];
  const smartRecruitersBoards =
    options?.customBoards?.smartrecruiters ||
    profile.ats_companies?.smartrecruiters ||
    DEFAULT_ATS_COMPANIES.smartrecruiters ||
    [];
  const recruiteeBoards =
    options?.customBoards?.recruitee ||
    profile.ats_companies?.recruitee ||
    DEFAULT_ATS_COMPANIES.recruitee ||
    [];
  const careerUrls =
    options?.customBoards?.career_urls ||
    profile.career_urls ||
    DEFAULT_CAREER_URLS;

  const sourceHealth: Record<string, SourceHealthMetric> = {};
  const cloudConfigured = isCloudSheetsConfigured();

  const [
    internshalaJobs,
    careerPages,
    greenhouse,
    ashby,
    lever,
    workable,
    smartRecruiters,
    recruitee,
    remoteOk,
    remotive,
    himalayas,
    arbeitnow,
    theMuse,
    freeHire,
    ledgerData,
    seenJobIds,
  ] = await Promise.all([
    timedFetch('Internshala', () => fetchInternshalaHyderabad(profile), sourceHealth),
    timedFetch('Company Career Pages', () => fetchCompanyCareerPages(careerUrls), sourceHealth),
    timedFetch('Greenhouse', () => fetchGreenhouseBoards(ghBoards), sourceHealth),
    timedFetch('Ashby', () => fetchAshbyBoards(ashbyBoards), sourceHealth),
    timedFetch('Lever', () => fetchLeverBoards(leverBoards), sourceHealth),
    timedFetch('Workable', () => fetchWorkableBoards(workableBoards), sourceHealth),
    timedFetch('SmartRecruiters', () => fetchSmartRecruitersBoards(smartRecruitersBoards), sourceHealth),
    timedFetch('Recruitee', () => fetchRecruiteeBoards(recruiteeBoards), sourceHealth),
    timedFetch('RemoteOK', () => fetchRemoteOK(remoteOkTags), sourceHealth),
    timedFetch('Remotive', () => fetchRemotive(remotiveCategories, remotiveKeywords), sourceHealth),
    timedFetch('Himalayas', () => fetchHimalayas(), sourceHealth),
    timedFetch('Arbeitnow', () => fetchArbeitnow(), sourceHealth),
    timedFetch('TheMuse', () => fetchTheMuse(), sourceHealth),
    process.env.FREEHIRE_API_URL
      ? timedFetch('FreeHire API', () => fetchFreeHireOptionalApi(), sourceHealth)
      : Promise.resolve([]),
    getAllSheetRows(),
    cloudConfigured
      ? getCloudSeenJobIds().catch(() => readLocalSeenJobIds())
      : Promise.resolve(readLocalSeenJobIds()),
  ]);

  for (const [src, metric] of Object.entries(sourceHealth)) {
    if (metric.failedBoards && metric.failedBoards.length > 0) {
      warnings.push(`${src} board issues: ${metric.failedBoards.join(', ')}`);
    }
    if (metric.truncatedBoards && metric.truncatedBoards > 0) {
      warnings.push(`${src}: ${metric.truncatedBoards} configured boards exceeded the ${MAX_ATS_BOARDS_PER_PROVIDER}-board per-sweep limit.`);
    }
  }

  const rawCombined: RawScoutedJob[] = [
    ...internshalaJobs,
    ...careerPages,
    ...freeHire,
    ...greenhouse,
    ...ashby,
    ...lever,
    ...workable,
    ...smartRecruiters,
    ...recruitee,
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

  const existingIds = new Set(ledgerData.rows.slice(1).map((r) => String(r[1] || '').trim()));
  const existingFingerprints = new Set(
    ledgerData.rows
      .slice(1)
      .map((r) => normalizeCanonicalFingerprint(String(r[3] || ''), String(r[2] || '')))
  );

  const seenBatchIds = new Set<string>();
  const seenBatchFingerprints = new Set<string>();
  const unseen: RawScoutedJob[] = [];

  for (const j of rawCombined) {
    if (!j.title || !j.id) continue;
    const fp = normalizeCanonicalFingerprint(j.company, j.title);
    if (
      existingIds.has(j.id) ||
      seenJobIds.has(j.id) ||
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

  // Quick title-seniority pre-filter before network enrichment so we only fetch full JDs for plausible fresher roles
  const titleSeniorBlockerRegex =
    /\b(director|vp|vice president|principal|head of|chief|staff)\b/i;
  const prelimToEnrich = [...unseen]
    .filter((j) => {
      if (candidateYears > 1) return true;
      if (titleSeniorBlockerRegex.test(j.title)) return false;
      if (candidateYears === 0 && /\b(senior|sr\.?)\b/i.test(j.title)) return false;
      return true;
    })
    .sort((a, b) => {
      const targetCities = (profile.target_cities || []).map((c) => c.toLowerCase());
      const aHubBoost = targetCities.some((c) => a.location.toLowerCase().includes(c)) ? 20 : 0;
      const bHubBoost = targetCities.some((c) => b.location.toLowerCase().includes(c)) ? 20 : 0;
      const aScore =
        aHubBoost + countTokenHits(a.title, roleTokens) * 3 + countTokenHits(a.description, roleTokens);
      const bScore =
        bHubBoost + countTokenHits(b.title, roleTokens) * 3 + countTokenHits(b.description, roleTokens);
      return bScore - aScore;
    });

  // Enrich thin/stub descriptions (career anchors, Internshala cards, etc.) before strict eligibility gating
  if (Date.now() - sweepStartMs < SWEEP_DEADLINE_MS - 12000) {
    await enrichThinJobDescriptions(prelimToEnrich.slice(0, 16), 10);
  }

  const rejectedIneligibleIds: string[] = [];
  const eligibleCandidates: Array<{ job: RawScoutedJob; matchesTargetHub: boolean }> = [];

  for (const j of unseen) {
    const eligibility = evaluateHardEligibility(j, profile);
    if (!eligibility.eligible) {
      rejectedIneligibleIds.push(j.id);
      continue;
    }
    eligibleCandidates.push({
      job: j,
      matchesTargetHub: eligibility.flags.matchesTargetHub,
    });
  }

  if (unseen.length > 0 && eligibleCandidates.length === 0) {
    warnings.push(
      `All ${unseen.length} unseen postings were filtered out by strict ${(profile.target_cities || ['Hyderabad']).join('/')} & ${profile.experience_level} eligibility gates (US work-auth, STEM OPT, non-target metro remote, or senior experience requirements).`
    );
  }

  const ranked = [...eligibleCandidates]
    .sort((a, b) => {
      const aScore =
        (a.matchesTargetHub ? 25 : 0) +
        countTokenHits(a.job.title, roleTokens) * 4 +
        countTokenHits(a.job.description, roleTokens);
      const bScore =
        (b.matchesTargetHub ? 25 : 0) +
        countTokenHits(b.job.title, roleTokens) * 4 +
        countTokenHits(b.job.description, roleTokens);
      return bScore - aScore;
    })
    .map((item) => item.job);

  const candidatesToScore = ranked.slice(0, maxToEvaluate);
  const committedJobs: ScoutRunSummary['committed_jobs'] = [];
  const todayStr = new Date().toISOString().split('T')[0];

  // Evaluate in bounded pairs to reduce runtime while respecting API RPM limits & 42s timeout budget
  const evaluatedPairs: Array<{
    candidate: RawScoutedJob;
    evalResult: Awaited<ReturnType<typeof evaluateRoleWithLLM>>;
  }> = [];
  let deadlineTriggered = false;

  for (let i = 0; i < candidatesToScore.length; i += 2) {
    const chunk = candidatesToScore.slice(i, i + 2);
    const chunkResults = await Promise.all(
      chunk.map(async (candidate) => {
        if (Date.now() - sweepStartMs > SWEEP_DEADLINE_MS) {
          deadlineTriggered = true;
          return {
            candidate,
            evalResult: deterministicEvaluateJob(
              {
                title: candidate.title,
                company: candidate.company,
                location: candidate.location,
                salary: candidate.salary,
                description: candidate.description,
              },
              profile
            ),
          };
        }
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
        return { candidate, evalResult };
      })
    );
    evaluatedPairs.push(...chunkResults);
  }

  if (deadlineTriggered) {
    warnings.push(
      'Sweep deadline budget (42s) reached; remaining candidates scored instantaneously with Deterministic 4-Pillar Rubric v3.2.'
    );
  }

  const newlyEvaluatedIds: string[] = [];
  let resolvedPersistenceMode: ScoutRunSummary['persistence_mode'] = cloudConfigured
    ? 'cloud-sheets'
    : 'local-disk';

  for (const { candidate, evalResult } of evaluatedPairs) {
    if (evalResult.score > 0) {
      newlyEvaluatedIds.push(candidate.id);
    }

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

      const localWrite = appendLocalJobRecordDetailed(record);
      let cloudSaved = false;
      let cloudError: string | undefined;

      if (cloudConfigured) {
        try {
          await appendCloudSheetRecord(record);
          cloudSaved = true;
        } catch (e) {
          cloudError = (e as Error).message;
        }
      }

      if (cloudSaved) {
        resolvedPersistenceMode = 'cloud-sheets';
      } else if (localWrite.ok) {
        resolvedPersistenceMode =
          localWrite.mode === 'ephemeral-tmp' ? 'ephemeral-tmp' : 'local-disk';
        if (cloudError) {
          warnings.push(`Cloud sheet append failed (${cloudError}); saved to ${localWrite.mode}.`);
        } else if (localWrite.mode === 'ephemeral-tmp' && !warnings.some((w) => w.includes('/tmp'))) {
          warnings.push(
            'Container mounts data/ as read-only; committed matches saved in ephemeral /tmp memory. Configure GOOGLE_SHEET_ID for durable cloud persistence.'
          );
        }
      } else {
        throw new Error(
          cloudError
            ? `Failed persisting scouted job "${record.title}" to Google Sheets (${cloudError}) and runtime disk is read-only.`
            : `Read-only storage prevented committing "${record.title}". Configure GOOGLE_SHEET_ID + GOOGLE_SERVICE_KEY_BASE64 for cloud persistence.`
        );
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

  // Persist seen IDs (both LLM-scored and eligibility-blocked) so rejected roles aren't re-evaluated in the next sweep
  const allSeenToPersist = Array.from(new Set([...newlyEvaluatedIds, ...rejectedIneligibleIds]));
  if (allSeenToPersist.length > 0) {
    appendLocalSeenJobIds(allSeenToPersist);
    if (cloudConfigured) {
      try {
        await appendCloudSeenJobIds(allSeenToPersist);
      } catch {
        // Non-fatal
      }
    }
  }

  const sourcesQueried = [
    'Internshala Jobs',
    'Company Career Pages',
    'Greenhouse Direct ATS',
    'Ashby Direct ATS',
    'Lever Direct ATS',
    'Workable Direct ATS',
    'SmartRecruiters Direct ATS',
    'Recruitee Direct ATS',
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
    persistence_mode: resolvedPersistenceMode,
    warnings,
    total_fetched: rawCombined.length,
    new_after_dedup: unseen.length,
    evaluated_count: candidatesToScore.length,
    committed_count: committedJobs.length,
    committed_jobs: committedJobs,
  };
}
