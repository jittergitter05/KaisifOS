'use client';
import React, { useEffect, useState, useCallback } from 'react';
import {
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  RefreshCw,
  ShieldCheck,
  Database,
  Cpu,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

interface EnvCheck {
  name: string;
  category: string;
  description: string;
  required: boolean;
  configured: boolean;
  fallback: string;
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
  storageMode: 'cloud-sheets' | 'local-store';
  aiEngine: string;
  envChecks: EnvCheck[];
  auditFindings: AuditFinding[];
}

export default function SettingsPage() {
  const [audit, setAudit] = useState<SystemAuditResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchAudit = useCallback(() => {
    setLoading(true);
    fetch('/api/system-audit')
      .then((res) => res.json())
      .then((data) => {
        setAudit(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchAudit();
  }, [fetchAudit]);

  return (
    <div className="flex flex-col flex-1 w-full bg-[#0B0F17] text-[#F8FAFC]">
      <div className="flex-1 py-6 px-4 sm:px-6 lg:px-8 max-w-5xl mx-auto w-full pb-24 space-y-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800/90 pb-5">
          <div>
            <h1 className="text-2xl font-display font-bold tracking-tight text-white">
              System Audit & Environment Diagnostics
            </h1>
            <p className="text-xs text-slate-400 mt-1">
              Live server-side verification of API credentials, hybrid storage failover, and
              architectural upgrades.
            </p>
          </div>
          <div className="flex items-center gap-2.5 shrink-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={fetchAudit}
              disabled={loading}
              className="bg-[#111827] border-slate-800 hover:bg-slate-800 text-slate-200 text-xs"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 mr-1.5 ${loading ? 'animate-spin text-emerald-400' : ''}`}
              />
              Re-Run Diagnostics
            </Button>
            <Button
              asChild
              variant="outline"
              size="sm"
              className="bg-[#111827] border-slate-800 hover:bg-slate-800 text-slate-200 text-xs"
            >
              <a
                href="https://github.com/jittergitter05/KaisifOS/settings/secrets/actions"
                target="_blank"
                rel="noreferrer"
              >
                <ExternalLink className="h-3.5 w-3.5 mr-1.5" /> GitHub Secrets
              </a>
            </Button>
          </div>
        </div>

        {audit && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-[#111827] border border-slate-800/90 rounded-xl p-5">
              <div className="flex items-center gap-2 text-xs text-slate-400 mb-1.5">
                <Database className="h-4 w-4 text-emerald-400" /> Active Persistence Layer
              </div>
              <div className="text-base font-display font-semibold text-white">
                {audit.storageMode === 'cloud-sheets'
                  ? 'Google Sheets v4 Cloud Sync'
                  : 'Hybrid Local Ledger (jobs-store.json)'}
              </div>
              <div className="text-xs text-slate-400 mt-1">
                Zero data loss; automatic read/write failover enabled
              </div>
            </div>

            <div className="bg-[#111827] border border-slate-800/90 rounded-xl p-5">
              <div className="flex items-center gap-2 text-xs text-slate-400 mb-1.5">
                <Cpu className="h-4 w-4 text-blue-400" /> Active Evaluation Engine
              </div>
              <div className="text-base font-display font-semibold text-white">
                {audit.aiEngine}
              </div>
              <div className="text-xs text-slate-400 mt-1">
                Cascade: Gemini 2.5 Flash → Groq Llama 3.3 → Rubric v2.4
              </div>
            </div>

            <div className="bg-[#111827] border border-slate-800/90 rounded-xl p-5">
              <div className="flex items-center gap-2 text-xs text-slate-400 mb-1.5">
                <ShieldCheck className="h-4 w-4 text-violet-400" /> Edge Session Security
              </div>
              <div className="text-base font-display font-semibold text-white">
                Web Crypto HMAC-SHA256
              </div>
              <div className="text-xs text-slate-400 mt-1 font-mono tabular-nums">
                Verified at {new Date(audit.timestamp).toLocaleTimeString()}
              </div>
            </div>
          </div>
        )}

        <section className="bg-[#111827] border border-slate-800/90 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-[#0D131F]">
            <div>
              <h2 className="text-sm font-display font-semibold text-white">
                Server-Side Environment Variable Telemetry
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Live inspection from the server runtime (values remain strictly secret and are
                never sent to the client).
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-xs font-medium text-slate-400 bg-[#0B0F17]/60">
                  <th className="py-3 px-5">Variable Key</th>
                  <th className="py-3 px-5">Subsystem</th>
                  <th className="py-3 px-5">Runtime Status</th>
                  <th className="py-3 px-5">Active Failover / Fallback</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80 text-xs">
                {(audit?.envChecks || []).map((env) => (
                  <tr key={env.name} className="hover:bg-slate-800/30 transition-colors">
                    <td className="py-3.5 px-5 align-top">
                      <div className="font-mono font-semibold text-slate-100">{env.name}</div>
                      <div className="text-slate-400 text-[11px] mt-0.5">{env.description}</div>
                    </td>
                    <td className="py-3.5 px-5 align-top text-slate-300 whitespace-nowrap">
                      {env.category}
                    </td>
                    <td className="py-3.5 px-5 align-top whitespace-nowrap">
                      {env.configured ? (
                        <span className="inline-flex items-center gap-1.5 text-emerald-400 font-medium">
                          <CheckCircle2 className="h-3.5 w-3.5" /> Configured in Env
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-amber-400 font-medium">
                          <AlertCircle className="h-3.5 w-3.5" /> Using Local Fallback
                        </span>
                      )}
                    </td>
                    <td className="py-3.5 px-5 align-top text-slate-300 font-mono text-[11px]">
                      {env.fallback}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="bg-[#111827] border border-slate-800/90 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-800 bg-[#0D131F]">
            <h2 className="text-sm font-display font-semibold text-white">
              Deep Critical Audit Resolution Ledger
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Summary of system-wide bottlenecks identified and upgraded across the KaisifOS stack.
            </p>
          </div>
          <div className="divide-y divide-slate-800/80">
            {(audit?.auditFindings || []).map((item) => (
              <div key={item.id} className="p-5 grid grid-cols-1 md:grid-cols-12 gap-4">
                <div className="md:col-span-3">
                  <div className="font-mono text-xs text-emerald-400">{item.id}</div>
                  <div className="font-display font-semibold text-sm text-white mt-0.5">
                    {item.layer}
                  </div>
                </div>
                <div className="md:col-span-4 text-xs text-slate-400 leading-relaxed">
                  <strong className="text-slate-300 block mb-0.5">Previous Defect:</strong>
                  {item.before}
                </div>
                <div className="md:col-span-5 text-xs text-slate-200 leading-relaxed">
                  <strong className="text-emerald-400 block mb-0.5">Engineered Upgrade:</strong>
                  {item.after}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
