import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { isAuthorizedRequest } from '@/lib/auth';
import { generateRolePrepPack } from '@/lib/prep-engine';
import { getCandidateProfileAsync } from '@/lib/profile';
import { checkRateLimit, extractClientIp } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const cookieStore = cookies();
    const isAuthed = await isAuthorizedRequest(
      cookieStore.get('kaisifos_auth')?.value,
      cookieStore.get('kaisifos_locked')?.value
    );
    const ip = extractClientIp(req.headers);
    const limitResult = checkRateLimit(
      `prep:${isAuthed ? 'auth' : 'pub'}:${ip}`,
      isAuthed ? 120 : 25,
      5 * 60 * 1000
    );
    if (!limitResult.allowed) {
      return NextResponse.json(
        { error: `Prep copilot rate limit reached. Retry in ${limitResult.retryAfterSeconds}s.` },
        {
          status: 429,
          headers: { 'Retry-After': String(limitResult.retryAfterSeconds) },
        }
      );
    }

    const body = await req.json();
    const job = {
      title: String(body.title || 'Target Role').trim().slice(0, 200),
      company: String(body.company || 'Target Company').trim().slice(0, 160),
      reasons: String(body.reasons || '').trim().slice(0, 1000),
      gap: String(body.gap || '').trim().slice(0, 600),
      description: String(body.description || '').trim().slice(0, 8000),
    };

    const profile = await getCandidateProfileAsync();
    const pack = await generateRolePrepPack(job, profile);

    return NextResponse.json(pack);
  } catch (err) {
    console.error('[Prep API] Error:', err);
    return NextResponse.json({ error: 'Failed to generate role prep pack' }, { status: 500 });
  }
}
