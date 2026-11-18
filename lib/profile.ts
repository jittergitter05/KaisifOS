import { siteConfig } from '../config/site';
import {
  CandidateProfile,
  DEFAULT_ATS_COMPANIES,
  DEFAULT_CAREER_URLS,
  FORK_PROFILE_TEMPLATES,
  parseWorkdayBoardTarget,
  type WorkdayBoardTarget,
} from './profile-presets';
import {
  isCloudSheetsConfigured,
  readCloudProfileJson,
  readRuntimeJsonFile,
  writeCloudProfileJson,
  writeRuntimeJsonFile,
} from './sheets';
import {
  isNeonPostgresConfigured,
  readNeonCandidateProfile,
  writeNeonCandidateProfile,
  computeProfileVersionHash,
} from './neon-db.js';

export * from './profile-presets';

export type ProfilePersistenceMode =
  | 'neon-postgres'
  | 'cloud-sheets'
  | 'local-disk'
  | 'ephemeral-tmp'
  | 'read-only';

export interface SaveProfileResult {
  ok: boolean;
  profile: CandidateProfile;
  persistenceMode: ProfilePersistenceMode;
  cloudSaved: boolean;
  localSaved: boolean;
  warning?: string;
  error?: string;
}

interface CloudProfileCache {
  profile: CandidateProfile;
  fetchedAt: number;
}

let cloudProfileCache: CloudProfileCache | null = null;
const CLOUD_PROFILE_TTL_MS = 5000;

export function normalizeCandidateProfile(
  raw: Partial<CandidateProfile> | null | undefined,
  fallback: CandidateProfile = FORK_PROFILE_TEMPLATES.pm_growth
): CandidateProfile {
  const base = fallback;
  const parsed = raw && typeof raw === 'object' ? raw : {};

  const cleanStr = (val: unknown, def: string, maxLen = 160) =>
    typeof val === 'string' && val.trim().length > 0 ? val.trim().slice(0, maxLen) : def;

  const cleanArr = (val: unknown, def: string[]) =>
    Array.isArray(val) && val.length > 0
      ? val.map((x) => String(x).trim()).filter(Boolean)
      : def;

  const cleanSlugArr = (val: unknown, def: string[]) =>
    Array.isArray(val)
      ? val
          .map((x) => String(x).trim().toLowerCase())
          .filter(Boolean)
      : def;

  const rawSystemName = cleanStr(parsed.system_name, siteConfig.name, 80);
  const systemName =
    rawSystemName !== 'CareerOS' && rawSystemName !== 'OpenScout'
      ? rawSystemName
      : siteConfig.name;

  const expYearsRaw = Number(parsed.experience_years);
  const expYears = Number.isFinite(expYearsRaw)
    ? Math.max(0, Math.min(40, Math.round(expYearsRaw)))
    : base.experience_years;

  const minLpaRaw = Number(parsed.min_salary_lpa);
  const minLpa = Number.isFinite(minLpaRaw) && minLpaRaw > 0 ? Math.round(minLpaRaw) : base.min_salary_lpa;

  const minUsdRaw = Number(parsed.min_salary_usd_annual);
  const minUsd =
    Number.isFinite(minUsdRaw) && minUsdRaw > 0 ? Math.round(minUsdRaw) : base.min_salary_usd_annual;

  const rawAts =
    parsed.ats_companies && typeof parsed.ats_companies === 'object'
      ? parsed.ats_companies
      : DEFAULT_ATS_COMPANIES;

  const rawReloc =
    parsed.relocation_preference && typeof parsed.relocation_preference === 'object'
      ? parsed.relocation_preference
      : base.relocation_preference;

  return {
    name: cleanStr(parsed.name, base.name, 100),
    system_name: systemName,
    email: cleanStr(parsed.email, base.email, 160),
    portfolio: cleanStr(parsed.portfolio, base.portfolio, 240),
    target_roles: cleanArr(parsed.target_roles, base.target_roles),
    target_cities: cleanArr(parsed.target_cities, base.target_cities),
    open_to_relocation:
      typeof parsed.open_to_relocation === 'boolean'
        ? parsed.open_to_relocation
        : base.open_to_relocation,
    enable_internshala:
      typeof parsed.enable_internshala === 'boolean'
        ? parsed.enable_internshala
        : Boolean(base.enable_internshala),
    relocation_preference: {
      willing:
        typeof rawReloc?.willing === 'boolean'
          ? rawReloc.willing
          : base.relocation_preference.willing,
      requirements: cleanArr(
        rawReloc?.requirements,
        base.relocation_preference.requirements
      ),
      preferred_regions: cleanArr(
        rawReloc?.preferred_regions,
        base.relocation_preference.preferred_regions
      ),
      avoid: cleanArr(
        rawReloc?.avoid,
        base.relocation_preference.avoid
      ),
    },
    experience_level: cleanStr(parsed.experience_level, base.experience_level, 80),
    experience_years: expYears,
    key_metrics: cleanArr(parsed.key_metrics, base.key_metrics),
    skills: cleanArr(parsed.skills, base.skills),
    min_salary_lpa: minLpa,
    min_salary_usd_annual: minUsd,
    languages: cleanArr(parsed.languages, base.languages),
    resume_synthesizer_url: cleanStr(
      parsed.resume_synthesizer_url,
      base.resume_synthesizer_url,
      240
    ),
    ats_companies: {
      greenhouse: cleanSlugArr(rawAts.greenhouse, DEFAULT_ATS_COMPANIES.greenhouse),
      lever: cleanSlugArr(rawAts.lever, DEFAULT_ATS_COMPANIES.lever),
      ashby: cleanSlugArr(rawAts.ashby, DEFAULT_ATS_COMPANIES.ashby),
      workable: cleanSlugArr(rawAts.workable, DEFAULT_ATS_COMPANIES.workable || []),
      smartrecruiters: Array.isArray(rawAts.smartrecruiters)
        ? rawAts.smartrecruiters.map((x) => String(x).trim()).filter(Boolean)
        : DEFAULT_ATS_COMPANIES.smartrecruiters || [],
      recruitee: cleanSlugArr(rawAts.recruitee, DEFAULT_ATS_COMPANIES.recruitee || []),
      workday: Array.isArray(rawAts.workday)
        ? rawAts.workday
            .map((x) => parseWorkdayBoardTarget(x))
            .filter((x): x is WorkdayBoardTarget => Boolean(x))
            .slice(0, 16)
        : DEFAULT_ATS_COMPANIES.workday || [],
    },
    career_urls: Array.isArray(parsed.career_urls)
      ? parsed.career_urls
          .map((x) => String(x).trim())
          .filter((u) => /^https?:\/\//i.test(u))
          .slice(0, 20)
      : base.career_urls ?? DEFAULT_CAREER_URLS,
  };
}

/**
 * Synchronous runtime reader checking custom dir -> /tmp overlay -> bundled data/profile.json -> preset fallback.
 */
export function getCandidateProfile(): CandidateProfile {
  try {
    const parsed = readRuntimeJsonFile<Partial<CandidateProfile> | null>('profile.json', null);
    if (!parsed) return FORK_PROFILE_TEMPLATES.pm_growth;
    return normalizeCandidateProfile(parsed);
  } catch {
    return FORK_PROFILE_TEMPLATES.pm_growth;
  }
}

/**
 * Multi-tier async profile reader:
 * 1. Short 5s memory cache (invalidated immediately on save)
 * 2. Neon Postgres candidate_profiles table (when DATABASE_URL is configured)
 * 3. Cloud Sheets Profile!A1 (legacy cloud fallback)
 * 4. Runtime file overlay (/tmp/kaisifos-data/profile.json or data/profile.json)
 * 5. Built-in PM preset fallback
 */
export async function getCandidateProfileAsync(options?: {
  bypassCache?: boolean;
}): Promise<CandidateProfile> {
  const now = Date.now();
  if (
    !options?.bypassCache &&
    cloudProfileCache &&
    now - cloudProfileCache.fetchedAt < CLOUD_PROFILE_TTL_MS
  ) {
    return cloudProfileCache.profile;
  }

  const localProfile = getCandidateProfile();

  if (isNeonPostgresConfigured()) {
    try {
      const neonProfile = await readNeonCandidateProfile();
      if (neonProfile && typeof neonProfile === 'object') {
        const normalized = normalizeCandidateProfile(
          neonProfile as Partial<CandidateProfile>,
          localProfile
        );
        cloudProfileCache = { profile: normalized, fetchedAt: now };
        writeRuntimeJsonFile('profile.json', normalized);
        return normalized;
      } else {
        // Seed Neon with local profile on first boot
        await writeNeonCandidateProfile(localProfile);
        cloudProfileCache = { profile: localProfile, fetchedAt: now };
        return localProfile;
      }
    } catch (err) {
      console.warn('[Profile] Neon Postgres profile read fell back:', (err as Error).message);
    }
  }

  if (isCloudSheetsConfigured()) {
    try {
      const cloudRes = await readCloudProfileJson();
      if (cloudRes?.json) {
        const parsed = JSON.parse(cloudRes.json) as Partial<CandidateProfile>;
        const normalized = normalizeCandidateProfile(parsed, localProfile);
        // Protect against stale Profile!A1 where open_to_relocation was true for Hyderabad-locked profile
        if (
          localProfile.open_to_relocation === false &&
          normalized.open_to_relocation === true &&
          computeProfileVersionHash(normalized) !== computeProfileVersionHash(localProfile) &&
          !cloudRes.updatedAt
        ) {
          normalized.open_to_relocation = false;
          normalized.relocation_preference.willing = false;
        }
        cloudProfileCache = { profile: normalized, fetchedAt: now };
        writeRuntimeJsonFile('profile.json', normalized);
        return normalized;
      }
    } catch (err) {
      console.warn('[Profile] Cloud profile read fell back to local/tmp store:', (err as Error).message);
    }
  }

  return localProfile;
}

/**
 * Multi-tier async profile writer:
 * 1. Neon Postgres candidate_profiles table (durable relational primary store)
 * 2. Cloud Sheets Profile!A1 (durable legacy fallback)
 * 3. Local data/profile.json or ephemeral /tmp/kaisifos-data/profile.json
 */
export async function saveCandidateProfileAsync(
  profileInput: Partial<CandidateProfile>
): Promise<SaveProfileResult> {
  const current = getCandidateProfile();
  const normalized = normalizeCandidateProfile(profileInput, current);
  const serialized = JSON.stringify(normalized, null, 2);

  let neonSaved = false;
  let cloudSaved = false;
  let cloudError: string | undefined;

  if (isNeonPostgresConfigured()) {
    try {
      neonSaved = Boolean(await writeNeonCandidateProfile(normalized));
    } catch (err) {
      cloudError = (err as Error).message;
      console.warn('[Profile] Neon profile write failed:', cloudError);
    }
  }

  if (isCloudSheetsConfigured()) {
    try {
      cloudSaved = await writeCloudProfileJson(serialized);
    } catch (err) {
      if (!neonSaved) {
        cloudError = (err as Error).message;
      }
      console.warn('[Profile] Cloud profile write failed:', (err as Error).message);
    }
  }

  const localRes = writeRuntimeJsonFile('profile.json', normalized);
  cloudProfileCache = { profile: normalized, fetchedAt: Date.now() };

  if (neonSaved) {
    return {
      ok: true,
      profile: normalized,
      persistenceMode: 'neon-postgres',
      cloudSaved: true,
      localSaved: localRes.ok,
    };
  }

  if (cloudSaved) {
    return {
      ok: true,
      profile: normalized,
      persistenceMode: 'cloud-sheets',
      cloudSaved: true,
      localSaved: localRes.ok,
    };
  }

  if (localRes.ok) {
    const mode: ProfilePersistenceMode =
      localRes.mode === 'ephemeral-tmp' ? 'ephemeral-tmp' : 'local-disk';
    const warning =
      mode === 'ephemeral-tmp'
        ? cloudError
          ? `Cloud profile sync failed (${cloudError}). Saved to container ephemeral /tmp storage for active session only.`
          : 'Container mounts data/ as read-only. Saved to ephemeral /tmp storage (resets on cold restart). Add DATABASE_URL (Neon Postgres) or GOOGLE_SHEET_ID for permanent cloud persistence.'
        : cloudError
        ? `Saved locally; cloud profile sync failed (${cloudError}).`
        : undefined;

    return {
      ok: true,
      profile: normalized,
      persistenceMode: mode,
      cloudSaved: false,
      localSaved: true,
      warning,
    };
  }

  return {
    ok: false,
    profile: normalized,
    persistenceMode: 'read-only',
    cloudSaved: false,
    localSaved: false,
    error:
      cloudError ||
      localRes.error ||
      'Unable to persist profile to Neon Postgres, Google Sheets, data/, or /tmp storage.',
  };
}
