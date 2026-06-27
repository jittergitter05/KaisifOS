'use client';
import React, { useEffect, useState, useMemo } from 'react';
import StatusBadge from '@/components/StatusBadge';
import MetricBar from '@/components/MetricBar';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { motion } from 'motion/react';

const ClientChart = dynamic(() => import('@/components/ClientChart'), { ssr: false });

interface JobRow {
  rowId: number; date: string; id: string; title: string; company: string; score: number;
  url: string; dm: string; status: string;
}

export default function TrackerPage() {
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('ALL');
  const [sortField, setSortField] = useState<'date' | 'score' | 'company'>('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [searchQuery, setSearchQuery] = useState('');

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
      await fetch('/api/sheet-sync', {
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

  const filteredJobs = useMemo(() => {
    let result = filter === 'ALL' ? jobs : jobs.filter(j => j.status === filter);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(j => j.title.toLowerCase().includes(q) || j.company.toLowerCase().includes(q));
    }
    result = [...result].sort((a, b) => {
       const valA = a[sortField];
       const valB = b[sortField];
       
       if (sortField === 'score') {
          return sortDir === 'asc' ? Number(valA) - Number(valB) : Number(valB) - Number(valA);
       }
       if (sortField === 'date') {
          const dA = new Date(valA as string).getTime();
          const dB = new Date(valB as string).getTime();
          return sortDir === 'asc' ? dA - dB : dB - dA;
       }
       if (typeof valA === 'string' && typeof valB === 'string') {
          return sortDir === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
       }
       return 0;
    });
    return result;
  }, [jobs, filter, sortField, sortDir, searchQuery]);

  const appliedCount = jobs.filter(j => ['APPLIED', 'REPLIED', 'INTERVIEW', 'REJECTED'].includes(j.status)).length;
  const intCount = jobs.filter(j => j.status === 'INTERVIEW').length;
  const intRate = appliedCount > 0 ? ((intCount / appliedCount) * 100).toFixed(1) : '0.0';
  const avgScore = jobs.length > 0 ? Math.round(jobs.reduce((a, b) => a + b.score, 0) / jobs.length) : 0;

  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const velocity7d = jobs.filter(j => 
    ['APPLIED', 'REPLIED', 'INTERVIEW', 'REJECTED'].includes(j.status) && 
    new Date(j.date) >= weekAgo
  ).length;

  // Statistical probability of getting at least 1 offer based on applied count
  // Using a conservative 1.5% offer rate per cold application for freshers
  const p = 0.015;
  const hireProb = appliedCount > 0 ? ((1 - Math.pow(1 - p, appliedCount)) * 100).toFixed(1) : '0.0';

  const toggleSort = (field: 'date' | 'score' | 'company') => {
    if (sortField === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  const SortIcon = ({ field }: { field: 'date' | 'score' | 'company' }) => {
    if (sortField !== field) return <span className="opacity-0 group-hover:opacity-30 ml-1">↓</span>;
    return <span className="text-emerald-400 ml-1">{sortDir === 'asc' ? '↑' : '↓'}</span>;
  };

  return (
    <div className="flex flex-col flex-1 w-full bg-slate-900 text-slate-50">
      <motion.main 
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="flex-1 p-4 sm:p-8 flex flex-col lg:grid lg:grid-cols-12 gap-6 pb-24 max-w-[1600px] mx-auto w-full"
      >
        <div className="lg:col-span-3 flex-shrink-0">
          <div className="flex flex-col mb-6">
            <h1 className="text-3xl font-bold tracking-tight text-white mb-2">Job Tracker</h1>
            <p className="text-sm text-slate-400">Manage and monitor your job pipeline</p>
          </div>
          
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-1 gap-4 lg:gap-6">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 sm:p-5">
              <div className="text-[10px] sm:text-xs text-slate-500 uppercase tracking-widest mb-2 sm:mb-4 font-semibold">Total Leads</div>
              <div className="text-xl sm:text-2xl font-mono text-white">{jobs.length}</div>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 sm:p-5">
              <div className="text-[10px] sm:text-xs text-slate-500 uppercase tracking-widest mb-2 sm:mb-4 font-semibold">Applied</div>
              <div className="text-xl sm:text-2xl font-mono text-blue-400">{appliedCount}</div>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 sm:p-5">
              <div className="text-[10px] sm:text-xs text-slate-500 uppercase tracking-widest mb-2 sm:mb-4 font-semibold">7d Velocity</div>
              <div className="text-xl sm:text-2xl font-mono text-emerald-400">{velocity7d} apps</div>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 sm:p-5">
              <div className="text-[10px] sm:text-xs text-slate-500 uppercase tracking-widest mb-2 sm:mb-4 font-semibold">Interviews</div>
              <div className="text-xl sm:text-2xl font-mono text-purple-400">{intCount}</div>
              <div className="text-[9px] sm:text-[10px] text-purple-500 mt-1">{intRate}% rate</div>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 sm:p-5">
              <div className="text-[10px] sm:text-xs text-slate-500 uppercase tracking-widest mb-2 sm:mb-4 font-semibold">Avg Match</div>
              <div className="text-xl sm:text-2xl font-mono text-indigo-400">{avgScore}</div>
            </div>
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 sm:p-5">
              <div className="text-[10px] sm:text-xs text-slate-500 uppercase tracking-widest mb-2 sm:mb-4 font-semibold">Hire Prob</div>
              <div className="text-xl sm:text-2xl font-mono text-amber-400">{hireProb}%</div>
            </div>
            
            {chartData.length > 0 && (
               <div className="col-span-2 sm:col-span-3 lg:col-span-1 bg-slate-900 border border-slate-800 rounded-xl p-4 sm:p-5 mb-4 lg:mb-10">
                 <div className="text-[10px] sm:text-xs text-slate-500 uppercase tracking-widest mb-2 sm:mb-4 font-semibold">Match Trend (30d)</div>
                 <div className="h-24 sm:h-32 w-full">
                   <ClientChart data={chartData} />
                 </div>
               </div>
            )}
          </div>
        </div>

        <div className="lg:col-span-9 flex flex-col bg-slate-900 border border-slate-800 rounded-xl">
          <div className="p-3 sm:p-4 border-b border-slate-800 flex flex-col sm:flex-row items-center justify-between shrink-0 gap-3">
            <div className="flex space-x-2 overflow-x-auto whitespace-nowrap hide-scrollbar w-full sm:w-auto pb-2 sm:pb-0">
              {['ALL', 'NEW', 'APPLIED', 'REPLIED', 'INTERVIEW', 'REJECTED', 'IGNORED'].map(f => (
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
            <div className="relative w-full sm:w-64 shrink-0">
              <svg className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                placeholder="Search jobs or companies..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-9 pr-4 py-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 transition-colors"
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[700px]">
              <thead className="text-[10px] text-slate-500 uppercase tracking-wider bg-slate-950/50 sticky top-0 z-10">
                <tr className="border-b border-slate-800">
                  <th className="px-6 py-3 font-semibold cursor-pointer group hover:text-slate-300 transition-colors" onClick={() => toggleSort('date')}>
                    Date <SortIcon field="date" />
                  </th>
                  <th className="px-6 py-3 font-semibold cursor-pointer group hover:text-slate-300 transition-colors" onClick={() => toggleSort('company')}>
                    Company / Role <SortIcon field="company" />
                  </th>
                  <th className="px-6 py-3 font-semibold cursor-pointer group hover:text-slate-300 transition-colors" onClick={() => toggleSort('score')}>
                    Match Score <SortIcon field="score" />
                  </th>
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
                           {['NEW', 'APPLIED', 'REPLIED', 'INTERVIEW', 'REJECTED', 'IGNORED'].map(s => <option className="bg-slate-900 text-slate-500" key={s} value={s}>{s}</option>)}
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
      </motion.main>
    </div>
  );
}
