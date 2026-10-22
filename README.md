# CareerOS / OpenScout — Autonomous Job Intelligence & Multi-ATS Scouting Engine

An open-source, self-hosted career intelligence, resume parameter extraction, and autonomous job scouting engine. It ingests roles across **Direct-ATS public JSON endpoints (Greenhouse, Lever, Ashby)** and global feeds (**RemoteOK, Remotive, Internshala, Arbeitnow**), evaluates fit across a deterministic **100-point 4-Pillar Rubric** backed by a **100% Free Multi-LLM Fallback Chain**, synthesizes metric-grounded cold outreach, and monitors Gmail threads for recruiter responses.

---

## Core Architecture

### 1. 100% Free Multi-LLM Fallback Chain (Zero Paid API Dependency)
Replaces paid xAI Grok (`api.x.ai`) with a resilient, zero-cost cascading router (`lib/llm.ts` & `scripts/scout.js`):
1. **Tier 1 — Google Gemini Free Tier (`GEMINI_API_KEY`)**: Uses `@google/genai` (`gemini-2.5-flash`) for structured JSON rubric evaluation and native multimodal PDF resume comprehension.
2. **Tier 2 — Groq Cloud Free Tier (`GROQ_API_KEY`)**: Uses `llama-3.3-70b-versatile` (`response_format: { type: "json_object" }`).
3. **Tier 3 — OpenRouter Free Models (`OPENROUTER_API_KEY`)**: Uses `meta-llama/llama-3.3-70b-instruct:free`.
4. **Tier 4 — Deterministic 4-Pillar Rubric Engine (Always-On)**: Computes exact scores across Role Affinity (`/40`), Skill & Proof Coverage (`/30`), Seniority Alignment (`/15`), and Compensation/Geography Fit (`/15`) even when zero external API keys are configured.

### 2. Multi-Source Resume / CV Parser (`PDF`, `Google Drive / Docs URL`, `Raw Text`)
Located in `/admin/profile` (`lib/resume-parser.ts` & `POST /api/profile/parse-resume`):
- **PDF Binary Upload**: Combines Gemini 2.5 Flash native PDF parsing with a built-in deterministic Node `zlib.inflateSync` FlateDecode PDF text-stream parser (`Tj`/`TJ` operators and UTF-16BE decoding) so PDF uploads work with or without API keys.
- **Google Drive & Google Docs Share Link Resolver**: Automatically rewrites `drive.google.com/file/d/{ID}/view` and `docs.google.com/document/d/{ID}/edit` links into direct export streams (`uc?export=download` / `/export?format=txt`).
- **Two-Stage Parameter Inference & Diff Inspector**: Extracts candidate identity, chronological full-time experience years, inferred target roles (from a 75+ role taxonomy), canonical hard skills, and quantified impact metrics (`%`, `$`, `₹`, `x`, `N+ users`), presenting a **Before vs. After Diff & Selective Merge Table** before writing to `data/profile.json`.

### 3. Dynamic Profile-Driven Scraping + Direct-ATS Ingestion
`scripts/scout.js` derives all Internshala slugs, RemoteOK tags, and Remotive search queries dynamically from `data/profile.json` (zero hardcoded role arrays) and queries:
- **Greenhouse Public Boards API** (`boards-api.greenhouse.io`)
- **Lever Public Postings API** (`api.lever.co`)
- **AshbyHQ Public Job Board API** (`api.ashbyhq.com`)
- **Global & Regional Free APIs**: RemoteOK, Remotive, Internshala, Arbeitnow, plus optional `FREEHIRE_API_URL` and `RAPIDAPI_KEY` (JSearch).

### 4. Preserved Google Sheets v4 & GitHub Actions Protocols
- **Google Sheets Ledger (`lib/sheets.ts`)**: Synchronizes `Sheet1!A:K` and deduplicates against `SeenJobs!A:A` via `GOOGLE_SERVICE_KEY_BASE64` and `GOOGLE_SHEET_ID`, with automatic local failover to `data/jobs-store.json`.
- **GitHub Actions Runner (`.github/workflows/scout.yml`)**: Runs `node scripts/scout.js` on schedule (`02:30 UTC`) and dispatches high-conviction (`≥90/100`) digests to Discord (`DISCORD_WEBHOOK_URL`).
- **Autonomous Gmail Reply Tracker (`scripts/reply-tracker.js`)**: Polls Gmail thread headers against `APPLIED` companies and updates status to `REPLIED`.

### 5. Admin Console Telemetry & 4-Pillar Score Audit Drawer
- **4-Tab Executive Analytics (`components/ClientChart.tsx`)**: Switch between **Score Trend**, **Pipeline Conversion Funnel**, **Source & ATS Yield**, and **4-Pillar Rubric Efficiency**.
- **4-Pillar Score Audit Drawer (`components/JobAuditDrawer.tsx`)**: Inspect any job row in `/admin/tracker` or `/admin/digest` to view exact pillar subscores (`Role /40`, `Skill /30`, `Seniority /15`, `Comp/Geo /15`), risk mitigation, and one-click outreach copy.

---

## Quick Start

```bash
npm install
cp .env.example .env
npm run dev
```

Open `http://localhost:3000` for the Public Workbench or `http://localhost:3000/admin/profile` to upload your Resume/CV and calibrate your instance.

---

## Credits & Open-Source Attribution

- **Creator & System Architect**: Made by **Shaik Kaisif Basha**
- **Direct-ATS Scraping Architecture Credit**: Special thanks and open-source attribution to **[`strelov1/freehire`](https://github.com/strelov1/freehire)** by [@strelov1](https://github.com/strelov1) for pioneering the zero-cost direct-ATS job board scraping patterns (Greenhouse, Lever, Ashby public JSON endpoints) integrated into `scripts/scout.js` and `/api/scout/live`.