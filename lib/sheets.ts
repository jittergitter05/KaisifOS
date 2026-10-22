import { google } from 'googleapis';
import fs from 'fs';
import path from 'path';

export interface StoredJobRecord {
  date?: string;
  daysAgo?: number;
  id: string;
  title: string;
  company: string;
  score: number;
  reasons: string;
  gap: string;
  url: string;
  dm: string;
  resumeAngle: string;
  status: string;
}

const LOCAL_STORE_PATH = path.join(process.cwd(), 'data', 'jobs-store.json');

export function isCloudSheetsConfigured(): boolean {
  return Boolean(process.env.GOOGLE_SERVICE_KEY_BASE64 && process.env.GOOGLE_SHEET_ID);
}

export async function getAuth() {
  const credentials = JSON.parse(
    Buffer.from(process.env.GOOGLE_SERVICE_KEY_BASE64 || '', 'base64').toString('utf8')
  );
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

export async function appendCloudSheetRecord(record: StoredJobRecord): Promise<void> {
  if (!isCloudSheetsConfigured()) return;
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
}

export async function updateCloudSheetRowStatus(rowId: number, status: string): Promise<void> {
  if (!isCloudSheetsConfigured()) return;
  const auth = await getAuth();
  const sheets = google.sheets('v4');
  await sheets.spreadsheets.values.update({
    auth,
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: `Sheet1!K${rowId}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[status]] },
  });
}

function resolveDateString(record: StoredJobRecord): string {
  if (record.date && /^\d{4}-\d{2}-\d{2}$/.test(record.date)) {
    return record.date;
  }
  const days = typeof record.daysAgo === 'number' ? record.daysAgo : 0;
  const d = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return d.toISOString().split('T')[0];
}

export function readLocalJobRows(): string[][] {
  try {
    if (!fs.existsSync(LOCAL_STORE_PATH)) return [];
    const raw = JSON.parse(fs.readFileSync(LOCAL_STORE_PATH, 'utf8')) as StoredJobRecord[];
    const header = [
      'Date',
      'ID',
      'Title',
      'Company',
      'Score',
      'Reasons',
      'Gap',
      'URL',
      'DM',
      'ResumeAngle',
      'Status',
    ];
    const dataRows = raw.map((item) => [
      resolveDateString(item),
      String(item.id || ''),
      String(item.title || ''),
      String(item.company || ''),
      String(item.score ?? 0),
      String(item.reasons || ''),
      String(item.gap || ''),
      String(item.url || ''),
      String(item.dm || ''),
      String(item.resumeAngle || ''),
      String(item.status || 'NEW'),
    ]);
    return [header, ...dataRows];
  } catch (e) {
    console.error('[LocalStore] Failed reading jobs-store.json:', e);
    return [];
  }
}

export function updateLocalJobRow(
  rowId: number,
  patch: { status?: string; dm?: string; resumeAngle?: string; gap?: string }
): boolean {
  try {
    if (!fs.existsSync(LOCAL_STORE_PATH)) return false;
    const raw = JSON.parse(fs.readFileSync(LOCAL_STORE_PATH, 'utf8')) as StoredJobRecord[];
    const idx = rowId - 2;
    if (idx < 0 || idx >= raw.length) return false;
    if (patch.status !== undefined) raw[idx].status = patch.status;
    if (patch.dm !== undefined) raw[idx].dm = patch.dm;
    if (patch.resumeAngle !== undefined) raw[idx].resumeAngle = patch.resumeAngle;
    if (patch.gap !== undefined) raw[idx].gap = patch.gap;
    fs.writeFileSync(LOCAL_STORE_PATH, JSON.stringify(raw, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('[LocalStore] Failed updating row:', e);
    return false;
  }
}

export function appendLocalJobRecord(record: StoredJobRecord): boolean {
  try {
    const existing: StoredJobRecord[] = fs.existsSync(LOCAL_STORE_PATH)
      ? JSON.parse(fs.readFileSync(LOCAL_STORE_PATH, 'utf8'))
      : [];
    existing.unshift({
      ...record,
      date: record.date || new Date().toISOString().split('T')[0],
      daysAgo: 0,
    });
    fs.writeFileSync(LOCAL_STORE_PATH, JSON.stringify(existing, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error('[LocalStore] Failed appending record:', e);
    return false;
  }
}

export async function getAllSheetRows(): Promise<{ rows: string[][]; mode: 'cloud-sheets' | 'local-store' }> {
  if (isCloudSheetsConfigured()) {
    try {
      const auth = await getAuth();
      const sheets = google.sheets('v4');
      const response = await sheets.spreadsheets.values.get({
        auth,
        spreadsheetId: process.env.GOOGLE_SHEET_ID,
        range: 'Sheet1!A:K',
      });
      const rows = response.data.values || [];
      if (rows.length > 0) {
        return { rows, mode: 'cloud-sheets' };
      }
    } catch (e) {
      console.warn('[Sheets] Cloud fetch failed, falling back to local store:', e);
    }
  }
  return { rows: readLocalJobRows(), mode: 'local-store' };
}

export async function getPublicStats() {
  try {
    const { rows, mode } = await getAllSheetRows();
    const dataRows = rows.slice(1).filter((r) => r[0]);

    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    let scoutedWeek = 0;
    let totalScore = 0;
    let scoreCount = 0;
    let applied = 0;
    let replied = 0;
    let highConvictionCount = 0;
    let offersAndInterviews = 0;

    for (const row of dataRows) {
      const date = new Date(row[0]);
      const score = parseInt(row[4] || '0', 10);
      const status = row[10] || 'NEW';

      if (date >= weekAgo) scoutedWeek++;
      if (score > 0) {
        totalScore += score;
        scoreCount++;
      }
      if (score >= 90) highConvictionCount++;
      if (['APPLIED', 'REPLIED', 'INTERVIEW', 'OFFER', 'REJECTED'].includes(status)) applied++;
      if (['REPLIED', 'INTERVIEW', 'OFFER'].includes(status)) replied++;
      if (['INTERVIEW', 'OFFER'].includes(status)) offersAndInterviews++;
    }

    return {
      jobs_scouted_this_week: scoutedWeek,
      total_tracked: dataRows.length,
      high_conviction_count: highConvictionCount,
      avg_match_score: scoreCount > 0 ? Math.round(totalScore / scoreCount) : 0,
      applications_sent: applied,
      interviews_and_offers: offersAndInterviews,
      response_rate: applied > 0 ? `${Math.round((replied / applied) * 100)}%` : '0%',
      storage_mode: mode,
      recent_matches: dataRows.slice(0, 5).map((r) => ({
        date: r[0],
        id: r[1],
        title: r[2],
        company: r[3],
        score: parseInt(r[4] || '0', 10),
        reasons: r[5],
        gap: r[6],
        url: r[7],
        dm: r[8],
        resumeAngle: r[9],
        status: r[10] || 'NEW',
      })),
    };
  } catch (e) {
    console.error('Failed to get public stats:', e);
    return {
      jobs_scouted_this_week: 0,
      total_tracked: 0,
      high_conviction_count: 0,
      avg_match_score: 0,
      applications_sent: 0,
      interviews_and_offers: 0,
      response_rate: '0%',
      storage_mode: 'local-store' as const,
      recent_matches: [],
    };
  }
}
