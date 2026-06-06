import { NextResponse } from 'next/server';
import { google } from 'googleapis';

export async function POST(req: Request) {
  try {
    const { rowId, status } = await req.json(); 
    
    if (!process.env.GOOGLE_SERVICE_KEY_BASE64 || !process.env.GOOGLE_SHEET_ID) {
        return NextResponse.json({ success: false, message: "Not configured" }, { status: 400 });
    }

    const creds = JSON.parse(Buffer.from(process.env.GOOGLE_SERVICE_KEY_BASE64, 'base64').toString('utf8'));
    const auth = new google.auth.GoogleAuth({
      credentials: creds,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets('v4');
    
    await sheets.spreadsheets.values.update({
        auth,
        spreadsheetId: process.env.GOOGLE_SHEET_ID,
        range: `Sheet1!K${rowId}`, 
        valueInputOption: 'USER_ENTERED',
        requestBody: {
            values: [[status]]
        }
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error updating sheet:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
