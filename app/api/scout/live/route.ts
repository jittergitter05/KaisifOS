import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { isAuthorizedRequest } from '@/lib/auth';
import { executeLiveScoutRun } from '@/lib/scout-runner';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

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
      committedJobs: summary.committed_jobs,
      sourceCounts: summary.source_counts,
      sourceHealth: summary.source_health,
      persistenceMode: summary.persistence_mode,
      warnings: summary.warnings,
    });
  } catch (err) {
    const message = (err as Error)?.message || 'Live scout run failed';
    const isReadOnly = /read-only|GOOGLE_SHEET_ID|persisting/i.test(message);
    console.error('[Live Scout API] Error:', err);
    return NextResponse.json(
      { error: message },
      { status: isReadOnly ? 503 : 500 }
    );
  }
}
