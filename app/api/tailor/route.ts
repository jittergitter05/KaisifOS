import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { isAuthorizedRequest, isSameOriginRequest } from '@/lib/auth';
import { checkRateLimit, extractClientIp } from '@/lib/rate-limit';
import { getCandidateProfileAsync } from '@/lib/profile';
import { generateGroundedTailorPack } from '@/lib/tailor-engine';
import { sanitizePlainField } from '@/lib/sheets';
import { redactSecrets } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const maxDuration = 45;

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request.headers)) {
    return NextResponse.json({ error: 'Cross-origin request blocked.' }, { status: 403 });
  }

  const ip = extractClientIp(request.headers);
  const limit = checkRateLimit(`tailor:${ip}`, 25, 5 * 60 * 1000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: `Rate limit exceeded. Retry in ${limit.retryAfterSeconds}s.` },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } }
    );
  }

  const cookieStore = cookies();
  const authCookie = cookieStore.get('kaisifos_auth')?.value;
  const lockedCookie = cookieStore.get('kaisifos_locked')?.value;
  if (!(await isAuthorizedRequest(authCookie, lockedCookie))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const title = sanitizePlainField(body?.title, 200);
    const company = sanitizePlainField(body?.company, 160);
    if (!title || !company) {
      return NextResponse.json(
        { error: 'Job title and company are required to generate an ATS Tailor Brief.' },
        { status: 400 }
      );
    }

    const profile = await getCandidateProfileAsync();
    const pack = await generateGroundedTailorPack(
      {
        title,
        company,
        location: sanitizePlainField(body?.location, 120),
        reasons: sanitizePlainField(body?.reasons, 1200),
        gap: sanitizePlainField(body?.gap, 600),
        resumeAngle: sanitizePlainField(body?.resumeAngle, 600),
        description: sanitizePlainField(body?.description, 6000),
      },
      profile
    );

    return NextResponse.json({
      success: true,
      ...pack,
    });
  } catch (err) {
    console.error('[api/tailor POST]', redactSecrets((err as Error).message));
    return NextResponse.json(
      { error: 'Failed to generate grounded ATS Tailor Brief.' },
      { status: 500 }
    );
  }
}
