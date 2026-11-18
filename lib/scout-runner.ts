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
  fetchWorkdayBoards,
  enrichThinJobDescriptions,
} from './career-scraper';
import {
  decodeAndStripHtml,
  evaluateHardEligibility,
  buildCanonicalJobKey,
  getSourceUrlPriority,
} from './eligibility';
import { deterministicEvaluateJob, evaluateRoleWithLLM } from './llm';
import {
  appendCloudSeenJobIds,
  appendCloudSheetRecord,
  appendLocalJobRecordDetailed,
  appendLocalSeenJobIds,
  getAllSheetRows,
  getCloudSeenJobIds,
  isCloudSheetsConfigured,
  isNeonPostgresConfigured,
  readLocalJobRecords,
  readLocalSeenJobIds,
  updateLocalJobRow,
  upsertNeonCanonicalJob,
} from './sheets';
import {
  getNeonCanonicalStateMap,
  getNeonJobsPendingLlmRetry,
  recordNeonScoutRun,
} from './neon-db.js';
import {
  deriveDynamicSearchParams,
  validateSafePublicUrl,
} from './utils';

export interface RawScoutedJob {
  id: string;
  canonicalKey?: string;
  title: string;
  company: string;
  location: string;
  salary: string;
  description: string;
  url: string;
  source: string;
  sourcesSeen?: Array<{ source: string; url: string; id?: string; seenAt?: string }>;
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
  mode?: 'live_sweep' | 'retry_pending';
  sources_queried: string[];
  source_counts: Record<string, number>;
  source_health: Record<string, SourceHealthMetric>;
  persistence_mode: 'neon-postgres' | 'cloud-sheets' | 'local-disk' | 'ephemeral-tmp';
  warnings: string[];
  total_fetched: number;
  canonical_dedup_saved?: number;
  new_after_dedup: number;
  hard_gate_rejected?: number;
  hard_gate_reasons?: Record<string, number>;
  evaluated_count: number;
  committed_count: number;
  queued_for_retry_count?: number;
  committed_jobs: Array<{
    id: string;
    canonicalKey?: string;
    title: string;
    company: string;
    location?: string;
    source: string;
    sourcesSeen?: Array<{ source: string; url: string }>;
    score: number;
    status: string;
    evaluationStatus?: string;
    needsLlmRetry?: boolean;
    url: string;
  }>;
}

const MAX_ATS_BOARDS_PER_PROVIDER = 12;
const SWEEP_DEADLINE_MS = 42000;

function stripHtml(html: string): string {
  return decodeAndStripHtml(html);
}

function scoreAtsCandidateBeforeSlice(title: string, location: string): number {
  const loc = String(location || '').toLowerCase();
  const t = String(title || '').toLowerCase();
  let score = 0;
  if (/\b(hyderabad|telangana|secunderabad)\b/.test(loc)) score += 60;
  else if (/\b(india|bengaluru|bangalore|mumbai|pune|gurgaon|gurugram|noida|chennai|delhi)\b/.test(loc))
    score += 35;
  else if (/\b(remote|worldwide|anywhere|global|distributed)\b/.test(loc)) score += 20;

  if (
    /\b(associate product|apm|product marketing|pmm|growth|founder|product analyst|product manager|marketing operations|digital content)\b/.test(
      t
    )
  ) {
    score += 30;
  }
  if (!/\b(senior|sr\.?|staff|principal|director|vp|vice president|head of)\b/.test(t)) {
    score += 12;
  }
  return score;
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
      'User-Agent': 'KaisifOS-FreeHire-Scout/4.0',
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
    headers: { Accept: 'application/json', 'User-Agent': 'KaisifOS-FreeHire-Scout/4.0' },
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
        const allJobs = Array.isArray(data.jobs) ? data.jobs : [];
        const sortedJobs = [...allJobs]
          .sort(
            (a: any, b: any) =>
              scoreAtsCandidateBeforeSlice(b.title || '', b.location?.name || '') -
              scoreAtsCandidateBeforeSlice(a.title || '', a.location?.name || '')
          )
          .slice(0, 14);
        for (const job of sortedJobs) {
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
        const sortedJobs = [...data]
          .sort(
            (a: any, b: any) =>
              scoreAtsCandidateBeforeSlice(b.text || '', b.categories?.location || '') -
              scoreAtsCandidateBeforeSlice(a.text || '', a.categories?.location || '')
          )
          .slice(0, 12);
        for (const job of sortedJobs) {
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
        const allJobs = Array.isArray(data.jobs) ? data.jobs : [];
        const sortedJobs = [...allJobs]
          .sort(
            (a: any, b: any) =>
              scoreAtsCandidateBeforeSlice(b.title || '', b.location || '') -
              scoreAtsCandidateBeforeSlice(a.title || '', a.location || '')
          )
          .slice(0, 12);
        for (const job of sortedJobs) {
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

async function fetchInternshalaHyderabad(profile: CandidateProfile): Promise<BoardFetchResult> {
  const jobs: RawScoutedJob[] = [];
  const failedBoards: string[] = [];
  const { internshalaSlugs } = deriveDynamicSearchParams(profile);
  const rawCities = (profile.target_cities || [])
    .map((c) => c.toLowerCase().replace('bengaluru', 'bangalore').trim())
    .filter((c) => c && c !== 'remote');
  const cities = rawCities.length > 0 ? rawCities : ['hyderabad'];
  const seen = new Set<string>();

  const targetPaths: Array<{ url: string; label: string; defaultLoc: string }> = [];
  for (const category of internshalaSlugs.slice(0, 3)) {
    for (const city of cities.slice(0, 2)) {
      targetPaths.push({
        url: `https://internshala.com/jobs/${category}-jobs/${city}-city/`,
        label: `${category}/${city}`,
        defaultLoc: city,
      });
    }
  }
  if (internshalaSlugs[0]) {
    targetPaths.push({
      url: `https://internshala.com/jobs/work-from-home-${internshalaSlugs[0]}-jobs/`,
      label: `wfh/${internshalaSlugs[0]}`,
      defaultLoc: 'India Remote (WFH)',
    });
  }

  for (const target of targetPaths) {
    try {
      const res = await fetch(target.url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        signal: AbortSignal.timeout(7000),
      });
      if (!res.ok) {
        failedBoards.push(`${target.label} (${res.status})`);
        continue;
      }
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
            const id = `internshala_${item.id || item.job_id || `${target.label}_${company}_${title}`.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 48)}`;
            if (seen.has(id)) continue;
            seen.add(id);
            const rawDesc = decodeAndStripHtml(
              item.description || item.job_description || `${title} at ${company} (${target.defaultLoc}).`
            );
            jobs.push({
              id,
              title,
              company,
              location: String(item.location || target.defaultLoc),
              salary: String(item.salary || item.ctc || 'Not listed'),
              description: rawDesc.substring(0, 12000),
              url: item.url
                ? item.url.startsWith('http')
                  ? item.url
                  : `https://internshala.com${item.url}`
                : target.url,
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
        const rawId = href.match(/(\d+)$/)?.[1] || `${target.label}_${i}`;
        const id = `internshala_${rawId}`;
        if (title.length <= 3 || seen.has(id)) continue;
        seen.add(id);
        jobs.push({
          id,
          title,
          company,
          location: target.defaultLoc,
          salary: 'Not listed',
          description: `${title} role at ${company}, ${target.defaultLoc}. Via Internshala.`,
          url: href.startsWith('http') ? href : `https://internshala.com${href}`,
          source: 'Internshala',
        });
      }
    } catch (err) {
      failedBoards.push(`${target.label} (${(err as Error).message.slice(0, 24)})`);
    }
  }

  return { jobs, failedBoards };
}

async function fetchJSearchLive(profile: CandidateProfile): Promise<RawScoutedJob[]> {
  const apiKey = process.env.RAPIDAPI_KEY?.trim();
  if (!apiKey) return [];

  const roles = (profile.target_roles || ['Associate Product Manager', 'Growth Analyst']).slice(0, 3);
  const cityConstraint =
    profile.open_to_relocation === false
      ? `in ${(profile.target_cities || ['Hyderabad']).join(' OR ')}, India`
      : '';
  const query = `(${roles.map((r) => `"${r}"`).join(' OR ')}) (fresher OR "entry level" OR junior OR associate) ${cityConstraint}`.trim();

  const url = new URL('https://jsearch.p.rapidapi.com/search');
  url.searchParams.set('query', query);
  url.searchParams.set('num_pages', '1');
  url.searchParams.set('date_posted', 'week');
  if (profile.open_to_relocation === false) {
    url.searchParams.set('country', 'in');
  }

  const res = await fetch(url.toString(), {
    headers: {
      'X-RapidAPI-Key': apiKey,
      'X-RapidAPI-Host': 'jsearch.p.rapidapi.com',
    },
    signal: AbortSignal.timeout(9000),
  });
  if (!res.ok) throw new Error(`JSearch HTTP ${res.status}`);
  const data = await res.json();
  return (data.data || []).slice(0, 15).map((item: any) => ({
    id: `jsearch_${item.job_id}`,
    title: String(item.job_title || ''),
    company: String(item.employer_name || 'Unknown'),
    location:
      [item.job_city, item.job_country].filter(Boolean).join(', ') || 'Remote / Global',
    salary: item.job_min_salary
      ? `${item.job_salary_currency || '$'}${item.job_min_salary}${item.job_max_salary ? ` - ${item.job_max_salary}` : ''}`
      : 'Not listed',
    description: stripHtml(item.job_description || '').substring(0, 12000),
    url: String(item.job_apply_link || ''),
    source: 'JSearch',
  }));
}

/**
 * Executes a bounded-concurrency live multi-source + direct ATS job scout run driven by profile targeting,
 * deduplicates canonically across Neon Postgres / Sheet1 / SeenJobs, supports retry_pending mode for
 * DETERMINISTIC_ONLY jobs, and reports persistence + deduplication telemetry.
 */
export async function executeLiveScoutRun(options?: {
  mode?: 'live_sweep' | 'retry_pending';
  minScoreToCommit?: number;
  maxToEvaluate?: number;
  customBoards?: {
    greenhouse?: string[];
    lever?: string[];
    ashby?: string[];
    workable?: string[];
    smartrecruiters?: string[];
    recruitee?: string[];
    workday?: Array<string | { tenant: string; site: string; host?: string; company?: string }>;
    career_urls?: string[];
  };
}): Promise<ScoutRunSummary> {
  const sweepStartMs = Date.now();
  const runMode = options?.mode === 'retry_pending' ? 'retry_pending' : 'live_sweep';
  const warnings: string[] = [];
  const profile: CandidateProfile = await getCandidateProfileAsync();
  const minScore = options?.minScoreToCommit ?? 80;
  const maxToEvaluate = Math.min(20, Math.max(1, options?.maxToEvaluate ?? 8));
  const neonConfigured = isNeonPostgresConfigured();
  const cloudConfigured = isCloudSheetsConfigured();

  // Mode 1: Retry Pending LLM Evaluations (re-scores DETERMINISTIC_ONLY jobs)
  if (runMode === 'retry_pending') {
    const pendingJobs: RawScoutedJob[] = [];
    if (neonConfigured) {
      const neonPending = await getNeonJobsPendingLlmRetry(maxToEvaluate);
      for (const p of neonPending) {
        pendingJobs.push({
          id: p.id,
          canonicalKey: p.canonicalKey,
          title: p.title,
          company: p.company,
          location: p.location,
          salary: p.salary,
          description: p.description || `${p.title} at ${p.company}`,
          url: p.url,
          source: p.source || 'Retry Queue',
          sourcesSeen: p.sourcesSeen,
        });
      }
    } else {
      const localRecords = readLocalJobRecords().filter(
        (r) => r.needsLlmRetry || r.evaluationStatus === 'DETERMINISTIC_ONLY'
      );
      for (const r of localRecords.slice(0, maxToEvaluate)) {
        pendingJobs.push({
          id: r.id,
          canonicalKey: r.canonicalKey,
          title: r.title,
          company: r.company,
          location: r.location || 'Hyderabad',
          salary: r.salary || 'Not listed',
          description: `${r.title} at ${r.company}. ${r.reasons || ''}`,
          url: r.url,
          source: r.id,
          sourcesSeen: r.sourcesSeen,
        });
      }
    }

    if (pendingJobs.length === 0) {
      warnings.push('No jobs currently queued with needs_llm_retry = true.');
    }

    const committedJobs: ScoutRunSummary['committed_jobs'] = [];
    let stillQueuedCount = 0;

    for (const candidate of pendingJobs) {
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

      const isDeterministicFallback = String(evalResult.engine_used || '')
        .toLowerCase()
        .includes('deterministic');
      const isLlmScored = !isDeterministicFallback;
      const evalStatus = isLlmScored ? 'LLM_SCORED' : 'DETERMINISTIC_ONLY';
      const needsRetry = !isLlmScored;
      if (needsRetry) stillQueuedCount++;

      const status = evalResult.score >= 90 ? 'SHORTLISTED' : 'NEW';
      if (neonConfigured) {
        await upsertNeonCanonicalJob({
          id: candidate.id,
          canonicalKey: candidate.canonicalKey,
          title: candidate.title,
          company: candidate.company,
          location: candidate.location,
          salary: candidate.salary,
          description: candidate.description,
          url: candidate.url,
          source: candidate.source,
          sourcesSeen: candidate.sourcesSeen,
          score: evalResult.score,
          evaluationStatus: evalStatus,
          needsLlmRetry: needsRetry,
          pipelineStage: status,
          reasons: evalResult.match_reasons.join(' | '),
          gap: evalResult.gap,
          dmDraft: evalResult.dm_draft,
          resumeAngle: evalResult.resume_angle,
        });
      }
      updateLocalJobRow(
        { id: candidate.id, canonicalKey: candidate.canonicalKey },
        {
          score: evalResult.score,
          reasons: evalResult.match_reasons.join(' | '),
          gap: evalResult.gap,
          dm: evalResult.dm_draft,
          resumeAngle: evalResult.resume_angle,
          evaluationStatus: evalStatus,
          needsLlmRetry: needsRetry,
          ...(evalResult.score >= 90 ? { status: 'SHORTLISTED' } : {}),
        }
      );

      committedJobs.push({
        id: candidate.id,
        canonicalKey: candidate.canonicalKey,
        title: candidate.title,
        company: candidate.company,
        location: candidate.location,
        source: candidate.source,
        sourcesSeen: candidate.sourcesSeen,
        score: evalResult.score,
        status,
        evaluationStatus: evalStatus,
        needsLlmRetry: needsRetry,
        url: candidate.url,
      });
    }

    return {
      timestamp: new Date().toISOString(),
      mode: 'retry_pending',
      sources_queried: ['Pending LLM Retry Queue'],
      source_counts: { 'Pending LLM Retry Queue': pendingJobs.length },
      source_health: {
        'Pending LLM Retry Queue': {
          status: pendingJobs.length > 0 ? 'ok' : 'empty',
          count: pendingJobs.length,
          durationMs: Date.now() - sweepStartMs,
        },
      },
      persistence_mode: neonConfigured
        ? 'neon-postgres'
        : cloudConfigured
        ? 'cloud-sheets'
        : 'local-disk',
      warnings,
      total_fetched: pendingJobs.length,
      canonical_dedup_saved: 0,
      new_after_dedup: pendingJobs.length,
      hard_gate_rejected: 0,
      evaluated_count: pendingJobs.length,
      committed_count: committedJobs.length,
      queued_for_retry_count: stillQueuedCount,
      committed_jobs: committedJobs,
    };
  }

  // Mode 2: Full Live Career & Direct-ATS Sweep
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
  const workdayBoards =
    options?.customBoards?.workday ||
    profile.ats_companies?.workday ||
    DEFAULT_ATS_COMPANIES.workday ||
    [];
  const careerUrls =
    options?.customBoards?.career_urls ||
    profile.career_urls ||
    DEFAULT_CAREER_URLS;
  const enableInternshala = profile.enable_internshala === true;

  const sourceHealth: Record<string, SourceHealthMetric> = {};

  const [
    internshalaJobs,
    jSearchJobs,
    careerPages,
    greenhouse,
    ashby,
    lever,
    workable,
    smartRecruiters,
    recruitee,
    workdayJobs,
    remoteOk,
    remotive,
    himalayas,
    arbeitnow,
    theMuse,
    freeHire,
    ledgerData,
    seenJobIds,
    neonStateMap,
  ] = await Promise.all([
    enableInternshala
      ? timedFetch('Internshala', () => fetchInternshalaHyderabad(profile), sourceHealth)
      : Promise.resolve([]),
    process.env.RAPIDAPI_KEY
      ? timedFetch('JSearch', () => fetchJSearchLive(profile), sourceHealth)
      : Promise.resolve([]),
    timedFetch('Company Career Pages', () => fetchCompanyCareerPages(careerUrls), sourceHealth),
    timedFetch('Greenhouse', () => fetchGreenhouseBoards(ghBoards), sourceHealth),
    timedFetch('Ashby', () => fetchAshbyBoards(ashbyBoards), sourceHealth),
    timedFetch('Lever', () => fetchLeverBoards(leverBoards), sourceHealth),
    timedFetch('Workable', () => fetchWorkableBoards(workableBoards), sourceHealth),
    timedFetch('SmartRecruiters', () => fetchSmartRecruitersBoards(smartRecruitersBoards), sourceHealth),
    timedFetch('Recruitee', () => fetchRecruiteeBoards(recruiteeBoards), sourceHealth),
    timedFetch('Workday ATS', () => fetchWorkdayBoards(workdayBoards), sourceHealth),
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
    neonConfigured ? getNeonCanonicalStateMap() : Promise.resolve(new Map()),
  ]);

  for (const [src, metric] of Object.entries(sourceHealth)) {
    if (metric.failedBoards && metric.failedBoards.length > 0) {
      warnings.push(`${src} issues: ${metric.failedBoards.slice(0, 4).join(', ')}`);
    }
    if (metric.truncatedBoards && metric.truncatedBoards > 0) {
      warnings.push(`${src}: ${metric.truncatedBoards} configured boards exceeded the ${MAX_ATS_BOARDS_PER_PROVIDER}-board per-sweep limit.`);
    }
  }

  // Order direct Career Pages & Direct ATS first so canonical deduplication prefers official URLs
  const rawCombined: RawScoutedJob[] = [
    ...careerPages,
    ...workdayJobs,
    ...greenhouse,
    ...lever,
    ...ashby,
    ...workable,
    ...smartRecruiters,
    ...recruitee,
    ...internshalaJobs,
    ...freeHire,
    ...remoteOk,
    ...remotive,
    ...himalayas,
    ...arbeitnow,
    ...theMuse,
    ...jSearchJobs,
  ];

  const sourceCounts: Record<string, number> = {};
  for (const j of rawCombined) {
    sourceCounts[j.source] = (sourceCounts[j.source] || 0) + 1;
  }

  const existingIds = new Set(ledgerData.rows.slice(1).map((r) => String(r[1] || '').trim()));
  const existingCanonicalKeys = new Set(
    (ledgerData.richRecords || []).map(
      (r) => r.canonicalKey || buildCanonicalJobKey(r.company, r.title, r.location)
    )
  );
  for (const r of ledgerData.rows.slice(1)) {
    existingCanonicalKeys.add(buildCanonicalJobKey(String(r[3] || ''), String(r[2] || '')));
  }

  // Merge duplicates within the current multi-source batch by canonical key
  const batchByCanonical = new Map<string, RawScoutedJob>();
  let canonicalDedupSaved = 0;

  for (const j of rawCombined) {
    if (!j.title || !j.id) continue;
    const cKey = buildCanonicalJobKey(j.company, j.title, j.location);
    j.canonicalKey = cKey;

    const existingInBatch = batchByCanonical.get(cKey);
    if (existingInBatch) {
      canonicalDedupSaved += 1;
      const existingSources = existingInBatch.sourcesSeen || [
        { source: existingInBatch.source, url: existingInBatch.url, id: existingInBatch.id },
      ];
      if (!existingSources.some((s) => s.source === j.source)) {
        existingSources.push({ source: j.source, url: j.url, id: j.id });
      }
      existingInBatch.sourcesSeen = existingSources;
      if ((j.description || '').length > (existingInBatch.description || '').length) {
        existingInBatch.description = j.description;
      }
      if (getSourceUrlPriority(j.url || j.source) > getSourceUrlPriority(existingInBatch.url || existingInBatch.source)) {
        existingInBatch.url = j.url;
        existingInBatch.source = j.source;
        existingInBatch.id = j.id;
      }
      continue;
    }

    batchByCanonical.set(cKey, {
      ...j,
      canonicalKey: cKey,
      sourcesSeen: [{ source: j.source, url: j.url, id: j.id }],
    });
  }

  const unseen: RawScoutedJob[] = [];
  for (const [cKey, job] of batchByCanonical.entries()) {
    const neonState = neonStateMap.get(cKey);
    if (neonState) {
      // Allow re-evaluation if Neon marked needsLlmRetry === true
      if (!neonState.needsLlmRetry) {
        canonicalDedupSaved += 1;
        continue;
      }
    } else if (
      existingIds.has(job.id) ||
      seenJobIds.has(job.id) ||
      seenJobIds.has(cKey) ||
      existingCanonicalKeys.has(cKey)
    ) {
      continue;
    }
    unseen.push(job);
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
      const aHubBoost = targetCities.some((c) => a.location.toLowerCase().includes(c)) ? 35 : 0;
      const bHubBoost = targetCities.some((c) => b.location.toLowerCase().includes(c)) ? 35 : 0;
      const aScore =
        aHubBoost + countTokenHits(a.title, roleTokens) * 4 + countTokenHits(a.description, roleTokens);
      const bScore =
        bHubBoost + countTokenHits(b.title, roleTokens) * 4 + countTokenHits(b.description, roleTokens);
      return bScore - aScore;
    });

  // Enrich thin/stub descriptions (career anchors, Internshala cards, etc.) before strict eligibility gating
  if (Date.now() - sweepStartMs < SWEEP_DEADLINE_MS - 12000) {
    await enrichThinJobDescriptions(prelimToEnrich.slice(0, 18), 10);
  }

  const rejectedIneligibleIds: string[] = [];
  const hardGateReasons: Record<string, number> = {};
  const eligibleCandidates: Array<{ job: RawScoutedJob; matchesTargetHub: boolean }> = [];

  for (const j of unseen) {
    const eligibility = evaluateHardEligibility(j, profile);
    if (!eligibility.eligible) {
      rejectedIneligibleIds.push(j.id);
      if (j.canonicalKey) rejectedIneligibleIds.push(j.canonicalKey);
      const primaryReason = eligibility.reasons?.[0] || 'Filtered by hard gate';
      const reasonKey = primaryReason.split(':')[0].trim();
      hardGateReasons[reasonKey] = (hardGateReasons[reasonKey] || 0) + 1;
      if (neonConfigured) {
        upsertNeonCanonicalJob({
          id: j.id,
          canonicalKey: j.canonicalKey,
          title: j.title,
          company: j.company,
          location: j.location,
          salary: j.salary,
          description: j.description,
          url: j.url,
          source: j.source,
          sourcesSeen: j.sourcesSeen,
          score: 0,
          evaluationStatus: 'REJECTED_GATE',
          needsLlmRetry: false,
          pipelineStage: 'REJECTED',
          hardRejectReason: primaryReason,
        }).catch(() => {});
      }
      continue;
    }

    // Dynamic role-relevance gate so unrelated roles (e.g. Hardware Eng for PM profile) don't waste LLM slots
    const titleRoleHits = countTokenHits(j.title, roleTokens);
    const hasCoreDomainSynonym =
      (/\b(apm|pmm|gtm|product\s+(?:manager|marketing|analyst|operations)|growth|founder'?s?\s+(?:associate|office)|marketing\s+(?:operations|analyst)|digital\s+(?:marketing|content))\b/i.test(
        j.title
      ) &&
        profile.target_roles.some((r) => /product|marketing|growth|founder|content/i.test(r))) ||
      (/\b(software|full[- ]stack|frontend|backend|ai|ml|machine\s+learning|data\s+(?:scientist|analyst|engineer))\b/i.test(
        j.title
      ) &&
        profile.target_roles.some((r) => /engineer|developer|scientist|data|ai|ml/i.test(r)));

    if (roleTokens.length > 0 && titleRoleHits === 0 && !hasCoreDomainSynonym) {
      rejectedIneligibleIds.push(j.id);
      if (j.canonicalKey) rejectedIneligibleIds.push(j.canonicalKey);
      hardGateReasons['Non-target role title'] = (hardGateReasons['Non-target role title'] || 0) + 1;
      if (neonConfigured) {
        upsertNeonCanonicalJob({
          id: j.id,
          canonicalKey: j.canonicalKey,
          title: j.title,
          company: j.company,
          location: j.location,
          salary: j.salary,
          url: j.url,
          source: j.source,
          sourcesSeen: j.sourcesSeen,
          score: 0,
          evaluationStatus: 'REJECTED_PREFILTER',
          needsLlmRetry: false,
          pipelineStage: 'REJECTED',
          hardRejectReason: 'Non-target role title relative to candidate target_roles',
        }).catch(() => {});
      }
      continue;
    }

    eligibleCandidates.push({
      job: j,
      matchesTargetHub: eligibility.flags.matchesTargetHub,
    });
  }

  if (unseen.length > 0 && eligibleCandidates.length === 0) {
    warnings.push(
      `All ${unseen.length} unseen postings were filtered out by strict ${(profile.target_cities || ['Hyderabad']).join('/')} & ${profile.experience_level} & target-role gates.`
    );
  }

  const ranked = [...eligibleCandidates]
    .sort((a, b) => {
      const aDirectBoost = getSourceUrlPriority(a.job.url || a.job.source) >= 95 ? 12 : 0;
      const bDirectBoost = getSourceUrlPriority(b.job.url || b.job.source) >= 95 ? 12 : 0;
      const aScore =
        (a.matchesTargetHub ? 30 : 0) +
        aDirectBoost +
        countTokenHits(a.job.title, roleTokens) * 4 +
        countTokenHits(a.job.description, roleTokens);
      const bScore =
        (b.matchesTargetHub ? 30 : 0) +
        bDirectBoost +
        countTokenHits(b.job.title, roleTokens) * 4 +
        countTokenHits(b.job.description, roleTokens);
      return bScore - aScore;
    })
    .map((item) => item.job);

  const candidatesToScore = ranked.slice(0, maxToEvaluate);
  const committedJobs: ScoutRunSummary['committed_jobs'] = [];
  const todayStr = new Date().toISOString().split('T')[0];

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
      'Sweep deadline budget (42s) reached; remaining candidates scored with Deterministic 4-Pillar Rubric and queued with needs_llm_retry = true.'
    );
  }

  const newlyEvaluatedIds: string[] = [];
  let queuedForRetryCount = 0;
  let resolvedPersistenceMode: ScoutRunSummary['persistence_mode'] = neonConfigured
    ? 'neon-postgres'
    : cloudConfigured
    ? 'cloud-sheets'
    : 'local-disk';

  for (const { candidate, evalResult } of evaluatedPairs) {
    const isDeterministicFallback = String(evalResult.engine_used || '')
      .toLowerCase()
      .includes('deterministic');
    const evaluationStatus = isDeterministicFallback ? 'DETERMINISTIC_ONLY' : 'LLM_SCORED';
    const needsLlmRetry = isDeterministicFallback && evalResult.score >= 55;

    if (needsLlmRetry) {
      queuedForRetryCount += 1;
    } else if (evalResult.score > 0) {
      // Only lock in SeenJobs if LLM genuinely evaluated the role (never blackhole deterministic fallbacks!)
      newlyEvaluatedIds.push(candidate.id);
      if (candidate.canonicalKey) newlyEvaluatedIds.push(candidate.canonicalKey);
    }

    // Effective commit threshold: minScore (80) for LLM-scored, or >= 72 for verified Hyderabad/Remote deterministic matches
    const effectiveThreshold = isDeterministicFallback ? Math.min(minScore, 72) : minScore;

    if (evalResult.score >= effectiveThreshold || needsLlmRetry) {
      const status = evalResult.score >= 90 ? 'SHORTLISTED' : 'NEW';
      const record = {
        date: todayStr,
        id: candidate.id,
        canonicalKey: candidate.canonicalKey,
        title: candidate.title,
        company: candidate.company,
        location: candidate.location,
        salary: candidate.salary,
        score: evalResult.score,
        reasons: evalResult.match_reasons.join(' | '),
        gap: evalResult.gap,
        url: candidate.url,
        dm: evalResult.dm_draft,
        resumeAngle: evalResult.resume_angle,
        status,
        evaluationStatus,
        needsLlmRetry,
        sourcesSeen: candidate.sourcesSeen,
      };

      const localWrite = appendLocalJobRecordDetailed(record);
      let neonSaved = false;
      let cloudSaved = false;
      let cloudError: string | undefined;

      if (neonConfigured) {
        try {
          const neonRes = await upsertNeonCanonicalJob({
            id: record.id,
            canonicalKey: record.canonicalKey,
            title: record.title,
            company: record.company,
            location: record.location,
            salary: record.salary,
            description: candidate.description,
            url: record.url,
            source: candidate.source,
            sourcesSeen: record.sourcesSeen,
            score: record.score,
            evaluationStatus: record.evaluationStatus,
            needsLlmRetry: record.needsLlmRetry,
            pipelineStage: record.status,
            reasons: record.reasons,
            gap: record.gap,
            dmDraft: record.dm,
            resumeAngle: record.resumeAngle,
          });
          neonSaved = Boolean(neonRes.ok);
        } catch (e) {
          cloudError = (e as Error).message;
        }
      }

      if (cloudConfigured && evalResult.score >= effectiveThreshold) {
        try {
          await appendCloudSheetRecord(record);
          cloudSaved = true;
        } catch (e) {
          if (!neonSaved) cloudError = (e as Error).message;
        }
      }

      if (neonSaved) {
        resolvedPersistenceMode = 'neon-postgres';
      } else if (cloudSaved) {
        resolvedPersistenceMode = 'cloud-sheets';
      } else if (localWrite.ok) {
        resolvedPersistenceMode =
          localWrite.mode === 'ephemeral-tmp' ? 'ephemeral-tmp' : 'local-disk';
        if (cloudError) {
          warnings.push(`Cloud persistence failed (${cloudError}); saved to ${localWrite.mode}.`);
        }
      }

      if (evalResult.score >= effectiveThreshold) {
        committedJobs.push({
          id: record.id,
          canonicalKey: record.canonicalKey,
          title: record.title,
          company: record.company,
          location: record.location,
          source: candidate.source,
          sourcesSeen: record.sourcesSeen,
          score: record.score,
          status: record.status,
          evaluationStatus: record.evaluationStatus,
          needsLlmRetry: record.needsLlmRetry,
          url: record.url,
        });
      }
    }
  }

  // Persist seen IDs (only genuinely LLM-scored or hard-gate rejected roles; never deterministic fallback roles)
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

  if (neonConfigured) {
    recordNeonScoutRun({
      runner: 'web_live_scout',
      rawFetched: rawCombined.length,
      canonicalDedupSaved,
      hardGateRejected: rejectedIneligibleIds.length,
      evaluatedCount: candidatesToScore.length,
      committedCount: committedJobs.length,
      queuedForRetryCount,
      sourceCounts,
      rejectionBreakdown: hardGateReasons,
      durationMs: Date.now() - sweepStartMs,
    }).catch(() => {});
  }

  const sourcesQueried = [
    'Company Career Pages (incl. Keka & Darwinbox)',
    'Workday Direct ATS',
    'Greenhouse Direct ATS',
    'Lever Direct ATS',
    'Ashby Direct ATS',
    'Workable Direct ATS',
    'SmartRecruiters Direct ATS',
    'Recruitee Direct ATS',
    ...(enableInternshala ? ['Internshala Jobs'] : []),
    'RemoteOK API',
    'Remotive API',
    'Himalayas API',
    'Arbeitnow Visa Board',
    'TheMuse Public API',
  ];
  if (process.env.RAPIDAPI_KEY) {
    sourcesQueried.push('JSearch API');
  }
  if (process.env.FREEHIRE_API_URL) {
    sourcesQueried.unshift('FreeHire API Endpoint');
  }

  return {
    timestamp: new Date().toISOString(),
    mode: 'live_sweep',
    sources_queried: sourcesQueried,
    source_counts: sourceCounts,
    source_health: sourceHealth,
    persistence_mode: resolvedPersistenceMode,
    warnings,
    total_fetched: rawCombined.length,
    canonical_dedup_saved: canonicalDedupSaved,
    new_after_dedup: unseen.length,
    hard_gate_rejected: Object.values(hardGateReasons).reduce((a, b) => a + b, 0),
    hard_gate_reasons: hardGateReasons,
    evaluated_count: candidatesToScore.length,
    committed_count: committedJobs.length,
    queued_for_retry_count: queuedForRetryCount,
    committed_jobs: committedJobs,
  };
}
