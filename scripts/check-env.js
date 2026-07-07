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
  'APP_URL',
  'RAPIDAPI_KEY',
  'DISCORD_WEBHOOK_URL',
  'GMAIL_USER_EMAIL',
];

console.log('🔍 Checking environment configuration...');

let missingRequired = false;

required.forEach(v => {
  if (!process.env[v]) {
    console.error(`❌ Missing REQUIRED variable: ${v}`);
    missingRequired = true;
  } else {
    console.log(`✅ ${v} is set.`);
  }
});

optional.forEach(v => {
  if (!process.env[v]) {
    console.warn(`⚠️  Missing OPTIONAL variable: ${v}`);
  } else {
    console.log(`✅ ${v} is set.`);
  }
});

// Check if GOOGLE_SERVICE_KEY_BASE64 is valid base64 JSON
if (process.env.GOOGLE_SERVICE_KEY_BASE64) {
  try {
    const jsonStr = Buffer.from(process.env.GOOGLE_SERVICE_KEY_BASE64, 'base64').toString('utf8');
    const creds = JSON.parse(jsonStr);
    if (!creds.client_email || !creds.private_key) {
      console.error('❌ GOOGLE_SERVICE_KEY_BASE64 is valid JSON but missing client_email or private_key.');
      missingRequired = true;
    } else {
      console.log('✅ GOOGLE_SERVICE_KEY_BASE64 successfully decoded and validated.');
    }
  } catch (err) {
    console.error('❌ GOOGLE_SERVICE_KEY_BASE64 decoding or JSON parsing failed:', err.message);
    missingRequired = true;
  }
}

if (missingRequired) {
  console.error('\n🛑 Environment checks failed. Please fix the required variables before proceeding.');
  process.exit(1);
} else {
  console.log('\n✨ Environment configuration looks good!');
}
