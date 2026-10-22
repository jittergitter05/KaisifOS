'use client';
import React, { useEffect, useState, useCallback } from 'react';
import {
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  RefreshCw,
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

interface SystemAuditResponse {
  timestamp: string;
  storageMode: 'cloud-sheets' | 'local-store';
  aiEngine: string;
  envChecks: EnvCheck[];
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
      <div className="flex-1 py-6 px-4 sm:px-6 lg:px-8 max-w-5xl mx-auto w-full pb-24 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-5">
          <div>
            <h1 className="text-2xl font-display font-bold tracking-tight text-white">
              Environment & Protocol Status
            </h1>
            <p className="text-xs text-slate-400 mt-1">
              Server-side check for LLM providers, FreeHire ATS feeds, and Google Sheets sync.
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
              Refresh
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
            <div className="bg-[#111827] border border-slate-800 rounded-lg p-5">
              <div className="text-xs text-slate-400">Persistence Layer</div>
              <div className="text-sm font-display font-semibold text-white mt-1">
                {audit.storageMode === 'cloud-sheets'
                  ? 'Google Sheets v4 Sync'
                  : 'Local Store (jobs-store.json)'}
              </div>
            </div>

            <div className="bg-[#111827] border border-slate-800 rounded-lg p-5">
              <div className="text-xs text-slate-400">Active Scoring Engine</div>
              <div className="text-sm font-display font-semibold text-emerald-400 mt-1">
                {audit.aiEngine}
              </div>
            </div>

            <div className="bg-[#111827] border border-slate-800 rounded-lg p-5">
              <div className="text-xs text-slate-400">Direct-ATS Scraper</div>
              <div className="text-sm font-display font-semibold text-white mt-1">
                strelov1/freehire (Greenhouse · Lever · Ashby)
              </div>
            </div>
          </div>
        )}

        <section className="bg-[#111827] border border-slate-800 rounded-lg overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-800 bg-[#0D131F]">
            <h2 className="text-sm font-display font-semibold text-white">
              Environment Variables & Failover Chain
            </h2>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-xs font-medium text-slate-400 bg-[#0B0F17]/60">
                  <th className="py-3 px-5">Key</th>
                  <th className="py-3 px-5">Subsystem</th>
                  <th className="py-3 px-5">Status</th>
                  <th className="py-3 px-5">Active Fallback</th>
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
                          <CheckCircle2 className="h-3.5 w-3.5" /> Configured
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-amber-400 font-medium">
                          <AlertCircle className="h-3.5 w-3.5" /> Fallback Active
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
      </div>
    </div>
  );
}
