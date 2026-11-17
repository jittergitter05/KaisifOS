import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { isAuthorizedRequest } from '@/lib/auth';
import { executeLiveScoutRun } from '@/lib/scout-runner';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({
    sources: [
      { id: 'greenhouse', name: 'Greenhouse Direct ATS', type: 'Direct Company ATS', free: true },
      { id: 'ashby', name: 'Ashby Direct ATS', type: 'Direct Company ATS', free: true },
      { id: 'lever', name: 'Lever Direct ATS', type: 'Direct Company ATS', free: true },
      { id: 'remoteok', name: 'RemoteOK Public API', type: 'Global Remote Board', free: true },
      { id: 'remotive', name: 'Remotive Public API', type: 'Global Remote Board', free: true },
      { id: 'himalayas', name: 'Himalayas Public API', type: 'Global Remote Board', free: true },
      { id: 'arbeitnow', name: 'Arbeitnow Visa Board', type: 'EU & Visa-Sponsored', free: true },
      { id: 'themuse', name: 'TheMuse Public API', type: 'Entry/Mid Tech & GTM', free: true },
      ...(process.env.FREEHIRE_API_URL
        ? [{ id: 'freehire', name: 'FreeHire Custom Endpoint', type: 'Custom ATS Feed', free: true }]
        : []),
    ],
  });
}

export async function POST(req: NextRequest) {
  const cookieStore = cookies();
  const authCookie = cookieStore.get('kaisifos_auth')?.value;
  const lockedCookie = cookieStore.get('kaisifos_locked')?.value;
  if (!(await isAuthorizedRequest(authCookie, lockedCookie))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const minScoreToCommit =
      typeof body.minScoreToCommit === 'number'
        ? Math.min(100, Math.max(0, body.minScoreToCommit))
        : 80;
    const maxToEvaluate =
      typeof body.maxToEvaluate === 'number' ? Math.min(12, Math.max(2, body.maxToEvaluate)) : 6;

    const summary = await executeLiveScoutRun({
      minScoreToCommit,
      maxToEvaluate,
      customBoards: body.customBoards,
    });

    return NextResponse.json(summary);
  } catch (err: any) {
    console.error('[Scout Run API] Error:', err);
    return NextResponse.json(
      { error: err?.message || 'Scout execution failed' },
      { status: 500 }
    );
  }
}
