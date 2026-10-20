'use client';
import React, { useEffect, useState, useMemo, useCallback } from 'react';
import StatusBadge, { ALL_STATUSES } from '@/components/StatusBadge';
import MetricBar from '@/components/MetricBar';
import InteractiveEvaluator from '@/components/InteractiveEvaluator';
import dynamic from 'next/dynamic';
import { motion, AnimatePresence } from 'motion/react';
import {
  RefreshCw,
  Download,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  Copy,
  Check,
  Plus,
  X,
  BarChart3,
  ArrowUpRight,
  Save,
} from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { useKeyboardNav } from '@/hooks/useKeyboardNav';

const ClientChart = dynamic(() => import('@/components/ClientChart'), { ssr: false });

interface JobRow {
  rowId: number;
  date: string;
  id: string;
  title: string;
  company: string;
  score: number;
  reasons: string;
  gap: string;
  url: string;
  dm: string;
  resumeAngle: string;
  status: string;
  source: string;
}

function predictReplyLikelihood(job: JobRow): number {
  const daysSinceApplied = Math.max(
    0,
    Math.floor((Date.now() - new Date(job.date).getTime()) / (1000 * 60 * 60 * 24))
  );
  if (!['APPLIED', 'SHORTLISTED', 'NEW'].includes(job.status)) return -1;

  let prob = 0;
  prob += job.score * 0.42;
  prob += daysSinceApplied < 3 ? 28 : daysSinceApplied < 7 ? 20 : daysSinceApplied < 14 ? 10 : 4;
  prob += job.dm ? 14 : 0;
  prob += job.resumeAngle ? 8 : 0;
  return Math.min(98, Math.max(5, Math.round(prob)));
}

function isStale(job: JobRow): boolean {
  if (job.status !== 'APPLIED') return false;
  const days = Math.floor((Date.now() - new Date(job.date).getTime()) / (1000 * 60 * 60 * 24));
  return days >= 7;
}

function exportToCSV(jobs: JobRow[]) {
  const headers = [
    'Date',
    'ID',
    'Source',
    'Title',
    'Company',
    'Score',
    'Status',
    'URL',
    'Reasons',
    'Gap',
    'DM Draft',
    'Resume Angle',
  ];
  const rows = jobs.map((j) =>
    [
      j.date,
      j.id,
      j.source,
      j.title,
      j.company,
      j.score,
      j.status,
      j.url,
      j.reasons,
      j.gap,
      j.dm,
      j.resumeAngle,
    ]
      .map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`)
      .join(',')
  );
  const csv = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `kaisifos-tracker-${new Date().toISOString().split('T')[0]}.csv`;
  link.click();
}

function detectSource(id: string): string {
  if (id.startsWith('internshala_')) return 'Internshala';
  if (id.startsWith('remoteok_')) return 'RemoteOK';
  if (id.startsWith('remotive_')) return 'Remotive';
  if (id.startsWith('eval_') || id.startsWith('manual_')) return 'Evaluated';
  return 'JSearch';
}

export default function TrackerPage() {
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [storageMode, setStorageMode] = useState<string>('local-store');
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('ALL');
  const [sourceFilter, setSourceFilter] = useState('ALL');
  const [minScoreFilter, setMinScoreFilter] = useState<number>(0);
  const [staleOnly, setStaleOnly] = useState(false);
  const [sortField, setSortField] = useState<'date' | 'score' | 'company'>('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [searchQuery, setSearchQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [focusedRow, setFocusedRow] = useState(0);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [showAnalytics, setShowAnalytics] = useState(true);
  const [showEvaluatorModal, setShowEvaluatorModal] = useState(false);

  const [editingDmRowId, setEditingDmRowId] = useState<number | null>(null);
  const [draftDmText, setDraftDmText] = useState<string>('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const fetchJobs = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch('/api/sheet-sync')
      .then(async (res) => {
        if (res.status === 401) {
          window.location.href = '/login';
          return null;
        }
        if (!res.ok) throw new Error('Failed to fetch data');
        return res.json();
      })
      .then((data) => {
        if (data && data.rows) {
          if (data.mode) setStorageMode(data.mode);
          const parsedJobs = data.rows
            .map((r: string[], i: number) => ({
              rowId: i + 1,
              date: r[0] || '',
              id: r[1] || '',
              title: r[2] || '',
              company: r[3] || '',
              score: parseInt(r[4] || '0', 10),
              reasons: r[5] || '',
              gap: r[6] || '',
              url: r[7] || '',
              dm: r[8] || '',
              resumeAngle: r[9] || '',
              status: r[10] || 'NEW',
              source: detectSource(r[1] || ''),
            }))
            .filter((j: JobRow) => j.title !== 'Title' && j.id);
          setJobs(parsedJobs);
        }
        setLoading(false);
      })
      .catch((err) => {
        console.error(err);
        setError('Failed to load tracker data.');
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  const updateStatus = async (rowId: number, newStatus: string) => {
    const originalJobs = [...jobs];
    setJobs(jobs.map((j) => (j.rowId === rowId ? { ...j, status: newStatus } : j)));
    try {
      const res = await fetch('/api/sheet-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rowId, status: newStatus }),
      });
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
    } catch (e) {
      console.error('Update failed', e);
      setJobs(originalJobs);
    }
  };

  const saveInlineDm = async (rowId: number) => {
    const originalJobs = [...jobs];
    setJobs(jobs.map((j) => (j.rowId === rowId ? { ...j, dm: draftDmText } : j)));
    setEditingDmRowId(null);
    try {
      await fetch('/api/sheet-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rowId, dm: draftDmText }),
      });
    } catch (e) {
      console.error('DM update failed', e);
      setJobs(originalJobs);
    }
  };

  const copyText = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(key);
    setTimeout(() => setCopiedId(null), 1800);
  };

  const filteredJobs = useMemo(() => {
    let result = filter === 'ALL' ? jobs : jobs.filter((j) => j.status === filter);
    if (sourceFilter !== 'ALL') {
      result = result.filter((j) => j.source === sourceFilter);
    }
    if (minScoreFilter > 0) {
      result = result.filter((j) => j.score >= minScoreFilter);
    }
    if (staleOnly) {
      result = result.filter(isStale);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (j) =>
          j.title.toLowerCase().includes(q) ||
          j.company.toLowerCase().includes(q) ||
          j.reasons.toLowerCase().includes(q)
      );
    }
    return [...result].sort((a, b) => {
      if (sortField === 'score') return sortDir === 'asc' ? a.score - b.score : b.score - a.score;
      if (sortField === 'date')
        return sortDir === 'asc'
          ? new Date(a.date).getTime() - new Date(b.date).getTime()
          : new Date(b.date).getTime() - new Date(a.date).getTime();
      if (sortField === 'company')
        return sortDir === 'asc'
          ? a.company.localeCompare(b.company)
          : b.company.localeCompare(a.company);
      return 0;
    });
  }, [jobs, filter, sourceFilter, minScoreFilter, staleOnly, sortField, sortDir, searchQuery]);

  const bulkUpdateStatus = async (newStatus: string) => {
    const ids = Array.from(selectedRows);
    const targets = filteredJobs.filter((_, i) => ids.includes(i));
    for (const job of targets) {
      await updateStatus(job.rowId, newStatus);
    }
    setSelectedRows(new Set());
  };

  const cycleStatus = useCallback(
    (index: number) => {
      const job = filteredJobs[index];
      if (!job) return;
      const currentIdx = ALL_STATUSES.indexOf(job.status);
      const nextStatus = ALL_STATUSES[(currentIdx + 1) % ALL_STATUSES.length];
      updateStatus(job.rowId, nextStatus);
    },
    [filteredJobs]
  );

  const analytics = useMemo(() => {
    if (jobs.length === 0) return null;
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

    const thisWeekJobs = jobs.filter((j) => new Date(j.date) >= weekAgo);
    const lastWeekJobs = jobs.filter((j) => {
      const d = new Date(j.date);
      return d >= twoWeeksAgo && d < weekAgo;
    });
    const thisWeekApplied = thisWeekJobs.filter((j) =>
      ['APPLIED', 'REPLIED', 'INTERVIEW', 'OFFER', 'REJECTED'].includes(j.status)
    ).length;
    const lastWeekApplied = lastWeekJobs.filter((j) =>
      ['APPLIED', 'REPLIED', 'INTERVIEW', 'OFFER', 'REJECTED'].includes(j.status)
    ).length;

    const sources: Record<string, number> = {};
    jobs.forEach((j) => {
      sources[j.source] = (sources[j.source] || 0) + 1;
    });

    const staleCount = jobs.filter(isStale).length;

    const pipeline: Record<string, number> = {};
    ALL_STATUSES.forEach((s) => {
      pipeline[s] = jobs.filter((j) => j.status === s).length;
    });

    const last30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const dailyScores: Record<string, { total: number; count: number }> = {};
    jobs.forEach((job) => {
      const jobDate = new Date(job.date);
      if (jobDate >= last30) {
        try {
          const dateKey = `${String(jobDate.getMonth() + 1).padStart(2, '0')}-${String(
            jobDate.getDate()
          ).padStart(2, '0')}`;
          if (!dailyScores[dateKey]) dailyScores[dateKey] = { total: 0, count: 0 };
          dailyScores[dateKey].total += job.score;
          dailyScores[dateKey].count += 1;
        } catch {}
      }
    });
    const chartData = Object.keys(dailyScores)
      .sort()
      .map((date) => ({
        date,
        avgScore: Math.round(dailyScores[date].total / dailyScores[date].count),
      }));

    return {
      totalLeads: jobs.length,
      appliedCount: jobs.filter((j) =>
        ['APPLIED', 'REPLIED', 'INTERVIEW', 'OFFER', 'REJECTED', 'SHORTLISTED'].includes(j.status)
      ).length,
      intCount: jobs.filter((j) => j.status === 'INTERVIEW').length,
      offerCount: jobs.filter((j) => j.status === 'OFFER').length,
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

  useKeyboardNav({
    totalRows: filteredJobs.length,
    focusedRow,
    setFocusedRow,
    selectedRows,
    setSelectedRows,
    expandedRow,
    setExpandedRow,
    onCycleStatus: cycleStatus,
  });

  const toggleSort = (field: 'date' | 'score' | 'company') => {
    if (sortField === field) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  const SortIcon = ({ field }: { field: 'date' | 'score' | 'company' }) => {
    if (sortField !== field) return <span className="opacity-0 group-hover:opacity-40 ml-1">↓</span>;
    return <span className="text-emerald-400 ml-1">{sortDir === 'asc' ? '↑' : '↓'}</span>;
  };

  const selectAll = () => {
    if (selectedRows.size === filteredJobs.length) setSelectedRows(new Set());
    else setSelectedRows(new Set(filteredJobs.map((_, i) => i)));
  };

  return (
    <div className="flex flex-col flex-1 w-full bg-[#0B0F17] text-[#F8FAFC]">
      <div className="flex-1 p-4 sm:p-6 max-w-[1680px] mx-auto w-full space-y-6 pb-24">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800/90 pb-4">
          <div>
            <h1 className="text-2xl font-display font-bold tracking-tight text-white">
              Pipeline Intelligence Tracker
            </h1>
            <p className="text-xs text-slate-400 mt-0.5">
              Storage:{' '}
              <span className="font-mono text-slate-300">
                {storageMode === 'cloud-sheets' ? 'Google Sheets v4 Sync' : 'Hybrid Local Store'}
              </span>{' '}
              · Keyboard navigation active (<span className="font-mono">j/k/x/s/Enter</span>)
            </p>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <Button
              type="button"
              onClick={() => setShowEvaluatorModal(!showEvaluatorModal)}
              className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium px-3.5 py-2 whitespace-nowrap shrink-0"
            >
              {showEvaluatorModal ? (
                <>
                  <X className="h-3.5 w-3.5 mr-1.5" /> Close Role Evaluator
                </>
              ) : (
                <>
                  <Plus className="h-3.5 w-3.5 mr-1.5" /> Evaluate & Add Role
                </>
              )}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowAnalytics(!showAnalytics)}
              className="bg-slate-900 border-slate-800 hover:bg-slate-800 text-slate-300 text-xs whitespace-nowrap shrink-0"
            >
              <BarChart3 className="h-3.5 w-3.5 mr-1.5" />
              {showAnalytics ? 'Hide Telemetry' : 'Show Telemetry'}
            </Button>
          </div>
        </div>

        <AnimatePresence>
          {showEvaluatorModal && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18 }}
            >
              <InteractiveEvaluator
                onRoleCommitted={() => {
                  fetchJobs();
                }}
              />
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex flex-col lg:grid lg:grid-cols-12 gap-6">
          {showAnalytics && analytics && (
            <div className="lg:col-span-3 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-[#111827] border border-slate-800/90 rounded-xl p-4">
                  <div className="text-xs text-slate-400 mb-1">Total Tracked</div>
                  <div className="text-2xl font-mono font-bold text-white tabular-nums">
                    {analytics.totalLeads}
                  </div>
                </div>
                <div className="bg-[#111827] border border-slate-800/90 rounded-xl p-4">
                  <div className="text-xs text-slate-400 mb-1">Mean Score</div>
                  <div className="text-2xl font-mono font-bold text-emerald-400 tabular-nums">
                    {analytics.avgScore}
                    <span className="text-xs text-slate-500 font-normal">/100</span>
                  </div>
                </div>
                <div className="bg-[#111827] border border-slate-800/90 rounded-xl p-4">
                  <div className="text-xs text-slate-400 mb-1">Active Funnel</div>
                  <div className="text-2xl font-mono font-bold text-blue-400 tabular-nums">
                    {analytics.appliedCount}
                  </div>
                </div>
                <div className="bg-[#111827] border border-slate-800/90 rounded-xl p-4">
                  <div className="text-xs text-slate-400 mb-1">Interviews / Offers</div>
                  <div className="text-2xl font-mono font-bold text-violet-400 tabular-nums">
                    {analytics.intCount + analytics.offerCount}
                  </div>
                </div>
              </div>

              {analytics.staleCount > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setStaleOnly(!staleOnly);
                    setFilter('ALL');
                  }}
                  className={`w-full text-left border rounded-xl p-4 transition-colors ${
                    staleOnly
                      ? 'bg-amber-950/60 border-amber-600/60'
                      : 'bg-amber-950/30 border-amber-800/50 hover:bg-amber-950/50'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
                      <span className="text-xs font-semibold text-amber-300 tabular-nums">
                        {analytics.staleCount} Stale Application(s)
                      </span>
                    </div>
                    <span className="text-[11px] font-mono text-amber-400 underline">
                      {staleOnly ? 'Show All' : 'Filter'}
                    </span>
                  </div>
                  <p className="text-xs text-amber-200/70 mt-1">
                    Applied 7+ days ago with no recruiter response logged.
                  </p>
                </button>
              )}

              <div className="bg-[#111827] border border-slate-800/90 rounded-xl p-4">
                <div className="text-xs font-medium text-slate-300 mb-3">
                  Stage Distribution
                </div>
                <div className="space-y-2">
                  {['NEW', 'SHORTLISTED', 'APPLIED', 'REPLIED', 'INTERVIEW', 'OFFER'].map((s) => {
                    const count = analytics.pipeline[s] || 0;
                    const maxCount = Math.max(...Object.values(analytics.pipeline), 1);
                    const pct = Math.round((count / maxCount) * 100);
                    return (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setFilter(filter === s ? 'ALL' : s)}
                        className="w-full flex items-center gap-2.5 group text-left"
                      >
                        <span className="text-[11px] text-slate-400 group-hover:text-white w-24 font-mono truncate">
                          {s}
                        </span>
                        <div className="flex-1 bg-slate-800/80 h-1.5 rounded-sm overflow-hidden">
                          <div
                            style={{ width: `${pct}%` }}
                            className="h-full bg-emerald-500/80 transition-all"
                          />
                        </div>
                        <span className="text-[11px] font-mono tabular-nums text-slate-400 w-6 text-right">
                          {count}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="bg-[#111827] border border-slate-800/90 rounded-xl p-4">
                <div className="text-xs font-medium text-slate-300 mb-3">
                  Ingestion Sources
                </div>
                <div className="divide-y divide-slate-800/70">
                  {Object.entries(analytics.sources)
                    .sort(([, a], [, b]) => b - a)
                    .map(([source, count]) => {
                      const pct = Math.round((count / analytics.totalLeads) * 100);
                      return (
                        <button
                          key={source}
                          type="button"
                          onClick={() =>
                            setSourceFilter(sourceFilter === source ? 'ALL' : source)
                          }
                          className="w-full py-1.5 flex items-center justify-between text-xs hover:text-white transition-colors"
                        >
                          <span
                            className={
                              sourceFilter === source
                                ? 'text-emerald-400 font-medium'
                                : 'text-slate-400'
                            }
                          >
                            {source}
                          </span>
                          <span className="font-mono tabular-nums text-slate-400">
                            {count} ({pct}%)
                          </span>
                        </button>
                      );
                    })}
                </div>
              </div>

              {analytics.chartData.length > 0 && (
                <div className="bg-[#111827] border border-slate-800/90 rounded-xl p-4">
                  <div className="text-xs font-medium text-slate-300 mb-3">
                    30-Day Fit Score Trajectory
                  </div>
                  <div className="h-28 w-full">
                    <ClientChart data={analytics.chartData} />
                  </div>
                </div>
              )}
            </div>
          )}

          <div
            className={`${
              showAnalytics ? 'lg:col-span-9' : 'lg:col-span-12'
            } flex flex-col bg-[#111827] border border-slate-800/90 rounded-xl overflow-hidden`}
          >
            <div className="p-3.5 border-b border-slate-800 flex flex-col gap-3 bg-[#0D131F]">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-1 overflow-x-auto hide-scrollbar pb-1 sm:pb-0">
                  {['ALL', ...ALL_STATUSES.slice(0, 7)].map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => {
                        setFilter(f);
                        setStaleOnly(false);
                      }}
                      className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                        filter === f && !staleOnly
                          ? 'bg-slate-800 text-white border border-slate-700'
                          : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                      }`}
                    >
                      {f === 'ALL' ? 'All Roles' : f.charAt(0) + f.slice(1).toLowerCase()}
                    </button>
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                  <select
                    aria-label="Filter by source"
                    value={sourceFilter}
                    onChange={(e) => setSourceFilter(e.target.value)}
                    className="bg-[#0B0F17] border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-emerald-500"
                  >
                    <option value="ALL">All Sources</option>
                    <option value="Internshala">Internshala</option>
                    <option value="RemoteOK">RemoteOK</option>
                    <option value="Remotive">Remotive</option>
                    <option value="JSearch">JSearch</option>
                    <option value="Evaluated">Evaluated</option>
                  </select>

                  <select
                    aria-label="Filter by minimum score"
                    value={minScoreFilter}
                    onChange={(e) => setMinScoreFilter(Number(e.target.value))}
                    className="bg-[#0B0F17] border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs font-mono text-slate-300 focus:outline-none focus:border-emerald-500"
                  >
                    <option value={0}>Score: All</option>
                    <option value={85}>Score ≥ 85</option>
                    <option value={90}>Score ≥ 90</option>
                    <option value={94}>Score ≥ 94</option>
                  </select>

                  <div className="relative flex-1 sm:w-52">
                    <input
                      type="text"
                      placeholder="Filter role, company, reason..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full bg-[#0B0F17] border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 transition-colors"
                    />
                  </div>

                  <Button
                    type="button"
                    onClick={() => exportToCSV(filteredJobs)}
                    variant="outline"
                    size="sm"
                    className="shrink-0 bg-[#0B0F17] border-slate-800 hover:bg-slate-800 text-slate-300 text-xs h-8 px-2.5 whitespace-nowrap"
                    title="Download CSV"
                  >
                    <Download className="h-3.5 w-3.5 mr-1.5" /> CSV
                  </Button>

                  <Button
                    type="button"
                    onClick={fetchJobs}
                    disabled={loading}
                    variant="outline"
                    size="icon"
                    className="shrink-0 bg-[#0B0F17] border-slate-800 hover:bg-slate-800 text-slate-300 h-8 w-8"
                    title="Refresh Ledger"
                  >
                    <RefreshCw
                      className={`h-3.5 w-3.5 ${loading ? 'animate-spin text-emerald-400' : ''}`}
                    />
                  </Button>
                </div>
              </div>
            </div>

            <AnimatePresence>
              {selectedRows.size > 0 && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="border-b border-slate-800 bg-slate-900 px-4 py-2.5 flex items-center gap-3 overflow-hidden"
                >
                  <span className="text-xs text-emerald-400 font-mono tabular-nums">
                    {selectedRows.size} selected
                  </span>
                  <div className="flex gap-1.5 flex-wrap">
                    {['SHORTLISTED', 'APPLIED', 'REPLIED', 'INTERVIEW', 'REJECTED', 'IGNORED'].map(
                      (s) => (
                        <Button
                          key={s}
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => bulkUpdateStatus(s)}
                          className="text-xs h-7 px-2.5 bg-[#0B0F17] border-slate-700 hover:bg-slate-800 text-slate-200 whitespace-nowrap shrink-0"
                        >
                          Mark {s.charAt(0) + s.slice(1).toLowerCase()}
                        </Button>
                      )
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedRows(new Set())}
                    className="text-xs text-slate-400 ml-auto h-7"
                  >
                    Clear Selection
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="overflow-x-auto flex-1">
              <Table>
                <TableHeader className="bg-[#0D131F] sticky top-0 z-10 border-b border-slate-800">
                  <TableRow>
                    <TableHead className="w-10">
                      <input
                        type="checkbox"
                        aria-label="Select all rows"
                        checked={
                          selectedRows.size === filteredJobs.length && filteredJobs.length > 0
                        }
                        onChange={selectAll}
                        className="accent-emerald-500 rounded"
                      />
                    </TableHead>
                    <TableHead
                      className="w-[105px] cursor-pointer group hover:text-slate-200 transition-colors text-xs whitespace-nowrap"
                      onClick={() => toggleSort('date')}
                    >
                      Date <SortIcon field="date" />
                    </TableHead>
                    <TableHead
                      className="cursor-pointer group hover:text-slate-200 transition-colors text-xs"
                      onClick={() => toggleSort('company')}
                    >
                      Company & Role <SortIcon field="company" />
                    </TableHead>
                    <TableHead className="text-xs w-[100px] whitespace-nowrap">Source</TableHead>
                    <TableHead
                      className="cursor-pointer group hover:text-slate-200 transition-colors text-xs w-[125px] whitespace-nowrap"
                      onClick={() => toggleSort('score')}
                    >
                      Fit Score <SortIcon field="score" />
                    </TableHead>
                    <TableHead className="text-right text-xs w-[85px] whitespace-nowrap">
                      Reply Est.
                    </TableHead>
                    <TableHead className="text-center text-xs w-[120px] whitespace-nowrap">
                      Stage
                    </TableHead>
                    <TableHead className="text-right text-xs w-[85px] whitespace-nowrap">
                      Link
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    Array.from({ length: 5 }).map((_, skIdx) => (
                      <TableRow key={skIdx}>
                        <TableCell colSpan={8} className="py-3.5 px-4">
                          <div className="h-5 bg-slate-800/50 rounded animate-pulse w-full" />
                        </TableCell>
                      </TableRow>
                    ))
                  ) : error ? (
                    <TableRow>
                      <TableCell
                        colSpan={8}
                        className="h-28 text-center text-xs font-mono text-rose-400"
                      >
                        {error}
                      </TableCell>
                    </TableRow>
                  ) : filteredJobs.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="py-12 text-center">
                        <div className="text-sm font-medium text-slate-200 mb-1">
                          No matching pipeline records
                        </div>
                        <p className="text-xs text-slate-400 mb-4">
                          Adjust your active filters or evaluate a new role to populate the ledger.
                        </p>
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => {
                            setFilter('ALL');
                            setSourceFilter('ALL');
                            setMinScoreFilter(0);
                            setStaleOnly(false);
                            setSearchQuery('');
                          }}
                          className="bg-slate-800 hover:bg-slate-700 text-xs text-white"
                        >
                          Reset Filters
                        </Button>
                      </TableCell>
                    </TableRow>
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
                            className={`cursor-pointer transition-colors border-b border-slate-800/70 ${
                              isFocused ? 'bg-slate-800/60' : ''
                            } ${isSelected ? 'bg-emerald-950/20' : ''} hover:bg-slate-800/40`}
                            onClick={() => setExpandedRow(isExpanded ? null : idx)}
                          >
                            <TableCell onClick={(e) => e.stopPropagation()} className="py-2.5">
                              <input
                                type="checkbox"
                                aria-label={`Select ${job.title} at ${job.company}`}
                                checked={isSelected}
                                onChange={() => {
                                  const next = new Set(selectedRows);
                                  if (next.has(idx)) next.delete(idx);
                                  else next.add(idx);
                                  setSelectedRows(next);
                                }}
                                className="accent-emerald-500 rounded"
                              />
                            </TableCell>
                            <TableCell className="font-mono tabular-nums text-xs text-slate-400 py-2.5 whitespace-nowrap">
                              {job.date}
                            </TableCell>
                            <TableCell className="py-2.5">
                              <div className="flex items-center gap-2">
                                {isExpanded ? (
                                  <ChevronDown className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                                ) : (
                                  <ChevronRight className="h-3.5 w-3.5 text-slate-500 shrink-0" />
                                )}
                                <div className="min-w-0">
                                  <div className="font-medium text-white text-xs sm:text-sm truncate">
                                    {job.company}{' '}
                                    <span className="text-slate-500 font-normal">·</span>{' '}
                                    <span className="text-slate-300 font-normal">{job.title}</span>
                                  </div>
                                  {stale && (
                                    <div className="text-[11px] text-amber-400 flex items-center gap-1 mt-0.5">
                                      <AlertTriangle className="h-3 w-3" /> Follow-up recommended
                                      (7+ days since applied)
                                    </div>
                                  )}
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="text-xs text-slate-400 py-2.5 whitespace-nowrap">
                              {job.source}
                            </TableCell>
                            <TableCell className="py-2.5">
                              <MetricBar score={job.score} />
                            </TableCell>
                            <TableCell className="text-right font-mono tabular-nums py-2.5 whitespace-nowrap">
                              {prediction >= 0 ? (
                                <span
                                  className={`text-xs font-semibold ${
                                    prediction >= 65
                                      ? 'text-emerald-400'
                                      : prediction >= 40
                                      ? 'text-blue-400'
                                      : 'text-slate-400'
                                  }`}
                                >
                                  {prediction}%
                                </span>
                              ) : (
                                <span className="text-xs text-slate-500">—</span>
                              )}
                            </TableCell>
                            <TableCell
                              className="text-center relative py-2.5"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <select
                                aria-label="Change job status"
                                value={job.status}
                                onChange={(e) => updateStatus(job.rowId, e.target.value)}
                                className="bg-transparent text-xs uppercase focus:ring-0 cursor-pointer p-1 rounded opacity-0 absolute inset-0 z-20 w-full"
                              >
                                {ALL_STATUSES.map((s) => (
                                  <option
                                    className="bg-slate-900 text-slate-200"
                                    key={s}
                                    value={s}
                                  >
                                    {s}
                                  </option>
                                ))}
                              </select>
                              <div className="relative z-10 inline-flex items-center justify-center">
                                <StatusBadge status={job.status} />
                              </div>
                            </TableCell>
                            <TableCell
                              className="text-right py-2.5"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <a
                                href={job.url}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-xs font-medium text-emerald-400 hover:text-emerald-300 whitespace-nowrap"
                              >
                                Apply <ArrowUpRight className="h-3 w-3" />
                              </a>
                            </TableCell>
                          </TableRow>

                          <AnimatePresence>
                            {isExpanded && (
                              <TableRow>
                                <TableCell colSpan={8} className="p-0 border-0">
                                  <motion.div
                                    initial={{ height: 0, opacity: 0 }}
                                    animate={{ height: 'auto', opacity: 1 }}
                                    exit={{ height: 0, opacity: 0 }}
                                    transition={{ duration: 0.18 }}
                                    className="overflow-hidden"
                                  >
                                    <div className="p-5 pl-11 bg-[#0B0F17] border-b border-slate-800 grid grid-cols-1 lg:grid-cols-12 gap-6">
                                      <div className="lg:col-span-6 space-y-4">
                                        <div>
                                          <div className="text-xs font-medium text-slate-400 mb-1.5">
                                            Rubric Alignment Breakdown
                                          </div>
                                          <p className="text-xs text-slate-200 leading-relaxed">
                                            {job.reasons || 'N/A'}
                                          </p>
                                        </div>

                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-slate-800/80">
                                          <div>
                                            <div className="text-xs font-medium text-amber-400 mb-1">
                                              Risk / Gap Mitigation
                                            </div>
                                            <p className="text-xs text-slate-300 leading-relaxed">
                                              {job.gap || 'N/A'}
                                            </p>
                                          </div>
                                          <div>
                                            <div className="flex items-center justify-between mb-1">
                                              <span className="text-xs font-medium text-blue-400">
                                                Resume Lead Angle
                                              </span>
                                              {job.resumeAngle && (
                                                <button
                                                  type="button"
                                                  onClick={() =>
                                                    copyText(
                                                      job.resumeAngle,
                                                      `angle_${job.rowId}`
                                                    )
                                                  }
                                                  className="text-[11px] text-slate-400 hover:text-white inline-flex items-center gap-1"
                                                >
                                                  {copiedId === `angle_${job.rowId}` ? (
                                                    <>
                                                      <Check className="h-3 w-3 text-emerald-400" />{' '}
                                                      Copied
                                                    </>
                                                  ) : (
                                                    <>
                                                      <Copy className="h-3 w-3" /> Copy
                                                    </>
                                                  )}
                                                </button>
                                              )}
                                            </div>
                                            <p className="text-xs text-slate-300 font-mono leading-relaxed">
                                              {job.resumeAngle || 'N/A'}
                                            </p>
                                          </div>
                                        </div>
                                      </div>

                                      <div className="lg:col-span-6 bg-[#111827] border border-slate-800 rounded-lg p-4 flex flex-col justify-between">
                                        <div>
                                          <div className="flex items-center justify-between mb-2">
                                            <span className="text-xs font-medium text-slate-300">
                                              Outreach DM Draft (LinkedIn / Cold Note)
                                            </span>
                                            <div className="flex items-center gap-2">
                                              {editingDmRowId === job.rowId ? (
                                                <button
                                                  type="button"
                                                  onClick={() => saveInlineDm(job.rowId)}
                                                  className="px-2.5 py-1 rounded text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white inline-flex items-center gap-1"
                                                >
                                                  <Save className="h-3 w-3" /> Save Draft
                                                </button>
                                              ) : (
                                                <button
                                                  type="button"
                                                  onClick={() => {
                                                    setEditingDmRowId(job.rowId);
                                                    setDraftDmText(job.dm);
                                                  }}
                                                  className="px-2 py-1 rounded text-xs text-slate-400 hover:text-white bg-slate-800/80"
                                                >
                                                  Edit Draft
                                                </button>
                                              )}
                                              <button
                                                type="button"
                                                onClick={() =>
                                                  copyText(job.dm, `dm_${job.rowId}`)
                                                }
                                                className="px-2.5 py-1 rounded text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 inline-flex items-center gap-1"
                                              >
                                                {copiedId === `dm_${job.rowId}` ? (
                                                  <>
                                                    <Check className="h-3 w-3 text-emerald-400" />{' '}
                                                    Copied
                                                  </>
                                                ) : (
                                                  <>
                                                    <Copy className="h-3 w-3" /> Copy DM
                                                  </>
                                                )}
                                              </button>
                                            </div>
                                          </div>

                                          {editingDmRowId === job.rowId ? (
                                            <textarea
                                              rows={3}
                                              value={draftDmText}
                                              onChange={(e) => setDraftDmText(e.target.value)}
                                              className="w-full bg-[#0B0F17] border border-slate-700 rounded p-2.5 text-xs text-slate-100 leading-relaxed focus:outline-none focus:border-emerald-500"
                                            />
                                          ) : (
                                            <p className="text-xs text-slate-300 leading-relaxed">
                                              {job.dm || 'No outreach draft generated yet.'}
                                            </p>
                                          )}
                                        </div>

                                        <div className="pt-3 mt-3 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400 font-mono tabular-nums">
                                          <span>Record ID: {job.id}</span>
                                          <span>
                                            Estimated Reply Likelihood:{' '}
                                            {prediction >= 0 ? `${prediction}%` : 'Completed Stage'}
                                          </span>
                                        </div>
                                      </div>
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

            <div className="px-4 py-2.5 border-t border-slate-800 bg-[#0D131F] flex flex-wrap items-center justify-between gap-4 text-xs text-slate-400 font-mono">
              <div className="flex items-center gap-4">
                <span>
                  <kbd className="px-1.5 py-0.5 bg-slate-800 text-slate-200 rounded text-[10px]">
                    j
                  </kbd>{' '}
                  /{' '}
                  <kbd className="px-1.5 py-0.5 bg-slate-800 text-slate-200 rounded text-[10px]">
                    k
                  </kbd>{' '}
                  navigate rows
                </span>
                <span>
                  <kbd className="px-1.5 py-0.5 bg-slate-800 text-slate-200 rounded text-[10px]">
                    x
                  </kbd>{' '}
                  select row
                </span>
                <span>
                  <kbd className="px-1.5 py-0.5 bg-slate-800 text-slate-200 rounded text-[10px]">
                    s
                  </kbd>{' '}
                  cycle stage
                </span>
                <span>
                  <kbd className="px-1.5 py-0.5 bg-slate-800 text-slate-200 rounded text-[10px]">
                    Enter
                  </kbd>{' '}
                  inspect
                </span>
                <span>
                  <kbd className="px-1.5 py-0.5 bg-slate-800 text-slate-200 rounded text-[10px]">
                    Esc
                  </kbd>{' '}
                  clear
                </span>
              </div>
              <div className="tabular-nums">
                Showing {filteredJobs.length} of {jobs.length} records
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
