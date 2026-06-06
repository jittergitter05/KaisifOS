import { google } from 'googleapis';
import dotenv from 'dotenv';

dotenv.config();

function getAuth() {
  if (!process.env.GOOGLE_SERVICE_KEY_BASE64) {
    throw new Error('Missing GOOGLE_SERVICE_KEY_BASE64');
  }
  const credentials = JSON.parse(Buffer.from(process.env.GOOGLE_SERVICE_KEY_BASE64, 'base64').toString('utf8'));
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/gmail.readonly'],
    clientOptions: {
      subject: process.env.GMAIL_USER_EMAIL, // Required for domain-wide delegation, but we can try without if just accessing service account itself, though Gmail usually needs subject impersonation if not using regular OAuth.
    }
  });
}

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
    console.log('Starting reply tracker...');
    
    let auth;
    try {
        // try with impersonation if setting up domain-wide delegation
        auth = getAuth();
        await auth.getClient();
    } catch(e) {
        // fallback to standard service account
        auth = getAuthWithoutSubject();
    }

    const sheets = google.sheets('v4');
    const gmail = google.gmail('v1');
    
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;
    
    // STEP 1 - READ SHEET
    console.log('Reading sheet data...');
    const response = await sheets.spreadsheets.values.get({
      auth,
      spreadsheetId,
      range: 'Sheet1!A:K',
    });
    
    const rows = response.data.values || [];
    if (rows.length === 0) {
      console.log('No rows found in sheet.');
      return;
    }
    
    // Assume columns: Date(0)|ID(1)|Title(2)|Company(3)|Score(4)|Reasons(5)|Gap(6)|URL(7)|DM(8)|ResumeAngle(9)|Status(10)|ReplyDate(11)
    const pendingRows = [];
    const lowerCompanies = new Map();
    
    rows.forEach((row, index) => {
      if (row[10] === 'APPLIED' && row[3]) {
        pendingRows.push({ row, index });
        lowerCompanies.set(row[3].toLowerCase(), index);
      }
    });
    
    console.log(`Found ${pendingRows.length} 'APPLIED' jobs.`);
    if (pendingRows.length === 0) return;
    
    // STEP 2 - SCAN GMAIL
    console.log('Scanning Gmail inbox...');
    // We use the service account mail or impersonate
    let listRes;
    try {
       listRes = await gmail.users.messages.list({
        auth,
        userId: 'me',
        q: 'in:inbox newer_than:2d',
      });
    } catch (gerr) {
        throw new Error(`Gmail API Error: ${gerr.message}. Make sure Gmail API is enabled and service account has access.`);
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
       
       // Check if company matches
       for (const [companyLowerCase, rowIndex] of lowerCompanies.entries()) {
          if (!matchedIndices.has(rowIndex)) {
             // simplified matching
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
    
    // STEP 3 - UPDATE + NOTIFY
    if (hits.length > 0) {
      console.log(`Found ${hits.length} replies.`);
      const today = new Date().toISOString().split('T')[0];
      
      for (const hit of hits) {
         // Update Status -> REPLIED (col K, index 10)
         // Add Reply Date (col L, index 11)
         const rowToUpdate = hit.rowIndex + 1; // 1-based index
         
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
    } else {
        console.log('No new replies detected.');
    }
    
    console.log('Reply tracker completed successfully.');
  } catch (error) {
    console.error('Tracker failure:', error);
    await sendDiscordAlert(`🚨 Reply tracker failed today: ${error.message}`);
    process.exit(1);
  }
}

main();
