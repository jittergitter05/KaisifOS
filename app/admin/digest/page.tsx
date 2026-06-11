'use client';
import React, { useEffect, useState } from 'react';
import JobCard from '@/components/JobCard';
import Link from 'next/link';

export default function DigestPage() {
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/sheet-sync')
      .then(async res => {
        if (res.status === 401) {
          window.location.href = '/login';
          return null;
        }
        if (!res.ok) throw new Error('Failed to fetch data');
        return res.json();
      })
      .then(data => {
        if (data && data.rows) {
          const todayStr = new Date().toISOString().split('T')[0];
          const parsedJobs = data.rows.map((r: any[], i: number) => ({
            rowId: i + 1, Date: r[0] || '', Title: r[2] || '', Company: r[3] || '',
            Score: parseInt(r[4] || '0', 10), Reasons: r[5] || '', Gap: r[6] || '',
            URL: r[7] || '', DM: r[8] || '', ResumeAngle: r[9] || '', Status: r[10] || 'NEW',
          })).filter((j: any) => j.Title !== 'Title' && j.Date === todayStr && j.Score >= 70);
          setJobs(parsedJobs.sort((a,b) => b.Score - a.Score));
        }
        setLoading(false);
      })
      .catch((err) => {
        console.error(err);
        setError('Failed to load digest data.');
        setLoading(false);
      });
  }, []);

  return (
    <div className="flex flex-col flex-1 w-full bg-slate-900 text-slate-50">
      <header className="h-16 border-b border-slate-800 px-4 sm:px-8 flex items-center justify-between bg-slate-900/50 backdrop-blur-md shrink-0 sticky top-0 z-50">
        <div className="flex items-center space-x-3 sm:space-x-4">
          <Link href="/"><div className="w-8 h-8 bg-emerald-500 rounded flex items-center justify-center font-bold text-white font-mono text-xl">K</div></Link>
          <div className="flex flex-col"><h1 className="text-base sm:text-lg font-bold tracking-tight">Today's Digest</h1><p className="text-[9px] sm:text-[10px] text-slate-500 uppercase tracking-widest hidden sm:block">Scout Agent Matches</p></div>
        </div>
        <Link href="/admin/tracker" className="text-[10px] sm:text-xs text-slate-400 hover:text-emerald-400 font-mono transition-colors border border-slate-800 px-2 sm:px-3 py-1.5 rounded bg-slate-900 hover:border-emerald-500/30 whitespace-nowrap">Tracker &rarr;</Link>
      </header>
      <main className="flex-1 py-8 px-4 sm:px-6 lg:px-8 max-w-4xl mx-auto w-full pb-24">
        {loading ? <div className="text-center py-12 text-slate-500 font-mono text-xs">Loading today's matches...</div> :
         error ? <div className="text-center py-12 text-slate-500 font-mono text-xs text-red-400">{error}</div> :
         jobs.length === 0 ? <div className="text-center py-12 bg-slate-900 rounded-xl shadow-sm border border-slate-800 text-slate-400 gap-4 flex flex-col items-center"><p className="text-sm font-medium text-white">No top matches found today.</p><p className="text-[10px] font-mono text-slate-500 tracking-wider">Cron will run again tomorrow at 08:00 UTC</p></div> :
         <div className="space-y-6 pb-12">{jobs.map(job => <JobCard key={job.rowId} job={job} />)}</div>}
      </main>
    </div>
  );
}
