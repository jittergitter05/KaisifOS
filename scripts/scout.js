import fs from 'fs';
import path from 'path';
import { google } from 'googleapis';
import Groq from 'groq-sdk';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const delay = (ms) => new Promise((res) => setTimeout(res, ms));

export const stripHtmlTags = (input) => {
  if (!input) return '';
  let output = input;
  let previous;
  do {
    previous = output;
    output = output.replace(/<[^>]*>/g, '');
  } while (output !== previous);
  return output;
};

/**
 * Dynamically derives Internshala slugs, RemoteOK tags, and Remotive search terms
 * directly from data/profile.json (zero hardcoded role lists).
 */
export function deriveDynamicSearchParams(profile) {
  const roles = Array.isArray(profile?.target_roles) && profile.target_roles.length > 0
    ? profile.target_roles
    : ['Associate Product Manager', 'Product Marketing Manager', 'Growth Manager'];
  const skills = Array.isArray(profile?.skills) ? profile.skills : [];

  // 1. Internshala URL slugs derived from target_roles
  const slugSet = new Set();
  for (const role of roles) {
    const lower = role.toLowerCase();
    if (lower.includes('product manager') || lower.includes('apm')) slugSet.add('product-management');
    if (lower.includes('product marketing') || lower.includes('marketing')) slugSet.add('marketing');
    if (lower.includes('digital') || lower.includes('growth') || lower.includes('seo')) slugSet.add('digital-marketing');
    if (lower.includes('content')) slugSet.add('content-writing');
    if (lower.includes('founder') || lower.includes('strategy') || lower.includes('operations')) slugSet.add('operations');
    if (lower.includes('analyst') || lower.includes('data')) slugSet.add('data-science');
    if (lower.includes('software') || lower.includes('full-stack') || lower.includes('frontend') || lower.includes('backend')) {
      slugSet.add('software-development');
    }
    if (lower.includes('ai') || lower.includes('machine learning')) slugSet.add('machine-learning');
    // Also add direct slugified role if concise
    const directSlug = lower.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (directSlug && directSlug.length <= 28) slugSet.add(directSlug);
  }

  // 2. RemoteOK tags derived from target_roles + skills
  const remoteOkTags = new Set();
  for (const token of [...roles, ...skills.slice(0, 5)]) {
    const l = token.toLowerCase();
    if (l.includes('marketing') || l.includes('gtm')) remoteOkTags.add('marketing');
    if (l.includes('growth') || l.includes('seo')) remoteOkTags.add('growth');
    if (l.includes('product')) remoteOkTags.add('product');
    if (l.includes('analyst') || l.includes('data') || l.includes('sql') || l.includes('python')) remoteOkTags.add('data');
    if (l.includes('engineer') || l.includes('developer') || l.includes('typescript') || l.includes('react')) remoteOkTags.add('dev');
    if (l.includes('ai') || l.includes('llm')) remoteOkTags.add('ai');
  }
  if (remoteOkTags.size === 0) {
    remoteOkTags.add('product');
    remoteOkTags.add('marketing');
    remoteOkTags.add('growth');
  }

  // 3. Remotive categories + dynamic search queries
  const remotiveCategories = new Set();
  for (const r of roles) {
    const l = r.toLowerCase();
    if (l.includes('marketing') || l.includes('growth') || l.includes('content')) remotiveCategories.add('marketing');
    if (l.includes('product') || l.includes('founder')) remotiveCategories.add('product');
    if (l.includes('engineer') || l.includes('developer') || l.includes('software')) remotiveCategories.add('software-dev');
    if (l.includes('data') || l.includes('analyst') || l.includes('machine learning')) remotiveCategories.add('data');
  }
  if (remotiveCategories.size === 0) remotiveCategories.add('product');

  const remotiveKeywords = roles.slice(0, 4).map((r) => r.toLowerCase());

  return {
    internshalaSlugs: Array.from(slugSet).slice(0, 5),
    remoteOkTags: Array.from(remoteOkTags).slice(0, 5),
    remotiveCategories: Array.from(remotiveCategories).slice(0, 4),
    remotiveKeywords,
  };
}

// ─── PROMPT GENERATOR ────────────────────────────────────────────────────────

function extractHighSignalJdForScout(rawDesc, maxLen = 1400) {
  const clean = String(rawDesc || '').trim();
  if (clean.length <= maxLen) return clean;
  const intro = clean.slice(0, 500);
  const chunks = clean
    .slice(500)
    .split(/\n+|(?<=[.!?])\s+/)
    .map((c) => c.trim())
    .filter((c) => c.length > 15);
  const priority = chunks.filter((c) =>
    /\b(require|qualification|must|experience|years?|yrs?|senior|junior|entry|fresher|salary|compensation|lpa|ctc|\$\d|visa|sponsor|relocation|remote|skills?)\b/i.test(c)
  );
  const picked = [];
  let len = intro.length;
  for (const chunk of priority) {
    if (len + chunk.length + 3 > maxLen) break;
    picked.push(chunk);
    len += chunk.length + 3;
  }
  return picked.length > 0 ? `${intro} ... ${picked.join(' | ')}` : clean.slice(0, maxLen);
}

export function buildPrompt(job, profile) {
  const desc = extractHighSignalJdForScout(job.description || '', 1400);
  const location = job.location || 'Not specified';
  const salaryInfo = job.salary_min
    ? `Min salary: ${job.salary_min} ${job.salary_max ? `- ${job.salary_max}` : ''}`
    : 'Salary: Not listed';

  const expYears = profile.experience_years ?? 0;
  const isFresher = expYears === 0;

  // Relocation logic based on profile
  const willRelocate = profile.open_to_relocation;
  const targetCities = (profile.target_cities || []).join(', ');
  let locationRule = '';
  if (willRelocate) {
    locationRule = `4. Comp & Location (15 pts): Candidate is open to relocation globally (especially ${profile.relocation_preference?.preferred_regions?.join(', ')}). Min salary ₹${profile.min_salary_lpa} LPA India or $${profile.min_salary_usd_annual || 30000} USD abroad. Give full 15/15 for remote or relo/visa-supported roles meeting salary floor; 0–5 if visa is forbidden or below floor.`;
  } else {
    locationRule = `4. Comp & Location (15 pts): MUST be located in ${targetCities} (on-site/hybrid) or fully remote and meet ₹${profile.min_salary_lpa} LPA / $${profile.min_salary_usd_annual || 30000} USD. Give 0–4/15 for other locations or below floor.`;
  }

  // Experience logic
  let expRule = '';
  let hardExpRule = '';
  if (isFresher) {
    expRule = `3. Seniority & Experience match (15 pts): Candidate is a FRESHER (0 full-time years). Full marks only if the role is entry-level, junior, associate, or open to freshers. Score <=5/15 if it requires 3+ years or Senior/Director titles.`;
    hardExpRule = `- DO NOT score above 48 total if the role explicitly requires 2+ years of experience.`;
  } else {
    expRule = `3. Seniority & Experience match (15 pts): Candidate has ${expYears} years of experience. Score based on how well this matches the role's requirements.`;
    hardExpRule = `- DO NOT score above 48 total if the role requires significantly more experience than ${expYears} years.`;
  }

  return `You are a recruiting AI. Score this job for this specific candidate using the 100-point 4-pillar rubric.
Return ONLY valid JSON. No markdown. No explanation. No code fences.
CRITICAL: NEVER invent candidate metrics or years not listed below. Evaluate evidence before assigning score.

CANDIDATE:
Name: ${profile.name}
Target Roles: ${(profile.target_roles || []).join(', ')}
Base: ${targetCities}
Experience: ${profile.experience_level} — ${expYears} years
Key Metrics: ${(profile.key_metrics || []).join(' | ')}
Skills: ${(profile.skills || []).join(', ')}
Min Salary: ₹${profile.min_salary_lpa} LPA India / $${profile.min_salary_usd_annual || 30000} USD abroad

JOB:
Title: ${job.title}
Company: ${job.company?.display_name || 'Unknown'}
Location: ${location}
${salaryInfo}
Description: ${desc}

SCORING RULES (4 PILLARS SUMMING TO 0–100):
1. Role Affinity (40 pts): How well does the title/description match ${(profile.target_roles || []).slice(0, 4).join('/')}?
2. Skill & Proof Coverage (30 pts): Overlap with candidate's skills (${(profile.skills || []).slice(0, 8).join(', ')}) and quantified proof metrics.
${expRule}
${locationRule}

HARD RULES:
${hardExpRule}
- DO score below 40 for: clearly unrelated domain (law, medicine, facilities, unrelated trades), or irrelevant seniority.

Return exactly:
{
  "match_reasons": ["reason 1 (xx/40 Role)", "reason 2 (xx/30 Skill)", "reason 3 (xx/15 Seniority · xx/15 Comp/Geo)"],
  "gap": "one line on the biggest risk or weakness for this specific role",
  "score": <integer 0-100 matching sum of 4 pillars>,
  "dm_draft": "3-sentence LinkedIn DM opening with the strongest matching metric from candidate profile",
  "resume_angle": "which specific candidate metric to lead with for THIS role",
  "relocation_note": "brief note on relocation/accommodation situation for this role, or 'N/A if local'"
}`;
}

// ─── DETERMINISTIC 4-PILLAR RUBRIC ENGINE (ZERO-KEY FALLBACK) ────────────────

function escapeRegExp(str) {
  return String(str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasWholeToken(text, token) {
  const clean = String(token || '').trim();
  if (!clean) return false;
  return new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(clean)}(?:$|[^a-z0-9])`, 'i').test(text);
}

const SCOUT_ROLE_STOP_WORDS = new Set([
  'manager', 'associate', 'lead', 'analyst', 'engineer', 'developer', 'specialist',
  'coordinator', 'head', 'director', 'senior', 'junior', 'intern', 'executive',
  'officer', 'team', 'member', 'staff', 'principal', 'operations', 'strategy',
]);

function sanitizeSheetCell(val, maxLen = 2000) {
  const raw = String(val ?? '').slice(0, maxLen);
  const str = raw.trim();
  return /^[=+\-@\t\r]/.test(raw) || /^[=+\-@\t\r]/.test(str) ? `'${str}` : str;
}

export function scoreJobDeterministic(job, profile) {
  const fullText = `${job.title || ''} ${job.description || ''} ${job.location || ''}`.toLowerCase();
  const titleLower = (job.title || '').toLowerCase();
  const roles = profile.target_roles || [];
  const skills = profile.skills || [];

  let roleScore = 8;
  const exactMatched = roles.filter((r) => hasWholeToken(titleLower, r.toLowerCase()));
  const domainMatched = roles.filter((r) => {
    const words = r
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length >= 3 && !SCOUT_ROLE_STOP_WORDS.has(w));
    if (words.length === 0) return hasWholeToken(titleLower, r.toLowerCase());
    const hits = words.filter((w) => hasWholeToken(titleLower, w)).length;
    return words.length === 1 ? hits === 1 : hits >= Math.min(2, words.length);
  });
  const matchedRoles = exactMatched.length > 0 ? exactMatched : domainMatched;

  if (exactMatched.length >= 2) roleScore = 38;
  else if (exactMatched.length === 1) roleScore = 36;
  else if (domainMatched.length >= 2) roleScore = 34;
  else if (domainMatched.length === 1) roleScore = 31;
  else if (
    /\b(product|marketing|growth|founder|analytics|gtm)\b/i.test(titleLower) &&
    roles.some((r) => /(product|marketing|growth|founder|analyst|gtm)/i.test(r))
  ) {
    roleScore = 24;
  } else if (
    /\b(software|engineer|developer|data|ai|ml|frontend|backend)\b/i.test(titleLower) &&
    roles.some((r) => /(engineer|developer|scientist|data|ai|ml)/i.test(r))
  ) {
    roleScore = 24;
  }

  const matchedSkills = skills.filter((s) => {
    const sLower = s.toLowerCase();
    if (hasWholeToken(fullText, sLower)) return true;
    const tokens = sLower
      .split(/[\s/&]+/)
      .filter((w) => w.length >= 3 && !SCOUT_ROLE_STOP_WORDS.has(w));
    return tokens.length > 0 && tokens.every((w) => hasWholeToken(fullText, w));
  });
  const skillDenom = Math.max(3, Math.min(6, skills.length || 3));
  const skillScore =
    matchedSkills.length === 0
      ? 4
      : Math.min(30, Math.max(8, Math.round(8 + Math.min(1, matchedSkills.length / skillDenom) * 22)));

  const candidateYears = profile.experience_years ?? 0;
  const nonReqYearsRegex =
    /\b\d{1,2}\+?\s*years?\s+(?:in\s+business|of\s+history|old|ago|strong|legacy|founded|operating|market\s+presence)\b/gi;
  let requiredYears = null;
  for (const rawSentence of fullText.split(/[\n.!?;]+/)) {
    const cleanedSentence = rawSentence.replace(nonReqYearsRegex, '').trim();
    if (!cleanedSentence) continue;
    const yearsMatches = [
      ...cleanedSentence.matchAll(/\b(\d{1,2})\s*(?:[-–to]+\s*(\d{1,2}))?\s*\+?\s*(?:years?|yrs?)\b/gi),
    ];
    for (const m of yearsMatches) {
      const minY = parseInt(m[1], 10);
      if (Number.isFinite(minY) && minY <= 25) {
        requiredYears = requiredYears === null ? minY : Math.max(requiredYears, minY);
      }
    }
  }

  let seniorityScore = 13;
  if (
    /\b(director|vp|vice president|principal|head of|chief|staff)\b/i.test(titleLower) ||
    (/\b(senior|sr\.?|lead)\b/i.test(titleLower) && candidateYears < 2) ||
    (requiredYears !== null && requiredYears >= candidateYears + 3)
  ) {
    seniorityScore = 3;
  } else if (
    (/\b(senior|sr\.?|lead)\b/i.test(titleLower) && candidateYears < 4) ||
    (requiredYears !== null && requiredYears > candidateYears + 1)
  ) {
    seniorityScore = 7;
  } else if (/\b(fresher|entry[- ]level|associate|junior|0-1|0-2|new grad|graduate|intern)\b/i.test(fullText)) {
    seniorityScore = candidateYears <= 2 ? 15 : 13;
  } else if (candidateYears > 0) {
    seniorityScore = 14;
  }

  const locLower = (job.location || '').toLowerCase();
  const isTargetLoc =
    (profile.target_cities || []).some((c) => hasWholeToken(locLower, c.toLowerCase())) ||
    /\b(remote|worldwide|bengaluru|bangalore|hyderabad|dubai|singapore|london|global)\b/i.test(locLower);
  const forbidsVisa = /no visa|no sponsorship|without sponsorship|us citizens only/i.test(fullText);

  let compGeoScore = forbidsVisa && !isTargetLoc ? 5 : isTargetLoc ? 14 : profile.open_to_relocation ? 12 : 7;
  if (job.salary_min && Number(job.salary_min) > 0) {
    const minUsd = profile.min_salary_usd_annual || 30000;
    const annual = Number(job.salary_min) < 500 ? Number(job.salary_min) * 1000 : Number(job.salary_min);
    compGeoScore = Math.min(15, Math.max(2, annual >= minUsd ? compGeoScore + 1 : compGeoScore - 4));
  } else {
    const lpaDesc = fullText.match(/(\d+(?:\.\d+)?)\s*(?:[-–to]+\s*(\d+(?:\.\d+)?))?\s*lpa\b/i);
    const inrDesc = fullText.match(/(?:₹|inr\s*|rs\.?\s*)(\d+(?:,\d{2,3})*(?:\.\d+)?)\s*(k|lakh|lakhs)?\s*(\/\s*(?:mo|month|mth)|per\s+month)?/i);
    const fxDesc = fullText.match(/(?:(\$|usd\s*)|(€|eur\s*)|(£|gbp\s*))(\d+(?:,\d{3})*(?:\.\d+)?)\s*(k)?\s*(\/\s*(?:hr|hour|mo|month)|per\s+(?:hour|month))?/i);
    if (lpaDesc) {
      const low = parseFloat(lpaDesc[1]);
      const high = lpaDesc[2] ? parseFloat(lpaDesc[2]) : low;
      const lpa = (low + high) / 2;
      compGeoScore = Math.min(15, Math.max(2, lpa >= (profile.min_salary_lpa || 8) ? compGeoScore + 1 : compGeoScore - 4));
    } else if (inrDesc) {
      let val = parseFloat(inrDesc[1].replace(/,/g, ''));
      if (inrDesc[2]?.toLowerCase() === 'k') val *= 1000;
      else if (inrDesc[2]?.toLowerCase().startsWith('lakh')) val *= 100000;
      const annualInr = inrDesc[3] ? val * 12 : val;
      const lpa = annualInr >= 100000 ? annualInr / 100000 : inrDesc[3] ? (val * 12) / 100000 : val;
      if (lpa >= 1 && lpa <= 200) {
        compGeoScore = Math.min(15, Math.max(2, lpa >= (profile.min_salary_lpa || 8) ? compGeoScore + 1 : compGeoScore - 4));
      }
    } else if (fxDesc) {
      const fx = fxDesc[3] ? 1.26 : fxDesc[2] ? 1.08 : 1;
      const n = parseFloat(fxDesc[4].replace(/,/g, ''));
      const cadence = (fxDesc[6] || '').toLowerCase();
      const annualUsd = /hr|hour/.test(cadence)
        ? n * (fxDesc[5] ? 1000 : 1) * 2080 * fx
        : /mo|month/.test(cadence)
        ? (fxDesc[5] || n < 100 ? n * 1000 : n) * 12 * fx
        : (fxDesc[5] || n < 500 ? n * 1000 : n) * fx;
      compGeoScore = Math.min(15, Math.max(2, annualUsd >= (profile.min_salary_usd_annual || 30000) ? compGeoScore + 1 : compGeoScore - 4));
    }
  }

  const raw = Math.min(98, Math.max(12, roleScore + skillScore + seniorityScore + compGeoScore));
  const finalScore = seniorityScore <= 5 ? Math.min(48, raw) : raw;

  const m1 = profile.key_metrics?.[0] || 'verified product & growth metrics';
  const m2 = profile.key_metrics?.[1] || 'end-to-end execution velocity';
  const companyName = job.company?.display_name || 'your team';

  return {
    score: finalScore,
    subscores: {
      role_match: roleScore,
      skill_match: skillScore,
      seniority_match: seniorityScore,
      comp_geo_match: compGeoScore,
    },
    match_reasons: [
      `Direct alignment with ${matchedRoles[0] || roles[0] || 'Target Role'} (${roleScore}/40 Role)`,
      matchedSkills.length > 0
        ? `Matched ${matchedSkills.slice(0, 3).join(', ')} (${skillScore}/30 Skill)`
        : `Low direct skill keyword overlap (${skillScore}/30 Skill)`,
      `Seniority (${seniorityScore}/15 Seniority) & Location/Comp (${compGeoScore}/15 Comp/Geo) for ${job.location || 'Remote'}`,
    ],
    gap:
      seniorityScore <= 7
        ? `Role specifies multi-year experience; offset immediately with ${m2}.`
        : `Lead screening conversation with ${m1} and hands-on system execution.`,
    dm_draft: `Hi ${companyName} team — I saw the ${job.title} opening and wanted to reach out directly. In my recent work, I delivered ${m1} and ${m2}. I'd welcome the chance to bring that exact execution velocity to ${companyName}.`,
    resume_angle: `Lead summary with "${m2}" and "${m1}"`,
    relocation_note: job.has_relocation
      ? 'Explicit relocation/visa support detected in job description'
      : 'Standard location/remote terms apply',
    engine_used: 'Deterministic 4-Pillar Rubric v3.0',
  };
}

// ─── AUTH & GOOGLE SHEETS OPS (100% PROTOCOL PRESERVED) ──────────────────────

async function getAuth() {
  if (!process.env.GOOGLE_SERVICE_KEY_BASE64) throw new Error('Missing GOOGLE_SERVICE_KEY_BASE64');
  const credentials = JSON.parse(
    Buffer.from(process.env.GOOGLE_SERVICE_KEY_BASE64, 'base64').toString('utf8')
  );
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

async function getExistingJobIds(sheets, auth) {
  try {
    const response = await sheets.spreadsheets.values.get({
      auth,
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: 'Sheet1!B:B',
    });
    const rows = response.data.values;
    if (!rows || rows.length === 0) return new Set();
    return new Set(rows.map((row) => String(row[0])));
  } catch (error) {
    console.error('[Sheets] Error fetching existing IDs:', error.message);
    throw new Error(`Failed to fetch existing job IDs: ${error.message}`);
  }
}

async function getSeenJobIds(sheets, auth) {
  try {
    const response = await sheets.spreadsheets.values.get({
      auth,
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: 'SeenJobs!A:A',
    });
    const rows = response.data.values;
    if (!rows || rows.length === 0) return new Set();
    return new Set(rows.map((row) => String(row[0])));
  } catch (error) {
    if (error?.code === 400 || error?.message?.includes('Unable to parse range')) {
      console.warn('[Sheets] SeenJobs tab not found — starting fresh.');
      return new Set();
    }
    console.error('[Sheets] Error fetching seen IDs:', error.message);
    throw new Error(`Failed to fetch seen job IDs: ${error.message}`);
  }
}

async function appendSeenJobIds(sheets, auth, ids) {
  if (!ids || ids.length === 0) return;
  const rows = ids.map((id) => [String(id)]);
  try {
    await sheets.spreadsheets.values.append({
      auth,
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: 'SeenJobs!A:A',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: rows },
    });
  } catch (error) {
    console.error('[Sheets] Error appending seen IDs:', error.message);
    throw new Error(`Failed to append seen job IDs: ${error.message}`);
  }
}

// ─── SOURCE 1: INTERNSHALA (DYNAMICALLY PARAMETERIZED BY PROFILE.JSON) ───────

export async function fetchInternshalaJobs(profile) {
  const jobs = [];
  const { internshalaSlugs } = deriveDynamicSearchParams(profile);
  let cities =
    profile?.target_cities
      ?.map((c) => c.toLowerCase().replace('bengaluru', 'bangalore'))
      .filter((c) => c !== 'remote') || [];
  if (cities.length === 0) cities = ['bangalore', 'hyderabad'];

  const headers = {
    'User-Agent':
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
  };

  for (const category of internshalaSlugs.slice(0, 4)) {
    for (const city of cities.slice(0, 2)) {
      try {
        const url = `https://internshala.com/jobs/${category}-jobs/${city}-city/`;
        const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
        if (!res.ok) {
          await delay(800);
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
            for (const job of list.slice(0, 8)) {
              const title = job.profile || job.title || job.job_title || '';
              const company = job.company_name || job.employer_name || job.company || 'Unknown';
              const fallbackId = `${category}_${company}_${title}`.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 48);
              const id = `internshala_${job.id || job.job_id || fallbackId}`;
              const desc = stripHtmlTags(
                job.description || job.job_description || `${title} at ${company} in ${city}.`
              ).trim();
              const link = job.url
                ? `https://internshala.com${job.url}`
                : `https://internshala.com/jobs/${category}-jobs/`;
              if (title) {
                jobs.push({
                  id,
                  title,
                  company: { display_name: company },
                  description: desc.substring(0, 800),
                  redirect_url: link,
                  location: city,
                });
              }
            }
            await delay(800);
            continue;
          } catch (_) {}
        }

        const parts = html.split('class="company generic_company');
        for (let i = 1; i < parts.length && i <= 8; i++) {
          const p = parts[i];
          const hrefMatch = p.match(/class="job-title-href"[^>]*href="([^"]+)"[^>]*>\s*([^<]+)/);
          if (!hrefMatch) continue;
          const href = hrefMatch[1];
          const title = hrefMatch[2].trim();
          const company =
            p.match(/class="company-name">\s*(?:<[^>]+>\s*)*([^<\n]+)/)?.[1]?.trim() || 'Unknown';
          const rawId = href.match(/(\d+)$/)?.[1] || `${category}_${city}_${i}`;
          if (title.length > 3) {
            jobs.push({
              id: `internshala_${rawId}`,
              title,
              company: { display_name: company },
              description: `${title} role at ${company}, ${city}. Via Internshala.`,
              redirect_url: href.startsWith('http') ? href : `https://internshala.com${href}`,
              location: city,
              has_relocation: false,
            });
          }
        }
      } catch (err) {
        console.warn(`[Internshala] Error ${category}/${city}:`, err.message);
      }
      await delay(900);
    }
  }
  console.log(`[Internshala] Total: ${jobs.length}`);
  return jobs;
}

// ─── SOURCE 2: REMOTEOK (DYNAMIC TAGS FROM PROFILE.JSON) ─────────────────────

export async function fetchRemoteOKJobs(profile) {
  const jobs = [];
  const { remoteOkTags } = deriveDynamicSearchParams(profile);
  const headers = {
    'User-Agent': 'KaisifOS Job Intelligence Engine',
    Accept: 'application/json',
  };

  for (const tag of remoteOkTags) {
    try {
      const url = `https://remoteok.com/api?tags=${encodeURIComponent(tag)}`;
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;

      const raw = await res.json();
      const results = Array.isArray(raw) ? raw.slice(1) : [];

      for (const item of results.slice(0, 8)) {
        if (!item.position || !item.company) continue;
        const fullText = `${item.description || ''} ${(item.tags || []).join(' ')}`.toLowerCase();
        const hasRelocation =
          /relocation|accommodation|housing|visa\s*sponsor|flight|moving\s*allowance|relo/.test(
            fullText
          );

        jobs.push({
          id: `remoteok_${item.id || item.slug}`,
          title: item.position,
          company: { display_name: item.company },
          description: stripHtmlTags(
            item.description || `${item.position} at ${item.company}. Remote role.`
          )
            .trim()
            .substring(0, 800),
          redirect_url: item.url || `https://remoteok.com/l/${item.slug}`,
          location: item.location || 'Remote / Worldwide',
          salary_min: item.salary_min || null,
          salary_max: item.salary_max || null,
          has_relocation: hasRelocation,
          tags: (item.tags || []).join(', '),
        });
      }
    } catch (err) {
      console.warn(`[RemoteOK] Error for tag ${tag}:`, err.message);
    }
    await delay(1000);
  }
  console.log(`[RemoteOK] Total: ${jobs.length}`);
  return jobs;
}

// ─── SOURCE 3: REMOTIVE (DYNAMIC CATEGORIES & KEYWORDS FROM PROFILE.JSON) ────

export async function fetchRemotiveJobs(profile) {
  const jobs = [];
  const { remotiveCategories, remotiveKeywords } = deriveDynamicSearchParams(profile);

  for (const category of remotiveCategories) {
    try {
      const url = new URL('https://remotive.com/api/remote-jobs');
      url.searchParams.append('category', category);
      url.searchParams.append('limit', '10');

      const res = await fetch(url.toString(), { signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;

      const data = await res.json();
      for (const item of data.jobs || []) {
        const description = stripHtmlTags(item.description || '').trim();
        const hasRelocation =
          /relocation|accommodation|housing|visa\s*sponsor|flight|moving\s*allowance|relo/.test(
            description.toLowerCase()
          );

        jobs.push({
          id: `remotive_${item.id}`,
          title: item.title,
          company: { display_name: item.company_name || 'Unknown' },
          description: description.substring(0, 800),
          redirect_url: item.url || '',
          location: item.candidate_required_location || 'Remote / Worldwide',
          has_relocation: hasRelocation,
        });
      }
    } catch (err) {
      console.warn(`[Remotive] Error for ${category}:`, err.message);
    }
    await delay(500);
  }

  for (const kw of remotiveKeywords.slice(0, 3)) {
    try {
      const url = new URL('https://remotive.com/api/remote-jobs');
      url.searchParams.append('search', kw);
      url.searchParams.append('limit', '6');
      const res = await fetch(url.toString(), { signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const data = await res.json();
      for (const item of data.jobs || []) {
        const description = stripHtmlTags(item.description || '').trim();
        const hasRelocation = /relocation|accommodation|housing|visa\s*sponsor|flight|relo/.test(
          description.toLowerCase()
        );
        jobs.push({
          id: `remotive_${item.id}`,
          title: item.title,
          company: { display_name: item.company_name || 'Unknown' },
          description: description.substring(0, 800),
          redirect_url: item.url || '',
          location: item.candidate_required_location || 'Remote / Worldwide',
          has_relocation: hasRelocation,
        });
      }
    } catch (_) {}
    await delay(400);
  }

  console.log(`[Remotive] Total: ${jobs.length}`);
  return jobs;
}

// ─── SOURCE 4: FREEHIRE DIRECT-ATS ENGINE (strelov1/freehire architecture) ───
// Queries public JSON ATS endpoints directly (Greenhouse, Lever, Ashby) + Arbeitnow + optional FREEHIRE_API_URL

export async function fetchFreeHireAtsJobs(profile) {
  const jobs = [];
  const atsConfig = profile?.ats_companies || {
    greenhouse: ['razorpay', 'postman', 'stripe', 'vercel', 'cloudflare'],
    lever: ['zepto', 'cred', 'mistral'],
    ashby: ['linear', 'posthog', 'supabase', 'langchain'],
  };

  // 4A. Optional self-hosted strelov1/freehire endpoint
  if (process.env.FREEHIRE_API_URL) {
    try {
      const res = await fetch(process.env.FREEHIRE_API_URL, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const data = await res.json();
        const list = Array.isArray(data) ? data : data.jobs || [];
        for (const item of list.slice(0, 20)) {
          const fallbackSlug = `${item.company || 'co'}_${item.title || item.position || 'role'}`
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .slice(0, 48);
          jobs.push({
            id: `freehire_${item.id || fallbackSlug}`,
            title: item.title || item.position,
            company: { display_name: item.company || 'FreeHire Partner' },
            description: stripHtmlTags(item.description || '').substring(0, 800),
            redirect_url: item.url || item.apply_url || '',
            location: item.location || 'Remote',
            has_relocation: /relocation|visa/i.test(item.description || ''),
          });
        }
      }
    } catch (e) {
      console.warn('[FreeHire API] Optional endpoint skipped:', e.message);
    }
  }

  // 4B. Greenhouse Public Boards API
  const ghBoards = (atsConfig.greenhouse || []).slice(0, 5);
  await Promise.allSettled(
    ghBoards.map(async (slug) => {
      try {
        const res = await fetch(
          `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs?content=true`,
          { signal: AbortSignal.timeout(7000) }
        );
        if (!res.ok) return;
        const data = await res.json();
        for (const item of (data.jobs || []).slice(0, 12)) {
          const desc = stripHtmlTags(item.content || '').trim();
          jobs.push({
            id: `greenhouse_${slug}_${item.id}`,
            title: item.title,
            company: { display_name: slug.charAt(0).toUpperCase() + slug.slice(1) },
            description: desc.substring(0, 800) || `${item.title} at ${slug}`,
            redirect_url: item.absolute_url || `https://boards.greenhouse.io/${slug}`,
            location: item.location?.name || 'Remote / Hybrid',
            has_relocation: /relocation|visa|sponsorship/i.test(desc),
          });
        }
      } catch (_) {}
    })
  );

  // 4C. Lever Public Postings API
  const leverBoards = (atsConfig.lever || []).slice(0, 4);
  await Promise.allSettled(
    leverBoards.map(async (slug) => {
      try {
        const res = await fetch(
          `https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`,
          { signal: AbortSignal.timeout(7000) }
        );
        if (!res.ok) return;
        const data = await res.json();
        if (!Array.isArray(data)) return;
        for (const item of data.slice(0, 10)) {
          const desc = stripHtmlTags(item.descriptionPlain || item.description || '').trim();
          jobs.push({
            id: `lever_${slug}_${item.id}`,
            title: item.text,
            company: { display_name: slug.charAt(0).toUpperCase() + slug.slice(1) },
            description: desc.substring(0, 800) || `${item.text} at ${slug}`,
            redirect_url: item.hostedUrl || item.applyUrl || '',
            location: item.categories?.location || 'Remote / Hybrid',
            has_relocation: /relocation|visa|sponsorship/i.test(desc),
          });
        }
      } catch (_) {}
    })
  );

  // 4D. Ashby Public Job Board API
  const ashbyBoards = (atsConfig.ashby || []).slice(0, 4);
  await Promise.allSettled(
    ashbyBoards.map(async (slug) => {
      try {
        const res = await fetch(
          `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}`,
          { signal: AbortSignal.timeout(7000) }
        );
        if (!res.ok) return;
        const data = await res.json();
        for (const item of (data.jobs || []).slice(0, 10)) {
          const desc = stripHtmlTags(item.descriptionPlain || item.descriptionHtml || '').trim();
          jobs.push({
            id: `ashby_${slug}_${item.id}`,
            title: item.title,
            company: { display_name: slug.charAt(0).toUpperCase() + slug.slice(1) },
            description: desc.substring(0, 800) || `${item.title} at ${slug}`,
            redirect_url: item.jobUrl || item.applyUrl || '',
            location: item.location || 'Remote',
            has_relocation: /relocation|visa|sponsorship/i.test(desc),
          });
        }
      } catch (_) {}
    })
  );

  // 4E. Arbeitnow Free Public Job Board API (Global & Visa-Sponsored Tech Roles)
  try {
    const res = await fetch('https://www.arbeitnow.com/api/job-board-api', {
      signal: AbortSignal.timeout(7000),
    });
    if (res.ok) {
      const data = await res.json();
      for (const item of (data.data || []).slice(0, 15)) {
        const desc = stripHtmlTags(item.description || '').trim();
        const fallbackSlug = `${item.company_name || 'co'}_${item.title || 'role'}`
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '_')
          .slice(0, 48);
        jobs.push({
          id: `arbeitnow_${item.slug || fallbackSlug}`,
          title: item.title,
          company: { display_name: item.company_name || 'Unknown' },
          description: desc.substring(0, 800),
          redirect_url: item.url || '',
          location: item.location || (item.remote ? 'Remote' : 'Europe / Global'),
          has_relocation: Boolean(item.visa_sponsorship) || /relocation|visa/i.test(desc),
        });
      }
    }
  } catch (_) {}

  console.log(`[FreeHire ATS + Arbeitnow] Total: ${jobs.length}`);
  return jobs;
}

// ─── SOURCE 4B: HIMALAYAS PUBLIC REMOTE API ──────────────────────────────────

export async function fetchHimalayasJobs() {
  const jobs = [];
  try {
    const res = await fetch('https://himalayas.app/jobs/api?limit=15', {
      headers: { Accept: 'application/json', 'User-Agent': 'KaisifOS Job Intelligence Engine' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return jobs;
    const data = await res.json();
    for (const item of (data.jobs || []).slice(0, 15)) {
      const desc = stripHtmlTags(item.description || item.excerpt || '').trim();
      const fallbackSlug = `${item.companyName || 'co'}_${item.title || 'role'}`
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .slice(0, 48);
      jobs.push({
        id: `himalayas_${item.guid || item.slug || fallbackSlug}`,
        title: item.title || '',
        company: { display_name: item.companyName || 'Unknown' },
        description: desc.substring(0, 800),
        redirect_url: item.applicationLink || item.guid || '',
        salary_min: item.minSalary || null,
        salary_max: item.maxSalary || null,
        location:
          Array.isArray(item.locationRestrictions) && item.locationRestrictions.length > 0
            ? item.locationRestrictions.join(', ')
            : 'Remote / Worldwide',
        has_relocation: /relocation|visa\s*sponsor|relo/i.test(desc),
      });
    }
  } catch (err) {
    console.warn('[Himalayas] Error:', err.message);
  }
  console.log(`[Himalayas] Total: ${jobs.length}`);
  return jobs;
}

// ─── SOURCE 5: JSEARCH (OPTIONAL RAPIDAPI) ───────────────────────────────────

async function fetchJSearchJobs(profile) {
  if (!process.env.RAPIDAPI_KEY) {
    return [];
  }
  const jobs = [];
  try {
    const query = `(${(profile.target_roles || []).slice(0, 3).map((r) => `"${r}"`).join(' OR ')}) (fresher OR "entry level" OR junior OR associate)`;
    const url = new URL('https://jsearch.p.rapidapi.com/search');
    url.searchParams.append('query', query);
    url.searchParams.append('num_pages', '1');
    url.searchParams.append('date_posted', 'week');
    const res = await fetch(url.toString(), {
      headers: {
        'X-RapidAPI-Key': process.env.RAPIDAPI_KEY,
        'X-RapidAPI-Host': 'jsearch.p.rapidapi.com',
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    for (const item of data.data || []) {
      const desc = (item.job_description || '').toLowerCase();
      const hasRelocation = /relocation|accommodation|housing|visa\s*sponsor|relo/.test(desc);
      jobs.push({
        id: `jsearch_${item.job_id}`,
        title: item.job_title,
        company: { display_name: item.employer_name },
        description: (item.job_description || '').substring(0, 800),
        redirect_url: item.job_apply_link,
        salary_min: item.job_min_salary,
        location: `${item.job_city || ''}, ${item.job_country || ''}`.trim().replace(/^,\s*/, ''),
        has_relocation: hasRelocation,
      });
    }
  } catch (err) {
    console.warn('[JSearch] Error:', err.message);
  }
  return jobs;
}

// ─── MULTI-PROVIDER FREE LLM SCORING CHAIN ───────────────────────────────────
// Replaces paid xAI Grok (api.x.ai) with:
// 1. Gemini 4 Hydrogen (Free Tier)
// 2. Groq Llama 3.3 70B (Free Tier)
// 3. OpenRouter Llama 3.3 70B (:free)
// 4. Deterministic 4-Pillar Rubric Fallback

global.groqFailed = false;

export async function scoreJobWithGemini(job, profile, apiKey) {
  const prompt = buildPrompt(job, profile);

  let retries = 3;
  let backoff = 4000;

  while (retries > 0) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-4-hydrogen:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              responseMimeType: 'application/json',
              thinkingConfig: { thinkingLevel: 'LOW' },
            },
          }),
          signal: AbortSignal.timeout(12000),
        }
      );

      if (!res.ok) {
        throw new Error(`Gemini HTTP error ${res.status}: ${await res.text()}`);
      }

      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
      const parsedData = JSON.parse(text);

      if (
        typeof parsedData.score !== 'number' ||
        parsedData.score < 0 ||
        parsedData.score > 100
      ) {
        console.warn(
          `[Gemini] Bad score format for "${job.title}": ${JSON.stringify(parsedData.score)}`
        );
        return { score: 0 };
      }
      return parsedData;
    } catch (error) {
      console.warn(
        `[Gemini] Error for "${job.title}":`,
        error.message,
        `Retries left: ${retries - 1}`
      );
      retries--;
      if (retries > 0) {
        await delay(backoff);
        backoff *= 2;
      } else {
        return { score: 0 };
      }
    }
  }
  return { score: 0 };
}

export async function scoreJobWithGroq(job, profile, groq) {
  const prompt = buildPrompt(job, profile);

  let retries = 3;
  let backoff = 4000;

  while (retries > 0) {
    try {
      const response = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        temperature: 0.1,
        max_tokens: 600,
      });

      const text = response.choices[0]?.message?.content || '{}';
      const data = JSON.parse(text);

      if (typeof data.score !== 'number' || data.score < 0 || data.score > 100) {
        console.warn(`[Groq] Bad score for "${job.title}": ${JSON.stringify(data.score)}`);
        return { score: 0 };
      }
      return data;
    } catch (error) {
      if (
        error?.status === 401 ||
        error?.message?.includes('401') ||
        error?.message?.includes('api_key') ||
        error?.message?.includes('API key')
      ) {
        throw error;
      }
      const isRate =
        error?.status === 429 ||
        error?.message?.includes('429') ||
        error?.message?.includes('rate_limit') ||
        error?.message?.includes('Rate limit');
      if (isRate && retries > 0) {
        console.warn(`[Groq] Rate limit → retry in ${backoff}ms (${retries} left)`);
        await delay(backoff);
        backoff *= 2;
        retries--;
      } else {
        console.error(`[Groq] Error for "${job.title}":`, error.message?.substring(0, 100));
        return { score: 0 };
      }
    }
  }
  return { score: 0 };
}

export async function scoreJobWithOpenRouter(job, profile, apiKey) {
  const prompt = buildPrompt(job, profile);
  const freeModels = [
    'meta-llama/llama-3.3-70b-instruct:free',
    'google/gemma-3-27b-it:free',
    'openrouter/free',
  ];

  for (const model of freeModels) {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'HTTP-Referer': process.env.APP_URL || 'https://kaisifos.local',
          'X-Title': 'KaisifOS Job Intelligence',
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.1,
          response_format: { type: 'json_object' },
        }),
        signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) continue;
      const data = await res.json();
      const raw = (data.choices?.[0]?.message?.content || '{}')
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/```\s*$/i, '')
        .trim();
      let parsed = null;
      try {
        parsed = JSON.parse(raw);
      } catch {
        const firstBrace = raw.indexOf('{');
        const lastBrace = raw.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace > firstBrace) {
          parsed = JSON.parse(raw.slice(firstBrace, lastBrace + 1));
        }
      }
      if (
        parsed &&
        typeof parsed.score === 'number' &&
        Number.isFinite(parsed.score) &&
        parsed.score >= 0 &&
        parsed.score <= 100
      ) {
        return parsed;
      }
    } catch (err) {
      console.warn(`[OpenRouter] Model ${model} error for "${job.title}":`, err.message);
    }
  }
  return { score: 0 };
}

export async function scoreJob(job, profile, groq) {
  const baseline = scoreJobDeterministic(job, profile);
  const enforceGuardrail = (res) => {
    const clampedScore = Math.min(100, Math.max(0, Math.round(Number(res.score) || 0)));
    const safeScore =
      baseline.subscores?.seniority_match <= 5 ? Math.min(48, clampedScore) : clampedScore;
    return { ...baseline, ...res, score: safeScore };
  };

  // 1. Provider 1: Google Gemini Free Tier
  if (process.env.GEMINI_API_KEY) {
    try {
      const res = await scoreJobWithGemini(job, profile, process.env.GEMINI_API_KEY);
      if (res && res.score > 0) return enforceGuardrail(res);
    } catch (err) {
      console.warn(`[Scout] Gemini fallback triggered for "${job.title}":`, err.message);
    }
  }

  // 2. Provider 2: Groq Cloud Free Tier (skip deprecated xai- Grok keys)
  const groqKey = process.env.GROQ_API_KEY || '';
  if (groq && !groqKey.startsWith('xai-') && !global.groqFailed) {
    try {
      const res = await scoreJobWithGroq(job, profile, groq);
      if (res && res.score > 0) return enforceGuardrail(res);
    } catch (err) {
      if (
        err?.status === 401 ||
        err?.message?.includes('401') ||
        err?.message?.includes('api_key') ||
        err?.message?.includes('API key')
      ) {
        console.warn('[Scout] Groq key unauthorized. Switching to OpenRouter / Deterministic...');
        global.groqFailed = true;
      }
    }
  }

  // 3. Provider 3: OpenRouter Free Models
  if (process.env.OPENROUTER_API_KEY) {
    try {
      const res = await scoreJobWithOpenRouter(job, profile, process.env.OPENROUTER_API_KEY);
      if (res && res.score > 0) return enforceGuardrail(res);
    } catch (err) {
      console.warn(`[Scout] OpenRouter fallback triggered:`, err.message);
    }
  }

  // 4. Provider 4: Deterministic 4-Pillar Rubric Fallback
  return baseline;
}

// ─── SHEET & DISCORD OPS ─────────────────────────────────────────────────────

async function appendToSheet(sheets, auth, rows, retries = 2) {
  try {
    await sheets.spreadsheets.values.append({
      auth,
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: 'Sheet1!A:K',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: rows },
    });
  } catch (error) {
    if ((error.code === 429 || error.status === 429) && retries > 0) {
      console.warn('[Sheets] Quota hit — retrying in 8s...');
      await delay(8000);
      return appendToSheet(sheets, auth, rows, retries - 1);
    }
    throw error;
  }
}

async function getWeeklyStats(sheets, auth) {
  try {
    const response = await sheets.spreadsheets.values.get({
      auth,
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: 'Sheet1!A:A',
    });
    const rows = response.data.values;
    if (!rows || rows.length <= 1) return { weekMatches: 0 };
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    let weekMatches = 0;
    for (let i = 1; i < rows.length; i++) {
      if (rows[i]?.[0]) {
        const d = new Date(rows[i][0]);
        if (!isNaN(d) && d >= sevenDaysAgo) weekMatches++;
      }
    }
    return { weekMatches };
  } catch (error) {
    console.error('[Stats] Weekly stats error:', error.message);
    return null;
  }
}

async function sendDiscordDigest(matches, portfolioUrl, totalScanned, weeklyStats = null, profileName = 'Candidate') {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) {
    console.warn('[Discord] No webhook — skipping.');
    return;
  }

  const date = new Date().toISOString().split('T')[0];
  let content = `📋 **JOB SCOUT DIGEST (${profileName}) — ${date}**\n`;
  content += `Scanned **${totalScanned}** roles across Direct-ATS + Global Feeds, **${matches.length}** matched ≥90\n`;
  content += `───────────────────────────────\n`;

  if (matches.length > 0) {
    matches.forEach((m, idx) => {
      let domain = 'Direct ATS';
      try {
        if (m.job.redirect_url) domain = new URL(m.job.redirect_url).hostname.replace('www.', '');
      } catch (_) {}
      const reasons = (m.scoreData.match_reasons || []).join(' · ').substring(0, 100);
      const salary = m.job.salary_min
        ? ` | 💰 $${m.job.salary_min}${m.job.salary_max ? `-${m.job.salary_max}` : ''}`
        : '';
      content += `\n**${idx + 1}. ${m.job.title}** @ **${m.job.company?.display_name || 'Unknown'}**\n`;
      content += `🎯 ${m.scoreData.score}/100 | 📍 ${m.job.location || domain}${salary}\n`;
      content += `✅ ${reasons}\n`;
      content += `💡 ${m.scoreData.resume_angle || 'N/A'}\n`;
      content += `🔗 <${m.job.redirect_url}>\n`;
    });
  } else {
    content += `\n_No roles crossed 90 today._\nSources: Direct-ATS (Greenhouse/Lever/Ashby) + Internshala + RemoteOK + Remotive + Arbeitnow\n`;
  }

  if (weeklyStats) {
    content += `\n📊 **WEEKLY** Total matches stored: **${weeklyStats.weekMatches}**`;
  }

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: content.substring(0, 2000) }),
    });
    if (!res.ok) console.error('[Discord] Send failed:', res.status);
    else console.log('[Discord] Digest sent.');
  } catch (err) {
    console.error('[Discord] Request failed:', err.message);
  }
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  try {
    const groqKey = process.env.GROQ_API_KEY || '';
    const groq = groqKey && !groqKey.startsWith('xai-') ? new Groq({ apiKey: groqKey }) : null;
    const profilePath = path.join(__dirname, '../data/profile.json');
    const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));

    console.log(
      '[Scout] Starting — sources: FreeHire Direct-ATS (Greenhouse/Lever/Ashby) + Internshala + RemoteOK + Remotive + Himalayas + Arbeitnow + JSearch'
    );

    const auth = await getAuth();
    const sheets = google.sheets('v4');
    const seenIds = await getSeenJobIds(sheets, auth);
    console.log(`[Scout] ${seenIds.size} seen job IDs in SeenJobs tab.`);

    const [rawFreeHire, rawInternshala, rawRemoteOK, rawRemotive, rawHimalayas, rawJSearch] =
      await Promise.all([
        fetchFreeHireAtsJobs(profile),
        fetchInternshalaJobs(profile),
        fetchRemoteOKJobs(profile),
        fetchRemotiveJobs(profile),
        fetchHimalayasJobs(),
        fetchJSearchJobs(profile),
      ]);

    const rawJobs = [
      ...rawFreeHire,
      ...rawInternshala,
      ...rawRemoteOK,
      ...rawRemotive,
      ...rawHimalayas,
      ...rawJSearch,
    ];
    console.log(
      `[Scout] Raw: ${rawJobs.length} (FreeHire ATS: ${rawFreeHire.length} | Internshala: ${rawInternshala.length} | RemoteOK: ${rawRemoteOK.length} | Remotive: ${rawRemotive.length} | Himalayas: ${rawHimalayas.length} | JSearch: ${rawJSearch.length})`
    );

    // Canonical Fingerprint Deduplication (ID + normalized company::title)
    const deduped = new Map();
    const fingerprints = new Set();
    for (const job of rawJobs) {
      if (!job.id || !job.title) continue;
      const fp = `${(job.company?.display_name || '').toLowerCase().replace(/[^a-z0-9]/g, '')}::${job.title.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
      if (fingerprints.has(fp)) continue;
      fingerprints.add(fp);
      deduped.set(String(job.id), job);
    }

    const newJobs = Array.from(deduped.values()).filter((j) => !seenIds.has(String(j.id)));
    console.log(`[Scout] After fingerprint dedup + seen filter: ${newJobs.length} new jobs.`);

    const roleKeywords = (profile.target_roles || [])
      .map((r) => r.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/))
      .flat()
      .filter((w) => w.length > 3);
    roleKeywords.push('apm', 'pmm', 'growth', 'product', 'founder', 'analyst');
    const whitelistRegex = new RegExp(`\\b(${Array.from(new Set(roleKeywords)).join('|')})\\b`, 'i');
    const targetMatchingJobs = newJobs.filter((j) => whitelistRegex.test(j.title || ''));

    const blacklistRegex =
      /\b(senior\s+(?:manager|director|engineer|developer|consultant)|director\s+of|vp\s+of|head\s+of|principal\s+\w+|staff\s+engineer|(?:[4-9]|1\d)\+?\s*years?|video\s+editor|graphic\s+designer|telecaller|inside\s+sales|telemarketing|customer\s+support|data\s+entry|tutor|teacher)\b/i;
    const prunedJobs =
      (profile.experience_years || 0) === 0
        ? targetMatchingJobs.filter(
            (j) => !blacklistRegex.test(`${j.title || ''} ${(j.description || '').slice(0, 400)}`)
          )
        : targetMatchingJobs;

    const domainTokens = Array.from(
      new Set(
        (profile.target_roles || [])
          .join(' ')
          .toLowerCase()
          .split(/\W+/)
          .filter((w) => w.length >= 3 && !SCOUT_ROLE_STOP_WORDS.has(w))
      )
    );

    const priorityScore = (j) => {
      const titleHits = domainTokens.filter((t) => hasWholeToken(j.title || '', t)).length * 3;
      const geoHits =
        (j.has_relocation ? 2 : 0) +
        (/(hyderabad|bangalore|bengaluru|india|remote)/i.test(j.location || '') ? 1 : 0);
      return titleHits + geoHits;
    };

    prunedJobs.sort((a, b) => priorityScore(b) - priorityScore(a));

    const jobsToScore = prunedJobs.slice(0, 20);
    const scoredMatches = [];
    const seenScoredIds = [];

    for (const job of jobsToScore) {
      const scoreData = await scoreJob(job, profile, groq);
      const score = scoreData?.score ?? 0;
      console.log(
        `  [Score] "${job.title}" @ ${job.company?.display_name} [${job.location}] → ${score}/100`
      );
      if (score > 0) seenScoredIds.push(String(job.id));
      if (score >= 90) scoredMatches.push({ job, scoreData });
      await delay(1500);
    }

    await appendSeenJobIds(sheets, auth, seenScoredIds);

    scoredMatches.sort((a, b) => b.scoreData.score - a.scoreData.score);
    const topMatches = scoredMatches.slice(0, 5);

    if (topMatches.length > 0) {
      const dateStr = new Date().toISOString().split('T')[0];
      const rows = topMatches.map((m) => [
        sanitizeSheetCell(dateStr, 20),
        sanitizeSheetCell(m.job.id, 120),
        sanitizeSheetCell(m.job.title, 200),
        sanitizeSheetCell(m.job.company?.display_name || 'Unknown', 160),
        Math.max(0, Math.min(100, Math.round(Number(m.scoreData.score) || 0))),
        sanitizeSheetCell((m.scoreData.match_reasons || []).join(' | '), 1000),
        sanitizeSheetCell(m.scoreData.gap || '', 500),
        sanitizeSheetCell(m.job.redirect_url || '', 500),
        sanitizeSheetCell(m.scoreData.dm_draft || '', 1500),
        sanitizeSheetCell(m.scoreData.resume_angle || '', 500),
        'NEW',
      ]);
      await appendToSheet(sheets, auth, rows);
    }

    let weeklyStats = null;
    if (new Date().getDay() === 0) weeklyStats = await getWeeklyStats(sheets, auth);

    await sendDiscordDigest(
      topMatches,
      profile.portfolio || process.env.APP_URL || 'No portfolio linked',
      jobsToScore.length,
      weeklyStats,
      profile.name
    );

    console.log('[Scout] Done ✅');
  } catch (error) {
    console.error('[Scout] FATAL:', error.message);
    process.exit(1);
  }
}

if (process.argv[1] === __filename) {
  main();
}

export { getSeenJobIds, appendSeenJobIds };
