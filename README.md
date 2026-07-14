# OpenScout OS

An autonomous, AI-driven job searching agent. It scouts, evaluates, and tracks roles programmatically without manual intervention.

## Core Features
1. **Scout:** Fetches daily roles based on your `data/profile.json` from multiple job boards (Remotive, RemoteOK, Internshala, JSearch).
2. **Score:** Uses AI (Gemini/Groq/Grok) to grade the fit of each job against your profile and draft outreach messages.
3. **Track:** Stores high-scoring matches in a Google Sheet and sends notifications via Discord.
4. **Act:** Uses the Gmail API to monitor email threads and replies for tracked applications.

## Quick Start Setup

### 1. Configuration
Modify `config/site.ts` and `data/profile.json` to reflect your target roles, cities, experience, and contact details.

### 2. Environment Variables
Copy `.env.example` to `.env` and fill in the required keys:
- `GOOGLE_SERVICE_KEY_BASE64`: Base64 encoded Google Service Account JSON.
- `GOOGLE_SHEET_ID`: The ID of your Google Sheet.
- `GEMINI_API_KEY`, `GROQ_API_KEY`: Keys for the AI scoring engine.
- `DISCORD_WEBHOOK_URL`: Discord webhook for daily digests.
- `ADMIN_USER`, `ADMIN_PASS`: Secure credentials for the dashboard.

### 3. Deploy
This project is built with Next.js and designed to be deployed on Vercel. 
Background tasks (`scout.js`, `reply-tracker.js`) run via GitHub Actions.

## Security
The `/admin` dashboard is protected by an HMAC-signed cookie authentication system. 
Ensure your `ADMIN_USER` and `ADMIN_PASS` are strong.

## Contributing
Fork the repository and make it your own!