import { google } from 'googleapis'
import { NextRequest, NextResponse } from 'next/server'

async function getAuth() {
  const credentials = JSON.parse(
    Buffer.from(
      process.env.GOOGLE_SERVICE_KEY_BASE64 || '', 
      'base64'
    ).toString('utf8')
  )
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  })
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const isPublic = searchParams.get('public') === 'true'

  if (
    !process.env.GOOGLE_SERVICE_KEY_BASE64 || 
    !process.env.GOOGLE_SHEET_ID
  ) {
    return NextResponse.json(
      isPublic 
        ? { jobs_scouted_this_week: 0, avg_match_score: 0, 
            applications_sent: 0, response_rate: '0%' }
        : []
    )
  }

  try {
    const auth = await getAuth()
    const sheets = google.sheets('v4')
    const response = await sheets.spreadsheets.values.get({
      auth,
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: 'Sheet1!A:K',
    })

    const rows = response.data.values || []
    const dataRows = rows.slice(1).filter(r => r[0])

    if (isPublic) {
      const now = new Date()
      const weekAgo = new Date(now.getTime() - 7*24*60*60*1000)
      
      let scoutedWeek = 0
      let totalScore = 0
      let scoreCount = 0
      let applied = 0
      let replied = 0

      for (const row of dataRows) {
        const date = new Date(row[0])
        const score = parseInt(row[4] || '0', 10)
        const status = row[10] || 'NEW'

        if (date >= weekAgo) scoutedWeek++
        if (score > 0) { totalScore += score; scoreCount++ }
        if (['APPLIED','REPLIED','INTERVIEW','REJECTED']
            .includes(status)) applied++
        if (['REPLIED','INTERVIEW']
            .includes(status)) replied++
      }

      return NextResponse.json({
        jobs_scouted_this_week: scoutedWeek,
        avg_match_score: scoreCount > 0 
          ? Math.round(totalScore / scoreCount) : 0,
        applications_sent: applied,
        response_rate: applied > 0 
          ? `${Math.round((replied/applied)*100)}%` : '0%'
      })
    }

    // Full data for admin only
    const jobs = dataRows.map(row => ({
      date: row[0] || '',
      id: row[1] || '',
      title: row[2] || '',
      company: row[3] || '',
      score: parseInt(row[4] || '0', 10),
      match_reasons: row[5] || '',
      gap: row[6] || '',
      url: row[7] || '',
      dm_draft: row[8] || '',
      resume_angle: row[9] || '',
      status: row[10] || 'NEW',
    }))

    return NextResponse.json(jobs)

  } catch (e) {
    console.error(e)
    return NextResponse.json(
      isPublic 
        ? { jobs_scouted_this_week: 0, avg_match_score: 0,
            applications_sent: 0, response_rate: '0%' }
        : []
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const { rowIndex, status } = await request.json()

    if (!rowIndex || !status) {
      return NextResponse.json(
        { error: 'Missing rowIndex or status' }, 
        { status: 400 }
      )
    }

    const auth = await getAuth()
    const sheets = google.sheets('v4')

    // rowIndex is 0-based data row, +2 for header + 1-based
    await sheets.spreadsheets.values.update({
      auth,
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `Sheet1!K${rowIndex + 2}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [[status]] },
    })

    return NextResponse.json({ success: true })

  } catch (e) {
    console.error(e)
    return NextResponse.json(
      { error: 'Update failed' }, 
      { status: 500 }
    )
  }
}
