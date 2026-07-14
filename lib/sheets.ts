import { google } from 'googleapis'

export async function getAuth() {
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

export async function getPublicStats() {
  if (!process.env.GOOGLE_SERVICE_KEY_BASE64 || !process.env.GOOGLE_SHEET_ID) {
    return { jobs_scouted_this_week: 0, avg_match_score: 0, applications_sent: 0, response_rate: '0%' };
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
      if (['APPLIED','REPLIED','INTERVIEW','REJECTED'].includes(status)) applied++
      if (['REPLIED','INTERVIEW'].includes(status)) replied++
    }

    return {
      jobs_scouted_this_week: scoutedWeek,
      avg_match_score: scoreCount > 0 ? Math.round(totalScore / scoreCount) : 0,
      applications_sent: applied,
      response_rate: applied > 0 ? `${Math.round((replied/applied)*100)}%` : '0%'
    }

  } catch (e) {
    console.error('Failed to get public stats:', e);
    return { jobs_scouted_this_week: 0, avg_match_score: 0, applications_sent: 0, response_rate: '0%' };
  }
}
