import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import Groq from 'groq-sdk';
import { CandidateProfile } from './profile';
import {
  decodeAndStripHtml,
  evaluateHardEligibility,
  extractRequiredYearsStrict,
} from './eligibility';
import {
  extractHighSignalJdContext,
  parseLooseJSON,
  redactSecrets,
  SKILL_SYNONYMS,
  ROLE_SYNONYMS,
} from './utils';

export interface FourPillarSubscores {
  role_match: number; // out of 40
  skill_match: number; // out of 30
  seniority_match: number; // out of 15
  comp_geo_match: number; // out of 15
  // Legacy compatibility fields for existing components
  experience_match: number;
  location_match: number;
  salary_match: number;
  relocation_bonus: number;
}

export interface DefendabilityAudit {
  verified_claims: string[];
  inferred_transfers: string[];
  unverified_gaps: string[];
  confidence_level: 'HIGH' | 'MEDIUM' | 'LOW';
}

export interface OutreachToneSet {
  warm_founder: string;
  direct_metric: string;
  peer_builder: string;
}

export interface FallbackChainStatus {
  gemini: string;
  groq: string;
  openrouter: string;
  deterministic: string;
}

export interface JobEvaluationResult {
  score: number;
  subscores: FourPillarSubscores;
  matched_skills: string[];
  missing_skills: string[];
  match_reasons: string[];
  gap: string;
  dm_draft: string;
  outreach_tones: OutreachToneSet;
  cold_email_subject: string;
  cold_email_body: string;
  resume_angle: string;
  relocation_note: string;
  defendability: DefendabilityAudit;
  engine_used: string;
  fallback_chain_status?: FallbackChainStatus;
}

export function getGeminiClient(): GoogleGenAI | null {
  if (!process.env.GEMINI_API_KEY) return null;
  return new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

type LlmProviderName = 'gemini' | 'groq' | 'openrouter';

const LLM_COOLDOWN_MS = 90_000;
const LLM_AUTH_COOLDOWN_MS = 600_000;
const LLM_TRIP_THRESHOLD = 2;

const llmProviderBreakers: Record<
  LlmProviderName,
  { failures: number; openUntil: number; lastReason: string }
> = {
  gemini: { failures: 0, openUntil: 0, lastReason: '' },
  groq: { failures: 0, openUntil: 0, lastReason: '' },
  openrouter: { failures: 0, openUntil: 0, lastReason: '' },
};

export function resetLlmCircuitBreakers(): void {
  for (const key of Object.keys(llmProviderBreakers) as LlmProviderName[]) {
    llmProviderBreakers[key] = { failures: 0, openUntil: 0, lastReason: '' };
  }
}

function isLlmProviderOpen(name: LlmProviderName): { open: boolean; waitSec: number; reason: string } {
  const b = llmProviderBreakers[name];
  if (b.openUntil > 0) {
    const remaining = b.openUntil - Date.now();
    if (remaining > 0) {
      return { open: true, waitSec: Math.ceil(remaining / 1000), reason: b.lastReason };
    }
    b.openUntil = 0;
    b.failures = LLM_TRIP_THRESHOLD - 1;
  }
  return { open: false, waitSec: 0, reason: '' };
}

function markLlmProviderSuccess(name: LlmProviderName): void {
  llmProviderBreakers[name] = { failures: 0, openUntil: 0, lastReason: '' };
}

function markLlmProviderFailure(name: LlmProviderName, err: unknown): void {
  const msg = String((err as Error)?.message || err || '');
  const status = (err as { status?: number })?.status;
  const isAuthError = status === 401 || status === 403 || /\b(401|403|api key|unauthorized)\b/i.test(msg);
  const b = llmProviderBreakers[name];
  if (isAuthError) {
    b.failures = LLM_TRIP_THRESHOLD;
    b.openUntil = Date.now() + LLM_AUTH_COOLDOWN_MS;
    b.lastReason = 'auth-error';
    return;
  }
  b.failures += 1;
  b.lastReason = redactSecrets(msg, 60);
  if (b.failures >= LLM_TRIP_THRESHOLD) {
    b.openUntil = Date.now() + LLM_COOLDOWN_MS;
  }
}

function isTransientError(err: unknown): boolean {
  const msg = String((err as Error)?.message || err || '').toLowerCase();
  const status = (err as { status?: number })?.status;
  return (
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    /429|503|502|rate.?limit|quota|timed out|overloaded|unavailable/.test(msg)
  );
}

async function withExponentialRetry<T>(fn: () => Promise<T>, maxAttempts = 2): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === maxAttempts || !isTransientError(err)) {
        throw err;
      }
      const jitter = Math.floor(Math.random() * 250);
      await new Promise((r) => setTimeout(r, attempt * 650 + jitter));
    }
  }
  throw lastErr;
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasWholeToken(text: string, token: string): boolean {
  const clean = token.trim();
  if (!clean) return false;
  return new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(clean)}(?:$|[^a-z0-9])`, 'i').test(text);
}

function matchesSkillWithSynonyms(text: string, skill: string): boolean {
  const lower = skill.toLowerCase().trim();
  if (hasWholeToken(text, lower)) return true;
  const aliases = SKILL_SYNONYMS[lower];
  if (aliases && aliases.some((a) => hasWholeToken(text, a))) {
    return true;
  }
  const meaningfulTokens = lower
    .split(/[\s/&]+/)
    .filter((tok) => tok.length >= 3 && !ROLE_STOP_WORDS.has(tok));
  if (meaningfulTokens.length === 0) return false;
  return meaningfulTokens.every((tok) => hasWholeToken(text, tok));
}

const ROLE_STOP_WORDS = new Set([
  'manager',
  'associate',
  'lead',
  'analyst',
  'engineer',
  'developer',
  'specialist',
  'coordinator',
  'head',
  'director',
  'senior',
  'junior',
  'intern',
  'executive',
  'officer',
  'team',
  'member',
  'staff',
  'principal',
  'operations',
  'strategy',
]);

async function callOpenRouterFreeModel<T>(
  model: string,
  prompt: string,
  systemInstruction: string
): Promise<T | null> {
  if (!process.env.OPENROUTER_API_KEY) return null;
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'HTTP-Referer': process.env.APP_URL || 'https://kaisifos.local',
      'X-Title': 'KaisifOS Job Intelligence',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemInstruction },
        { role: 'user', content: prompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
    }),
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) {
    throw new Error(`OpenRouter HTTP ${res.status}`);
  }
  const payload = await res.json();
  return parseLooseJSON<T>(payload.choices?.[0]?.message?.content || '{}');
}

/**
 * Generic structured JSON helper across the Free Multi-LLM Fallback Chain:
 * Gemini 4 Hydrogen -> Groq Llama 3.3 70B -> OpenRouter Free (:free) -> Deterministic Fallback.
 */
export async function generateStructuredJSONWithLLM<T = Record<string, unknown>>(
  prompt: string,
  systemInstruction = 'Output strictly valid JSON.',
  options?: { thinkingBudget?: number; thinkingLevel?: 'LOW' | 'MEDIUM' }
): Promise<{ data: T; engine_used: string; fallback_chain_status: FallbackChainStatus } | null> {
  const fullPrompt = `${systemInstruction}\n\n${prompt}`;
  const thinkingLevel =
    options?.thinkingLevel === 'LOW' || (options?.thinkingBudget !== undefined && options.thinkingBudget <= 512)
      ? ThinkingLevel.LOW
      : ThinkingLevel.MEDIUM;

  const chainStatus: FallbackChainStatus = {
    gemini: process.env.GEMINI_API_KEY ? 'pending' : 'unconfigured',
    groq:
      process.env.GROQ_API_KEY && !process.env.GROQ_API_KEY.startsWith('xai-')
        ? 'pending'
        : 'unconfigured',
    openrouter: process.env.OPENROUTER_API_KEY ? 'pending' : 'unconfigured',
    deterministic: 'ready',
  };

  // 1. Google Gemini Free Tier (gemini-4-hydrogen — strictly no temperature or thinkingBudget)
  const ai = getGeminiClient();
  const geminiModel = process.env.GEMINI_MODEL?.trim() || 'gemini-4-hydrogen';
  const geminiBreaker = isLlmProviderOpen('gemini');
  if (ai && !geminiBreaker.open) {
    try {
      const response = await withExponentialRetry(
        () =>
          withTimeout(
            ai.models.generateContent({
              model: geminiModel,
              contents: fullPrompt,
              config: {
                responseMimeType: 'application/json',
                thinkingConfig: { thinkingLevel },
              },
            }),
            10000,
            'Gemini generateContent'
          ),
        2
      );
      const parsed = parseLooseJSON<T>(response.text || '{}');
      if (parsed) {
        markLlmProviderSuccess('gemini');
        chainStatus.gemini = 'ok';
        return {
          data: parsed,
          engine_used: 'Gemini 4 Hydrogen (Free Tier)',
          fallback_chain_status: chainStatus,
        };
      }
      chainStatus.gemini = 'invalid-json';
    } catch (err) {
      markLlmProviderFailure('gemini', err);
      const safeMsg = redactSecrets((err as Error).message, 60);
      chainStatus.gemini = `failed: ${safeMsg}`;
      console.warn('[LLM JSON Helper] Gemini fallback triggered:', safeMsg);
    }
  } else if (ai && geminiBreaker.open) {
    chainStatus.gemini = `cooldown-open (${geminiBreaker.waitSec}s)`;
  }

  // 2. Groq Cloud Free Tier
  const groqBreaker = isLlmProviderOpen('groq');
  if (process.env.GROQ_API_KEY && !process.env.GROQ_API_KEY.startsWith('xai-') && !groqBreaker.open) {
    try {
      const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
      const completion = await withExponentialRetry(
        () =>
          withTimeout(
            groq.chat.completions.create({
              model: 'llama-3.3-70b-versatile',
              messages: [
                { role: 'system', content: systemInstruction },
                { role: 'user', content: prompt },
              ],
              response_format: { type: 'json_object' },
              temperature: 0.1,
            }),
            10000,
            'Groq chat completion'
          ),
        2
      );
      const parsed = parseLooseJSON<T>(completion.choices[0]?.message?.content || '{}');
      if (parsed) {
        markLlmProviderSuccess('groq');
        chainStatus.groq = 'ok';
        return {
          data: parsed,
          engine_used: 'Groq Llama 3.3 70B (Free Tier)',
          fallback_chain_status: chainStatus,
        };
      }
      chainStatus.groq = 'invalid-json';
    } catch (err) {
      markLlmProviderFailure('groq', err);
      const safeMsg = redactSecrets((err as Error).message, 60);
      chainStatus.groq = `failed: ${safeMsg}`;
      console.warn('[LLM JSON Helper] Groq fallback triggered:', safeMsg);
    }
  } else if (process.env.GROQ_API_KEY && !process.env.GROQ_API_KEY.startsWith('xai-') && groqBreaker.open) {
    chainStatus.groq = `cooldown-open (${groqBreaker.waitSec}s)`;
  }

  // 3. OpenRouter Free Tier (Llama 3.3 70B -> Gemma 3 27B -> openrouter/free auto-router)
  const orBreaker = isLlmProviderOpen('openrouter');
  if (process.env.OPENROUTER_API_KEY && !orBreaker.open) {
    const models = [
      { id: 'meta-llama/llama-3.3-70b-instruct:free', label: 'OpenRouter Llama 3.3 70B (:free)' },
      { id: 'google/gemma-3-27b-it:free', label: 'OpenRouter Gemma 3 27B (:free)' },
      { id: 'openrouter/free', label: 'OpenRouter Free Auto-Router (:free)' },
    ];
    let lastOrErr: unknown = null;
    for (const m of models) {
      try {
        const res = await withExponentialRetry(
          () => callOpenRouterFreeModel<T>(m.id, prompt, systemInstruction),
          2
        );
        if (res) {
          markLlmProviderSuccess('openrouter');
          chainStatus.openrouter = `ok (${m.id})`;
          return {
            data: res,
            engine_used: m.label,
            fallback_chain_status: chainStatus,
          };
        }
      } catch (err) {
        lastOrErr = err;
        const safeMsg = redactSecrets((err as Error).message, 48);
        chainStatus.openrouter = `failed (${m.id}): ${safeMsg}`;
        console.warn(`[LLM JSON Helper] OpenRouter (${m.id}) fallback triggered:`, safeMsg);
      }
    }
    if (lastOrErr) {
      markLlmProviderFailure('openrouter', lastOrErr);
    }
    if (chainStatus.openrouter === 'pending') {
      chainStatus.openrouter = 'invalid-json';
    }
  } else if (process.env.OPENROUTER_API_KEY && orBreaker.open) {
    chainStatus.openrouter = `cooldown-open (${orBreaker.waitSec}s)`;
  }

  return null;
}

/**
 * Extracts normalized years of experience required from a JD while ignoring
 * non-requirement company age ("20 years in business", "15 years ago", etc.).
 */
export function extractRequiredYearsFromText(fullText: string): number | null {
  return extractRequiredYearsStrict(fullText);
}

/**
 * Normalizes monthly, hourly, annual, LPA, full-rupee, EUR, and GBP salary expressions
 * against the candidate's India LPA & Global USD annual floors.
 */
export function evaluateSalaryFloorSignal(
  salaryField: string,
  descriptionField: string,
  minLpa: number,
  minUsdAnnual: number
): number {
  const salaryRaw = (salaryField || '').toLowerCase().trim();
  const hasExplicitSalary = Boolean(
    salaryRaw && salaryRaw !== 'not listed' && salaryRaw !== 'standard' && /\d/.test(salaryRaw)
  );
  const salarySource = hasExplicitSalary ? salaryRaw : (descriptionField || '').toLowerCase();

  if (!salarySource || !/\d/.test(salarySource)) return 0;

  const nonCompContextRegex =
    /\b(funding|raised|seed\s+round|series\s+[a-f]|valuation|revenue|arr|mrr|pricing|plan|subscription|tier|customers|users|downloads|volume|market\s+cap|backed\s+by)\b/i;

  const hasNonCompContext = (matchIndex: number, matchLen: number) => {
    if (hasExplicitSalary) return false;
    const windowStart = Math.max(0, matchIndex - 42);
    const windowEnd = Math.min(salarySource.length, matchIndex + matchLen + 42);
    const snippet = salarySource.slice(windowStart, windowEnd);
    return nonCompContextRegex.test(snippet);
  };

  // 1. INR LPA (e.g., "4 LPA", "12-18 LPA", "₹14 LPA")
  const lpaMatch = salarySource.match(/(\d+(?:\.\d+)?)\s*(?:[-–to]+\s*(\d+(?:\.\d+)?))?\s*lpa\b/i);
  if (lpaMatch) {
    const low = parseFloat(lpaMatch[1]);
    const high = lpaMatch[2] ? parseFloat(lpaMatch[2]) : low;
    const effectiveLpa = (low + high) / 2;
    return effectiveLpa >= minLpa ? 2 : -4;
  }

  // 2. INR Monthly or Full Annual (₹80,000/mo, ₹12,00,000, INR 9,00,000)
  for (const inrMatch of salarySource.matchAll(
    /(?:₹|inr\s*|rs\.?\s*)(\d+(?:,\d{2,3})*(?:\.\d+)?)\s*(k|lakh|lakhs|cr|crore|m|million)?\s*(\/\s*(?:mo|month|mth)|per\s+month)?/gi
  )) {
    const unit = (inrMatch[2] || '').toLowerCase();
    if (unit === 'cr' || unit === 'crore' || unit === 'm' || unit === 'million') continue;
    if (hasNonCompContext(inrMatch.index ?? 0, inrMatch[0].length)) continue;

    let val = parseFloat(inrMatch[1].replace(/,/g, ''));
    if (unit === 'k') val *= 1000;
    else if (unit.startsWith('lakh')) val *= 100000;
    const isMonthly = Boolean(inrMatch[3]);
    const annualInr = isMonthly ? val * 12 : val;
    const lpaEquiv = annualInr >= 100000 ? annualInr / 100000 : isMonthly ? (val * 12) / 100000 : val;
    if (lpaEquiv >= 1 && lpaEquiv <= 200) {
      return lpaEquiv >= minLpa ? 2 : -4;
    }
  }

  // 3. USD / EUR / GBP Hourly ($35/hr), Monthly ($3,500/mo), or Annual ($52,000, $140k, €50,000, £45,000)
  for (const fxMatch of salarySource.matchAll(
    /(?:(\$|usd\s*)|(€|eur\s*)|(£|gbp\s*))(\d+(?:,\d{3})*(?:\.\d+)?)\s*(k|m|b|million|billion)?\s*(\/\s*(?:hr|hour|mo|month)|per\s+(?:hour|month))?/gi
  )) {
    const magnitude = (fxMatch[5] || '').toLowerCase();
    if (magnitude === 'm' || magnitude === 'b' || magnitude === 'million' || magnitude === 'billion') {
      continue;
    }
    if (hasNonCompContext(fxMatch.index ?? 0, fxMatch[0].length)) continue;

    const isEur = Boolean(fxMatch[2]);
    const isGbp = Boolean(fxMatch[3]);
    const fxMultiplier = isGbp ? 1.26 : isEur ? 1.08 : 1;
    const rawNum = parseFloat(fxMatch[4].replace(/,/g, ''));
    const hasK = magnitude === 'k';
    const cadence = (fxMatch[6] || '').toLowerCase();

    let annualUsd: number;
    if (/hr|hour/.test(cadence)) {
      annualUsd = rawNum * (hasK ? 1000 : 1) * 2080 * fxMultiplier;
    } else if (/mo|month/.test(cadence)) {
      const monthly = hasK || rawNum < 100 ? rawNum * 1000 : rawNum;
      annualUsd = monthly * 12 * fxMultiplier;
    } else {
      annualUsd = (hasK || rawNum < 500 ? rawNum * 1000 : rawNum) * fxMultiplier;
    }

    return annualUsd >= minUsdAnnual ? 2 : -4;
  }

  return hasExplicitSalary ? 1 : 0;
}

export function deterministicEvaluateJob(
  job: {
    title: string;
    company: string;
    location?: string;
    salary?: string;
    description?: string;
    reasons?: string;
  },
  profile: CandidateProfile
): JobEvaluationResult {
  const cleanDescription = decodeAndStripHtml(job.description || '');
  const fullText =
    `${job.title} ${cleanDescription} ${job.reasons || ''} ${job.location || ''} ${job.salary || ''}`.toLowerCase();
  const titleLower = (job.title || '').toLowerCase();
  const eligibility = evaluateHardEligibility(
    {
      title: job.title,
      location: job.location,
      description: cleanDescription,
    },
    profile
  );

  // 1. Pillar 1: Role Affinity (0 - 40 pts) with synonym recognition
  let roleMatch = 8;
  const targetRoles = profile.target_roles || [];
  const exactMatchedRoles = targetRoles.filter((r) => {
    const lower = r.toLowerCase().trim();
    if (hasWholeToken(titleLower, lower)) return true;
    const aliases = ROLE_SYNONYMS[lower];
    return Boolean(aliases && aliases.some((a) => hasWholeToken(titleLower, a)));
  });

  const domainMatchedRoles = targetRoles.filter((r) => {
    const domainWords = r
      .toLowerCase()
      .split(/\W+/)
      .filter((w) => w.length >= 3 && !ROLE_STOP_WORDS.has(w));
    if (domainWords.length === 0) {
      return hasWholeToken(titleLower, r.toLowerCase());
    }
    const hits = domainWords.filter((w) => hasWholeToken(titleLower, w)).length;
    return domainWords.length === 1 ? hits === 1 : hits >= Math.min(2, domainWords.length);
  });
  const matchedRoles = exactMatchedRoles.length > 0 ? exactMatchedRoles : domainMatchedRoles;

  if (exactMatchedRoles.length >= 2) {
    roleMatch = 38;
  } else if (exactMatchedRoles.length === 1) {
    roleMatch = 36;
  } else if (domainMatchedRoles.length >= 2) {
    roleMatch = 34;
  } else if (domainMatchedRoles.length === 1) {
    roleMatch = 31;
  } else if (
    /\b(product|marketing|growth|founder|analytics|gtm)\b/i.test(titleLower) &&
    targetRoles.some((r) => /(product|marketing|growth|founder|analyst|gtm|apm|pmm)/i.test(r))
  ) {
    roleMatch = 24;
  } else if (
    /\b(software|engineer|developer|data|ai|ml|frontend|backend|fullstack|full-stack|devops|sde|swe)\b/i.test(
      titleLower
    ) &&
    targetRoles.some((r) => /(engineer|developer|scientist|data|ai|ml|swe|sde|devops)/i.test(r))
  ) {
    roleMatch = 24;
  }

  // 2. Pillar 2: Skill & Proof Coverage (0 - 30 pts) with canonical synonym graph
  const skillsList = profile.skills || [];
  const matchedSkills = skillsList.filter((s) => matchesSkillWithSynonyms(fullText, s));

  const skillDenom = Math.max(3, Math.min(6, skillsList.length || 3));
  const skillCoverageRatio = Math.min(1, matchedSkills.length / skillDenom);
  const skillMatch =
    matchedSkills.length === 0
      ? 4
      : Math.min(30, Math.max(8, Math.round(8 + skillCoverageRatio * 22)));

  // 3. Pillar 3: Seniority & Experience Alignment (0 - 15 pts)
  const candidateYears = profile.experience_years ?? 0;
  const isFresher = candidateYears === 0;
  const requiredYears = eligibility.flags.requiredYears;

  const isExecutiveTitle =
    /\b(director|vp|vice president|principal|head of|chief|staff)\b/i.test(titleLower);
  const isSeniorOrLeadTitle = /\b(senior|sr\.?|lead)\b/i.test(titleLower);

  let seniorityMatch = 13;
  if (
    eligibility.flags.seniorityBlocked ||
    isExecutiveTitle ||
    (isSeniorOrLeadTitle && candidateYears < 2) ||
    (requiredYears !== null && requiredYears >= candidateYears + 3)
  ) {
    seniorityMatch = 3;
  } else if (
    (isSeniorOrLeadTitle && candidateYears < 4) ||
    (requiredYears !== null && requiredYears > candidateYears + 1)
  ) {
    seniorityMatch = 7;
  } else if (
    /\b(fresher|entry[- ]level|associate|junior|0-1|0-2|new grad|graduate|intern|early career)\b/i.test(
      fullText
    )
  ) {
    seniorityMatch = isFresher || candidateYears <= 2 ? 15 : 13;
  } else if (!isFresher) {
    seniorityMatch = 14;
  }

  // 4. Pillar 4: Location, Relocation & Compensation Fit (0 - 15 pts)
  const locLower = (job.location || '').toLowerCase();
  const isTargetCity = eligibility.flags.matchesTargetHub;
  const isIndiaAccessibleRemote = eligibility.flags.isIndiaAccessibleRemote;
  const isPreferredRegion =
    Boolean(profile.open_to_relocation) &&
    (profile.relocation_preference?.preferred_regions || []).some((r) =>
      hasWholeToken(locLower, r.toLowerCase())
    );

  const hasReloSignal =
    !eligibility.flags.workAuthBlocked &&
    /relocation|visa\s*sponsor|accommodation|housing|flight|sponsorship/i.test(fullText);

  const salaryFitScore = evaluateSalaryFloorSignal(
    job.salary || '',
    cleanDescription,
    profile.min_salary_lpa || 8,
    profile.min_salary_usd_annual || 30000
  );

  let compGeoMatch = 7;
  if (eligibility.flags.workAuthBlocked || eligibility.flags.geoBlocked) {
    compGeoMatch = 2;
  } else if (isTargetCity || isIndiaAccessibleRemote) {
    compGeoMatch = 13;
  } else if (isPreferredRegion) {
    compGeoMatch = 12;
  } else if (profile.open_to_relocation) {
    compGeoMatch = 11;
  }
  if (hasReloSignal && compGeoMatch > 2) compGeoMatch += 1;
  compGeoMatch =
    eligibility.flags.workAuthBlocked || eligibility.flags.geoBlocked
      ? 2
      : Math.min(15, Math.max(2, compGeoMatch + salaryFitScore));

  const canonicalSkills = [
    'SQL',
    'A/B Testing',
    'Python',
    'TypeScript',
    'JavaScript',
    'React',
    'Next.js',
    'PostgreSQL',
    'Redis',
    'Mixpanel',
    'Amplitude',
    'HubSpot',
    'Figma',
    'Snowflake',
    'BigQuery',
    'Docker',
    'Kubernetes',
    'PyTorch',
    'dbt',
    'LangChain',
    'GA4',
    'SEO',
    'Cloudflare Workers',
    'Tailwind CSS',
  ];
  const missingSkills = canonicalSkills.filter(
    (s) =>
      hasWholeToken(fullText, s.toLowerCase()) &&
      !matchedSkills.some((ms) => matchesSkillWithSynonyms(s.toLowerCase(), ms))
  );

  const rawTotal = Math.min(
    99,
    Math.max(12, roleMatch + skillMatch + seniorityMatch + compGeoMatch)
  );
  const finalScore = !eligibility.eligible
    ? Math.min(32, rawTotal)
    : seniorityMatch <= 5
    ? Math.min(48, rawTotal)
    : rawTotal;

  const topMetric = profile.key_metrics?.[0] || 'measurable product & growth impact';
  const secondMetric = profile.key_metrics?.[1] || 'end-to-end execution across core KPIs';
  const displaySkills = matchedSkills.length > 0 ? matchedSkills : skillsList.slice(0, 3);
  const skillsStr = displaySkills.slice(0, 3).join(', ');
  const companyLabel = job.company || 'your team';

  const warmFounderDm = `Hi ${companyLabel} team — I noticed the ${job.title} opening and wanted to reach out directly. In my recent work, I delivered ${topMetric} and ${secondMetric} using ${skillsStr}. I'd love to bring that 0-to-1 momentum to ${companyLabel}.`;
  const directMetricDm = `${companyLabel} — applying for ${job.title}. Relevant outcomes: ${topMetric}; ${secondMetric}. Core stack: ${skillsStr}. Portfolio: ${profile.portfolio}. Happy to share a 30-day execution plan.`;
  const peerBuilderDm = `Hey ${companyLabel} builders — saw the ${job.title} role. I recently shipped work resulting in ${topMetric} (${skillsStr}). Excited about what you're building and would welcome a quick chat.`;

  const confidenceLevel: DefendabilityAudit['confidence_level'] =
    !eligibility.eligible
      ? 'LOW'
      : matchedSkills.length >= 3 && roleMatch >= 31
      ? 'HIGH'
      : matchedSkills.length >= 1 && roleMatch >= 22
      ? 'MEDIUM'
      : 'LOW';

  return {
    score: finalScore,
    subscores: {
      role_match: roleMatch,
      skill_match: skillMatch,
      seniority_match: seniorityMatch,
      comp_geo_match: compGeoMatch,
      experience_match: Math.round((seniorityMatch / 15) * 25),
      location_match: Math.round((compGeoMatch / 15) * 20),
      salary_match: Math.round((compGeoMatch / 15) * 15),
      relocation_bonus: hasReloSignal ? 5 : 0,
    },
    matched_skills: matchedSkills.slice(0, 6),
    missing_skills:
      missingSkills.length > 0 ? missingSkills.slice(0, 3) : ['Domain-specific tooling depth'],
    match_reasons: [
      `Role alignment with ${matchedRoles[0] || targetRoles[0] || 'target'} track (${roleMatch}/40 Role)`,
      matchedSkills.length > 0
        ? `Verified skill overlap across ${matchedSkills.slice(0, 3).join(', ')} (${skillMatch}/30 Skill)`
        : `Low direct skill keyword overlap with core stack (${skillMatch}/30 Skill)`,
      `${
        seniorityMatch >= 12
          ? `Calibrated for ${profile.experience_level} (${seniorityMatch}/15 Seniority)`
          : `Seniority stretch or tenure mismatch (${seniorityMatch}/15 Seniority)`
      } · Location/Comp (${compGeoMatch}/15 Comp/Geo)`,
    ],
    gap: !eligibility.eligible
      ? eligibility.reasons[0]
      : seniorityMatch <= 7
      ? `Role lists multi-year tenure expectations; mitigate by leading immediately with ${secondMetric}.`
      : salaryFitScore < 0
      ? `Listed compensation falls below target floor; verify band before investing screening effort.`
      : `Highlight quantitative funnel & systems ownership (${displaySkills.slice(0, 2).join(' + ')}) during screening.`,
    dm_draft: warmFounderDm,
    outreach_tones: {
      warm_founder: warmFounderDm,
      direct_metric: directMetricDm,
      peer_builder: peerBuilderDm,
    },
    cold_email_subject: `${job.title} @ ${job.company} — ${topMetric}`,
    cold_email_body: `Hi ${job.company} team,\n\nI am ${profile.name}, reaching out regarding the ${job.title} role.\n\nSelected highlights from my recent work:\n• ${topMetric}\n• ${secondMetric}\n• Core stack: ${displaySkills.slice(0, 4).join(', ')}\n\nPortfolio & case studies: ${profile.portfolio}\n\nBest regards,\n${profile.name}`,
    resume_angle: `Lead summary with "${secondMetric}" and "${topMetric}", emphasizing ${skillsStr}`,
    relocation_note:
      eligibility.flags.workAuthBlocked || eligibility.flags.geoBlocked
        ? eligibility.reasons[0]
        : hasReloSignal
        ? 'Explicit visa/relocation or housing support detected in specification'
        : isTargetCity
        ? `Located in primary target hub (${(profile.target_cities || []).join(', ')}) — zero relocation friction`
        : isIndiaAccessibleRemote
        ? 'Verified India / global remote eligibility with zero location restrictions'
        : 'Outside target hubs — confirm location flexibility in initial screen',
    defendability: {
      verified_claims: [topMetric, ...matchedSkills.slice(0, 4)],
      inferred_transfers:
        matchedRoles.length > 0 ? [`Transferable execution into ${matchedRoles[0]}`] : [],
      unverified_gaps:
        !eligibility.eligible
          ? eligibility.reasons.slice(0, 3)
          : missingSkills.length > 0
          ? missingSkills.slice(0, 3)
          : ['No unverified profile claims'],
      confidence_level: confidenceLevel,
    },
    engine_used: 'Deterministic 4-Pillar Rubric v3.2',
  };
}

/**
 * Ensures match_reasons always embed exact (xx/40 Role), (xx/30 Skill),
 * (xx/15 Seniority), and (xx/15 Comp/Geo) markers so JobAuditDrawer reports isExact: true.
 */
function ensureExactPillarReasonMarkers(
  rawReasons: string[],
  subscores: { role_match: number; skill_match: number; seniority_match: number; comp_geo_match: number },
  fallbackReasons: string[]
): string[] {
  const base = rawReasons.length >= 3 ? rawReasons.slice(0, 3) : [...fallbackReasons];
  const r0 = /\d{1,2}\/40/.test(base[0] || '')
    ? base[0]
    : `${base[0] || fallbackReasons[0]} (${subscores.role_match}/40 Role)`;
  const r1 = /\d{1,2}\/30/.test(base[1] || '')
    ? base[1]
    : `${base[1] || fallbackReasons[1]} (${subscores.skill_match}/30 Skill)`;
  let r2 = base[2] || fallbackReasons[2];
  if (!/(\d{1,2}\/15\s*(?:pts?\s*)?(?:Seniority|&))|Seniority[^()]*\(\d{1,2}\/15/i.test(r2)) {
    r2 = `${r2} (${subscores.seniority_match}/15 Seniority)`;
  }
  if (!/(\d{1,2}\/15\s*(?:pts?\s*)?(?:Comp|Location))|(?:Comp|Location)[^()]*\(\d{1,2}\/15/i.test(r2)) {
    r2 = `${r2} · Location/Comp (${subscores.comp_geo_match}/15 Comp/Geo)`;
  }
  return [r0, r1, r2];
}

/**
 * Multi-Provider Free LLM Fallback Chain:
 * 1. Gemini 4 Hydrogen Free Tier (@google/genai: gemini-4-hydrogen)
 * 2. Groq Cloud Free Tier (llama-3.3-70b-versatile)
 * 3. OpenRouter Free Tier (llama-3.3-70b-instruct:free -> gemma-3-27b-it:free -> openrouter/free)
 * 4. Deterministic 4-Pillar Rubric Engine
 */
export async function evaluateJobWithFreeChain(
  job: { title: string; company: string; location: string; salary: string; description: string },
  profile: CandidateProfile
): Promise<JobEvaluationResult> {
  const cleanDescription = decodeAndStripHtml(job.description || '');
  const cleanedJob = { ...job, description: cleanDescription };
  const eligibility = evaluateHardEligibility(cleanedJob, profile);
  const baseline = deterministicEvaluateJob(cleanedJob, profile);
  const jdExcerpt = extractHighSignalJdContext(cleanDescription, 3500);

  const strictGeoInstruction = profile.open_to_relocation
    ? `Candidate is open to relocation to ${profile.relocation_preference?.preferred_regions?.join(', ') || 'global hubs'} if sponsorship/relocation is viable; still penalize US/EU roles stating no sponsorship or STEM OPT exclusion.`
    : `STRICT LOCATION RULE: Candidate requires ${profile.target_cities.join(', ')} or genuinely unrestricted India/Worldwide Remote. Assign comp_geo_match <= 2 and cap total score <= 32 if the JD requires US/UK/EU/CA work authorization, states no visa sponsorship / no STEM OPT, or states remote preference/residency/quarterly travel for NYC, Seattle, SF Bay Area, or non-target hubs.`;

  const prompt = `You are a technical recruiting intelligence system evaluating a job opening for ${profile.name}.
Return ONLY valid JSON matching the exact schema below. No markdown fences.

CRITICAL GROUNDING RULE:
- NEVER invent candidate metrics, employers, percentages, years of experience, or tools that are not explicitly listed under CANDIDATE PROFILE.
- Distinguish between "verified_claims" (directly in CANDIDATE PROFILE) and "inferred_transfers" (adjacent transferable capabilities).

CANDIDATE PROFILE:
- Name: ${profile.name}
- Experience: ${profile.experience_level} (${profile.experience_years} full-time years)
- Target Roles: ${profile.target_roles.join(', ')}
- Target Cities: ${profile.target_cities.join(', ')} (Open to relocation: ${profile.open_to_relocation}, Regions: ${profile.relocation_preference?.preferred_regions?.join(', ')})
- Minimum Compensation: ₹${profile.min_salary_lpa} LPA India / $${profile.min_salary_usd_annual} USD abroad
- Quantified Proof Metrics: ${profile.key_metrics.join(' | ')}
- Core Skills: ${profile.skills.join(', ')}

TARGET JOB:
- Title: ${job.title}
- Company: ${job.company}
- Location: ${job.location}
- Listed Compensation: ${job.salary}
- High-Signal Description Excerpt:
${jdExcerpt}

4-PILLAR SCORING RUBRIC (Total 0-100 = sum of 4 pillars):
- role_match (0-40): Alignment with target roles
- skill_match (0-30): Overlap with candidate skills & proof metrics
- seniority_match (0-15): Fit for ${profile.experience_level} (${profile.experience_years} yrs). Score <=5 if 2+ yrs or Senior/Lead/Director required for a 0-year candidate (caps total score at <=32/48).
- comp_geo_match (0-15): ${strictGeoInstruction}

Return JSON with exact evidence-first key order:
{
  "required_experience_years_detected": number | null,
  "is_senior_or_lead_role": boolean,
  "requires_non_india_work_auth_or_no_sponsorship": boolean,
  "remote_restricted_to_non_target_region": boolean,
  "salary_detected": string,
  "location_or_visa_constraint": string,
  "matched_skills": string[],
  "missing_skills": string[],
  "match_reasons": [
    "reason 1 ending with (xx/40 Role)",
    "reason 2 ending with (xx/30 Skill)",
    "reason 3 containing (xx/15 Seniority) and (xx/15 Comp/Geo)"
  ],
  "gap": string,
  "subscores": {
    "role_match": number,
    "skill_match": number,
    "seniority_match": number,
    "comp_geo_match": number
  },
  "outreach_tones": {
    "warm_founder": "3-sentence warm founder/hiring-manager outreach note using a verified proof metric",
    "direct_metric": "Ultra-concise metric-first pitch + portfolio link",
    "peer_builder": "Builder-to-builder engineering/product outreach note"
  },
  "dm_draft": string,
  "cold_email_subject": string,
  "cold_email_body": string,
  "resume_angle": string,
  "relocation_note": string,
  "defendability": {
    "verified_claims": string[],
    "inferred_transfers": string[],
    "unverified_gaps": string[]
  }
}`;

  const clampNum = (val: unknown, fallback: number, min: number, max: number): number => {
    const n = typeof val === 'number' ? val : Number(val);
    return Number.isFinite(n) ? Math.round(Math.min(max, Math.max(min, n))) : fallback;
  };

  const strOr = (val: unknown, fallback: string): string =>
    typeof val === 'string' && val.trim().length > 0 ? val.trim() : fallback;

  const strArrOr = (val: unknown, fallback: string[]): string[] =>
    Array.isArray(val) && val.length > 0 ? val.map((x) => String(x)).filter(Boolean) : fallback;

  const normalizeParsed = (
    parsed: Record<string, unknown>,
    engineLabel: string,
    chainStatus: FallbackChainStatus
  ): JobEvaluationResult => {
    const rawSubs = (parsed.subscores && typeof parsed.subscores === 'object'
      ? parsed.subscores
      : {}) as Record<string, unknown>;

    const role_match = clampNum(rawSubs.role_match, baseline.subscores.role_match, 0, 40);
    const skill_match = clampNum(rawSubs.skill_match, baseline.subscores.skill_match, 0, 30);
    let seniority_match = clampNum(
      rawSubs.seniority_match,
      baseline.subscores.seniority_match,
      0,
      15
    );
    let comp_geo_match = clampNum(
      rawSubs.comp_geo_match,
      baseline.subscores.comp_geo_match,
      0,
      15
    );

    const detectedReqYears =
      typeof parsed.required_experience_years_detected === 'number' &&
      Number.isFinite(parsed.required_experience_years_detected)
        ? parsed.required_experience_years_detected
        : null;
    const candidateYears = profile.experience_years ?? 0;
    const llmFlaggedSeniorityBlocker =
      (parsed.is_senior_or_lead_role === true && candidateYears < 2) ||
      (detectedReqYears !== null && detectedReqYears >= (candidateYears === 0 ? 2 : candidateYears + 2));

    const llmFlaggedGeoOrWorkAuthBlocker =
      parsed.requires_non_india_work_auth_or_no_sponsorship === true ||
      parsed.remote_restricted_to_non_target_region === true;

    if (baseline.subscores.seniority_match <= 5) {
      seniority_match = Math.min(seniority_match, baseline.subscores.seniority_match);
    } else if (llmFlaggedSeniorityBlocker) {
      seniority_match = Math.min(seniority_match, 3);
    }

    if (eligibility.flags.workAuthBlocked || eligibility.flags.geoBlocked || llmFlaggedGeoOrWorkAuthBlocker) {
      comp_geo_match = Math.min(comp_geo_match, 2);
    }

    const subscoreSum = Math.min(
      100,
      Math.max(0, role_match + skill_match + seniority_match + comp_geo_match)
    );
    const hardDisqualified = !eligibility.eligible || llmFlaggedGeoOrWorkAuthBlocker;
    const reconciledScore = hardDisqualified
      ? Math.min(32, subscoreSum)
      : seniority_match <= 5 || baseline.subscores.seniority_match <= 5 || llmFlaggedSeniorityBlocker
      ? Math.min(48, subscoreSum)
      : subscoreSum;

    // Anti-hallucination verification on matched_skills against candidate profile
    const rawMatched = strArrOr(parsed.matched_skills, baseline.matched_skills).slice(0, 8);
    const verifiedMatched: string[] = [];
    const ungroundedTransfers: string[] = [];
    const profileCorpus = `${(profile.skills || []).join(' ')} ${(profile.key_metrics || []).join(' ')}`.toLowerCase();

    for (const sk of rawMatched) {
      const inProfile =
        (profile.skills || []).some((ps) => matchesSkillWithSynonyms(sk.toLowerCase(), ps)) ||
        hasWholeToken(profileCorpus, sk.toLowerCase());
      if (inProfile) {
        verifiedMatched.push(sk);
      } else {
        ungroundedTransfers.push(sk);
      }
    }

    const rawTones =
      parsed.outreach_tones && typeof parsed.outreach_tones === 'object'
        ? (parsed.outreach_tones as Record<string, unknown>)
        : {};
    const warmFounder = strOr(
      rawTones.warm_founder ?? parsed.dm_draft,
      baseline.outreach_tones.warm_founder
    );

    const rawDef =
      parsed.defendability && typeof parsed.defendability === 'object'
        ? (parsed.defendability as Record<string, unknown>)
        : {};

    const matchReasons = ensureExactPillarReasonMarkers(
      strArrOr(parsed.match_reasons, baseline.match_reasons),
      { role_match, skill_match, seniority_match, comp_geo_match },
      baseline.match_reasons
    );

    const effectiveGap = !eligibility.eligible
      ? eligibility.reasons[0]
      : llmFlaggedGeoOrWorkAuthBlocker
      ? strOr(parsed.location_or_visa_constraint, 'Blocked: Non-target geo or work-authorization restriction detected')
      : strOr(parsed.gap, baseline.gap);

    return {
      score: reconciledScore,
      subscores: {
        role_match,
        skill_match,
        seniority_match,
        comp_geo_match,
        experience_match: Math.round((seniority_match / 15) * 25),
        location_match: Math.round((comp_geo_match / 15) * 20),
        salary_match: Math.round((comp_geo_match / 15) * 15),
        relocation_bonus: baseline.subscores.relocation_bonus,
      },
      matched_skills: (verifiedMatched.length > 0 ? verifiedMatched : baseline.matched_skills).slice(
        0,
        6
      ),
      missing_skills: Array.from(
        new Set([
          ...strArrOr(parsed.missing_skills, baseline.missing_skills),
          ...ungroundedTransfers,
        ])
      ).slice(0, 4),
      match_reasons: matchReasons,
      gap: effectiveGap,
      dm_draft: strOr(parsed.dm_draft, warmFounder),
      outreach_tones: {
        warm_founder: warmFounder,
        direct_metric: strOr(rawTones.direct_metric, baseline.outreach_tones.direct_metric),
        peer_builder: strOr(rawTones.peer_builder, baseline.outreach_tones.peer_builder),
      },
      cold_email_subject: strOr(parsed.cold_email_subject, baseline.cold_email_subject),
      cold_email_body: strOr(parsed.cold_email_body, baseline.cold_email_body),
      resume_angle: strOr(parsed.resume_angle, baseline.resume_angle),
      relocation_note:
        eligibility.flags.workAuthBlocked || eligibility.flags.geoBlocked
          ? eligibility.reasons[0]
          : strOr(parsed.relocation_note, baseline.relocation_note),
      defendability: {
        verified_claims: strArrOr(
          rawDef.verified_claims,
          baseline.defendability.verified_claims
        ).slice(0, 5),
        inferred_transfers: Array.from(
          new Set([
            ...strArrOr(rawDef.inferred_transfers, baseline.defendability.inferred_transfers),
            ...ungroundedTransfers.map((u) => `Transferable/Adjacent: ${u}`),
          ])
        ).slice(0, 4),
        unverified_gaps: strArrOr(
          rawDef.unverified_gaps,
          baseline.defendability.unverified_gaps
        ).slice(0, 4),
        confidence_level:
          reconciledScore >= 85 && verifiedMatched.length >= 2
            ? 'HIGH'
            : reconciledScore >= 65
            ? 'MEDIUM'
            : 'LOW',
      },
      engine_used: engineLabel,
      fallback_chain_status: chainStatus,
    };
  };

  const llmResponse = await generateStructuredJSONWithLLM<Record<string, unknown>>(
    prompt,
    'You are a technical recruiting intelligence system. Extract evidence first, cite only verified candidate proof, and return strictly valid JSON.',
    { thinkingLevel: 'MEDIUM' }
  );

  if (
    llmResponse &&
    llmResponse.data &&
    (typeof llmResponse.data.score === 'number' ||
      (llmResponse.data.subscores && typeof llmResponse.data.subscores === 'object'))
  ) {
    return normalizeParsed(
      llmResponse.data,
      llmResponse.engine_used,
      llmResponse.fallback_chain_status
    );
  }

  return {
    ...baseline,
    fallback_chain_status: {
      gemini: process.env.GEMINI_API_KEY ? 'fallback-exhausted' : 'unconfigured',
      groq:
        process.env.GROQ_API_KEY && !process.env.GROQ_API_KEY.startsWith('xai-')
          ? 'fallback-exhausted'
          : 'unconfigured',
      openrouter: process.env.OPENROUTER_API_KEY ? 'fallback-exhausted' : 'unconfigured',
      deterministic: 'active',
    },
  };
}

export const evaluateRoleWithLLM = evaluateJobWithFreeChain;
