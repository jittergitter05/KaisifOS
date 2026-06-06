# KaisifOS - Automated Job Hunting Pipeline

A zero-cost, zero-maintenance, serverless job hunting automation system. Everything runs via GitHub Actions and Vercel.

## Features
- **Scout Agent** runs daily at 8AM IST, fetches jobs from Adzuna based on your profile, scores them with Gemini 2.5 Flash, deduplicates, and logs to Google Sheets.
- **Reply Tracker** runs daily at 9AM IST, scans Gmail for replies to companies you applied to, and updates the tracker.
- **Discord Digests** alert you of top matches and detected replies.
- **Vercel UI** provides a clean tracker dashboard, protected with basic authentication.

## Setup Instructions

### 1. Fork & Clone
Fork this repository and clone it to your local machine. Ensure your `data/profile.json` matches your precise candidate profile.

### 2. Get API Keys
You need the following free API keys and credentials:
- **Adzuna API**: Go to [developer.adzuna.com](https://developer.adzuna.com/), sign up for a free account, and get your Application ID and API Key.
- **Gemini API**: Go to [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey) and generate a free API key.
- **Discord Webhook**: In your Discord server -> Channel Settings -> Integrations -> Webhooks -> New Webhook. Copy the Webhook URL.
- **Google Sheets**: Create a Google Sheet. Copy the ID from the URL (`https://docs.google.com/spreadsheets/d/<COPY_THIS_ID>/edit`). Set up headers in Row 1: `Date | Job ID | Title | Company | Score | Match Reasons | Gap | Apply URL | DM Draft | Resume Angle | Status | Reply Date`.
- **Google Service Account**: Setup a project on [Google Cloud Console](https://console.cloud.google.com). Enable "Google Sheets API" and "Gmail API". Navigate to IAM & Admin -> Service Accounts -> Create Service Account. Generate a new JSON key. Base64 encode the entire file (`base64 -i key.json`). Share your Google Sheet to the service account email. Your Gmail should allow API access (you might need domain-wide delegation or simple oauth for personal gmail depending on Workspace).

### 3. Add GitHub Secrets
Go to your forked GitHub Repo -> Settings -> Secrets and variables -> Actions. Add these:
- `GEMINI_API_KEY`
- `ADZUNA_APP_ID`
- `ADZUNA_API_KEY`
- `DISCORD_WEBHOOK_URL`
- `GOOGLE_SHEET_ID`
- `GOOGLE_SERVICE_KEY_BASE64`
- `GMAIL_USER_EMAIL`

### 4. Deploy to Vercel
Push your project to GitHub. Connect the repo to Vercel. Add these exact environment variables in Vercel (Project -> Settings -> Environment Variables):
- `GOOGLE_SHEET_ID`
- `GOOGLE_SERVICE_KEY_BASE64`
- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`

### 5. Manual Testing
To ensure the pipeline works:
- Go to GitHub -> Actions -> 'Job Scout' -> 'Run workflow'.
- Check your Discord channel for the digest.
- Verify your Google Sheet was populated!

### How to Update Profile
Everything runs automatically based on `/data/profile.json`. To modify your criteria or metrics, just edit `profile.json` on the `main` branch. The agents will automatically adapt.
