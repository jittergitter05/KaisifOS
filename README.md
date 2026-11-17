# KaisifOS — Autonomous Job Intelligence & Multi-ATS Scouting Engine

An open-source, self-hosted career intelligence, resume parameter extraction, and autonomous job scouting platform. KaisifOS ingests live openings directly from **official Company Career Pages (`Schema.org JobPosting` JSON-LD + embedded ATS discovery)**, **6 Direct-ATS public JSON endpoints (Greenhouse, Lever, Ashby, Workable, SmartRecruiters, Recruitee)**, and global feeds (**RemoteOK, Remotive, Himalayas, Internshala, Arbeitnow, TheMuse**), scores every role against a calibrated **100-point 4-Pillar Rubric (`v3.2`)** powered by a **100% Free Multi-LLM Failover Chain**, synthesizes metric-grounded outreach with direct Apply Page links, and monitors Gmail threads for recruiter responses.

---

## Truthful Architecture Note on `strelov1/freehire`

KaisifOS does **not** bundle or execute the external Go / PostgreSQL / Meilisearch [`strelov1/freehire`](https://github.com/strelov1/freehire) backend binary inside this repository. Instead:

1. **Built-In Native Career Page & 6-ATS Connectors (Zero-Infra)**: `lib/career-scraper.ts`, `lib/scout-runner.ts`, and `scripts/scout.js` natively crawl configured official Company Career Pages (`career_urls`) and query 6 public JSON ATS endpoints (**Greenhouse**, **Lever**, **Ashby**, **Workable**, **SmartRecruiters**, and **Recruitee**) directly from Node.js / Next.js using architectural patterns inspired by `strelov1/freehire`.
2. **Optional Self-Hosted Bridge (`FREEHIRE_API_URL`)**: If you self-host an external `strelov1/freehire` HTTP API, set `FREEHIRE_API_URL` in `.env` / GitHub Secrets and KaisifOS automatically ingests it alongside the built-in Career Page and 6-ATS connectors under the `FreeHire API` source label.

---

## Core Architecture

### 1. 4-Tier Free Multi-LLM Failover Chain (`lib/llm.ts` & `scripts/scout.js`)
Every scoring, prep, and resume-extraction call cascades strictly across zero-cost providers (deprecated paid `xai-` Grok keys are automatically ignored):

1. **Tier 1 — Google Gemini Free Tier (`GEMINI_API_KEY`)**: Uses `gemini-4-hydrogen` (`ThinkingLevel.LOW` for rubric scoring & prep packs, `ThinkingLevel.MEDIUM` + native `application/pdf` inline bytes for multimodal resume parsing).
2. **Tier 2 — Groq Cloud Free Tier (`GROQ_API_KEY`)**: Uses `llama-3.3-70b-versatile` (`response_format: { type: "json_object" }`).
3. **Tier 3 — OpenRouter Free Model Cascade (`OPENROUTER_API_KEY`)**: Cascades sequentially across `meta-llama/llama-3.3-70b-instruct:free`, `google/gemma-3-27b-it:free`, and `openrouter/free` (with `HTTP-Referer` derived from `APP_URL` and `X-Title: KaisifOS Job Intelligence`).
4. **Tier 4 — Deterministic 4-Pillar Rubric Engine `v3.2` (Always-On)**: Computes exact scores across Role Affinity (`/40`), Skill & Proof Coverage (`/30`), Seniority Alignment (`/15`), and Compensation/Geography Fit (`/15`) — including LPA, INR, and USD/EUR/GBP hourly/monthly/annual normalization and company-age false-positive guards — guaranteeing full functionality even with zero API keys configured.

### 2. Multi-Source Resume / CV Parser (`PDF`, `Google Drive / Docs URL`, `Raw Text`)
Located in `/admin/profile` (`lib/resume-parser.ts` & `POST /api/profile/parse-resume`):
- **PDF & Text Upload**: Combines Gemini 4 Hydrogen native PDF comprehension with a built-in deterministic Node `zlib.inflateSync` FlateDecode PDF text-stream parser (`Tj`/`TJ` operators + UTF-16BE decoding) so PDF extraction works offline or without API keys.
- **Redirect-Pinned Google Drive & Google Docs Resolver**: Automatically rewrites `drive.google.com/file/d/{ID}/view` (including `/u/{N}/`) and `docs.google.com/document/d/{ID}/edit` links into direct export streams while pinning redirects strictly to Google hosts (`*.google.com`, `*.googleusercontent.com`, `*.gstatic.com`) with an 8 MB pre-read size cap.
- **Interactive Diff & Selective Merge Inspector**: Displays `Current Value` vs. `Extracted Value` across identity, chronological tenure, roles, hard skills, proof metrics, and salary floors before persisting cleanly.

### 3. 3-Tier Persistence Architecture (Cloud Run / Vercel Safe)
KaisifOS automatically handles both read-only container filesystems (`EROFS` on Cloud Run, Vercel, or read-only Docker volumes) and ephemeral restarts:
1. **Google Sheets v4 Cloud Sync (`GOOGLE_SHEET_ID` + `GOOGLE_SERVICE_KEY_BASE64`)**: Auto-provisions missing `Sheet1`, `SeenJobs`, and `Profile` tabs on first access; syncs `Profile!A1` across deployments, dashboard, and CLI GitHub Actions (`scripts/scout.js`).
2. **Writable Data Directory (`KAISIFOS_DATA_DIR` or `data/`)**: Uses atomic temp-file writes when mounted read-write.
3. **Automatic `/tmp` Runtime Fallback (`os.tmpdir()/kaisifos-data`)**: When `data/` is mounted read-only, pre-seeds `profile.json` and `jobs-store.json` into `/tmp` so saves succeed cleanly and surfaces an honest ephemeral-storage notice in the UI and `/api/health`.

### 4. Dynamic Profile-Driven Ingestion & Security Perimeter
`lib/career-scraper.ts`, `lib/scout-runner.ts`, and `scripts/scout.js` share `deriveDynamicSearchParams()` (`lib/utils.ts`) to turn active profile roles and skills into live board queries with canonical `company::title` deduplication and `SeenJobs` low-score skip memory:
- **Direct Company Career Pages (`career_urls`)**: SSRF-guarded crawler extracting `Schema.org JobPosting` JSON-LD, embedded ATS board tokens, and direct career-link anchors from official company career portals.
- **6 Direct-ATS Public Boards**: Greenhouse (`boards-api.greenhouse.io`), Lever (`api.lever.co`), Ashby (`api.ashbyhq.com`), Workable (`apply.workable.com`), SmartRecruiters (`api.smartrecruiters.com`), and Recruitee (`*.recruitee.com`) configured via `ats_companies` in `/admin/profile`.
- **Global & Regional Free APIs**: RemoteOK, Remotive, Himalayas, Arbeitnow, Internshala, TheMuse, plus optional SSRF-validated `FREEHIRE_API_URL` and `RAPIDAPI_KEY` (JSearch).
- **Security Hardening**: Sliding-window IP rate limiting on auth/AI routes, iframe-safe & HTTP/HTTPS-aware session cookies, RFC4180 CSV formula injection escaping, and strict Column-B ID verification on Cloud Sheets patches.

### 5. GitHub Actions Workflows (Exact Repository Schedules)
- **Job Scout Agent (`.github/workflows/job-scout.yml`)**: Runs on cron `0 4 * * 0,1,3,5` (Sun, Mon, Wed, Fri at `04:00 UTC` / `09:30 IST`) and `workflow_dispatch`. Executes `npm run typecheck`, `npm test`, and `node scripts/scout.js`, appending high-conviction matches (`≥90/100`) to Google Sheets (`Sheet1!A:K` & `SeenJobs!A:A`) and sending digests to Discord (`DISCORD_WEBHOOK_URL`).
- **Gmail Reply Tracker (`.github/workflows/reply-tracker.yml`)**: Runs on cron `30 3 * * 1-5` (Mon–Fri at `03:30 UTC` / `09:00 IST`) and `workflow_dispatch`. Executes `npm test` and `node scripts/reply-tracker.js` to monitor `GMAIL_USER_EMAIL` headers (requires Google Workspace Domain-Wide Delegation for service accounts) against `APPLIED` companies and transition replied threads cleanly on `Sheet1!K`.

---

## Complete Environment Variable Matrix (12 Core + 2 Optional Overrides)

| Variable | Subsystem | Required? | Local / Zero-Key Fallback |
| :--- | :--- | :--- | :--- |
| `GEMINI_API_KEY` | Tier 1 AI & Multimodal PDF | Optional | Cascades to Groq → OpenRouter → Rubric v3.2 |
| `GROQ_API_KEY` | Tier 2 AI (`llama-3.3-70b-versatile`) | Optional | Cascades to OpenRouter → Rubric v3.2 |
| `OPENROUTER_API_KEY` | Tier 3 AI (`:free` 3-model cascade) | Optional | Cascades to Deterministic 4-Pillar Rubric v3.2 |
| `FREEHIRE_API_URL` | Optional `strelov1/freehire` HTTP API | Optional | Uses built-in Career Page & 6-ATS connectors |
| `RAPIDAPI_KEY` | Optional JSearch Aggregator Feed | Optional | Skips JSearch; uses Career Pages + 6 ATS + global feeds |
| `GOOGLE_SHEET_ID` | Google Sheets v4 Ledger | Cloud Sync | Writable `data/` → automatic `/tmp` runtime overlay |
| `GOOGLE_SERVICE_KEY_BASE64` | Google Cloud Service Account JSON/Base64 | Cloud Sync | Writable `data/` → automatic `/tmp` runtime overlay |
| `GMAIL_USER_EMAIL` | Gmail Reply Tracker Target Inbox (Workspace) | Optional | Falls back to active profile `email` |
| `DISCORD_WEBHOOK_URL` | Discord Digest & Reply Alerts | Optional | In-app Executive Scout Digest (`/admin/digest`) |
| `APP_URL` | Canonical Origin & OpenRouter Referer | Optional | Defaults to `https://kaisifos.local` |
| `ADMIN_USER` | Operator Console Handle | Public Deploy | Open Local Operator Mode if unset |
| `ADMIN_PASS` | Operator Console Passkey | Public Deploy | Open Local Operator Mode if unset |
| `KAISIFOS_DATA_DIR` | Custom Persistent Volume Mount Path | Optional | Auto-resolves `data/` or `/tmp/kaisifos-data` |
| `GEMINI_MODEL` | Override Default Gemini Model ID | Optional | Defaults to `gemini-4-hydrogen` |

---

## Quick Start

```bash
npm install
cp .env.example .env
npm run dev
```

Open `http://localhost:3000` for the Public Workbench or `http://localhost:3000/admin/profile` to upload a Resume/CV and calibrate your instance. Run `npm test && npm run typecheck && npm run check-env` to verify the full stack locally.

---

## Credits & Open-Source Attribution

- **Creator & System Architect**: Made by **Shaik Kaisif Basha**
- **Direct-ATS Architecture Inspiration**: Special thanks to **[`strelov1/freehire`](https://github.com/strelov1/freehire)** by [@strelov1](https://github.com/strelov1) for pioneering the zero-cost public Direct-ATS JSON scraping patterns (Greenhouse, Lever, Ashby) that inspired KaisifOS's built-in TypeScript/Node connectors.