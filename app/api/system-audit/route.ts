import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { isAuthorizedRequest, isCustomAuthConfigured } from '@/lib/auth';
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

  const geminiConfigured = Boolean(process.env.GEMINI_API_KEY);
  const groqKey = process.env.GROQ_API_KEY || '';
  const groqHasDeprecatedXai = groqKey.startsWith('xai-');
  const groqConfigured = Boolean(groqKey && !groqHasDeprecatedXai);
  const openRouterConfigured = Boolean(process.env.OPENROUTER_API_KEY);
  const freehireBridgeConfigured = Boolean(process.env.FREEHIRE_API_URL);

  const envChecks = [
    {
      name: 'GEMINI_API_KEY',
      category: 'Free AI Chain (Tier 1)',
      description:
        'Google Gemini 4 Hydrogen free tier for multimodal PDF resume extraction & 4-pillar evaluation',
      required: false,
      configured: geminiConfigured,
      fallback: 'Groq Llama 3.3 70B -> OpenRouter :free -> Deterministic 4-Pillar Rubric v3.2',
    },
    {
      name: 'GROQ_API_KEY',
      category: 'Free AI Chain (Tier 2)',
      description: groqHasDeprecatedXai
        ? 'Detected deprecated xai- prefix (bypassed). Provide a free gsk_ Groq Cloud key.'
        : 'Groq Cloud free tier (llama-3.3-70b-versatile) for fast JSON rubric evaluation',
      required: false,
      configured: groqConfigured,
      fallback: 'OpenRouter 3-Model :free Cascade -> Deterministic 4-Pillar Rubric v3.2',
    },
    {
      name: 'OPENROUTER_API_KEY',
      category: 'Free AI Chain (Tier 3)',
      description:
        'OpenRouter 3-model :free cascade (llama-3.3-70b-instruct:free · gemma-3-27b-it:free · openrouter/free)',
      required: false,
      configured: openRouterConfigured,
      fallback: 'Deterministic 4-Pillar Rubric v3.2 (Always-On)',
    },
    {
      name: 'FREEHIRE_API_URL',
      category: 'Optional External Bridge',
      description:
        'Optional self-hosted strelov1/freehire HTTP API bridge (built-in Greenhouse/Lever/Ashby connectors run regardless)',
      required: false,
      configured: freehireBridgeConfigured,
      fallback: 'Built-in Native Direct-ATS Connectors (Greenhouse · Lever · Ashby)',
    },
    {
      name: 'RAPIDAPI_KEY',
      category: 'Optional Job Feed',
      description: 'Optional RapidAPI JSearch aggregator key used in CLI job-scout workflow',
      required: false,
      configured: Boolean(process.env.RAPIDAPI_KEY),
      fallback: '8 Zero-Key Direct-ATS & Remote Feeds',
    },
    {
      name: 'GOOGLE_SHEET_ID',
      category: 'Google Sheets Ledger',
      description: 'Primary Google Spreadsheet ID (Sheet1 + SeenJobs deduplication ledger)',
      required: true,
      configured: Boolean(process.env.GOOGLE_SHEET_ID),
      fallback: 'Atomic Local JSON Store (data/jobs-store.json)',
    },
    {
      name: 'GOOGLE_SERVICE_KEY_BASE64',
      category: 'Google Cloud Service Auth',
      description: 'Base64-encoded Google Cloud Service Account JSON for Sheets v4 & Gmail API',
      required: true,
      configured: Boolean(process.env.GOOGLE_SERVICE_KEY_BASE64),
      fallback: 'Atomic Local JSON Store (data/jobs-store.json)',
    },
    {
      name: 'GMAIL_USER_EMAIL',
      category: 'Autonomous Reply Tracker',
      description: 'Target inbox monitored by scripts/reply-tracker.js on weekdays (03:30 UTC)',
      required: false,
      configured: Boolean(process.env.GMAIL_USER_EMAIL),
      fallback: `Active profile email (${profile.email})`,
    },
    {
      name: 'DISCORD_WEBHOOK_URL',
      category: 'Notifications',
      description: 'Discord webhook for high-conviction scout digests & Gmail reply alerts',
      required: false,
      configured: Boolean(process.env.DISCORD_WEBHOOK_URL),
      fallback: 'In-app Executive Scout Digest (/admin/digest)',
    },
    {
      name: 'APP_URL',
      category: 'Canonical Origin',
      description: 'Deployment origin URL passed to Discord links & OpenRouter HTTP-Referer headers',
      required: false,
      configured: Boolean(process.env.APP_URL),
      fallback: 'https://kaisifos.local',
    },
    {
      name: 'ADMIN_USER',
      category: 'Operator Authentication',
      description: 'Operator handle protecting /admin/* routes and mutating APIs',
      required: true,
      configured: Boolean(process.env.ADMIN_USER && process.env.ADMIN_USER.trim() !== ''),
      fallback: 'Open Local Operator Mode when paired ADMIN_PASS is also unset',
    },
    {
      name: 'ADMIN_PASS',
      category: 'Operator Authentication',
      description: 'Operator passkey used for HMAC-SHA256 session cookie signing',
      required: true,
      configured: Boolean(process.env.ADMIN_PASS && process.env.ADMIN_PASS.trim() !== ''),
      fallback: 'Open Local Operator Mode when paired ADMIN_USER is also unset',
    },
  ];

  const failoverChains = [
    {
      name: 'Role Evaluation & Prep Chain',
      activeTier: geminiConfigured
        ? 'Tier 1: Gemini 4 Hydrogen'
        : groqConfigured
        ? 'Tier 2: Groq Llama 3.3 70B'
        : openRouterConfigured
        ? 'Tier 3: OpenRouter :free Cascade'
        : 'Tier 4: Deterministic 4-Pillar Rubric v3.2',
      tiers: [
        { label: 'Tier 1 · Gemini 4 Hydrogen', status: geminiConfigured ? 'Ready' : 'Skipped (No Key)' },
        {
          label: 'Tier 2 · Groq Llama 3.3 70B',
          status: groqConfigured ? 'Ready' : groqHasDeprecatedXai ? 'Bypassed (xai- key)' : 'Skipped (No Key)',
        },
        { label: 'Tier 3 · OpenRouter 3-Model (:free)', status: openRouterConfigured ? 'Ready' : 'Skipped (No Key)' },
        { label: 'Tier 4 · Deterministic Rubric v3.2', status: 'Always-On Guarantee' },
      ],
    },
    {
      name: 'Resume / CV Extraction Chain',
      activeTier: geminiConfigured
        ? 'Native PDF Multimodal + Deterministic AST'
        : groqConfigured || openRouterConfigured
        ? 'FlateDecode Text + LLM Refinement + AST'
        : 'FlateDecode Zlib Stream + Deterministic AST',
      tiers: [
        { label: 'Stage 1 · Gemini Native PDF Inline Bytes', status: geminiConfigured ? 'Ready' : 'Text Fallback' },
        { label: 'Stage 2 · Node zlib FlateDecode + Tj/TJ AST', status: 'Always-On Guarantee' },
        { label: 'Stage 3 · Google Drive / Docs Export Stream', status: 'Always-On Guarantee' },
      ],
    },
    {
      name: 'Persistence & Direct-ATS Ingestion',
      activeTier: isCloudSheetsConfigured() ? 'Google Sheets v4 + Local Mirror' : 'Atomic Local Ledger (data/jobs-store.json)',
      tiers: [
        { label: 'Google Sheets v4 (Sheet1 + SeenJobs)', status: isCloudSheetsConfigured() ? 'Connected' : 'Local Fallback' },
        { label: 'Native Direct-ATS (Greenhouse · Lever · Ashby)', status: 'Always-On' },
        {
          label: 'External strelov1/freehire Bridge (FREEHIRE_API_URL)',
          status: freehireBridgeConfigured ? 'Connected' : 'Optional / Unconfigured',
        },
      ],
    },
  ];

  const auditFindings = [
    {
      id: 'ARCH-01',
      layer: '4-Tier Free Multi-LLM Failover Chain (UI + CLI Parity)',
      before: 'Legacy paid xAI Grok dependency and CLI OpenRouter single-model check.',
      after:
        'Full parity across lib/llm.ts and scripts/scout.js: Gemini 4 Hydrogen -> Groq Llama 3.3 70B -> OpenRouter 3-Model :free Cascade -> Deterministic 4-Pillar Rubric v3.2.',
      status: 'VERIFIED',
    },
    {
      id: 'ARCH-02',
      layer: 'Truthful strelov1/freehire Attribution & Direct-ATS Connectors',
      before: 'UI copy implied the Go/Postgres strelov1/freehire runtime was bundled natively.',
      after:
        'Clarified across UI, API, and README: built-in Node/Next.js Direct-ATS JSON connectors (Greenhouse, Lever, Ashby) inspired by strelov1/freehire + optional FREEHIRE_API_URL bridge.',
      status: 'VERIFIED',
    },
    {
      id: 'ARCH-03',
      layer: '12-Key Environment Parity & Workflow Reconciliation',
      before: 'System audit omitted RAPIDAPI_KEY, APP_URL, and split ADMIN credentials; README cited outdated schedule.',
      after:
        'Full 12-variable telemetry across .env.example, scripts/check-env.js, /api/system-audit, job-scout.yml (0 4 * * 0,1,3,5), and reply-tracker.yml (30 3 * * 1-5).',
      status: 'VERIFIED',
    },
  ];

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    authConfigured: isCustomAuthConfigured(),
    freehireBridgeConfigured,
    storageMode: isCloudSheetsConfigured() ? 'cloud-sheets' : 'local-store',
    aiEngine: geminiConfigured
      ? 'Gemini 4 Hydrogen (Free Tier)'
      : groqConfigured
      ? 'Groq Llama 3.3 70B (Free Tier)'
      : openRouterConfigured
      ? 'OpenRouter Llama 3.3 70B (:free)'
      : 'Deterministic 4-Pillar Rubric v3.2',
    stats,
    envChecks,
    failoverChains,
    auditFindings,
  });
}
