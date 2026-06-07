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