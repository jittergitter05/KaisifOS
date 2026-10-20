'use client';
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Terminal, Radar, LogOut, User, Settings, ArrowUpRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import ThemeToggle from '@/components/ThemeToggle';

const NAV_ITEMS = [
  { href: '/admin/tracker', label: 'Pipeline Tracker', shortLabel: 'Tracker', icon: Radar },
  { href: '/admin/digest', label: 'Scout Digest', shortLabel: 'Digest', icon: Terminal },
  { href: '/admin/profile', label: 'Owner & Targeting', shortLabel: 'Profile', icon: User },
  { href: '/admin/settings', label: 'System Audit', shortLabel: 'Audit', icon: Settings },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [brandName, setBrandName] = useState('CareerOS');
  const [ownerName, setOwnerName] = useState('Active Owner');

  useEffect(() => {
    fetch('/api/profile?public=true')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.system_name) setBrandName(d.system_name);
        if (d?.name) setOwnerName(d.name);
      })
      .catch(() => {});
  }, [pathname]);

  const currentModule =
    NAV_ITEMS.find((item) => pathname.startsWith(item.href))?.label || 'Operator Console';

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      window.location.href = '/login';
    } catch (e) {
      console.error('Logout failed', e);
    }
  };

  return (
    <div className="flex min-h-screen w-full bg-[#0B0F17] text-[#F8FAFC] font-sans">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-60 flex-col border-r border-slate-800/90 bg-[#0B0F17] sm:flex">
        <div className="flex h-14 shrink-0 items-center justify-between px-5 border-b border-slate-800/90">
          <Link
            href="/"
            className="text-base font-display font-bold tracking-tight text-white whitespace-nowrap shrink-0"
          >
            {brandName}
          </Link>
          <span className="text-[11px] font-mono text-emerald-400">v2.5</span>
        </div>

        <div className="px-4 py-2.5 border-b border-slate-800/70 bg-[#111827]/60">
          <div className="text-[10px] font-mono text-slate-400">Instance Owner</div>
          <div className="text-xs font-medium text-white truncate mt-0.5">{ownerName}</div>
        </div>

        <nav className="flex flex-1 flex-col gap-1 p-3">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  isActive
                    ? 'bg-slate-800/90 text-white border border-slate-700/80'
                    : 'text-slate-400 hover:text-slate-100 hover:bg-slate-900'
                }`}
              >
                <Icon className={`h-4 w-4 shrink-0 ${isActive ? 'text-emerald-400' : ''}`} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="p-3 border-t border-slate-800/90 space-y-1.5">
          <Link
            href="/#evaluator"
            className="flex items-center justify-between rounded-lg px-3 py-2 text-xs text-slate-400 hover:text-slate-100 hover:bg-slate-900 transition-colors whitespace-nowrap shrink-0"
          >
            <span>Live Role Evaluator</span>
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
          <Button
            variant="ghost"
            className="w-full justify-start text-slate-400 hover:text-rose-300 hover:bg-rose-950/30 text-xs h-8 px-3 whitespace-nowrap shrink-0"
            onClick={handleLogout}
          >
            <LogOut className="mr-2 h-3.5 w-3.5" />
            Lock Session
          </Button>
        </div>
      </aside>

      <div className="flex flex-1 flex-col sm:pl-60 min-w-0">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-4 border-b border-slate-800/90 bg-[#0B0F17]/90 px-4 sm:px-6 backdrop-blur-md">
          <div className="flex items-center gap-2 text-xs text-slate-400 min-w-0 truncate">
            <Link href="/" className="hover:text-slate-200 transition-colors shrink-0 font-semibold text-white">
              {brandName}
            </Link>
            <span aria-hidden="true">/</span>
            <span className="text-slate-400 hidden sm:inline shrink-0">{ownerName}</span>
            <span aria-hidden="true" className="hidden sm:inline">
              /
            </span>
            <span className="font-medium text-emerald-400 truncate">{currentModule}</span>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <ThemeToggle />
            <Link
              href="/"
              className="px-3 py-1.5 text-xs font-medium text-slate-200 bg-slate-900 hover:bg-slate-800 border border-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              Public Workbench
            </Link>
          </div>
        </header>

        <nav className="sm:hidden fixed bottom-0 left-0 right-0 z-30 bg-[#0B0F17]/95 border-t border-slate-800 flex items-center justify-around py-1.5 backdrop-blur-md">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex flex-col items-center gap-0.5 px-3 py-1 rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                  isActive ? 'text-emerald-400 font-medium' : 'text-slate-400'
                }`}
              >
                <Icon className="h-4 w-4" />
                <span className="text-[10px]">{item.shortLabel}</span>
              </Link>
            );
          })}
          <button
            type="button"
            onClick={handleLogout}
            className="flex flex-col items-center gap-0.5 px-3 py-1 text-slate-400 hover:text-rose-400 whitespace-nowrap shrink-0"
          >
            <LogOut className="h-4 w-4" />
            <span className="text-[10px]">Lock</span>
          </button>
        </nav>

        <main className="flex-1 overflow-x-hidden bg-[#0B0F17]">{children}</main>
      </div>
    </div>
  );
}
