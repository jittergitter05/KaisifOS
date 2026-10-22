import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { isAuthorizedRequest } from '@/lib/auth';
import { isCloudSheetsConfigured, getPublicStats } from '@/lib/sheets';
import { getCandidateProfile } from '@/lib/profile';

export const dynamic = 'force-dynamic';

export async function GET() {
  const cookieStore = cookies();
  const authCookie = cookieStore.get('kaisifos_auth')?.value;
  const lockedCookie = cookieStore.get('kaisifos_locked')?.value;
  if (!(await isAuthorizedRequest(authCookie, lockedCookie))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const stats = await getPublicStats();
  const profile = getCandidateProfile();

  const envChecks = [
    {
      name: 'GEMINI_API_KEY',
      category: 'Free AI Scoring & PDF Parser (Tier 1)',
      description: 'Google Gemini 2.5 Flash free tier for multimodal PDF resume extraction & 4-pillar scoring',
      required: false,
      configured: Boolean(process.env.GEMINI_API_KEY),
      fallback: 'Groq Llama 3.3 70B → OpenRouter Free → Deterministic 4-Pillar Engine',
    },
    {
      name: 'GROQ_API_KEY',
      category: 'Free AI Scoring Chain (Tier 2)',
      description: 'Groq Cloud free tier (llama-3.3-70b-versatile) replacing deprecated paid xAI Grok',
      required: false,
      configured: Boolean(process.env.GROQ_API_KEY && !process.env.GROQ_API_KEY.startsWith('xai-')),
      fallback: 'OpenRouter Free Models / Deterministic 4-Pillar Rubric v3.0',
    },
    {
      name: 'OPENROUTER_API_KEY',
      category: 'Free AI Scoring Chain (Tier 3)',
      description: 'OpenRouter free-tier model router (meta-llama/llama-3.3-70b-instruct:free)',
      required: false,
      configured: Boolean(process.env.OPENROUTER_API_KEY),
      fallback: 'Deterministic 4-Pillar Rubric v3.0 (Always-On)',
    },
    {
      name: 'FREEHIRE_API_URL',
      category: 'Direct-ATS Job Scouting',
      description: 'Optional self-hosted strelov1/freehire endpoint alongside built-in Greenhouse/Lever/Ashby scrapers',
      required: false,
      configured: Boolean(process.env.FREEHIRE_API_URL),
      fallback: 'Built-in Direct-ATS JSON Scrapers (Greenhouse + Lever + Ashby + Arbeitnow)',
    },
    {
      name: 'GOOGLE_SERVICE_KEY_BASE64',
      category: 'Persistence & Gmail Protocol',
      description: 'Base64-encoded Google Cloud Service Account JSON for Sheets v4 & Gmail API',
      required: true,
      configured: Boolean(process.env.GOOGLE_SERVICE_KEY_BASE64),
      fallback: 'Local JSON Store (data/jobs-store.json)',
    },
    {
      name: 'GOOGLE_SHEET_ID',
      category: 'Persistence & Gmail Protocol',
      description: 'Primary Google Spreadsheet ID (Sheet1 + SeenJobs deduplication ledger)',
      required: true,
      configured: Boolean(process.env.GOOGLE_SHEET_ID),
      fallback: 'Local JSON Store (data/jobs-store.json)',
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
      name: 'GMAIL_USER_EMAIL',
      category: 'Persistence & Gmail Protocol',
      description: 'Target inbox monitored by scripts/reply-tracker.js for recruiter responses',
      required: false,
      configured: Boolean(process.env.GMAIL_USER_EMAIL),
      fallback: `Active profile email (${profile.email})`,
    },
  ];

  const auditFindings = [
    {
      id: 'UPGRADE-01',
      layer: 'Free Multi-LLM Fallback Chain (Replaced Paid xAI Grok)',
      before: 'Relied on paid xAI Grok (api.x.ai / grok-4.5) which removed free tier access.',
      after: 'Cascades across Gemini 2.5 Flash (Free) → Groq Llama 3.3 70B (Free) → OpenRouter (:free) → Deterministic 4-Pillar Rubric Engine.',
      status: 'RESOLVED',
    },
    {
      id: 'UPGRADE-02',
      layer: 'strelov1/freehire Direct-ATS & Dynamic Scraping',
      before: 'Hardcoded Internshala & RemoteOK role arrays ignored candidate profile changes.',
      after: '100% profile-driven query derivation + direct public JSON scraping for Greenhouse, Lever, Ashby (inspired by strelov1/freehire) + Arbeitnow, RemoteOK & Remotive.',
      status: 'RESOLVED',
    },
    {
      id: 'UPGRADE-03',
      layer: 'Multi-Source Resume/CV Parser (PDF, Google Drive, Text)',
      before: 'Manual field-by-field JSON editing required to calibrate candidate roles, skills, and metrics.',
      after: 'Two-stage AST + multimodal PDF & Google Drive/Docs link parser with interactive Before/After Diff & Selective Merge inspector.',
      status: 'RESOLVED',
    },
    {
      id: 'UPGRADE-04',
      layer: '4-Tab Analytics & 4-Pillar Rubric Audit Drawer',
      before: 'Single area chart and opaque composite score with no subscore visibility.',
      after: '4-mode Recharts telemetry (Score Trend, Conversion Funnel, Source/ATS Yield, 4-Pillar Breakdown) + slide-over 4-Pillar Score Audit Drawer per job.',
      status: 'RESOLVED',
    },
  ];

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    storageMode: isCloudSheetsConfigured() ? 'cloud-sheets' : 'local-store',
    aiEngine: process.env.GEMINI_API_KEY
      ? 'Gemini 2.5 Flash (Free Tier)'
      : process.env.GROQ_API_KEY && !process.env.GROQ_API_KEY.startsWith('xai-')
      ? 'Groq Llama 3.3 70B (Free Tier)'
      : process.env.OPENROUTER_API_KEY
      ? 'OpenRouter Llama 3.3 70B (:free)'
      : 'Deterministic 4-Pillar Rubric v3.0',
    stats,
    envChecks,
    auditFindings,
  });
}
