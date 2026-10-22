import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { isAuthorizedRequest } from '@/lib/auth';
import {
  getAllSheetRows,
  getPublicStats,
  isCloudSheetsConfigured,
  updateLocalJobRow,
  appendLocalJobRecord,
  appendCloudSheetRecord,
  updateCloudSheetRowStatus,
} from '@/lib/sheets';

const ALLOWED_STATUSES = new Set([
  'NEW',
  'SHORTLISTED',
  'APPLIED',
  'INTERVIEWING',
  'OFFER',
  'REJECTED',
  'ARCHIVED',
  'REPLIED',
]);

/**
 * Prevents spreadsheet formula injection (CSV/Sheet injection) when writing
 * user-controlled strings with valueInputOption: 'USER_ENTERED'.
 */
function sanitizeSheetCell(val: unknown, maxLen = 2000): string {
  const str = String(val ?? '').trim().slice(0, maxLen);
  if (/^[=+\-@]/.test(str)) {
    return `'${str}`;
  }
  return str;
}

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

      if (isCloudSheetsConfigured()) {
        try {
          await appendCloudSheetRecord(record);
        } catch (cloudErr) {
          console.warn('[sheet-sync] Cloud append failed, saving to local store:', cloudErr);
        }
      }

      appendLocalJobRecord(record);
      return NextResponse.json({ success: true, record });
    }

    const { rowId, status, dm, resumeAngle, gap } = body;
    const numericRowId = Number(rowId);
    if (!rowId || !Number.isInteger(numericRowId) || numericRowId < 2) {
      return NextResponse.json({ error: 'Invalid or missing rowId' }, { status: 400 });
    }

    const safeStatus =
      status && ALLOWED_STATUSES.has(String(status).toUpperCase())
        ? String(status).toUpperCase()
        : undefined;

    if (isCloudSheetsConfigured() && safeStatus) {
      try {
        await updateCloudSheetRowStatus(numericRowId, safeStatus);
      } catch (cloudErr) {
        console.warn('[sheet-sync] Cloud status update failed, updating local store:', cloudErr);
      }
    }

    updateLocalJobRow(numericRowId, {
      status: safeStatus,
      dm: dm !== undefined ? sanitizeSheetCell(dm, 1500) : undefined,
      resumeAngle: resumeAngle !== undefined ? sanitizeSheetCell(resumeAngle, 500) : undefined,
      gap: gap !== undefined ? sanitizeSheetCell(gap, 500) : undefined,
    });
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('[sheet-sync POST]', e);
    return NextResponse.json({ error: 'Operation failed' }, { status: 500 });
  }
}
