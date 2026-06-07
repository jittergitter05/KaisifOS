'use client';
import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      window.location.href = '/login';
    } catch (e) {
      console.error('Logout failed', e);
    }
  };

  return (
    <div className="flex flex-col min-h-screen w-full bg-slate-900 text-slate-50">
      <header className="h-16 border-b border-slate-800 px-4 sm:px-8 flex items-center justify-between bg-slate-950/80 backdrop-blur-md shrink-0 sticky top-0 z-50">
        <div className="flex items-center space-x-3 sm:space-x-4">
          <Link href="/">
            <img src="/icon" alt="KaisifOS Logo" className="w-8 h-8 rounded shrink-0 cursor-pointer hover:opacity-80 transition-opacity" />
          </Link>
          <div className="flex flex-col">
            <h1 className="text-base sm:text-lg font-bold tracking-tight">KaisifOS Admin</h1>
            <p className="text-[9px] sm:text-[10px] text-slate-500 uppercase tracking-widest hidden sm:block">Protected Area</p>
          </div>
        </div>
        <div className="flex space-x-2 sm:space-x-4 items-center">
          <Link href="/admin/tracker" className="text-[10px] sm:text-xs font-semibold text-slate-400 hover:text-white transition-colors">
            Tracker
          </Link>
          <Link href="/admin/digest" className="text-[10px] sm:text-xs font-semibold text-slate-400 hover:text-white transition-colors">
            Digest
          </Link>
          <div className="w-px h-4 bg-slate-800 mx-2"></div>
          <button 
            onClick={handleLogout}
            className="text-[10px] sm:text-xs text-red-400 hover:text-red-300 font-mono transition-colors border border-red-500/30 px-3 py-1.5 rounded bg-slate-900 hover:bg-red-500/10"
          >
            Logout
          </button>
        </div>
      </header>
      <div className="flex-1 overflow-x-hidden flex flex-col">
        {children}
      </div>
    </div>
  );
}
