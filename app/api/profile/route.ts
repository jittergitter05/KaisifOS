import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { isAuthorizedRequest } from '@/lib/auth';
import {
  getCandidateProfile,
  FORK_PROFILE_TEMPLATES,
  CandidateProfile,
  DEFAULT_ATS_COMPANIES,
} from '@/lib/profile';
import fs from 'fs';
import path from 'path';

function sanitizeStringArray(val: unknown, fallback: string[] = []): string[] {
  if (!Array.isArray(val)) return fallback;
  return val
    .map((item) => String(item ?? '').trim())
    .filter((item) => item.length > 0 && item.length <= 300)
    .slice(0, 100);
}

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
    const profile = getCandidateProfile();
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
      const profilePath = path.join(process.cwd(), 'data', 'profile.json');
      fs.writeFileSync(profilePath, JSON.stringify(preset, null, 2), 'utf8');
      return NextResponse.json({ success: true, profile: preset });
    }

    if (!body.name || typeof body.name !== 'string') {
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

    const current = getCandidateProfile();

    // Explicitly whitelist and sanitize all CandidateProfile fields (prevents prototype pollution / arbitrary key injection)
    const updatedProfile: CandidateProfile = {
      system_name: String(body.system_name || current.system_name || 'CareerOS').trim().slice(0, 80),
      name: String(body.name).trim().slice(0, 120),
      email: String(body.email ?? current.email ?? '').trim().slice(0, 120),
      target_roles: sanitizeStringArray(body.target_roles, current.target_roles),
      target_cities: sanitizeStringArray(body.target_cities, current.target_cities),
      open_to_relocation:
        typeof body.open_to_relocation === 'boolean'
          ? body.open_to_relocation
          : current.open_to_relocation,
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
      },
    };

    const profilePath = path.join(process.cwd(), 'data', 'profile.json');
    fs.writeFileSync(profilePath, JSON.stringify(updatedProfile, null, 2), 'utf8');

    return NextResponse.json({ success: true, profile: updatedProfile });
  } catch (e) {
    console.error('[Profile] Write error:', e);
    return NextResponse.json({ error: 'Failed to update profile' }, { status: 500 });
  }
}
