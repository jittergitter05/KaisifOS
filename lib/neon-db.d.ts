import type { CandidateProfile } from './profile-presets';

export interface NeonSourceRef {
  source: string;
  url: string;
  id?: string;
  seenAt?: string;
}

export interface NeonCanonicalState {
  canonicalKey: string;
  id: string;
  score: number;
  status: string;
  evaluationStatus: string;
  needsLlmRetry: boolean;
  url: string;
  sourcesSeen: NeonSourceRef[];
}

export interface NeonPipelineJob {
  canonicalKey: string;
  id: string;
  date: string;
  title: string;
  company: string;
  location: string;
  salary: string;
  description?: string;
  descriptionSnippet?: string;
  score: number;
  reasons: string;
  gap: string;
  url: string;
  source?: string;
  dm: string;
  emailDraft: string;
  resumeAngle: string;
  status: string;
  evaluationStatus: string;
  needsLlmRetry: boolean;
  sourcesSeen: NeonSourceRef[];
}

export interface NeonJobUpsertInput {
  id?: string;
  canonicalKey?: string;
  date?: string;
  title?: string;
  company?: string;
  location?: string;
  salary?: string;
  description?: string;
  descriptionSnippet?: string;
  url?: string;
  source?: string;
  sourcesSeen?: NeonSourceRef[];
  score?: number;
  evaluationStatus?: string;
  needsLlmRetry?: boolean;
  status?: string;
  pipelineStage?: string;
  reasons?: string;
  hardRejectReason?: string;
  gap?: string;
  dm?: string;
  dmDraft?: string;
  emailDraft?: string;
  resumeAngle?: string;
  subscores?: Record<string, unknown>;
}

export interface NeonScoutRunTelemetry {
  mode?: string;
  runner?: string;
  totalFetched?: number;
  rawFetched?: number;
  canonicalDedupSaved?: number;
  hardGateRejected?: number;
  evaluatedCount?: number;
  committedCount?: number;
  queuedForRetry?: number;
  queuedForRetryCount?: number;
  durationMs?: number;
  sourceCounts?: Record<string, number>;
  hardGateReasons?: Record<string, number>;
  rejectionBreakdown?: Record<string, number>;
}

export interface NeonTelemetrySummary {
  activeJobs: number;
  rejectedGateJobs: number;
  pendingRetryJobs: number;
  multiSourceMergedJobs: number;
  lastRun: Record<string, unknown> | null;
}

export function sanitizePostgresErrorMessage(err: unknown): string;
export function isNeonPostgresConfigured(): boolean;
export function computeProfileVersionHash(profile: Partial<CandidateProfile>): string;
export function ensureNeonSchema(): Promise<boolean>;
export function getNeonCanonicalStateMap(): Promise<Map<string, NeonCanonicalState>>;
export function getNeonJobsPendingLlmRetry(limit?: number): Promise<NeonPipelineJob[]>;
export function getNeonAppliedJobs(limit?: number): Promise<Array<{
  canonicalKey: string;
  id: string;
  title: string;
  company: string;
}>>;
export function upsertNeonCanonicalJob(
  record: NeonJobUpsertInput
): Promise<{ ok: boolean; merged: boolean; error?: string }>;
export function getNeonPipelineJobs(options?: {
  includeRetryPending?: boolean;
}): Promise<NeonPipelineJob[] | null>;
export function updateNeonJobFields(
  target: { id?: string; canonicalKey?: string },
  patch: {
    status?: string;
    dm?: string;
    emailDraft?: string;
    resumeAngle?: string;
    gap?: string;
    score?: number;
    reasons?: string;
    evaluationStatus?: string;
    needsLlmRetry?: boolean;
  }
): Promise<boolean>;
export function batchUpdateNeonJobStage(
  targets: Array<{ id?: string; canonicalKey?: string }>,
  status: string
): Promise<number>;
export function readNeonCandidateProfile(): Promise<Partial<CandidateProfile> | null>;
export function writeNeonCandidateProfile(profile: CandidateProfile): Promise<boolean>;
export function recordNeonScoutRun(telemetry: NeonScoutRunTelemetry): Promise<boolean>;
export function getNeonTelemetrySummary(): Promise<NeonTelemetrySummary | null>;
