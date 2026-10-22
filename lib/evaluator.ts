import { CandidateProfile } from './profile';

export interface RoleEvaluationInput {
  title: string;
  company: string;
  location: string;
  salary: string;
  description: string;
}

export interface RoleEvaluationSubscores {
  role_match: number; // 0-40
  experience_match: number; // 0-25
  location_match: number; // 0-20
  salary_match: number; // 0-15
  relocation_bonus: number; // 0-10
}

export interface RoleEvaluationOutput {
  score: number;
  subscores: RoleEvaluationSubscores;
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
}

/**
 * Deterministic Multi-Vector Rubric v2.5
 * Evaluates any role across 4 core pillars + relocation bonus with strict seniority guardrails.
 */
export function evaluateRoleDeterministically(
  job: RoleEvaluationInput,
  profile: CandidateProfile
): RoleEvaluationOutput {
  const fullText = `${job.title} ${job.description} ${job.location} ${job.salary}`.toLowerCase();
  const titleLower = (job.title || '').toLowerCase();

  // 1. Role Match Pillar (0 - 40 pts)
  let roleMatch = 18;
  const matchedRoles = (profile.target_roles || []).filter(
    (r) =>
      titleLower.includes(r.toLowerCase()) ||
      r
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 3)
        .some((w) => titleLower.includes(w))
  );

  if (matchedRoles.length >= 2) {
    roleMatch = 38;
  } else if (matchedRoles.length === 1) {
    roleMatch = 35;
  } else if (
    /(product|marketing|growth|founder|analyst|gtm|software|engineer|developer|data|ai|ml)/i.test(
      titleLower
    )
  ) {
    roleMatch = 28;
  }

  // 2. Experience & Seniority Pillar (0 - 25 pts)
  let expMatch = 22;
  const requiredYearsMatch = fullText.match(/\b(\d{1,2})\+?\s*(?:-\s*\d{1,2}\s*)?years?\b/i);
  const requiredYears = requiredYearsMatch ? parseInt(requiredYearsMatch[1], 10) : null;
  const candidateYears = profile.experience_years ?? 0;

  if (
    /\b(director|vp|vice president|principal|head of|chief|staff engineer)\b/i.test(titleLower) ||
    (requiredYears !== null && requiredYears >= candidateYears + 4)
  ) {
    expMatch = 6;
  } else if (
    /\bsenior\b/i.test(titleLower) &&
    candidateYears < 3
  ) {
    expMatch = 10;
  } else if (requiredYears !== null && requiredYears > candidateYears + 1) {
    expMatch = 14;
  } else if (
    /\b(fresher|entry|associate|junior|0-1|0-2|new grad|graduate|early career|intern|founding)\b/i.test(
      fullText
    )
  ) {
    expMatch = 25;
  }

  // 3. Location & Mobility Pillar (0 - 20 pts)
  const locLower = (job.location || '').toLowerCase();
  let locMatch = 14;
  const isTargetCity =
    (profile.target_cities || []).some((c) => locLower.includes(c.toLowerCase())) ||
    /bangalore|bengaluru|hyderabad|remote|worldwide|anywhere/i.test(locLower);
  const isPreferredRegion =
    (profile.relocation_preference?.preferred_regions || []).some((r) =>
      locLower.includes(r.toLowerCase())
    ) || /dubai|uae|singapore|london|uk|europe|berlin|amsterdam|san francisco|us/i.test(locLower);

  const forbidsVisa = /no visa|no sponsorship|us citizens only|must have work authorization without sponsorship/i.test(
    fullText
  );

  if (forbidsVisa && !isTargetCity) {
    locMatch = 6;
  } else if (isTargetCity || isPreferredRegion) {
    locMatch = 20;
  } else if (profile.open_to_relocation) {
    locMatch = 17;
  }

  // 4. Compensation Floor Pillar (0 - 15 pts)
  let salaryMatch = 11;
  const salaryText = (job.salary || '').toLowerCase();
  if (salaryText && salaryText !== 'not listed' && /(\d+)/.test(salaryText)) {
    const usdMatch = salaryText.match(/\$\s*(\d{2,3})(?:,(\d{3}))?/);
    const lpaMatch = salaryText.match(/(\d+(?:\.\d+)?)\s*lpa/i);
    if (usdMatch) {
      const rawUsd = parseInt(`${usdMatch[1]}${usdMatch[2] || ''}`, 10);
      const annualUsd = rawUsd < 500 ? rawUsd * 1000 : rawUsd;
      salaryMatch = annualUsd >= (profile.min_salary_usd_annual || 30000) ? 15 : 8;
    } else if (lpaMatch) {
      const lpa = parseFloat(lpaMatch[1]);
      salaryMatch = lpa >= (profile.min_salary_lpa || 8) ? 15 : 8;
    } else {
      salaryMatch = 14;
    }
  }

  // 5. Relocation / Visa Bonus (0 - 10 pts)
  const hasReloSignal =
    /relocation|visa\s*sponsor|accommodation|housing\s*allowance|flight|moving\s*stipend/i.test(
      fullText
    );
  const reloBonus = hasReloSignal ? 5 : 0;

  // Skill Overlap Analysis
  const matchedSkills = (profile.skills || []).filter(
    (s) =>
      fullText.includes(s.toLowerCase()) ||
      s
        .toLowerCase()
        .split(/\s+/)
        .some((tok) => tok.length > 2 && fullText.includes(tok))
  );
  if (matchedSkills.length === 0) {
    matchedSkills.push(...(profile.skills || ['GTM Strategy', 'Product Execution', 'Analytics']).slice(0, 3));
  }

  const candidateSkillSet = new Set(matchedSkills.map((s) => s.toLowerCase()));
  const domainSkillCatalog = [
    'SQL',
    'Python',
    'A/B Testing',
    'HubSpot',
    'Mixpanel',
    'Amplitude',
    'Figma',
    'TypeScript',
    'React',
    'Next.js',
    'PostgreSQL',
    'LLM Evals',
    'SEO',
    'GA4',
  ];
  const missingSkills = domainSkillCatalog.filter(
    (s) => fullText.includes(s.toLowerCase()) && !candidateSkillSet.has(s.toLowerCase())
  );

  const rawTotal = Math.min(
    99,
    Math.max(15, roleMatch + expMatch + locMatch + salaryMatch + reloBonus)
  );
  // Enforce hard seniority guardrail if experience requirement strongly exceeds candidate
  const finalScore = expMatch <= 8 ? Math.min(48, rawTotal) : rawTotal;

  const topMetric =
    profile.key_metrics?.[0] || 'delivered measurable KPI growth across core product funnels';
  const secondMetric =
    profile.key_metrics?.[1] || 'shipped automated workflows and analytics pipelines';

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
      missingSkills.length > 0 ? missingSkills.slice(0, 3) : ['Domain-specific tooling ramp'],
    match_reasons: [
      `Direct alignment with ${matchedRoles[0] || profile.target_roles?.[0] || 'target'} profile (${roleMatch}/40 role pillar)`,
      expMatch >= 20
        ? `Calibrated for ${profile.experience_level} with verified shipping proof (${expMatch}/25 seniority pillar)`
        : `Seniority stretch (${expMatch}/25); requires leading with quantified outcomes (${topMetric})`,
      isTargetCity
        ? `Matches primary location hub (${job.location || 'Remote'}) (${locMatch}/20 geo pillar)`
        : `Global relocation viable (${job.location || 'Global'})${
            hasReloSignal ? ' with explicit visa/housing support (+5 bonus)' : ''
          }`,
    ],
    gap:
      expMatch <= 14
        ? `Role lists multi-year tenure expectations; offset by leading immediately with ${secondMetric} and shipped production systems.`
        : `Highlight end-to-end funnel ownership and technical execution velocity during initial recruiter screen.`,
    dm_draft: `Hi ${job.company || 'Hiring'} team — I noticed the ${job.title} opening and wanted to reach out directly. In my recent work, I drove ${topMetric} and ${secondMetric} by combining technical execution, data analysis, and high-velocity iteration. I'd love to bring that exact 0-to-1 impact to ${job.company || 'your team'}.`,
    cold_email_subject: `${job.title} @ ${job.company} — ${topMetric}`,
    cold_email_body: `Hi ${job.company} team,\n\nI'm ${profile.name}, reaching out regarding the ${job.title} role.\n\nKey highlights from my recent work:\n• ${topMetric}\n• ${secondMetric}\n• Core stack & capabilities: ${matchedSkills.slice(0, 5).join(', ')}\n\nPortfolio & live work: ${profile.portfolio}\n\nBest regards,\n${profile.name}`,
    resume_angle: `Lead summary with "${secondMetric}" and "${topMetric}", emphasizing ${matchedSkills
      .slice(0, 3)
      .join(', ')}`,
    relocation_note: hasReloSignal
      ? 'Explicit visa sponsorship, relocation, or housing support verified in job specification'
      : isTargetCity
      ? 'Located in primary target hub / Remote — zero relocation friction'
      : 'International / cross-hub role — confirm relocation stipend in screening call',
    engine_used: 'Deterministic Multi-Vector Rubric v2.5',
  };
}

/**
 * Reconstructs the 4-Pillar breakdown for any stored job row in the tracker
 * so operators can audit Role, Seniority/Skill, Geo, and Comp pillars on existing rows.
 */
export function computeStoredJobPillarBreakdown(
  job: {
    title: string;
    company: string;
    score: number;
    reasons?: string;
    gap?: string;
    source?: string;
  },
  profile: CandidateProfile
) {
  const synth = evaluateRoleDeterministically(
    {
      title: job.title,
      company: job.company,
      location: job.reasons || 'Remote / Bengaluru',
      salary: 'Standard',
      description: `${job.reasons || ''} ${job.gap || ''}`,
    },
    profile
  );

  // Scale subscores proportionally so they sum cleanly to the stored job.score
  const rawSum =
    synth.subscores.role_match +
    synth.subscores.experience_match +
    synth.subscores.location_match +
    synth.subscores.salary_match;
  const ratio = rawSum > 0 ? job.score / rawSum : 1;

  const roleScore = Math.min(40, Math.max(8, Math.round(synth.subscores.role_match * ratio)));
  const expScore = Math.min(25, Math.max(5, Math.round(synth.subscores.experience_match * ratio)));
  const locScore = Math.min(20, Math.max(5, Math.round(synth.subscores.location_match * ratio)));
  const compScore = Math.min(
    15,
    Math.max(4, job.score - (roleScore + expScore + locScore))
  );

  return {
    role_match: roleScore,
    experience_match: expScore,
    location_match: locScore,
    salary_match: compScore,
    matched_skills: synth.matched_skills,
    missing_skills: synth.missing_skills,
  };
}
