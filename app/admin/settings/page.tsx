'use client';
import React, { useEffect, useState, useCallback, useMemo } from 'react';
import Link from 'next/link';
import {
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  RefreshCw,
  ShieldCheck,
  Copy,
  Check,
  BookmarkPlus,
  Mail,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { siteConfig } from '@/config/site';
import { copyToClipboardSafe } from '@/lib/utils';

interface EnvCheck {
  name: string;
  category: string;
  description: string;
  required: boolean;
  configured: boolean;
  fallback: string;
}

interface FailoverChain {
  name: string;
  activeTier: string;
  tiers: Array<{ label: string; status: string }>;
}

interface AuditFinding {
  id: string;
  layer: string;
  before: string;
  after: string;
  status: string;
}

interface ReadinessCheck {
  id: string;
  label: string;
  status: 'pass' | 'warn';
  detail: string;
}

interface SystemAuditResponse {
  timestamp: string;
  authConfigured?: boolean;
  neonConfigured?: boolean;
  freehireBridgeConfigured?: boolean;
  ingestWebhookConfigured?: boolean;
  discordConfigured?: boolean;
  llmConfigured?: boolean;
  storageMode: 'neon-postgres' | 'cloud-sheets' | 'local-store';
  persistenceMode?: 'neon-postgres' | 'cloud-sheets' | 'local-disk' | 'ephemeral-tmp' | 'read-only';
  ephemeralFallback?: boolean;
  resolvedDataDir?: string;
  cloudError?: string;
  aiEngine: string;
  readinessChecklist?: ReadinessCheck[];
  envChecks: EnvCheck[];
  failoverChains?: FailoverChain[];
  auditFindings?: AuditFinding[];
}

export default function SettingsPage() {
  const [audit, setAudit] = useState<SystemAuditResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [origin, setOrigin] = useState('');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [profileRaw, setProfileRaw] = useState<Record<string, unknown> | null>(null);
  const [enableInternshala, setEnableInternshala] = useState(false);
  const [togglingInternshala, setTogglingInternshala] = useState(false);
  const [internshalaMsg, setInternshalaMsg] = useState<string | null>(null);

  const fetchAudit = useCallback(() => {
    setLoading(true);
    fetch('/api/system-audit')
      .then((res) => {
        if (res.status === 401) {
          window.location.href = '/login';
          return null;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (data) setAudit(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    setOrigin(window.location.origin);
    fetchAudit();
    fetch('/api/profile')
      .then((r) => (r.ok ? r.json() : null))
      .then((p) => {
        if (p && typeof p === 'object') {
          setProfileRaw(p);
          setEnableInternshala(Boolean(p.enable_internshala));
        }
      })
      .catch(() => {});
  }, [fetchAudit]);

  const webhookUrl = useMemo(
    () => `${origin || 'https://your-app-domain'}/api/ingest/webhook`,
    [origin]
  );

  const replyWebhookUrl = useMemo(
    () => `${origin || 'https://your-app-domain'}/api/ingest/reply`,
    [origin]
  );

  const bookmarkletHref = useMemo(() => {
    const clipEndpoint = `${origin || 'https://your-app-domain'}/admin/clip#payload=`;
    return `javascript:(function(){var h=location.href,t=document.title||'',s=(window.getSelection&&window.getSelection().toString())||'',b=(document.body&&document.body.innerText||'').replace(/\\s+/g,' ').slice(0,5500);var p=JSON.stringify({url:h,title:t.split('|')[0].split(' - ')[0].trim(),description:s||b});window.location.href=${JSON.stringify(clipEndpoint)}+encodeURIComponent(p);})();`;
  }, [origin]);

  const appsScriptSnippet = useMemo(
    () => `// 1. In Gmail, create a filter forwarding Naukri / LinkedIn / Wellfound alerts into label "JobAlerts"
// 2. Open script.google.com -> paste below -> add Script Property INGEST_WEBHOOK_SECRET -> set 15-min trigger
function forwardJobAlertsToKaisifOS() {
  var secret = PropertiesService.getScriptProperties().getProperty('INGEST_WEBHOOK_SECRET');
  if (!secret) throw new Error('Missing INGEST_WEBHOOK_SECRET Script Property');
  var threads = GmailApp.search('label:JobAlerts is:unread', 0, 10);
  threads.forEach(function (thread) {
    thread.getMessages().forEach(function (msg) {
      if (!msg.isUnread()) return;
      var res = UrlFetchApp.fetch('${webhookUrl}', {
        method: 'post',
        contentType: 'application/json',
        headers: { Authorization: 'Bearer ' + secret },
        payload: JSON.stringify({
          from: msg.getFrom(),
          subject: msg.getSubject(),
          textBody: msg.getPlainBody(),
          htmlBody: msg.getBody()
        }),
        muteHttpExceptions: true
      });
      if (res.getResponseCode() >= 200 && res.getResponseCode() < 300) {
        msg.markRead();
      }
    });
  });
}`,
    [webhookUrl]
  );

  const replyTrackerAppsScript = useMemo(
    () => `// Consumer @gmail.com Recruiter Reply Tracker (Zero Google Workspace / Paid DWD Required)
// 1. Open script.google.com -> paste below -> add Script Property INGEST_WEBHOOK_SECRET
// 2. Add a time-driven trigger every 30 minutes (or hourly) for syncRecruiterRepliesToKaisifOS
function syncRecruiterRepliesToKaisifOS() {
  var secret = PropertiesService.getScriptProperties().getProperty('INGEST_WEBHOOK_SECRET');
  if (!secret) throw new Error('Missing INGEST_WEBHOOK_SECRET Script Property');

  var activeRes = UrlFetchApp.fetch('${replyWebhookUrl}', {
    method: 'get',
    headers: { Authorization: 'Bearer ' + secret },
    muteHttpExceptions: true
  });
  if (activeRes.getResponseCode() !== 200) return;
  var activeData = JSON.parse(activeRes.getContentText() || '{}');
  var companies = activeData.companies || [];
  if (!companies.length) return;

  var syncedLabel = GmailApp.getUserLabelByName('KaisifOS-Reply-Synced') || GmailApp.createLabel('KaisifOS-Reply-Synced');
  var queryCompanies = companies.slice(0, 25).map(function (c) { return '"' + c.replace(/"/g, '') + '"'; }).join(' OR ');
  var threads = GmailApp.search('in:inbox newer_than:14d -label:KaisifOS-Reply-Synced (' + queryCompanies + ')', 0, 20);
  if (!threads.length) return;

  var messagesPayload = [];
  var threadMap = [];
  threads.forEach(function (thread) {
    var msgs = thread.getMessages();
    var latest = msgs[msgs.length - 1];
    if (!latest) return;
    messagesPayload.push({
      from: latest.getFrom(),
      subject: latest.getSubject(),
      snippet: (latest.getPlainBody() || '').slice(0, 800),
      body: (latest.getPlainBody() || '').slice(0, 4500),
      date: latest.getDate().toISOString(),
      messageId: latest.getId()
    });
    threadMap.push(thread);
  });

  var postRes = UrlFetchApp.fetch('${replyWebhookUrl}', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + secret },
    payload: JSON.stringify({ messages: messagesPayload }),
    muteHttpExceptions: true
  });

  if (postRes.getResponseCode() >= 200 && postRes.getResponseCode() < 300) {
    threadMap.forEach(function (t) { t.addLabel(syncedLabel); });
  }
}`,
    [replyWebhookUrl]
  );

  const copySnippet = async (key: string, text: string) => {
    const ok = await copyToClipboardSafe(text);
    if (ok) {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1800);
    }
  };

  const toggleInternshala = async () => {
    if (!profileRaw || togglingInternshala) return;
    const nextValue = !enableInternshala;
    setTogglingInternshala(true);
    setInternshalaMsg(null);
    try {
      const res = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...profileRaw, enable_internshala: nextValue }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const updated = await res.json();
      setEnableInternshala(nextValue);
      setProfileRaw(updated?.profile || { ...profileRaw, enable_internshala: nextValue });
      setInternshalaMsg(
        nextValue ? 'Internshala opt-in enabled.' : 'Internshala disabled (high-signal mode).'
      );
      setTimeout(() => setInternshalaMsg(null), 3000);
    } catch {
      setInternshalaMsg('Failed to update Internshala setting.');
    } finally {
      setTogglingInternshala(false);
    }
  };

  return (
    <div className="flex flex-col flex-1 w-full bg-slate-50 dark:bg-[#0B0F17] text-slate-900 dark:text-[#F8FAFC]">
      <div className="flex-1 py-6 px-4 sm:px-6 lg:px-8 max-w-5xl mx-auto w-full pb-24 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-5">
          <div>
            <h1 className="text-2xl font-display font-bold tracking-tight text-slate-900 dark:text-white">
              Environment &amp; Protocol Status
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Server-side audit for all environment variables, 4-tier failover chains, Workday &amp;
              Direct-ATS feeds, Alert Ingestion Webhook, and runtime storage health.
            </p>
          </div>
          <div className="flex items-center gap-2.5 shrink-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={fetchAudit}
              disabled={loading}
              className="bg-white dark:bg-[#111827] border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200 text-xs"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 mr-1.5 ${
                  loading ? 'animate-spin text-emerald-500 dark:text-emerald-400' : ''
                }`}
              />
              Refresh
            </Button>
            <Button
              asChild
              variant="outline"
              size="sm"
              className="bg-white dark:bg-[#111827] border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200 text-xs"
            >
              <a
                href={`${siteConfig.githubRepo}/settings/secrets/actions`}
                target="_blank"
                rel="noreferrer"
              >
                <ExternalLink className="h-3.5 w-3.5 mr-1.5" /> GitHub Secrets
              </a>
            </Button>
          </div>
        </div>

        {audit && audit.authConfigured === false && (
          <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-700/60 text-amber-800 dark:text-amber-200 px-4 py-3 rounded-lg text-xs flex items-start gap-2.5">
            <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold text-amber-900 dark:text-amber-300">
                Open Operator Mode Active:
              </span>{' '}
              <span className="font-mono">ADMIN_USER</span> and{' '}
              <span className="font-mono">ADMIN_PASS</span> are unset in your deployment
              environment. Configure both before exposing this instance publicly.
            </div>
          </div>
        )}

        {audit &&
          (audit.ephemeralFallback ||
            audit.persistenceMode === 'ephemeral-tmp' ||
            audit.persistenceMode === 'read-only' ||
            audit.cloudError) && (
            <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-700/60 text-amber-800 dark:text-amber-200 px-4 py-3 rounded-lg text-xs space-y-1">
              <div className="font-semibold text-amber-900 dark:text-amber-300 flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
                <span>
                  {audit.persistenceMode === 'read-only'
                    ? 'Read-Only Container Filesystem Detected'
                    : audit.ephemeralFallback
                    ? 'Ephemeral /tmp Runtime Storage Active'
                    : 'Google Sheets Sync Fallback Warning'}
                </span>
              </div>
              <p className="leading-relaxed">
                {audit.cloudError
                  ? `Cloud Sheets error: ${audit.cloudError}. `
                  : ''}
                {audit.ephemeralFallback
                  ? `Container data/ is read-only; writes are automatically routed to ${audit.resolvedDataDir || '/tmp/kaisifos-data'} (session-scoped, resets on container cold restart). Configure GOOGLE_SHEET_ID and GOOGLE_SERVICE_KEY_BASE64 for permanent cloud persistence across deployments.`
                  : 'Configure GOOGLE_SHEET_ID and GOOGLE_SERVICE_KEY_BASE64 for permanent cloud persistence.'}
              </p>
            </div>
          )}

        {audit && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-lg p-5">
              <div className="text-xs text-slate-500 dark:text-slate-400">Persistence Layer</div>
              <div className="text-sm font-display font-semibold text-slate-900 dark:text-white mt-1">
                {audit.persistenceMode === 'neon-postgres' || audit.storageMode === 'neon-postgres'
                  ? 'Neon Serverless Postgres'
                  : audit.persistenceMode === 'cloud-sheets' ||
                    audit.storageMode === 'cloud-sheets'
                  ? 'Google Sheets v4 Sync'
                  : audit.persistenceMode === 'ephemeral-tmp'
                  ? 'Ephemeral /tmp Store (Read-Only Host)'
                  : audit.persistenceMode === 'read-only'
                  ? 'Read-Only Filesystem'
                  : 'Local Store (jobs-store.json)'}
              </div>
              {audit.resolvedDataDir && (
                <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 mt-1 truncate">
                  Dir: {audit.resolvedDataDir}
                </div>
              )}
            </div>

            <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-lg p-5">
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Active Scoring Engine
              </div>
              <div className="text-sm font-display font-semibold text-emerald-600 dark:text-emerald-400 mt-1">
                {audit.aiEngine}
              </div>
            </div>

            <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-lg p-5">
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Direct-ATS &amp; Optional Bridge
              </div>
              <div className="text-sm font-display font-semibold text-slate-900 dark:text-white mt-1">
                Workday · GH · Lever · Ashby · Keka/Darwinbox
              </div>
              <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 mt-1">
                FREEHIRE_API_URL:{' '}
                <span
                  className={
                    audit.freehireBridgeConfigured
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-slate-600 dark:text-slate-300'
                  }
                >
                  {audit.freehireBridgeConfigured ? 'Connected' : 'Optional / Unconfigured'}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Production Lockdown & Automation Readiness Scoreboard */}
        {audit?.readinessChecklist && audit.readinessChecklist.length > 0 && (
          <section className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0D131F] flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                <h2 className="text-sm font-display font-semibold text-slate-900 dark:text-white">
                  Production Lockdown &amp; Automation Readiness Checklist
                </h2>
              </div>
              <span className="text-xs font-mono tabular-nums px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60">
                {audit.readinessChecklist.filter((c) => c.status === 'pass').length} /{' '}
                {audit.readinessChecklist.length} Ready
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:gap-px bg-slate-200/70 dark:bg-slate-800/70">
              {audit.readinessChecklist.map((item) => (
                <div
                  key={item.id}
                  className="bg-white dark:bg-[#111827] p-4 flex items-start gap-3 text-xs"
                >
                  {item.status === 'pass' ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                  )}
                  <div className="space-y-1 min-w-0">
                    <div className="font-medium text-slate-900 dark:text-white">{item.label}</div>
                    <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
                      {item.detail}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {audit?.failoverChains && audit.failoverChains.length > 0 && (
          <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {audit.failoverChains.map((chain) => (
              <div
                key={chain.name}
                className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-lg p-4 space-y-3"
              >
                <div className="border-b border-slate-200 dark:border-slate-800 pb-2.5">
                  <div className="text-xs font-display font-semibold text-slate-900 dark:text-white">
                    {chain.name}
                  </div>
                  <div className="text-[11px] font-mono text-emerald-600 dark:text-emerald-400 mt-0.5">
                    {chain.activeTier}
                  </div>
                </div>
                <div className="divide-y divide-slate-200/70 dark:divide-slate-800/70 text-[11px] font-mono">
                  {chain.tiers.map((tier) => (
                    <div
                      key={tier.label}
                      className="py-2 first:pt-0 last:pb-0 flex items-center justify-between gap-2"
                    >
                      <span className="text-slate-600 dark:text-slate-300 truncate">
                        {tier.label}
                      </span>
                      <span
                        className={`shrink-0 ${
                          tier.status.includes('Ready') ||
                          tier.status.includes('Always') ||
                          tier.status.includes('Connected')
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-amber-600 dark:text-amber-400'
                        }`}
                      >
                        {tier.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </section>
        )}

        {/* Naukri / LinkedIn Alert Webhook, 1-Click Clipper & Internshala Opt-In */}
        <section className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0D131F] flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-display font-semibold text-slate-900 dark:text-white inline-flex items-center gap-2">
                <Mail className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                Naukri / LinkedIn Alert Webhook &amp; 1-Click Clipper
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                Bypass Cloudflare anti-bot blocks cleanly by forwarding alert emails or clipping
                any live job tab into your 4-Pillar pipeline.
              </p>
            </div>
            <Link
              href="/admin/clip"
              className="px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium inline-flex items-center gap-1.5 transition-colors"
            >
              <BookmarkPlus className="h-3.5 w-3.5" /> Open 1-Click Clipper
            </Link>
          </div>

          <div className="p-5 space-y-5 text-xs">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded-md p-4 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-slate-900 dark:text-white">
                    1-Click Browser Bookmarklet (Zero Secret / CSP-Safe)
                  </span>
                  <button
                    type="button"
                    onClick={() => copySnippet('bookmarklet', bookmarkletHref)}
                    className="text-[11px] font-mono text-emerald-600 dark:text-emerald-400 hover:underline inline-flex items-center gap-1 cursor-pointer"
                  >
                    {copiedKey === 'bookmarklet' ? (
                      <>
                        <Check className="h-3 w-3" /> Copied
                      </>
                    ) : (
                      <>
                        <Copy className="h-3 w-3" /> Copy Bookmarklet
                      </>
                    )}
                  </button>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                  Bookmark any page in your browser, edit its URL to paste this snippet, then click
                  it on Naukri, LinkedIn, or Wellfound to pre-fill <span className="font-mono">/admin/clip</span> without cross-origin CSP errors.
                </p>
                <pre className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded p-2.5 text-[10px] font-mono text-slate-600 dark:text-slate-300 overflow-x-auto whitespace-nowrap">
                  {bookmarkletHref}
                </pre>
              </div>

              <div className="bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded-md p-4 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-slate-900 dark:text-white">
                    Webhook Endpoint &amp; Secret Status
                  </span>
                  <span
                    className={`font-mono text-[11px] ${
                      audit?.ingestWebhookConfigured
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-amber-600 dark:text-amber-400'
                    }`}
                  >
                    {audit?.ingestWebhookConfigured
                      ? 'INGEST_WEBHOOK_SECRET Set'
                      : 'Set INGEST_WEBHOOK_SECRET in env'}
                  </span>
                </div>
                <div className="flex items-center gap-2 bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded px-3 py-2">
                  <code className="text-[11px] font-mono text-slate-700 dark:text-slate-200 flex-1 truncate">
                    POST {webhookUrl}
                  </code>
                  <button
                    type="button"
                    onClick={() => copySnippet('webhook_url', webhookUrl)}
                    className="text-[11px] font-mono text-emerald-600 dark:text-emerald-400 hover:underline shrink-0 cursor-pointer"
                  >
                    {copiedKey === 'webhook_url' ? 'Copied' : 'Copy URL'}
                  </button>
                </div>

                <div className="pt-1 flex items-center justify-between gap-3 border-t border-slate-200 dark:border-slate-800">
                  <div>
                    <div className="font-medium text-slate-800 dark:text-slate-200">
                      Internshala Scraper (Opt-In)
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      Disabled by default to eliminate low-signal internship noise.
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={togglingInternshala || !profileRaw}
                    onClick={toggleInternshala}
                    className={`px-3 py-1.5 rounded text-[11px] font-medium border transition-colors shrink-0 cursor-pointer ${
                      enableInternshala
                        ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/40'
                        : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/40'
                    }`}
                  >
                    {enableInternshala ? 'Enabled (Click to Disable)' : 'Disabled (High-Signal Mode)'}
                  </button>
                </div>
                {internshalaMsg && (
                  <div className="text-[11px] font-mono text-emerald-600 dark:text-emerald-400">
                    {internshalaMsg}
                  </div>
                )}
              </div>
            </div>

            <div className="bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded-md p-4 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-slate-900 dark:text-white">
                  Google Apps Script — Auto-Forward Naukri / LinkedIn / Wellfound Email Alerts
                </span>
                <button
                  type="button"
                  onClick={() => copySnippet('apps_script', appsScriptSnippet)}
                  className="text-[11px] font-mono text-emerald-600 dark:text-emerald-400 hover:underline inline-flex items-center gap-1 cursor-pointer"
                >
                  {copiedKey === 'apps_script' ? (
                    <>
                      <Check className="h-3 w-3" /> Copied
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3" /> Copy Script
                    </>
                  )}
                </button>
              </div>
              <pre className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded p-3 text-[11px] font-mono text-slate-700 dark:text-slate-300 overflow-x-auto leading-relaxed">
                {appsScriptSnippet}
              </pre>
            </div>

            <div className="bg-slate-50 dark:bg-[#0B0F17] border border-emerald-200 dark:border-emerald-800/60 rounded-md p-4 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="font-medium text-slate-900 dark:text-white">
                    Consumer @gmail.com Recruiter Reply Tracker (Google Apps Script)
                  </span>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    Works on standard free <span className="font-mono">@gmail.com</span> accounts.
                    Pulls active Applied/Outreach companies from{' '}
                    <span className="font-mono">GET /api/ingest/reply</span>, classifies incoming
                    replies into <span className="font-mono">INTERVIEW</span> /{' '}
                    <span className="font-mono">REPLIED</span> /{' '}
                    <span className="font-mono">REJECTED</span> while ignoring automated
                    acknowledgements, and updates Neon + Discord.
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <button
                    type="button"
                    onClick={() => copySnippet('reply_url', replyWebhookUrl)}
                    className="text-[11px] font-mono text-slate-600 dark:text-slate-300 hover:underline cursor-pointer"
                  >
                    {copiedKey === 'reply_url' ? 'URL Copied' : 'Copy Endpoint'}
                  </button>
                  <button
                    type="button"
                    onClick={() => copySnippet('reply_script', replyTrackerAppsScript)}
                    className="text-[11px] font-mono text-emerald-600 dark:text-emerald-400 hover:underline inline-flex items-center gap-1 cursor-pointer"
                  >
                    {copiedKey === 'reply_script' ? (
                      <>
                        <Check className="h-3 w-3" /> Copied
                      </>
                    ) : (
                      <>
                        <Copy className="h-3 w-3" /> Copy Reply Script
                      </>
                    )}
                  </button>
                </div>
              </div>
              <pre className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded p-3 text-[11px] font-mono text-slate-700 dark:text-slate-300 overflow-x-auto leading-relaxed">
                {replyTrackerAppsScript}
              </pre>
            </div>
          </div>
        </section>

        <section className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0D131F] flex items-center justify-between">
            <h2 className="text-sm font-display font-semibold text-slate-900 dark:text-white">
              Environment Variables &amp; Failover Chain
            </h2>
            <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400 tabular-nums">
              {audit?.envChecks ? `${audit.envChecks.length} Variables Audited` : 'Loading...'}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-500 dark:text-slate-400 bg-slate-50/70 dark:bg-[#0B0F17]/60">
                  <th className="py-3 px-5">Key</th>
                  <th className="py-3 px-5">Subsystem</th>
                  <th className="py-3 px-5">Status</th>
                  <th className="py-3 px-5">Active Fallback</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800/80 text-xs">
                {(audit?.envChecks || []).map((env) => (
                  <tr
                    key={env.name}
                    className="hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors"
                  >
                    <td className="py-3.5 px-5 align-top">
                      <div className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                        {env.name}
                      </div>
                      <div className="text-slate-500 dark:text-slate-400 text-[11px] mt-0.5">
                        {env.description}
                      </div>
                    </td>
                    <td className="py-3.5 px-5 align-top text-slate-700 dark:text-slate-300 whitespace-nowrap">
                      {env.category}
                    </td>
                    <td className="py-3.5 px-5 align-top whitespace-nowrap">
                      {env.configured ? (
                        <span className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-medium">
                          <CheckCircle2 className="h-3.5 w-3.5" /> Configured
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-amber-600 dark:text-amber-400 font-medium">
                          <AlertCircle className="h-3.5 w-3.5" /> Fallback Active
                        </span>
                      )}
                    </td>
                    <td className="py-3.5 px-5 align-top text-slate-600 dark:text-slate-300 font-mono text-[11px]">
                      {env.fallback}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {audit?.auditFindings && audit.auditFindings.length > 0 && (
          <section className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0D131F] flex items-center justify-between">
              <h2 className="text-sm font-display font-semibold text-slate-900 dark:text-white inline-flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                Architectural &amp; Parity Audit Ledger
              </h2>
              <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                {siteConfig.workflows.jobScoutSchedule} ·{' '}
                {siteConfig.workflows.replyTrackerSchedule}
              </span>
            </div>
            <div className="divide-y divide-slate-200 dark:divide-slate-800/80 text-xs">
              {audit.auditFindings.map((finding) => (
                <div key={finding.id} className="p-4 sm:px-5 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-slate-900 dark:text-white">
                      <span className="font-mono text-emerald-600 dark:text-emerald-400 mr-2">
                        {finding.id}
                      </span>
                      {finding.layer}
                    </span>
                    <span className="font-mono text-[11px] text-emerald-600 dark:text-emerald-400">
                      {finding.status}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
                    {finding.after}
                  </p>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
