import { CandidateProfile } from './profile';
import { generateStructuredJSONWithLLM } from './llm';
import { generateFollowUpDraft } from './outreach-engine';
import { extractHighSignalJdContext } from './utils';

export interface TailoredBulletItem {
  bullet: string;
  grounded_proof: string;
  jd_alignment: string;
}

export interface TailorPackResult {
  tailored_summary: string;
  tailored_bullets: TailoredBulletItem[];
  ats_keywords_matched: string[];
  ats_keywords_to_prep: string[];
  cover_note_subject: string;
  cover_note_body: string;
  followup_bump_1: string;
  followup_bump_2: string;
  engine_used: string;
}

const CANONICAL_ATS_TERMS = [
  'Product Strategy',
  'GTM Strategy',
  'Product Marketing',
  'SEO',
  'GA4',
  'SQL',
  'Python',
  'A/B Testing',
  'Funnel Analytics',
  'User Research',
  'Roadmap',
  'PRD',
  'Mixpanel',
  'Amplitude',
  'HubSpot',
  'Figma',
  'Next.js',
  'TypeScript',
  'React',
  'AI / LLM Workflows',
  'Stakeholder Alignment',
  'Retention',
  'Activation',
  'Pricing & Packaging',
  'Competitive Intelligence',
];

function extractJdKeywords(text: string, profile: CandidateProfile): {
  matched: string[];
  toPrep: string[];
} {
  const jdLower = text.toLowerCase();
  const profileCorpus = `${(profile.skills || []).join(' ')} ${(profile.key_metrics || []).join(' ')} ${(profile.target_roles || []).join(' ')}`.toLowerCase();

  const matched: string[] = [];
  const toPrep: string[] = [];

  for (const skill of profile.skills || []) {
    if (jdLower.includes(skill.toLowerCase())) {
      matched.push(skill);
    }
  }

  for (const term of CANONICAL_ATS_TERMS) {
    const lower = term.toLowerCase();
    const inJd =
      jdLower.includes(lower) ||
      (lower === 'ai / llm workflows' && /\b(ai|llm|genai|agent)\b/i.test(jdLower));
    if (!inJd) continue;
    const inProfile =
      profileCorpus.includes(lower) ||
      (lower === 'ai / llm workflows' && /\b(ai|llm|genai)\b/i.test(profileCorpus));
    if (inProfile) {
      if (!matched.some((m) => m.toLowerCase() === lower)) matched.push(term);
    } else if (!toPrep.some((m) => m.toLowerCase() === lower)) {
      toPrep.push(term);
    }
  }

  if (matched.length === 0) {
    matched.push(...(profile.skills || []).slice(0, 5));
  }

  return {
    matched: Array.from(new Set(matched)).slice(0, 8),
    toPrep: Array.from(new Set(toPrep)).slice(0, 5),
  };
}

export function buildDeterministicTailorPack(
  job: {
    title: string;
    company: string;
    location?: string;
    reasons?: string;
    gap?: string;
    resumeAngle?: string;
    description?: string;
  },
  profile: CandidateProfile
): TailorPackResult {
  const fullContext = `${job.title} ${job.company} ${job.reasons || ''} ${job.gap || ''} ${job.resumeAngle || ''} ${job.description || ''}`;
  const { matched, toPrep } = extractJdKeywords(fullContext, profile);
  const topSkills = matched.slice(0, 4).join(', ');
  const metrics =
    Array.isArray(profile.key_metrics) && profile.key_metrics.length > 0
      ? profile.key_metrics
      : ['Quantified 0-to-1 product & growth execution across core acquisition and activation KPIs'];

  const bullets: TailoredBulletItem[] = metrics.slice(0, 4).map((metric, idx) => {
    const skillFocus = matched[idx % Math.max(1, matched.length)] || profile.skills?.[0] || 'Product & Growth Execution';
    return {
      bullet: `Drove ${metric.replace(/^(drove|scaled|built|delivered)\s+/i, '')}, applying ${skillFocus} to directly mirror ${job.company}'s ${job.title} priorities.`,
      grounded_proof: metric,
      jd_alignment: `${skillFocus} · ${job.title}`,
    };
  });

  if (bullets.length < 3) {
    bullets.push({
      bullet: `Shipped end-to-end execution workflows across ${topSkills || 'product discovery & analytics'}, translating user signals into measurable funnel conversion lifts.`,
      grounded_proof: `Verified core stack: ${topSkills || (profile.skills || []).slice(0, 4).join(', ')}`,
      jd_alignment: job.resumeAngle || `Core execution fit for ${job.title}`,
    });
  }

  const bump1 = generateFollowUpDraft(job, profile, 1);
  const bump2 = generateFollowUpDraft(job, profile, 2);

  const summary = `${profile.experience_level} candidate targeting ${job.title} at ${job.company}, backed by ${metrics[0]}${metrics[1] ? ` and ${metrics[1]}` : ''}. Core verified stack aligned to this role: ${topSkills || (profile.skills || []).slice(0, 4).join(', ')}.`;

  const coverBody = `Dear ${job.company} Hiring Team,\n\nI am applying for the ${job.title} position at ${job.company}. My work sits directly at the intersection of ${topSkills || 'product strategy, growth analytics, and 0-to-1 execution'}.\n\nKey verified outcomes I would bring to ${job.company}:\n• ${metrics[0]}\n${metrics[1] ? `• ${metrics[1]}\n` : ''}• Hands-on fluency across ${(profile.skills || []).slice(0, 6).join(', ')}\n\nFocus for my first 30 days: ${job.resumeAngle || `shipping measurable improvements aligned with ${job.company}'s product and growth KPIs`}.\n\nPortfolio & live case studies: ${profile.portfolio || 'Available on request'}\n\nBest regards,\n${profile.name}`;

  return {
    tailored_summary: summary,
    tailored_bullets: bullets,
    ats_keywords_matched: matched,
    ats_keywords_to_prep: toPrep,
    cover_note_subject: `${job.title} @ ${job.company} — ${profile.name}`,
    cover_note_body: coverBody,
    followup_bump_1: bump1.dm,
    followup_bump_2: bump2.dm,
    engine_used: 'Deterministic Grounded Tailor Engine v1.0',
  };
}

export async function generateGroundedTailorPack(
  job: {
    title: string;
    company: string;
    location?: string;
    reasons?: string;
    gap?: string;
    resumeAngle?: string;
    description?: string;
  },
  profile: CandidateProfile
): Promise<TailorPackResult> {
  const baseline = buildDeterministicTailorPack(job, profile);
  const jdExcerpt = extractHighSignalJdContext(
    `${job.description || ''}\nMatch signals: ${job.reasons || ''}\nGap: ${job.gap || ''}\nLead Angle: ${job.resumeAngle || ''}`,
    3200
  );

  const prompt = `Tailor ATS resume bullets and a concise cover note for ${profile.name} applying to ${job.title} at ${job.company} (${job.location || 'India / Remote'}).

CRITICAL ANTI-FABRICATION RULE:
- NEVER invent numbers, percentages, employers, degrees, or tools not listed under VERIFIED CANDIDATE PROOF below.
- Every rewritten bullet MUST clearly trace back to a verified metric or verified skill below.

VERIFIED CANDIDATE PROOF:
- Name: ${profile.name}
- Level: ${profile.experience_level} (${profile.experience_years} yrs)
- Portfolio: ${profile.portfolio}
- Verified Quantified Metrics: ${(profile.key_metrics || []).join(' | ')}
- Verified Skills: ${(profile.skills || []).join(', ')}

TARGET ROLE CONTEXT:
${jdExcerpt}

Return strictly valid JSON:
{
  "tailored_summary": "2-sentence ATS-ready summary mirroring JD language using only verified candidate proof",
  "tailored_bullets": [
    {
      "bullet": "Action-verb STAR resume bullet incorporating JD terminology + exact verified metric",
      "grounded_proof": "Exact metric/skill from VERIFIED CANDIDATE PROOF",
      "jd_alignment": "Short label of which JD requirement this addresses"
    }
  ],
  "ats_keywords_matched": ["up to 8 exact JD keywords candidate genuinely has"],
  "ats_keywords_to_prep": ["up to 5 JD keywords not in profile to address honestly in interview"],
  "cover_note_subject": "Concise high-open-rate email subject",
  "cover_note_body": "160-word crisp, metric-first hiring manager cover note with portfolio link",
  "followup_bump_1": "2-sentence Day-5 polite follow-up note",
  "followup_bump_2": "2-sentence Day-11 value-add follow-up note"
}`;

  const llmRes = await generateStructuredJSONWithLLM<Partial<TailorPackResult>>(
    prompt,
    'You are an executive ATS resume strategist. Rewrite candidate proof to mirror target JD keywords with ZERO fabricated facts. Output strictly valid JSON.',
    { thinkingLevel: 'LOW' }
  );

  if (!llmRes || !llmRes.data) {
    return baseline;
  }

  const d = llmRes.data;
  const rawBullets = Array.isArray(d.tailored_bullets)
    ? (d.tailored_bullets as unknown[])
        .map((item) => {
          if (typeof item === 'string' && item.trim()) {
            return {
              bullet: item.trim(),
              grounded_proof: profile.key_metrics?.[0] || 'Verified profile proof',
              jd_alignment: job.title,
            };
          }
          if (item && typeof item === 'object') {
            const obj = item as { bullet?: unknown; grounded_proof?: unknown; jd_alignment?: unknown };
            if (typeof obj.bullet === 'string' && obj.bullet.trim()) {
              return {
                bullet: obj.bullet.trim(),
                grounded_proof: String(obj.grounded_proof || profile.key_metrics?.[0] || 'Verified profile proof').trim(),
                jd_alignment: String(obj.jd_alignment || job.title).trim(),
              };
            }
          }
          return null;
        })
        .filter((x): x is TailoredBulletItem => Boolean(x))
        .slice(0, 4)
    : [];

  return {
    tailored_summary:
      typeof d.tailored_summary === 'string' && d.tailored_summary.trim().length > 20
        ? d.tailored_summary.trim()
        : baseline.tailored_summary,
    tailored_bullets: rawBullets.length > 0 ? rawBullets : baseline.tailored_bullets,
    ats_keywords_matched:
      Array.isArray(d.ats_keywords_matched) && d.ats_keywords_matched.length > 0
        ? d.ats_keywords_matched.map((k) => String(k).trim()).filter(Boolean).slice(0, 8)
        : baseline.ats_keywords_matched,
    ats_keywords_to_prep:
      Array.isArray(d.ats_keywords_to_prep) && d.ats_keywords_to_prep.length > 0
        ? d.ats_keywords_to_prep.map((k) => String(k).trim()).filter(Boolean).slice(0, 5)
        : baseline.ats_keywords_to_prep,
    cover_note_subject:
      typeof d.cover_note_subject === 'string' && d.cover_note_subject.trim()
        ? d.cover_note_subject.trim()
        : baseline.cover_note_subject,
    cover_note_body:
      typeof d.cover_note_body === 'string' && d.cover_note_body.trim().length > 40
        ? d.cover_note_body.trim()
        : baseline.cover_note_body,
    followup_bump_1:
      typeof d.followup_bump_1 === 'string' && d.followup_bump_1.trim().length > 20
        ? d.followup_bump_1.trim()
        : baseline.followup_bump_1,
    followup_bump_2:
      typeof d.followup_bump_2 === 'string' && d.followup_bump_2.trim().length > 20
        ? d.followup_bump_2.trim()
        : baseline.followup_bump_2,
    engine_used: llmRes.engine_used,
  };
}

export function formatTailorPackAsMarkdown(
  pack: TailorPackResult,
  job: { title: string; company: string; location?: string; url?: string }
): string {
  const lines = [
    `# ATS Tailor Brief — ${job.title} @ ${job.company}`,
    job.location ? `**Location:** ${job.location}` : '',
    job.url ? `**Apply URL:** ${job.url}` : '',
    `**Engine:** ${pack.engine_used}`,
    '',
    '## Tailored Summary',
    pack.tailored_summary,
    '',
    '## Grounded STAR Resume Bullets',
    ...pack.tailored_bullets.map(
      (b, idx) =>
        `${idx + 1}. ${b.bullet}\n   - *Grounded Proof:* ${b.grounded_proof}\n   - *JD Alignment:* ${b.jd_alignment}`
    ),
    '',
    `## ATS Keywords Matched`,
    pack.ats_keywords_matched.join(' · '),
    '',
    ...(pack.ats_keywords_to_prep.length > 0
      ? [`## Keywords to Address Honestly in Interview`, pack.ats_keywords_to_prep.join(' · '), '']
      : []),
    '## Cover Note',
    `**Subject:** ${pack.cover_note_subject}`,
    '',
    pack.cover_note_body,
    '',
    '## Follow-Up Cadence',
    `- **Day 5 Bump #1:** ${pack.followup_bump_1}`,
    `- **Day 11 Bump #2:** ${pack.followup_bump_2}`,
  ];
  return lines.filter((l) => l !== undefined).join('\n');
}
