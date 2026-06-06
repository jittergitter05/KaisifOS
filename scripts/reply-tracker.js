import { google } from 'googleapis';
import dotenv from 'dotenv';
import fetch from 'node-fetch';

dotenv.config();

function getAuthWithoutSubject() {
  if (!process.env.GOOGLE_SERVICE_KEY_BASE64) {
       throw new Error('Missing GOOGLE_SERVICE_KEY_BASE64');
  }
  const credentials = JSON.parse(Buffer.from(process.env.GOOGLE_SERVICE_KEY_BASE64, 'base64').toString('utf8'));
  return new google.auth.GoogleAuth({
     credentials,
     scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/gmail.readonly'],
  });
}

function getAuth() {
  if (!process.env.GOOGLE_SERVICE_KEY_BASE64) {
    throw new Error('Missing GOOGLE_SERVICE_KEY_BASE64');
  }
  const credentials = JSON.parse(Buffer.from(process.env.GOOGLE_SERVICE_KEY_BASE64, 'base64').toString('utf8'));
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/gmail.readonly'],
    clientOptions: {
      subject: process.env.GMAIL_USER_EMAIL, 
    }
  });
}

async function sendDiscordAlert(content) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) return;
  
  await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: content.substring(0, 2000) }),
  });
}

async function main() {
  try {
    let auth;
    try {
        auth = getAuth();
        await auth.getClient();
    } catch(e) {
        auth = getAuthWithoutSubject();
    }

    const sheets = google.sheets('v4');
    const gmail = google.gmail('v1');
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;
    
    const response = await sheets.spreadsheets.values.get({
      auth,
      spreadsheetId,
      range: 'Sheet1!A:K',
    });
    
    const rows = response.data.values || [];
    if (rows.length === 0) {
      return;
    }
    
    const pendingRows = [];
    const lowerCompanies = new Map();
    
    rows.forEach((row, index) => {
      if (row[10] === 'APPLIED' && row[3]) {
        pendingRows.push({ row, index });
        lowerCompanies.set(row[3].toLowerCase(), index);
      }
    });
    
    if (pendingRows.length === 0) return;
    
    let listRes;
    try {
       listRes = await gmail.users.messages.list({
        auth,
        userId: 'me',
        q: 'in:inbox newer_than:2d',
      });
    } catch (gerr) {
        throw new Error(`Gmail API Error: ${gerr.message}`);
    }

    const messages = listRes.data.messages || [];
    const matchedIndices = new Set();
    const hits = [];

    for (const msg of messages) {
       const msgData = await gmail.users.messages.get({
          auth,
          userId: 'me',
          id: msg.id,
          format: 'metadata',
          metadataHeaders: ['From', 'Subject', 'Date']
       });
       
       const headers = msgData.data.payload.headers;
       const from = headers.find(h => h.name === 'From')?.value || '';
       const subject = headers.find(h => h.name === 'Subject')?.value || '';
       const dateStr = headers.find(h => h.name === 'Date')?.value || '';
       
       const lowerFrom = from.toLowerCase();
       const lowerSubj = subject.toLowerCase();
       
       for (const [companyLowerCase, rowIndex] of lowerCompanies.entries()) {
          if (!matchedIndices.has(rowIndex)) {
             if (lowerFrom.includes(companyLowerCase) || lowerSubj.includes(companyLowerCase)) {
                matchedIndices.add(rowIndex);
                hits.push({
                   rowIndex,
                   company: pendingRows.find(p => p.index === rowIndex).row[3],
                   from,
                   subject,
                   dateStr
                });
             }
          }
       }
    }
    
    if (hits.length > 0) {
      const today = new Date().toISOString().split('T')[0];
      for (const hit of hits) {
         const rowToUpdate = hit.rowIndex + 1; 
         await sheets.spreadsheets.values.update({
            auth,
            spreadsheetId,
            range: `Sheet1!K${rowToUpdate}:L${rowToUpdate}`,
            valueInputOption: 'USER_ENTERED',
            requestBody: {
              values: [['REPLIED', today]]
            }
         });
         const alertMsg = `📩 REPLY DETECTED\nCompany: ${hit.company}\nFrom: ${hit.from}\nSubject: ${hit.subject}\nDate: ${hit.dateStr}\n→ Update your tracker and respond within 2 hours.`;
         await sendDiscordAlert(alertMsg);
      }
    } 
  } catch (error) {
    await sendDiscordAlert(`🚨 Reply tracker failed today: ${error.message}`);
    process.exit(1);
  }
}

main();
