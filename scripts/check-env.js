import dotenv from 'dotenv';
dotenv.config();

const required = [
  'GROQ_API_KEY',
  'GOOGLE_SHEET_ID',
  'GOOGLE_SERVICE_KEY_BASE64',
  'ADMIN_USER',
  'ADMIN_PASS',
];

const optional = [
  'GEMINI_API_KEY',
  'APP_URL',
  'RAPIDAPI_KEY',
  'DISCORD_WEBHOOK_URL',
  'GMAIL_USER_EMAIL',
];

console.log('Checking KaisifOS environment configuration...');

let missingCount = 0;

required.forEach(v => {
  if (!process.env[v]) {
    console.warn(`[WARN] Variable not set in environment: ${v} (Local fallback store & default operator auth will be used)`);
    missingCount++;
  } else {
    console.log(`[OK] ${v} is configured.`);
  }
});

optional.forEach(v => {
  if (!process.env[v]) {
    console.log(`[INFO] Optional variable not set: ${v}`);
  } else {
    console.log(`[OK] ${v} is configured.`);
  }
});

if (process.env.GOOGLE_SERVICE_KEY_BASE64) {
  try {
    const jsonStr = Buffer.from(process.env.GOOGLE_SERVICE_KEY_BASE64, 'base64').toString('utf8');
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

if (missingCount > 0) {
  console.log(`\nBuild proceeding in Hybrid Local-Persistence Mode (${missingCount} cloud env vars unset).`);
} else {
  console.log('\nAll cloud environment variables verified.');
}
