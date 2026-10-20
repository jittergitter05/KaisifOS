import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { isAuthorizedRequest } from '@/lib/auth';
import { getCandidateProfile, FORK_PROFILE_TEMPLATES } from '@/lib/profile';
import fs from 'fs';
import path from 'path';

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
    const body = await request.json();

    const authorized = await isAuthorizedRequest(authCookie, lockedCookie);
    if (!authorized) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (body.presetKey && FORK_PROFILE_TEMPLATES[body.presetKey]) {
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

    const updatedProfile = {
      system_name: body.system_name || 'CareerOS',
      ...body,
    };

    const profilePath = path.join(process.cwd(), 'data', 'profile.json');
    fs.writeFileSync(profilePath, JSON.stringify(updatedProfile, null, 2), 'utf8');

    return NextResponse.json({ success: true, profile: updatedProfile });
  } catch (e) {
    console.error('[Profile] Write error:', e);
    return NextResponse.json({ error: 'Failed to update profile' }, { status: 500 });
  }
}
