import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { isAuthorizedRequest, isSameOriginRequest } from '@/lib/auth';
import {
  getAllSheetRows,
  getPublicStats,
  getStorageHealthInfo,
  isCloudSheetsConfigured,
  isNeonPostgresConfigured,
  resolveRuntimeDataDir,
  updateLocalJobRow,
  batchUpdateLocalJobRows,
  appendLocalJobRecordDetailed,
  appendCloudSheetRecord,
  updateCloudSheetRowFields,
  batchUpdateCloudSheetRows,
  upsertNeonCanonicalJob,
  updateNeonJobFields,
  batchUpdateNeonJobStage,
  getNeonTelemetrySummary,
  sanitizePlainField,
} from '@/lib/sheets';
import { buildCanonicalJobKey, detectSource, sanitizeHttpUrl } from '@/lib/utils';
import { checkRateLimit, extractClientIp } from '@/lib/rate-limit';

const ALLOWED_STATUSES = new Set([
  'NEW',
  'SHORTLISTED',
  'OUTREACH_DRAFTED',
  'APPLIED',
  'REPLIED',
  'INTERVIEW',
  'OFFER',
  'REJECTED',
  'WITHDRAWN',
  'GHOSTED',
  'IGNORED',
  'ARCHIVED',
]);

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const isPublic = searchParams.get('public') === 'true';

  if (!isPublic) {
    const cookieStore = cookies();
    const authCookie = cookieStore.get('kaisifos_auth')?.value;
    const lockedCookie = cookieStore.get('kaisifos_locked')?.value;
    if (!(await isAuthorizedRequest(authCookie, lockedCookie))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  try {
    if (isPublic) {
      const stats = await getPublicStats();
      return NextResponse.json(stats);
    }

    const { rows, mode, cloudError, richRecords } = await getAllSheetRows();
    const storageHealth = getStorageHealthInfo(cloudError);
    const telemetry = isNeonPostgresConfigured() ? await getNeonTelemetrySummary() : null;

    return NextResponse.json({
      rows,
      richRecords: richRecords || [],
      telemetry,
      mode,
      persistenceMode: storageHealth.storageMode,
      cloudError,
    });
  } catch (e) {
    console.error('[sheet-sync GET]', e);
    return NextResponse.json(
      isPublic
        ? {
            jobs_scouted_this_week: 0,
            avg_match_score: 0,
            applications_sent: 0,
            response_rate: '0%',
          }
        : { rows: [], richRecords: [], mode: 'local-store', persistenceMode: 'read-only' }
    );
  }
}

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request.headers)) {
    return NextResponse.json({ error: 'Cross-origin request blocked.' }, { status: 403 });
  }

  const ip = extractClientIp(request.headers);
  const limit = checkRateLimit(`sheet-sync:write:${ip}`, 120, 5 * 60 * 1000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: `Rate limit exceeded. Retry in ${limit.retryAfterSeconds}s.` },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } }
    );
  }

  const cookieStore = cookies();
  const authCookie = cookieStore.get('kaisifos_auth')?.value;
  const lockedCookie = cookieStore.get('kaisifos_locked')?.value;
  const isAuthed = await isAuthorizedRequest(authCookie, lockedCookie);

  if (!isAuthed) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const dirInfo = resolveRuntimeDataDir();

    if (body.action === 'batch_update' && Array.isArray(body.targets)) {
      const normalized = String(body.status || '').toUpperCase().trim();
      if (!ALLOWED_STATUSES.has(normalized)) {
        return NextResponse.json(
          { error: `Invalid status value: ${normalized}` },
          { status: 400 }
        );
      }

      const targets = (body.targets as Array<{ id?: unknown; canonicalKey?: unknown; rowId?: unknown }>)
        .slice(0, 200)
        .map((t) => ({
          id: typeof t.id === 'string' && t.id.trim() ? t.id.trim().slice(0, 120) : undefined,
          canonicalKey:
            typeof t.canonicalKey === 'string' && t.canonicalKey.trim()
              ? t.canonicalKey.trim().slice(0, 180)
              : undefined,
          rowId:
            t.rowId !== undefined && Number.isInteger(Number(t.rowId)) && Number(t.rowId) >= 2
              ? Number(t.rowId)
              : undefined,
        }))
        .filter((t) => t.id || t.canonicalKey || t.rowId);

      if (targets.length === 0) {
        return NextResponse.json(
          { error: 'No valid targets provided for batch update.' },
          { status: 400 }
        );
      }

      let neonCount = 0;
      if (isNeonPostgresConfigured()) {
        try {
          neonCount = await batchUpdateNeonJobStage(targets, normalized);
        } catch (neonErr) {
          console.warn('[sheet-sync] Neon batch update failed:', (neonErr as Error).message);
        }
      }

      let cloudCount = 0;
      let cloudError: string | undefined;
      if (isCloudSheetsConfigured()) {
        try {
          cloudCount = await batchUpdateCloudSheetRows(targets, normalized);
        } catch (cloudErr) {
          cloudError = (cloudErr as Error).message;
          console.warn('[sheet-sync] Cloud batch update failed, trying runtime store:', cloudError);
        }
      }

      const localCount = batchUpdateLocalJobRows(targets, normalized);
      if (neonCount === 0 && cloudCount === 0 && localCount === 0) {
        if (!dirInfo.writable && !isNeonPostgresConfigured() && (!isCloudSheetsConfigured() || cloudError)) {
          return NextResponse.json(
            {
              error:
                cloudError ||
                'Storage is read-only and Neon Postgres / Google Sheets is not writable in this environment.',
            },
            { status: 503 }
          );
        }
        return NextResponse.json(
          { error: 'No matching pipeline records found for batch update.' },
          { status: 404 }
        );
      }

      return NextResponse.json({
        success: true,
        neonCount,
        cloudCount,
        localCount,
        persistenceMode:
          neonCount > 0
            ? 'neon-postgres'
            : cloudCount > 0
            ? 'cloud-sheets'
            : dirInfo.mode === 'ephemeral-tmp'
            ? 'ephemeral-tmp'
            : 'local-disk',
      });
    }

    if (body.action === 'append' && body.job) {
      const { job } = body;
      const dateStr = sanitizePlainField(job.date || new Date().toISOString().split('T')[0], 20);
      const rawStatus = String(job.status || 'NEW').toUpperCase();
      const safeStatus = ALLOWED_STATUSES.has(rawStatus) ? rawStatus : 'NEW';
      const titleStr = sanitizePlainField(job.title || 'Untitled Role', 200);
      const companyStr = sanitizePlainField(job.company || 'Unknown Company', 160);
      const locationStr = sanitizePlainField(job.location || '', 120);
      const idStr = sanitizePlainField(job.id || `manual_${Date.now()}`, 120);
      const urlStr = sanitizeHttpUrl(job.url || '', 500);
      const canonicalKey = buildCanonicalJobKey(companyStr, titleStr, locationStr);

      const record = {
        date: dateStr,
        id: idStr,
        canonicalKey,
        title: titleStr,
        company: companyStr,
        location: locationStr,
        salary: sanitizePlainField(job.salary || '', 120),
        score: Math.max(0, Math.min(100, Math.round(Number(job.score ?? 85)))),
        reasons: sanitizePlainField(
          Array.isArray(job.reasons) ? job.reasons.join(' | ') : String(job.reasons || ''),
          1000
        ),
        gap: sanitizePlainField(job.gap || '', 500),
        url: urlStr,
        dm: sanitizePlainField(job.dm || '', 1500),
        emailDraft: sanitizePlainField(job.emailDraft || '', 2000),
        resumeAngle: sanitizePlainField(job.resumeAngle || '', 500),
        status: safeStatus,
        evaluationStatus: 'LLM_SCORED' as const,
        needsLlmRetry: false,
        sourcesSeen: [{ source: detectSource(idStr), url: urlStr, id: idStr }],
      };

      let neonSaved = false;
      if (isNeonPostgresConfigured()) {
        try {
          const neonRes = await upsertNeonCanonicalJob({
            canonicalKey,
            id: record.id,
            date: record.date,
            title: record.title,
            company: record.company,
            location: record.location,
            salary: record.salary,
            score: record.score,
            reasons: record.reasons,
            gap: record.gap,
            url: record.url,
            dm: record.dm,
            emailDraft: record.emailDraft,
            resumeAngle: record.resumeAngle,
            status: record.status,
            evaluationStatus: 'LLM_SCORED',
            needsLlmRetry: false,
            sourcesSeen: record.sourcesSeen,
          });
          neonSaved = Boolean(neonRes?.ok);
        } catch (neonErr) {
          console.warn('[sheet-sync] Neon append failed:', (neonErr as Error).message);
        }
      }

      let cloudSaved = false;
      let cloudError: string | undefined;
      if (isCloudSheetsConfigured()) {
        try {
          await appendCloudSheetRecord(record);
          cloudSaved = true;
        } catch (cloudErr) {
          cloudError = (cloudErr as Error).message;
          console.warn('[sheet-sync] Cloud append failed, saving to runtime store:', cloudError);
        }
      }

      const localWrite = appendLocalJobRecordDetailed(record);
      if (!neonSaved && !cloudSaved && !localWrite.ok) {
        return NextResponse.json(
          {
            error:
              cloudError ||
              localWrite.error ||
              'Unable to persist record (storage is read-only without writable Neon Postgres or Cloud Sheets).',
          },
          { status: 503 }
        );
      }
      return NextResponse.json({
        success: true,
        record,
        neonSaved,
        cloudSaved,
        localSaved: localWrite.ok,
        persistenceMode: neonSaved
          ? 'neon-postgres'
          : cloudSaved
          ? 'cloud-sheets'
          : localWrite.mode === 'ephemeral-tmp'
          ? 'ephemeral-tmp'
          : 'local-disk',
      });
    }

    const {
      id,
      canonicalKey,
      rowId,
      status,
      dm,
      emailDraft,
      resumeAngle,
      gap,
      score,
      reasons,
      evaluationStatus,
      needsLlmRetry,
      markFollowUpSent,
      lastReplySummary,
      lastReplyClassification,
    } = body;
    const targetId = typeof id === 'string' && id.trim() ? id.trim().slice(0, 120) : undefined;
    const targetCanonicalKey =
      typeof canonicalKey === 'string' && canonicalKey.trim()
        ? canonicalKey.trim().slice(0, 180)
        : undefined;
    const numericRowId = rowId !== undefined ? Number(rowId) : undefined;

    if (!targetId && !targetCanonicalKey && (!numericRowId || !Number.isInteger(numericRowId) || numericRowId < 2)) {
      return NextResponse.json({ error: 'Invalid or missing job id / rowId' }, { status: 400 });
    }

    let safeStatus: string | undefined;
    if (status !== undefined) {
      const normalized = String(status).toUpperCase().trim();
      if (!ALLOWED_STATUSES.has(normalized)) {
        return NextResponse.json(
          { error: `Invalid status value: ${normalized}` },
          { status: 400 }
        );
      }
      safeStatus = normalized;
    }

    const patch = {
      status: safeStatus,
      dm: dm !== undefined ? sanitizePlainField(dm, 1500) : undefined,
      emailDraft: emailDraft !== undefined ? sanitizePlainField(emailDraft, 2000) : undefined,
      resumeAngle: resumeAngle !== undefined ? sanitizePlainField(resumeAngle, 500) : undefined,
      gap: gap !== undefined ? sanitizePlainField(gap, 500) : undefined,
      score:
        score !== undefined && Number.isFinite(Number(score))
          ? Math.max(0, Math.min(100, Math.round(Number(score))))
          : undefined,
      reasons:
        reasons !== undefined
          ? sanitizePlainField(Array.isArray(reasons) ? reasons.join(' | ') : reasons, 1000)
          : undefined,
      evaluationStatus:
        evaluationStatus === 'LLM_SCORED' || evaluationStatus === 'DETERMINISTIC_ONLY' || evaluationStatus === 'REJECTED_GATE'
          ? (evaluationStatus as 'LLM_SCORED' | 'DETERMINISTIC_ONLY' | 'REJECTED_GATE')
          : undefined,
      needsLlmRetry: typeof needsLlmRetry === 'boolean' ? needsLlmRetry : undefined,
      markFollowUpSent: markFollowUpSent === true ? true : undefined,
      lastReplySummary:
        lastReplySummary !== undefined ? sanitizePlainField(lastReplySummary, 500) : undefined,
      lastReplyClassification:
        lastReplyClassification !== undefined
          ? sanitizePlainField(lastReplyClassification, 60)
          : undefined,
    };

    let neonUpdated = false;
    if (isNeonPostgresConfigured()) {
      try {
        neonUpdated = await updateNeonJobFields(
          { id: targetId, canonicalKey: targetCanonicalKey },
          patch
        );
      } catch (neonErr) {
        console.warn('[sheet-sync] Neon field update failed:', (neonErr as Error).message);
      }
    }

    let cloudUpdated = false;
    let cloudError: string | undefined;
    if (isCloudSheetsConfigured()) {
      try {
        cloudUpdated = await updateCloudSheetRowFields(
          { id: targetId, rowId: numericRowId },
          patch
        );
      } catch (cloudErr) {
        cloudError = (cloudErr as Error).message;
        console.warn('[sheet-sync] Cloud field update failed, updating runtime store:', cloudError);
      }
    }

    const localUpdated = updateLocalJobRow(
      { id: targetId, canonicalKey: targetCanonicalKey, rowId: numericRowId },
      patch
    );
    if (!neonUpdated && !cloudUpdated && !localUpdated) {
      if (!dirInfo.writable && !isNeonPostgresConfigured() && (!isCloudSheetsConfigured() || cloudError)) {
        return NextResponse.json(
          {
            error:
              cloudError ||
              'Storage is read-only and Neon Postgres / Google Sheets update failed in this environment.',
          },
          { status: 503 }
        );
      }
      return NextResponse.json(
        { error: 'Matching pipeline record was not found.' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      neonUpdated,
      cloudUpdated,
      localUpdated,
      persistenceMode: neonUpdated
        ? 'neon-postgres'
        : cloudUpdated
        ? 'cloud-sheets'
        : dirInfo.mode === 'ephemeral-tmp'
        ? 'ephemeral-tmp'
        : 'local-disk',
    });
  } catch (e) {
    console.error('[sheet-sync POST]', e);
    return NextResponse.json({ error: 'Operation failed' }, { status: 500 });
  }
}

