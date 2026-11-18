import fs from 'fs';
import path from 'path';
import { google } from 'googleapis';
import Groq from 'groq-sdk';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import {
  decodeAndStripHtml,
  extractRequiredYearsStrict,
  evaluateHardEligibility,
  buildCanonicalJobKey,
  getSourceUrlPriority,
} from '../lib/eligibility.js';
import {
  isNeonPostgresConfigured,
  getNeonCanonicalStateMap,
  getNeonJobsPendingLlmRetry,
  upsertNeonCanonicalJob,
  readNeonCandidateProfile,
  writeNeonCandidateProfile,
  recordNeonScoutRun,
} from '../lib/neon-db.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const delay = (ms) => new Promise((res) => setTimeout(res, ms));

export const stripHtmlTags = (input) => decodeAndStripHtml(input);

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

function extractHighSignalJdForScout(rawDesc, maxLen = 3200) {
  const clean = decodeAndStripHtml(String(rawDesc || '')).trim();
  if (clean.length <= maxLen) return clean;
  const intro = clean.slice(0, 600);
  const chunks = clean
    .slice(600)
    .split(/\n+|(?<=[.!?])\s+/)
    .map((c) => c.trim())
    .filter((c) => c.length > 15);
  const priority = chunks.filter((c) =>
    /\b(require|qualification|must|experience|years?|yrs?|senior|junior|entry|fresher|salary|compensation|lpa|ctc|\$\d|visa|sponsor|sponsorship|opt|stem|authorization|authorized|citizen|reside|resident|metro|bay\s*area|new\s*york|nyc|seattle|san\s*francisco|hyderabad|india|401\(?k\)?|e-?verify|w-?2|pst|est|cet|travel|in-person|relocation|remote|skills?)\b/i.test(c)
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
  const desc = extractHighSignalJdForScout(job.description || '', 3200);
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
    locationRule = `4. Comp & Location (15 pts): MUST be located in ${targetCities} (on-site/hybrid) or genuinely unrestricted India/Worldwide remote and meet ₹${profile.min_salary_lpa} LPA / $${profile.min_salary_usd_annual || 30000} USD. Give <=2/15 comp_geo AND <=32 total if US/UK/EU/CA work authorization, no sponsorship, no STEM OPT, or remote preference/quarterly travel for NYC/Seattle/SF Bay Area/non-target hubs appears anywhere in the JD.`;
  }

  // Experience logic
  let expRule = '';
  let hardExpRule = '';
  if (isFresher) {
    expRule = `3. Seniority & Experience match (15 pts): Candidate is a FRESHER (0 full-time years). Full marks only if the role is entry-level, junior, associate, or open to freshers. Score <=5/15 if it requires 2+ years or Senior/Lead/Director titles.`;
    hardExpRule = `- DO NOT score above 48 total if the role explicitly requires 2+ years of experience (<=32 total if US/EU metro-locked or no sponsorship).`;
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
- DO score below 32 for: non-India work authorization / no sponsorship / STEM OPT blockers, remote roles prioritizing NYC/Seattle/SF/US/EU metros, or irrelevant seniority.

Return exactly:
{
  "requires_non_india_work_auth_or_no_sponsorship": false,
  "remote_restricted_to_non_target_region": false,
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
  const cleanDescription = decodeAndStripHtml(job.description || '');
  const fullText = `${job.title || ''} ${cleanDescription} ${job.location || ''}`.toLowerCase();
  const titleLower = (job.title || '').toLowerCase();
  const roles = profile.target_roles || [];
  const skills = profile.skills || [];
  const eligibility = evaluateHardEligibility(
    {
      title: job.title,
      location: job.location,
      description: cleanDescription,
    },
    profile
  );

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
  const requiredYears = eligibility.flags.requiredYears ?? extractRequiredYearsStrict(fullText);

  let seniorityScore = 13;
  if (
    eligibility.flags.seniorityBlocked ||
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
  const isTargetLoc = eligibility.flags.matchesTargetHub || eligibility.flags.isIndiaAccessibleRemote;
  const isPreferredRegion =
    Boolean(profile.open_to_relocation) &&
    (profile.relocation_preference?.preferred_regions || []).some((r) =>
      hasWholeToken(locLower, r.toLowerCase())
    );

  const nonCompContextRegex =
    /\b(funding|raised|seed\s+round|series\s+[a-f]|valuation|revenue|arr|mrr|pricing|plan|subscription|tier|customers|users|downloads|volume|market\s+cap|backed\s+by)\b/i;

  let compGeoScore =
    eligibility.flags.workAuthBlocked || eligibility.flags.geoBlocked
      ? 2
      : isTargetLoc
      ? 14
      : isPreferredRegion
      ? 13
      : profile.open_to_relocation
      ? 12
      : 6;

  if (!eligibility.flags.workAuthBlocked && !eligibility.flags.geoBlocked) {
    if (job.salary_min && Number(job.salary_min) > 0) {
      const minUsd = profile.min_salary_usd_annual || 30000;
      const annual = Number(job.salary_min) < 500 ? Number(job.salary_min) * 1000 : Number(job.salary_min);
      compGeoScore = Math.min(15, Math.max(2, annual >= minUsd ? compGeoScore + 1 : compGeoScore - 4));
    } else {
      const lpaDesc = fullText.match(/(\d+(?:\.\d+)?)\s*(?:[-–to]+\s*(\d+(?:\.\d+)?))?\s*lpa\b/i);
      if (lpaDesc) {
        const low = parseFloat(lpaDesc[1]);
        const high = lpaDesc[2] ? parseFloat(lpaDesc[2]) : low;
        const lpa = (low + high) / 2;
        compGeoScore = Math.min(15, Math.max(2, lpa >= (profile.min_salary_lpa || 8) ? compGeoScore + 1 : compGeoScore - 4));
      } else {
        let appliedSalarySignal = false;
        for (const inrDesc of fullText.matchAll(
          /(?:₹|inr\s*|rs\.?\s*)(\d+(?:,\d{2,3})*(?:\.\d+)?)\s*(k|lakh|lakhs|cr|crore|m|million)?\s*(\/\s*(?:mo|month|mth)|per\s+month)?/gi
        )) {
          const unit = (inrDesc[2] || '').toLowerCase();
          if (unit === 'cr' || unit === 'crore' || unit === 'm' || unit === 'million') continue;
          const idx = inrDesc.index ?? 0;
          const snippet = fullText.slice(Math.max(0, idx - 42), Math.min(fullText.length, idx + inrDesc[0].length + 42));
          if (nonCompContextRegex.test(snippet)) continue;

          let val = parseFloat(inrDesc[1].replace(/,/g, ''));
          if (unit === 'k') val *= 1000;
          else if (unit.startsWith('lakh')) val *= 100000;
          const annualInr = inrDesc[3] ? val * 12 : val;
          const lpa = annualInr >= 100000 ? annualInr / 100000 : inrDesc[3] ? (val * 12) / 100000 : val;
          if (lpa >= 1 && lpa <= 200) {
            compGeoScore = Math.min(15, Math.max(2, lpa >= (profile.min_salary_lpa || 8) ? compGeoScore + 1 : compGeoScore - 4));
            appliedSalarySignal = true;
            break;
          }
        }

        if (!appliedSalarySignal) {
          for (const fxDesc of fullText.matchAll(
            /(?:(\$|usd\s*)|(€|eur\s*)|(£|gbp\s*))(\d+(?:,\d{3})*(?:\.\d+)?)\s*(k|m|b|million|billion)?\s*(\/\s*(?:hr|hour|mo|month)|per\s+(?:hour|month))?/gi
          )) {
            const mag = (fxDesc[5] || '').toLowerCase();
            if (mag === 'm' || mag === 'b' || mag === 'million' || mag === 'billion') continue;
            const idx = fxDesc.index ?? 0;
            const snippet = fullText.slice(Math.max(0, idx - 42), Math.min(fullText.length, idx + fxDesc[0].length + 42));
            if (nonCompContextRegex.test(snippet)) continue;

            const fx = fxDesc[3] ? 1.26 : fxDesc[2] ? 1.08 : 1;
            const n = parseFloat(fxDesc[4].replace(/,/g, ''));
            const hasK = mag === 'k';
            const cadence = (fxDesc[6] || '').toLowerCase();
            const annualUsd = /hr|hour/.test(cadence)
              ? n * (hasK ? 1000 : 1) * 2080 * fx
              : /mo|month/.test(cadence)
              ? (hasK || n < 100 ? n * 1000 : n) * 12 * fx
              : (hasK || n < 500 ? n * 1000 : n) * fx;
            compGeoScore = Math.min(15, Math.max(2, annualUsd >= (profile.min_salary_usd_annual || 30000) ? compGeoScore + 1 : compGeoScore - 4));
            break;
          }
        }
      }
    }
  }

  const raw = Math.min(98, Math.max(12, roleScore + skillScore + seniorityScore + compGeoScore));
  const finalScore = !eligibility.eligible
    ? Math.min(32, raw)
    : seniorityScore <= 5
    ? Math.min(48, raw)
    : raw;

  const m1 = profile.key_metrics?.[0] || 'verified product & growth metrics';
  const m2 = profile.key_metrics?.[1] || 'end-to-end execution velocity';
  const companyName = job.company?.display_name || 'your team';

  return {
    score: finalScore,
    eligible: eligibility.eligible,
    subscores: {
      role_match: roleScore,
      skill_match: skillScore,
      seniority_match: seniorityScore,
      comp_geo_match: compGeoMatchFallback(compGeoScore),
    },
    match_reasons: [
      `Direct alignment with ${matchedRoles[0] || roles[0] || 'Target Role'} (${roleScore}/40 Role)`,
      matchedSkills.length > 0
        ? `Matched ${matchedSkills.slice(0, 3).join(', ')} (${skillScore}/30 Skill)`
        : `Low direct skill keyword overlap (${skillScore}/30 Skill)`,
      `Seniority (${seniorityScore}/15 Seniority) & Location/Comp (${compGeoScore}/15 Comp/Geo) for ${job.location || 'Remote'}`,
    ],
    gap: !eligibility.eligible
      ? eligibility.reasons[0]
      : seniorityScore <= 7
      ? `Role specifies multi-year experience; offset immediately with ${m2}.`
      : `Lead screening conversation with ${m1} and hands-on system execution.`,
    dm_draft: `Hi ${companyName} team — I saw the ${job.title} opening and wanted to reach out directly. In my recent work, I delivered ${m1} and ${m2}. I'd welcome the chance to bring that exact execution velocity to ${companyName}.`,
    resume_angle: `Lead summary with "${m2}" and "${m1}"`,
    relocation_note:
      eligibility.flags.workAuthBlocked || eligibility.flags.geoBlocked
        ? eligibility.reasons[0]
        : job.has_relocation
        ? 'Explicit relocation/visa support detected in job description'
        : 'Standard location/remote terms apply',
    engine_used: 'Deterministic 4-Pillar Rubric v3.2',
  };
}

function compGeoMatchFallback(val) {
  return Math.min(15, Math.max(0, Math.round(Number(val) || 0)));
}

// ─── AUTH & GOOGLE SHEETS OPS (100% PROTOCOL PRESERVED) ──────────────────────

function decodeServiceAccountFromEnv() {
  const raw = (process.env.GOOGLE_SERVICE_KEY_BASE64 || '').trim();
  if (!raw) throw new Error('Missing GOOGLE_SERVICE_KEY_BASE64');
  const jsonText = raw.startsWith('{')
    ? raw
    : Buffer.from(raw.replace(/\s+/g, ''), 'base64').toString('utf8').trim();
  const credentials = JSON.parse(jsonText);
  if (!credentials.client_email || !credentials.private_key) {
    throw new Error('Google Service Account JSON is missing client_email or private_key.');
  }
  credentials.private_key = String(credentials.private_key).replace(/\\n/g, '\n');
  return credentials;
}

async function getAuth() {
  const credentials = decodeServiceAccountFromEnv();
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

async function ensureSheetsReady(sheets, auth) {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) return;
  try {
    const meta = await sheets.spreadsheets.get({
      auth,
      spreadsheetId,
      fields: 'sheets.properties.title',
    });
    const existing = new Set((meta.data.sheets || []).map((s) => s.properties?.title).filter(Boolean));
    const missing = ['Sheet1', 'SeenJobs', 'Profile'].filter((t) => !existing.has(t));
    if (missing.length > 0) {
      await sheets.spreadsheets.batchUpdate({
        auth,
        spreadsheetId,
        requestBody: {
          requests: missing.map((title) => ({ addSheet: { properties: { title } } })),
        },
      });
    }
    const hdr = await sheets.spreadsheets.values.get({ auth, spreadsheetId, range: 'Sheet1!A1:K1' });
    if (!hdr.data.values?.[0]?.length) {
      await sheets.spreadsheets.values.update({
        auth,
        spreadsheetId,
        range: 'Sheet1!A1:K1',
        valueInputOption: 'RAW',
        requestBody: {
          values: [['Date', 'ID', 'Title', 'Company', 'Score', 'Reasons', 'Gap', 'URL', 'DM', 'ResumeAngle', 'Status']],
        },
      });
    }
  } catch (err) {
    console.warn('[Sheets] Structure bootstrap warning:', err.message);
  }
}

async function loadProfileForCli(sheets, auth, fallbackPath) {
  const localProfile = JSON.parse(fs.readFileSync(fallbackPath, 'utf8'));

  if (isNeonPostgresConfigured()) {
    try {
      const neonProfile = await readNeonCandidateProfile();
      if (
        neonProfile &&
        typeof neonProfile === 'object' &&
        Array.isArray(neonProfile.target_roles) &&
        neonProfile.target_roles.length > 0
      ) {
        const merged = {
          ...localProfile,
          ...neonProfile,
          ats_companies: {
            ...localProfile.ats_companies,
            ...(neonProfile.ats_companies || {}),
          },
        };
        console.log('[Scout] Loaded active candidate profile from Neon Postgres kaisifos_profile.');
        return merged;
      } else {
        await writeNeonCandidateProfile(localProfile);
        console.log('[Scout] Seeded Neon Postgres kaisifos_profile from local data/profile.json.');
        return localProfile;
      }
    } catch (err) {
      console.warn('[Scout] Neon profile read fallback:', err.message);
    }
  }

  if (process.env.GOOGLE_SHEET_ID && auth) {
    try {
      const res = await sheets.spreadsheets.values.get({
        auth,
        spreadsheetId: process.env.GOOGLE_SHEET_ID,
        range: 'Profile!A1',
      });
      const raw = res.data.values?.[0]?.[0];
      if (typeof raw === 'string' && raw.trim().startsWith('{')) {
        const cloudProfile = JSON.parse(raw);
        const merged = { ...localProfile, ...cloudProfile };
        if (localProfile.open_to_relocation === false && cloudProfile.open_to_relocation === true) {
          merged.open_to_relocation = false;
          if (merged.relocation_preference) merged.relocation_preference.willing = false;
        }
        console.log('[Scout] Loaded active candidate profile from Google Sheets Profile!A1.');
        return merged;
      }
    } catch {
      // Fall back safely to local data/profile.json
    }
  }
  return localProfile;
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
    return new Set(rows.map((row) => String(row[0]).trim()).filter(Boolean));
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
    return new Set(rows.map((row) => String(row[0]).trim()).filter(Boolean));
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
  const uniqueIds = Array.from(new Set(ids.map((id) => String(id).trim()).filter(Boolean)));
  const CHUNK_SIZE = 250;
  try {
    for (let i = 0; i < uniqueIds.length; i += CHUNK_SIZE) {
      const rows = uniqueIds.slice(i, i + CHUNK_SIZE).map((id) => [id]);
      await sheets.spreadsheets.values.append({
        auth,
        spreadsheetId: process.env.GOOGLE_SHEET_ID,
        range: 'SeenJobs!A:A',
        valueInputOption: 'RAW',
        requestBody: { values: rows },
      });
    }
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
      ?.map((c) => c.toLowerCase().replace('bengaluru', 'bangalore').trim())
      .filter((c) => c && c !== 'remote') || [];
  if (cities.length === 0) cities = ['hyderabad'];

  const headers = {
    'User-Agent':
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
  };

  const seen = new Set();
  const targets = [];
  for (const category of internshalaSlugs.slice(0, 4)) {
    for (const city of cities.slice(0, 2)) {
      targets.push({
        url: `https://internshala.com/jobs/${category}-jobs/${city}-city/`,
        label: `${category}/${city}`,
        defaultLoc: city,
      });
    }
  }
  if (internshalaSlugs[0]) {
    targets.push({
      url: `https://internshala.com/jobs/work-from-home-${internshalaSlugs[0]}-jobs/`,
      label: `wfh/${internshalaSlugs[0]}`,
      defaultLoc: 'India Remote (WFH)',
    });
  }

  for (const target of targets) {
    try {
      const res = await fetch(target.url, { headers, signal: AbortSignal.timeout(8000) });
      if (!res.ok) {
        console.warn(`[Internshala] HTTP ${res.status} for ${target.label}`);
        await delay(600);
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
            const fallbackId = `${target.label}_${company}_${title}`
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '_')
              .slice(0, 48);
            const id = `internshala_${job.id || job.job_id || fallbackId}`;
            if (!title || seen.has(id)) continue;
            seen.add(id);
            const desc = stripHtmlTags(
              job.description || job.job_description || `${title} at ${company} (${target.defaultLoc}).`
            ).trim();
            const link = job.url
              ? job.url.startsWith('http')
                ? job.url
                : `https://internshala.com${job.url}`
              : target.url;
            jobs.push({
              id,
              title,
              company: { display_name: company },
              description: desc.substring(0, 12000),
              redirect_url: link,
              location: job.location || target.defaultLoc,
            });
          }
          await delay(700);
          continue;
        } catch (_) {}
      }

      const parts = html.split('class="company generic_company');
      for (let i = 1; i < parts.length && i <= 8; i++) {
        const p = parts[i];
        const hrefMatch = p.match(/class="job-title-href"[^>]*href="([^"]+)"[^>]*>\s*([^<]+)/);
        if (!hrefMatch) continue;
        const href = hrefMatch[1];
        const title = stripHtmlTags(hrefMatch[2]).trim();
        const company =
          stripHtmlTags(p.match(/class="company-name">\s*(?:<[^>]+>\s*)*([^<\n]+)/)?.[1] || '').trim() ||
          'Unknown';
        const rawId = href.match(/(\d+)$/)?.[1] || `${target.label}_${i}`;
        const id = `internshala_${rawId}`;
        if (title.length > 3 && !seen.has(id)) {
          seen.add(id);
          jobs.push({
            id,
            title,
            company: { display_name: company },
            description: `${title} role at ${company}, ${target.defaultLoc}. Via Internshala.`,
            redirect_url: href.startsWith('http') ? href : `https://internshala.com${href}`,
            location: target.defaultLoc,
            has_relocation: false,
          });
        }
      }
    } catch (err) {
      console.warn(`[Internshala] Error ${target.label}:`, err.message);
    }
    await delay(800);
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
            .substring(0, 12000),
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
          description: description.substring(0, 12000),
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
          description: description.substring(0, 12000),
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

  // 4A. Optional self-hosted strelov1/freehire endpoint (SSRF-guarded)
  if (process.env.FREEHIRE_API_URL) {
    try {
      const parsedBridge = new URL(process.env.FREEHIRE_API_URL.trim());
      const host = parsedBridge.hostname.toLowerCase();
      const isPrivateHost =
        host === '169.254.169.254' ||
        host === 'metadata.google.internal' ||
        host.startsWith('10.') ||
        host.startsWith('192.168.') ||
        /^172\.(1[6-9]|2\d|3[0-1])\./.test(host);
      if (parsedBridge.protocol !== 'https:' && host !== 'localhost' && host !== '127.0.0.1') {
        throw new Error('FREEHIRE_API_URL must use HTTPS');
      }
      if (isPrivateHost) {
        throw new Error(`Blocked private/metadata FREEHIRE_API_URL host: ${host}`);
      }
      const res = await fetch(parsedBridge.toString(), {
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
            description: stripHtmlTags(item.description || '').substring(0, 12000),
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

  const scorePostingForBoardSlice = (title, loc) => {
    const l = String(loc || '').toLowerCase();
    const t = String(title || '').toLowerCase();
    let s = 0;
    if (/\b(hyderabad|telangana|secunderabad)\b/.test(l)) s += 60;
    else if (/\b(india|bengaluru|bangalore|mumbai|pune|gurgaon|gurugram|noida|chennai|delhi)\b/.test(l))
      s += 35;
    else if (/\b(remote|worldwide|anywhere|global|distributed)\b/.test(l)) s += 20;
    if (
      /\b(associate product|apm|product marketing|pmm|growth|founder|product analyst|product manager|marketing operations|digital content)\b/.test(
        t
      )
    )
      s += 30;
    if (!/\b(senior|sr\.?|staff|principal|director|vp|vice president|head of)\b/.test(t)) s += 12;
    return s;
  };

  // 4B. Greenhouse Public Boards API (up to 12 boards, pre-sorted before slice)
  const ghBoards = (atsConfig.greenhouse || []).slice(0, 12);
  await Promise.allSettled(
    ghBoards.map(async (slug) => {
      try {
        const res = await fetch(
          `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs?content=true`,
          { signal: AbortSignal.timeout(7000) }
        );
        if (!res.ok) return;
        const data = await res.json();
        const sorted = [...(data.jobs || [])]
          .sort(
            (a, b) =>
              scorePostingForBoardSlice(b.title, b.location?.name) -
              scorePostingForBoardSlice(a.title, a.location?.name)
          )
          .slice(0, 14);
        for (const item of sorted) {
          const desc = stripHtmlTags(item.content || '').trim();
          jobs.push({
            id: `greenhouse_${slug}_${item.id}`,
            title: item.title,
            company: { display_name: slug.charAt(0).toUpperCase() + slug.slice(1) },
            description: desc.substring(0, 12000) || `${item.title} at ${slug}`,
            redirect_url: item.absolute_url || `https://boards.greenhouse.io/${slug}`,
            location: item.location?.name || 'Remote / Hybrid',
            has_relocation: /relocation|visa|sponsorship/i.test(desc),
            source_label: 'Greenhouse',
          });
        }
      } catch (_) {}
    })
  );

  // 4C. Lever Public Postings API (up to 12 boards, pre-sorted before slice)
  const leverBoards = (atsConfig.lever || []).slice(0, 12);
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
        const sorted = [...data]
          .sort(
            (a, b) =>
              scorePostingForBoardSlice(b.text, b.categories?.location) -
              scorePostingForBoardSlice(a.text, a.categories?.location)
          )
          .slice(0, 12);
        for (const item of sorted) {
          const desc = stripHtmlTags(item.descriptionPlain || item.description || '').trim();
          jobs.push({
            id: `lever_${slug}_${item.id}`,
            title: item.text,
            company: { display_name: slug.charAt(0).toUpperCase() + slug.slice(1) },
            description: desc.substring(0, 12000) || `${item.text} at ${slug}`,
            redirect_url: item.hostedUrl || item.applyUrl || '',
            location: item.categories?.location || 'Remote / Hybrid',
            has_relocation: /relocation|visa|sponsorship/i.test(desc),
            source_label: 'Lever',
          });
        }
      } catch (_) {}
    })
  );

  // 4D. Ashby Public Job Board API (up to 12 boards, pre-sorted before slice)
  const ashbyBoards = (atsConfig.ashby || []).slice(0, 12);
  await Promise.allSettled(
    ashbyBoards.map(async (slug) => {
      try {
        const res = await fetch(
          `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}`,
          { signal: AbortSignal.timeout(7000) }
        );
        if (!res.ok) return;
        const data = await res.json();
        const sorted = [...(data.jobs || [])]
          .sort(
            (a, b) =>
              scorePostingForBoardSlice(b.title, b.location) -
              scorePostingForBoardSlice(a.title, a.location)
          )
          .slice(0, 12);
        for (const item of sorted) {
          const desc = stripHtmlTags(item.descriptionPlain || item.descriptionHtml || '').trim();
          jobs.push({
            id: `ashby_${slug}_${item.id}`,
            title: item.title,
            company: { display_name: slug.charAt(0).toUpperCase() + slug.slice(1) },
            description: desc.substring(0, 12000) || `${item.title} at ${slug}`,
            redirect_url: item.jobUrl || item.applyUrl || '',
            location: item.location || 'Remote',
            has_relocation: /relocation|visa|sponsorship/i.test(desc),
            source_label: 'Ashby',
          });
        }
      } catch (_) {}
    })
  );

  // 4E. Workable Public Widget API + v3 detail fetch (pre-sorted before slice)
  const workableBoards = (atsConfig.workable || []).slice(0, 12);
  await Promise.allSettled(
    workableBoards.map(async (slug) => {
      try {
        const res = await fetch(
          `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(slug)}`,
          { signal: AbortSignal.timeout(7000) }
        );
        if (!res.ok) return;
        const data = await res.json();
        const companyName = data.name || slug.charAt(0).toUpperCase() + slug.slice(1);
        const sorted = [...(data.jobs || [])]
          .sort(
            (a, b) =>
              scorePostingForBoardSlice(b.title, [b.city, b.country].filter(Boolean).join(', ')) -
              scorePostingForBoardSlice(a.title, [a.city, a.country].filter(Boolean).join(', '))
          )
          .slice(0, 10);
        await Promise.allSettled(
          sorted.map(async (item) => {
            const loc =
              [item.city, item.country].filter(Boolean).join(', ') ||
              (item.telecommuting ? 'Remote' : 'Flexible');
            const shortcode = item.shortcode || item.id;
            const applyUrl =
              item.url ||
              item.application_url ||
              `https://apply.workable.com/${encodeURIComponent(slug)}/j/${shortcode}/`;
            let fullDesc = '';
            if (shortcode) {
              try {
                const detailRes = await fetch(
                  `https://apply.workable.com/api/v3/accounts/${encodeURIComponent(slug)}/jobs/${encodeURIComponent(String(shortcode))}`,
                  { signal: AbortSignal.timeout(4500) }
                );
                if (detailRes.ok) {
                  const detail = await detailRes.json();
                  fullDesc = decodeAndStripHtml(
                    [detail.description, detail.requirements, detail.benefits].filter(Boolean).join(' ')
                  );
                }
              } catch (_) {}
            }
            const finalDesc = (
              fullDesc ||
              `${item.title} (${item.department || 'General'}) at ${companyName}. ${
                item.telecommuting ? 'Remote eligible.' : ''
              }`
            ).substring(0, 12000);
            jobs.push({
              id: `workable_${slug}_${shortcode}`,
              title: item.title,
              company: { display_name: companyName },
              description: finalDesc,
              redirect_url: applyUrl,
              location: loc,
              has_relocation: /relocation|visa\s*sponsor|sponsorship/i.test(finalDesc),
              source_label: 'Workable',
            });
          })
        );
      } catch (_) {}
    })
  );

  // 4F. SmartRecruiters Public Postings API + detail fetch (pre-sorted before slice, parallelized)
  const srBoards = (atsConfig.smartrecruiters || []).slice(0, 12);
  await Promise.allSettled(
    srBoards.map(async (slug) => {
      try {
        const res = await fetch(
          `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(slug)}/postings?limit=35`,
          { signal: AbortSignal.timeout(7000) }
        );
        if (!res.ok) return;
        const data = await res.json();
        const sorted = [...(data.content || [])]
          .sort(
            (a, b) =>
              scorePostingForBoardSlice(
                b.name,
                [b.location?.city, b.location?.country].filter(Boolean).join(', ')
              ) -
              scorePostingForBoardSlice(
                a.name,
                [a.location?.city, a.location?.country].filter(Boolean).join(', ')
              )
          )
          .slice(0, 10);
        await Promise.allSettled(
          sorted.map(async (item) => {
            const companyName = item.company?.name || slug;
            const companyIdentifier = item.company?.identifier || slug;
            const loc =
              [item.location?.city, item.location?.country].filter(Boolean).join(', ') ||
              (item.location?.remote ? 'Remote' : 'Hybrid');
            const applyUrl = `https://jobs.smartrecruiters.com/${encodeURIComponent(
              companyIdentifier
            )}/${item.id}`;
            let fullDesc = '';
            try {
              const detailRes = await fetch(
                `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(companyIdentifier)}/postings/${encodeURIComponent(String(item.id))}`,
                { signal: AbortSignal.timeout(4500) }
              );
              if (detailRes.ok) {
                const detail = await detailRes.json();
                const sections = detail?.jobAd?.sections || {};
                fullDesc = decodeAndStripHtml(
                  [
                    sections.companyDescription?.text,
                    sections.jobDescription?.text,
                    sections.qualifications?.text,
                    sections.additionalInformation?.text,
                  ]
                    .filter(Boolean)
                    .join(' ')
                );
              }
            } catch (_) {}
            const finalDesc = (
              fullDesc ||
              `${item.name} in ${item.department?.label || 'Product & Tech'} at ${companyName}. Location: ${loc}.`
            ).substring(0, 12000);
            jobs.push({
              id: `smartrecruiters_${slug}_${item.id}`,
              title: item.name,
              company: { display_name: companyName },
              description: finalDesc,
              redirect_url: applyUrl,
              location: loc,
              has_relocation: /relocation|visa\s*sponsor|sponsorship/i.test(finalDesc),
              source_label: 'SmartRecruiters',
            });
          })
        );
      } catch (_) {}
    })
  );

  // 4G. Recruitee Public Offers API (pre-sorted before slice)
  const recruiteeBoards = (atsConfig.recruitee || []).slice(0, 12);
  await Promise.allSettled(
    recruiteeBoards.map(async (slug) => {
      try {
        const cleanSlug = String(slug).replace(/[^a-z0-9-]/gi, '').toLowerCase();
        if (!cleanSlug) return;
        const res = await fetch(`https://${cleanSlug}.recruitee.com/api/offers`, {
          signal: AbortSignal.timeout(7000),
        });
        if (!res.ok) return;
        const data = await res.json();
        const sorted = [...(data.offers || [])]
          .sort(
            (a, b) =>
              scorePostingForBoardSlice(b.title, b.location || (b.remote ? 'Remote' : 'Hybrid')) -
              scorePostingForBoardSlice(a.title, a.location || (a.remote ? 'Remote' : 'Hybrid'))
          )
          .slice(0, 10);
        for (const item of sorted) {
          const desc = stripHtmlTags(item.description || '').trim();
          const applyUrl =
            item.careers_url ||
            item.careers_apply_url ||
            `https://${cleanSlug}.recruitee.com/o/${item.slug || item.id}`;
          jobs.push({
            id: `recruitee_${cleanSlug}_${item.id}`,
            title: item.title,
            company: { display_name: item.company_name || cleanSlug },
            description: desc.substring(0, 12000) || `${item.title} at ${cleanSlug}`,
            redirect_url: applyUrl,
            location: item.location || (item.remote ? 'Remote' : 'Hybrid'),
            has_relocation: /relocation|visa|sponsorship/i.test(desc),
            source_label: 'Recruitee',
          });
        }
      } catch (_) {}
    })
  );

  // 4H. Direct Company Career Pages (SSRF-guarded Schema.org JobPosting JSON-LD + Career Anchors)
  const careerUrls = (
    Array.isArray(profile?.career_urls) && profile.career_urls.length > 0
      ? profile.career_urls
      : [
          'https://www.postman.com/company/careers/',
          'https://razorpay.com/jobs/',
          'https://linear.app/careers',
          'https://posthog.com/careers',
        ]
  ).slice(0, 10);

  await Promise.allSettled(
    careerUrls.map(async (rawUrl) => {
      try {
        const parsed = new URL(String(rawUrl).trim());
        const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
        const isPrivate =
          host === 'localhost' ||
          host === '127.0.0.1' ||
          host === '::1' ||
          host === '169.254.169.254' ||
          host === 'metadata.google.internal' ||
          host.startsWith('10.') ||
          host.startsWith('192.168.') ||
          /^172\.(1[6-9]|2\d|3[0-1])\./.test(host);
        if ((parsed.protocol !== 'https:' && parsed.protocol !== 'http:') || isPrivate) return;

        const res = await fetch(parsed.toString(), {
          headers: {
            'User-Agent': 'KaisifOS-CareerCrawler/1.0 (+https://github.com)',
            Accept: 'text/html,application/xhtml+xml',
          },
          signal: AbortSignal.timeout(7000),
        });
        if (!res.ok) return;
        const html = await res.text();
        const fallbackCo = host.replace(/^www\./, '').split('.')[0] || 'Company';
        const companyTitle = fallbackCo.charAt(0).toUpperCase() + fallbackCo.slice(1);

        let foundLd = 0;
        const ldRegex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
        for (const m of html.matchAll(ldRegex)) {
          try {
            const parsedJson = JSON.parse((m[1] || '').trim());
            const items = [];
            const walk = (n) => {
              if (!n || typeof n !== 'object') return;
              if (Array.isArray(n)) return n.forEach(walk);
              if (Array.isArray(n['@graph'])) n['@graph'].forEach(walk);
              const t = n['@type'];
              if (t === 'JobPosting' || (Array.isArray(t) && t.includes('JobPosting'))) {
                items.push(n);
              }
            };
            walk(parsedJson);
            for (const item of items.slice(0, 12)) {
              if (!item.title) continue;
              let applyUrl = parsed.toString();
              const candidateUrl = item.url || item.sameAs;
              if (typeof candidateUrl === 'string' && candidateUrl.trim()) {
                try {
                  applyUrl = new URL(candidateUrl.trim(), parsed.toString()).toString();
                } catch (_) {}
              }
              const desc = stripHtmlTags(item.description || `${item.title} at ${companyTitle}`).trim();
              const slug = `${host}_${item.title}_${foundLd}`.replace(/[^a-z0-9]+/gi, '_').slice(0, 48);
              foundLd++;
              jobs.push({
                id: `career_${slug}`,
                title: String(item.title),
                company: { display_name: item.hiringOrganization?.name || companyTitle },
                description: desc.substring(0, 12000),
                redirect_url: applyUrl,
                location: item.jobLocation?.address?.addressLocality || 'Direct Career Portal',
                has_relocation: /relocation|visa|sponsorship|remote/i.test(desc),
              });
            }
          } catch (_) {}
        }

        if (foundLd === 0) {
          const seenHrefs = new Set();
          let anchorCount = 0;

          // Keka / Darwinbox embedded JSON job blocks
          const isKekaOrDarwinbox =
            /kekacdn|keka\.com|darwinbox|darwinboxcdn/i.test(html) ||
            /keka|darwinbox/i.test(parsed.hostname);
          if (isKekaOrDarwinbox) {
            for (const m of html.matchAll(
              /"(?:title|jobTitle)"\s*:\s*"([^"]{4,110})"[^}]{0,400}?"(?:jobUrl|applyUrl|url|slug|id)"\s*:\s*"?([a-zA-Z0-9/_:-]{2,140})"?/gi
            )) {
              const title = stripHtmlTags(m[1] || '').trim();
              const ref = (m[2] || '').trim();
              if (!title || /\b(home|about|contact|privacy|terms|careers)\b/i.test(title)) continue;
              let absUrl = parsed.toString();
              if (/^https?:\/\//i.test(ref)) absUrl = ref;
              else if (ref.startsWith('/')) {
                try {
                  absUrl = new URL(ref, parsed.toString()).toString();
                } catch (_) {}
              } else {
                absUrl = `${parsed.toString().replace(/\/$/, '')}#job=${encodeURIComponent(ref)}`;
              }
              if (seenHrefs.has(absUrl)) continue;
              seenHrefs.add(absUrl);
              const snippet = html.slice(Math.max(0, (m.index ?? 0) - 100), (m.index ?? 0) + 450);
              const locMatch = snippet.match(/"(?:location|city|locationName)"\s*:\s*"([^"]{2,60})"/i);
              const loc = locMatch?.[1]?.trim() || 'Hyderabad / India';
              const slug = `${host}_${title}_${anchorCount}`.replace(/[^a-z0-9]+/gi, '_').slice(0, 48);
              anchorCount++;
              jobs.push({
                id: `career_${slug}`,
                title,
                company: { display_name: companyTitle },
                description: `${title} opening on ${companyTitle} official career portal (${loc} · ${absUrl}).`,
                redirect_url: absUrl,
                location: loc,
                has_relocation: false,
                source_label: 'Company Career Page',
              });
              if (anchorCount >= 12) break;
            }
          }

          if (anchorCount === 0) {
            const anchorRegex = /<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
            for (const m of html.matchAll(anchorRegex)) {
              const label = stripHtmlTags(m[2] || '').replace(/\s+/g, ' ').trim();
              if (!label || label.length < 6 || label.length > 100) continue;
              let absUrl = '';
              try {
                absUrl = new URL(m[1].trim(), parsed.toString()).toString();
              } catch (_) {
                continue;
              }
              const isJobOrPortalHref =
                /\/(job|jobs|career|careers|opening|openings|position|positions|role|roles)\/[^/?#]+/i.test(absUrl) ||
                (isKekaOrDarwinbox && /(jobdetails|candidate\/careers|openings|requisition|jobs\/view)/i.test(absUrl));
              if (
                seenHrefs.has(absUrl) ||
                !/^https?:\/\//i.test(absUrl) ||
                !isJobOrPortalHref ||
                !/\b(manager|engineer|developer|analyst|designer|associate|lead|intern|specialist|scientist|product|marketing|growth|founder)\b/i.test(label)
              ) {
                continue;
              }
              seenHrefs.add(absUrl);
              const matchIdx = m.index ?? 0;
              const snippet = stripHtmlTags(
                html.slice(Math.max(0, matchIdx - 180), Math.min(html.length, matchIdx + m[0].length + 220))
              );
              const cityMatch = snippet.match(
                /\b(Hyderabad|Telangana|Bengaluru|Bangalore|Mumbai|Delhi|NCR|Gurugram|Gurgaon|Noida|Pune|Chennai|India|Remote(?:\s*\/\s*Hybrid)?|Hybrid)\b/i
              );
              const inferredLoc = cityMatch ? cityMatch[1] : 'Direct Career Portal';
              const slug = `${host}_${label}_${anchorCount}`.replace(/[^a-z0-9]+/gi, '_').slice(0, 48);
              anchorCount++;
              jobs.push({
                id: `career_${slug}`,
                title: label,
                company: { display_name: companyTitle },
                description: `${label} listed on ${companyTitle} official careers portal (${inferredLoc} · ${absUrl}).`,
                redirect_url: absUrl,
                location: inferredLoc,
                has_relocation: false,
                source_label: 'Company Career Page',
              });
              if (anchorCount >= 8) break;
            }
          }
        }
      } catch (_) {}
    })
  );

  // 4I. Arbeitnow Free Public Job Board API (Global & Visa-Sponsored Tech Roles)
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
          description: desc.substring(0, 12000),
          redirect_url: item.url || '',
          location: item.location || (item.remote ? 'Remote' : 'Europe / Global'),
          has_relocation: Boolean(item.visa_sponsorship) || /relocation|visa/i.test(desc),
        });
      }
    }
  } catch (_) {}

  // 4J. Workday CXS Public JSON Endpoint (enterprise Hyderabad & India tech hubs)
  const rawWorkdayBoards = Array.isArray(atsConfig.workday) ? atsConfig.workday.slice(0, 10) : [];
  const parsedWorkdayTargets = rawWorkdayBoards
    .map((raw) => {
      if (raw && typeof raw === 'object') {
        const tenant = String(raw.tenant || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
        const site = String(raw.site || '').trim().replace(/[^a-zA-Z0-9_-]/g, '');
        const hostRaw = String(raw.host || 'wd5').trim().toLowerCase();
        const host = /^wd\d+$/.test(hostRaw) ? hostRaw : 'wd5';
        const company = String(raw.company || tenant).trim();
        return tenant && site ? { tenant, site, host, company } : null;
      }
      const parts = String(raw || '').split(/[|/]+/).map((p) => p.trim()).filter(Boolean);
      if (parts.length < 2) return null;
      const tenant = parts[0].toLowerCase().replace(/[^a-z0-9-]/g, '');
      const hasHost = /^wd\d+$/i.test(parts[1]);
      const host = hasHost ? parts[1].toLowerCase() : 'wd5';
      const site = (hasHost ? parts[2] : parts[1])?.replace(/[^a-zA-Z0-9_-]/g, '') || '';
      const company = (hasHost ? parts[3] : parts[2]) || tenant;
      return tenant && site ? { tenant, site, host, company } : null;
    })
    .filter(Boolean);

  await Promise.allSettled(
    parsedWorkdayTargets.map(async (wd) => {
      try {
        const origin = `https://${wd.tenant}.${wd.host}.myworkdayjobs.com`;
        const endpoint = `${origin}/wday/cxs/${encodeURIComponent(wd.tenant)}/${encodeURIComponent(wd.site)}/jobs`;
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            Origin: origin,
            Referer: `${origin}/${wd.site}`,
            'User-Agent': 'KaisifOS-CareerCrawler/1.0 (+https://github.com)',
          },
          body: JSON.stringify({ appliedFacets: {}, limit: 20, offset: 0, searchText: '' }),
          signal: AbortSignal.timeout(7000),
        });
        if (!res.ok) return;
        const data = await res.json();
        const sorted = [...(data.jobPostings || [])]
          .sort(
            (a, b) =>
              scorePostingForBoardSlice(b.title || '', b.locationsText || '') -
              scorePostingForBoardSlice(a.title || '', a.locationsText || '')
          )
          .slice(0, 10);

        await Promise.allSettled(
          sorted.map(async (item, idx) => {
            if (!item?.title || !item?.externalPath) return;
            const extPath = String(item.externalPath).startsWith('/')
              ? String(item.externalPath)
              : `/${String(item.externalPath)}`;
            const applyUrl = `${origin}/${encodeURIComponent(wd.site)}${extPath}`;
            let loc = String(item.locationsText || 'Hyderabad / India').trim();
            let desc = `${item.title} at ${wd.company} (${loc}). ${item.postedOn || ''}`.trim();
            if (idx < 5) {
              try {
                const detailRes = await fetch(
                  `${origin}/wday/cxs/${encodeURIComponent(wd.tenant)}/${encodeURIComponent(wd.site)}${extPath}`,
                  {
                    headers: { Accept: 'application/json', 'User-Agent': 'KaisifOS-CareerCrawler/1.0' },
                    signal: AbortSignal.timeout(4500),
                  }
                );
                if (detailRes.ok) {
                  const detailJson = await detailRes.json();
                  const info = detailJson?.jobPostingInfo;
                  if (info?.jobDescription) {
                    const stripped = stripHtmlTags(info.jobDescription);
                    if (stripped.length > desc.length) desc = stripped;
                  }
                  if (info?.location) loc = String(info.location).trim() || loc;
                }
              } catch (_) {}
            }
            const safeSlug = extPath.replace(/[^a-z0-9]+/gi, '_').slice(-32);
            jobs.push({
              id: `workday_${wd.tenant}_${safeSlug}`,
              title: String(item.title).trim(),
              company: { display_name: wd.company },
              description: desc.substring(0, 12000),
              redirect_url: applyUrl,
              location: loc,
              has_relocation: /relocation|visa\s*sponsor|sponsorship/i.test(desc),
              source_label: 'Workday ATS',
            });
          })
        );
      } catch (_) {}
    })
  );

  console.log(`[FreeHire ATS + Workday + Career Pages + Arbeitnow] Total: ${jobs.length}`);
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
        description: desc.substring(0, 12000),
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

export async function fetchJSearchJobs(profile) {
  if (!process.env.RAPIDAPI_KEY) {
    return [];
  }
  const jobs = [];
  const roles = (profile?.target_roles || ['Associate Product Manager', 'Growth Analyst']).slice(0, 3);
  const cityConstraint =
    profile?.open_to_relocation === false
      ? `in ${(profile?.target_cities || ['Hyderabad']).join(' OR ')}, India`
      : '';
  const query = `(${roles.map((r) => `"${r}"`).join(' OR ')}) (fresher OR "entry level" OR junior OR associate) ${cityConstraint}`.trim();
  const url = new URL('https://jsearch.p.rapidapi.com/search');
  url.searchParams.append('query', query);
  url.searchParams.append('num_pages', '1');
  url.searchParams.append('date_posted', 'week');
  if (profile?.open_to_relocation === false) {
    url.searchParams.append('country', 'in');
  }

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(url.toString(), {
        headers: {
          'X-RapidAPI-Key': process.env.RAPIDAPI_KEY,
          'X-RapidAPI-Host': 'jsearch.p.rapidapi.com',
        },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) {
        if ((res.status === 429 || res.status >= 500) && attempt < 2) {
          await delay(900);
          continue;
        }
        console.warn(`[JSearch] HTTP ${res.status}`);
        break;
      }
      const data = await res.json();
      for (const item of data.data || []) {
        const cleanDesc = stripHtmlTags(item.job_description || '').trim();
        const descLower = cleanDesc.toLowerCase();
        const hasRelocation = /relocation|accommodation|housing|visa\s*sponsor|relo/.test(descLower);
        jobs.push({
          id: `jsearch_${item.job_id}`,
          title: item.job_title,
          company: { display_name: item.employer_name || 'Unknown' },
          description: cleanDesc.substring(0, 12000),
          redirect_url: item.job_apply_link || '',
          salary_min: item.job_min_salary || null,
          salary_max: item.job_max_salary || null,
          location: `${item.job_city || ''}, ${item.job_country || ''}`.trim().replace(/^,\s*/, '') || 'Remote / Global',
          has_relocation: hasRelocation,
        });
      }
      break;
    } catch (err) {
      if (attempt < 2) {
        await delay(800);
        continue;
      }
      console.warn('[JSearch] Error:', err.message);
    }
  }
  console.log(`[JSearch] Total: ${jobs.length}`);
  return jobs;
}

// ─── MULTI-PROVIDER FREE LLM SCORING CHAIN + CIRCUIT BREAKERS ────────────────
// 1. Gemini 4 Hydrogen (Free Tier)
// 2. Groq Cloud Free Tier (Llama 3.3 70B)
// 3. OpenRouter Free Models (:free 3-model cascade)
// 4. Deterministic 4-Pillar Rubric Fallback

const CIRCUIT_COOLDOWN_MS = 180_000;
const CIRCUIT_TRIP_THRESHOLD = 2;

const providerBreakers = {
  gemini: { failures: 0, openUntil: 0, permanentDown: false, trippedLogged: false },
  groq: { failures: 0, openUntil: 0, permanentDown: false, trippedLogged: false },
  openrouter: { failures: 0, openUntil: 0, permanentDown: false, trippedLogged: false },
};

export function resetProviderBreakers() {
  for (const key of Object.keys(providerBreakers)) {
    providerBreakers[key].failures = 0;
    providerBreakers[key].openUntil = 0;
    providerBreakers[key].permanentDown = false;
    providerBreakers[key].trippedLogged = false;
  }
  global.groqFailed = false;
}

function recordProviderSuccess(name) {
  const b = providerBreakers[name];
  if (!b) return;
  b.failures = 0;
  b.openUntil = 0;
  b.trippedLogged = false;
}

function recordProviderTransientFailure(name, reason) {
  const b = providerBreakers[name];
  if (!b) return;
  b.failures += 1;
  if (b.failures >= CIRCUIT_TRIP_THRESHOLD) {
    b.openUntil = Date.now() + CIRCUIT_COOLDOWN_MS;
    if (!b.trippedLogged) {
      b.trippedLogged = true;
      console.warn(
        `[CircuitBreaker] ${name.toUpperCase()} paused for ${Math.round(CIRCUIT_COOLDOWN_MS / 1000)}s after ${b.failures} consecutive failures (${reason}) — fast-routing to next engine.`
      );
    }
  }
}

function disableProviderPermanently(name, reason) {
  const b = providerBreakers[name];
  if (!b) return;
  b.permanentDown = true;
  if (!b.trippedLogged) {
    b.trippedLogged = true;
    console.warn(`[CircuitBreaker] ${name.toUpperCase()} disabled for remainder of run (${reason}).`);
  }
}

function isProviderAvailable(name) {
  const b = providerBreakers[name];
  if (!b || b.permanentDown) return false;
  if (b.openUntil > 0) {
    if (Date.now() < b.openUntil) return false;
    // Half-open recovery attempt after cooldown expires
    b.openUntil = 0;
    b.failures = CIRCUIT_TRIP_THRESHOLD - 1;
    b.trippedLogged = false;
  }
  return true;
}

function isTransientStatusOrError(status, message = '') {
  if (status && [429, 500, 502, 503, 504].includes(status)) return true;
  return /429|503|502|504|timeout|timed out|aborted|overloaded|unavailable|econnreset|fetch failed/i.test(
    String(message || '')
  );
}

global.groqFailed = false;

export async function scoreJobWithGemini(job, profile, apiKey, hooks = {}) {
  const prompt = buildPrompt(job, profile);
  const geminiModel = process.env.GEMINI_MODEL?.trim() || 'gemini-4-hydrogen';

  let retries = 2;
  let backoff = 1200;

  while (retries > 0) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(geminiModel)}:generateContent?key=${apiKey}`,
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
          signal: AbortSignal.timeout(9000),
        }
      );

      if (!res.ok) {
        if ([400, 401, 403, 404].includes(res.status)) {
          console.warn(`[Gemini] Non-transient HTTP ${res.status} for "${job.title}". Failing fast.`);
          if (res.status === 401 || res.status === 403) {
            hooks.onHardFailure?.(`HTTP ${res.status}`);
          }
          return { score: 0 };
        }
        throw Object.assign(new Error(`Gemini HTTP error ${res.status}: ${await res.text()}`), {
          status: res.status,
        });
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
      hooks.onSuccess?.();
      return parsedData;
    } catch (error) {
      // Do not waste backoff sleeps on malformed non-JSON responses
      if (error instanceof SyntaxError) {
        console.warn(`[Gemini] Malformed JSON output for "${job.title}". Failing fast.`);
        return { score: 0 };
      }

      const transient = isTransientStatusOrError(error?.status, error?.message);
      console.warn(
        `[Gemini] Error for "${job.title}":`,
        error.message,
        `Retries left: ${retries - 1}`
      );
      retries--;
      if (transient && retries > 0) {
        const jitter = Math.floor(Math.random() * 350);
        await delay(backoff + jitter);
        backoff *= 2;
      } else {
        if (transient) {
          hooks.onTransientFailure?.(error.message?.slice(0, 80) || 'transient error');
        }
        return { score: 0 };
      }
    }
  }
  return { score: 0 };
}

export async function scoreJobWithGroq(job, profile, groq, hooks = {}) {
  const prompt = buildPrompt(job, profile);

  let retries = 2;
  let backoff = 1200;

  while (retries > 0) {
    try {
      const response = await Promise.race([
        groq.chat.completions.create({
          model: 'llama-3.3-70b-versatile',
          messages: [{ role: 'user', content: prompt }],
          response_format: { type: 'json_object' },
          temperature: 0.1,
          max_tokens: 600,
        }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Groq request timed out after 10000ms')), 10000)
        ),
      ]);

      const text = response.choices[0]?.message?.content || '{}';
      const data = JSON.parse(text);

      if (typeof data.score !== 'number' || data.score < 0 || data.score > 100) {
        console.warn(`[Groq] Bad score for "${job.title}": ${JSON.stringify(data.score)}`);
        return { score: 0 };
      }
      hooks.onSuccess?.();
      return data;
    } catch (error) {
      if (
        error?.status === 401 ||
        error?.status === 403 ||
        error?.message?.includes('401') ||
        error?.message?.includes('api_key') ||
        error?.message?.includes('API key')
      ) {
        hooks.onHardFailure?.('Groq key unauthorized');
        throw error;
      }
      const isTransient = isTransientStatusOrError(error?.status, error?.message);
      retries--;
      if (isTransient && retries > 0) {
        console.warn(`[Groq] Transient error (${error.message?.slice(0, 60)}) → retry in ${backoff}ms`);
        await delay(backoff);
        backoff *= 2;
      } else {
        console.error(`[Groq] Error for "${job.title}":`, error.message?.substring(0, 100));
        if (isTransient) {
          hooks.onTransientFailure?.(error.message?.slice(0, 80) || 'Groq transient error');
        }
        return { score: 0 };
      }
    }
  }
  return { score: 0 };
}

export async function scoreJobWithOpenRouter(job, profile, apiKey, hooks = {}) {
  const prompt = buildPrompt(job, profile);
  const freeModels = [
    'meta-llama/llama-3.3-70b-instruct:free',
    'google/gemma-3-27b-it:free',
    'openrouter/free',
  ];
  let hadUpstreamFailure = false;

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
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) {
        if (res.status === 401 || res.status === 402 || res.status === 403) {
          hooks.onHardFailure?.(`OpenRouter HTTP ${res.status}`);
          return { score: 0 };
        }
        hadUpstreamFailure = true;
        continue;
      }
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
        hooks.onSuccess?.();
        return parsed;
      }
    } catch (err) {
      hadUpstreamFailure = true;
      console.warn(`[OpenRouter] Model ${model} error for "${job.title}":`, err.message);
    }
  }
  if (hadUpstreamFailure) {
    hooks.onTransientFailure?.('all :free models failed');
  }
  return { score: 0 };
}

export async function scoreJob(job, profile, groq, baselineOverride = null) {
  const baseline = baselineOverride || scoreJobDeterministic(job, profile);
  const eligibility = evaluateHardEligibility(
    {
      title: job.title,
      location: job.location,
      description: decodeAndStripHtml(job.description || ''),
    },
    profile
  );
  const enforceGuardrail = (res, engineUsed) => {
    const clampedScore = Math.min(100, Math.max(0, Math.round(Number(res.score) || 0)));
    const llmGeoBlocked =
      res.requires_non_india_work_auth_or_no_sponsorship === true ||
      res.remote_restricted_to_non_target_region === true;
    const hardBlocked = !eligibility.eligible || llmGeoBlocked;
    const safeScore = hardBlocked
      ? Math.min(32, clampedScore)
      : baseline.subscores?.seniority_match <= 5
      ? Math.min(48, clampedScore)
      : clampedScore;
    return {
      ...baseline,
      ...res,
      gap: !eligibility.eligible ? eligibility.reasons[0] : res.gap || baseline.gap,
      score: safeScore,
      engine_used: res.engine_used || engineUsed,
    };
  };

  // 1. Provider 1: Google Gemini Free Tier
  if (process.env.GEMINI_API_KEY && isProviderAvailable('gemini')) {
    try {
      const res = await scoreJobWithGemini(job, profile, process.env.GEMINI_API_KEY, {
        onSuccess: () => recordProviderSuccess('gemini'),
        onTransientFailure: (reason) => recordProviderTransientFailure('gemini', reason),
        onHardFailure: (reason) => disableProviderPermanently('gemini', reason),
      });
      if (res && res.score > 0) return enforceGuardrail(res, 'Gemini 4 Hydrogen');
    } catch (err) {
      console.warn(`[Scout] Gemini fallback triggered for "${job.title}":`, err.message);
    }
  }

  // 2. Provider 2: Groq Cloud Free Tier (skip deprecated xai- Grok keys)
  const groqKey = process.env.GROQ_API_KEY || '';
  if (groq && !groqKey.startsWith('xai-') && !global.groqFailed && isProviderAvailable('groq')) {
    try {
      const res = await scoreJobWithGroq(job, profile, groq, {
        onSuccess: () => recordProviderSuccess('groq'),
        onTransientFailure: (reason) => recordProviderTransientFailure('groq', reason),
        onHardFailure: (reason) => {
          global.groqFailed = true;
          disableProviderPermanently('groq', reason);
        },
      });
      if (res && res.score > 0) return enforceGuardrail(res, 'Groq Llama 3.3 70B');
    } catch (err) {
      if (
        err?.status === 401 ||
        err?.status === 403 ||
        err?.message?.includes('401') ||
        err?.message?.includes('api_key') ||
        err?.message?.includes('API key')
      ) {
        console.warn('[Scout] Groq key unauthorized. Switching to OpenRouter / Deterministic...');
        global.groqFailed = true;
        disableProviderPermanently('groq', 'HTTP 401');
      }
    }
  }

  // 3. Provider 3: OpenRouter Free Models
  if (process.env.OPENROUTER_API_KEY && isProviderAvailable('openrouter')) {
    try {
      const res = await scoreJobWithOpenRouter(job, profile, process.env.OPENROUTER_API_KEY, {
        onSuccess: () => recordProviderSuccess('openrouter'),
        onTransientFailure: (reason) => recordProviderTransientFailure('openrouter', reason),
        onHardFailure: (reason) => disableProviderPermanently('openrouter', reason),
      });
      if (res && res.score > 0) return enforceGuardrail(res, 'OpenRouter :free');
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
  content += `Evaluated **${totalScanned}** roles across Official Career Pages, 6 Direct-ATS & Remote Feeds · **${matches.length}** high-fit matches committed\n`;
  if (process.env.APP_URL) {
    content += `🖥️ Full Digest Ledger: ${process.env.APP_URL.replace(/\/$/, '')}/admin/digest\n`;
  }
  content += `───────────────────────────────\n`;

  const previewMatches = matches.slice(0, 8);
  if (previewMatches.length > 0) {
    previewMatches.forEach((m, idx) => {
      let domain = 'Direct ATS';
      try {
        if (m.job.redirect_url) domain = new URL(m.job.redirect_url).hostname.replace('www.', '');
      } catch (_) {}
      const reasons = (m.scoreData.match_reasons || []).join(' · ').substring(0, 100);
      const salary = m.job.salary_min
        ? ` | 💰 $${m.job.salary_min}${m.job.salary_max ? `-${m.job.salary_max}` : ''}`
        : '';
      const applyLine = m.job.redirect_url
        ? `🔗 Apply (${domain}): ${m.job.redirect_url}`
        : '🔗 Apply URL not provided by upstream feed';
      content += `\n**${idx + 1}. ${m.job.title}** @ **${m.job.company?.display_name || 'Unknown'}**\n`;
      content += `🎯 ${m.scoreData.score}/100 | 📍 ${m.job.location || domain}${salary}\n`;
      content += `✅ ${reasons}\n`;
      content += `💡 ${m.scoreData.resume_angle || 'N/A'}\n`;
      content += `${applyLine}\n`;
    });
  } else {
    content += `\n_No roles crossed the high-conviction score threshold today._\nSources: Company Career Pages + Greenhouse/Lever/Ashby/Workable/SmartRecruiters/Recruitee + Internshala + RemoteOK + Remotive + Arbeitnow\n`;
  }

  if (weeklyStats) {
    content += `\n📊 **WEEKLY** Total matches stored: **${weeklyStats.weekMatches}**`;
  }

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: content.substring(0, 2000) }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) console.error('[Discord] Send failed:', res.status);
    else console.log('[Discord] Digest sent.');
  } catch (err) {
    console.error('[Discord] Request failed:', err.message);
  }
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  const runStartMs = Date.now();
  const LLM_BUDGET_MS = 330_000; // 5.5 minute hard scoring cap inside 10m GitHub Actions timeout
  resetProviderBreakers();

  try {
    const groqKey = process.env.GROQ_API_KEY || '';
    const groq = groqKey && !groqKey.startsWith('xai-') ? new Groq({ apiKey: groqKey }) : null;
    const profilePath = path.join(__dirname, '../data/profile.json');
    const neonConfigured = isNeonPostgresConfigured();
    const hasSheetsConfig = Boolean(
      process.env.GOOGLE_SERVICE_KEY_BASE64?.trim() && process.env.GOOGLE_SHEET_ID?.trim()
    );

    console.log(
      '[Scout] Starting v4.1 — sources: Company Career Pages (incl. Keka/Darwinbox) + Workday + 6 Direct-ATS (Greenhouse/Lever/Ashby/Workable/SmartRecruiters/Recruitee) + RemoteOK + Remotive + Himalayas + Arbeitnow + JSearch (Internshala disabled unless profile.enable_internshala=true)'
    );

    let auth = null;
    let sheets = null;
    if (hasSheetsConfig) {
      try {
        auth = await getAuth();
        sheets = google.sheets('v4');
        await ensureSheetsReady(sheets, auth);
      } catch (e) {
        console.warn('[Sheets] Auth initialization skipped:', e.message);
      }
    }

    const profile = await loadProfileForCli(sheets, auth, profilePath);
    const enableInternshala = profile?.enable_internshala === true;
    const [seenIds, existingSheetIds, neonStateMap] = await Promise.all([
      sheets && auth ? getSeenJobIds(sheets, auth).catch(() => new Set()) : Promise.resolve(new Set()),
      sheets && auth ? getExistingJobIds(sheets, auth).catch(() => new Set()) : Promise.resolve(new Set()),
      neonConfigured ? getNeonCanonicalStateMap() : Promise.resolve(new Map()),
    ]);
    console.log(
      `[Scout] State loaded — Neon canonical keys: ${neonStateMap.size} | Seen IDs: ${seenIds.size} | Sheet IDs: ${existingSheetIds.size} | Internshala: ${enableInternshala ? 'OPT-IN ON' : 'DISABLED'}`
    );

    const [rawFreeHire, rawInternshala, rawRemoteOK, rawRemotive, rawHimalayas, rawJSearch] =
      await Promise.all([
        fetchFreeHireAtsJobs(profile),
        enableInternshala ? fetchInternshalaJobs(profile) : Promise.resolve([]),
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
    const sourceCounts = {
      FreeHire: rawFreeHire.length,
      ...(enableInternshala ? { Internshala: rawInternshala.length } : {}),
      RemoteOK: rawRemoteOK.length,
      Remotive: rawRemotive.length,
      Himalayas: rawHimalayas.length,
      JSearch: rawJSearch.length,
    };
    console.log(
      `[Scout] Raw: ${rawJobs.length} (FreeHire/Workday ATS: ${rawFreeHire.length}${enableInternshala ? ` | Internshala: ${rawInternshala.length}` : ''} | RemoteOK: ${rawRemoteOK.length} | Remotive: ${rawRemotive.length} | Himalayas: ${rawHimalayas.length} | JSearch: ${rawJSearch.length})`
    );

    // Canonical Cross-Source Deduplication (buildCanonicalJobKey: company::title::geoBucket)
    const dedupedByCanonical = new Map();
    let canonicalDuplicatesMerged = 0;

    for (const job of rawJobs) {
      if (!job.id || !job.title) continue;
      const companyName = job.company?.display_name || 'Unknown';
      const cKey = buildCanonicalJobKey(companyName, job.title, job.location);
      job.canonicalKey = cKey;
      const sourceLabel = job.source_label || String(job.id).split('_')[0] || 'scout';

      const existing = dedupedByCanonical.get(cKey);
      if (existing) {
        canonicalDuplicatesMerged += 1;
        const seenList = existing.sourcesSeen || [
          { source: existing.source_label || String(existing.id).split('_')[0], url: existing.redirect_url || '' },
        ];
        if (!seenList.some((s) => s.source === sourceLabel)) {
          seenList.push({ source: sourceLabel, url: job.redirect_url || '', id: job.id });
        }
        existing.sourcesSeen = seenList;
        if ((job.description || '').length > (existing.description || '').length) {
          existing.description = job.description;
        }
        if (
          getSourceUrlPriority(job.redirect_url || job.id) >
          getSourceUrlPriority(existing.redirect_url || existing.id)
        ) {
          existing.redirect_url = job.redirect_url;
          existing.id = job.id;
        }
        continue;
      }

      job.sourcesSeen = [{ source: sourceLabel, url: job.redirect_url || '', id: job.id }];
      dedupedByCanonical.set(cKey, job);
    }

    const newJobs = [];
    for (const [cKey, job] of dedupedByCanonical.entries()) {
      const neonState = neonStateMap.get(cKey);
      if (neonState) {
        // Re-evaluate if previous run failed LLM scoring (needs_llm_retry = true)
        if (!neonState.needsLlmRetry) continue;
        job.fromRetryQueue = true;
      } else if (
        seenIds.has(String(job.id)) ||
        seenIds.has(cKey) ||
        existingSheetIds.has(String(job.id))
      ) {
        continue;
      }
      newJobs.push(job);
    }

    // Drain any Neon jobs stuck in needs_llm_retry = true even if absent from today's fresh scrape
    if (neonConfigured) {
      const queuedRetryJobs = await getNeonJobsPendingLlmRetry(8).catch(() => []);
      for (const qJob of queuedRetryJobs) {
        if (!qJob.canonicalKey || dedupedByCanonical.has(qJob.canonicalKey)) continue;
        newJobs.push({
          id: qJob.id,
          canonicalKey: qJob.canonicalKey,
          title: qJob.title,
          company: { display_name: qJob.company || 'Unknown' },
          location: qJob.location || 'Hyderabad',
          description: qJob.description || `${qJob.title} at ${qJob.company}`,
          redirect_url: qJob.url || '',
          sourcesSeen: qJob.sourcesSeen || [],
          fromRetryQueue: true,
        });
      }
    }

    console.log(
      `[Scout] After canonical dedup (${canonicalDuplicatesMerged} cross-source duplicates merged) + retry drain: ${newJobs.length} candidate jobs.`
    );

    // Dynamic role relevance filter derived from profile.target_roles + PM/Growth/Tech domain terms
    const profileRolesText = (profile.target_roles || []).join(' ').toLowerCase();
    const genericRoleStop = new Set(['manager', 'associate', 'lead', 'analyst', 'engineer', 'developer', 'team', 'staff']);
    const profileRoleTokens = Array.from(
      new Set(profileRolesText.split(/\W+/).filter((w) => w.length >= 3 && !genericRoleStop.has(w)))
    );
    const isPmGrowthTrack = /product|marketing|growth|founder|content/i.test(profileRolesText);
    const isTechDataTrack = /software|engineer|developer|data|ml|ai|scientist/i.test(profileRolesText);

    const pmDomainRegex =
      /\b(product\s+manager|associate\s+product|apm|product\s+marketing|pmm|growth|founder'?s?\s+associate|founder'?s?\s+office|chief\s+of\s+staff|product\s+analyst|marketing\s+operations|marketing\s+analyst|digital\s+marketing|digital\s+content|gtm)\b/i;
    const techDomainRegex =
      /\b(software|full[- ]stack|frontend|backend|ai|ml|machine\s+learning|data\s+scientist|data\s+analyst|analytics\s+engineer|founding\s+engineer)\b/i;

    const titleSeniorityRegex =
      /\b(senior|sr\.?|director|vp|vice president|head of|chief|principal|staff)\b/i;
    const fresherLeadRegex = /\b(lead)\b/i;
    const descBlacklistRegex =
      /\b((?:[4-9]|1\d)\+?\s*years?|video\s+editor|graphic\s+designer|telecaller|inside\s+sales|telemarketing|customer\s+support|data\s+entry|tutor|teacher|werkstudent|field\s+sales|store\s+manager)\b/i;

    const expYears = profile.experience_years || 0;
    const rejectedNonMatchIds = [];
    const hardGateReasons = {};
    const prunedJobs = [];

    for (const job of newJobs) {
      const title = job.title || '';
      const cleanDesc = decodeAndStripHtml(job.description || '');
      job.description = cleanDesc.substring(0, 12000);

      const exactTokenMatch = profileRoleTokens.some((tok) => hasWholeToken(title, tok));
      const domainMatch =
        (isPmGrowthTrack && pmDomainRegex.test(title)) ||
        (isTechDataTrack && techDomainRegex.test(title));
      const matchesRole = exactTokenMatch || domainMatch || profileRoleTokens.length === 0;

      const hitsSeniorTitle =
        expYears <= 1 &&
        (titleSeniorityRegex.test(title) || (expYears === 0 && fresherLeadRegex.test(title)));
      const hitsBlacklist = expYears <= 1 && descBlacklistRegex.test(`${title} ${cleanDesc}`);

      if (!matchesRole || hitsSeniorTitle || hitsBlacklist) {
        rejectedNonMatchIds.push(String(job.id));
        if (job.canonicalKey) rejectedNonMatchIds.push(job.canonicalKey);
        const reasonKey = !matchesRole ? 'Non-target role title' : 'Seniority or blacklist filter';
        hardGateReasons[reasonKey] = (hardGateReasons[reasonKey] || 0) + 1;
      } else {
        prunedJobs.push(job);
      }
    }

    // Sort prunedJobs so Hyderabad / target-city jobs are enriched FIRST before running enrichQuota
    const targetCityTokens = (profile.target_cities || ['Hyderabad']).map((c) => c.toLowerCase());
    prunedJobs.sort((a, b) => {
      const aHub = targetCityTokens.some((c) => String(a.location || '').toLowerCase().includes(c)) ? 1 : 0;
      const bHub = targetCityTokens.some((c) => String(b.location || '').toLowerCase().includes(c)) ? 1 : 0;
      if (bHub !== aHub) return bHub - aHub;
      return getSourceUrlPriority(b.redirect_url || b.id) - getSourceUrlPriority(a.redirect_url || a.id);
    });

    // Enrich thin/stub JDs (e.g. Career Page anchors, Internshala HTML cards) before running strict eligibility gate
    let enrichQuota = 16;
    await Promise.allSettled(
      prunedJobs.slice(0, 22).map(async (job) => {
        if ((job.description || '').length >= 260 || !job.redirect_url || enrichQuota <= 0) return;
        try {
          const parsed = new URL(job.redirect_url);
          const host = parsed.hostname.toLowerCase();
          const isPrivate =
            host === 'localhost' ||
            host === '127.0.0.1' ||
            host === '::1' ||
            host === '169.254.169.254' ||
            host === 'metadata.google.internal' ||
            host.startsWith('10.') ||
            host.startsWith('192.168.') ||
            /^172\.(1[6-9]|2\d|3[0-1])\./.test(host);
          if ((parsed.protocol !== 'https:' && parsed.protocol !== 'http:') || isPrivate) return;
          enrichQuota -= 1;
          const res = await fetch(parsed.toString(), {
            headers: { 'User-Agent': 'KaisifOS-CareerCrawler/1.0 (+https://github.com)' },
            signal: AbortSignal.timeout(5500),
          });
          if (!res.ok) return;
          const html = await res.text();
          const mainMatch = html.match(/<(?:main|article)[^>]*>([\s\S]*?)<\/(?:main|article)>/i);
          const extracted = decodeAndStripHtml(mainMatch ? mainMatch[1] : html);
          if (extracted.length > job.description.length) {
            job.description = extracted.substring(0, 12000);
          }
        } catch (_) {}
      })
    );

    // Deterministic Pre-Triage + Strict Geo/Work-Auth/Fresher Gate:
    const preScored = prunedJobs.map((job) => ({
      job,
      eligibility: evaluateHardEligibility(
        { title: job.title, location: job.location, description: job.description },
        profile
      ),
      baseline: scoreJobDeterministic(job, profile),
    }));

    const llmEligible = [];
    for (const item of preScored) {
      if (
        !item.eligibility.eligible ||
        item.baseline.subscores?.seniority_match <= 5 ||
        item.baseline.subscores?.comp_geo_match <= 2 ||
        item.baseline.score < 56
      ) {
        rejectedNonMatchIds.push(String(item.job.id));
        if (item.job.canonicalKey) rejectedNonMatchIds.push(item.job.canonicalKey);
        const gateReason = item.eligibility.eligible
          ? 'Below rubric pre-triage floor'
          : item.eligibility.reasons?.[0] || 'Filtered by hard gate';
        const reasonKey = gateReason.split(':')[0].trim();
        hardGateReasons[reasonKey] = (hardGateReasons[reasonKey] || 0) + 1;
        if (neonConfigured) {
          upsertNeonCanonicalJob({
            id: item.job.id,
            canonicalKey: item.job.canonicalKey,
            title: item.job.title,
            company: item.job.company?.display_name || 'Unknown',
            location: item.job.location || '',
            url: item.job.redirect_url || '',
            source: item.job.id,
            sourcesSeen: item.job.sourcesSeen,
            score: 0,
            evaluationStatus: 'REJECTED_GATE',
            needsLlmRetry: false,
            pipelineStage: 'REJECTED',
            hardRejectReason: gateReason,
          }).catch(() => {});
        }
      } else {
        llmEligible.push(item);
      }
    }

    llmEligible.sort((a, b) => {
      const aHub = a.eligibility.flags.matchesTargetHub ? 20 : 0;
      const bHub = b.eligibility.flags.matchesTargetHub ? 20 : 0;
      return bHub + b.baseline.score - (aHub + a.baseline.score);
    });

    const jobsToScore = llmEligible.slice(0, 25);
    console.log(
      `[Pre-Triage] Rejected ${rejectedNonMatchIds.length} ineligible/non-matching/US-locked/senior roles; queued ${jobsToScore.length}/${llmEligible.length} verified Hyderabad/remote fresher candidates for LLM scoring.`
    );

    const scoredMatches = [];
    const seenScoredIds = [];
    let queuedForRetryCount = 0;
    let deadlineTriggered = false;

    for (let i = 0; i < jobsToScore.length; i += 2) {
      const chunk = jobsToScore.slice(i, i + 2);
      const results = await Promise.all(
        chunk.map(async ({ job, baseline }) => {
          if (Date.now() - runStartMs > LLM_BUDGET_MS) {
            deadlineTriggered = true;
            return { job, scoreData: baseline };
          }
          const scoreData = await scoreJob(job, profile, groq, baseline);
          return { job, scoreData };
        })
      );

      for (const { job, scoreData } of results) {
        const score = scoreData?.score ?? 0;
        const isDeterministicFallback =
          scoreData?.engine_used === 'Deterministic 4-Pillar Rubric v3.2';
        const evalStatus = isDeterministicFallback ? 'DETERMINISTIC_ONLY' : 'LLM_SCORED';
        const needsLlmRetry = isDeterministicFallback && score >= 56;

        console.log(
          `  [Score] "${job.title}" @ ${job.company?.display_name} [${job.location}] → ${score}/100 (${scoreData?.engine_used || 'LLM'}${needsLlmRetry ? ' · queued for LLM retry' : ''})`
        );

        // CRITICAL: Never lock DETERMINISTIC_ONLY jobs into SeenJobs so they can be retried when LLM recovers!
        if (!needsLlmRetry && score > 0) {
          seenScoredIds.push(String(job.id));
          if (job.canonicalKey) seenScoredIds.push(job.canonicalKey);
        } else if (needsLlmRetry) {
          queuedForRetryCount += 1;
        }

        // Persist to Neon Postgres (high matches, retry candidates, and retry-queue jobs that finished LLM scoring)
        const qualifiesForCommit = isDeterministicFallback ? score >= 72 : score >= 80;
        if (neonConfigured && (qualifiesForCommit || needsLlmRetry || (job.fromRetryQueue && !isDeterministicFallback))) {
          await upsertNeonCanonicalJob({
            id: job.id,
            canonicalKey: job.canonicalKey,
            title: job.title,
            company: job.company?.display_name || 'Unknown',
            location: job.location || 'Hyderabad',
            salary: job.salary_min ? `${job.salary_min}` : '',
            description: job.description,
            url: job.redirect_url || '',
            source: job.id,
            sourcesSeen: job.sourcesSeen,
            score,
            evaluationStatus: evalStatus,
            needsLlmRetry,
            pipelineStage: score >= 90 ? 'SHORTLISTED' : 'NEW',
            reasons: (scoreData.match_reasons || []).join(' | '),
            gap: scoreData.gap || '',
            dmDraft: scoreData.dm_draft || '',
            resumeAngle: scoreData.resume_angle || '',
          }).catch((e) => console.warn('[Neon] Upsert warning:', e.message));
        }

        if (qualifiesForCommit) {
          scoredMatches.push({ job, scoreData });
        }
      }

      const anyLlmStillOpen =
        (process.env.GEMINI_API_KEY && isProviderAvailable('gemini')) ||
        (groq && isProviderAvailable('groq')) ||
        (process.env.OPENROUTER_API_KEY && isProviderAvailable('openrouter'));

      if (!deadlineTriggered && anyLlmStillOpen && i + 2 < jobsToScore.length) {
        await delay(600);
      }
    }

    if (deadlineTriggered) {
      console.warn('[Scout] Reached 5.5m global LLM budget — completed remaining roles deterministically and queued for retry.');
    }

    // Flush genuinely LLM-scored IDs and deterministically rejected non-match IDs to SeenJobs (never DETERMINISTIC_ONLY retry jobs)
    if (sheets && auth) {
      await appendSeenJobIds(sheets, auth, [...seenScoredIds, ...rejectedNonMatchIds]);
    }

    scoredMatches.sort((a, b) => b.scoreData.score - a.scoreData.score);
    const topMatches = scoredMatches.slice(0, 15);

    if (topMatches.length > 0 && sheets && auth) {
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
        m.scoreData.score >= 90 ? 'SHORTLISTED' : 'NEW',
      ]);
      await appendToSheet(sheets, auth, rows);
    }

    if (neonConfigured) {
      await recordNeonScoutRun({
        runner: 'github_actions_cli',
        rawFetched: rawJobs.length,
        canonicalDedupSaved: canonicalDuplicatesMerged,
        hardGateRejected: rejectedNonMatchIds.length,
        evaluatedCount: jobsToScore.length,
        committedCount: topMatches.length,
        queuedForRetryCount,
        sourceCounts,
        rejectionBreakdown: hardGateReasons,
        durationMs: Date.now() - runStartMs,
      }).catch(() => {});
    }

    let weeklyStats = null;
    if (new Date().getDay() === 0 && sheets && auth) weeklyStats = await getWeeklyStats(sheets, auth);

    await sendDiscordDigest(
      topMatches,
      profile.portfolio || process.env.APP_URL || 'No portfolio linked',
      jobsToScore.length,
      weeklyStats,
      profile.name
    );

    console.log(`[Scout] Done ✅ (${Math.round((Date.now() - runStartMs) / 1000)}s)`);
  } catch (error) {
    console.error('[Scout] FATAL:', error.message);
    process.exit(1);
  }
}

if (process.argv[1] === __filename) {
  main();
}

export { getSeenJobIds, appendSeenJobIds };
