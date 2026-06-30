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
    return new Set();
  }
}

// ─── SOURCE 1: INTERNSHALA (India-specific, fresher-focused) ─────────────────

async function fetchInternshalaJobs() {
  const jobs = [];
  const categories = ['digital-marketing', 'marketing', 'product-management', 'content-writing'];
  const cities = ['hyderabad', 'bangalore'];
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
              const desc = (job.description || job.job_description || `${title} at ${company} in ${city}.`).replace(/<[^>]*>/g, '').trim();
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
          description: (item.description || `${item.position} at ${item.company}. Remote role.`).replace(/<[^>]*>/g, '').trim().substring(0, 800),
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
        const description = (item.description || '').replace(/<[^>]*>/g, '').trim();
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
        const description = (item.description || '').replace(/<[^>]*>/g, '').trim();
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
    const query = `(${profile.target_roles.slice(0, 3).join(' OR ')}) entry level fresher relocation`;
    const url = new URL('https://jsearch.p.rapidapi.com/search');
    url.searchParams.append('query', query);
    url.searchParams.append('num_pages', '1');
    url.searchParams.append('date_posted', 'today');
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

async function scoreJob(job, profile, groq) {
  const desc = (job.description || '').substring(0, 600);
  const hasRelocation = job.has_relocation || false;
  const location = job.location || 'Not specified';
  const salaryInfo = job.salary_min
    ? `Min salary: ${job.salary_min} ${job.salary_max ? `- ${job.salary_max}` : ''}` 
    : 'Salary: Not listed';

  const prompt = `You are a recruiting AI. Score this job for this specific candidate.
Return ONLY valid JSON. No markdown. No explanation. No code fences.

CANDIDATE:
Name: ${profile.name}
Target Roles: ${profile.target_roles.join(', ')}
Base: Hyderabad, India
Open to relocation: YES — willing to move globally if role provides accommodation/relocation support
Experience: ${profile.experience_level} — 0 full-time years
Key Metrics: ${profile.key_metrics.join(' | ')}
Skills: ${profile.skills.join(', ')}
Min Salary: ₹${profile.min_salary_lpa} LPA India / $${profile.min_salary_usd_annual || 30000} USD abroad

JOB:
Title: ${job.title}
Company: ${job.company?.display_name || 'Unknown'}
Location: ${location}
${salaryInfo}
Relocation/Accommodation mentioned: ${hasRelocation ? 'YES ✅' : 'Not detected'}
Description: ${desc}

SCORING RULES — READ ALL:
1. Role match (40 pts): How well does the title/description match PMM / APM / Growth / Content / FA?
2. Fresher-friendly (25 pts): Penalise ONLY if explicitly requires 3+ years. "2 years preferred" or "1-2 years" = OK for a strong fresher.
3. Location/relocation (20 pts): India roles score full marks. International roles with relocation/visa/accommodation support score full marks. International roles WITHOUT relocation support but FULLY REMOTE score 12/20. International roles requiring self-funded visa/move score 5/20.
4. Salary (15 pts): Listed salary ≥ ₹8 LPA India or ≥ $30k USD abroad = full marks. Unlisted = 10/15 (assume standard).

BONUS: Add 5–10 points if relocation/accommodation/visa is explicitly mentioned.

HARD RULES:
- DO NOT score 0 just because location is outside India — candidate wants international
- DO NOT penalise worldwide/remote roles
- DO score below 40 only for: clearly unrelated domain (engineering, law, medicine), or explicitly 5+ years required

Return exactly:
{
  "score": <integer 0-100>,
  "match_reasons": ["reason 1", "reason 2", "reason 3"],
  "gap": "one line on the biggest risk or weakness for this specific role",
  "dm_draft": "3-sentence LinkedIn DM opening with the strongest matching metric from candidate profile",
  "resume_angle": "which specific candidate metric to lead with for THIS role",
  "relocation_note": "brief note on relocation/accommodation situation for this role, or 'N/A if India-based'"
}`;

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
  content += `Scanned **${totalScanned}** roles today, **${matches.length}** matched ≥60\n`;
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
    content += `\n_No roles crossed 60 today._\nSources: Internshala + RemoteOK + Remotive${process.env.RAPIDAPI_KEY ? ' + JSearch' : ''}\n`;
  }

  if (weeklyStats) {
    content += `\n📊 **WEEKLY** Total matches stored: **${weeklyStats.weekMatches}**`;
  }

  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: content.substring(0, 2000) }),
  });
  if (!res.ok) console.error('[Discord] Send failed:', res.status);
  else console.log('[Discord] Digest sent.');
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  try {
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
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
      fetchInternshalaJobs(),
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

    // BLACKLIST: title-only, seniority-only. No location filtering.
    const blacklistRegex = /\b(senior\s+(?:manager|director|engineer|developer|consultant)|director\s+of|vp\s+of|head\s+of|principal\s+\w+|staff\s+engineer|5\+?\s*years?|4\+?\s*years?|3\+?\s*years?)\b/i;
    const prunedJobs = newJobs.filter(j => !blacklistRegex.test(j.title || ''));
    console.log(`[Scout] After blacklist: ${prunedJobs.length} jobs to score.`);

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

      if (score >= 60) scoredMatches.push({ job, scoreData });
      await delay(2500);
    }

    scoredMatches.sort((a, b) => b.scoreData.score - a.scoreData.score);
    const topMatches = scoredMatches.slice(0, 5);
    console.log(`[Scout] Scored ${jobsToScore.length} → ${topMatches.length} matched ≥60.`);

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
      profile.portfolio || 'https://portjitterglitter.vercel.app',
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

main();
