import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { isAuthorizedRequest } from '@/lib/auth';
import {
  getAllSheetRows,
  getPublicStats,
  isCloudSheetsConfigured,
  updateLocalJobRow,
  batchUpdateLocalJobRows,
  appendLocalJobRecord,
  appendCloudSheetRecord,
  updateCloudSheetRowFields,
  batchUpdateCloudSheetRows,
  sanitizeSheetCell,
} from '@/lib/sheets';

const ALLOWED_STATUSES = new Set([
  'NEW',
  'SHORTLISTED',
  'APPLIED',
  'REPLIED',
  'INTERVIEW',
  'OFFER',
  'REJECTED',
  'WITHDRAWN',
  'GHOSTED',
  'IGNORED',
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

    const { rows, mode } = await getAllSheetRows();
    return NextResponse.json({ rows, mode });
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
        : { rows: [], mode: 'local-store' }
    );
  }
}

export async function POST(request: NextRequest) {
  const cookieStore = cookies();
  const authCookie = cookieStore.get('kaisifos_auth')?.value;
  const lockedCookie = cookieStore.get('kaisifos_locked')?.value;
  const isAuthed = await isAuthorizedRequest(authCookie, lockedCookie);

  if (!isAuthed) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();

    if (body.action === 'batch_update' && Array.isArray(body.targets)) {
      const normalized = String(body.status || '').toUpperCase().trim();
      if (!ALLOWED_STATUSES.has(normalized)) {
        return NextResponse.json(
          { error: `Invalid status value: ${normalized}` },
          { status: 400 }
        );
      }

      const targets = (body.targets as Array<{ id?: unknown; rowId?: unknown }>)
        .slice(0, 200)
        .map((t) => ({
          id: typeof t.id === 'string' && t.id.trim() ? t.id.trim().slice(0, 120) : undefined,
          rowId:
            t.rowId !== undefined && Number.isInteger(Number(t.rowId)) && Number(t.rowId) >= 2
              ? Number(t.rowId)
              : undefined,
        }))
        .filter((t) => t.id || t.rowId);

      if (targets.length === 0) {
        return NextResponse.json({ error: 'No valid targets provided for batch update.' }, { status: 400 });
      }

      let cloudCount = 0;
      if (isCloudSheetsConfigured()) {
        try {
          cloudCount = await batchUpdateCloudSheetRows(targets, normalized);
        } catch (cloudErr) {
          console.warn('[sheet-sync] Cloud batch update failed, updating local store:', cloudErr);
        }
      }

      const localCount = batchUpdateLocalJobRows(targets, normalized);
      if (cloudCount === 0 && localCount === 0) {
        return NextResponse.json(
          { error: 'No matching pipeline records found or storage is read-only.' },
          { status: 404 }
        );
      }

      return NextResponse.json({ success: true, cloudCount, localCount });
    }

    if (body.action === 'append' && body.job) {
      const { job } = body;
      const dateStr = sanitizeSheetCell(job.date || new Date().toISOString().split('T')[0], 20);
      const rawStatus = String(job.status || 'NEW').toUpperCase();
      const safeStatus = ALLOWED_STATUSES.has(rawStatus) ? rawStatus : 'NEW';

      const record = {
        date: dateStr,
        id: sanitizeSheetCell(job.id || `manual_${Date.now()}`, 120),
        title: sanitizeSheetCell(job.title || 'Untitled Role', 200),
        company: sanitizeSheetCell(job.company || 'Unknown Company', 160),
        score: Math.max(0, Math.min(100, Math.round(Number(job.score ?? 85)))),
        reasons: sanitizeSheetCell(
          Array.isArray(job.reasons) ? job.reasons.join(' | ') : String(job.reasons || ''),
          1000
        ),
        gap: sanitizeSheetCell(job.gap || '', 500),
        url: sanitizeSheetCell(job.url || '', 500),
        dm: sanitizeSheetCell(job.dm || '', 1500),
        resumeAngle: sanitizeSheetCell(job.resumeAngle || '', 500),
        status: safeStatus,
      };

      let cloudSaved = false;
      if (isCloudSheetsConfigured()) {
        try {
          await appendCloudSheetRecord(record);
          cloudSaved = true;
        } catch (cloudErr) {
          console.warn('[sheet-sync] Cloud append failed, saving to local store:', cloudErr);
        }
      }

      const localSaved = appendLocalJobRecord(record);
      if (!cloudSaved && !localSaved) {
        return NextResponse.json(
          { error: 'Unable to persist record (read-only filesystem without Cloud Sheets configured).' },
          { status: 500 }
        );
      }
      return NextResponse.json({ success: true, record, cloudSaved, localSaved });
    }

    const { id, rowId, status, dm, resumeAngle, gap, score, reasons } = body;
    const targetId = typeof id === 'string' && id.trim() ? id.trim().slice(0, 120) : undefined;
    const numericRowId = rowId !== undefined ? Number(rowId) : undefined;

    if (!targetId && (!numericRowId || !Number.isInteger(numericRowId) || numericRowId < 2)) {
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
      dm: dm !== undefined ? sanitizeSheetCell(dm, 1500) : undefined,
      resumeAngle: resumeAngle !== undefined ? sanitizeSheetCell(resumeAngle, 500) : undefined,
      gap: gap !== undefined ? sanitizeSheetCell(gap, 500) : undefined,
      score:
        score !== undefined && Number.isFinite(Number(score))
          ? Math.max(0, Math.min(100, Math.round(Number(score))))
          : undefined,
      reasons:
        reasons !== undefined
          ? sanitizeSheetCell(Array.isArray(reasons) ? reasons.join(' | ') : reasons, 1000)
          : undefined,
    };

    let cloudUpdated = false;
    if (isCloudSheetsConfigured()) {
      try {
        cloudUpdated = await updateCloudSheetRowFields(
          { id: targetId, rowId: numericRowId },
          patch
        );
      } catch (cloudErr) {
        console.warn('[sheet-sync] Cloud field update failed, updating local store:', cloudErr);
      }
    }

    const localUpdated = updateLocalJobRow({ id: targetId, rowId: numericRowId }, patch);
    if (!cloudUpdated && !localUpdated) {
      return NextResponse.json(
        { error: 'Matching pipeline record was not found or storage is read-only.' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, cloudUpdated, localUpdated });
  } catch (e) {
    console.error('[sheet-sync POST]', e);
    return NextResponse.json({ error: 'Operation failed' }, { status: 500 });
  }
}
