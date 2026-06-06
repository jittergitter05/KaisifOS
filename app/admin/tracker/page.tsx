'use client';
import React, { useEffect, useState, useMemo } from 'react';
import StatusBadge from '@/components/StatusBadge';
import MetricBar from '@/components/MetricBar';
import Link from 'next/link';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

interface JobRow {
  rowId: number; date: string; id: string; title: string; company: string; score: number;
  url: string; dm: string; status: string;
}

export default function TrackerPage() {
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('ALL');

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/admin/sheet-sync')
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
          const parsedJobs = data.rows.map((r: any[], i: number) => ({
            rowId: i + 1, date: r[0] || '', id: r[1] || '', title: r[2] || '', company: r[3] || '',
            score: parseInt(r[4] || '0', 10), url: r[7] || '', dm: r[8] || '', status: r[10] || 'NEW',
          })).filter((j: JobRow) => j.title !== 'Title' && j.id); 
          setJobs(parsedJobs.reverse());
        }
        setLoading(false);
      })
      .catch((err) => {
        console.error(err);
        setError('Failed to load tracker data. Please check your connection.');
        setLoading(false);
      });
  }, []);

  const updateStatus = async (rowId: number, newStatus: string) => {
    const originalJobs = [...jobs];
    setJobs(jobs.map(j => j.rowId === rowId ? { ...j, status: newStatus } : j));
    try {
      await fetch('/api/admin/sheet-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rowId, status: newStatus }),
      });
    } catch (e) { console.error('Update failed', e); setJobs(originalJobs); }
  };

  const chartData = useMemo(() => {
    if (jobs.length === 0) return [];
    
    // get last 30 days of data
    const last30Days = new Date();
    last30Days.setDate(last30Days.getDate() - 30);
    
    // Group jobs by date (date format is usually YYYY-MM-DD or MM/DD/YYYY)
    const dailyScores: Record<string, { total: number, count: number }> = {};
    
    jobs.forEach(job => {
      const jobDate = new Date(job.date);
      if (jobDate >= last30Days) {
        // Group by short date part
        const dateKey = job.date.split('T')[0].slice(-5); // Use last 5 chars, usually MM-DD
        if (!dailyScores[dateKey]) {
           dailyScores[dateKey] = { total: 0, count: 0 };
        }
        dailyScores[dateKey].total += job.score;
        dailyScores[dateKey].count += 1;
      }
    });
    
    return Object.keys(dailyScores).sort().map(date => ({
      date,
      avgScore: Math.round(dailyScores[date].total / dailyScores[date].count)
    }));
  }, [jobs]);

  const filteredJobs = filter === 'ALL' ? jobs : jobs.filter(j => j.status === filter);
  const appliedCount = jobs.filter(j => ['APPLIED', 'REPLIED', 'INTERVIEW', 'REJECTED'].includes(j.status)).length;
  const intCount = jobs.filter(j => j.status === 'INTERVIEW').length;
  const intRate = appliedCount > 0 ? ((intCount / appliedCount) * 100).toFixed(1) : '0.0';
  const avgScore = jobs.length > 0 ? Math.round(jobs.reduce((a, b) => a + b.score, 0) / jobs.length) : 0;

  return (
    <div className="flex flex-col flex-1 w-full bg-slate-900 text-slate-50">
      <header className="h-16 border-b border-slate-800 px-8 flex items-center justify-between bg-slate-900/50 backdrop-blur-md shrink-0">
        <div className="flex items-center space-x-4">
          <Link href="/"><div className="w-8 h-8 bg-emerald-500 rounded flex items-center justify-center font-bold text-white font-mono text-xl">K</div></Link>
          <div className="flex flex-col"><h1 className="text-lg font-bold tracking-tight">Job Tracker</h1><p className="text-[10px] text-slate-500 uppercase tracking-widest">KaisifOS Pipeline</p></div>
        </div>
        <div className="flex space-x-4">
            <Link href="/admin/digest" className="text-xs text-slate-400 hover:text-emerald-400 font-mono transition-colors border border-slate-800 px-3 py-1.5 rounded bg-slate-900 hover:border-emerald-500/30">View Digest</Link>
        </div>
      </header>

      <main className="flex-1 p-4 sm:p-8 flex flex-col lg:grid lg:grid-cols-12 gap-6 pb-24">
        <div className="lg:col-span-3 flex-shrink-0">
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-1 gap-4 lg:gap-6">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 sm:p-5">
              <div className="text-[10px] sm:text-xs text-slate-500 uppercase tracking-widest mb-2 sm:mb-4 font-semibold">Total Leads</div>
              <div className="text-xl sm:text-2xl font-mono text-white">{jobs.length}</div>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 sm:p-5">
              <div className="text-[10px] sm:text-xs text-slate-500 uppercase tracking-widest mb-2 sm:mb-4 font-semibold">Applied</div>
              <div className="text-xl sm:text-2xl font-mono text-blue-400">{appliedCount}</div>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 sm:p-5">
              <div className="text-[10px] sm:text-xs text-slate-500 uppercase tracking-widest mb-2 sm:mb-4 font-semibold">Interviews</div>
              <div className="text-xl sm:text-2xl font-mono text-purple-400">{intCount}</div>
              <div className="text-[9px] sm:text-[10px] text-purple-500 mt-1">{intRate}% rate</div>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 sm:p-5">
              <div className="text-[10px] sm:text-xs text-slate-500 uppercase tracking-widest mb-2 sm:mb-4 font-semibold">Avg Match</div>
              <div className="text-xl sm:text-2xl font-mono text-emerald-400">{avgScore}</div>
            </div>
            
            {chartData.length > 0 && (
               <div className="col-span-2 sm:col-span-4 lg:col-span-1 bg-slate-900 border border-slate-800 rounded-xl p-4 sm:p-5 mb-4 lg:mb-10">
                 <div className="text-[10px] sm:text-xs text-slate-500 uppercase tracking-widest mb-2 sm:mb-4 font-semibold">Match Trend (30d)</div>
                 <div className="h-24 sm:h-32 w-full">
                   <ResponsiveContainer width="100%" height="100%">
                     <LineChart data={chartData}>
                       <XAxis dataKey="date" hide />
                       <YAxis hide domain={['dataMin - 5', 100]} />
                       <Tooltip 
                         contentStyle={{ backgroundColor: '#1E293B', border: '1px solid #334155', borderRadius: '8px', fontSize: '10px' }}
                         itemStyle={{ color: '#10B981' }}
                         labelStyle={{ color: '#94A3B8', marginBottom: '4px' }}
                       />
                       <Line type="monotone" dataKey="avgScore" name="Avg Score" stroke="#10B981" strokeWidth={2} dot={false} />
                     </LineChart>
                   </ResponsiveContainer>
                 </div>
               </div>
            )}
          </div>
        </div>

        <div className="lg:col-span-9 flex flex-col bg-slate-900 border border-slate-800 rounded-xl">
          <div className="p-3 sm:p-4 border-b border-slate-800 items-center justify-between shrink-0 overflow-x-auto whitespace-nowrap hide-scrollbar">
            <div className="flex space-x-2">
              {['ALL', 'NEW', 'APPLIED', 'REPLIED', 'INTERVIEW', 'REJECTED'].map(f => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-3 py-1 text-xs rounded-md border ${
                    filter === f ? 'bg-slate-800 text-white border-slate-700' : 'bg-transparent text-slate-400 border-transparent hover:bg-slate-800/50'
                  }`}
                >
                  {f === 'ALL' ? 'All' : f.charAt(0) + f.slice(1).toLowerCase()}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[700px]">
              <thead className="text-[10px] text-slate-500 uppercase tracking-wider bg-slate-950/50 sticky top-0 z-10">
                <tr className="border-b border-slate-800">
                  <th className="px-6 py-3 font-semibold">Date</th>
                  <th className="px-6 py-3 font-semibold">Company / Role</th>
                  <th className="px-6 py-3 font-semibold">Match Score</th>
                  <th className="px-6 py-3 font-semibold text-center">Status</th>
                  <th className="px-6 py-3 font-semibold text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {loading ? (
                  <tr><td colSpan={5} className="px-6 py-12 text-center text-sm font-mono text-slate-500">Loading tracker data...</td></tr>
                ) : error ? (
                  <tr><td colSpan={5} className="px-6 py-12 text-center text-sm font-mono text-red-400">{error}</td></tr>
                ) : filteredJobs.length === 0 ? (
                  <tr><td colSpan={5} className="px-6 py-12 text-center text-sm font-mono text-slate-500">No jobs found.</td></tr>
                ) : (
                  filteredJobs.map((job) => (
                    <tr key={job.rowId} className="hover:bg-slate-800/50 transition-colors">
                      <td className="px-6 py-4 whitespace-nowrap text-xs text-slate-500 font-mono">{job.date}</td>
                      <td className="px-6 py-4">
                        <div className="text-sm font-medium text-white">{job.company}</div>
                        <div className="text-xs text-slate-500">{job.title}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap"><MetricBar score={job.score} /></td>
                      <td className="px-6 py-4 whitespace-nowrap text-center">
                        <select 
                          value={job.status} 
                          onChange={(e) => updateStatus(job.rowId, e.target.value)}
                          className="bg-transparent text-xs font-bold uppercase focus:ring-0 cursor-pointer p-1 rounded opacity-0 absolute w-16 -ml-4 z-20"
                        >
                           {['NEW', 'APPLIED', 'REPLIED', 'INTERVIEW', 'REJECTED'].map(s => <option className="bg-slate-900 text-slate-500" key={s} value={s}>{s}</option>)}
                        </select>
                        <div className="relative z-10 inline-flex items-center justify-center"><StatusBadge status={job.status} /></div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right">
                        <a href={job.url} target="_blank" rel="noreferrer" className="text-emerald-500 hover:text-emerald-400 text-xs hover:underline transition-colors">Open &nearr;</a>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}
