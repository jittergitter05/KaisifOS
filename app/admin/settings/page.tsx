'use client';
import React, { useEffect, useState, useCallback } from 'react';
import { CheckCircle2, AlertCircle, ExternalLink, RefreshCw, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { siteConfig } from '@/config/site';

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

interface SystemAuditResponse {
  timestamp: string;
  authConfigured?: boolean;
  freehireBridgeConfigured?: boolean;
  storageMode: 'cloud-sheets' | 'local-store';
  aiEngine: string;
  envChecks: EnvCheck[];
  failoverChains?: FailoverChain[];
  auditFindings?: AuditFinding[];
}

export default function SettingsPage() {
  const [audit, setAudit] = useState<SystemAuditResponse | null>(null);
  const [loading, setLoading] = useState(true);

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
    fetchAudit();
  }, [fetchAudit]);

  return (
    <div className="flex flex-col flex-1 w-full bg-slate-50 dark:bg-[#0B0F17] text-slate-900 dark:text-[#F8FAFC]">
      <div className="flex-1 py-6 px-4 sm:px-6 lg:px-8 max-w-5xl mx-auto w-full pb-24 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-5">
          <div>
            <h1 className="text-2xl font-display font-bold tracking-tight text-slate-900 dark:text-white">
              Environment &amp; Protocol Status
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Server-side check for all 12 environment variables, 4-tier failover chains,
              Direct-ATS feeds, and optional FreeHire bridge.
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

        {audit && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-lg p-5">
              <div className="text-xs text-slate-500 dark:text-slate-400">Persistence Layer</div>
              <div className="text-sm font-display font-semibold text-slate-900 dark:text-white mt-1">
                {audit.storageMode === 'cloud-sheets'
                  ? 'Google Sheets v4 Sync'
                  : 'Local Store (jobs-store.json)'}
              </div>
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
                Built-in Greenhouse · Lever · Ashby
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

        <section className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0D131F] flex items-center justify-between">
            <h2 className="text-sm font-display font-semibold text-slate-900 dark:text-white">
              12-Key Environment Variables &amp; Failover Chain
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
