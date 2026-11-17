import { validateSafePublicUrl } from './utils';

export interface ScrapedCareerJob {
  id: string;
  title: string;
  company: string;
  location: string;
  salary: string;
  description: string;
  url: string;
  source: string;
}

export interface CareerFetchResult {
  jobs: ScrapedCareerJob[];
  failedBoards: string[];
  truncatedBoards: number;
}

const MAX_BOARDS_PER_SOURCE = 12;

function stripHtml(html: string): string {
  if (!html) return '';
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function slugToTitleCase(slug: string): string {
  return slug
    .replace(/[-_]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function stableShortHash(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function inferCompanyFromUrl(rawUrl: string): string {
  try {
    const host = new URL(rawUrl).hostname.replace(/^www\./, '');
    const parts = host.split('.');
    const root = parts.length >= 2 && /^(careers|jobs|apply)$/i.test(parts[0]) ? parts[1] : parts[0];
    return slugToTitleCase(root || 'Company');
  } catch {
    return 'Company';
  }
}

export function detectEmbeddedAtsBoards(html: string): {
  greenhouse: string[];
  lever: string[];
  ashby: string[];
  workable: string[];
  smartrecruiters: string[];
  recruitee: string[];
} {
  const gh = new Set<string>();
  const lv = new Set<string>();
  const ash = new Set<string>();
  const wk = new Set<string>();
  const sr = new Set<string>();
  const rc = new Set<string>();

  for (const m of html.matchAll(/boards(?:-api)?\.greenhouse\.io\/(?:v1\/boards\/)?([a-z0-9_-]+)/gi)) {
    if (m[1] && !['embed', 'v1', 'assets'].includes(m[1].toLowerCase())) gh.add(m[1].toLowerCase());
  }
  for (const m of html.matchAll(/(?:jobs|api)\.lever\.co\/(?:v0\/postings\/)?([a-z0-9_-]+)/gi)) {
    if (m[1] && !['v0', 'assets'].includes(m[1].toLowerCase())) lv.add(m[1].toLowerCase());
  }
  for (const m of html.matchAll(/jobs\.ashbyhq\.com\/([a-z0-9_-]+)/gi)) {
    if (m[1]) ash.add(m[1].toLowerCase());
  }
  for (const m of html.matchAll(/apply\.workable\.com\/(?:api\/v[13]\/widget\/accounts\/)?([a-z0-9_-]+)/gi)) {
    if (m[1] && !['api', 'j', 'assets'].includes(m[1].toLowerCase())) wk.add(m[1].toLowerCase());
  }
  for (const m of html.matchAll(/(?:jobs|careers)\.smartrecruiters\.com\/([a-z0-9_-]+)/gi)) {
    if (m[1]) sr.add(m[1]);
  }
  for (const m of html.matchAll(/([a-z0-9-]+)\.recruitee\.com/gi)) {
    if (m[1] && m[1].toLowerCase() !== 'www') rc.add(m[1].toLowerCase());
  }

  return {
    greenhouse: Array.from(gh),
    lever: Array.from(lv),
    ashby: Array.from(ash),
    workable: Array.from(wk),
    smartrecruiters: Array.from(sr),
    recruitee: Array.from(rc),
  };
}

export function extractJsonLdJobPostings(
  html: string,
  baseUrl: string,
  fallbackCompany?: string
): ScrapedCareerJob[] {
  const jobs: ScrapedCareerJob[] = [];
  const companyFallback = fallbackCompany || inferCompanyFromUrl(baseUrl);
  const scriptRegex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

  for (const match of html.matchAll(scriptRegex)) {
    const rawJson = (match[1] || '').trim();
    if (!rawJson) continue;
    try {
      const parsed: unknown = JSON.parse(rawJson);
      const candidates: Array<Record<string, any>> = [];
      const collect = (node: unknown) => {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) {
          node.forEach(collect);
          return;
        }
        const obj = node as Record<string, any>;
        if (Array.isArray(obj['@graph'])) {
          obj['@graph'].forEach(collect);
        }
        const typeVal = obj['@type'];
        const isJob =
          typeVal === 'JobPosting' ||
          (Array.isArray(typeVal) && typeVal.includes('JobPosting'));
        if (isJob) candidates.push(obj);
      };
      collect(parsed);

      for (const item of candidates.slice(0, 15)) {
        const title = String(item.title || '').trim();
        if (!title) continue;
        const company = String(item.hiringOrganization?.name || companyFallback).trim();
        let resolvedUrl = baseUrl;
        const rawApplyUrl = item.url || item.sameAs || item.applicationContact?.url;
        if (typeof rawApplyUrl === 'string' && rawApplyUrl.trim()) {
          try {
            resolvedUrl = new URL(rawApplyUrl.trim(), baseUrl).toString();
          } catch {
            resolvedUrl = baseUrl;
          }
        }

        let location = 'Remote / Hybrid';
        const locObj = Array.isArray(item.jobLocation) ? item.jobLocation[0] : item.jobLocation;
        const addr = locObj?.address;
        if (addr && typeof addr === 'object') {
          const parts = [addr.addressLocality, addr.addressRegion, addr.addressCountry]
            .map((x) => String(x || '').trim())
            .filter(Boolean);
          if (parts.length > 0) location = parts.join(', ');
        } else if (item.jobLocationType === 'TELECOMMUTE') {
          location = 'Remote';
        }

        let salary = 'Direct Career Page';
        const salVal = item.baseSalary?.value;
        if (salVal?.minValue || salVal?.value) {
          const cur = item.baseSalary?.currency || '';
          const minV = salVal.minValue ?? salVal.value;
          const maxV = salVal.maxValue ? ` - ${salVal.maxValue}` : '';
          salary = `${cur} ${minV}${maxV}`.trim();
        }

        jobs.push({
          id: `career_${stableShortHash(`${resolvedUrl}::${title}`)}`,
          title,
          company,
          location,
          salary,
          description: stripHtml(String(item.description || `${title} at ${company}`)).substring(0, 1200),
          url: resolvedUrl,
          source: 'Company Career Page',
        });
      }
    } catch {
      // Ignore malformed JSON-LD script blocks
    }
  }

  return jobs;
}

export function extractCareerPageAnchors(
  html: string,
  baseUrl: string,
  fallbackCompany?: string
): ScrapedCareerJob[] {
  const jobs: ScrapedCareerJob[] = [];
  const seenUrls = new Set<string>();
  const company = fallbackCompany || inferCompanyFromUrl(baseUrl);
  const anchorRegex = /<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;

  for (const match of html.matchAll(anchorRegex)) {
    const rawHref = (match[1] || '').trim();
    const label = stripHtml(match[2] || '').trim();
    if (!rawHref || !label || label.length < 6 || label.length > 110) continue;
    if (/^(view all|see all|learn more|read more|home|about|login|sign in|privacy|terms|apply now)$/i.test(label)) {
      continue;
    }

    let absUrl = '';
    try {
      absUrl = new URL(rawHref, baseUrl).toString();
    } catch {
      continue;
    }

    if (!/^https?:\/\//i.test(absUrl)) continue;
    const isJobPath = /\/(job|jobs|career|careers|opening|openings|position|positions|role|roles)\/[^/?#]+/i.test(
      absUrl
    );
    const hasRoleWords = /\b(manager|engineer|developer|analyst|designer|associate|lead|intern|specialist|scientist|architect|product|marketing|growth|founder)\b/i.test(
      label
    );

    if (!isJobPath || !hasRoleWords || seenUrls.has(absUrl)) continue;
    seenUrls.add(absUrl);

    jobs.push({
      id: `career_${stableShortHash(absUrl)}`,
      title: label,
      company,
      location: 'Direct Career Portal',
      salary: 'Direct Career Page',
      description: `${label} opening listed on ${company} official careers page (${absUrl}).`,
      url: absUrl,
      source: 'Company Career Page',
    });

    if (jobs.length >= 10) break;
  }

  return jobs;
}

export async function fetchWorkableBoards(boards: string[]): Promise<CareerFetchResult> {
  const results: ScrapedCareerJob[] = [];
  const failedBoards: string[] = [];
  const activeBoards = boards.slice(0, MAX_BOARDS_PER_SOURCE);
  const truncatedBoards = Math.max(0, boards.length - activeBoards.length);

  await Promise.all(
    activeBoards.map(async (board) => {
      try {
        const res = await fetch(
          `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(board)}`,
          { signal: AbortSignal.timeout(6500) }
        );
        if (!res.ok) {
          failedBoards.push(`${board} (${res.status})`);
          return;
        }
        const data = await res.json();
        const companyName = String(data.name || slugToTitleCase(board));
        for (const job of (data.jobs || []).slice(0, 8)) {
          const loc =
            [job.city, job.country].filter(Boolean).join(', ') ||
            (job.telecommuting ? 'Remote' : 'Flexible');
          const applyUrl =
            job.url ||
            job.application_url ||
            `https://apply.workable.com/${encodeURIComponent(board)}/j/${job.shortcode || job.id}/`;
          results.push({
            id: `workable_${board}_${job.shortcode || job.id}`,
            title: String(job.title || ''),
            company: companyName,
            location: loc,
            salary: 'Direct ATS Band',
            description: stripHtml(
              `${job.title} (${job.department || 'General'}) at ${companyName}. ${
                job.telecommuting ? 'Remote eligible.' : ''
              }`
            ),
            url: String(applyUrl),
            source: 'Workable',
          });
        }
      } catch (err) {
        failedBoards.push(`${board} (${(err as Error).message.slice(0, 24)})`);
      }
    })
  );

  return { jobs: results, failedBoards, truncatedBoards };
}

export async function fetchSmartRecruitersBoards(boards: string[]): Promise<CareerFetchResult> {
  const results: ScrapedCareerJob[] = [];
  const failedBoards: string[] = [];
  const activeBoards = boards.slice(0, MAX_BOARDS_PER_SOURCE);
  const truncatedBoards = Math.max(0, boards.length - activeBoards.length);

  await Promise.all(
    activeBoards.map(async (board) => {
      try {
        const res = await fetch(
          `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(board)}/postings?limit=10`,
          { signal: AbortSignal.timeout(6500) }
        );
        if (!res.ok) {
          failedBoards.push(`${board} (${res.status})`);
          return;
        }
        const data = await res.json();
        for (const job of (data.content || []).slice(0, 8)) {
          const companyName = String(job.company?.name || slugToTitleCase(board));
          const loc =
            [job.location?.city, job.location?.country].filter(Boolean).join(', ') ||
            (job.location?.remote ? 'Remote' : 'Hybrid / On-site');
          const applyUrl = `https://jobs.smartrecruiters.com/${encodeURIComponent(
            job.company?.identifier || board
          )}/${job.id}`;
          results.push({
            id: `smartrecruiters_${board}_${job.id}`,
            title: String(job.name || ''),
            company: companyName,
            location: loc,
            salary: 'Direct ATS Band',
            description: `${job.name} in ${job.department?.label || 'Product & Tech'} at ${companyName}. Location: ${loc}.`,
            url: applyUrl,
            source: 'SmartRecruiters',
          });
        }
      } catch (err) {
        failedBoards.push(`${board} (${(err as Error).message.slice(0, 24)})`);
      }
    })
  );

  return { jobs: results, failedBoards, truncatedBoards };
}

export async function fetchRecruiteeBoards(boards: string[]): Promise<CareerFetchResult> {
  const results: ScrapedCareerJob[] = [];
  const failedBoards: string[] = [];
  const activeBoards = boards.slice(0, MAX_BOARDS_PER_SOURCE);
  const truncatedBoards = Math.max(0, boards.length - activeBoards.length);

  await Promise.all(
    activeBoards.map(async (board) => {
      try {
        const cleanSlug = board.replace(/[^a-z0-9-]/gi, '').toLowerCase();
        if (!cleanSlug) return;
        const res = await fetch(`https://${cleanSlug}.recruitee.com/api/offers`, {
          signal: AbortSignal.timeout(6500),
        });
        if (!res.ok) {
          failedBoards.push(`${cleanSlug} (${res.status})`);
          return;
        }
        const data = await res.json();
        for (const job of (data.offers || []).slice(0, 8)) {
          const companyName = String(job.company_name || slugToTitleCase(cleanSlug));
          const loc = job.location || (job.remote ? 'Remote' : 'Hybrid');
          const applyUrl =
            job.careers_url ||
            job.careers_apply_url ||
            `https://${cleanSlug}.recruitee.com/o/${job.slug || job.id}`;
          results.push({
            id: `recruitee_${cleanSlug}_${job.id}`,
            title: String(job.title || ''),
            company: companyName,
            location: String(loc),
            salary: job.min_salary
              ? `${job.salary_currency || ''} ${job.min_salary}${
                  job.max_salary ? ` - ${job.max_salary}` : ''
                }`.trim()
              : 'Direct ATS Band',
            description: stripHtml(job.description || `${job.title} at ${companyName}`).substring(0, 1200),
            url: String(applyUrl),
            source: 'Recruitee',
          });
        }
      } catch (err) {
        failedBoards.push(`${board} (${(err as Error).message.slice(0, 24)})`);
      }
    })
  );

  return { jobs: results, failedBoards, truncatedBoards };
}

export async function fetchCompanyCareerPages(careerUrls: string[]): Promise<CareerFetchResult> {
  const results: ScrapedCareerJob[] = [];
  const failedBoards: string[] = [];
  const activeUrls = careerUrls.slice(0, 10);
  const truncatedBoards = Math.max(0, careerUrls.length - activeUrls.length);

  await Promise.all(
    activeUrls.map(async (rawUrl) => {
      const check = validateSafePublicUrl(rawUrl, { allowLocalDev: false });
      if (!check.ok || !check.url) {
        failedBoards.push(`${rawUrl} (${check.reason || 'blocked'})`);
        return;
      }

      try {
        const res = await fetch(check.url.toString(), {
          headers: {
            'User-Agent': 'KaisifOS-CareerCrawler/1.0 (+https://github.com)',
            Accept: 'text/html,application/xhtml+xml',
          },
          signal: AbortSignal.timeout(7000),
        });
        if (!res.ok) {
          failedBoards.push(`${check.url.hostname} (${res.status})`);
          return;
        }
        const html = await res.text();
        const companyName = inferCompanyFromUrl(check.url.toString());

        const ldJobs = extractJsonLdJobPostings(html, check.url.toString(), companyName);
        if (ldJobs.length > 0) {
          results.push(...ldJobs);
          return;
        }

        const embedded = detectEmbeddedAtsBoards(html);
        if (embedded.workable.length > 0) {
          const wkRes = await fetchWorkableBoards(embedded.workable.slice(0, 2));
          results.push(...wkRes.jobs);
        }
        if (embedded.recruitee.length > 0) {
          const rcRes = await fetchRecruiteeBoards(embedded.recruitee.slice(0, 2));
          results.push(...rcRes.jobs);
        }

        const anchorJobs = extractCareerPageAnchors(html, check.url.toString(), companyName);
        if (anchorJobs.length > 0) {
          results.push(...anchorJobs);
        }
      } catch (err) {
        failedBoards.push(`${check.url.hostname} (${(err as Error).message.slice(0, 24)})`);
      }
    })
  );

  return { jobs: results, failedBoards, truncatedBoards };
}
