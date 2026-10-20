import { NextResponse } from 'next/server';
import { isCloudSheetsConfigured, getPublicStats } from '@/lib/sheets';
import { getCandidateProfile } from '@/lib/profile';

export async function GET() {
  const stats = await getPublicStats();
  const profile = getCandidateProfile();

  const envChecks = [
    {
      name: 'GEMINI_API_KEY',
      category: 'AI Scoring Engine',
      description: 'Server-side Gemini 2.5 Flash structured job evaluation & DM synthesis',
      required: false,
      configured: Boolean(process.env.GEMINI_API_KEY),
      fallback: 'Deterministic Multi-Vector Rubric v2.5 / Groq',
    },
    {
      name: 'GROQ_API_KEY',
      category: 'AI Scoring Engine',
      description: 'Groq Llama 3.3 70B / xAI Grok batch scoring key for GitHub Actions scout runner',
      required: true,
      configured: Boolean(process.env.GROQ_API_KEY),
      fallback: 'Gemini 2.5 Flash / Local Heuristic Scorer',
    },
    {
      name: 'GOOGLE_SERVICE_KEY_BASE64',
      category: 'Persistence & Gmail',
      description: 'Base64-encoded Google Cloud Service Account JSON for Sheets & Gmail API',
      required: true,
      configured: Boolean(process.env.GOOGLE_SERVICE_KEY_BASE64),
      fallback: 'Local JSON Store (data/jobs-store.json)',
    },
    {
      name: 'GOOGLE_SHEET_ID',
      category: 'Persistence & Gmail',
      description: 'Primary Google Spreadsheet ID (Sheet1 + SeenJobs deduplication ledger)',
      required: true,
      configured: Boolean(process.env.GOOGLE_SHEET_ID),
      fallback: 'Local JSON Store (data/jobs-store.json)',
    },
    {
      name: 'ADMIN_USER',
      category: 'Security & Auth',
      description: 'Operator handle for HMAC-SHA256 Edge session signing',
      required: false,
      configured: Boolean(process.env.ADMIN_USER),
      fallback: 'Open Fork Mode ("operator")',
    },
    {
      name: 'ADMIN_PASS',
      category: 'Security & Auth',
      description: 'Workspace passkey for Web Crypto HMAC-SHA256 token verification',
      required: false,
      configured: Boolean(process.env.ADMIN_PASS),
      fallback: 'Non-breached passkey ("ksf-op-9x7v2q-local")',
    },
    {
      name: 'DISCORD_WEBHOOK_URL',
      category: 'Notifications',
      description: 'Discord webhook for daily 08:00 UTC high-match digests & Gmail reply alerts',
      required: false,
      configured: Boolean(process.env.DISCORD_WEBHOOK_URL),
      fallback: 'In-app Scout Digest (/admin/digest)',
    },
    {
      name: 'RAPIDAPI_KEY',
      category: 'Scout Sources',
      description: 'JSearch API key for global & India entry-level role aggregation',
      required: false,
      configured: Boolean(process.env.RAPIDAPI_KEY),
      fallback: 'Internshala + RemoteOK + Remotive (Free APIs)',
    },
    {
      name: 'GMAIL_USER_EMAIL',
      category: 'Persistence & Gmail',
      description: 'Target inbox monitored by scripts/reply-tracker.js for recruiter responses',
      required: false,
      configured: Boolean(process.env.GMAIL_USER_EMAIL),
      fallback: `Active profile email (${profile.email})`,
    },
  ];

  const auditFindings = [
    {
      id: 'AUDIT-01',
      layer: 'Build & Packfile Cache Safeguard',
      before: 'Next.js .next/cache webpack packfile deadlocks on cloud rebuilds and process.exit(1) crashes when cloud secrets are omitted.',
      after: 'Disabled webpack disk packfile cache in next.config.mjs + automated rm -rf .next/cache pre-build purge + hybrid JSON failover.',
      status: 'RESOLVED',
    },
    {
      id: 'AUDIT-02',
      layer: 'Browser-Safe Fork Authentication',
      before: 'Default "admin/secret" password triggered Chrome Password Breach blocks and third-party cookie drops in iframes.',
      after: 'Zero-friction Open Fork Mode when custom .env lock is unset + non-breached cryptographic passkey (ksf-op-9x7v2q-local).',
      status: 'RESOLVED',
    },
    {
      id: 'AUDIT-03',
      layer: 'White-Label Profile & Brand Ownership',
      before: 'Public workbench and evaluator hardcoded the creator’s name and metrics, preventing fork users from owning the platform.',
      after: '100% profile-driven identity & system_name branding with 1-click Persona Switcher and live ownership customizer.',
      status: 'RESOLVED',
    },
    {
      id: 'AUDIT-04',
      layer: 'Dual Theme & Clean Navigation Hierarchy',
      before: 'Hardcoded dark-only hex colors and redundant navigation buttons duplicated across the top bar and footer.',
      after: 'Full Dark & Light Executive Themes (ThemeToggle) and non-redundant telemetry footer.',
      status: 'RESOLVED',
    },
  ];

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    storageMode: isCloudSheetsConfigured() ? 'cloud-sheets' : 'local-store',
    aiEngine: process.env.GEMINI_API_KEY
      ? 'Gemini 2.5 Flash'
      : process.env.GROQ_API_KEY
      ? 'Groq Llama 3.3 70B'
      : 'Deterministic Multi-Vector Rubric v2.5',
    stats,
    envChecks,
    auditFindings,
  });
}
