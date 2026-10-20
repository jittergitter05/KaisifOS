import { NextRequest, NextResponse } from 'next/server';
import Groq from 'groq-sdk';
import fs from 'fs';
import path from 'path';

interface ProfileData {
  name: string;
  email: string;
  target_roles: string[];
  target_cities: string[];
  open_to_relocation: boolean;
  relocation_preference: {
    willing: boolean;
    requirements: string[];
    preferred_regions: string[];
    avoid: string[];
  };
  min_salary_lpa: number;
  min_salary_usd_annual: number;
  experience_years: number;
  experience_level: string;
  portfolio: string;
  key_metrics: string[];
  skills: string[];
  languages: string[];
  resume_synthesizer_url: string;
}

function loadProfile(): ProfileData {
  const profilePath = path.join(process.cwd(), 'data', 'profile.json');
  return JSON.parse(fs.readFileSync(profilePath, 'utf8'));
}

function deterministicEvaluate(
  job: { title: string; company: string; location: string; salary: string; description: string },
  profile: ProfileData
) {
  const fullText = `${job.title} ${job.description} ${job.location} ${job.salary}`.toLowerCase();
  const titleLower = job.title.toLowerCase();

  let roleMatch = 18;
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
  else if (matchedRoles.length === 1) roleMatch = 34;
  else if (/(product|marketing|growth|founder|analyst|gtm)/i.test(titleLower)) roleMatch = 28;

  let expMatch = 22;
  if (
    /\b([4-9]|10)\+?\s*years/i.test(fullText) ||
    /\b(senior|director|vp|principal|head of)\b/i.test(titleLower)
  ) {
    expMatch = 6;
  } else if (/\b(2|3)\+?\s*years/i.test(fullText)) {
    expMatch = 14;
  } else if (
    /\b(fresher|entry|associate|junior|0-1|0-2|new grad|graduate)\b/i.test(fullText)
  ) {
    expMatch = 25;
  }

  const locLower = (job.location || '').toLowerCase();
  let locMatch = 15;
  const isTargetCity =
    profile.target_cities.some((c) => locLower.includes(c.toLowerCase())) ||
    /bangalore|bengaluru|hyderabad|remote/i.test(locLower);
  const isPreferredRegion =
    (profile.relocation_preference?.preferred_regions || []).some((r) =>
      locLower.includes(r.toLowerCase())
    ) || /dubai|uae|singapore|london|uk|europe|berlin|amsterdam/i.test(locLower);

  if (isTargetCity || isPreferredRegion) locMatch = 20;
  else if (profile.open_to_relocation) locMatch = 17;

  let salaryMatch = 12;
  if (job.salary && /(\d+)/.test(job.salary)) {
    salaryMatch = 14;
  }

  const hasReloSignal = /relocation|visa|accommodation|housing|flight|sponsorship/i.test(fullText);
  const reloBonus = hasReloSignal ? 5 : 0;

  const matchedSkills = profile.skills.filter(
    (s) =>
      fullText.includes(s.toLowerCase()) ||
      s
        .toLowerCase()
        .split(/\s+/)
        .some((tok) => tok.length > 2 && fullText.includes(tok))
  );
  if (matchedSkills.length === 0) {
    matchedSkills.push('GTM Strategy', 'Product Marketing', 'Growth Marketing');
  }

  const candidateSkillSet = new Set(matchedSkills.map((s) => s.toLowerCase()));
  const commonJobSkills = [
    'SQL',
    'A/B Testing',
    'HubSpot',
    'Mixpanel',
    'Amplitude',
    'Figma',
    'Copywriting',
  ];
  const missingSkills = commonJobSkills.filter(
    (s) => fullText.includes(s.toLowerCase()) && !candidateSkillSet.has(s.toLowerCase())
  );

  const rawTotal = Math.min(
    99,
    Math.max(15, roleMatch + expMatch + locMatch + salaryMatch + reloBonus)
  );
  const finalScore = expMatch <= 8 ? Math.min(48, rawTotal) : rawTotal;

  const topMetric = profile.key_metrics[0] || '~425% organic search growth at Smatr AI';
  const secondMetric = profile.key_metrics[1] || '~1,466% product page view growth at Smatr AI';

  return {
    score: finalScore,
    subscores: {
      role_match: roleMatch,
      experience_match: expMatch,
      location_match: locMatch,
      salary_match: salaryMatch,
      relocation_bonus: reloBonus,
    },
    matched_skills: matchedSkills.slice(0, 6),
    missing_skills:
      missingSkills.length > 0 ? missingSkills.slice(0, 3) : ['Enterprise CRM administration'],
    match_reasons: [
      `Strong alignment with ${matchedRoles[0] || profile.target_roles[0]} target profile (${roleMatch}/40 role score)`,
      expMatch >= 20
        ? `Calibrated for ${profile.experience_level} with high-velocity shipping proof (${expMatch}/25 exp score)`
        : `Seniority stretch detected; requires strong metric-first positioning (${expMatch}/25 exp score)`,
      isTargetCity
        ? `Direct match with primary target hub (${job.location || 'Remote'})`
        : `Global relocation viable (${job.location || 'Global'})${
            hasReloSignal ? ' with explicit visa/relocation support' : ''
          }`,
    ],
    gap:
      expMatch <= 14
        ? `Role lists multi-year tenure expectations; offset by leading immediately with ${secondMetric} and shipped AI systems.`
        : `Emphasize quantitative funnel ownership (GA4 + Python EDA) alongside community GTM execution during screening.`,
    dm_draft: `Hi ${job.company || 'Hiring'} team — I noticed the ${job.title} opening and wanted to reach out directly. At Smatr AI, I drove ${topMetric} and ${secondMetric} by combining technical SEO, Python EDA, and community distribution across Reddit & Discord. I'd love to bring that exact 0-to-1 growth velocity to ${job.company || 'your team'}.`,
    cold_email_subject: `${job.title} @ ${job.company} — 1,466% product page growth & GTM systems`,
    cold_email_body: `Hi ${job.company} team,\n\nI'm ${profile.name}, applying for the ${job.title} role.\n\nIn my recent work at Smatr AI, I:\n• Drove ${topMetric}\n• Scaled ${secondMetric}\n• Built a 2,000+ record digital contact database and automated GTM workflows with Python & Cloudflare Workers\n\nPortfolio & live case studies: ${profile.portfolio}\n\nBest regards,\n${profile.name}`,
    resume_angle: `Lead summary with "${secondMetric}" and "${topMetric}", highlighting ${matchedSkills
      .slice(0, 3)
      .join(', ')}`,
    relocation_note: hasReloSignal
      ? 'Explicit visa/relocation or housing support detected in job specification'
      : isTargetCity
      ? 'Located in primary target hub / Remote — zero relocation friction'
      : 'Standard international/cross-city role — inquire about relocation stipend in round 1',
    engine_used: 'Deterministic Multi-Vector Rubric v2.4',
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const job = {
      title: String(body.title || 'Associate Product Marketing Manager').trim(),
      company: String(body.company || 'Acme AI').trim(),
      location: String(body.location || 'Bengaluru / Remote').trim(),
      salary: String(body.salary || '₹12 LPA / $45,000 USD').trim(),
      description: String(body.description || '').trim(),
    };

    const profile = loadProfile();
    const baseline = deterministicEvaluate(job, profile);

    const prompt = `You are an elite recruiting intelligence engine evaluating a job opening for ${profile.name}.
Return ONLY valid JSON matching the schema below.

CANDIDATE PROFILE:
- Name: ${profile.name}
- Experience: ${profile.experience_level} (${profile.experience_years} full-time years)
- Target Roles: ${profile.target_roles.join(', ')}
- Target Cities: ${profile.target_cities.join(', ')} (Open to relocation: ${profile.open_to_relocation}, Preferred regions: ${profile.relocation_preference?.preferred_regions?.join(', ')})
- Minimum Salary: ₹${profile.min_salary_lpa} LPA India / $${profile.min_salary_usd_annual} USD abroad
- Verified Key Metrics: ${profile.key_metrics.join(' | ')}
- Core Skills: ${profile.skills.join(', ')}

TARGET JOB:
- Title: ${job.title}
- Company: ${job.company}
- Location: ${job.location}
- Listed Compensation: ${job.salary}
- Description: ${job.description.substring(0, 1200)}

SCORING RUBRIC (Total 0-100):
- role_match (0-40): Alignment with target roles
- experience_match (0-25): Fit for ${profile.experience_level} (${profile.experience_years} yrs). Cap total score at 50 if 2+ years strictly required.
- location_match (0-20): Target city, remote, or relocation-friendly region
- salary_match (0-15): Meets salary floor (10/15 if unlisted)
- relocation_bonus (0-10): Explicit relocation/visa/housing support

Return JSON with exact keys:
{
  "score": number,
  "subscores": {
    "role_match": number,
    "experience_match": number,
    "location_match": number,
    "salary_match": number,
    "relocation_bonus": number
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

    if (process.env.GEMINI_API_KEY) {
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: { responseMimeType: 'application/json' },
            }),
          }
        );
        if (res.ok) {
          const data = await res.json();
          const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
          const parsed = JSON.parse(text);
          if (typeof parsed.score === 'number') {
            return NextResponse.json({
              ...baseline,
              ...parsed,
              subscores: { ...baseline.subscores, ...(parsed.subscores || {}) },
              engine_used: 'Gemini 2.5 Flash',
            });
          }
        }
      } catch (geminiErr) {
        console.warn('[Evaluate API] Gemini call failed, trying fallback:', geminiErr);
      }
    }

    if (process.env.GROQ_API_KEY && !process.env.GROQ_API_KEY.startsWith('xai-')) {
      try {
        const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
        const completion = await groq.chat.completions.create({
          model: 'llama-3.3-70b-versatile',
          messages: [{ role: 'user', content: prompt }],
          response_format: { type: 'json_object' },
          temperature: 0.1,
        });
        const text = completion.choices[0]?.message?.content || '{}';
        const parsed = JSON.parse(text);
        if (typeof parsed.score === 'number') {
          return NextResponse.json({
            ...baseline,
            ...parsed,
            subscores: { ...baseline.subscores, ...(parsed.subscores || {}) },
            engine_used: 'Groq Llama 3.3 70B Versatile',
          });
        }
      } catch (groqErr) {
        console.warn('[Evaluate API] Groq call failed, using deterministic engine:', groqErr);
      }
    }

    return NextResponse.json(baseline);
  } catch (err) {
    console.error('[Evaluate API] Error:', err);
    return NextResponse.json({ error: 'Failed to evaluate job' }, { status: 500 });
  }
}
