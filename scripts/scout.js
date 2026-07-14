import fs from 'fs';
import path from 'path';
import { google } from 'googleapis';
import Groq from 'groq-sdk';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const delay = (ms) => new Promise((res) => setTimeout(res, ms));

export const stripHtmlTags = (input) => {
  if (!input) return '';
  let output = input;
  let previous;
  do {
    previous = output;
    output = output.replace(/<[^>]*>/g, '');
  } while (output !== previous);
  return output;
};

// ─── PROMPT GENERATOR ────────────────────────────────────────────────────────

export function buildPrompt(job, profile) {
  const desc = (job.description || '').substring(0, 600);
  const location = job.location || 'Not specified';
  const salaryInfo = job.salary_min
    ? `Min salary: ${job.salary_min} ${job.salary_max ? `- ${job.salary_max}` : ''}` 
    : 'Salary: Not listed';

  const expYears = profile.experience_years;
  const isFresher = expYears === 0;
  
  // Relocation logic based on profile
  const willRelocate = profile.open_to_relocation;
  const targetCities = profile.target_cities.join(', ');
  let locationRule = '';
  if (willRelocate) {
    locationRule = `3. Location (20 pts): Candidate is open to relocation globally (especially ${profile.relocation_preference?.preferred_regions?.join(', ')}). Give 20/20 for remote roles OR roles anywhere they are willing to relocate. Give 0/20 ONLY if the role explicitly forbids their relocation or is in an undesired location.`;
  } else {
    locationRule = `3. Location (20 pts): MUST be located in ${targetCities} (on-site/hybrid) or fully remote. Give 0/20 for any other location requiring relocation.`;
  }

  // Experience logic
  let expRule = '';
  let hardExpRule = '';
  if (isFresher) {
    expRule = `2. Experience match (25 pts): Candidate is a FRESHER (0 full-time years). Full marks only if the role is entry-level, junior, associate, or open to freshers. Penalise heavily (score 0/25) if it requires 2+ years of experience.`;
    hardExpRule = `- DO NOT score above 50 if the role explicitly requires 2+ years of experience.`;
  } else {
    expRule = `2. Experience match (25 pts): Candidate has ${expYears} years of experience. Score based on how well this matches the role's requirements.`;
    hardExpRule = `- DO NOT score above 50 if the role requires significantly more experience than ${expYears} years.`;
  }

  return `You are a recruiting AI. Score this job for this specific candidate.
Return ONLY valid JSON. No markdown. No explanation. No code fences.

CANDIDATE:
Name: ${profile.name}
Target Roles: ${profile.target_roles.join(', ')}
Base: ${targetCities}
Experience: ${profile.experience_level} — ${expYears} years
Key Metrics: ${profile.key_metrics.join(' | ')}
Skills: ${profile.skills.join(', ')}
Min Salary: ₹${profile.min_salary_lpa} LPA India / $${profile.min_salary_usd_annual || 30000} USD abroad

JOB:
Title: ${job.title}
Company: ${job.company?.display_name || 'Unknown'}
Location: ${location}
${salaryInfo}
Description: ${desc}

SCORING RULES — READ ALL:
1. Role match (40 pts): How well does the title/description match ${profile.target_roles.slice(0,4).join('/')}?
${expRule}
${locationRule}
4. Salary (15 pts): Listed salary ≥ ₹${profile.min_salary_lpa} LPA India or ≥ $${profile.min_salary_usd_annual} USD abroad = full marks. Unlisted = 10/15 (assume standard).

BONUS: Add 5–10 points if relocation/accommodation/visa is explicitly mentioned.

HARD RULES:
${hardExpRule}
- DO score below 40 for: clearly unrelated domain (engineering, law, medicine), or irrelevant seniority.

Return exactly:
{
  "score": <integer 0-100>,
  "match_reasons": ["reason 1", "reason 2", "reason 3"],
  "gap": "one line on the biggest risk or weakness for this specific role",
  "dm_draft": "3-sentence LinkedIn DM opening with the strongest matching metric from candidate profile",
  "resume_angle": "which specific candidate metric to lead with for THIS role",
  "relocation_note": "brief note on relocation/accommodation situation for this role, or 'N/A if local'"
}`;
}


// ─── AUTH ────────────────────────────────────────────────────────────────────

async function getAuth() {
  if (!process.env.GOOGLE_SERVICE_KEY_BASE64) throw new Error('Missing GOOGLE_SERVICE_KEY_BASE64');
  const credentials = JSON.parse(
    Buffer.from(process.env.GOOGLE_SERVICE_KEY_BASE64, 'base64').toString('utf8')
  );
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
    return new Set(rows.map((row) => String(row[0])));
  } catch (error) {
    console.error('[Sheets] Error fetching existing IDs:', error.message);
    throw new Error(`Failed to fetch existing job IDs: ${error.message}`);
  }
}

// ─── SOURCE 1: INTERNSHALA (India-specific, fresher-focused) ─────────────────

async function fetchInternshalaJobs(profile) {
  const jobs = [];
  const categories = ['digital-marketing', 'marketing', 'product-management', 'content-writing'];
  let cities = profile?.target_cities?.map(c => c.toLowerCase().replace('bengaluru', 'bangalore')) || [];
  if (cities.length === 0) cities = ['bangalore', 'hyderabad', 'delhi', 'mumbai'];
  const headers = {
    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
  };

  for (const category of categories) {
    for (const city of cities) {
      try {
        const url = `https://internshala.com/jobs/${category}-jobs/${city}-city/`;
        const res = await fetch(url, { headers });
        if (!res.ok) { console.warn(`[Internshala] HTTP ${res.status} → ${category}/${city}`); await delay(1200); continue; }
        const html = await res.text();

        // Strategy A: __NEXT_DATA__ JSON
        const nextMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
        if (nextMatch) {
          try {
            const d = JSON.parse(nextMatch[1]);
            const list = d?.props?.pageProps?.jobs || d?.props?.pageProps?.data?.jobs || d?.props?.pageProps?.listings || [];
            let n = 0;
            for (const job of list.slice(0, 8)) {
              const id = `internshala_${job.id || job.job_id || Math.random().toString(36).slice(2)}`;
              const title = job.profile || job.title || job.job_title || '';
              const company = job.company_name || job.employer_name || job.company || 'Unknown';
              const desc = stripHtmlTags(job.description || job.job_description || `${title} at ${company} in ${city}.`).trim();
              const link = job.url ? `https://internshala.com${job.url}` : `https://internshala.com/jobs/${category}-jobs/`;
              if (title) { jobs.push({ id, title, company: { display_name: company }, description: desc.substring(0, 800), redirect_url: link, location: city }); n++; }
            }
            console.log(`[Internshala] NextJS: ${n} jobs → ${category}/${city}`);
            await delay(1200);
            continue;
          } catch (_) {}
        }

        // Strategy B: Regex fallback
        const parts = html.split('class="company generic_company');
        let n = 0;
        for (let i = 1; i < parts.length && n < 8; i++) {
          const p = parts[i];
          const hrefMatch = p.match(/class="job-title-href"[^>]*href="([^"]+)"[^>]*>\s*([^<]+)/);
          if (!hrefMatch) continue;
          
          const href = hrefMatch[1];
          const title = hrefMatch[2].trim();
          const company = p.match(/class="company-name">\s*(?:<[^>]+>\s*)*([^<\n]+)/)?.[1]?.trim() || 'Unknown';
          const rawId = href.match(/(\d+)$/)?.[1] || `${category}_${city}_${i}`;
          
          if (title.length > 3) {
            jobs.push({
              id: `internshala_${rawId}`, title,
              company: { display_name: company },
              description: `${title} role at ${company}, ${city}. Via Internshala.`,
              redirect_url: href.startsWith('http') ? href : `https://internshala.com${href}`,
              location: city,
              has_relocation: false,
            });
            n++;
          }
        }
        console.log(`[Internshala] Regex: ${n} jobs → ${category}/${city}`);
      } catch (err) {
        console.warn(`[Internshala] Error ${category}/${city}:`, err.message);
      }
      await delay(1400);
    }
  }
  console.log(`[Internshala] Total: ${jobs.length}`);
  return jobs;
}

// ─── SOURCE 2: REMOTEOK (global, free public JSON API, no key needed) ─────────
// Best zero-cost international source. Returns salary ranges. Good for abroad roles.

async function fetchRemoteOKJobs() {
  const jobs = [];
  const tagGroups = [
    'marketing',
    'growth-hacking',
    'product',
    'content-marketing',
    'digital-marketing',
  ];

  const headers = {
    'User-Agent': 'KaisifOS Job Scout (kaisif@smatr.ai)',
    'Accept': 'application/json',
  };

  for (const tag of tagGroups) {
    try {
      const url = `https://remoteok.com/api?tags=${tag}`;
      const res = await fetch(url, { headers });
      if (!res.ok) { console.warn(`[RemoteOK] HTTP ${res.status} for tag: ${tag}`); await delay(1000); continue; }

      const raw = await res.json();
      // RemoteOK prepends a metadata object as first element — skip it
      const results = Array.isArray(raw) ? raw.slice(1) : [];

      let n = 0;
      for (const item of results.slice(0, 8)) {
        if (!item.position || !item.company) continue;

        // Flag relocation-friendly signals in description/tags
        const fullText = `${item.description || ''} ${(item.tags || []).join(' ')}`.toLowerCase();
        const hasRelocation = /relocation|accommodation|housing|visa\s*sponsor|flight|moving\s*allowance|relo/.test(fullText);

        jobs.push({
          id: `remoteok_${item.id || item.slug}`,
          title: item.position,
          company: { display_name: item.company },
          description: stripHtmlTags(item.description || `${item.position} at ${item.company}. Remote role.`).trim().substring(0, 800),
          redirect_url: item.url || `https://remoteok.com/l/${item.slug}`,
          location: 'Remote / Worldwide',
          salary_min: item.salary_min || null,
          salary_max: item.salary_max || null,
          has_relocation: hasRelocation,
          tags: (item.tags || []).join(', '),
        });
        n++;
      }
      console.log(`[RemoteOK] ${n} jobs → tag: ${tag}`);
    } catch (err) {
      console.warn(`[RemoteOK] Error for tag ${tag}:`, err.message);
    }
    await delay(1500); // RemoteOK asks for respectful crawl delays
  }

  console.log(`[RemoteOK] Total: ${jobs.length}`);
  return jobs;
}

// ─── SOURCE 3: REMOTIVE (global remote, free API) ─────────────────────────────
// NOTE: India-location filter REMOVED — candidate is open to global roles now.

async function fetchRemotiveJobs() {
  const jobs = [];
  const categories = ['marketing', 'product', 'copywriting'];

  for (const category of categories) {
    try {
      const url = new URL('https://remotive.com/api/remote-jobs');
      url.searchParams.append('category', category);
      url.searchParams.append('limit', '10');
      // NO location filter — candidate is open to worldwide roles

      const res = await fetch(url.toString());
      if (!res.ok) { console.warn(`[Remotive] HTTP ${res.status} for category: ${category}`); await delay(600); continue; }

      const data = await res.json();
      let n = 0;
      for (const item of (data.jobs || [])) {
        const description = stripHtmlTags(item.description || '').trim();
        const fullText = description.toLowerCase();
        const hasRelocation = /relocation|accommodation|housing|visa\s*sponsor|flight|moving\s*allowance|relo/.test(fullText);

        jobs.push({
          id: `remotive_${item.id}`,
          title: item.title,
          company: { display_name: item.company_name || 'Unknown' },
          description: description.substring(0, 800),
          redirect_url: item.url || '',
          location: item.candidate_required_location || 'Remote / Worldwide',
          has_relocation: hasRelocation,
        });
        n++;
      }
      console.log(`[Remotive] ${n} jobs → category: ${category}`);
    } catch (err) {
      console.warn(`[Remotive] Error for ${category}:`, err.message);
    }
    await delay(700);
  }

  // Targeted keyword searches for role names + relocation
  const keywords = ['product marketing manager', 'growth marketing', 'associate product manager relocation'];
  for (const kw of keywords) {
    try {
      const url = new URL('https://remotive.com/api/remote-jobs');
      url.searchParams.append('search', kw);
      url.searchParams.append('limit', '5');
      const res = await fetch(url.toString());
      if (!res.ok) continue;
      const data = await res.json();
      for (const item of (data.jobs || [])) {
        const description = stripHtmlTags(item.description || '').trim();
        const hasRelocation = /relocation|accommodation|housing|visa\s*sponsor|flight|relo/.test(description.toLowerCase());
        jobs.push({
          id: `remotive_kw_${item.id}`,
          title: item.title,
          company: { display_name: item.company_name || 'Unknown' },
          description: description.substring(0, 800),
          redirect_url: item.url || '',
          location: item.candidate_required_location || 'Remote / Worldwide',
          has_relocation: hasRelocation,
        });
      }
    } catch (_) {}
    await delay(600);
  }

  console.log(`[Remotive] Total: ${jobs.length}`);
  return jobs;
}

// ─── SOURCE 4: JSEARCH (paid/RapidAPI — global fresher roles + India) ─────────

async function fetchJSearchJobs(profile) {
  if (!process.env.RAPIDAPI_KEY) { console.warn('[JSearch] No RAPIDAPI_KEY — skipping.'); return []; }
  const jobs = [];
  try {
    const query = `(${profile.target_roles.slice(0, 3).map(r => `"${r}"`).join(' OR ')}) (fresher OR "entry level" OR junior)`;
    const url = new URL('https://jsearch.p.rapidapi.com/search');
    url.searchParams.append('query', query);
    url.searchParams.append('num_pages', '1');
    url.searchParams.append('date_posted', 'week');
    const res = await fetch(url.toString(), {
      headers: { 'X-RapidAPI-Key': process.env.RAPIDAPI_KEY, 'X-RapidAPI-Host': 'jsearch.p.rapidapi.com' },
    });
    if (!res.ok) { console.warn(`[JSearch] HTTP ${res.status}`); return []; }
    const data = await res.json();
    for (const item of (data.data || [])) {
      const desc = (item.job_description || '').toLowerCase();
      const hasRelocation = /relocation|accommodation|housing|visa\s*sponsor|relo/.test(desc);
      jobs.push({
        id: item.job_id,
        title: item.job_title,
        company: { display_name: item.employer_name },
        description: (item.job_description || '').substring(0, 800),
        redirect_url: item.job_apply_link,
        salary_min: item.job_min_salary,
        location: `${item.job_city || ''}, ${item.job_country || ''}`.trim().replace(/^,\s*/, ''),
        has_relocation: hasRelocation,
      });
    }
    console.log(`[JSearch] ${jobs.length} jobs fetched.`);
  } catch (err) { console.warn('[JSearch] Error:', err.message); }
  return jobs;
}

// ─── GROQ SCORING ────────────────────────────────────────────────────────────

// Global state for fallback tracking
global.groqFailed = false;

export async function scoreJobWithGemini(job, profile, apiKey) {
  const prompt = buildPrompt(job, profile);


  let retries = 3;
  let backoff = 4000;

  while (retries > 0) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json' }
        })
      });

      if (!res.ok) {
        throw new Error(`Gemini HTTP error ${res.status}: ${await res.text()}`);
      }

      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
      const parsedData = JSON.parse(text);

      if (typeof parsedData.score !== 'number' || parsedData.score < 0 || parsedData.score > 100) {
        console.warn(`[Gemini] Bad score format for "${job.title}": ${JSON.stringify(parsedData.score)}`);
        return { score: 0 };
      }
      return parsedData;
    } catch (error) {
      console.warn(`[Gemini] Error for "${job.title}":`, error.message, `Retries left: ${retries - 1}`);
      retries--;
      if (retries > 0) {
        await delay(backoff);
        backoff *= 2;
      } else {
        return { score: 0 };
      }
    }
  }
  return { score: 0 };
}

export async function scoreJobWithGroq(job, profile, groq) {
  const prompt = buildPrompt(job, profile);


  let retries = 3;
  let backoff = 4000;

  while (retries > 0) {
    try {
      const response = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        temperature: 0.1,
        max_tokens: 600,
      });

      const text = response.choices[0]?.message?.content || '{}';
      const data = JSON.parse(text);

      if (typeof data.score !== 'number' || data.score < 0 || data.score > 100) {
        console.warn(`[Groq] Bad score for "${job.title}": ${JSON.stringify(data.score)}`);
        return { score: 0 };
      }
      return data;
    } catch (error) {
      if (error?.status === 401 || error?.message?.includes('401') || error?.message?.includes('api_key') || error?.message?.includes('API key')) {
        throw error; // Propagate auth errors to trigger fallback
      }
      const isRate = error?.status === 429 || error?.message?.includes('429') ||
        error?.message?.includes('rate_limit') || error?.message?.includes('Rate limit');
      if (isRate && retries > 0) {
        console.warn(`[Groq] Rate limit → retry in ${backoff}ms (${retries} left)`);
        await delay(backoff); backoff *= 2; retries--;
      } else {
        console.error(`[Groq] Error for "${job.title}":`, error.message?.substring(0, 100));
        return { score: 0 };
      }
    }
  }
  console.error(`[Groq] Exhausted retries for "${job.title}"`);
  return { score: 0 };
}

async function scoreJobWithGrok(job, profile, apiKey) {
  const prompt = buildPrompt(job, profile);


  let retries = 3;
  let backoff = 4000;

  while (retries > 0) {
    try {
      const res = await fetch('https://api.x.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: 'grok-2',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.1,
          response_format: { type: 'json_object' }
        })
      });

      if (!res.ok) {
        throw new Error(`Grok HTTP error ${res.status}: ${await res.text()}`);
      }

      const data = await res.json();
      const text = data.choices?.[0]?.message?.content || '{}';
      const parsedData = JSON.parse(text);

      if (typeof parsedData.score !== 'number' || parsedData.score < 0 || parsedData.score > 100) {
        console.warn(`[Grok] Bad score format for "${job.title}": ${JSON.stringify(parsedData.score)}`);
        return { score: 0 };
      }
      return parsedData;
    } catch (error) {
      console.warn(`[Grok] Error for "${job.title}":`, error.message, `Retries left: ${retries - 1}`);
      retries--;
      if (retries > 0) {
        await delay(backoff);
        backoff *= 2;
      } else {
        return { score: 0 };
      }
    }
  }
  return { score: 0 };
}

async function scoreJob(job, profile, groq) {
  const key = process.env.GROQ_API_KEY || '';

  // 1. If key starts with 'xai-', call Grok API
  if (key.startsWith('xai-')) {
    try {
      return await scoreJobWithGrok(job, profile, key);
    } catch (err) {
      console.error(`[Scout] Grok API error for "${job.title}":`, err.message);
    }
  }

  // 2. Otherwise, use standard Groq if available
  if (groq && !global.groqFailed) {
    try {
      return await scoreJobWithGroq(job, profile, groq);
    } catch (err) {
      if (err?.status === 401 || err?.message?.includes('401') || err?.message?.includes('api_key') || err?.message?.includes('API key')) {
        console.warn('[Scout] Groq API key is invalid or unauthorized. Switching to Gemini fallback...');
        global.groqFailed = true;
      } else {
        console.error(`[Scout] Groq client error for "${job.title}":`, err.message);
      }
    }
  }

  // 3. Fallback to Gemini if key is present
  if (process.env.GEMINI_API_KEY) {
    try {
      return await scoreJobWithGemini(job, profile, process.env.GEMINI_API_KEY);
    } catch (err) {
      console.error(`[Scout] Gemini fallback error for "${job.title}":`, err.message);
    }
  } else {
    console.warn(`[Scout] Gemini fallback skipped: GEMINI_API_KEY not set.`);
  }

  return { score: 0 };
}

// ─── SHEET OPS ───────────────────────────────────────────────────────────────

async function appendToSheet(sheets, auth, rows, retries = 2) {
  try {
    await sheets.spreadsheets.values.append({
      auth,
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: 'Sheet1!A:K',
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: rows },
    });
  } catch (error) {
    if ((error.code === 429 || error.status === 429) && retries > 0) {
      console.warn('[Sheets] Quota hit — retrying in 8s...');
      await delay(8000);
      return appendToSheet(sheets, auth, rows, retries - 1);
    }
    throw error;
  }
}

async function getWeeklyStats(sheets, auth) {
  try {
    const response = await sheets.spreadsheets.values.get({
      auth, spreadsheetId: process.env.GOOGLE_SHEET_ID, range: 'Sheet1!A:A',
    });
    const rows = response.data.values;
    if (!rows || rows.length <= 1) return { weekMatches: 0 };
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    let weekMatches = 0;
    for (let i = 1; i < rows.length; i++) {
      if (rows[i]?.[0]) {
        const d = new Date(rows[i][0]);
        if (!isNaN(d) && d >= sevenDaysAgo) weekMatches++;
      }
    }
    return { weekMatches };
  } catch (error) {
    console.error('[Stats] Weekly stats error:', error.message);
    return null;
  }
}

// ─── DISCORD ─────────────────────────────────────────────────────────────────

async function sendDiscordDigest(matches, portfolioUrl, totalScanned, weeklyStats = null) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) { console.warn('[Discord] No webhook — skipping.'); return; }

  const date = new Date().toISOString().split('T')[0];
  let content = `📋 **KAISIF JOB DIGEST — ${date}**\n`;
  content += `Scanned **${totalScanned}** roles today, **${matches.length}** matched ≥90\n`;
  content += `───────────────────────────────\n`;

  if (matches.length > 0) {
    matches.forEach((m, idx) => {
      let domain = 'Unknown';
      try { if (m.job.redirect_url) domain = new URL(m.job.redirect_url).hostname.replace('www.', ''); } catch (_) {}
      const reasons = (m.scoreData.match_reasons || []).join(' · ').substring(0, 100);
      const relNote = m.scoreData.relocation_note && m.scoreData.relocation_note !== 'N/A if India-based'
        ? `\n🌍 ${m.scoreData.relocation_note}` : '';
      const salary = m.job.salary_min ? ` | 💰 $${m.job.salary_min}${m.job.salary_max ? `-${m.job.salary_max}` : ''}` : '';
      content += `\n**${idx + 1}. ${m.job.title}** @ **${m.job.company?.display_name || 'Unknown'}**\n`;
      content += `🎯 ${m.scoreData.score}/100 | 📍 ${m.job.location || domain}${salary}\n`;
      content += `✅ ${reasons}${relNote}\n`;
      content += `💡 ${m.scoreData.resume_angle || 'N/A'}\n`;
      content += `🔗 <${m.job.redirect_url}>\n`;
    });
  } else {
    content += `\n_No roles crossed 90 today._\nSources: Internshala + RemoteOK + Remotive${process.env.RAPIDAPI_KEY ? ' + JSearch' : ''}\n`;
  }

  if (weeklyStats) {
    content += `\n📊 **WEEKLY** Total matches stored: **${weeklyStats.weekMatches}**`;
  }

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: content.substring(0, 2000) }),
    });
    if (!res.ok) console.error('[Discord] Send failed:', res.status);
    else console.log('[Discord] Digest sent.');
  } catch (err) {
    console.error('[Discord] Request failed:', err.message);
  }
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  try {
    const groq = process.env.GROQ_API_KEY ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null;
    const profilePath = path.join(__dirname, '../data/profile.json');
    const profile = JSON.parse(fs.readFileSync(profilePath, 'utf8'));

    console.log('[Scout] Starting — sources: Internshala + RemoteOK + Remotive + JSearch (optional)');
    console.log('[Scout] Candidate is open to global relocation ✅');

    const auth = await getAuth();
    const sheets = google.sheets('v4');
    const existingIds = await getExistingJobIds(sheets, auth);
    console.log(`[Scout] ${existingIds.size} existing job IDs in sheet.`);

    // Fetch all sources in parallel
    const [rawInternshala, rawRemoteOK, rawRemotive, rawJSearch] = await Promise.all([
      fetchInternshalaJobs(profile),
      fetchRemoteOKJobs(),
      fetchRemotiveJobs(),
      fetchJSearchJobs(profile),
    ]);

    const rawJobs = [...rawInternshala, ...rawRemoteOK, ...rawRemotive, ...rawJSearch];
    console.log(`[Scout] Raw: ${rawJobs.length} (Internshala: ${rawInternshala.length} | RemoteOK: ${rawRemoteOK.length} | Remotive: ${rawRemotive.length} | JSearch: ${rawJSearch.length})`);

    // Deduplicate by ID, then remove already-seen jobs
    const deduped = new Map();
    for (const job of rawJobs) {
      if (job.id) deduped.set(String(job.id), job);
    }
    const newJobs = Array.from(deduped.values()).filter(j => !existingIds.has(String(j.id)));
    console.log(`[Scout] After dedup + seen filter: ${newJobs.length} new jobs.`);

    // Dynamic Whitelist / Target roles filter
    const roleKeywords = profile.target_roles.map(r => r.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/)).flat().filter(w => w.length > 3);
    roleKeywords.push('apm', 'pmm'); // Common acronyms
    const whitelistRegex = new RegExp(`\\b(${roleKeywords.join('|')})\\b`, 'i');
    const targetMatchingJobs = newJobs.filter(j => whitelistRegex.test(j.title || ''));

    // BLACKLIST: title-only, seniority-only + irrelevant roles.
    const blacklistRegex = /\b(senior\s+(?:manager|director|engineer|developer|consultant)|director\s+of|vp\s+of|head\s+of|principal\s+\w+|staff\s+engineer|5\+?\s*years?|4\+?\s*years?|3\+?\s*years?|video\s+editor|graphic\s+designer|telecaller|inside\s+sales|telemarketing|sales\s+executive|customer\s+support|data\s+entry|virtual\s+assistant|executive\s+assistant|tutor|teacher|academic\s+counselor)\b/i;
    const prunedJobs = targetMatchingJobs.filter(j => !blacklistRegex.test(j.title || ''));
    console.log(`[Scout] After whitelist and blacklist: ${prunedJobs.length} jobs to score.`);

    // Prioritise: put relocation-flagged and India jobs first for scoring
    prunedJobs.sort((a, b) => {
      const aScore = (a.has_relocation ? 2 : 0) + (/(hyderabad|bangalore|bengaluru|india)/i.test(a.location || '') ? 1 : 0);
      const bScore = (b.has_relocation ? 2 : 0) + (/(hyderabad|bangalore|bengaluru|india)/i.test(b.location || '') ? 1 : 0);
      return bScore - aScore;
    });

    const jobsToScore = prunedJobs.slice(0, 20);
    const scoredMatches = [];

    for (const job of jobsToScore) {
      const scoreData = await scoreJob(job, profile, groq);
      const score = scoreData?.score ?? 0;
      const reloFlag = job.has_relocation ? ' 🌍' : '';
      console.log(`  [Score] "${job.title}" @ ${job.company?.display_name} [${job.location}]${reloFlag} → ${score}/100`);

      if (score >= 90) scoredMatches.push({ job, scoreData });
      await delay(2500);
    }

    scoredMatches.sort((a, b) => b.scoreData.score - a.scoreData.score);
    const topMatches = scoredMatches.slice(0, 5);
    console.log(`[Scout] Scored ${jobsToScore.length} → ${topMatches.length} matched ≥90.`);

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
        'NEW',
      ]);
      await appendToSheet(sheets, auth, rows);
      console.log(`[Scout] ${topMatches.length} matches written to sheet.`);
    }

    let weeklyStats = null;
    if (new Date().getDay() === 0) weeklyStats = await getWeeklyStats(sheets, auth);

    await sendDiscordDigest(
      topMatches,
      profile.portfolio || process.env.APP_URL || 'No portfolio linked',
      jobsToScore.length,
      weeklyStats
    );

    console.log('[Scout] Done ✅');
  } catch (error) {
    console.error('[Scout] FATAL:', error.message);
    console.error(error.stack);
    const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
    if (webhookUrl) {
      const safeErr = (error.stack || error.message || String(error)).substring(0, 1500);
      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: `🚨 **Scout Failed**\n\`\`\`js\n${safeErr}\n\`\`\`` }),
      }).catch(() => {});
    }
    process.exit(1);
  }
}

if (process.argv[1] === __filename) {
  main();
}
