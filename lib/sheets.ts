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

/**
 * Atomic write-to-temp + renameSync prevents partial/corrupt JSON writes on concurrent mutations.
 */
export function atomicWriteJsonFile(targetPath: string, data: unknown): void {
  const dir = path.dirname(targetPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmpPath = `${targetPath}.tmp.${process.pid}.${Date.now()}.${Math.random()
    .toString(36)
    .slice(2, 7)}`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmpPath, targetPath);
}

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

/**
 * Defends spreadsheet exports and Google Sheets cells against CSV/Formula injection (=, +, -, @, \t, \r).
 */
export function sanitizeSheetCell(val: unknown, maxLen = 2000): string {
  const raw = String(val ?? '').slice(0, maxLen);
  const str = raw.trim();
  if (/^[=+\-@\t\r]/.test(raw) || /^[=+\-@\t\r]/.test(str)) {
    return `'${str}`;
  }
  return str;
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
          sanitizeSheetCell(record.date || new Date().toISOString().split('T')[0], 20),
          sanitizeSheetCell(record.id, 120),
          sanitizeSheetCell(record.title, 200),
          sanitizeSheetCell(record.company, 160),
          Math.max(0, Math.min(100, Math.round(Number(record.score) || 0))),
          sanitizeSheetCell(record.reasons, 1000),
          sanitizeSheetCell(record.gap, 500),
          sanitizeSheetCell(record.url, 500),
          sanitizeSheetCell(record.dm, 1500),
          sanitizeSheetCell(record.resumeAngle, 500),
          sanitizeSheetCell(record.status, 40),
        ],
      ],
    },
  });
}

export async function updateCloudSheetRowStatus(rowId: number, status: string): Promise<void> {
  await updateCloudSheetRowFields({ rowId }, { status });
}

export interface JobFieldPatch {
  status?: string;
  dm?: string;
  resumeAngle?: string;
  gap?: string;
  score?: number;
  reasons?: string;
}

export async function updateCloudSheetRowFields(
  target: { id?: string; rowId?: number },
  patch: JobFieldPatch
): Promise<boolean> {
  if (!isCloudSheetsConfigured()) return false;
  const auth = await getAuth();
  const sheets = google.sheets('v4');
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  let targetRow = target.rowId;
  if (target.id) {
    try {
      const idColRes = await sheets.spreadsheets.values.get({
        auth,
        spreadsheetId,
        range: 'Sheet1!B:B',
      });
      const colValues = idColRes.data.values || [];
      const foundIdx = colValues.findIndex((r) => String(r[0] || '').trim() === target.id);
      if (foundIdx >= 1) {
        targetRow = foundIdx + 1;
      }
    } catch (lookupErr) {
      console.warn('[Sheets] ID lookup fell back to rowId:', lookupErr);
    }
  }

  if (!targetRow || !Number.isInteger(targetRow) || targetRow < 2) {
    return false;
  }

  const data: Array<{ range: string; values: (string | number)[][] }> = [];
  if (patch.score !== undefined) {
    data.push({
      range: `Sheet1!E${targetRow}`,
      values: [[Math.max(0, Math.min(100, Math.round(Number(patch.score) || 0)))]],
    });
  }
  if (patch.reasons !== undefined) {
    data.push({ range: `Sheet1!F${targetRow}`, values: [[sanitizeSheetCell(patch.reasons, 1000)]] });
  }
  if (patch.gap !== undefined) {
    data.push({ range: `Sheet1!G${targetRow}`, values: [[sanitizeSheetCell(patch.gap, 500)]] });
  }
  if (patch.dm !== undefined) {
    data.push({ range: `Sheet1!I${targetRow}`, values: [[sanitizeSheetCell(patch.dm, 1500)]] });
  }
  if (patch.resumeAngle !== undefined) {
    data.push({
      range: `Sheet1!J${targetRow}`,
      values: [[sanitizeSheetCell(patch.resumeAngle, 500)]],
    });
  }
  if (patch.status !== undefined) {
    data.push({ range: `Sheet1!K${targetRow}`, values: [[sanitizeSheetCell(patch.status, 40)]] });
  }

  if (data.length === 0) return false;

  await sheets.spreadsheets.values.batchUpdate({
    auth,
    spreadsheetId,
    requestBody: {
      valueInputOption: 'USER_ENTERED',
      data,
    },
  });
  return true;
}

/**
 * Atomic single-call batch status update on Google Sheets v4 for bulk toolbar actions.
 */
export async function batchUpdateCloudSheetRows(
  targets: Array<{ id?: string; rowId?: number }>,
  status: string
): Promise<number> {
  if (!isCloudSheetsConfigured() || targets.length === 0) return 0;
  const auth = await getAuth();
  const sheets = google.sheets('v4');
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  const idToRow = new Map<string, number>();
  if (targets.some((t) => Boolean(t.id))) {
    try {
      const idColRes = await sheets.spreadsheets.values.get({
        auth,
        spreadsheetId,
        range: 'Sheet1!B:B',
      });
      const colValues = idColRes.data.values || [];
      colValues.forEach((r, idx) => {
        const key = String(r[0] || '').trim();
        if (idx >= 1 && key) idToRow.set(key, idx + 1);
      });
    } catch (lookupErr) {
      console.warn('[Sheets] Batch ID lookup fell back to rowIds:', lookupErr);
    }
  }

  const safeStatus = sanitizeSheetCell(status, 40);
  const data: Array<{ range: string; values: string[][] }> = [];
  const seenRows = new Set<number>();

  for (const t of targets) {
    const resolved = (t.id ? idToRow.get(t.id) : undefined) ?? t.rowId;
    if (resolved && Number.isInteger(resolved) && resolved >= 2 && !seenRows.has(resolved)) {
      seenRows.add(resolved);
      data.push({ range: `Sheet1!K${resolved}`, values: [[safeStatus]] });
    }
  }

  if (data.length === 0) return 0;

  await sheets.spreadsheets.values.batchUpdate({
    auth,
    spreadsheetId,
    requestBody: {
      valueInputOption: 'USER_ENTERED',
      data,
    },
  });

  return data.length;
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
  target: number | { id?: string; rowId?: number },
  patch: JobFieldPatch
): boolean {
  try {
    if (!fs.existsSync(LOCAL_STORE_PATH)) return false;
    const raw = JSON.parse(fs.readFileSync(LOCAL_STORE_PATH, 'utf8')) as StoredJobRecord[];

    const targetId = typeof target === 'object' ? target.id : undefined;
    const targetRowId = typeof target === 'number' ? target : target.rowId;

    let idx = targetId ? raw.findIndex((item) => item.id === targetId) : -1;
    if (idx < 0 && typeof targetRowId === 'number') {
      idx = targetRowId - 2;
    }

    if (idx < 0 || idx >= raw.length) return false;
    if (patch.status !== undefined) raw[idx].status = patch.status;
    if (patch.dm !== undefined) raw[idx].dm = patch.dm;
    if (patch.resumeAngle !== undefined) raw[idx].resumeAngle = patch.resumeAngle;
    if (patch.gap !== undefined) raw[idx].gap = patch.gap;
    if (patch.score !== undefined) {
      raw[idx].score = Math.max(0, Math.min(100, Math.round(Number(patch.score) || 0)));
    }
    if (patch.reasons !== undefined) raw[idx].reasons = patch.reasons;
    atomicWriteJsonFile(LOCAL_STORE_PATH, raw);
    return true;
  } catch (e) {
    console.error('[LocalStore] Failed updating row:', e);
    return false;
  }
}

export function batchUpdateLocalJobRows(
  targets: Array<{ id?: string; rowId?: number }>,
  status: string
): number {
  try {
    if (!fs.existsSync(LOCAL_STORE_PATH) || targets.length === 0) return 0;
    const raw = JSON.parse(fs.readFileSync(LOCAL_STORE_PATH, 'utf8')) as StoredJobRecord[];
    let updatedCount = 0;

    for (const target of targets) {
      let idx = target.id ? raw.findIndex((item) => item.id === target.id) : -1;
      if (idx < 0 && typeof target.rowId === 'number') {
        idx = target.rowId - 2;
      }
      if (idx >= 0 && idx < raw.length) {
        raw[idx].status = status;
        updatedCount += 1;
      }
    }

    if (updatedCount > 0) {
      atomicWriteJsonFile(LOCAL_STORE_PATH, raw);
    }
    return updatedCount;
  } catch (e) {
    console.error('[LocalStore] Failed batch updating rows:', e);
    return 0;
  }
}

export function appendLocalJobRecord(record: StoredJobRecord): boolean {
  try {
    const existing: StoredJobRecord[] = fs.existsSync(LOCAL_STORE_PATH)
      ? JSON.parse(fs.readFileSync(LOCAL_STORE_PATH, 'utf8'))
      : [];
    const deduped = record.id ? existing.filter((item) => item.id !== record.id) : existing;
    deduped.unshift({
      ...record,
      date: record.date || new Date().toISOString().split('T')[0],
      daysAgo: 0,
    });
    atomicWriteJsonFile(LOCAL_STORE_PATH, deduped);
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

    const sortedRecent = [...dataRows]
      .sort((a, b) => {
        const tA = new Date(a[0]).getTime() || 0;
        const tB = new Date(b[0]).getTime() || 0;
        if (tB !== tA) return tB - tA;
        return parseInt(b[4] || '0', 10) - parseInt(a[4] || '0', 10);
      })
      .slice(0, 5);

    return {
      jobs_scouted_this_week: scoutedWeek,
      total_tracked: dataRows.length,
      high_conviction_count: highConvictionCount,
      avg_match_score: scoreCount > 0 ? Math.round(totalScore / scoreCount) : 0,
      applications_sent: applied,
      interviews_and_offers: offersAndInterviews,
      response_rate: applied > 0 ? `${Math.round((replied / applied) * 100)}%` : '0%',
      storage_mode: mode,
      recent_matches: sortedRecent.map((r) => ({
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
