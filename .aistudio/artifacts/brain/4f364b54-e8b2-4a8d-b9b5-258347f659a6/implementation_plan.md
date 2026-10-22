# OpenScout OS — Architectural & Anti-Vibe-Coded Upgrade Plan (Revised)

## 1. Executive Summary
This revised engineering plan addresses all core operational, scraping, resume-intelligence, design, and analytics requirements while strictly preserving existing Google Sheets (`lib/sheets.ts`) and GitHub Actions (`scripts/scout.js`) backend protocols:

1. **Replace Paid xAI Grok (`api.x.ai`) with a 100% Free Multi-LLM Fallback Chain**: Cascades across **Google Gemini Free Tier (`gemini-2.5-flash`)** $\rightarrow$ **Groq Cloud Free Tier (`llama-3.3-70b-versatile`)** $\rightarrow$ **OpenRouter Free Tier (`meta-llama/llama-3.3-70b-instruct:free`)** $\rightarrow$ **Always-On Deterministic 4-Pillar Rubric Engine**.
2. **FreeHire (`strelov1/freehire`) Integration & Dynamic Scraping Optimization**: Eliminates hardcoded role arrays in `scripts/scout.js`, derives all search queries dynamically from `data/profile.json`, integrates direct-ATS public board scraping (**Greenhouse, Lever, Ashby** + optional `FREEHIRE_API_URL`) alongside **RemoteOK, Remotive, Internshala, Arbeitnow, and Himalayas**, and adds dedicated open-source attribution for **`strelov1/freehire`** in `README.md`.
3. **Rigid, Legitimate Multi-Source Resume/CV Parser (`Text`, `PDF`, or `Google Drive / Docs URL`)**: Over-engineered ingestion pipeline in `/admin/profile` and `/api/profile/parse-resume` that extracts structured candidate parameters, seniority, target roles, technical/domain skills, quantified proof metrics (`%`, `$`, `N+`), and search affinities with an interactive **Before vs. After Diff & Merge Inspector**.
4. **Anti-"Vibe-Coded" Design Audit & Institutional UI Overhaul**: Strips out every AI-slop / vibe-coded trope in the codebase (glowing emerald pills on the brand lockup, `<Sparkles />` icons, nested cards-within-cards, self-congratulatory "Audit Matrix" filler copy, and badge-heavy cards) in favor of a disciplined, high-contrast **Swiss Grid & Linear/Raycast-grade** engineering interface.
5. **Admin Console 4-Tab Analytics, 4-Pillar Audit Drawer & Reporting Suite**: Interactive job score inspection drawer, 4-mode Recharts telemetry (Score Trend, Pipeline Conversion Funnel, Source & ATS Yield, 4-Pillar Rubric Breakdown), SLA follow-up tracking, and CSV/Markdown executive report export.

---

## 2. Replacing xAI Grok with a Free Multi-LLM Fallback Chain

### Problem
- `scripts/scout.js` and `app/api/evaluate/route.ts` previously relied on `https://api.x.ai/v1/chat/completions` (`grok-4.5`), which no longer provides a free tier.

### Solution (`lib/llm.ts` & `scripts/scout.js`)
We will implement a unified, zero-cost LLM router used by the Next.js API routes (`/api/evaluate`, `/api/profile/parse-resume`) and mirrored in `scripts/scout.js` for GitHub Actions:

1. **Provider 1 — Google Gemini Free Tier (`GEMINI_API_KEY`)**:
   - Uses `@google/genai` SDK (`gemini-2.5-flash`) with `responseMimeType: "application/json"` and strict JSON schema validation.
2. **Provider 2 — Groq Cloud Free Tier (`GROQ_API_KEY`)**:
   - Calls `https://api.groq.com/openai/v1/chat/completions` using `llama-3.3-70b-versatile` (`response_format: { type: "json_object" }`).
3. **Provider 3 — OpenRouter Free Models (`OPENROUTER_API_KEY`)**:
   - Calls `https://openrouter.ai/api/v1/chat/completions` using `meta-llama/llama-3.3-70b-instruct:free` (with automatic fallback to `google/gemma-3-27b-it:free`).
4. **Provider 4 — Deterministic 4-Pillar Rubric Fallback (Zero-Key Guarantee)**:
   - Always computes the baseline 0–100 score across Role Affinity (40 pts), Skill & Proof Coverage (30 pts), Seniority & Experience Alignment (15 pts), and Location & Compensation Fit (15 pts), plus tailored cold outreach hooks using the candidate's verified `key_metrics`.

---

## 3. Rigid Multi-Source Resume/CV Parser (Text, PDF, & Google Drive Link)

### Architectural Goal
Enable any user who forks or runs the platform to upload their latest Resume/CV via **PDF file**, **Google Drive / Google Docs share link**, or **Raw Text**, and deterministically + semantically extract their entire candidate configuration (`data/profile.json`) so the scraper and evaluator immediately understand **who they are, what they have proven, and what roles they should target**.

### Ingestion Channels (`POST /api/profile/parse-resume`)
1. **PDF Binary Upload (`multipart/form-data` or Base64 payload)**:
   - **Stage A (Multimodal Native PDF Parsing)**: When `GEMINI_API_KEY` is configured, passes the raw PDF buffer (`application/pdf` inline data) directly to `gemini-2.5-flash` for layout-aware document comprehension (tables, multi-column resumes, sidebar skills, dates).
   - **Stage B (Deterministic PDF Text Stream Extractor)**: Built-in server-side PDF parser that decompresses `FlateDecode` streams (`zlib.inflateSync`), parses PDF text operators (`Tj`, `TJ`, `Td`, `TD`, `'`, `"`), and decodes UTF-16BE / WinAnsi hex strings so PDF parsing works **even with zero external API keys**.
2. **Google Drive & Google Docs Link Resolver (`https://drive.google.com/...` or `https://docs.google.com/...`)**:
   - Parses share URLs matching:
     - `drive.google.com/file/d/{FILE_ID}/view` $\rightarrow$ fetches `https://drive.google.com/uc?export=download&id={FILE_ID}`
     - `docs.google.com/document/d/{DOC_ID}/edit` $\rightarrow$ fetches `https://docs.google.com/document/d/{DOC_ID}/export?format=txt` (and PDF fallback)
   - Validates HTTP status, content-type (`application/pdf`, `text/plain`, `text/html`), strips HTML tags if a web preview is returned, and pipes the payload into the PDF/Text extraction engine. Returns actionable diagnostics if a file is locked behind private permissions.
3. **Raw Text / Markdown Paste**:
   - Normalizes Unicode bullets, ligatures, whitespace, and section headers (`EXPERIENCE`, `EDUCATION`, `PROJECTS`, `SKILLS`, `ACHIEVEMENTS`).

### Two-Stage Rigid Parameter Extraction Engine (`lib/resume-parser.ts`)
Every ingested resume runs through **both** a deterministic rule-based AST parser and (if a free LLM key is present) a structured LLM extraction pass, merging and cross-verifying results:

- **Identity & Links**: Extracts full name, email (`regex` RFC-5322), portfolio/GitHub/LinkedIn URLs, and current location.
- **Chronological Experience Calculator**:
  - Parses date ranges (`Jan 2023 – Present`, `06/2022 - 08/2024`, `Summer 2024`) across work experience entries, deduplicates overlapping intervals, excludes pure academic degrees, and computes exact `experience_years` and `experience_level` (`Fresher (0 yrs)`, `0-1 Years`, `1-3 Years`, `3-5 Years`, `5+ Years`).
- **Role Taxonomy & Target Role Inference**:
  - Cross-references job titles held, project domains, and summary statements against a curated taxonomy of 60+ engineering, product, growth, data, AI, and design titles to populate `target_roles` (weighted by recency and skill density).
- **Hard Skill & Tooling Graph**:
  - Extracts programming languages, frameworks, cloud/infra tools, analytics stacks, and domain methodologies against a normalized canonical dictionary (avoiding generic fluff words like "hardworking" or "team player").
- **Strict Quantified Proof Metrics Extractor (`key_metrics`)**:
  - Scans bullet points for verifiable quantitative impact patterns: percentages (`+42%`, `reduced latency by 35%`), currency/revenue (`$1.2M ARR`, `₹15L`), scale/multipliers (`10k+ DAU`, `3.2x ROAS`, `99.95% uptime`), and rankings (`Top 1%`, `Winner among 400+ teams`).
- **Compensation & Geography Calibration**:
  - Infers preferred cities/remote preferences and recommends calibrated `min_salary_lpa` / `min_salary_usd_annual` based on seniority and role track.

### Interactive Diff & Selective Merge UI (`/admin/profile`)
- **3-Tab Ingestion Workbench**: `Upload PDF` | `Google Drive / Docs URL` | `Paste Resume Text`.
- **Parse Diagnostics Telemetry**: Displays extraction method used (`Gemini 2.5 Native PDF + Deterministic AST`, `Groq Llama-3.3 + AST`, or `Deterministic AST Engine`), character count, sections detected, and confidence score.
- **Parameter-by-Parameter Diff Table**: Shows `Current Profile Value` vs. `Parsed Resume Value` with individual checkboxes so the user can selectively apply or edit parsed fields (`Target Roles`, `Skills`, `Quantified Metrics`, `Experience Level`, `Identity`) before saving to `data/profile.json`.

---

## 4. Dynamic Scraping, FreeHire (`strelov1/freehire`) Integration & Open-Source Credits

### Dynamic Query Derivation (`scripts/scout.js`)
- Removes hardcoded role arrays (`['founder-s-office', 'product-management', ...]`).
- Dynamically transforms `profile.target_roles` and `profile.skills` into URL-safe Internshala slugs, RemoteOK/Remotive tags, and keyword matrices.
- Adds configurable `ats_companies` in `data/profile.json` (with sensible defaults: Stripe, Linear, Vercel, PostHog, Supabase, Razorpay, Cred, Anthropic, LangChain, Cohere, etc. — customizable in `/admin/profile`).

### Multi-Source & FreeHire Direct-ATS Connectors
1. **FreeHire Direct-ATS Engine (inspired by `strelov1/freehire`)**:
   - **Greenhouse Public API**: `https://boards-api.greenhouse.io/v1/boards/{company}/jobs?content=true`
   - **Lever Public Postings API**: `https://api.lever.co/v0/postings/{company}?mode=json`
   - **Ashby Public Job Board API**: `https://api.ashbyhq.com/posting-api/job-board/{company}`
   - **Self-Hosted FreeHire Endpoint (`FREEHIRE_API_URL`)**: Optional direct ingestion if the user runs a standalone `strelov1/freehire` instance.
2. **Global & Regional Free Job Feeds**:
   - **RemoteOK API**, **Remotive API**, **Arbeitnow Free API**, **Himalayas Remote Jobs API**, and **Dynamic Internshala Scraper**.
3. **Deduplication & Concurrency Optimization**:
   - Bounded concurrency (`Promise.allSettled` batches of 4), 8-second `AbortSignal.timeout(8000)` per source, and canonical fingerprinting (`normalize(company) + normalize(roleTitle)`) to eliminate duplicates across ATS and aggregator feeds.

### Open-Source Attribution in `README.md`
- We will overhaul `README.md` to document:
  - Complete system architecture (Multi-LLM free fallback chain, Multi-Source Resume Parser, 4-Pillar Rubric Engine, Google Sheets & GitHub Actions protocols).
  - Dedicated **Credits & Acknowledgements** section explicitly crediting **[`strelov1/freehire`](https://github.com/strelov1/freehire)** for the zero-cost direct-ATS (Greenhouse, Lever, Ashby) job scraping architecture, alongside the single-line creator attribution (`Made by Shaik Kaisif Basha`).

---

## 5. Anti-"Vibe-Coded" Design Audit & Professional UI Overhaul

### What Currently Makes the Project Look "Vibe-Coded" (Audit Findings)
1. **Header Brand Lockup Violation (`app/page.tsx`)**: Attached emerald pill badge (`Owner: {profile.name}`) directly inside the top navbar brand zone, violating the strict 3-Zone Top Bar Contract.
2. **Decorative AI Icons (`<Sparkles />`)**: Used in `app/admin/profile/page.tsx` and across action buttons — a classic AI-generated template tell.
3. **Self-Referential "Audit Matrix" Filler Copy (`app/page.tsx`)**: The public landing page currently renders a giant `AUDIT_MATRIX` card talking about "Next.js 15 Dev/Build Race Condition" and "Chrome Password Breach Modal" instead of presenting a clean, authoritative **Candidate Portfolio, Live Opportunity Match Matrix, and Engineering Proof Ledger**.
4. **Pill-itis & Nested Box Clutter**: Overuse of rounded pill badges (`rounded-full` / `rounded-md` with tinted borders) for static skills and metadata, plus dark boxes nested inside dark cards (`bg-[#0B0F17]` inside `bg-[#111827]`).

### Concrete Anti-Vibe-Coded Refactoring Rules
1. **Strict 3-Zone Header & Single-Line Footer**:
   - **Zone 1 (Left)**: Clean typographic brand mark (`OpenScout` / candidate workspace title) with zero attached badges or status pills.
   - **Zone 2 (Center)**: Text-only section navigation (`Overview`, `Capabilities`, `Proof Ledger`, `Live Matches`).
   - **Zone 3 (Right)**: Theme toggle + `Admin Console` trigger (`⌘K`).
   - **Footer**: Single clean structural bar containing `Made by Shaik Kaisif Basha` and open-source `strelov1/freehire` acknowledgement — zero duplicated navbar links.
2. **Zero-Pill Discipline & Swiss Grid Hairlines**:
   - Replace static skill/tag pills with crisp `1px solid` hairline cells or inline monospace dot-separated metadata (`Remote · $120k–$150k · Greenhouse ATS · 2h ago`).
   - Reserve badge enclosures strictly for interactive filter chips or live status indicators.
3. **No `<Sparkles />` or AI Slop Copy**:
   - Replace all `<Sparkles />` icons with semantic engineering iconography (`Terminal`, `FileText`, `Sliders`, `Layers`, `ArrowUpRight`).
   - Replace the meta "System Audit Matrix" on `app/page.tsx` with a real **Candidate Capability & Proof Matrix** driven dynamically by `data/profile.json` (`target_roles`, `skills`, `key_metrics`) and live top-scored roles from `data/jobs.json`.
4. **High-Craft Light & Dark Theme Tokens**:
   - **Light Mode (Default)**: Warm alabaster paper (`#F8FAFC`) with pure crisp white (`#FFFFFF`) primary cards, `#E2E8F0` `1px` structural hairlines, and deep slate (`#0F172A`) typography.
   - **Dark Mode**: Carbon slate (`#090D16`) canvas with elevated `#111827` surfaces and `#1E293B` hairlines.
   - **Tabular Numerals**: Enforce `font-mono tabular-nums` on every score, salary, timestamp, and conversion metric.

---

## 6. Admin Console Graphs, 4-Pillar Audit Drawer & Reporting Suite

1. **4-Mode Executive Telemetry Chart (`components/ClientChart.tsx`)**:
   - **Match Score Distribution & Trend**: Area chart of Avg Score vs. High-Signal (`≥80%`) roles over time.
   - **Pipeline Conversion Funnel**: Horizontal funnel tracking `Discovered` $\rightarrow$ `Shortlisted` $\rightarrow$ `Applied` $\rightarrow$ `Interviewing` $\rightarrow$ `Offer` with stage-to-stage conversion percentages.
   - **Source & ATS Yield**: Stacked bar chart comparing volume and average match quality across `Greenhouse`, `Lever`, `Ashby`, `RemoteOK`, `Remotive`, `Internshala`, `Arbeitnow`, and `Himalayas`.
   - **4-Pillar Rubric Breakdown**: Aggregate bar comparison of `Role (40)`, `Skill (30)`, `Seniority (15)`, and `Comp/Geo (15)` averages across discovered roles.
2. **Interactive 4-Pillar Score Audit Drawer (`app/admin/page.tsx` & `app/admin/tracker/page.tsx`)**:
   - Clicking any job opens a slide-over inspection drawer displaying exact points earned per pillar (`e.g., 34/40 Role, 26/30 Skill, 15/15 Seniority, 12/15 Comp`), matched skills vs. missing skills, active scoring engine used, and one-click copy for personalized outreach hooks.
3. **Reporting Criteria & Export (`app/admin/digest/page.tsx`)**:
   - Custom reporting criteria controls (`Min Score Threshold`, `Source Filter`, `ATS Filter`, `SLA Stale Follow-up Alert > 5 days`) plus one-click **Export CSV** and **Copy Executive Markdown Report**.
