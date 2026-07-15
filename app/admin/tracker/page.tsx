'use client';
import React, { useEffect, useState, useMemo, useCallback } from 'react';
import StatusBadge, { ALL_STATUSES } from '@/components/StatusBadge';
import MetricBar from '@/components/MetricBar';
import dynamic from 'next/dynamic';
import { motion, AnimatePresence } from 'motion/react';
import { RefreshCw, Download, ChevronDown, ChevronRight, AlertTriangle, Zap, MessageSquareText, Target, TrendingUp, BarChart3, PieChart as PieChartIcon, Filter } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useKeyboardNav } from '@/hooks/useKeyboardNav';

const ClientChart = dynamic(() => import('@/components/ClientChart'), { ssr: false });

interface JobRow {
  rowId: number; date: string; id: string; title: string; company: string; score: number;
  reasons: string; gap: string; url: string; dm: string; resumeAngle: string; status: string;
  source: string;
}

// ─── Prediction model ───────────────────────────────────────────────────────
function predictReplyLikelihood(job: JobRow): number {
  const daysSinceApplied = Math.max(0, Math.floor((Date.now() - new Date(job.date).getTime()) / (1000 * 60 * 60 * 24)));
  if (!['APPLIED', 'SHORTLISTED'].includes(job.status)) return -1; // Not applicable

  let prob = 0;
  prob += job.score * 0.35;                                     // Score weight
  prob += daysSinceApplied < 3 ? 25 : daysSinceApplied < 7 ? 18 : daysSinceApplied < 14 ? 8 : 2;  // Recency
  prob += job.dm ? 10 : 0;                                      // Has outreach draft
  prob += job.resumeAngle ? 5 : 0;                               // Has resume angle
  return Math.min(99, Math.max(1, Math.round(prob)));
}

function isStale(job: JobRow): boolean {
  if (job.status !== 'APPLIED') return false;
  const days = Math.floor((Date.now() - new Date(job.date).getTime()) / (1000 * 60 * 60 * 24));
  return days >= 7;
}

// ─── CSV Export ──────────────────────────────────────────────────────────────
function exportToCSV(jobs: JobRow[]) {
  const headers = ['Date', 'ID', 'Title', 'Company', 'Score', 'Status', 'URL', 'Reasons', 'Gap', 'DM Draft', 'Resume Angle'];
  const rows = jobs.map(j => [j.date, j.id, j.title, j.company, j.score, j.status, j.url, j.reasons, j.gap, j.dm, j.resumeAngle].map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','));
  const csv = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `kaisifos-tracker-${new Date().toISOString().split('T')[0]}.csv`;
  link.click();
}

// ─── Source detection from job ID ─────────────────────────────────────────────
function detectSource(id: string): string {
  if (id.startsWith('internshala_')) return 'Internshala';
  if (id.startsWith('remoteok_')) return 'RemoteOK';
  if (id.startsWith('remotive_')) return 'Remotive';
  return 'JSearch';
}

export default function TrackerPage() {
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('ALL');
  const [sortField, setSortField] = useState<'date' | 'score' | 'company'>('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [searchQuery, setSearchQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [focusedRow, setFocusedRow] = useState(0);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [showAnalytics, setShowAnalytics] = useState(true);

  const fetchJobs = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch('/api/sheet-sync')
      .then(async res => {
        if (res.status === 401) { window.location.href = '/login'; return null; }
        if (!res.ok) throw new Error('Failed to fetch data');
        return res.json();
      })
      .then(data => {
        if (data && data.rows) {
          const parsedJobs = data.rows.map((r: string[], i: number) => ({
            rowId: i + 1, date: r[0] || '', id: r[1] || '', title: r[2] || '', company: r[3] || '',
            score: parseInt(r[4] || '0', 10), reasons: r[5] || '', gap: r[6] || '',
            url: r[7] || '', dm: r[8] || '', resumeAngle: r[9] || '', status: r[10] || 'NEW',
            source: detectSource(r[1] || ''),
          })).filter((j: JobRow) => j.title !== 'Title' && j.id);
          setJobs(parsedJobs.reverse());
        }
        setLoading(false);
      })
      .catch((err) => {
        console.error(err);
        setError('Failed to load tracker data.');
        setLoading(false);
      });
  }, []);

  useEffect(() => { fetchJobs(); }, [fetchJobs]);

  const updateStatus = async (rowId: number, newStatus: string) => {
    const originalJobs = [...jobs];
    setJobs(jobs.map(j => j.rowId === rowId ? { ...j, status: newStatus } : j));
    try {
      const res = await fetch('/api/sheet-sync', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rowId, status: newStatus }),
      });
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
    } catch (e) {
      console.error('Update failed', e);
      setJobs(originalJobs);
    }
  };

  const bulkUpdateStatus = async (newStatus: string) => {
    const ids = Array.from(selectedRows);
    const targets = filteredJobs.filter((_, i) => ids.includes(i));
    for (const job of targets) {
      await updateStatus(job.rowId, newStatus);
    }
    setSelectedRows(new Set());
  };

  const cycleStatus = useCallback((index: number) => {
    const job = filteredJobs[index];
    if (!job) return;
    const currentIdx = ALL_STATUSES.indexOf(job.status);
    const nextStatus = ALL_STATUSES[(currentIdx + 1) % ALL_STATUSES.length];
    updateStatus(job.rowId, nextStatus);
  }, [jobs, filter, searchQuery, sortField, sortDir]);

  // ─── Analytics ──────────────────────────────────────────────────────────────
  const analytics = useMemo(() => {
    if (jobs.length === 0) return null;
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

    // Weekly comparison
    const thisWeekJobs = jobs.filter(j => new Date(j.date) >= weekAgo);
    const lastWeekJobs = jobs.filter(j => { const d = new Date(j.date); return d >= twoWeeksAgo && d < weekAgo; });
    const thisWeekApplied = thisWeekJobs.filter(j => ['APPLIED', 'REPLIED', 'INTERVIEW', 'OFFER', 'REJECTED'].includes(j.status)).length;
    const lastWeekApplied = lastWeekJobs.filter(j => ['APPLIED', 'REPLIED', 'INTERVIEW', 'OFFER', 'REJECTED'].includes(j.status)).length;

    // Source breakdown
    const sources: Record<string, number> = {};
    jobs.forEach(j => { sources[j.source] = (sources[j.source] || 0) + 1; });

    // Stale count
    const staleCount = jobs.filter(isStale).length;

    // Pipeline funnel
    const pipeline: Record<string, number> = {};
    ALL_STATUSES.forEach(s => { pipeline[s] = jobs.filter(j => j.status === s).length; });

    // Chart data - last 30 days
    const last30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const dailyScores: Record<string, { total: number; count: number }> = {};
    jobs.forEach(job => {
      const jobDate = new Date(job.date);
      if (jobDate >= last30) {
        try {
          const dateKey = `${String(jobDate.getMonth() + 1).padStart(2, '0')}-${String(jobDate.getDate()).padStart(2, '0')}`;
          if (!dailyScores[dateKey]) dailyScores[dateKey] = { total: 0, count: 0 };
          dailyScores[dateKey].total += job.score;
          dailyScores[dateKey].count += 1;
        } catch {}
      }
    });
    const chartData = Object.keys(dailyScores).sort().map(date => ({
      date, avgScore: Math.round(dailyScores[date].total / dailyScores[date].count),
    }));

    return {
      totalLeads: jobs.length,
      appliedCount: jobs.filter(j => ['APPLIED', 'REPLIED', 'INTERVIEW', 'OFFER', 'REJECTED', 'SHORTLISTED'].includes(j.status)).length,
      intCount: jobs.filter(j => j.status === 'INTERVIEW').length,
      offerCount: jobs.filter(j => j.status === 'OFFER').length,
      avgScore: Math.round(jobs.reduce((a, b) => a + b.score, 0) / jobs.length),
      thisWeekScouted: thisWeekJobs.length,
      lastWeekScouted: lastWeekJobs.length,
      thisWeekApplied,
      lastWeekApplied,
      sources,
      staleCount,
      pipeline,
      chartData,
    };
  }, [jobs]);

  const filteredJobs = useMemo(() => {
    let result = filter === 'ALL' ? jobs : jobs.filter(j => j.status === filter);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(j => j.title.toLowerCase().includes(q) || j.company.toLowerCase().includes(q));
    }
    return [...result].sort((a, b) => {
      if (sortField === 'score') return sortDir === 'asc' ? a.score - b.score : b.score - a.score;
      if (sortField === 'date') return sortDir === 'asc' ? new Date(a.date).getTime() - new Date(b.date).getTime() : new Date(b.date).getTime() - new Date(a.date).getTime();
      if (sortField === 'company') return sortDir === 'asc' ? a.company.localeCompare(b.company) : b.company.localeCompare(a.company);
      return 0;
    });
  }, [jobs, filter, sortField, sortDir, searchQuery]);

  useKeyboardNav({
    totalRows: filteredJobs.length,
    focusedRow, setFocusedRow,
    selectedRows, setSelectedRows,
    expandedRow, setExpandedRow,
    onCycleStatus: cycleStatus,
  });

  const toggleSort = (field: 'date' | 'score' | 'company') => {
    if (sortField === field) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('desc'); }
  };

  const SortIcon = ({ field }: { field: 'date' | 'score' | 'company' }) => {
    if (sortField !== field) return <span className="opacity-0 group-hover:opacity-30 ml-1">↓</span>;
    return <span className="text-emerald-400 ml-1">{sortDir === 'asc' ? '↑' : '↓'}</span>;
  };

  const selectAll = () => {
    if (selectedRows.size === filteredJobs.length) setSelectedRows(new Set());
    else setSelectedRows(new Set(filteredJobs.map((_, i) => i)));
  };

  return (
    <div className="flex flex-col flex-1 w-full bg-slate-950 text-slate-50">
      <motion.main
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="flex-1 p-4 sm:p-6 flex flex-col lg:grid lg:grid-cols-12 gap-6 pb-24 max-w-[1700px] mx-auto w-full"
      >
        {/* ─── Analytics Sidebar ─────────────────────────────────────── */}
        <div className={`${showAnalytics ? 'lg:col-span-3' : 'lg:col-span-0 hidden lg:hidden'} flex-shrink-0 transition-all`}>
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-2xl font-bold tracking-tight text-white">Tracker</h1>
            <Button variant="ghost" size="sm" onClick={() => setShowAnalytics(!showAnalytics)} className="text-slate-500 text-xs lg:hidden">
              {showAnalytics ? 'Hide' : 'Show'} Stats
            </Button>
          </div>

          {analytics && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-1 gap-3">
              {/* Core metrics */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                <div className="text-[10px] text-slate-500 uppercase tracking-widest mb-2 font-semibold">Total Leads</div>
                <div className="text-2xl font-mono text-white">{analytics.totalLeads}</div>
              </div>
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                <div className="text-[10px] text-slate-500 uppercase tracking-widest mb-2 font-semibold">Applied</div>
                <div className="text-2xl font-mono text-blue-400">{analytics.appliedCount}</div>
              </div>
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
                <div className="text-[10px] text-slate-500 uppercase tracking-widest mb-2 font-semibold">Interviews</div>
                <div className="text-2xl font-mono text-purple-400">{analytics.intCount}</div>
                {analytics.offerCount > 0 && <div className="text-[10px] text-amber-400 mt-1">{analytics.offerCount} offer(s)</div>}
              </div>

              {/* Weekly comparison */}
              <div className="col-span-2 sm:col-span-3 lg:col-span-1 bg-slate-900 border border-slate-800 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <BarChart3 className="h-3.5 w-3.5 text-blue-400" />
                  <div className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold">Weekly Comparison</div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-[9px] text-slate-500 mb-1">This Week</div>
                    <div className="text-lg font-mono text-emerald-400">{analytics.thisWeekScouted}</div>
                    <div className="text-[9px] text-slate-500">{analytics.thisWeekApplied} applied</div>
                  </div>
                  <div>
                    <div className="text-[9px] text-slate-500 mb-1">Last Week</div>
                    <div className="text-lg font-mono text-slate-400">{analytics.lastWeekScouted}</div>
                    <div className="text-[9px] text-slate-500">{analytics.lastWeekApplied} applied</div>
                  </div>
                </div>
                {analytics.thisWeekScouted > analytics.lastWeekScouted ? (
                  <div className="text-[9px] text-emerald-500 mt-2 flex items-center gap-1"><TrendingUp className="h-3 w-3" /> +{analytics.thisWeekScouted - analytics.lastWeekScouted} vs last week</div>
                ) : analytics.thisWeekScouted < analytics.lastWeekScouted ? (
                  <div className="text-[9px] text-red-400 mt-2">↓ {analytics.lastWeekScouted - analytics.thisWeekScouted} fewer than last week</div>
                ) : null}
              </div>

              {/* Source breakdown */}
              <div className="col-span-2 sm:col-span-3 lg:col-span-1 bg-slate-900 border border-slate-800 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <PieChartIcon className="h-3.5 w-3.5 text-emerald-400" />
                  <div className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold">Sources</div>
                </div>
                <div className="space-y-2">
                  {Object.entries(analytics.sources).sort(([,a], [,b]) => b - a).map(([source, count]) => {
                    const pct = Math.round((count / analytics.totalLeads) * 100);
                    const colors: Record<string, string> = { Internshala: 'bg-blue-500', RemoteOK: 'bg-emerald-500', Remotive: 'bg-purple-500', JSearch: 'bg-amber-500' };
                    return (
                      <div key={source} className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full ${colors[source] || 'bg-slate-500'}`} />
                        <span className="text-[10px] text-slate-400 flex-1">{source}</span>
                        <span className="text-[10px] font-mono text-slate-500">{count} ({pct}%)</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Stale alert */}
              {analytics.staleCount > 0 && (
                <div className="col-span-2 sm:col-span-3 lg:col-span-1 bg-orange-500/10 border border-orange-500/20 rounded-xl p-4 cursor-pointer hover:bg-orange-500/15 transition-colors" onClick={() => { setFilter('APPLIED'); setSearchQuery(''); }}>
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-orange-400" />
                    <div className="text-xs font-bold text-orange-400">{analytics.staleCount} Stale</div>
                  </div>
                  <div className="text-[10px] text-orange-300/60 mt-1">Applied 7+ days, no reply. Click to filter.</div>
                </div>
              )}

              {/* Pipeline funnel */}
              <div className="col-span-2 sm:col-span-3 lg:col-span-1 bg-slate-900 border border-slate-800 rounded-xl p-4">
                <div className="text-[10px] text-slate-500 uppercase tracking-widest mb-3 font-semibold">Pipeline</div>
                <div className="space-y-1.5">
                  {['NEW', 'SHORTLISTED', 'APPLIED', 'REPLIED', 'INTERVIEW', 'OFFER'].map(s => {
                    const count = analytics.pipeline[s] || 0;
                    const maxCount = Math.max(...Object.values(analytics.pipeline), 1);
                    const pct = Math.round((count / maxCount) * 100);
                    return (
                      <div key={s} className="flex items-center gap-2">
                        <span className="text-[9px] text-slate-500 w-20 text-right font-mono">{s}</span>
                        <div className="flex-1 bg-slate-800 h-2 rounded-full overflow-hidden">
                          <motion.div initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.6 }} className="h-full bg-emerald-500/60 rounded-full" />
                        </div>
                        <span className="text-[9px] font-mono text-slate-500 w-6 text-right">{count}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Trend chart */}
              {analytics.chartData.length > 0 && (
                <div className="col-span-2 sm:col-span-3 lg:col-span-1 bg-slate-900 border border-slate-800 rounded-xl p-4">
                  <div className="text-[10px] text-slate-500 uppercase tracking-widest mb-3 font-semibold">Match Trend (30d)</div>
                  <div className="h-24 w-full">
                    <ClientChart data={analytics.chartData} />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ─── Main Table ────────────────────────────────────────────── */}
        <div className={`${showAnalytics ? 'lg:col-span-9' : 'lg:col-span-12'} flex flex-col bg-slate-900 border border-slate-800 rounded-xl`}>
          {/* Toolbar */}
          <div className="p-3 border-b border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="flex space-x-1.5 overflow-x-auto whitespace-nowrap hide-scrollbar w-full sm:w-auto pb-2 sm:pb-0">
              {['ALL', ...ALL_STATUSES].map(f => (
                <button key={f} onClick={() => setFilter(f)} className={`px-2.5 py-1 text-[10px] rounded-md border transition-colors ${filter === f ? 'bg-slate-800 text-white border-slate-700' : 'bg-transparent text-slate-500 border-transparent hover:bg-slate-800/50'}`}>
                  {f === 'ALL' ? 'All' : f.charAt(0) + f.slice(1).toLowerCase()}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <div className="relative flex-1 sm:w-56">
                <svg className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                <input type="text" placeholder="Search..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 transition-colors" />
              </div>
              <Button onClick={() => exportToCSV(filteredJobs)} variant="outline" size="icon" className="shrink-0 bg-slate-900 border-slate-800 hover:bg-slate-800 text-slate-400" title="Export CSV">
                <Download className="h-3.5 w-3.5" />
              </Button>
              <Button onClick={fetchJobs} disabled={loading} variant="outline" size="icon" className="shrink-0 bg-slate-900 border-slate-800 hover:bg-slate-800 text-slate-400" title="Refresh">
                <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin text-emerald-500' : ''}`} />
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setShowAnalytics(!showAnalytics)} className="hidden lg:flex text-slate-500 text-[10px]">
                <BarChart3 className="h-3.5 w-3.5 mr-1" /> {showAnalytics ? 'Hide' : 'Show'}
              </Button>
            </div>
          </div>

          {/* Bulk action bar */}
          <AnimatePresence>
            {selectedRows.size > 0 && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="border-b border-slate-800 bg-slate-900/80 px-4 py-2 flex items-center gap-3 overflow-hidden">
                <span className="text-xs text-slate-400 font-mono">{selectedRows.size} selected</span>
                <div className="flex gap-1.5 flex-wrap">
                  {['APPLIED', 'SHORTLISTED', 'IGNORED', 'REJECTED', 'GHOSTED'].map(s => (
                    <Button key={s} variant="outline" size="sm" onClick={() => bulkUpdateStatus(s)} className="text-[10px] h-6 px-2 bg-slate-900 border-slate-700 hover:bg-slate-800">
                      → {s}
                    </Button>
                  ))}
                </div>
                <Button variant="ghost" size="sm" onClick={() => setSelectedRows(new Set())} className="text-[10px] text-slate-500 ml-auto">Clear</Button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Table */}
          <div className="overflow-auto flex-1">
            <Table>
              <TableHeader className="bg-slate-900/50 sticky top-0 z-10">
                <TableRow>
                  <TableHead className="w-10">
                    <input type="checkbox" checked={selectedRows.size === filteredJobs.length && filteredJobs.length > 0} onChange={selectAll} className="accent-emerald-500 rounded" />
                  </TableHead>
                  <TableHead className="w-[90px] cursor-pointer group hover:text-slate-300 transition-colors text-[10px]" onClick={() => toggleSort('date')}>Date <SortIcon field="date" /></TableHead>
                  <TableHead className="cursor-pointer group hover:text-slate-300 transition-colors text-[10px]" onClick={() => toggleSort('company')}>Company / Role <SortIcon field="company" /></TableHead>
                  <TableHead className="cursor-pointer group hover:text-slate-300 transition-colors text-[10px] w-[110px]" onClick={() => toggleSort('score')}>Match <SortIcon field="score" /></TableHead>
                  <TableHead className="text-[10px] w-[70px]">Reply %</TableHead>
                  <TableHead className="text-center text-[10px] w-[100px]">Status</TableHead>
                  <TableHead className="text-right text-[10px] w-[60px]">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={7} className="h-24 text-center text-sm font-mono text-slate-500">Loading...</TableCell></TableRow>
                ) : error ? (
                  <TableRow><TableCell colSpan={7} className="h-24 text-center text-sm font-mono text-red-400">{error}</TableCell></TableRow>
                ) : filteredJobs.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="h-24 text-center text-sm font-mono text-slate-500">No jobs found.</TableCell></TableRow>
                ) : (
                  filteredJobs.map((job, idx) => {
                    const prediction = predictReplyLikelihood(job);
                    const stale = isStale(job);
                    const isSelected = selectedRows.has(idx);
                    const isFocused = focusedRow === idx;
                    const isExpanded = expandedRow === idx;

                    return (
                      <React.Fragment key={job.rowId}>
                        <TableRow
                          className={`cursor-pointer transition-colors ${isFocused ? 'bg-slate-800/60' : ''} ${isSelected ? 'bg-emerald-500/5' : ''} hover:bg-slate-800/40`}
                          onClick={() => setExpandedRow(isExpanded ? null : idx)}
                        >
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <input type="checkbox" checked={isSelected} onChange={() => {
                              const next = new Set(selectedRows);
                              if (next.has(idx)) next.delete(idx); else next.add(idx);
                              setSelectedRows(next);
                            }} className="accent-emerald-500 rounded" />
                          </TableCell>
                          <TableCell className="font-mono text-[10px] text-slate-500">{job.date}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              {isExpanded ? <ChevronDown className="h-3 w-3 text-slate-500 shrink-0" /> : <ChevronRight className="h-3 w-3 text-slate-600 shrink-0" />}
                              <div>
                                <div className="font-medium text-slate-200 text-sm">{job.company}</div>
                                <div className="text-[11px] text-slate-500 flex items-center gap-2">
                                  {job.title}
                                  {stale && <span className="inline-flex items-center gap-1 text-[9px] text-orange-400 animate-pulse"><AlertTriangle className="h-2.5 w-2.5" />Stale</span>}
                                </div>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell><MetricBar score={job.score} /></TableCell>
                          <TableCell>
                            {prediction >= 0 ? (
                              <span className={`font-mono text-[10px] font-bold ${prediction >= 50 ? 'text-emerald-400' : prediction >= 25 ? 'text-yellow-400' : 'text-slate-500'}`}>{prediction}%</span>
                            ) : (
                              <span className="text-[10px] text-slate-600">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-center relative" onClick={(e) => e.stopPropagation()}>
                            <select value={job.status} onChange={(e) => updateStatus(job.rowId, e.target.value)} className="bg-transparent text-xs font-bold uppercase focus:ring-0 cursor-pointer p-1 rounded opacity-0 absolute inset-0 z-20 w-full">
                              {ALL_STATUSES.map(s => <option className="bg-slate-900 text-slate-500" key={s} value={s}>{s}</option>)}
                            </select>
                            <div className="relative z-10 inline-flex items-center justify-center"><StatusBadge status={job.status} /></div>
                          </TableCell>
                          <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                            <Button asChild variant="ghost" size="sm" className="text-emerald-500 hover:text-emerald-400 h-7 px-2">
                              <a href={job.url} target="_blank" rel="noreferrer">Open</a>
                            </Button>
                          </TableCell>
                        </TableRow>

                        {/* Expanded details row */}
                        <AnimatePresence>
                          {isExpanded && (
                            <TableRow>
                              <TableCell colSpan={7} className="p-0 border-0">
                                <motion.div
                                  initial={{ height: 0, opacity: 0 }}
                                  animate={{ height: 'auto', opacity: 1 }}
                                  exit={{ height: 0, opacity: 0 }}
                                  transition={{ duration: 0.2 }}
                                  className="overflow-hidden"
                                >
                                  <div className="p-4 pl-12 bg-slate-900/40 border-b border-slate-800 grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="flex gap-2 items-start">
                                      <Zap className="h-3.5 w-3.5 text-emerald-500 mt-0.5 shrink-0" />
                                      <div>
                                        <div className="text-[9px] font-bold tracking-wider text-slate-500 uppercase mb-1">Match Reasons</div>
                                        <p className="text-xs text-slate-300">{job.reasons || 'N/A'}</p>
                                      </div>
                                    </div>
                                    <div className="flex gap-2 items-start">
                                      <AlertTriangle className="h-3.5 w-3.5 text-amber-500 mt-0.5 shrink-0" />
                                      <div>
                                        <div className="text-[9px] font-bold tracking-wider text-slate-500 uppercase mb-1">Gap / Risk</div>
                                        <p className="text-xs text-slate-300">{job.gap || 'N/A'}</p>
                                      </div>
                                    </div>
                                    <div className="flex gap-2 items-start">
                                      <Target className="h-3.5 w-3.5 text-indigo-400 mt-0.5 shrink-0" />
                                      <div>
                                        <div className="text-[9px] font-bold tracking-wider text-slate-500 uppercase mb-1">Resume Angle</div>
                                        <p className="text-xs text-slate-300">{job.resumeAngle || 'N/A'}</p>
                                      </div>
                                    </div>
                                    {job.dm && (
                                      <div className="flex gap-2 items-start bg-slate-900 rounded-lg p-3 border border-slate-800">
                                        <MessageSquareText className="h-3.5 w-3.5 text-blue-400 mt-0.5 shrink-0" />
                                        <div>
                                          <div className="text-[9px] font-bold tracking-wider text-blue-400 uppercase mb-1">Outreach Draft</div>
                                          <p className="text-xs italic text-slate-400">{job.dm}</p>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                </motion.div>
                              </TableCell>
                            </TableRow>
                          )}
                        </AnimatePresence>
                      </React.Fragment>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>

          {/* Keyboard shortcut hint */}
          <div className="px-4 py-2 border-t border-slate-800 flex items-center gap-4 text-[9px] text-slate-600 font-mono">
            <span><kbd className="px-1 py-0.5 bg-slate-800 rounded text-[8px]">j</kbd>/<kbd className="px-1 py-0.5 bg-slate-800 rounded text-[8px]">k</kbd> navigate</span>
            <span><kbd className="px-1 py-0.5 bg-slate-800 rounded text-[8px]">x</kbd> select</span>
            <span><kbd className="px-1 py-0.5 bg-slate-800 rounded text-[8px]">s</kbd> cycle status</span>
            <span><kbd className="px-1 py-0.5 bg-slate-800 rounded text-[8px]">Enter</kbd> expand</span>
            <span><kbd className="px-1 py-0.5 bg-slate-800 rounded text-[8px]">Esc</kbd> clear</span>
          </div>
        </div>
      </motion.main>
    </div>
  );
}
