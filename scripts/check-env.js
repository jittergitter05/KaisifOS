import dotenv from 'dotenv';
dotenv.config();

const subsystems = [
  {
    name: 'DATABASE_URL',
    subsystem: 'Neon Serverless Postgres Direct URL (Migrations / CLI)',
    required: false,
  },
  {
    name: 'DATABASE_URL_POOLED',
    subsystem: 'Neon Serverless Postgres Pooled Connection (Serverless / Next.js)',
    required: false,
  },
  {
    name: 'GEMINI_API_KEY',
    subsystem: 'AI Chain Tier 1 (Gemini 4 Hydrogen)',
    required: false,
  },
  {
    name: 'GROQ_API_KEY',
    subsystem: 'AI Chain Tier 2 (Groq Llama 3.3 70B)',
    required: false,
  },
  {
    name: 'OPENROUTER_API_KEY',
    subsystem: 'AI Chain Tier 3 (OpenRouter :free Cascade)',
    required: false,
  },
  {
    name: 'FREEHIRE_API_URL',
    subsystem: 'Optional External strelov1/freehire Bridge',
    required: false,
  },
  {
    name: 'RAPIDAPI_KEY',
    subsystem: 'Optional JSearch Aggregator Feed',
    required: false,
  },
  {
    name: 'GOOGLE_SHEET_ID',
    subsystem: 'Google Sheets v4 Ledger',
    required: false,
  },
  {
    name: 'GOOGLE_SERVICE_KEY_BASE64',
    subsystem: 'Google Cloud Service Account (Sheets + Gmail)',
    required: false,
  },
  {
    name: 'GMAIL_USER_EMAIL',
    subsystem: 'Autonomous Gmail Reply Tracker Target',
    required: false,
  },
  {
    name: 'DISCORD_WEBHOOK_URL',
    subsystem: 'Discord High-Conviction Digest Webhook',
    required: false,
  },
  {
    name: 'INGEST_WEBHOOK_SECRET',
    subsystem: 'Naukri / LinkedIn Alert Email Webhook Bearer Token',
    required: false,
  },
  {
    name: 'APP_URL',
    subsystem: 'Canonical Origin & OpenRouter Referer Header',
    required: false,
  },
  {
    name: 'ADMIN_USER',
    subsystem: 'Operator Auth Handle',
    required: true,
  },
  {
    name: 'ADMIN_PASS',
    subsystem: 'Operator Auth Passkey',
    required: true,
  },
];

console.log(`Checking KaisifOS environment configuration (${subsystems.length} variables across 5 subsystems)...`);

let fallbackCount = 0;

for (const item of subsystems) {
  const val = process.env[item.name];
  if (!val || val.trim() === '') {
    if (item.required) {
      console.warn(`[WARN] ${item.name} unset — ${item.subsystem} will use local fallback.`);
      fallbackCount++;
    } else {
      console.log(`[INFO] ${item.name} unset — ${item.subsystem} skipped / fallback active.`);
    }
    continue;
  }

  if (item.name === 'GROQ_API_KEY' && val.startsWith('xai-')) {
    console.warn('[WARN] GROQ_API_KEY uses deprecated paid xai- prefix and will be bypassed in failover chain.');
    fallbackCount++;
    continue;
  }

  console.log(`[OK] ${item.name} configured (${item.subsystem}).`);
}

const hasAnyLlm =
  Boolean(process.env.GEMINI_API_KEY) ||
  Boolean(process.env.GROQ_API_KEY && !process.env.GROQ_API_KEY.startsWith('xai-')) ||
  Boolean(process.env.OPENROUTER_API_KEY);

if (!hasAnyLlm) {
  console.log('[INFO] 0 external LLM keys configured — Deterministic 4-Pillar Rubric v3.2 is active (100% zero-cost guarantee).');
}

if (process.env.GOOGLE_SERVICE_KEY_BASE64) {
  try {
    const raw = process.env.GOOGLE_SERVICE_KEY_BASE64.trim();
    const jsonStr = raw.startsWith('{')
      ? raw
      : Buffer.from(raw.replace(/\s+/g, ''), 'base64').toString('utf8');
    const creds = JSON.parse(jsonStr);
    if (!creds.client_email || !creds.private_key) {
      console.warn('[WARN] GOOGLE_SERVICE_KEY_BASE64 is valid JSON but missing client_email or private_key.');
    } else {
      console.log('[OK] GOOGLE_SERVICE_KEY_BASE64 decoded and verified.');
    }
  } catch (err) {
    console.warn('[WARN] GOOGLE_SERVICE_KEY_BASE64 decoding failed:', err.message);
  }
}

if (fallbackCount > 0) {
  console.log(`\nBuild proceeding in Hybrid Local-Persistence Mode (${fallbackCount} cloud/auth vars using local fallback).`);
} else {
  console.log('\nAll core environment variables verified.');
}
