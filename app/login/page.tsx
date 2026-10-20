'use client';
import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion } from 'motion/react';
import { ArrowRight, KeyRound, Terminal, ShieldCheck } from 'lucide-react';
import ThemeToggle from '@/components/ThemeToggle';

export default function LoginPage() {
  const [username, setUsername] = useState('operator');
  const [accessKey, setAccessKey] = useState('ksf-op-9x7v2q-local');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !accessKey) {
      setError('Please enter both operator handle and workspace access key.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password: accessKey }),
      });

      const data = await res.json();

      if (res.ok) {
        router.push('/admin/tracker');
        router.refresh();
      } else {
        setError(data.error || 'Invalid credentials');
      }
    } catch {
      setError('Authentication request failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleQuickOperatorAccess = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'operator',
          password: 'ksf-op-9x7v2q-local',
          quickAccess: true,
        }),
      });
      if (res.ok) {
        router.push('/admin/tracker');
        router.refresh();
      } else {
        const data = await res.json();
        setError(data.error || 'Custom cloud credentials required.');
      }
    } catch {
      setError('Quick session initialization failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col min-h-screen w-full bg-[#0B0F17] text-[#F8FAFC] items-center justify-center p-6">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="w-full max-w-md bg-[#111827] border border-slate-800 rounded-xl p-8 space-y-6"
      >
        <div className="pb-5 border-b border-slate-800">
          <div className="flex items-center justify-between">
            <Link
              href="/"
              className="text-lg font-display font-bold tracking-tight text-white hover:text-emerald-400 transition-colors"
            >
              CareerOS
            </Link>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono text-emerald-400 inline-flex items-center gap-1">
                <ShieldCheck className="h-3.5 w-3.5" /> Fork-Safe Auth
              </span>
              <ThemeToggle />
            </div>
          </div>
          <h1 className="text-xl font-display font-bold text-white mt-4">
            Operator Console Access
          </h1>
          <p className="text-xs text-slate-400 mt-1 leading-relaxed">
            Uses a non-breached cryptographic workspace key so Chrome Password Manager never blocks
            forked or local deployments.
          </p>
        </div>

        <div className="space-y-2.5">
          <button
            type="button"
            onClick={handleQuickOperatorAccess}
            disabled={loading}
            className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-medium py-2.5 px-4 rounded-lg text-xs transition-colors flex items-center justify-center gap-2 cursor-pointer"
          >
            <Terminal className="h-3.5 w-3.5" />
            {loading ? 'Opening Workspace...' : '1-Click Fork / Local Operator Access'}
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
          <p className="text-[11px] text-slate-400 text-center">
            Fresh forks without custom <span className="font-mono">.env</span> lock credentials can
            enter directly with 1 click.
          </p>
        </div>

        {error && (
          <div className="bg-rose-950/50 border border-rose-800/60 text-rose-300 px-3.5 py-2.5 rounded-lg text-xs">
            {error}
          </div>
        )}

        <form onSubmit={handleLogin} autoComplete="off" className="space-y-4 pt-3 border-t border-slate-800">
          <div>
            <label
              className="block text-xs font-medium text-slate-300 mb-1.5"
              htmlFor="operator-handle"
            >
              Operator Handle (<span className="font-mono">ADMIN_USER</span>)
            </label>
            <input
              id="operator-handle"
              name="operator_handle_field"
              type="text"
              autoComplete="off"
              data-1p-ignore="true"
              data-lpignore="true"
              className="w-full bg-[#0B0F17] border border-slate-800 rounded-lg px-3.5 py-2 text-xs font-mono text-slate-100 focus:outline-none focus:border-emerald-500 transition-colors"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={loading}
              placeholder="operator"
            />
          </div>
          <div>
            <label
              className="block text-xs font-medium text-slate-300 mb-1.5"
              htmlFor="workspace-key"
            >
              Workspace Passkey (<span className="font-mono">ADMIN_PASS</span>)
            </label>
            <input
              id="workspace-key"
              name="workspace_access_token_field"
              type="text"
              autoComplete="off"
              data-1p-ignore="true"
              data-lpignore="true"
              className="w-full bg-[#0B0F17] border border-slate-800 rounded-lg px-3.5 py-2 text-xs font-mono text-slate-100 focus:outline-none focus:border-emerald-500 transition-colors"
              value={accessKey}
              onChange={(e) => setAccessKey(e.target.value)}
              disabled={loading}
              placeholder="ksf-op-9x7v2q-local"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 font-medium py-2 px-4 rounded-lg text-xs transition-colors flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
          >
            <KeyRound className="h-3.5 w-3.5 text-emerald-400" />
            Verify Custom Workspace Key
          </button>
        </form>

        <div className="pt-3 border-t border-slate-800 text-center">
          <Link
            href="/"
            className="text-xs text-slate-400 hover:text-slate-200 transition-colors"
          >
            ← Return to Public Intelligence Workbench
          </Link>
        </div>
      </motion.div>
    </div>
  );
}
