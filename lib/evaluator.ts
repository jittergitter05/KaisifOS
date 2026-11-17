import { CandidateProfile } from './profile';
import { deterministicEvaluateJob, FourPillarSubscores } from './llm';
import { deriveJobPillarBreakdown } from './utils';

export interface RoleEvaluationInput {
  title: string;
  company: string;
  location: string;
  salary: string;
  description: string;
}

export type RoleEvaluationSubscores = FourPillarSubscores;

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
 * Canonical 4-Pillar Deterministic Rubric (40 Role / 30 Skill / 15 Seniority / 15 CompGeo).
 * Delegates directly to lib/llm.ts so only one source of truth exists across the app.
 */
export function evaluateRoleDeterministically(
  job: RoleEvaluationInput,
  profile: CandidateProfile
): RoleEvaluationOutput {
  return deterministicEvaluateJob(job, profile);
}

/**
 * Reconstructs the canonical 4-Pillar breakdown (40 / 30 / 15 / 15) for any stored job row.
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
  const breakdown = deriveJobPillarBreakdown(job);
  const synth = deterministicEvaluateJob(
    {
      title: job.title,
      company: job.company,
      location: job.reasons || 'Remote / Bengaluru',
      salary: 'Standard',
      description: `${job.reasons || ''} ${job.gap || ''}`,
    },
    profile
  );

  return {
    role_match: breakdown.role.earned,
    skill_match: breakdown.skill.earned,
    seniority_match: breakdown.seniority.earned,
    comp_geo_match: breakdown.compGeo.earned,
    experience_match: breakdown.seniority.earned,
    location_match: breakdown.compGeo.earned,
    salary_match: breakdown.compGeo.earned,
    matched_skills: synth.matched_skills,
    missing_skills: synth.missing_skills,
  };
}

