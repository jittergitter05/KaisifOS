import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { isAuthorizedRequest } from '@/lib/auth';
import {
  FORK_PROFILE_TEMPLATES,
  CandidateProfile,
  DEFAULT_ATS_COMPANIES,
  DEFAULT_CAREER_URLS,
  getCandidateProfileAsync,
  saveCandidateProfileAsync,
  parseWorkdayBoardTarget,
  type WorkdayBoardTarget,
} from '@/lib/profile';
import { validateSafePublicUrl } from '@/lib/utils';
import { siteConfig } from '@/config/site';

function sanitizeStringArray(val: unknown, fallback: string[] = []): string[] {
  if (!Array.isArray(val)) return fallback;
  return val
    .map((item) => String(item ?? '').trim())
    .filter((item) => item.length > 0 && item.length <= 300)
    .slice(0, 100);
}

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const isPublic = searchParams.get('public') === 'true';

  if (!isPublic) {
    const cookieStore = cookies();
    const authCookie = cookieStore.get('kaisifos_auth')?.value;
    const lockedCookie = cookieStore.get('kaisifos_locked')?.value;
    if (!(await isAuthorizedRequest(authCookie, lockedCookie))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  try {
    const profile = await getCandidateProfileAsync();
    return NextResponse.json(profile);
  } catch (e) {
    console.error('[Profile] Read error:', e);
    return NextResponse.json({ error: 'Failed to read profile' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const cookieStore = cookies();
  const authCookie = cookieStore.get('kaisifos_auth')?.value;
  const lockedCookie = cookieStore.get('kaisifos_locked')?.value;

  try {
    const authorized = await isAuthorizedRequest(authCookie, lockedCookie);
    if (!authorized) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();

    if (body.presetKey && typeof body.presetKey === 'string' && FORK_PROFILE_TEMPLATES[body.presetKey]) {
      const preset = FORK_PROFILE_TEMPLATES[body.presetKey];
      const saveRes = await saveCandidateProfileAsync(preset);
      if (!saveRes.ok) {
        return NextResponse.json({ error: saveRes.error }, { status: 503 });
      }
      return NextResponse.json({
        success: true,
        profile: saveRes.profile,
        persistenceMode: saveRes.persistenceMode,
        cloudSaved: saveRes.cloudSaved,
        localSaved: saveRes.localSaved,
        warning: saveRes.warning,
      });
    }

    if (!body.name || typeof body.name !== 'string' || body.name.trim().length === 0) {
      return NextResponse.json({ error: 'Missing or invalid field: name' }, { status: 400 });
    }
    if (!Array.isArray(body.target_roles) || body.target_roles.length === 0) {
      return NextResponse.json(
        { error: 'Missing or invalid field: target_roles (must be a non-empty array)' },
        { status: 400 }
      );
    }
    if (!Array.isArray(body.target_cities) || body.target_cities.length === 0) {
      return NextResponse.json(
        { error: 'Missing or invalid field: target_cities (must be a non-empty array)' },
        { status: 400 }
      );
    }
    if (!Array.isArray(body.skills)) {
      return NextResponse.json(
        { error: 'Missing or invalid field: skills (must be an array)' },
        { status: 400 }
      );
    }

    const current = await getCandidateProfileAsync();

    // Explicitly whitelist and sanitize all CandidateProfile fields (prevents prototype pollution / arbitrary key injection)
    const sanitizeWorkdayList = (
      val: unknown,
      fallback: Array<string | WorkdayBoardTarget> = []
    ): WorkdayBoardTarget[] => {
      const source = Array.isArray(val) ? val : fallback;
      const out: WorkdayBoardTarget[] = [];
      const seen = new Set<string>();
      for (const item of source) {
        const parsed = parseWorkdayBoardTarget(item);
        if (!parsed) continue;
        const k = `${parsed.tenant}::${parsed.site}`;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(parsed);
        if (out.length >= 16) break;
      }
      return out;
    };

    const updatedProfile: CandidateProfile = {
      system_name: String(body.system_name || current.system_name || siteConfig.name).trim().slice(0, 80),
      name: String(body.name).trim().slice(0, 120),
      email: String(body.email ?? current.email ?? '').trim().slice(0, 120),
      target_roles: sanitizeStringArray(body.target_roles, current.target_roles),
      target_cities: sanitizeStringArray(body.target_cities, current.target_cities),
      open_to_relocation:
        typeof body.open_to_relocation === 'boolean'
          ? body.open_to_relocation
          : current.open_to_relocation,
      enable_internshala:
        typeof body.enable_internshala === 'boolean'
          ? body.enable_internshala
          : Boolean(current.enable_internshala),
      relocation_preference: {
        willing:
          typeof body.relocation_preference?.willing === 'boolean'
            ? body.relocation_preference.willing
            : Boolean(body.open_to_relocation ?? current.relocation_preference?.willing ?? true),
        requirements: sanitizeStringArray(
          body.relocation_preference?.requirements,
          current.relocation_preference?.requirements
        ),
        preferred_regions: sanitizeStringArray(
          body.relocation_preference?.preferred_regions,
          current.relocation_preference?.preferred_regions
        ),
        avoid: sanitizeStringArray(
          body.relocation_preference?.avoid,
          current.relocation_preference?.avoid
        ),
      },
      min_salary_lpa: Math.max(0, Number(body.min_salary_lpa ?? current.min_salary_lpa ?? 8)),
      min_salary_usd_annual: Math.max(
        0,
        Number(body.min_salary_usd_annual ?? current.min_salary_usd_annual ?? 30000)
      ),
      experience_years: Math.max(
        0,
        Math.min(50, Number(body.experience_years ?? current.experience_years ?? 0))
      ),
      experience_level: String(body.experience_level ?? current.experience_level ?? 'Fresher / Entry Level')
        .trim()
        .slice(0, 120),
      portfolio: String(body.portfolio ?? current.portfolio ?? '').trim().slice(0, 300),
      key_metrics: sanitizeStringArray(body.key_metrics, current.key_metrics),
      skills: sanitizeStringArray(body.skills, current.skills),
      languages: sanitizeStringArray(body.languages, current.languages),
      resume_synthesizer_url: String(
        body.resume_synthesizer_url ?? current.resume_synthesizer_url ?? ''
      )
        .trim()
        .slice(0, 300),
      ats_companies: {
        greenhouse: sanitizeStringArray(
          body.ats_companies?.greenhouse,
          current.ats_companies?.greenhouse ?? DEFAULT_ATS_COMPANIES.greenhouse
        ),
        lever: sanitizeStringArray(
          body.ats_companies?.lever,
          current.ats_companies?.lever ?? DEFAULT_ATS_COMPANIES.lever
        ),
        ashby: sanitizeStringArray(
          body.ats_companies?.ashby,
          current.ats_companies?.ashby ?? DEFAULT_ATS_COMPANIES.ashby
        ),
        workable: sanitizeStringArray(
          body.ats_companies?.workable,
          current.ats_companies?.workable ?? DEFAULT_ATS_COMPANIES.workable ?? []
        ),
        smartrecruiters: sanitizeStringArray(
          body.ats_companies?.smartrecruiters,
          current.ats_companies?.smartrecruiters ?? DEFAULT_ATS_COMPANIES.smartrecruiters ?? []
        ),
        recruitee: sanitizeStringArray(
          body.ats_companies?.recruitee,
          current.ats_companies?.recruitee ?? DEFAULT_ATS_COMPANIES.recruitee ?? []
        ),
        workday: sanitizeWorkdayList(
          body.ats_companies?.workday,
          current.ats_companies?.workday ?? DEFAULT_ATS_COMPANIES.workday ?? []
        ),
      },
      career_urls: Array.isArray(body.career_urls)
        ? body.career_urls
            .map((u: unknown) => String(u ?? '').trim())
            .filter((u: string) => validateSafePublicUrl(u, { allowLocalDev: false }).ok)
            .slice(0, 20)
        : current.career_urls ?? DEFAULT_CAREER_URLS,
    };

    const saveRes = await saveCandidateProfileAsync(updatedProfile);
    if (!saveRes.ok) {
      return NextResponse.json({ error: saveRes.error }, { status: 503 });
    }

    return NextResponse.json({
      success: true,
      profile: saveRes.profile,
      persistenceMode: saveRes.persistenceMode,
      cloudSaved: saveRes.cloudSaved,
      localSaved: saveRes.localSaved,
      warning: saveRes.warning,
    });
  } catch (e) {
    console.error('[Profile] Write error:', e);
    return NextResponse.json({ error: 'Failed to update profile' }, { status: 500 });
  }
}
