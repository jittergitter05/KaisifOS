import { google, sheets_v4 } from 'googleapis';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { parseIsoDateTimestamp } from './utils';

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

export type RuntimeStorageMode = 'custom-dir' | 'local-disk' | 'ephemeral-tmp' | 'read-only';

export interface StorageHealthInfo {
  storageMode: 'cloud-sheets' | 'local-disk' | 'ephemeral-tmp' | 'read-only';
  localWritable: boolean;
  ephemeralFallback: boolean;
  cloudConfigured: boolean;
  cloudError?: string;
  resolvedDataDir: string;
}

const BUNDLED_DATA_DIR = path.join(process.cwd(), 'data');
const TMP_DATA_DIR = path.join(os.tmpdir(), 'kaisifos-data');

const bootstrappedSheets = new Set<string>();
const bootstrapInFlight = new Map<string, Promise<void>>();

/**
 * Checks whether a directory exists (or can be created) and accepts file writes.
 */
export function isDirectoryWritable(dirPath: string): boolean {
  try {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
    const probePath = path.join(
      dirPath,
      `.write-probe-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    );
    fs.writeFileSync(probePath, 'ok', 'utf8');
    fs.unlinkSync(probePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolves the highest-priority writable data directory:
 * 1. KAISIFOS_DATA_DIR (explicit user/container volume override)
 * 2. <cwd>/data (standard writable Node/dev server)
 * 3. <os.tmpdir()>/kaisifos-data (serverless / Cloud Run read-only container fallback)
 */
export function resolveRuntimeDataDir(): {
  dir: string;
  mode: RuntimeStorageMode;
  writable: boolean;
} {
  const customDir = process.env.KAISIFOS_DATA_DIR?.trim();
  if (customDir) {
    const resolved = path.resolve(customDir);
    if (isDirectoryWritable(resolved)) {
      return { dir: resolved, mode: 'custom-dir', writable: true };
    }
  }

  if (isDirectoryWritable(BUNDLED_DATA_DIR)) {
    return { dir: BUNDLED_DATA_DIR, mode: 'local-disk', writable: true };
  }

  if (isDirectoryWritable(TMP_DATA_DIR)) {
    return { dir: TMP_DATA_DIR, mode: 'ephemeral-tmp', writable: true };
  }

  return { dir: BUNDLED_DATA_DIR, mode: 'read-only', writable: false };
}

/**
 * Resolves the best path to READ a persisted JSON file from.
 * Prefers custom override / writable /tmp overlay if present & newer than bundled copy.
 */
export function resolveReadableFilePath(filename: string): string | null {
  const candidates: string[] = [];
  const customDir = process.env.KAISIFOS_DATA_DIR?.trim();
  if (customDir) {
    candidates.push(path.join(path.resolve(customDir), filename));
  }

  const tmpFile = path.join(TMP_DATA_DIR, filename);
  const bundledFile = path.join(BUNDLED_DATA_DIR, filename);

  const tmpExists = fs.existsSync(tmpFile);
  const bundledExists = fs.existsSync(bundledFile);

  if (tmpExists && bundledExists) {
    try {
      const tmpMtime = fs.statSync(tmpFile).mtimeMs;
      const bundledMtime = fs.statSync(bundledFile).mtimeMs;
      if (tmpMtime >= bundledMtime || !isDirectoryWritable(BUNDLED_DATA_DIR)) {
        candidates.push(tmpFile, bundledFile);
      } else {
        candidates.push(bundledFile, tmpFile);
      }
    } catch {
      candidates.push(tmpFile, bundledFile);
    }
  } else {
    if (tmpExists) candidates.push(tmpFile);
    if (bundledExists) candidates.push(bundledFile);
  }

  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

/**
 * Resolves the writable target path for a file and seeds it from bundled data if moving into /tmp or custom dir.
 */
export function resolveWritableFilePath(filename: string): {
  targetPath: string;
  mode: Exclude<RuntimeStorageMode, 'read-only'>;
} | null {
  const dirInfo = resolveRuntimeDataDir();
  if (!dirInfo.writable || dirInfo.mode === 'read-only') {
    return null;
  }

  const targetPath = path.join(dirInfo.dir, filename);
  if (!fs.existsSync(targetPath)) {
    const bundledSeed = path.join(BUNDLED_DATA_DIR, filename);
    if (dirInfo.dir !== BUNDLED_DATA_DIR && fs.existsSync(bundledSeed)) {
      try {
        fs.copyFileSync(bundledSeed, targetPath);
      } catch {
        // Proceed cleanly even if seed copy isn't available
      }
    }
  }

  return { targetPath, mode: dirInfo.mode };
}

export function readRuntimeJsonFile<T>(filename: string, fallback: T): T {
  try {
    const readablePath = resolveReadableFilePath(filename);
    if (!readablePath) return fallback;
    const raw = fs.readFileSync(readablePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeRuntimeJsonFile(
  filename: string,
  data: unknown
): {
  ok: boolean;
  mode: RuntimeStorageMode;
  path?: string;
  error?: string;
} {
  try {
    const resolved = resolveWritableFilePath(filename);
    if (!resolved) {
      return {
        ok: false,
        mode: 'read-only',
        error: 'No writable filesystem directory available (neither data/ nor /tmp).',
      };
    }
    atomicWriteJsonFile(resolved.targetPath, data);
    return {
      ok: true,
      mode: resolved.mode,
      path: resolved.targetPath,
    };
  } catch (err) {
    return {
      ok: false,
      mode: 'read-only',
      error: (err as Error).message,
    };
  }
}

export function getStorageHealthInfo(cloudError?: string): StorageHealthInfo {
  const cloudConfigured = isCloudSheetsConfigured();
  const dirInfo = resolveRuntimeDataDir();

  let storageMode: StorageHealthInfo['storageMode'] = 'read-only';
  if (cloudConfigured && !cloudError) {
    storageMode = 'cloud-sheets';
  } else if (dirInfo.mode === 'local-disk' || dirInfo.mode === 'custom-dir') {
    storageMode = 'local-disk';
  } else if (dirInfo.mode === 'ephemeral-tmp') {
    storageMode = 'ephemeral-tmp';
  }

  return {
    storageMode,
    localWritable: dirInfo.writable,
    ephemeralFallback: dirInfo.mode === 'ephemeral-tmp',
    cloudConfigured,
    cloudError,
    resolvedDataDir: dirInfo.dir,
  };
}

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
  return Boolean(process.env.GOOGLE_SERVICE_KEY_BASE64?.trim() && process.env.GOOGLE_SHEET_ID?.trim());
}

/**
 * Decodes Google Service Account credentials whether provided as raw JSON or Base64 (with/without whitespace).
 */
export function decodeServiceAccountCredentials(): {
  client_email: string;
  private_key: string;
  [key: string]: unknown;
} {
  const rawEnv = (process.env.GOOGLE_SERVICE_KEY_BASE64 || '').trim();
  if (!rawEnv) {
    throw new Error('GOOGLE_SERVICE_KEY_BASE64 is empty or missing.');
  }

  let jsonText = rawEnv;
  if (!rawEnv.startsWith('{')) {
    const cleanedB64 = rawEnv.replace(/\s+/g, '');
    jsonText = Buffer.from(cleanedB64, 'base64').toString('utf8').trim();
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error(
      'GOOGLE_SERVICE_KEY_BASE64 is not valid Base64-encoded service account JSON.'
    );
  }

  if (typeof parsed.client_email !== 'string' || typeof parsed.private_key !== 'string') {
    throw new Error(
      'Decoded Google Service Account JSON is missing client_email or private_key.'
    );
  }

  return {
    ...parsed,
    client_email: parsed.client_email,
    private_key: parsed.private_key.replace(/\\n/g, '\n'),
  };
}

export async function getAuth() {
  const credentials = decodeServiceAccountCredentials();
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

const CANONICAL_SHEET1_HEADERS = [
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

/**
 * Auto-provisions missing tabs (Sheet1, SeenJobs, Profile) and Sheet1 headers on fresh spreadsheets.
 */
export async function ensureCloudSheetStructure(
  sheets: sheets_v4.Sheets,
  auth: Awaited<ReturnType<typeof getAuth>>,
  spreadsheetId: string
): Promise<void> {
  if (bootstrappedSheets.has(spreadsheetId)) return;

  const existingPromise = bootstrapInFlight.get(spreadsheetId);
  if (existingPromise) {
    await existingPromise;
    return;
  }

  const runBootstrap = (async () => {
    const meta = await sheets.spreadsheets.get({
      auth,
      spreadsheetId,
      fields: 'sheets.properties.title',
    });

    const existingTitles = new Set(
      (meta.data.sheets || [])
        .map((s) => s.properties?.title)
        .filter((t): t is string => Boolean(t))
    );

    const requiredTabs = ['Sheet1', 'SeenJobs', 'Profile'];
    const missingTabs = requiredTabs.filter((t) => !existingTitles.has(t));

    if (missingTabs.length > 0) {
      await sheets.spreadsheets.batchUpdate({
        auth,
        spreadsheetId,
        requestBody: {
          requests: missingTabs.map((title) => ({
            addSheet: { properties: { title } },
          })),
        },
      });
    }

    const headerRes = await sheets.spreadsheets.values.get({
      auth,
      spreadsheetId,
      range: 'Sheet1!A1:K1',
    });
    const firstRow = headerRes.data.values?.[0] || [];
    if (firstRow.length === 0 || String(firstRow[1] || '').trim() !== 'ID') {
      await sheets.spreadsheets.values.update({
        auth,
        spreadsheetId,
        range: 'Sheet1!A1:K1',
        valueInputOption: 'RAW',
        requestBody: { values: [CANONICAL_SHEET1_HEADERS] },
      });
    }

    bootstrappedSheets.add(spreadsheetId);
  })();

  bootstrapInFlight.set(spreadsheetId, runBootstrap);
  try {
    await runBootstrap;
  } finally {
    bootstrapInFlight.delete(spreadsheetId);
  }
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

/**
 * Normalizes plain-text fields for local JSON persistence without prepending spreadsheet formula ticks.
 */
export function sanitizePlainField(val: unknown, maxLen = 2000): string {
  return String(val ?? '').slice(0, maxLen).trim();
}

export async function appendCloudSheetRecord(record: StoredJobRecord): Promise<void> {
  if (!isCloudSheetsConfigured()) return;
  const auth = await getAuth();
  const sheets = google.sheets('v4');
  const spreadsheetId = process.env.GOOGLE_SHEET_ID!;
  await ensureCloudSheetStructure(sheets, auth, spreadsheetId);

  await sheets.spreadsheets.values.append({
    auth,
    spreadsheetId,
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
  const spreadsheetId = process.env.GOOGLE_SHEET_ID!;
  await ensureCloudSheetStructure(sheets, auth, spreadsheetId);

  let targetRow: number | undefined;
  if (target.id) {
    const idColRes = await sheets.spreadsheets.values.get({
      auth,
      spreadsheetId,
      range: 'Sheet1!B:B',
    });
    const colValues = idColRes.data.values || [];
    const foundIdx = colValues.findIndex((r, idx) => idx >= 1 && String(r[0] || '').trim() === target.id);
    if (foundIdx < 1) {
      // Strict ID safety: never fall back to potentially shifted rowId when target.id was supplied
      return false;
    }
    targetRow = foundIdx + 1;
  } else {
    targetRow = target.rowId;
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
  const spreadsheetId = process.env.GOOGLE_SHEET_ID!;
  await ensureCloudSheetStructure(sheets, auth, spreadsheetId);

  const idToRow = new Map<string, number>();
  if (targets.some((t) => Boolean(t.id))) {
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
  }

  const safeStatus = sanitizeSheetCell(status, 40);
  const data: Array<{ range: string; values: string[][] }> = [];
  const seenRows = new Set<number>();

  for (const t of targets) {
    // Strict ID matching: only fall back to rowId when no ID was supplied
    const resolved = t.id ? idToRow.get(t.id) : t.rowId;
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

/**
 * Reads the persisted candidate profile JSON from the Google Sheets 'Profile' tab (`Profile!A1:B1`).
 */
export async function readCloudProfileJson(): Promise<{ json: string; updatedAt?: string } | null> {
  if (!isCloudSheetsConfigured()) return null;
  const auth = await getAuth();
  const sheets = google.sheets('v4');
  const spreadsheetId = process.env.GOOGLE_SHEET_ID!;
  await ensureCloudSheetStructure(sheets, auth, spreadsheetId);

  const res = await sheets.spreadsheets.values.get({
    auth,
    spreadsheetId,
    range: 'Profile!A1:B1',
  });
  const row = res.data.values?.[0];
  if (!row || typeof row[0] !== 'string' || !row[0].trim().startsWith('{')) {
    return null;
  }
  return {
    json: row[0],
    updatedAt: typeof row[1] === 'string' ? row[1] : undefined,
  };
}

/**
 * Persists candidate profile JSON cleanly to Google Sheets (`Profile!A1:B1`) with RAW encoding.
 */
export async function writeCloudProfileJson(jsonStr: string): Promise<boolean> {
  if (!isCloudSheetsConfigured()) return false;
  const auth = await getAuth();
  const sheets = google.sheets('v4');
  const spreadsheetId = process.env.GOOGLE_SHEET_ID!;
  await ensureCloudSheetStructure(sheets, auth, spreadsheetId);

  await sheets.spreadsheets.values.update({
    auth,
    spreadsheetId,
    range: 'Profile!A1:B1',
    valueInputOption: 'RAW',
    requestBody: {
      values: [[jsonStr, new Date().toISOString()]],
    },
  });
  return true;
}

/**
 * Fetches evaluated/rejected SeenJobs IDs from Google Sheets `SeenJobs!A:A`.
 */
export async function getCloudSeenJobIds(): Promise<Set<string>> {
  if (!isCloudSheetsConfigured()) return new Set();
  const auth = await getAuth();
  const sheets = google.sheets('v4');
  const spreadsheetId = process.env.GOOGLE_SHEET_ID!;
  await ensureCloudSheetStructure(sheets, auth, spreadsheetId);

  const res = await sheets.spreadsheets.values.get({
    auth,
    spreadsheetId,
    range: 'SeenJobs!A:A',
  });
  const ids = new Set<string>();
  for (const row of res.data.values || []) {
    const val = String(row[0] || '').trim();
    if (val && val !== 'ID') ids.add(val);
  }
  return ids;
}

export async function appendCloudSeenJobIds(ids: string[]): Promise<void> {
  if (!isCloudSheetsConfigured() || ids.length === 0) return;
  const existing = await getCloudSeenJobIds();
  const toAdd = Array.from(new Set(ids.map((i) => i.trim()).filter(Boolean))).filter(
    (id) => !existing.has(id)
  );
  if (toAdd.length === 0) return;

  const auth = await getAuth();
  const sheets = google.sheets('v4');
  const spreadsheetId = process.env.GOOGLE_SHEET_ID!;
  await sheets.spreadsheets.values.append({
    auth,
    spreadsheetId,
    range: 'SeenJobs!A:A',
    valueInputOption: 'RAW',
    requestBody: {
      values: toAdd.map((id) => [id]),
    },
  });
}

export function readLocalSeenJobIds(): Set<string> {
  const arr = readRuntimeJsonFile<string[]>('seen-jobs.json', []);
  return new Set(Array.isArray(arr) ? arr.map(String) : []);
}

export function appendLocalSeenJobIds(ids: string[]): boolean {
  if (ids.length === 0) return true;
  const existing = readLocalSeenJobIds();
  for (const id of ids) {
    if (id) existing.add(id);
  }
  const bounded = Array.from(existing).slice(-5000);
  return writeRuntimeJsonFile('seen-jobs.json', bounded).ok;
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
    const raw = readRuntimeJsonFile<StoredJobRecord[]>('jobs-store.json', []);
    if (!Array.isArray(raw) || raw.length === 0) return [];
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
    return [CANONICAL_SHEET1_HEADERS, ...dataRows];
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
    const raw = readRuntimeJsonFile<StoredJobRecord[]>('jobs-store.json', []);
    if (!Array.isArray(raw) || raw.length === 0) return false;

    const targetId = typeof target === 'object' ? target.id : undefined;
    const targetRowId = typeof target === 'number' ? target : target.rowId;

    let idx = targetId ? raw.findIndex((item) => item.id === targetId) : -1;
    if (idx < 0 && !targetId && typeof targetRowId === 'number') {
      idx = targetRowId - 2;
    }

    if (idx < 0 || idx >= raw.length) return false;
    if (patch.status !== undefined) raw[idx].status = sanitizePlainField(patch.status, 40);
    if (patch.dm !== undefined) raw[idx].dm = sanitizePlainField(patch.dm, 1500);
    if (patch.resumeAngle !== undefined) {
      raw[idx].resumeAngle = sanitizePlainField(patch.resumeAngle, 500);
    }
    if (patch.gap !== undefined) raw[idx].gap = sanitizePlainField(patch.gap, 500);
    if (patch.score !== undefined) {
      raw[idx].score = Math.max(0, Math.min(100, Math.round(Number(patch.score) || 0)));
    }
    if (patch.reasons !== undefined) raw[idx].reasons = sanitizePlainField(patch.reasons, 1000);
    return writeRuntimeJsonFile('jobs-store.json', raw).ok;
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
    const raw = readRuntimeJsonFile<StoredJobRecord[]>('jobs-store.json', []);
    if (!Array.isArray(raw) || raw.length === 0 || targets.length === 0) return 0;
    let updatedCount = 0;
    const cleanStatus = sanitizePlainField(status, 40);

    for (const target of targets) {
      let idx = target.id ? raw.findIndex((item) => item.id === target.id) : -1;
      if (idx < 0 && !target.id && typeof target.rowId === 'number') {
        idx = target.rowId - 2;
      }
      if (idx >= 0 && idx < raw.length) {
        raw[idx].status = cleanStatus;
        updatedCount += 1;
      }
    }

    if (updatedCount > 0) {
      const writeRes = writeRuntimeJsonFile('jobs-store.json', raw);
      if (!writeRes.ok) return 0;
    }
    return updatedCount;
  } catch (e) {
    console.error('[LocalStore] Failed batch updating rows:', e);
    return 0;
  }
}

export function appendLocalJobRecordDetailed(record: StoredJobRecord): {
  ok: boolean;
  mode: RuntimeStorageMode;
  error?: string;
} {
  try {
    const existing = readRuntimeJsonFile<StoredJobRecord[]>('jobs-store.json', []);
    const deduped = record.id ? existing.filter((item) => item.id !== record.id) : [...existing];
    deduped.unshift({
      ...record,
      title: sanitizePlainField(record.title, 200),
      company: sanitizePlainField(record.company, 160),
      reasons: sanitizePlainField(record.reasons, 1000),
      gap: sanitizePlainField(record.gap, 500),
      url: sanitizePlainField(record.url, 500),
      dm: sanitizePlainField(record.dm, 1500),
      resumeAngle: sanitizePlainField(record.resumeAngle, 500),
      status: sanitizePlainField(record.status || 'NEW', 40),
      date: record.date || new Date().toISOString().split('T')[0],
      daysAgo: 0,
    });
    const res = writeRuntimeJsonFile('jobs-store.json', deduped);
    return { ok: res.ok, mode: res.mode, error: res.error };
  } catch (e) {
    return {
      ok: false,
      mode: 'read-only',
      error: (e as Error).message,
    };
  }
}

export function appendLocalJobRecord(record: StoredJobRecord): boolean {
  return appendLocalJobRecordDetailed(record).ok;
}

export async function getAllSheetRows(): Promise<{
  rows: string[][];
  mode: 'cloud-sheets' | 'local-store';
  cloudError?: string;
}> {
  let cloudError: string | undefined;
  if (isCloudSheetsConfigured()) {
    try {
      const auth = await getAuth();
      const sheets = google.sheets('v4');
      const spreadsheetId = process.env.GOOGLE_SHEET_ID!;
      await ensureCloudSheetStructure(sheets, auth, spreadsheetId);

      const response = await sheets.spreadsheets.values.get({
        auth,
        spreadsheetId,
        range: 'Sheet1!A:K',
      });
      const rows = response.data.values || [];
      if (rows.length > 0) {
        return { rows, mode: 'cloud-sheets' };
      }
      return { rows: [CANONICAL_SHEET1_HEADERS], mode: 'cloud-sheets' };
    } catch (e) {
      cloudError = (e as Error).message;
      console.warn('[Sheets] Cloud fetch failed, falling back to runtime store:', cloudError);
    }
  }
  return { rows: readLocalJobRows(), mode: 'local-store', cloudError };
}

export async function getPublicStats() {
  try {
    const { rows, mode, cloudError } = await getAllSheetRows();
    const dataRows = rows.slice(1).filter((r) => r[0]);

    const nowMs = Date.now();
    const weekAgoMs = nowMs - 7 * 24 * 60 * 60 * 1000;

    let scoutedWeek = 0;
    let totalScore = 0;
    let scoreCount = 0;
    let applied = 0;
    let replied = 0;
    let highConvictionCount = 0;
    let offersAndInterviews = 0;

    for (const row of dataRows) {
      const ts = parseIsoDateTimestamp(row[0]);
      const score = parseInt(row[4] || '0', 10);
      const status = row[10] || 'NEW';

      if (Number.isFinite(ts) && ts >= weekAgoMs) scoutedWeek++;
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
        const tA = parseIsoDateTimestamp(a[0]) || 0;
        const tB = parseIsoDateTimestamp(b[0]) || 0;
        if (tB !== tA) return tB - tA;
        return parseInt(b[4] || '0', 10) - parseInt(a[4] || '0', 10);
      })
      .slice(0, 5);

    const storageHealth = getStorageHealthInfo(cloudError);

    return {
      jobs_scouted_this_week: scoutedWeek,
      total_tracked: dataRows.length,
      high_conviction_count: highConvictionCount,
      avg_match_score: scoreCount > 0 ? Math.round(totalScore / scoreCount) : 0,
      applications_sent: applied,
      interviews_and_offers: offersAndInterviews,
      response_rate: applied > 0 ? `${Math.round((replied / applied) * 100)}%` : '0%',
      storage_mode: mode,
      persistence_mode: storageHealth.storageMode,
      cloud_error: cloudError,
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
      persistence_mode: 'read-only' as const,
      recent_matches: [],
    };
  }
}
