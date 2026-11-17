export interface EligibilityJobInput {
  title?: string;
  company?: string | { display_name?: string };
  location?: string;
  description?: string;
  salary?: string;
}

export interface EligibilityProfileInput {
  target_roles?: string[];
  target_cities?: string[];
  open_to_relocation?: boolean;
  experience_years?: number;
  experience_level?: string;
}

export interface HardEligibilityResult {
  eligible: boolean;
  reasons: string[];
  flags: {
    workAuthBlocked: boolean;
    geoBlocked: boolean;
    seniorityBlocked: boolean;
    matchesTargetHub: boolean;
    isIndiaAccessibleRemote: boolean;
    hasStrictFresherBlocker: boolean;
    requiredYears: number | null;
    descriptionLength: number;
    hasThinDescription: boolean;
  };
}

export function decodeAndStripHtml(input: string): string;
export function extractRequiredYearsStrict(fullText: string): number | null;
export function buildCanonicalJobKey(
  company: string | { display_name?: string } | undefined | null,
  title: string | undefined | null,
  location?: string | null
): string;
export function getSourceUrlPriority(sourceOrUrl: string | undefined | null): number;
export function evaluateHardEligibility(
  job: EligibilityJobInput,
  profile: EligibilityProfileInput
): HardEligibilityResult;

