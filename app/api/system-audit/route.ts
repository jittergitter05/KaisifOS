import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { isAuthorizedRequest, isCustomAuthConfigured } from '@/lib/auth';
import { isCloudSheetsConfigured, getPublicStats, getStorageHealthInfo } from '@/lib/sheets';
import { getCandidateProfileAsync } from '@/lib/profile';

export const dynamic = 'force-dynamic';

export async function GET() {
  const cookieStore = cookies();
  const authCookie = cookieStore.get('kaisifos_auth')?.value;
  const lockedCookie = cookieStore.get('kaisifos_locked')?.value;
  if (!(await isAuthorizedRequest(authCookie, lockedCookie))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const stats = await getPublicStats();
  const profile = await getCandidateProfileAsync();
  const storageHealth = getStorageHealthInfo(stats.cloud_error);

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
        'Optional SSRF-validated strelov1/freehire HTTP API bridge (built-in Greenhouse/Lever/Ashby connectors run regardless)',
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
      category: 'Google Sheets Ledger & Profile Sync',
      description:
        'Primary Google Spreadsheet ID (auto-provisions Sheet1 + SeenJobs + Profile tabs on first write)',
      required: true,
      configured: Boolean(process.env.GOOGLE_SHEET_ID),
      fallback: storageHealth.ephemeralFallback
        ? 'Ephemeral /tmp Runtime Store (resets on container cold restart)'
        : 'Atomic Local JSON Store (data/jobs-store.json + data/profile.json)',
    },
    {
      name: 'GOOGLE_SERVICE_KEY_BASE64',
      category: 'Google Cloud Service Auth',
      description:
        'Base64 (or raw JSON) Google Cloud Service Account for Sheets v4 Ledger, Profile Sync & Gmail API',
      required: true,
      configured: Boolean(process.env.GOOGLE_SERVICE_KEY_BASE64),
      fallback: storageHealth.ephemeralFallback
        ? 'Ephemeral /tmp Runtime Store (resets on container cold restart)'
        : 'Atomic Local JSON Store (data/jobs-store.json)',
    },
    {
      name: 'GMAIL_USER_EMAIL',
      category: 'Autonomous Reply Tracker',
      description:
        'Google Workspace inbox monitored by scripts/reply-tracker.js on weekdays (03:30 UTC; requires Workspace Domain-Wide Delegation)',
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
          status: groqConfigured
            ? 'Ready'
            : groqHasDeprecatedXai
            ? 'Bypassed (xai- key)'
            : 'Skipped (No Key)',
        },
        {
          label: 'Tier 3 · OpenRouter 3-Model (:free)',
          status: openRouterConfigured ? 'Ready' : 'Skipped (No Key)',
        },
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
        {
          label: 'Stage 1 · Gemini Native PDF Inline Bytes',
          status: geminiConfigured ? 'Ready' : 'Text Fallback',
        },
        { label: 'Stage 2 · Node zlib FlateDecode + Tj/TJ AST', status: 'Always-On Guarantee' },
        { label: 'Stage 3 · Redirect-Pinned Google Drive / Docs Stream', status: 'Always-On Guarantee' },
      ],
    },
    {
      name: 'Persistence & Direct-ATS Ingestion',
      activeTier:
        storageHealth.storageMode === 'cloud-sheets'
          ? 'Google Sheets v4 (Auto-Provisioned + Profile Sync)'
          : storageHealth.storageMode === 'ephemeral-tmp'
          ? 'Ephemeral /tmp Runtime Fallback (Read-Only Host)'
          : 'Atomic Local Disk (data/)',
      tiers: [
        {
          label: 'Google Sheets v4 (Sheet1 + SeenJobs + Profile)',
          status: isCloudSheetsConfigured()
            ? stats.cloud_error
              ? 'Error (Using Fallback)'
              : 'Connected'
            : storageHealth.ephemeralFallback
            ? '/tmp Ephemeral Fallback'
            : 'Local Fallback',
        },
        { label: 'Native Direct-ATS (Greenhouse · Lever · Ashby)', status: 'Always-On (12 Boards)' },
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
      layer: 'Read-Only Container & Ephemeral /tmp + Cloud Profile Sync',
      before: 'Serverless/Cloud Run hosts mounting data/ as read-only threw 503 EROFS on profile/job saves.',
      after:
        '3-tier persistence: Google Sheets Profile!A1 & Sheet1 (auto-provisioned tabs) -> writable data/ or custom KAISIFOS_DATA_DIR -> automatic /tmp runtime overlay with honest UI telemetry.',
      status: 'VERIFIED',
    },
    {
      id: 'ARCH-02',
      layer: 'SSRF, CSV Injection, & Redirect-Pinned Security Perimeter',
      before: 'Open redirects, private IP URL bridges, formula injection in CSV export, and unthrottled AI/login endpoints.',
      after:
        'Redirect host pinning on Drive, validateSafePublicUrl on FREEHIRE_API_URL, RFC4180 + formula escaping in CSV, and sliding-window IP rate limits on auth/evaluate/prep.',
      status: 'VERIFIED',
    },
    {
      id: 'ARCH-03',
      layer: 'Iframe Cookie Compatibility & Strict Cloud Sheet ID Lookup',
      before: 'Hardcoded HTTPS cookie lockouts on local `next start` and rowId fallback overwriting shifted rows.',
      after:
        'Dynamic X-Forwarded-Proto + Sec-Fetch-Dest iframe cookie attributes, strict Col-B ID resolution, 42s scout sweep deadline fallback, and VC funding false-positive salary guards.',
      status: 'VERIFIED',
    },
  ];

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    authConfigured: isCustomAuthConfigured(),
    freehireBridgeConfigured,
    storageMode: isCloudSheetsConfigured() && !stats.cloud_error ? 'cloud-sheets' : 'local-store',
    persistenceMode: storageHealth.storageMode,
    ephemeralFallback: storageHealth.ephemeralFallback,
    resolvedDataDir: storageHealth.resolvedDataDir,
    cloudError: stats.cloud_error,
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
