import { NextResponse } from 'next/server';
import { google } from 'googleapis';

export async function GET() {
  try {
    if (!process.env.GOOGLE_SERVICE_KEY_BASE64 || !process.env.GOOGLE_SHEET_ID) {
      return NextResponse.json({ rows: [] }); 
    }

    const creds = JSON.parse(Buffer.from(process.env.GOOGLE_SERVICE_KEY_BASE64, 'base64').toString('utf8'));
    const auth = new google.auth.GoogleAuth({
      credentials: creds,
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    const sheets = google.sheets('v4');
    const response = await sheets.spreadsheets.values.get({
      auth,
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: 'Sheet1!A:M', 
    });

    const rows = response.data.values || [];
    return NextResponse.json({ rows });
  } catch (error: any) {
    console.error('Error fetching sheet data:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
