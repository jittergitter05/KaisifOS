import { google } from 'googleapis';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

import {
  isNeonPostgresConfigured,
  getNeonAppliedJobs,
  updateNeonJobFields,
} from '../lib/neon-db.js';

dotenv.config();

export function groupCompanies(rows) {
  const pendingRows = [];
  const lowerCompanies = new Map();
  rows.forEach((row, index) => {
    if (row[10] === 'APPLIED' && row[3]) {
      pendingRows.push({ row, index });
      const companyLowerCase = row[3].toLowerCase();
      if (!lowerCompanies.has(companyLowerCase)) {
        lowerCompanies.set(companyLowerCase, []);
      }
      lowerCompanies.get(companyLowerCase).push(index);
    }
  });
  return { pendingRows, lowerCompanies };
}

function decodeServiceAccountFromEnv() {
  const raw = (process.env.GOOGLE_SERVICE_KEY_BASE64 || '').trim();
  if (!raw) throw new Error('Missing GOOGLE_SERVICE_KEY_BASE64');
  const jsonText = raw.startsWith('{')
    ? raw
    : Buffer.from(raw.replace(/\s+/g, ''), 'base64').toString('utf8').trim();
  const credentials = JSON.parse(jsonText);
  if (!credentials.client_email || !credentials.private_key) {
    throw new Error('Google Service Account JSON missing client_email or private_key.');
  }
  credentials.private_key = String(credentials.private_key).replace(/\\n/g, '\n');
  return credentials;
}

function getAuth() {
  const credentials = decodeServiceAccountFromEnv();
  return new google.auth.GoogleAuth({
    credentials,
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/gmail.readonly',
    ],
    clientOptions: process.env.GMAIL_USER_EMAIL
      ? { subject: process.env.GMAIL_USER_EMAIL.trim() }
      : undefined,
  });
}

async function sendDiscordAlert(content) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) return;

  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: content.substring(0, 2000) }),
      signal: AbortSignal.timeout(8000),
    });
  } catch (err) {
    console.error('[Discord] Alert failed:', err.message);
  }
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function isCompanyMentioned(text, company) {
  if (!text || !company) return false;
  const clean = company.trim();
  if (clean.length < 2) return false;
  return new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(clean)}(?:$|[^a-z0-9])`, 'i').test(text);
}

async function main() {
  try {
    const targetEmail = (process.env.GMAIL_USER_EMAIL || '').trim().toLowerCase();
    const hasServiceAccount = Boolean((process.env.GOOGLE_SERVICE_KEY_BASE64 || '').trim());

    if (!hasServiceAccount || !targetEmail) {
      console.log(
        '[Reply Tracker] Skipping cleanly — GOOGLE_SERVICE_KEY_BASE64 and a Google Workspace GMAIL_USER_EMAIL are required for automated inbox polling.'
      );
      return;
    }

    if (targetEmail.endsWith('@gmail.com')) {
      console.log(
        `[Reply Tracker] Notice: "${targetEmail}" is a consumer @gmail.com address. Google Service Account Domain-Wide Delegation only works on Google Workspace domains — skipping inbox poll cleanly instead of failing CI.`
      );
      return;
    }

    const auth = getAuth();
    await auth.getClient();

    const sheets = google.sheets('v4');
    const gmail = google.gmail('v1');
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;
    const neonConfigured = isNeonPostgresConfigured();

    let sheetRows = [];
    if (spreadsheetId) {
      const response = await sheets.spreadsheets.values.get({
        auth,
        spreadsheetId,
        range: 'Sheet1!A:K',
      });
      sheetRows = response.data.values || [];
    }

    const { pendingRows, lowerCompanies } = groupCompanies(sheetRows);
    const neonApplied = neonConfigured ? await getNeonAppliedJobs(200) : [];
    const neonByCompany = new Map();
    for (const job of neonApplied) {
      const key = String(job.company || '').trim().toLowerCase();
      if (!key) continue;
      if (!neonByCompany.has(key)) neonByCompany.set(key, []);
      neonByCompany.get(key).push(job);
      if (!lowerCompanies.has(key)) {
        lowerCompanies.set(key, []);
      }
    }

    if (pendingRows.length === 0 && neonApplied.length === 0) {
      console.log('[Reply Tracker] No APPLIED applications to poll.');
      return;
    }

    const messages = [];
    let pageToken;
    let pages = 0;
    do {
      const listRes = await gmail.users.messages.list({
        auth,
        userId: 'me',
        q: 'in:inbox newer_than:2d',
        maxResults: 100,
        pageToken,
      });
      if (Array.isArray(listRes.data.messages)) {
        messages.push(...listRes.data.messages);
      }
      pageToken = listRes.data.nextPageToken;
      pages++;
    } while (pageToken && pages < 5);

    const cappedMessages = messages.slice(0, 150);
    const matchedIndices = new Set();
    const matchedNeonKeys = new Set();
    const hits = [];

    for (let i = 0; i < cappedMessages.length; i += 5) {
      const batch = cappedMessages.slice(i, i + 5);
      const batchPayloads = await Promise.allSettled(
        batch.map((msg) =>
          gmail.users.messages.get({
            auth,
            userId: 'me',
            id: msg.id,
            format: 'metadata',
            metadataHeaders: ['From', 'Subject', 'Date'],
          })
        )
      );

      for (const settled of batchPayloads) {
        if (settled.status !== 'fulfilled') continue;
        const headers = settled.value.data?.payload?.headers || [];
        const from = headers.find((h) => h.name === 'From')?.value || '';
        const subject = headers.find((h) => h.name === 'Subject')?.value || '';
        const dateStr = headers.find((h) => h.name === 'Date')?.value || '';

        for (const [companyLowerCase, indices] of lowerCompanies.entries()) {
          const matchFound =
            isCompanyMentioned(from, companyLowerCase) ||
            isCompanyMentioned(subject, companyLowerCase);
          if (!matchFound) continue;

          for (const rowIndex of indices) {
            if (!matchedIndices.has(rowIndex)) {
              matchedIndices.add(rowIndex);
              const matchedRow = pendingRows.find((p) => p.index === rowIndex)?.row;
              if (matchedRow) {
                hits.push({
                  rowIndex,
                  id: String(matchedRow[1] || '').trim(),
                  canonicalKey: undefined,
                  company: matchedRow[3],
                  from,
                  subject,
                  dateStr,
                });
              }
            }
          }

          for (const neonJob of neonByCompany.get(companyLowerCase) || []) {
            if (!matchedNeonKeys.has(neonJob.canonicalKey)) {
              matchedNeonKeys.add(neonJob.canonicalKey);
              hits.push({
                rowIndex: null,
                id: neonJob.id,
                canonicalKey: neonJob.canonicalKey,
                company: neonJob.company,
                from,
                subject,
                dateStr,
              });
            }
          }
        }
      }
    }

    if (hits.length > 0) {
      let colBValues = [];
      if (spreadsheetId) {
        const latestColB = await sheets.spreadsheets.values.get({
          auth,
          spreadsheetId,
          range: 'Sheet1!B:B',
        });
        colBValues = latestColB.data.values || [];
      }

      for (const hit of hits) {
        if (neonConfigured && (hit.canonicalKey || hit.id)) {
          await updateNeonJobFields(
            { id: hit.id, canonicalKey: hit.canonicalKey },
            { status: 'REPLIED' }
          );
        }

        if (spreadsheetId && hit.rowIndex !== null) {
          let rowToUpdate = hit.rowIndex + 1;
          if (hit.id) {
            const verifiedIdx = colBValues.findIndex(
              (r, idx) => idx >= 1 && String(r[0] || '').trim() === hit.id
            );
            if (verifiedIdx >= 1) {
              rowToUpdate = verifiedIdx + 1;
            } else {
              console.warn(`[Sheets] Skipping update for ${hit.company}: ID ${hit.id} no longer in Sheet1.`);
              rowToUpdate = -1;
            }
          }

          if (rowToUpdate >= 2) {
            try {
              await sheets.spreadsheets.values.update({
                auth,
                spreadsheetId,
                range: `Sheet1!K${rowToUpdate}`,
                valueInputOption: 'USER_ENTERED',
                requestBody: {
                  values: [['REPLIED']],
                },
              });
            } catch (updateErr) {
              console.error(`[Sheets] Failed to update row for ${hit.company}:`, updateErr.message);
            }
          }
        }

        const alertMsg = `📩 REPLY DETECTED\nCompany: ${hit.company}\nFrom: ${hit.from}\nSubject: ${hit.subject}\nDate: ${hit.dateStr}\n→ Update your tracker and respond within 2 hours.`;
        await sendDiscordAlert(alertMsg);
      }
    }
  } catch (error) {
    const errorMessage = error.stack || error.message || String(error);
    const safeError = errorMessage.substring(0, 1500);
    console.error(`[Reply Tracker Error] ${errorMessage}`);
    const payload = `🚨 **Reply Tracker Failed** 🚨\n\n**Error Trace:**\n\`\`\`js\n${safeError}\n\`\`\``;
    await sendDiscordAlert(payload);
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
