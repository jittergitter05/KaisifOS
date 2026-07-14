'use client';
import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter, usePathname } from 'next/navigation';
import { Terminal, Radar, LogOut, Cpu, Fingerprint } from 'lucide-react';
import { Button } from '@/components/ui/button';

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
      <aside className="fixed inset-y-0 left-0 z-10 hidden w-64 flex-col border-r border-slate-800 bg-slate-950 sm:flex">
        <div className="flex h-16 shrink-0 items-center px-6 border-b border-slate-800">
          <Link href="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
            <Cpu className="h-6 w-6 text-emerald-500" />
            <div className="flex flex-col">
              <span className="text-lg font-bold tracking-tight">KaisifOS</span>
              <span className="text-[10px] text-slate-500 uppercase tracking-widest font-mono">Core System</span>
            </div>
          </Link>
        </div>
        <nav className="flex flex-1 flex-col gap-2 p-4">
          <div className="px-2 mb-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">Modules</div>
          <Link 
            href="/admin/tracker" 
            className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-all ${
              pathname === '/admin/tracker' 
                ? 'bg-slate-800 text-emerald-400 font-medium' 
                : 'text-slate-400 hover:text-slate-50 hover:bg-slate-800/50'
            }`}
          >
            <Radar className="h-4 w-4" />
            Tracker
          </Link>
          <Link 
            href="/admin/digest" 
            className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-all ${
              pathname === '/admin/digest' 
                ? 'bg-slate-800 text-emerald-400 font-medium' 
                : 'text-slate-400 hover:text-slate-50 hover:bg-slate-800/50'
            }`}
          >
            <Terminal className="h-4 w-4" />
            Digest Log
          </Link>
        </nav>
        <div className="p-4 border-t border-slate-800">
          <Button variant="ghost" className="w-full justify-start text-slate-400 hover:text-red-400 hover:bg-red-500/10" onClick={handleLogout}>
            <LogOut className="mr-2 h-4 w-4" />
            Disconnect
          </Button>
        </div>
      </aside>

      <div className="flex flex-1 flex-col sm:pl-64">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-4 border-b border-slate-800 bg-slate-950/80 px-4 backdrop-blur-md sm:px-6">
          <div className="flex sm:hidden items-center gap-3">
             <Cpu className="h-6 w-6 text-emerald-500" />
             <span className="text-lg font-bold">KaisifOS</span>
          </div>
          <div className="flex-1" />
          <div className="flex items-center gap-4">
            <div className="hidden sm:flex items-center gap-2 text-xs text-slate-500 font-mono bg-slate-900 px-3 py-1.5 rounded-full border border-slate-800">
              <Fingerprint className="h-3.5 w-3.5 text-emerald-500" />
              Authenticated Session
            </div>
          </div>
        </header>
        <main className="flex-1 overflow-x-hidden bg-slate-950 p-4 sm:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
