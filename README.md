<div align="center">
  <h1>KaisifOS</h1>
  <p><b>An automated, AI-powered Job Scouting & Tracking Engine</b></p>
</div>

## 📌 Overview

**KaisifOS** is an intelligent, open-source automated job search engine and application tracker. Think of it as a personal AI assistant that scouts for matching jobs, scores them against your profile, and provides a sleek dashboard to manage your applications.

Built with Next.js, it leverages Google Gemini AI for intelligent matching and automates the tracking process with Google Sheets integration and Discord notifications.

## ✨ Features

- 🤖 **AI-Powered Job Scouter:** Automatically fetches jobs from Adzuna and uses Gemini AI to score them against your skills.
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
- `ADZUNA_APP_ID` & `ADZUNA_API_KEY`: Credentials for the Adzuna job fetching API.
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
- **Job Scout**: Runs daily on weekdays.
- **Reply Tracker**: Tracks email responses automatically.

Ensure your GitHub repository secrets are set matching the `.env` variables so the cron tasks can execute properly.

## 📜 License

Open source under the MIT License.

## 🚧 Beginner Setup Blockers (Review Notes)
If you are a student or beginner without DevOps experience trying to self-host this project, you might get blocked on the following steps. (These areas need better documentation in future updates):

1. **`APP_URL` & Deployment Context**: Missing instructions on how to actually deploy the app (e.g., using Vercel or Railway). The instructions assume you know how to get a live URL and where to provide it. You also have `localhost` instructions but ask for an `APP_URL` beforehand.
2. **Adzuna External API**: No link is provided to the Adzuna developer portal to register an `ADZUNA_APP_ID` & `ADZUNA_API_KEY`. It leaves the user guessing where to sign up.
3. **Discord Integration**: Explaining how to create a Discord webhook (Server Settings ➔ Integrations ➔ Webhooks) is missing. The user might not know where to get `DISCORD_WEBHOOK_URL`.
4. **Google Cloud / Sheets Configuration**: The hardest part for beginners. It needs a mini-guide explaining how to:
    - Create a Google Cloud Project & enable Google Sheets API.
    - Create a Service Account and download its JSON keys.
    - Convert that raw JSON into `GOOGLE_SERVICE_KEY_BASE64` (e.g., using `base64 credentials.json > b64.txt` on macOS or `certutil` on Windows).
    - Extract the `client_email` from the JSON to share the actual Google Sheet with that email.
5. **Google Sheet Structure**: Fails to explain the exact columns the Google Sheet requires on `Sheet1` (e.g., Col A = Date, Col B = ID, Col C = Title, etc.). Because it reads from `A:K`, the sheet structure needs to be strictly defined.
6. **Data Profile Setup**: The scout script looks for `data/profile.json` (for keywords, salary, cities), but there are no instructions on how the user creates or formats this file matching their own requirements.
7. **Basic Authentication**: No explanation on how to pass `ADMIN_USER` and `ADMIN_PASS` in `.env.local` (e.g., are they plaintext passwords or hashed?).
8. **Automated Workflows (Cron)**: Missing instructions on how to actually set up GitHub Actions secrets. Mentions "Reply Tracker" but there is no such tracker code implemented in standard setups.