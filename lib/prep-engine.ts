import { CandidateProfile, getCandidateProfile } from './profile';
import { generateStructuredJSONWithLLM } from './llm';

export interface RolePrepPack {
  company: string;
  title: string;
  engine_used: string;
  tailored_bullets: string[];
  screening_questions: Array<{
    question: string;
    answer_framework: string;
  }>;
  follow_up_sequence: {
    day_3_nudge: string;
    day_7_value_add: string;
  };
}

export async function generateRolePrepPack(
  job: {
    title: string;
    company: string;
    reasons?: string;
    gap?: string;
    description?: string;
  },
  profileOverride?: CandidateProfile
): Promise<RolePrepPack> {
  const profile = profileOverride || getCandidateProfile();
  const m1 = profile.key_metrics[0] || '~425% organic search growth';
  const m2 = profile.key_metrics[1] || '~1,466% product page view growth';
  const m3 = profile.key_metrics[2] || 'Built automated data & GTM workflows';
  const skillsList = profile.skills.slice(0, 5).join(', ');

  const deterministicPack: RolePrepPack = {
    company: job.company,
    title: job.title,
    engine_used: 'Deterministic STAR Copilot v2.5',
    tailored_bullets: [
      `Spearheaded high-velocity growth & product execution (${m1}), directly transferable to ${job.company}'s ${job.title} roadmap.`,
      `Scaled conversion and product discovery (${m2}) by combining ${skillsList} with rapid funnel experimentation.`,
      `${m3}, reducing manual operational overhead and accelerating 0-to-1 launch cadence.`,
      `Synthesized qualitative user signals and quantitative telemetry into repeatable GTM & product playbooks.`,
    ],
    screening_questions: [
      {
        question: `Why ${job.company} and why the ${job.title} role right now?`,
        answer_framework: `Anchor on ${job.company}'s product velocity and connect immediately to your verified proof: "${m1}" and "${m2}". Explain how you already operate with ${skillsList}.`,
      },
      {
        question: `How do you address the identified role gap (${job.gap || 'domain tenure'})?`,
        answer_framework: `Reframe tenure into output density: walk through the architecture behind "${m2}" and offer a concrete 30-day experiment plan for ${job.company}.`,
      },
      {
        question: `Walk through a high-impact experiment or system you shipped end-to-end.`,
        answer_framework: `Use the STAR method: Situation (baseline bottleneck), Task (growth/engineering objective), Action (leveraging ${skillsList}), Result (${m1}).`,
      },
    ],
    follow_up_sequence: {
      day_3_nudge: `Hi ${job.company} team — following up on my application for ${job.title}. Having driven ${m1} and ${m2} in my recent work, I'd love to share a quick 3-bullet breakdown of growth/product experiments I'd prioritize in my first 30 days at ${job.company}.`,
      day_7_value_add: `Hi ${job.company} team — circling back one last time on the ${job.title} role. I put together a brief teardown of ${job.company}'s current funnel & onboarding flow based on the systems that helped me scale ${m2}. Happy to send it over if useful (${profile.portfolio}).`,
    },
  };

  const prompt = `Generate an executive Role Prep Pack for ${profile.name} applying to "${job.title}" at "${job.company}".
Return ONLY valid JSON matching the exact schema below.

CANDIDATE:
- Name: ${profile.name}
- Experience: ${profile.experience_level}
- Verified Proof Metrics: ${profile.key_metrics.join(' | ')}
- Skills: ${profile.skills.join(', ')}
- Portfolio: ${profile.portfolio}

TARGET ROLE:
- Title: ${job.title}
- Company: ${job.company}
- Fit Reasons: ${job.reasons || 'Strong role alignment'}
- Identified Gap to Mitigate: ${job.gap || 'Emphasize hands-on shipping velocity'}

Return JSON with exact keys:
{
  "tailored_bullets": [
    "4 STAR-format resume bullets rewriting the candidate's real metrics specifically for this role"
  ],
  "screening_questions": [
    {
      "question": "Likely recruiter/hiring manager question 1",
      "answer_framework": "Concrete talking points using candidate metrics"
    },
    {
      "question": "Question 2 addressing the role gap",
      "answer_framework": "Concrete mitigation strategy"
    },
    {
      "question": "Question 3 on technical/functional execution",
      "answer_framework": "Concrete talking points"
    }
  ],
  "follow_up_sequence": {
    "day_3_nudge": "Concise Day-3 follow-up message",
    "day_7_value_add": "Value-add Day-7 follow-up message"
  }
}`;

  const llmRes = await generateStructuredJSONWithLLM<Partial<RolePrepPack>>(
    prompt,
    'You are an executive interview and resume strategist. Output strictly valid JSON.'
  );

  if (
    llmRes &&
    Array.isArray(llmRes.data.tailored_bullets) &&
    llmRes.data.tailored_bullets.length > 0
  ) {
    return {
      company: job.company,
      title: job.title,
      engine_used: llmRes.engine_used,
      tailored_bullets: llmRes.data.tailored_bullets,
      screening_questions:
        Array.isArray(llmRes.data.screening_questions) &&
        llmRes.data.screening_questions.length > 0
          ? llmRes.data.screening_questions
          : deterministicPack.screening_questions,
      follow_up_sequence:
        llmRes.data.follow_up_sequence?.day_3_nudge
          ? llmRes.data.follow_up_sequence
          : deterministicPack.follow_up_sequence,
    };
  }

  return deterministicPack;
}
