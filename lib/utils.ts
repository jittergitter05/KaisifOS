import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { buildCanonicalJobKey, getSourceUrlPriority } from './eligibility.js';

export { buildCanonicalJobKey, getSourceUrlPriority };

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const SOURCE_FILTER_OPTIONS = [
  'Company Career Page',
  'Workday ATS',
  'Greenhouse ATS',
  'Lever ATS',
  'Ashby ATS',
  'Workable ATS',
  'SmartRecruiters ATS',
  'Recruitee ATS',
  'Webhook / Clipper',
  'FreeHire API',
  'Himalayas',
  'RemoteOK',
  'Remotive',
  'Arbeitnow',
  'TheMuse',
  'Evaluated',
  'JSearch',
  'Internshala',
] as const;

export function detectSource(id: string): string {
  if (id.startsWith('career_')) return 'Company Career Page';
  if (id.startsWith('workday_')) return 'Workday ATS';
  if (id.startsWith('greenhouse_')) return 'Greenhouse ATS';
  if (id.startsWith('lever_')) return 'Lever ATS';
  if (id.startsWith('ashby_')) return 'Ashby ATS';
  if (id.startsWith('workable_')) return 'Workable ATS';
  if (id.startsWith('smartrecruiters_')) return 'SmartRecruiters ATS';
  if (id.startsWith('recruitee_')) return 'Recruitee ATS';
  if (id.startsWith('webhook_') || id.startsWith('clipper_')) return 'Webhook / Clipper';
  if (id.startsWith('freehire_')) return 'FreeHire API';
  if (id.startsWith('himalayas_')) return 'Himalayas';
  if (id.startsWith('arbeitnow_')) return 'Arbeitnow';
  if (id.startsWith('internshala_')) return 'Internshala';
  if (id.startsWith('remoteok_')) return 'RemoteOK';
  if (id.startsWith('remotive_')) return 'Remotive';
  if (id.startsWith('themuse_')) return 'TheMuse';
  if (id.startsWith('eval_') || id.startsWith('manual_')) return 'Evaluated';
  return 'JSearch';
}

/**
 * Validates external job application URLs so only http(s) schemes are rendered as hrefs.
 */
export function safeExternalUrl(rawUrl: string | undefined | null): string {
  if (!rawUrl || typeof rawUrl !== 'string') return '#';
  const trimmed = rawUrl.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return '#';
}

/**
 * Extracts a clean display hostname from an external job apply URL (returns '' if invalid).
 */
export function extractExternalHost(rawUrl: string | undefined | null): string {
  const safe = safeExternalUrl(rawUrl);
  if (safe === '#') return '';
  try {
    return new URL(safe).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * Produces a deterministic canonical fingerprint for deduplicating company + role pairs across boards.
 */
export function normalizeCanonicalFingerprint(
  company: string,
  title: string,
  location?: string
): string {
  return buildCanonicalJobKey(company, title, location);
}

/**
 * Prevents CSV/Excel formula injection (=, +, -, @, \t, \r) on client-exported spreadsheets.
 */
export function sanitizeCsvCell(val: unknown): string {
  const raw = String(val ?? '');
  const trimmed = raw.trimStart();
  const safe = /^[=+\-@\t\r]/.test(raw) || /^[=+\-@\t\r]/.test(trimmed) ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}

/**
 * Validates optional external HTTP/HTTPS endpoints (such as FREEHIRE_API_URL) against SSRF risks.
 */
export function validateSafePublicUrl(
  rawUrl: string,
  options?: { allowLocalDev?: boolean }
): { ok: boolean; url?: URL; reason?: string } {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return { ok: false, reason: 'Invalid URL syntax' };
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, reason: `Disallowed URL scheme: ${parsed.protocol}` };
  }

  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const isLocalHost =
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host.endsWith('.local');

  const isMetadataOrPrivate =
    host === '169.254.169.254' ||
    host === 'metadata.google.internal' ||
    host.startsWith('10.') ||
    host.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
    host.startsWith('fc') ||
    host.startsWith('fd') ||
    host.startsWith('fe80:');

  if (isMetadataOrPrivate || (isLocalHost && !options?.allowLocalDev && process.env.NODE_ENV === 'production')) {
    return { ok: false, reason: `Blocked private or metadata endpoint host: ${host}` };
  }

  if (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:' && !isLocalHost) {
    return { ok: false, reason: 'Production external bridge URLs must use HTTPS' };
  }

  return { ok: true, url: parsed };
}

/**
 * Parses YYYY-MM-DD consistently at local noon to prevent UTC midnight timezone off-by-one drift.
 */
export function parseIsoDateTimestamp(dateStr: string | undefined | null): number {
  if (!dateStr || typeof dateStr !== 'string') return NaN;
  const trimmed = dateStr.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const [y, m, d] = trimmed.split('-').map(Number);
    return new Date(y, m - 1, d, 12, 0, 0).getTime();
  }
  return new Date(trimmed).getTime();
}

/**
 * Iframe-safe & HTTP-safe clipboard copy with hidden textarea fallback.
 */
export async function copyToClipboardSafe(text: string): Promise<boolean> {
  if (!text || typeof document === 'undefined') return false;
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to execCommand fallback (e.g., inside permission-restricted iframes)
  }

  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.top = '-9999px';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

/**
 * Derives dynamic Internshala slugs, RemoteOK tags, and Remotive categories/keywords
 * from any candidate profile (shared between live Next.js scout & CLI scout telemetry).
 */
export function deriveDynamicSearchParams(profile?: {
  target_roles?: string[];
  skills?: string[];
}) {
  const roles =
    Array.isArray(profile?.target_roles) && profile.target_roles.length > 0
      ? profile.target_roles
      : ['Associate Product Manager', 'Product Marketing Manager', 'Growth Manager'];
  const skills = Array.isArray(profile?.skills) ? profile.skills : [];

  const slugSet = new Set<string>();
  for (const role of roles) {
    const lower = role.toLowerCase();
    if (lower.includes('product manager') || lower.includes('apm')) slugSet.add('product-management');
    if (lower.includes('product marketing') || lower.includes('marketing')) slugSet.add('marketing');
    if (lower.includes('digital') || lower.includes('growth') || lower.includes('seo')) {
      slugSet.add('digital-marketing');
    }
    if (lower.includes('content')) slugSet.add('content-writing');
    if (lower.includes('founder') || lower.includes('strategy') || lower.includes('operations')) {
      slugSet.add('operations');
    }
    if (lower.includes('analyst') || lower.includes('data')) slugSet.add('data-science');
    if (
      lower.includes('software') ||
      lower.includes('full-stack') ||
      lower.includes('frontend') ||
      lower.includes('backend')
    ) {
      slugSet.add('software-development');
    }
    if (lower.includes('ai') || lower.includes('machine learning')) slugSet.add('machine-learning');
    const directSlug = lower.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (directSlug && directSlug.length <= 28) slugSet.add(directSlug);
  }

  const remoteOkTags = new Set<string>();
  for (const token of [...roles, ...skills.slice(0, 6)]) {
    const l = token.toLowerCase();
    if (l.includes('marketing') || l.includes('gtm')) remoteOkTags.add('marketing');
    if (l.includes('growth') || l.includes('seo')) remoteOkTags.add('growth');
    if (l.includes('product')) remoteOkTags.add('product');
    if (l.includes('analyst') || l.includes('data') || l.includes('sql') || l.includes('python')) {
      remoteOkTags.add('data');
    }
    if (
      l.includes('engineer') ||
      l.includes('developer') ||
      l.includes('typescript') ||
      l.includes('react') ||
      l.includes('next')
    ) {
      remoteOkTags.add('dev');
    }
    if (l.includes('ai') || l.includes('llm')) remoteOkTags.add('ai');
  }
  if (remoteOkTags.size === 0) {
    remoteOkTags.add('product');
    remoteOkTags.add('marketing');
    remoteOkTags.add('growth');
  }

  const remotiveCategories = new Set<string>();
  for (const r of roles) {
    const l = r.toLowerCase();
    if (l.includes('marketing') || l.includes('growth') || l.includes('content')) {
      remotiveCategories.add('marketing');
    }
    if (l.includes('product') || l.includes('founder')) remotiveCategories.add('product');
    if (l.includes('engineer') || l.includes('developer') || l.includes('software')) {
      remotiveCategories.add('software-dev');
    }
    if (l.includes('data') || l.includes('analyst') || l.includes('machine learning')) {
      remotiveCategories.add('data');
    }
  }
  if (remotiveCategories.size === 0) remotiveCategories.add('product');

  const remotiveKeywords = roles.slice(0, 4).map((r) => r.toLowerCase());
  const workdaySearchTerms = Array.from(
    new Set(
      roles
        .flatMap((r) => r.toLowerCase().split(/\W+/))
        .filter((w) =>
          ['product', 'marketing', 'growth', 'analyst', 'associate', 'founder', 'engineer', 'data'].includes(w)
        )
    )
  ).slice(0, 4);

  return {
    internshalaSlugs: Array.from(slugSet).slice(0, 5),
    remoteOkTags: Array.from(remoteOkTags).slice(0, 5),
    remotiveCategories: Array.from(remotiveCategories).slice(0, 4),
    remotiveKeywords,
    workdaySearchTerms: workdaySearchTerms.length > 0 ? workdaySearchTerms : ['product', 'growth'],
  };
}

/**
 * Canonical skill & role alias dictionary for accurate matching across synonymous phrasings.
 */
export const SKILL_SYNONYMS: Record<string, string[]> = {
  'gtm strategy': ['go-to-market', 'go to market', 'gtm', 'product launch', 'launch strategy'],
  'product marketing': ['pmm', 'product marketing', 'positioning', 'messaging'],
  'growth marketing': ['growth', 'user acquisition', 'plg', 'product-led growth', 'growth loops'],
  seo: ['search engine optimization', 'organic search', 'technical seo', 'programmatic seo'],
  ga4: ['google analytics', 'ga4', 'google analytics 4'],
  'google search console': ['gsc', 'google search console', 'search console'],
  'python eda': ['python eda', 'pandas', 'numpy', 'exploratory data analysis', 'python'],
  python: ['python', 'pandas', 'numpy', 'fastapi', 'django', 'flask'],
  typescript: ['typescript', 'ts'],
  javascript: ['javascript', 'js', 'es6', 'ecmascript'],
  'next.js': ['next.js', 'nextjs', 'next js'],
  react: ['react', 'react.js', 'reactjs'],
  'node.js': ['node.js', 'nodejs', 'express'],
  'tailwind css': ['tailwind', 'tailwindcss', 'tailwind css'],
  postgresql: ['postgresql', 'postgres', 'psql', 'sql'],
  redis: ['redis', 'upstash', 'in-memory cache'],
  sql: ['sql', 'postgresql', 'postgres', 'mysql', 'sqlite', 'bigquery', 'snowflake'],
  'a/b testing': ['a/b testing', 'ab testing', 'experimentation', 'split testing'],
  'ai workflow automation': ['ai workflows', 'llm', 'genai', 'ai automation', 'langchain', 'n8n', 'zapier'],
  'llm orchestration': ['llm', 'langchain', 'langgraph', 'agentic', 'rag', 'openai', 'gemini'],
  'cloudflare workers': ['cloudflare', 'cloudflare workers', 'edge functions'],
  'full-stack prototyping': ['full-stack', 'fullstack', 'full stack', 'prototyping', 'rapid prototyping'],
  docker: ['docker', 'containers', 'containerization'],
  kubernetes: ['kubernetes', 'k8s'],
  pytorch: ['pytorch', 'torch', 'deep learning'],
  'scikit-learn': ['scikit-learn', 'sklearn'],
  dbt: ['dbt', 'data build tool'],
  bigquery: ['bigquery', 'bq', 'gcp bigquery'],
  hubspot: ['hubspot', 'crm', 'salesforce', 'marketo'],
  figma: ['figma', 'wireframing', 'ui design'],
  'mixpanel / amplitude': ['mixpanel', 'amplitude', 'posthog', 'heap'],
};

export const ROLE_SYNONYMS: Record<string, string[]> = {
  'associate product manager': [
    'associate product manager',
    'apm',
    'junior product manager',
    'product manager i',
    'entry level product manager',
  ],
  'product marketing manager': [
    'product marketing manager',
    'pmm',
    'associate product marketing manager',
    'product marketing',
  ],
  'growth manager': ['growth manager', 'growth lead', 'growth marketer', 'head of growth', 'growth marketing manager'],
  "founder's associate": ["founder's associate", 'founders associate', "founder's office", 'chief of staff'],
  'product analyst': ['product analyst', 'product analytics', 'product data analyst'],
  'growth marketing analyst': ['growth marketing analyst', 'growth analyst', 'marketing analyst'],
  'marketing operations analyst': ['marketing operations', 'marketing ops', 'mops', 'revops'],
  'full-stack software engineer': [
    'full-stack engineer',
    'fullstack engineer',
    'full stack developer',
    'software engineer',
    'sde',
    'swe',
  ],
  'ai application engineer': [
    'ai engineer',
    'ai application engineer',
    'applied ai engineer',
    'llm engineer',
    'genai engineer',
  ],
  'frontend systems engineer': ['frontend engineer', 'front-end engineer', 'ui engineer', 'frontend developer'],
  'data scientist': ['data scientist', 'applied scientist', 'decision scientist'],
  'machine learning engineer': ['machine learning engineer', 'ml engineer', 'mle'],
};

/**
 * Derives canonical 4-Pillar subscores (Role 40 / Skill 30 / Seniority 15 / CompGeo 15)
 * whose sum always equals the stored job score cleanly.
 */
export function deriveJobPillarBreakdown(job: { score: number; reasons?: string }) {
  const s = Math.min(100, Math.max(0, Math.round(Number(job.score) || 0)));
  const reasonsText = job.reasons || '';

  const roleExplicit = reasonsText.match(/(\d{1,2})\/40/);
  const skillExplicit = reasonsText.match(/(\d{1,2})\/30/);
  const senExplicit =
    reasonsText.match(/(\d{1,2})\/15\s*(?:pts?\s*)?(?:Seniority|&)/i) ||
    reasonsText.match(/Seniority[^()]*\((\d{1,2})\/15/i);
  const compExplicit =
    reasonsText.match(/(\d{1,2})\/15\s*(?:pts?\s*)?(?:Comp|Location)/i) ||
    reasonsText.match(/(?:Comp|Location)[^()]*\((\d{1,2})\/15/i);

  const isExact = Boolean(roleExplicit && skillExplicit && senExplicit && compExplicit);

  let role = roleExplicit
    ? Math.min(40, Math.max(0, parseInt(roleExplicit[1], 10)))
    : Math.min(40, Math.round(s * 0.4));
  let skill = skillExplicit
    ? Math.min(30, Math.max(0, parseInt(skillExplicit[1], 10)))
    : Math.min(30, Math.round(s * 0.3));
  let seniority = senExplicit
    ? Math.min(15, Math.max(0, parseInt(senExplicit[1], 10)))
    : Math.min(15, Math.round(s * 0.15));
  let compGeo = compExplicit
    ? Math.min(15, Math.max(0, parseInt(compExplicit[1], 10)))
    : Math.min(15, Math.max(0, s - role - skill - seniority));

  const diff = s - (role + skill + seniority + compGeo);
  if (diff !== 0) {
    if (diff > 0) {
      const addComp = Math.min(diff, 15 - compGeo);
      compGeo += addComp;
      const rem1 = diff - addComp;
      const addSen = Math.min(rem1, 15 - seniority);
      seniority += addSen;
      const rem2 = rem1 - addSen;
      const addSkill = Math.min(rem2, 30 - skill);
      skill += addSkill;
      role = Math.min(40, role + (rem2 - addSkill));
    } else {
      let toSub = -diff;
      const subComp = Math.min(toSub, compGeo);
      compGeo -= subComp;
      toSub -= subComp;
      const subSen = Math.min(toSub, seniority);
      seniority -= subSen;
      toSub -= subSen;
      const subSkill = Math.min(toSub, skill);
      skill -= subSkill;
      toSub -= subSkill;
      role = Math.max(0, role - toSub);
    }
  }

  return {
    isExact,
    role: { earned: role, max: 40, label: 'Role & Charter Affinity' },
    skill: { earned: skill, max: 30, label: 'Skill & Quantified Proof Overlap' },
    seniority: { earned: seniority, max: 15, label: 'Seniority & Tenure Calibration' },
    compGeo: { earned: compGeo, max: 15, label: 'Compensation Floor & Geo/Relo Fit' },
  };
}

/**
 * Extracts intro context plus high-signal requirements, experience, compensation,
 * and visa/location segments so LLM evaluation does not miss bottom-of-JD constraints.
 */
export function extractHighSignalJdContext(description: string, maxLen = 3500): string {
  const clean = (description || '').replace(/\s+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (clean.length <= maxLen) return clean;

  const introBudget = Math.min(800, Math.floor(maxLen * 0.28));
  const intro = clean.slice(0, introBudget);
  const rest = clean.slice(introBudget);

  const chunks = rest
    .split(/\n+|(?<=[.!?])\s+/)
    .map((c) => c.trim())
    .filter((c) => c.length > 15);

  const highSignalRegex =
    /\b(require|qualification|must have|experience|years?|yrs?|senior|junior|entry|fresher|salary|compensation|lpa|ctc|ote|equity|\$\d|₹\d|€\d|£\d|visa|sponsor|sponsorship|opt|stem|authorization|authorized|citizen|reside|resident|metro|bay area|new york|nyc|seattle|san francisco|hyderabad|india|401k|401\(?k\)?|e-?verify|w-?2|pst|est|cet|travel|in-person|relocation|remote|hybrid|location|responsibilities|stack|skills?|bonus|stipend|package)\b/i;

  const priority = chunks.filter((c) => highSignalRegex.test(c));
  const selected: string[] = [];
  let len = intro.length;

  for (const chunk of priority) {
    if (len + chunk.length + 3 > maxLen) break;
    selected.push(chunk);
    len += chunk.length + 3;
  }

  if (selected.length === 0) {
    return clean.slice(0, maxLen);
  }

  return `${intro}\n...\n${selected.join(' | ')}`.slice(0, maxLen);
}

/**
 * Parses LLM JSON responses cleanly even when wrapped in markdown fences or extra prose.
 */
export function parseLooseJSON<T = Record<string, unknown>>(rawText: string): T | null {
  if (!rawText || typeof rawText !== 'string') return null;
  const trimmed = rawText
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      const candidate = trimmed
        .slice(firstBrace, lastBrace + 1)
        .replace(/,\s*([}\]])/g, '$1');
      try {
        return JSON.parse(candidate) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}
