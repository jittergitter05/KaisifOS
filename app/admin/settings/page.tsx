'use client';
import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { CheckCircle, XCircle, ExternalLink, Shield, Key } from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface EnvStatus {
  name: string;
  description: string;
  required: boolean;
  set: boolean;
}

const ENV_VARS: Omit<EnvStatus, 'set'>[] = [
  { name: 'GOOGLE_SERVICE_KEY_BASE64', description: 'Google Sheets & Gmail auth', required: true },
  { name: 'GOOGLE_SHEET_ID', description: 'Spreadsheet for job tracking', required: true },
  { name: 'GROQ_API_KEY', description: 'AI scoring (Groq/xAI/Grok)', required: true },
  { name: 'GEMINI_API_KEY', description: 'Gemini fallback for scoring', required: false },
  { name: 'ADMIN_PASSWORD', description: 'Dashboard login password', required: true },
  { name: 'AUTH_SECRET', description: 'HMAC signing key for sessions', required: true },
  { name: 'APP_URL', description: 'Public URL of the dashboard', required: false },
  { name: 'RAPIDAPI_KEY', description: 'JSearch API for extra sources', required: false },
  { name: 'DISCORD_WEBHOOK_URL', description: 'Daily digest notifications', required: false },
  { name: 'GMAIL_USER_EMAIL', description: 'Reply tracker email source', required: false },
];

export default function SettingsPage() {
  const [envStatuses, setEnvStatuses] = useState<EnvStatus[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // We can't check env vars client-side, so we show the known list with a static display.
    // In production, env vars are set in Vercel/GitHub, not readable from the browser.
    const statuses = ENV_VARS.map(v => ({
      ...v,
      set: false, // We can't know from client side
    }));
    setEnvStatuses(statuses);
    setLoading(false);
  }, []);

  return (
    <div className="flex flex-col flex-1 w-full bg-slate-950 text-slate-50">
      <motion.main initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="flex-1 py-6 px-4 sm:px-6 lg:px-8 max-w-4xl mx-auto w-full pb-24">
        <div className="mb-8 border-b border-slate-800 pb-4">
          <h1 className="text-2xl font-bold tracking-tight text-white">Settings</h1>
          <p className="text-xs text-slate-500 mt-1">Manage secrets, integrations, and system configuration</p>
        </div>

        <div className="space-y-6">
          {/* Environment Variables */}
          <Card className="bg-slate-900 border-slate-800">
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <div className="flex items-center gap-2">
                <Key className="h-4 w-4 text-emerald-500" />
                <h3 className="text-sm font-bold text-slate-200">Environment Variables</h3>
              </div>
              <Button asChild variant="outline" size="sm" className="bg-slate-900 border-slate-700 text-slate-400 text-[10px]">
                <a href="https://github.com/jittergitter05/KaisifOS/settings/secrets/actions" target="_blank" rel="noreferrer">
                  <ExternalLink className="h-3 w-3 mr-1" /> GitHub Secrets
                </a>
              </Button>
            </CardHeader>
            <CardContent>
              <p className="text-[10px] text-slate-500 mb-4">Environment variables are managed through GitHub Secrets and Vercel. This panel shows what the system expects.</p>
              <div className="space-y-2">
                {envStatuses.map(env => (
                  <div key={env.name} className="flex items-center justify-between py-2 px-3 rounded-lg bg-slate-950/50 border border-slate-800/50">
                    <div className="flex items-center gap-3">
                      <div className={`w-2 h-2 rounded-full ${env.required ? 'bg-red-400' : 'bg-slate-600'}`} />
                      <div>
                        <div className="text-xs font-mono text-slate-200">{env.name}</div>
                        <div className="text-[10px] text-slate-500">{env.description}</div>
                      </div>
                    </div>
                    <span className={`text-[9px] font-bold uppercase tracking-wider ${env.required ? 'text-red-400' : 'text-slate-600'}`}>
                      {env.required ? 'Required' : 'Optional'}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* System Info */}
          <Card className="bg-slate-900 border-slate-800">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4 text-blue-400" />
                <h3 className="text-sm font-bold text-slate-200">System</h3>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between py-2">
                <span className="text-xs text-slate-400">Authentication</span>
                <span className="text-[10px] font-mono text-emerald-400">HMAC-SHA256 (Web Crypto)</span>
              </div>
              <div className="flex items-center justify-between py-2 border-t border-slate-800">
                <span className="text-xs text-slate-400">AI Scoring</span>
                <span className="text-[10px] font-mono text-slate-300">Grok 4.5 → Groq Llama 3.3 → Gemini 2.5 Flash</span>
              </div>
              <div className="flex items-center justify-between py-2 border-t border-slate-800">
                <span className="text-xs text-slate-400">Job Sources</span>
                <span className="text-[10px] font-mono text-slate-300">Internshala + RemoteOK + Remotive + JSearch</span>
              </div>
              <div className="flex items-center justify-between py-2 border-t border-slate-800">
                <span className="text-xs text-slate-400">Dedup Engine</span>
                <span className="text-[10px] font-mono text-slate-300">SeenJobs sheet tab (persistent)</span>
              </div>
              <div className="flex items-center justify-between py-2 border-t border-slate-800">
                <span className="text-xs text-slate-400">Runtime</span>
                <span className="text-[10px] font-mono text-slate-300">Node 24 (GitHub Actions)</span>
              </div>
              <div className="mt-4 pt-3 border-t border-slate-800">
                <Button asChild variant="outline" size="sm" className="w-full bg-slate-900 border-slate-700 text-slate-400">
                  <a href="https://github.com/jittergitter05/KaisifOS/actions" target="_blank" rel="noreferrer">
                    <ExternalLink className="h-3 w-3 mr-2" /> View GitHub Actions
                  </a>
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </motion.main>
    </div>
  );
}
