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

async function fetchMuseJobs(profile) {
  const jobs = [];
  try {
    for (const city of profile.target_cities) {
      const url = new URL('https://www.themuse.com/api/public/jobs');
      url.searchParams.append('page', '1');
      url.searchParams.append('location', city);
      
      const res = await fetch(url.toString());
      if (!res.ok) {
        console.warn(`The Muse API error HTTP ${res.status}`);
        continue;
      }
      const data = await res.json();
      const results = data.results || [];
      
      for (const item of results) {
        const description = (item.contents || '').replace(/<[^>]*>?/gm, '').trim();
        jobs.push({
          id: item.id ? `muse_${item.id}` : null,
          title: item.name,
          company: { display_name: item.company?.name || 'Unknown' },
          description: description,
          redirect_url: item.refs?.landing_page || '',
        });
      }
      await delay(500);
    }
  } catch (err) {
    console.warn(`The Muse fetch error:`, err.message);
  }
  return jobs;
}

async function fetchRemotiveJobs(profile) {
  const jobs = [];
  try {
    for (const role of profile.target_roles) {
      const url = new URL('https://remotive.com/api/remote-jobs');
      url.searchParams.append('search', role);
      url.searchParams.append('limit', '10');
      
      const res = await fetch(url.toString());
      if (!res.ok) {
        console.warn(`Remotive API error HTTP ${res.status}`);
        continue;
      }
      const data = await res.json();
      const results = data.jobs || [];
      
      for (const item of results) {
        const description = (item.description || '').replace(/<[^>]*>?/gm, '').trim();
        jobs.push({
          id: item.id ? `remotive_${item.id}` : null,
          title: item.title,
          company: { display_name: item.company_name || 'Unknown' },
          description: description,
          redirect_url: item.url || '',
        });
      }
      await delay(500);
    }
  } catch (err) {
    console.warn(`Remotive fetch error:`, err.message);
  }
  return jobs;
}

async function fetchJSearchJobs(profile) {
  if (!process.env.RAPIDAPI_KEY) {
     console.warn("Missing RAPIDAPI_KEY env variable, skipping JSearch.");
     return [];
  }

  const jobs = [];
  try {
    const query = `${profile.target_roles.join(' OR ')} in ${profile.target_cities.join(', ')}, India`;
    const url = new URL('https://jsearch.p.rapidapi.com/search');
    url.searchParams.append('query', query);
    url.searchParams.append('num_pages', '1');

    const res = await fetch(url.toString(), {
      headers: {
        'X-RapidAPI-Key': process.env.RAPIDAPI_KEY,
        'X-RapidAPI-Host': 'jsearch.p.rapidapi.com'
      }
    });

    if (!res.ok) {
        console.warn(`JSearch API error HTTP ${res.status}`);
        return [];
    }

    const data = await res.json();
    const results = data.data || [];
    
    for (const item of results) {
       jobs.push({
          id: item.job_id,
          title: item.job_title,
          company: { display_name: item.employer_name },
          description: item.job_description,
          redirect_url: item.job_apply_link,
          salary_min: item.job_min_salary
       });
    }
  } catch (err) {
      console.warn(`JSearch fetch error:`, err.message);
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
  "score": <0-100 integer> (Aggressively penalize jobs requiring 1+ years experience. Candidate is a FRESHER/0 years. High scores ONLY for entry-level/fresher appropriate roles),
  "match_reasons": ["reason 1", "reason 2", "reason 3"],
  "gap": "one line on biggest weakness",
  "dm_draft": "3-sentence LinkedIn DM.",
  "resume_angle": "which of candidate's metrics to lead with"
}`;

  let retries = 3;
  while (retries > 0) {
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
      if (error.status === 429 || error.message.includes('429')) {
        console.warn(`[Gemini API] Rate limit hit. Retrying in ${4 - retries}s...`);
        await delay((4 - retries) * 1500);
        retries--;
      } else {
        console.error(`Gemini error for job ${job.id}:`, error.message);
        return { score: 0 };
      }
    }
  }
  console.error(`Gemini error for job ${job.id}: Exhausted retries due to rate limit.`);
  return { score: 0 };
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

async function getWeeklyStats(sheets, auth) {
  try {
    const response = await sheets.spreadsheets.values.get({
      auth,
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: 'Sheet1!A:A',
    });
    const rows = response.data.values;
    if (!rows || rows.length === 0) return { weekMatches: 0 };
    
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    
    let weekMatches = 0;
    for (let i = 1; i < rows.length; i++) { // Skip header assuming row 0 is header
      if (rows[i] && rows[i][0]) {
        const rowDate = new Date(rows[i][0]);
        if (rowDate >= sevenDaysAgo) {
          weekMatches++;
        }
      }
    }
    return { weekMatches };
  } catch (error) {
    console.error('Error fetching weekly stats:', error.message);
    return null;
  }
}

async function sendDiscordDigest(matches, resumeUrl, totalScanned, weeklyStats = null) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) throw new Error('Missing DISCORD_WEBHOOK_URL');

  let content = `📋 KAISIF JOB DIGEST — ${new Date().toISOString().split('T')[0]}\n`;
  content += `Scanned ${totalScanned} roles today, ${matches.length} matched your profile (≥60)\n─────────────────────────────\n`;
  
  if (matches.length > 0) {
    matches.forEach((m, idx) => {
      let domain = 'Unknown';
      try {
          if (m.job.redirect_url) domain = new URL(m.job.redirect_url).hostname.replace('www.', '');
      } catch (e) {}

      content += `\n${idx + 1}. **${m.job.title}** @ **${m.job.company?.display_name || 'Unknown'}**\n`;
      content += `🎯 ${m.scoreData.score}/100 | ✅ ${m.scoreData.match_reasons.join(" | ").substring(0, 100)}\n`;
      content += `💡 Lead: ${m.scoreData.resume_angle || 'N/A'}\n`;
      content += `🔗 <${m.job.redirect_url}>\n`;
    });
  }

  if (weeklyStats) {
    content += `\n📊 **WEEKLY SUMMARY**\nTotal matches stored this week: ${weeklyStats.weekMatches}`;
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
    const profilePath = path.join(__dirname, '../data/profile.json');
    const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
    const auth = await getAuth();
    const sheets = google.sheets('v4');
    const existingIds = await getExistingJobIds(sheets, auth);
    const [rawMuseJobs, rawRemotiveJobs, rawJSearchJobs] = await Promise.all([
      fetchMuseJobs(profile),
      fetchRemotiveJobs(profile),
      fetchJSearchJobs(profile)
    ]);
    const rawJobs = [...rawMuseJobs, ...rawRemotiveJobs, ...rawJSearchJobs];
    const newJobs = rawJobs.filter(j => j.id && !existingIds.has(String(j.id)));
    
    const uniqueNewJobsMap = new Map();
    newJobs.forEach(j => uniqueNewJobsMap.set(j.id, j));
    const uniqueNewJobs = Array.from(uniqueNewJobsMap.values());
    
    // PRUNING: Pre-filter out obvious over-experienced roles to save LLM tokens/quota
    const blacklistRegex = /\b(senior|director|vp|head of|sr\.|principal|architect|staff|5\+?\s*years|4\+?\s*years|3\+?\s*years|2\+?\s*years)\b/i;
    const prunedJobs = uniqueNewJobs.filter(j => {
      const combinedText = `${j.title || ''} ${j.description || ''}`;
      return !blacklistRegex.test(combinedText);
    });

    const jobsToScore = prunedJobs.slice(0, 30);

    const scoredJobs = [];
    for (const job of jobsToScore) {
      const scoreData = await scoreJob(job, profile);
      if (scoreData && typeof scoreData.score === 'number' && scoreData.score >= 60) {
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
    
    let weeklyStats = null;
    if (new Date().getDay() === 0) { // Sunday
      weeklyStats = await getWeeklyStats(sheets, auth);
    }

    await sendDiscordDigest(
      topMatches, 
      profile.portfolio || 'https://portjitterglitter.vercel.app',
      jobsToScore.length,
      weeklyStats
    );
    console.log('Scout completed successfully!');
  } catch (error) {
    console.error('Scout failure:', error);
    const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
    if (webhookUrl) {
      const errorMessage = error.stack || error.message || String(error);
      const safeError = errorMessage.substring(0, 1500);
      
      const payload = { 
        content: `🚨 **Scout Agent Failed** 🚨\n\n**Error Trace:**\n\`\`\`js\n${safeError}\n\`\`\`` 
      };
      
      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    }
    process.exit(1);
  }
}

main();
