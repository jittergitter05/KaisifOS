import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifyToken } from '@/lib/auth';
import fs from 'fs';
import path from 'path';

export async function GET(request: NextRequest) {
  const cookieStore = cookies();
  const authCookie = cookieStore.get('kaisifos_auth');
  if (!authCookie || !(await verifyToken(authCookie.value))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const profilePath = path.join(process.cwd(), 'data', 'profile.json');
    const raw = fs.readFileSync(profilePath, 'utf8');
    const profile = JSON.parse(raw);
    return NextResponse.json(profile);
  } catch (e) {
    console.error('[Profile] Read error:', e);
    return NextResponse.json(
      { error: 'Failed to read profile' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const cookieStore = cookies();
  const authCookie = cookieStore.get('kaisifos_auth');
  if (!authCookie || !(await verifyToken(authCookie.value))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();

    // Validate required fields
    if (!body.name || typeof body.name !== 'string') {
      return NextResponse.json(
        { error: 'Missing or invalid field: name' },
        { status: 400 }
      );
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

    const profilePath = path.join(process.cwd(), 'data', 'profile.json');
    fs.writeFileSync(profilePath, JSON.stringify(body, null, 2), 'utf8');

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('[Profile] Write error:', e);
    return NextResponse.json(
      { error: 'Failed to update profile' },
      { status: 500 }
    );
  }
}
