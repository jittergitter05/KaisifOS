import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { isAuthorizedRequest, isSameOriginRequest } from '@/lib/auth';
import { executeLiveScoutRun } from '@/lib/scout-runner';
import { checkRateLimit, extractClientIp } from '@/lib/rate-limit';
import { redactSecrets } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  if (!isSameOriginRequest(req.headers)) {
    return NextResponse.json({ error: 'Cross-origin request blocked.' }, { status: 403 });
  }

  const ip = extractClientIp(req.headers);
  const limit = checkRateLimit(`scout:live:${ip}`, 8, 5 * 60 * 1000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: `Scout rate limit exceeded. Retry in ${limit.retryAfterSeconds}s.` },
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
    const message = redactSecrets((err as Error)?.message || 'Live scout run failed', 240);
    const isReadOnly = /read-only|GOOGLE_SHEET_ID|persisting/i.test(message);
    console.error('[Live Scout API] Error:', message);
    return NextResponse.json(
      { error: message },
      { status: isReadOnly ? 503 : 500 }
    );
  }
}
