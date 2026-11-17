'use client';
import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Search,
  Radar,
  Terminal,
  User,
  Settings,
  Home,
  Sun,
  Play,
  X,
  ArrowRight,
  Loader2,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';

interface CommandAction {
  id: string;
  label: string;
  hint: string;
  section: 'Navigation' | 'Operations' | 'Preferences';
  icon: React.ComponentType<{ className?: string }>;
  perform: () => void | Promise<void>;
}

export default function CommandPalette({
  open: controlledOpen,
  onOpenChange,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const router = useRouter();
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen !== undefined ? controlledOpen : internalOpen;

  const setOpen = useCallback(
    (v: boolean) => {
      setInternalOpen(v);
      if (onOpenChange) onOpenChange(v);
    },
    [onOpenChange]
  );

  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [sweeping, setSweeping] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(!open);
      } else if (e.key === 'Escape' && open) {
        e.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, setOpen]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIndex(0);
    } else {
      setFeedback(null);
    }
  }, [open]);

  const triggerLiveSweep = useCallback(async () => {
    setSweeping(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/scout/live', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFeedback({ ok: false, text: data?.error || `Sweep failed (HTTP ${res.status})` });
      } else {
        setFeedback({
          ok: true,
          text: `Swept ${data.scanned ?? 0} live roles · Added ${data.addedCount ?? 0} high-fit leads.`,
        });
        router.refresh();
      }
    } catch {
      setFeedback({ ok: false, text: 'Network error while running live Direct-ATS sweep.' });
    } finally {
      setSweeping(false);
    }
  }, [router]);

  const toggleTheme = useCallback(() => {
    const isLight = document.documentElement.classList.contains('light');
    const next = isLight ? 'dark' : 'light';
    try {
      localStorage.setItem('career_os_theme', next);
    } catch {
      // ignore storage quota errors
    }
    document.documentElement.classList.remove('dark', 'light');
    document.documentElement.classList.add(next);
    setOpen(false);
  }, [setOpen]);

  const actions: CommandAction[] = useMemo(
    () => [
      {
        id: 'nav-tracker',
        label: 'Pipeline Tracker & 4-Pillar Audit Ledger',
        hint: '/admin/tracker',
        section: 'Navigation',
        icon: Radar,
        perform: () => {
          setOpen(false);
          router.push('/admin/tracker');
        },
      },
      {
        id: 'nav-digest',
        label: 'Executive Scout Digest',
        hint: '/admin/digest',
        section: 'Navigation',
        icon: Terminal,
        perform: () => {
          setOpen(false);
          router.push('/admin/digest');
        },
      },
      {
        id: 'nav-profile',
        label: 'Owner Profile, CV Parser & ATS Targets',
        hint: '/admin/profile',
        section: 'Navigation',
        icon: User,
        perform: () => {
          setOpen(false);
          router.push('/admin/profile');
        },
      },
      {
        id: 'nav-settings',
        label: 'System Audit & Failover Telemetry',
        hint: '/admin/settings',
        section: 'Navigation',
        icon: Settings,
        perform: () => {
          setOpen(false);
          router.push('/admin/settings');
        },
      },
      {
        id: 'nav-home',
        label: 'Public Workbench & Evaluator',
        hint: '/#evaluator',
        section: 'Navigation',
        icon: Home,
        perform: () => {
          setOpen(false);
          router.push('/#evaluator');
        },
      },
      {
        id: 'op-sweep',
        label: 'Run Live Direct-ATS & Feed Sweep',
        hint: 'POST /api/scout/live',
        section: 'Operations',
        icon: Play,
        perform: triggerLiveSweep,
      },
      {
        id: 'pref-theme',
        label: 'Toggle Light / Dark Console Theme',
        hint: 'Alabaster / Slate',
        section: 'Preferences',
        icon: Sun,
        perform: toggleTheme,
      },
    ],
    [router, setOpen, triggerLiveSweep, toggleTheme]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return actions;
    return actions.filter(
      (a) =>
        a.label.toLowerCase().includes(q) ||
        a.hint.toLowerCase().includes(q) ||
        a.section.toLowerCase().includes(q)
    );
  }, [actions, query]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[14vh] px-4 bg-black/50 dark:bg-black/65 backdrop-blur-xs"
      onClick={() => setOpen(false)}
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <div
        className="w-full max-w-lg bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0D131F]">
          <Search className="h-4 w-4 text-slate-400 shrink-0" />
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActiveIndex((prev) => (filtered.length ? (prev + 1) % filtered.length : 0));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActiveIndex((prev) =>
                  filtered.length ? (prev - 1 + filtered.length) % filtered.length : 0
                );
              } else if (e.key === 'Enter' && filtered[activeIndex]) {
                e.preventDefault();
                filtered[activeIndex].perform();
              }
            }}
            placeholder="Jump to module, toggle theme, or trigger ATS sweep..."
            className="flex-1 bg-transparent text-xs text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none border-0"
          />
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close command palette"
            className="text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white p-1 rounded cursor-pointer"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {feedback && (
          <div
            className={`px-4 py-2.5 text-xs font-mono border-b border-slate-200 dark:border-slate-800 flex items-center gap-2 ${
              feedback.ok
                ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
                : 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300'
            }`}
          >
            {feedback.ok ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
            ) : (
              <AlertTriangle className="h-3.5 w-3.5 text-rose-600 dark:text-rose-400 shrink-0" />
            )}
            <span>{feedback.text}</span>
          </div>
        )}

        <div className="max-h-80 overflow-y-auto divide-y divide-slate-200/70 dark:divide-slate-800/60">
          {filtered.length === 0 ? (
            <div className="py-8 text-center text-xs font-mono text-slate-500 dark:text-slate-400">
              No matching console commands.
            </div>
          ) : (
            filtered.map((item, idx) => {
              const Icon = item.icon;
              const isSelected = idx === activeIndex;
              const isBusy = item.id === 'op-sweep' && sweeping;
              return (
                <button
                  key={item.id}
                  type="button"
                  onMouseEnter={() => setActiveIndex(idx)}
                  onClick={() => item.perform()}
                  disabled={isBusy}
                  className={`w-full px-4 py-3 flex items-center justify-between gap-3 text-left transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-slate-100 dark:bg-slate-800/80'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {isBusy ? (
                      <Loader2 className="h-4 w-4 text-emerald-500 dark:text-emerald-400 animate-spin shrink-0" />
                    ) : (
                      <Icon
                        className={`h-4 w-4 shrink-0 ${
                          isSelected
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-slate-400'
                        }`}
                      />
                    )}
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-slate-900 dark:text-white truncate">
                        {item.label}
                      </div>
                      <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 truncate">
                        {item.section} · {item.hint}
                      </div>
                    </div>
                  </div>
                  <ArrowRight className="h-3.5 w-3.5 text-slate-400 dark:text-slate-500 shrink-0" />
                </button>
              );
            })
          )}
        </div>

        <div className="px-4 py-2 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0D131F] flex items-center justify-between text-[11px] font-mono text-slate-500 dark:text-slate-400">
          <span>↑↓ Navigate · ↵ Run · Esc Close</span>
          <span>⌘K / Ctrl+K</span>
        </div>
      </div>
    </div>
  );
}
