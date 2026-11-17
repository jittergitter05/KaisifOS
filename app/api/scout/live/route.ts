import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { isAuthorizedRequest } from '@/lib/auth';
import { executeLiveScoutRun } from '@/lib/scout-runner';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const cookieStore = cookies();
  const authCookie = cookieStore.get('kaisifos_auth')?.value;
  const lockedCookie = cookieStore.get('kaisifos_locked')?.value;
  if (!(await isAuthorizedRequest(authCookie, lockedCookie))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const mode = body.mode === 'retry_pending' ? 'retry_pending' : 'live_sweep';

    const summary = await executeLiveScoutRun({
      minScoreToCommit: 75,
      maxToEvaluate: 6,
      mode,
    });

    return NextResponse.json({
      mode,
      scanned: summary.total_fetched,
      newAfterDedup: summary.new_after_dedup,
      canonicalDedupSaved: summary.canonical_dedup_saved,
      hardGateRejected: summary.hard_gate_rejected,
      hardGateReasons: summary.hard_gate_reasons,
      evaluatedCount: summary.evaluated_count,
      queuedForRetryCount: summary.queued_for_retry_count,
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
