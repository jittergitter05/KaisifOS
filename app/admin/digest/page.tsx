'use client';
import React, { useEffect, useState, useMemo, useCallback } from 'react';
import JobCard, { JobData } from '@/components/JobCard';
import JobAuditDrawer, { AuditableJob } from '@/components/JobAuditDrawer';
import { RefreshCw, Calendar, Copy, Check, Layers, AlertTriangle, X, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SOURCE_FILTER_OPTIONS, detectSource } from '@/lib/utils';

export default function DigestPage() {
  const [jobs, setJobs] = useState<(JobData & { id: string; source: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [minScore, setMinScore] = useState<number>(90);
  const [daysWindow, setDaysWindow] = useState<number>(14);
  const [sourceFilter, setSourceFilter] = useState<string>('ALL');
  const [copiedReport, setCopiedReport] = useState(false);
  const [auditJob, setAuditJob] = useState<AuditableJob | null>(null);

  const fetchDigest = useCallback(() => {
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
          const parsedJobs = data.rows
            .map((r: string[], i: number) => ({
              rowId: i + 1,
              Date: r[0] || '',
              id: r[1] || '',
              Title: r[2] || '',
              Company: r[3] || '',
              Score: parseInt(r[4] || '0', 10),
              Reasons: r[5] || '',
              Gap: r[6] || '',
              URL: r[7] || '',
              DM: r[8] || '',
              ResumeAngle: r[9] || '',
              Status: r[10] || 'NEW',
              source: detectSource(r[1] || ''),
            }))
            .filter((j: JobData) => j.Title !== 'Title' && Boolean(j.Date));

          setJobs(parsedJobs);
        }
        setLoading(false);
      })
      .catch((err) => {
        console.error(err);
        setError('Failed to load digest data.');
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    fetchDigest();
  }, [fetchDigest]);

  const handleStatusChange = async (rowId: number, newStatus: string) => {
    setActionError(null);
    const targetJob = jobs.find((j) => j.rowId === rowId);
    const prev = [...jobs];
    setJobs(jobs.map((j) => (j.rowId === rowId ? { ...j, Status: newStatus } : j)));
    try {
      const res = await fetch('/api/sheet-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: targetJob?.id, rowId, status: newStatus }),
      });
      if (res.status === 401) {
        window.location.href = '/login';
        return;
      }
      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        throw new Error(errData?.error || `Status update failed (HTTP ${res.status})`);
      }
    } catch (e) {
      setJobs(prev);
      setActionError((e as Error).message || 'Failed to save status change.');
    }
  };

  const filteredJobs = useMemo(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysWindow);

    return jobs
      .filter((j) => {
        if (j.Score < minScore) return false;
        if (sourceFilter !== 'ALL' && j.source !== sourceFilter) return false;
        if (daysWindow >= 365) return true;
        try {
          return new Date(j.Date) >= cutoff;
        } catch {
          return false;
        }
      })
      .sort((a, b) => {
        const dateDiff = new Date(b.Date).getTime() - new Date(a.Date).getTime();
        if (dateDiff !== 0) return dateDiff;
        return b.Score - a.Score;
      });
  }, [jobs, minScore, daysWindow, sourceFilter]);

  const groupedJobs = useMemo(() => {
    const groups: Record<string, (JobData & { id: string; source: string })[]> = {};
    filteredJobs.forEach((job) => {
      if (!groups[job.Date]) groups[job.Date] = [];
      groups[job.Date].push(job);
    });
    return groups;
  }, [filteredJobs]);

  const buildMarkdownBrief = () => {
    const lines = [
      `# Executive Scout Digest (${new Date().toISOString().split('T')[0]})`,
      `Criteria: Score >= ${minScore} | Window: ${daysWindow}d | Source: ${sourceFilter} | Matches: ${filteredJobs.length}`,
      '',
      ...filteredJobs.map(
        (j, idx) =>
          `### ${idx + 1}. ${j.Title} @ ${j.Company} (${j.Score}/100 — ${j.source})\n- **Status:** ${j.Status}\n- **Signals:** ${j.Reasons}\n- **Lead Angle:** ${j.ResumeAngle}\n- **Outreach DM:** ${j.DM}\n- **Link:** ${j.URL}\n`
      ),
    ];
    return lines.join('\n');
  };

  const copyExecutiveMarkdown = () => {
    navigator.clipboard.writeText(buildMarkdownBrief());
    setCopiedReport(true);
    setTimeout(() => setCopiedReport(false), 2000);
  };

  const downloadMarkdownReport = () => {
    const blob = new Blob([buildMarkdownBrief()], { type: 'text/markdown;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `kaisifos-digest-${new Date().toISOString().split('T')[0]}.md`;
    link.click();
  };

  return (
    <div className="flex flex-col flex-1 w-full bg-slate-50 dark:bg-[#0B0F17] text-slate-900 dark:text-[#F8FAFC]">
      <JobAuditDrawer
        job={auditJob}
        onClose={() => setAuditJob(null)}
        onJobUpdated={fetchDigest}
      />

      <div className="flex-1 py-6 px-4 sm:px-6 lg:px-8 max-w-5xl mx-auto w-full pb-24 space-y-6">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-slate-200 dark:border-slate-800 pb-5">
          <div>
            <h1 className="text-2xl font-display font-bold tracking-tight text-slate-900 dark:text-white">
              Executive Scout Digest &amp; Reporting Criteria
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Filter by conviction threshold, ATS channel, and time window, or export a structured
              Markdown brief.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <div className="flex items-center gap-1 p-1 bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-md">
              {[
                { label: 'Score ≥ 90', val: 90 },
                { label: 'Score ≥ 85', val: 85 },
                { label: 'All Scores', val: 0 },
              ].map((opt) => (
                <button
                  key={opt.val}
                  type="button"
                  onClick={() => setMinScore(opt.val)}
                  className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    minScore === opt.val
                      ? 'bg-slate-200 dark:bg-slate-800 text-slate-900 dark:text-white'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <select
              aria-label="Filter digest by source"
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value)}
              className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-md px-2.5 py-1.5 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:border-emerald-500"
            >
              <option
                value="ALL"
                className="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-200"
              >
                All Sources &amp; ATS
              </option>
              {SOURCE_FILTER_OPTIONS.map((src) => (
                <option
                  key={src}
                  value={src}
                  className="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-200"
                >
                  {src}
                </option>
              ))}
            </select>

            <select
              aria-label="Digest time window"
              value={daysWindow}
              onChange={(e) => setDaysWindow(Number(e.target.value))}
              className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-md px-2.5 py-1.5 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:border-emerald-500"
            >
              <option
                value={7}
                className="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-200"
              >
                Past 7 Days
              </option>
              <option
                value={14}
                className="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-200"
              >
                Past 14 Days
              </option>
              <option
                value={365}
                className="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-200"
              >
                All Dates
              </option>
            </select>

            <Button
              type="button"
              onClick={copyExecutiveMarkdown}
              variant="outline"
              size="sm"
              className="bg-white dark:bg-[#111827] border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200 text-xs h-8 whitespace-nowrap"
            >
              {copiedReport ? (
                <>
                  <Check className="h-3.5 w-3.5 mr-1.5 text-emerald-600 dark:text-emerald-400" />{' '}
                  Brief Copied
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5 mr-1.5" /> Copy Markdown Report
                </>
              )}
            </Button>

            <Button
              type="button"
              onClick={downloadMarkdownReport}
              variant="outline"
              size="sm"
              className="bg-white dark:bg-[#111827] border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200 text-xs h-8 whitespace-nowrap"
            >
              <Download className="h-3.5 w-3.5 mr-1.5" /> .md
            </Button>

            <Button
              onClick={fetchDigest}
              disabled={loading}
              variant="outline"
              size="sm"
              className="shrink-0 bg-white dark:bg-[#111827] border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs h-8"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 mr-1.5 ${
                  loading ? 'animate-spin text-emerald-500 dark:text-emerald-400' : ''
                }`}
              />
              Refresh
            </Button>
          </div>
        </div>

        {actionError && (
          <div className="bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/70 text-rose-800 dark:text-rose-200 px-4 py-2.5 rounded-md text-xs font-mono flex items-center justify-between gap-3">
            <span className="flex items-center gap-2">
              <AlertTriangle className="h-3.5 w-3.5 text-rose-600 dark:text-rose-400 shrink-0" />
              {actionError}
            </span>
            <button
              type="button"
              onClick={() => setActionError(null)}
              aria-label="Dismiss error"
              className="text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white shrink-0 cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {loading ? (
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, idx) => (
              <div
                key={idx}
                className="h-48 bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-lg animate-pulse"
              />
            ))}
          </div>
        ) : error ? (
          <div className="text-center py-12 text-rose-600 dark:text-rose-400 font-mono text-xs">
            {error}
          </div>
        ) : filteredJobs.length === 0 ? (
          <div className="text-center py-14 bg-white dark:bg-[#111827] rounded-lg border border-slate-200 dark:border-slate-800 space-y-3">
            <p className="text-sm font-medium text-slate-900 dark:text-white">
              No matches found for Score ≥ {minScore} in the selected window.
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Lower the conviction threshold filter or expand the date window to inspect all
              evaluated leads.
            </p>
            <Button
              type="button"
              size="sm"
              onClick={() => {
                setMinScore(85);
                setDaysWindow(365);
                setSourceFilter('ALL');
              }}
              className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs"
            >
              Show All Evaluated Matches (Score ≥ 85)
            </Button>
          </div>
        ) : (
          <div className="space-y-10 pb-12">
            {Object.entries(groupedJobs).map(([date, dateJobs]) => (
              <section key={date} className="space-y-4">
                <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-2">
                  <div className="flex items-center gap-2.5">
                    <Calendar className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                    <h2 className="text-base font-display font-semibold text-slate-900 dark:text-white font-mono tabular-nums">
                      {date}
                    </h2>
                  </div>
                  <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                    {dateJobs.length} {dateJobs.length === 1 ? 'role' : 'roles'} matched
                  </span>
                </div>
                <div className="space-y-4">
                  {dateJobs.map((job) => (
                    <div key={job.rowId || `${job.Company}-${job.Title}`} className="space-y-1.5">
                      <div className="flex items-center justify-between px-1">
                        <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                          Source:{' '}
                          <strong className="text-slate-800 dark:text-slate-200">
                            {job.source}
                          </strong>{' '}
                          · ID: {job.id}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setAuditJob({
                              rowId: job.rowId,
                              id: job.id,
                              date: job.Date,
                              title: job.Title,
                              company: job.Company,
                              score: job.Score,
                              reasons: job.Reasons,
                              gap: job.Gap,
                              url: job.URL,
                              dm: job.DM,
                              resumeAngle: job.ResumeAngle,
                              status: job.Status || 'NEW',
                              source: job.source,
                            })
                          }
                          className="text-[11px] font-mono text-emerald-600 dark:text-emerald-400 hover:underline inline-flex items-center gap-1 cursor-pointer"
                        >
                          <Layers className="h-3 w-3" /> Inspect 4-Pillar Subscores →
                        </button>
                      </div>
                      <JobCard job={job} onStatusChange={handleStatusChange} />
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
