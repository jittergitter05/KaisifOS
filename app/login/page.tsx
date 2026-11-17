'use client';
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion } from 'motion/react';
import { ArrowRight, KeyRound, Terminal, ShieldCheck, Eye, EyeOff } from 'lucide-react';
import ThemeToggle from '@/components/ThemeToggle';
import { siteConfig } from '@/config/site';

export default function LoginPage() {
  const [brandName, setBrandName] = useState(siteConfig.name);
  const [customAuthConfigured, setCustomAuthConfigured] = useState<boolean | null>(null);
  const [username, setUsername] = useState('operator');
  const [accessKey, setAccessKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/login')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        if (typeof data.customAuthConfigured === 'boolean') {
          setCustomAuthConfigured(data.customAuthConfigured);
        }
        if (data.brandName) {
          setBrandName(data.brandName);
        }
      })
      .catch(() => {
        if (!cancelled) setCustomAuthConfigured(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !accessKey) {
      setError('Please enter both operator handle and workspace passkey.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password: accessKey }),
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
        body: JSON.stringify({ quickAccess: true }),
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
    <div className="flex flex-col min-h-screen w-full bg-slate-50 dark:bg-[#0B0F17] text-slate-900 dark:text-[#F8FAFC] items-center justify-center p-6">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="w-full max-w-md bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-8 space-y-6 shadow-xs dark:shadow-none"
      >
        <div className="pb-5 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center justify-between">
            <Link
              href="/"
              className="text-lg font-display font-bold tracking-tight text-slate-900 dark:text-white hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors"
            >
              {brandName}
            </Link>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-1">
                <ShieldCheck className="h-3.5 w-3.5" />{' '}
                {customAuthConfigured ? 'Cloud Secured' : 'Fork-Safe Auth'}
              </span>
              <ThemeToggle />
            </div>
          </div>
          <h1 className="text-xl font-display font-bold text-slate-900 dark:text-white mt-4">
            Operator Console Access
          </h1>
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 leading-relaxed">
            {customAuthConfigured
              ? 'Custom ADMIN_USER and ADMIN_PASS credentials are active on this deployment.'
              : 'No custom lock credentials configured. Enter with 1 click or sign in with your configured workspace passkey.'}
          </p>
        </div>

        {customAuthConfigured === false && (
          <div className="space-y-2.5">
            <button
              type="button"
              onClick={handleQuickOperatorAccess}
              disabled={loading}
              className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-medium py-2.5 px-4 rounded-lg text-xs transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              <Terminal className="h-3.5 w-3.5" />
              {loading ? 'Opening Workspace...' : '1-Click Fork / Local Operator Access'}
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 text-center">
              Fresh forks without custom <span className="font-mono">.env</span> lock credentials
              can enter directly with 1 click.
            </p>
          </div>
        )}

        {error && (
          <div className="bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800/60 text-rose-700 dark:text-rose-300 px-3.5 py-2.5 rounded-lg text-xs">
            {error}
          </div>
        )}

        <form
          onSubmit={handleLogin}
          autoComplete="off"
          className={`space-y-4 ${
            customAuthConfigured === false ? 'pt-3 border-t border-slate-200 dark:border-slate-800' : ''
          }`}
        >
          <div>
            <label
              className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
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
              className="w-full bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded-lg px-3.5 py-2 text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:border-emerald-500 transition-colors"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={loading}
              placeholder="operator"
            />
          </div>
          <div>
            <label
              className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
              htmlFor="workspace-key"
            >
              Workspace Passkey (<span className="font-mono">ADMIN_PASS</span>)
            </label>
            <div className="relative">
              <input
                id="workspace-key"
                name="workspace_access_token_field"
                type={showKey ? 'text' : 'password'}
                autoComplete="new-password"
                data-1p-ignore="true"
                data-lpignore="true"
                className="w-full bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded-lg pl-3.5 pr-10 py-2 text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:border-emerald-500 transition-colors"
                value={accessKey}
                onChange={(e) => setAccessKey(e.target.value)}
                disabled={loading}
                placeholder="Enter workspace passkey..."
              />
              <button
                type="button"
                onClick={() => setShowKey((prev) => !prev)}
                aria-label={showKey ? 'Hide passkey' : 'Show passkey'}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 p-1 cursor-pointer"
              >
                {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-slate-900 dark:bg-slate-800 hover:bg-slate-800 dark:hover:bg-slate-700 border border-slate-800 dark:border-slate-700 text-white font-medium py-2.5 px-4 rounded-lg text-xs transition-colors flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
          >
            <KeyRound className="h-3.5 w-3.5 text-emerald-400" />
            Verify Workspace Passkey
          </button>
        </form>

        <div className="pt-3 border-t border-slate-200 dark:border-slate-800 text-center">
          <Link
            href="/"
            className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 transition-colors"
          >
            ← Return to Public Intelligence Workbench
          </Link>
        </div>
      </motion.div>
    </div>
  );
}
