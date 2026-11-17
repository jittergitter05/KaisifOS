import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { isAuthorizedRequest } from '@/lib/auth';
import { executeLiveScoutRun } from '@/lib/scout-runner';

export const dynamic = 'force-dynamic';

export async function POST() {
  const cookieStore = cookies();
  const authCookie = cookieStore.get('kaisifos_auth')?.value;
  const lockedCookie = cookieStore.get('kaisifos_locked')?.value;
  if (!(await isAuthorizedRequest(authCookie, lockedCookie))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const summary = await executeLiveScoutRun({
      minScoreToCommit: 75,
      maxToEvaluate: 6,
    });

    return NextResponse.json({
      scanned: summary.total_fetched,
      newAfterDedup: summary.new_after_dedup,
      evaluatedCount: summary.evaluated_count,
      addedCount: summary.committed_count,
      addedRoles: summary.committed_jobs.map(
        (j) => `${j.title} @ ${j.company} (${j.score}/100)`
      ),
      sourceCounts: summary.source_counts,
      sourceHealth: summary.source_health,
    });
  } catch (err) {
    console.error('[Live Scout API] Error:', err);
    return NextResponse.json({ error: 'Live scout run failed' }, { status: 500 });
  }
}
