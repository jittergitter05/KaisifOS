import fs from 'fs';
import path from 'path';
import { google } from 'googleapis';
import { GoogleGenAI } from '@google/genai';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const AI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const delay = (ms) => new Promise((res) => setTimeout(res, ms));

async function getAuth() {
  if (!process.env.GOOGLE_SERVICE_KEY_BASE64) {
    throw new Error('Missing GOOGLE_SERVICE_KEY_BASE64');
  }
  const credentials = JSON.parse(Buffer.from(process.env.GOOGLE_SERVICE_KEY_BASE64, 'base64').toString('utf8'));
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

async function getExistingJobIds(sheets, auth) {
  try {
    const response = await sheets.spreadsheets.values.get({
      auth,
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: 'Sheet1!B:B',
    });
    const rows = response.data.values;
    if (!rows || rows.length === 0) return new Set();
    return new Set(rows.map((row) => row[0]));
  } catch (error) {
    console.error('Error fetching existing job IDs:', error.message);
    return new Set();
  }
}

async function fetchAdzunaJobs(profile) {
  if (!process.env.ADZUNA_APP_ID || !process.env.ADZUNA_API_KEY) {
     throw new Error("Missing ADZUNA env variables");
  }

  const jobs = [];
  const minSalary = (profile.min_salary_lpa || 6) * 100000;

  for (const role of profile.target_roles) {
    for (const city of profile.target_cities) {
        try {
            const url = new URL(`https://api.adzuna.com/v1/api/jobs/in/search/1`);
            url.searchParams.append('app_id', process.env.ADZUNA_APP_ID);
            url.searchParams.append('app_key', process.env.ADZUNA_API_KEY);
            url.searchParams.append('results_per_page', 10);
            url.searchParams.append('what', role);
            url.searchParams.append('where', city);
            url.searchParams.append('salary_min', minSalary);
            url.searchParams.append('content-type', 'application/json');

            const res = await fetch(url.toString());
            if (res.ok) {
              const data = await res.json();
              jobs.push(...(data.results || []));
            } else {
              console.error(`Adzuna error for ${role} in ${city}: ${res.statusText}`);
            }
        } catch (error) {
             console.error(`Fetch error for ${role} in ${city}:`, error.message);
        }
        await delay(500); 
    }
  }
  return jobs;
}

async function scoreJob(job, profile) {
  const prompt = `You are a recruiting AI scoring job fit for this candidate.
Return ONLY valid JSON. No explanation. No markdown.

CANDIDATE: ${JSON.stringify(profile)}

JOB:
Title: ${job.title}
Company: ${job.company?.display_name || 'Unknown'}  
Description: ${(job.description || '').substring(0, 600)}
Salary: ${job.salary_min || 'Not listed'}

Return exactly:
{
  "score": <0-100 integer>,
  "match_reasons": ["reason 1", "reason 2", "reason 3"],
  "gap": "one line on biggest weakness",
  "dm_draft": "3-sentence LinkedIn DM. Line 1: specific observation about their product/company. Line 2: one thing from candidate profile that directly maps. Line 3: single low-friction ask — Worth a 15-min call?",
  "resume_angle": "which of candidate's metrics to lead with"
}`;

  try {
    const response = await AI.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
          responseMimeType: "application/json",
      }
    });

    const text = response.text;
    const data = JSON.parse(text);
    return data;
  } catch (error) {
    console.error(`Gemini error for job ${job.id}:`, error.message);
    return { score: 0 };
  }
}

async function appendToSheet(sheets, auth, rows, retries = 1) {
  try {
    await sheets.spreadsheets.values.append({
      auth,
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: 'Sheet1!A:K',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: rows },
    });
  } catch (error) {
    if (error.code === 429 && retries > 0) {
      console.warn('Quota exceeded, retrying in 5 seconds...');
      await delay(5000);
      return appendToSheet(sheets, auth, rows, retries - 1);
    }
    throw error;
  }
}

async function sendDiscordDigest(matches, resumeUrl) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) throw new Error('Missing DISCORD_WEBHOOK_URL');

  let content = `📋 KAISIF JOB DIGEST — ${new Date().toISOString().split('T')[0]}\n─────────────────────────────\n`;
  
  if (matches.length === 0) {
    content += "No new matches above 70 today.";
  } else {
    matches.forEach((m, idx) => {
      content += `\n${idx + 1}. **${m.job.title}** @ **${m.job.company?.display_name || 'Unknown'}**\n🎯 Match: ${m.scoreData.score}/100\n✅ Why: ${m.scoreData.match_reasons.join(" | ")}\n⚠️ Gap: ${m.scoreData.gap}\n📝 DM: ${m.scoreData.dm_draft}\n🔗 ${m.job.redirect_url}\n─────────────────────────────`;
    });
    content += `\n${matches.length} matches above 70 today.\nResume synthesizer: ${resumeUrl}\n⏱ Send DMs before 11AM IST.`;
  }

  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: content.substring(0, 2000) }),
  });
  
  if (!res.ok) {
     console.error('Failed to send discord digest:', res.statusText);
  }
}

async function main() {
  try {
    const profile = await fetch(
      'https://portjitterglitter.vercel.app/api/profile'
    ).then(r => r.json());
    const auth = await getAuth();
    const sheets = google.sheets('v4');
    const existingIds = await getExistingJobIds(sheets, auth);
    const rawJobs = await fetchAdzunaJobs(profile);
    const newJobs = rawJobs.filter(j => j.id && !existingIds.has(String(j.id)));
    
    const uniqueNewJobsMap = new Map();
    newJobs.forEach(j => uniqueNewJobsMap.set(j.id, j));
    const uniqueNewJobs = Array.from(uniqueNewJobsMap.values());
    const jobsToScore = uniqueNewJobs.slice(0, 30)

    const scoredJobs = [];
    for (const job of jobsToScore) {
      const scoreData = await scoreJob(job, profile);
      if (scoreData && typeof scoreData.score === 'number' && scoreData.score >= 70) {
        scoredJobs.push({ job, scoreData });
      }
      await delay(1000); 
    }
    
    scoredJobs.sort((a, b) => b.scoreData.score - a.scoreData.score);
    const topMatches = scoredJobs.slice(0, 5);
    
    if (topMatches.length > 0) {
      const dateStr = new Date().toISOString().split('T')[0];
      const rows = topMatches.map(m => [
        dateStr,
        m.job.id,
        m.job.title,
        m.job.company?.display_name || 'Unknown',
        m.scoreData.score,
        (m.scoreData.match_reasons || []).join(' | '),
        m.scoreData.gap || '',
        m.job.redirect_url || '',
        m.scoreData.dm_draft || '',
        m.scoreData.resume_angle || '',
        'NEW' 
      ]);
      await appendToSheet(sheets, auth, rows);
    }
    
    await sendDiscordDigest(topMatches, profile.resume_synthesizer_url);
    console.log('Scout completed successfully!');
  } catch (error) {
    console.error('Scout failure:', error);
    const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
    if (webhookUrl) {
      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: `🚨 Scout agent failed today: ${error.message}` }),
      });
    }
    process.exit(1);
  }
}

main();
