'use client';
import React from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { Terminal, Radar, LogOut, Cpu, Fingerprint, User, Settings, LayoutDashboard } from 'lucide-react';
import { Button } from '@/components/ui/button';

const NAV_ITEMS = [
  { href: '/admin/tracker', label: 'Tracker', icon: Radar },
  { href: '/admin/digest', label: 'Digest', icon: Terminal },
  { href: '/admin/profile', label: 'Profile', icon: User },
  { href: '/admin/settings', label: 'Settings', icon: Settings },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      window.location.href = '/login';
    } catch (e) {
      console.error('Logout failed', e);
    }
  };

  return (
    <div className="flex min-h-screen w-full bg-slate-950 text-slate-50 font-sans selection:bg-emerald-500/30">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-10 hidden w-56 flex-col border-r border-slate-800 bg-slate-950 sm:flex">
        <div className="flex h-14 shrink-0 items-center px-5 border-b border-slate-800">
          <Link href="/" className="flex items-center gap-2.5 hover:opacity-80 transition-opacity">
            <Cpu className="h-5 w-5 text-emerald-500" />
            <div className="flex flex-col">
              <span className="text-sm font-bold tracking-tight">KaisifOS</span>
              <span className="text-[9px] text-slate-500 uppercase tracking-widest font-mono">Core System</span>
            </div>
          </Link>
        </div>
        <nav className="flex flex-1 flex-col gap-1 p-3">
          <div className="px-2 mb-2 text-[9px] font-semibold text-slate-600 uppercase tracking-wider">Modules</div>
          {NAV_ITEMS.map(item => {
            const Icon = item.icon;
            const isActive = pathname === item.href;
            return (
              <Link key={item.href} href={item.href} className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs transition-all ${isActive ? 'bg-slate-800 text-emerald-400 font-medium' : 'text-slate-400 hover:text-slate-50 hover:bg-slate-800/50'}`}>
                <Icon className="h-3.5 w-3.5" />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="p-3 border-t border-slate-800">
          <Button variant="ghost" className="w-full justify-start text-slate-400 hover:text-red-400 hover:bg-red-500/10 text-xs h-8" onClick={handleLogout}>
            <LogOut className="mr-2 h-3.5 w-3.5" />
            Disconnect
          </Button>
        </div>
      </aside>

      <div className="flex flex-1 flex-col sm:pl-56">
        {/* Top header */}
        <header className="sticky top-0 z-30 flex h-14 items-center gap-4 border-b border-slate-800 bg-slate-950/80 px-4 backdrop-blur-md sm:px-6">
          <div className="flex sm:hidden items-center gap-2">
            <Cpu className="h-5 w-5 text-emerald-500" />
            <span className="text-sm font-bold">KaisifOS</span>
          </div>
          <div className="flex-1" />
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-1.5 text-[10px] text-slate-500 font-mono bg-slate-900 px-2.5 py-1 rounded-full border border-slate-800">
              <Fingerprint className="h-3 w-3 text-emerald-500" />
              Authenticated
            </div>
          </div>
        </header>

        {/* Mobile bottom nav */}
        <nav className="sm:hidden fixed bottom-0 left-0 right-0 z-30 bg-slate-950 border-t border-slate-800 flex items-center justify-around py-2 backdrop-blur-md">
          {NAV_ITEMS.map(item => {
            const Icon = item.icon;
            const isActive = pathname === item.href;
            return (
              <Link key={item.href} href={item.href} className={`flex flex-col items-center gap-0.5 px-3 py-1 rounded-lg transition-colors ${isActive ? 'text-emerald-400' : 'text-slate-500'}`}>
                <Icon className="h-4 w-4" />
                <span className="text-[9px]">{item.label}</span>
              </Link>
            );
          })}
          <button onClick={handleLogout} className="flex flex-col items-center gap-0.5 px-3 py-1 text-slate-500 hover:text-red-400">
            <LogOut className="h-4 w-4" />
            <span className="text-[9px]">Exit</span>
          </button>
        </nav>

        <main className="flex-1 overflow-x-hidden bg-slate-950">
          {children}
        </main>
      </div>
    </div>
  );
}
