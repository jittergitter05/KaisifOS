import { GoogleGenAI } from '@google/genai';
import Groq from 'groq-sdk';
import { CandidateProfile } from './profile';

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

export interface JobEvaluationResult {
  score: number;
  subscores: FourPillarSubscores;
  matched_skills: string[];
  missing_skills: string[];
  match_reasons: string[];
  gap: string;
  dm_draft: string;
  cold_email_subject: string;
  cold_email_body: string;
  resume_angle: string;
  relocation_note: string;
  engine_used: string;
  fallback_chain_status?: {
    gemini: string;
    groq: string;
    openrouter: string;
    deterministic: string;
  };
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

/**
 * Generic structured JSON helper across the Free Multi-LLM Fallback Chain
 * (Gemini 2.5 Flash -> Groq Llama 3.3 70B -> OpenRouter Free).
 */
export async function generateStructuredJSONWithLLM<T = Record<string, unknown>>(
  prompt: string,
  systemInstruction = 'Output strictly valid JSON.'
): Promise<{ data: T; engine_used: string } | null> {
  const fullPrompt = `${systemInstruction}\n\n${prompt}`;

  // 1. Google Gemini Free Tier
  const ai = getGeminiClient();
  if (ai) {
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: fullPrompt,
        config: {
          responseMimeType: 'application/json',
          temperature: 0.1,
        },
      });
      const text = (response.text || '{}').trim();
      const parsed = JSON.parse(text) as T;
      return { data: parsed, engine_used: 'Gemini 2.5 Flash (Free Tier)' };
    } catch (err) {
      console.warn('[LLM JSON Helper] Gemini fallback triggered:', (err as Error).message);
    }
  }

  // 2. Groq Cloud Free Tier
  if (process.env.GROQ_API_KEY && !process.env.GROQ_API_KEY.startsWith('xai-')) {
    try {
      const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
      const completion = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: systemInstruction },
          { role: 'user', content: prompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
      });
      const text = completion.choices[0]?.message?.content || '{}';
      const parsed = JSON.parse(text) as T;
      return { data: parsed, engine_used: 'Groq Llama 3.3 70B (Free Tier)' };
    } catch (err) {
      console.warn('[LLM JSON Helper] Groq fallback triggered:', (err as Error).message);
    }
  }

  // 3. OpenRouter Free Tier
  if (process.env.OPENROUTER_API_KEY) {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'meta-llama/llama-3.3-70b-instruct:free',
          messages: [
            { role: 'system', content: systemInstruction },
            { role: 'user', content: prompt },
          ],
          response_format: { type: 'json_object' },
          temperature: 0.1,
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        const payload = await res.json();
        const rawText = (payload.choices?.[0]?.message?.content || '{}')
          .replace(/^```json\s*/i, '')
          .replace(/```\s*$/, '')
          .trim();
        const parsed = JSON.parse(rawText) as T;
        return { data: parsed, engine_used: 'OpenRouter Llama 3.3 70B (:free)' };
      }
    } catch (err) {
      console.warn('[LLM JSON Helper] OpenRouter fallback triggered:', (err as Error).message);
    }
  }

  return null;
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
  const fullText =
    `${job.title} ${job.description || ''} ${job.reasons || ''} ${job.location || ''} ${job.salary || ''}`.toLowerCase();
  const titleLower = (job.title || '').toLowerCase();

  // 1. Pillar 1: Role Affinity (0 - 40 pts)
  let roleMatch = 20;
  const matchedRoles = profile.target_roles.filter(
    (r) =>
      titleLower.includes(r.toLowerCase()) ||
      r
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 3)
        .some((w) => titleLower.includes(w))
  );
  if (matchedRoles.length >= 2) roleMatch = 38;
  else if (matchedRoles.length === 1) roleMatch = 35;
  else if (
    /(product|marketing|growth|founder|associate|engineer|developer|analyst|scientist|gtm)/i.test(
      titleLower
    )
  ) {
    roleMatch = 29;
  }

  // 2. Pillar 2: Skill & Proof Coverage (0 - 30 pts)
  const matchedSkills = profile.skills.filter(
    (s) =>
      fullText.includes(s.toLowerCase()) ||
      s
        .toLowerCase()
        .split(/\s+/)
        .some((tok) => tok.length > 2 && fullText.includes(tok))
  );
  if (matchedSkills.length === 0) {
    matchedSkills.push(...profile.skills.slice(0, 3));
  }
  const skillCoverageRatio = Math.min(
    1,
    matchedSkills.length / Math.max(3, Math.min(6, profile.skills.length))
  );
  const skillMatch = Math.min(30, Math.max(14, Math.round(14 + skillCoverageRatio * 15)));

  // 3. Pillar 3: Seniority & Experience Alignment (0 - 15 pts)
  const isFresher = profile.experience_years === 0;
  let seniorityMatch = 13;
  if (
    isFresher &&
    (/\b([4-9]|10)\+?\s*years/i.test(fullText) ||
      /\b(senior|director|vp|principal|head of|staff)\b/i.test(titleLower))
  ) {
    seniorityMatch = 3;
  } else if (isFresher && /\b(2|3)\+?\s*years/i.test(fullText)) {
    seniorityMatch = 8;
  } else if (
    /\b(fresher|entry|associate|junior|0-1|0-2|new grad|graduate|intern|early career)\b/i.test(
      fullText
    )
  ) {
    seniorityMatch = 15;
  } else if (!isFresher) {
    seniorityMatch = 14;
  }

  // 4. Pillar 4: Location, Relocation & Compensation Fit (0 - 15 pts)
  const locLower = (job.location || '').toLowerCase();
  const isTargetCity =
    profile.target_cities.some((c) => locLower.includes(c.toLowerCase())) ||
    /bangalore|bengaluru|hyderabad|remote|worldwide|global/i.test(locLower);
  const isPreferredRegion =
    (profile.relocation_preference?.preferred_regions || []).some((r) =>
      locLower.includes(r.toLowerCase())
    ) || /dubai|uae|singapore|london|uk|europe|berlin|amsterdam/i.test(locLower);

  const hasReloSignal = /relocation|visa|accommodation|housing|flight|sponsorship/i.test(fullText);
  let compGeoMatch = 11;
  if (isTargetCity || isPreferredRegion) compGeoMatch = 14;
  else if (profile.open_to_relocation) compGeoMatch = 12;
  if (hasReloSignal || (job.salary && /(\d+)/.test(job.salary))) {
    compGeoMatch = Math.min(15, compGeoMatch + 1);
  }

  const candidateSkillSet = new Set(matchedSkills.map((s) => s.toLowerCase()));
  const canonicalSkills = [
    'SQL',
    'A/B Testing',
    'Python',
    'TypeScript',
    'Mixpanel',
    'Amplitude',
    'HubSpot',
    'Figma',
    'Snowflake',
    'Docker',
  ];
  const missingSkills = canonicalSkills.filter(
    (s) => fullText.includes(s.toLowerCase()) && !candidateSkillSet.has(s.toLowerCase())
  );

  const rawTotal = Math.min(
    99,
    Math.max(18, roleMatch + skillMatch + seniorityMatch + compGeoMatch)
  );
  const finalScore = seniorityMatch <= 4 ? Math.min(48, rawTotal) : rawTotal;

  const topMetric = profile.key_metrics[0] || 'measurable product & growth impact';
  const secondMetric = profile.key_metrics[1] || 'end-to-end execution across core KPIs';

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
      `Role alignment with ${matchedRoles[0] || profile.target_roles[0]} target track (${roleMatch}/40 pts)`,
      `Skill & proof density across ${matchedSkills.slice(0, 3).join(', ')} (${skillMatch}/30 pts)`,
      seniorityMatch >= 12
        ? `Calibrated for ${profile.experience_level} with verified shipping proof (${seniorityMatch}/15 pts)`
        : `Seniority stretch detected; requires metric-first positioning (${seniorityMatch}/15 pts)`,
    ],
    gap:
      seniorityMatch <= 8
        ? `Role lists multi-year tenure expectations; mitigate by leading immediately with ${secondMetric}.`
        : `Highlight quantitative funnel & systems ownership (${matchedSkills.slice(0, 2).join(' + ')}) during screening.`,
    dm_draft: `Hi ${job.company || 'Hiring'} team — I noticed the ${job.title} opening and wanted to reach out directly. In my recent work, I delivered ${topMetric} and ${secondMetric} by combining ${matchedSkills.slice(0, 3).join(', ')}. I would welcome the opportunity to bring that execution velocity to ${job.company || 'your team'}.`,
    cold_email_subject: `${job.title} @ ${job.company} — ${topMetric}`,
    cold_email_body: `Hi ${job.company} team,\n\nI am ${profile.name}, reaching out regarding the ${job.title} role.\n\nSelected highlights from my recent work:\n• ${topMetric}\n• ${secondMetric}\n• Core stack: ${matchedSkills.slice(0, 4).join(', ')}\n\nPortfolio & case studies: ${profile.portfolio}\n\nBest regards,\n${profile.name}`,
    resume_angle: `Lead summary with "${secondMetric}" and "${topMetric}", emphasizing ${matchedSkills.slice(0, 3).join(', ')}`,
    relocation_note: hasReloSignal
      ? 'Explicit visa/relocation or housing support detected in specification'
      : isTargetCity
      ? 'Located in primary target hub / Remote — zero relocation friction'
      : 'Standard cross-hub role — confirm relocation or remote flexibility in initial screen',
    engine_used: 'Deterministic 4-Pillar Rubric v3.0',
  };
}

/**
 * Multi-Provider Free LLM Fallback Chain:
 * 1. Gemini Free Tier (@google/genai: gemini-2.5-flash)
 * 2. Groq Cloud Free Tier (llama-3.3-70b-versatile)
 * 3. OpenRouter Free Tier (meta-llama/llama-3.3-70b-instruct:free)
 * 4. Deterministic 4-Pillar Rubric Engine
 */
export async function evaluateJobWithFreeChain(
  job: { title: string; company: string; location: string; salary: string; description: string },
  profile: CandidateProfile
): Promise<JobEvaluationResult> {
  const baseline = deterministicEvaluateJob(job, profile);

  const prompt = `You are a technical recruiting intelligence system evaluating a job opening for ${profile.name}.
Return ONLY valid JSON matching the exact schema below. No markdown fences.

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
- Description: ${job.description.substring(0, 1400)}

4-PILLAR SCORING RUBRIC (Total 0-100):
- role_match (0-40): Alignment with target roles
- skill_match (0-30): Overlap with candidate skills & proof metrics
- seniority_match (0-15): Fit for ${profile.experience_level} (${profile.experience_years} yrs). Cap total score at 50 if 2+ years strictly required for a 0-year candidate.
- comp_geo_match (0-15): Target city, remote, relocation support, and salary floor fit.

Return JSON with exact keys:
{
  "score": number,
  "subscores": {
    "role_match": number,
    "skill_match": number,
    "seniority_match": number,
    "comp_geo_match": number
  },
  "matched_skills": string[],
  "missing_skills": string[],
  "match_reasons": [string, string, string],
  "gap": string,
  "dm_draft": string,
  "cold_email_subject": string,
  "cold_email_body": string,
  "resume_angle": string,
  "relocation_note": string
}`;

  const normalizeParsed = (
    parsed: Record<string, unknown>,
    engineLabel: string
  ): JobEvaluationResult => {
    const rawSubs = (parsed.subscores || {}) as Record<string, number>;
    const role_match =
      typeof rawSubs.role_match === 'number'
        ? Math.min(40, Math.max(0, rawSubs.role_match))
        : baseline.subscores.role_match;
    const skill_match =
      typeof rawSubs.skill_match === 'number'
        ? Math.min(30, Math.max(0, rawSubs.skill_match))
        : baseline.subscores.skill_match;
    const seniority_match =
      typeof rawSubs.seniority_match === 'number'
        ? Math.min(15, Math.max(0, rawSubs.seniority_match))
        : baseline.subscores.seniority_match;
    const comp_geo_match =
      typeof rawSubs.comp_geo_match === 'number'
        ? Math.min(15, Math.max(0, rawSubs.comp_geo_match))
        : baseline.subscores.comp_geo_match;

    return {
      ...baseline,
      ...parsed,
      score: Math.min(100, Math.max(0, Number(parsed.score ?? baseline.score))),
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
      engine_used: engineLabel,
    };
  };

  const llmResponse = await generateStructuredJSONWithLLM<Record<string, unknown>>(
    prompt,
    'You are a technical recruiting intelligence system. Return strictly valid JSON.'
  );

  if (llmResponse && typeof llmResponse.data.score === 'number') {
    return normalizeParsed(llmResponse.data, llmResponse.engine_used);
  }

  return baseline;
}

export const evaluateRoleWithLLM = evaluateJobWithFreeChain;
