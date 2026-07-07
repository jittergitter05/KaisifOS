<div align="center">
  <h1>KaisifOS</h1>
  <p><b>An automated, AI-powered Job Scouting & Tracking Engine</b></p>
</div>

## 🌐 Live Website

Project Website: [https://kaisif-tech.vercel.app/](https://kaisif-tech.vercel.app/)

## 📌 Overview

**KaisifOS** is an intelligent, open-source automated job search engine and application tracker. Think of it as a personal AI assistant that scouts for matching jobs, scores them against your profile, and provides a sleek dashboard to manage your applications.

Built with Next.js, it leverages Google Gemini AI for intelligent matching and automates the tracking process with Google Sheets integration and Discord notifications.

## ✨ Features

- 🤖 **AI-Powered Job Scouter:** Automatically fetches jobs from The Muse, Remotive, and JSearch (via RapidAPI), and uses Gemini AI to score them against your skills.
- 📊 **Tracker Dashboard:** Sleek, modern tracker to manage job statuses (Applied, Interview, Rejected, etc.).
- 🔒 **Secure Admin Portal:** Protected by Basic Authentication middleware.
- 📈 **Public Metrics:** Shareable dashboard showing scouting and application statistics.
- 🚀 **Automated Workflows:** Configured to run the scouting script automatically.

## 🚀 Quick Start

### 1. Clone & Install
```bash
git clone https://github.com/jittergitter05/kaisif-os.git
cd kaisif-os
npm install
```

### 2. Environment Variables
Copy the example environment file and fill in your credentials.

```bash
cp .env.example .env.local
```

**Required Credentials:**
- `GEMINI_API_KEY`: Google Gemini API key for AI scoring.
- `APP_URL`: Your deployed application URL.
- `RAPIDAPI_KEY`: Credentials for the JSearch job fetching API.
- `DISCORD_WEBHOOK_URL`: For job arrival notifications.
- `GOOGLE_SHEET_ID`: Target Google Sheet for data syncing.
- `GOOGLE_SERVICE_KEY_BASE64`: Base64 encoded Google Service Account JSON for accessing the sheet.
- `ADMIN_USER` & `ADMIN_PASS`: Credentials to access `/admin` paths.

### 3. Setup Google Sheets
Create a Google Sheet and share it with your Google Service Account email. The sheet should be named `Sheet1` and will act as the data store.

### 4. Run Development Server
```bash
npm run dev
```

Visit the app at `http://localhost:3000`.

## 🏗️ Architecture Setup

- **Framework:** Next.js 15 (App Router)
- **Language:** TypeScript
- **Styling:** Tailwind CSS 4
- **AI Brain:** Google GenAI (Gemini)
- **Database Backend:** Google Sheets API
- **Icons:** Lucide React

## 🔄 Scheduled Automation

KaisifOS comes with predefined workflows to run:
- **Job Scout**: Runs 4x a week (Sunday, Monday, Wednesday, Friday) at 9:30 AM IST to optimize token usage.

Ensure your GitHub repository secrets are set matching the `.env` variables so the cron tasks can execute properly.

## 📜 License

Open source under the MIT License.

## ⚙️ Detailed Setup Guide (Resolving Setup Blockers)

This section provides step-by-step instructions to set up, self-host, and run **KaisifOS** without blockers.

### 1. Google Cloud & Sheets Integration (Database Setup)
KaisifOS stores all pipeline and scout records in a Google Sheet.
1. **Create Google Cloud Project:** Go to the [Google Cloud Console](https://console.cloud.google.com/), create a new project.
2. **Enable Sheets API:** Search for "Google Sheets API" in the library and enable it.
3. **Create Service Account:**
   - Go to **IAM & Admin > Service Accounts**.
   - Create a service account (e.g. `kaisifos-scout@...`).
   - Create a key under the service account, choosing **JSON** type. Download the key file.
4. **Base64 Encode Service Account Key:**
   - On **macOS/Linux**: `base64 -i path/to/key.json | tr -d '\r\n'`
   - On **Windows (PowerShell)**: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("path\to\key.json"))`
   - Paste this single-line string into `GOOGLE_SERVICE_KEY_BASE64` in your environment.
5. **Share the Google Sheet:**
   - Create a Google Sheet. Name the first tab `Sheet1`.
   - Copy the service account's email (found in the JSON file as `client_email`).
   - Share the Google Sheet with that email as an **Editor**.
   - Copy the spreadsheet ID from the URL (the string between `/d/` and `/edit`) and set it as `GOOGLE_SHEET_ID`.

### 2. Google Sheet Column Schema
Ensure your `Sheet1` has the following column headers in Row 1:
- **Col A:** Date
- **Col B:** Job ID
- **Col C:** Title
- **Col D:** Company
- **Col E:** Score
- **Col F:** Match Reasons
- **Col G:** Gap
- **Col H:** URL
- **Col I:** DM Draft
- **Col J:** Resume Angle
- **Col K:** Status (NEW / APPLIED / REPLIED / INTERVIEW / REJECTED / IGNORED)
- **Col L:** Reply Date

### 3. Candidates Profile (`data/profile.json`)
Create a candidate profile matching your skills at `data/profile.json` using this schema:
```json
{
  "name": "Your Name",
  "target_roles": ["Associate Product Manager", "Product Marketing Manager", "Growth Lead"],
  "experience_level": "Fresher",
  "min_salary_lpa": 8,
  "min_salary_usd_annual": 30000,
  "skills": ["SQL", "Product Analytics", "Market Research", "Copywriting"],
  "key_metrics": [
    "Drove 40% user retention growth in internship",
    "Analyzed 10k+ survey inputs for market analysis"
  ]
}
```

### 4. Discord Integration
To receive daily scout alerts:
1. Open Discord, go to **Server Settings > Integrations > Webhooks**.
2. Click **New Webhook**, select the channel, and copy the **Webhook URL**.
3. Set this URL as `DISCORD_WEBHOOK_URL` in your environment.

### 5. JSearch (RapidAPI)
1. Register on [RapidAPI JSearch](https://rapidapi.com/letscrape-65710200/api/jsearch).
2. Subscribe to the free tier (gives 50 free search calls/month).
3. Copy the `x-rapidapi-key` and set it as `RAPIDAPI_KEY` in your environment.

### 6. Authentication Setup
- `ADMIN_USER` and `ADMIN_PASS` should be set as plaintext strings in your `.env.local` file (e.g. `ADMIN_USER="admin"` and `ADMIN_PASS="secret123"`). These credentials protect the `/admin` path.

### 7. Environment Verification Script
Validate your environment variables locally at any time by running:
```bash
npm run check-env
```