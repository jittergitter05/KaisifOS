import { google } from 'googleapis';
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { isAuthorizedRequest } from '@/lib/auth';
import {
  getAuth,
  getAllSheetRows,
  getPublicStats,
  isCloudSheetsConfigured,
  updateLocalJobRow,
  appendLocalJobRecord,
} from '@/lib/sheets';

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

  try {
    const body = await request.json();

    if (body.action === 'append' && body.job) {
      const { job } = body;
      const dateStr = job.date || new Date().toISOString().split('T')[0];
      const record = {
        date: dateStr,
        id: job.id || `manual_${Date.now()}`,
        title: job.title || 'Untitled Role',
        company: job.company || 'Unknown Company',
        score: Number(job.score ?? 85),
        reasons: Array.isArray(job.reasons) ? job.reasons.join(' | ') : String(job.reasons || ''),
        gap: String(job.gap || ''),
        url: String(job.url || ''),
        dm: String(job.dm || ''),
        resumeAngle: String(job.resumeAngle || ''),
        status: String(job.status || 'NEW'),
      };

      if (isCloudSheetsConfigured()) {
        try {
          const auth = await getAuth();
          const sheets = google.sheets('v4');
          await sheets.spreadsheets.values.append({
            auth,
            spreadsheetId: process.env.GOOGLE_SHEET_ID,
            range: 'Sheet1!A:K',
            valueInputOption: 'USER_ENTERED',
            requestBody: {
              values: [
                [
                  record.date,
                  record.id,
                  record.title,
                  record.company,
                  record.score,
                  record.reasons,
                  record.gap,
                  record.url,
                  record.dm,
                  record.resumeAngle,
                  record.status,
                ],
              ],
            },
          });
        } catch (cloudErr) {
          console.warn('[sheet-sync] Cloud append failed, saving to local store:', cloudErr);
        }
      }

      appendLocalJobRecord(record);
      return NextResponse.json({ success: true, record });
    }

    if (!isAuthed) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { rowId, status, dm, resumeAngle, gap } = body;
    if (!rowId) {
      return NextResponse.json({ error: 'Missing rowId' }, { status: 400 });
    }

    if (isCloudSheetsConfigured() && status) {
      try {
        const auth = await getAuth();
        const sheets = google.sheets('v4');
        await sheets.spreadsheets.values.update({
          auth,
          spreadsheetId: process.env.GOOGLE_SHEET_ID,
          range: `Sheet1!K${rowId}`,
          valueInputOption: 'USER_ENTERED',
          requestBody: { values: [[status]] },
        });
      } catch (cloudErr) {
        console.warn('[sheet-sync] Cloud status update failed, updating local store:', cloudErr);
      }
    }

    updateLocalJobRow(Number(rowId), { status, dm, resumeAngle, gap });
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('[sheet-sync POST]', e);
    return NextResponse.json({ error: 'Operation failed' }, { status: 500 });
  }
}
