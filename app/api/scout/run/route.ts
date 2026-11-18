import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { isAuthorizedRequest } from '@/lib/auth';
import { executeLiveScoutRun } from '@/lib/scout-runner';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET() {
  return NextResponse.json({
    sources: [
      { id: 'workday', name: 'Workday CXS Direct ATS', type: 'Enterprise Indian MNC Career Boards', free: true },
      { id: 'career_pages', name: 'Direct Company Career Pages (incl. Keka & Darwinbox)', type: 'Official Career Portals (JSON-LD & ATS Embeds)', free: true },
      { id: 'greenhouse', name: 'Greenhouse Direct ATS', type: 'Direct Company ATS', free: true },
      { id: 'ashby', name: 'Ashby Direct ATS', type: 'Direct Company ATS', free: true },
      { id: 'lever', name: 'Lever Direct ATS', type: 'Direct Company ATS', free: true },
      { id: 'workable', name: 'Workable Direct ATS', type: 'Direct Company ATS', free: true },
      { id: 'smartrecruiters', name: 'SmartRecruiters Direct ATS', type: 'Direct Company ATS', free: true },
      { id: 'recruitee', name: 'Recruitee Direct ATS', type: 'Direct Company ATS', free: true },
      { id: 'remoteok', name: 'RemoteOK Public API', type: 'Global Remote Board', free: true },
      { id: 'remotive', name: 'Remotive Public API', type: 'Global Remote Board', free: true },
      { id: 'himalayas', name: 'Himalayas Public API', type: 'Global Remote Board', free: true },
      { id: 'arbeitnow', name: 'Arbeitnow Visa Board', type: 'EU & Visa-Sponsored', free: true },
      { id: 'themuse', name: 'TheMuse Public API', type: 'Entry/Mid Tech & GTM', free: true },
      { id: 'webhook_clipper', name: 'Alert Email Webhook & 1-Click Clipper', type: 'Naukri / LinkedIn / Wellfound Ingestion', free: true },
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
      mode: body.mode === 'retry_pending' ? 'retry_pending' : 'live_sweep',
    });

    return NextResponse.json(summary);
  } catch (err: any) {
    const message = err?.message || 'Scout execution failed';
    const isReadOnly = /read-only|GOOGLE_SHEET_ID|persisting/i.test(message);
    console.error('[Scout Run API] Error:', err);
    return NextResponse.json(
      { error: message },
      { status: isReadOnly ? 503 : 500 }
    );
  }
}
