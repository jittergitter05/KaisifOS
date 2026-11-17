import Link from 'next/link';
import { ArrowLeft, Radar, Terminal } from 'lucide-react';
import { siteConfig } from '@/config/site';

export default function NotFound() {
  return (
    <div className="flex flex-col min-h-screen w-full bg-slate-50 dark:bg-[#0B0F17] text-slate-900 dark:text-[#F8FAFC] items-center justify-center p-6">
      <div className="w-full max-w-md bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-xl p-8 space-y-6">
        <div className="space-y-2 border-b border-slate-200 dark:border-slate-800 pb-5">
          <div className="text-xs font-mono text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">
            404 · Route Not Found
          </div>
          <h1 className="text-2xl font-display font-bold text-slate-900 dark:text-white tracking-tight">
            Requested Console Route Missing
          </h1>
          <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
            This path does not map to an active workbench or pipeline ledger module. Return to the
            public evaluator or open the operator tracker.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-2.5">
          <Link
            href="/"
            className="flex-1 px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium inline-flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Public Workbench
          </Link>
          <Link
            href="/admin/tracker"
            className="flex-1 px-4 py-2.5 rounded-lg bg-slate-50 dark:bg-[#0B0F17] border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200 text-xs font-medium inline-flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap"
          >
            <Radar className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" /> Pipeline
            Tracker
          </Link>
        </div>

        <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-[11px] font-mono text-slate-500">
          <span className="inline-flex items-center gap-1.5">
            <Terminal className="h-3 w-3" /> {siteConfig.name}
          </span>
          <Link
            href="/admin/settings"
            className="hover:text-slate-800 dark:hover:text-slate-300 underline"
          >
            System Audit
          </Link>
        </div>
      </div>
    </div>
  );
}
