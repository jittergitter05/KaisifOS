import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { isAuthorizedRequest } from '@/lib/auth';
import { getCandidateProfileAsync } from '@/lib/profile';
import { evaluateJobWithFreeChain } from '@/lib/llm';
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
      `evaluate:${isAuthed ? 'auth' : 'pub'}:${ip}`,
      isAuthed ? 120 : 25,
      5 * 60 * 1000
    );
    if (!limitResult.allowed) {
      return NextResponse.json(
        { error: `Evaluation rate limit reached. Retry in ${limitResult.retryAfterSeconds}s.` },
        {
          status: 429,
          headers: { 'Retry-After': String(limitResult.retryAfterSeconds) },
        }
      );
    }

    const body = await req.json();
    const job = {
      title: String(body.title || 'Associate Product Marketing Manager').trim().slice(0, 200),
      company: String(body.company || 'Raycast').trim().slice(0, 160),
      location: String(body.location || 'Bengaluru / Remote').trim().slice(0, 160),
      salary: String(body.salary || '₹12 LPA / $45,000 USD').trim().slice(0, 120),
      description: String(body.description || '').trim().slice(0, 8000),
    };

    const profile = await getCandidateProfileAsync();
    const evaluation = await evaluateJobWithFreeChain(job, profile);
    return NextResponse.json(evaluation);
  } catch (err) {
    console.error('[Evaluate API] Error:', err);
    return NextResponse.json({ error: 'Failed to evaluate job' }, { status: 500 });
  }
}
