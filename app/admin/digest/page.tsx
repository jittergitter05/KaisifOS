'use client';
import React, { useEffect, useState, useMemo, useCallback } from 'react';
import JobCard, { JobData } from '@/components/JobCard';
import JobAuditDrawer, { AuditableJob } from '@/components/JobAuditDrawer';
import {
  RefreshCw,
  Calendar,
  Copy,
  Check,
  Layers,
  AlertTriangle,
  X,
  Download,
  Radar,
  ArrowUpRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  SOURCE_FILTER_OPTIONS,
  detectSource,
  parseIsoDateTimestamp,
  safeExternalUrl,
  extractExternalHost,
  copyToClipboardSafe,
} from '@/lib/utils';

export default function DigestPage() {
  const [jobs, setJobs] = useState<(JobData & { id: string; source: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [scoutingLive, setScoutingLive] = useState(false);
  const [sweepNotice, setSweepNotice] = useState<{
    summary: string;
    committedJobs: Array<{ title: string; company: string; score: number; url?: string; source?: string }>;
  } | null>(null);
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

  const runLiveCareerScout = async () => {
    setScoutingLive(true);
    setActionError(null);
    setSweepNotice(null);
    try {
      const res = await fetch('/api/scout/live', { method: 'POST' });
      if (res.status === 401) {
        window.location.href = '/login';
        return;
      }
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) {
        throw new Error(data?.error || `Live Career & ATS scout failed (HTTP ${res.status})`);
      }
      const committed = Array.isArray(data.committedJobs) ? data.committedJobs : [];
      setSweepNotice({
        summary: `Scanned ${data.scanned ?? 0} live Career Page, Direct-ATS & remote roles · Added ${data.addedCount ?? 0} real matches.`,
        committedJobs: committed,
      });
      if ((data.addedCount ?? 0) > 0 && minScore > 75) {
        setMinScore(75);
      }
      fetchDigest();
    } catch (e) {
      setActionError((e as Error).message || 'Network error while running live Career & ATS scout.');
    } finally {
      setScoutingLive(false);
    }
  };

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
    const cutoffMs = Date.now() - daysWindow * 24 * 60 * 60 * 1000;

    return jobs
      .filter((j) => {
        if (j.Score < minScore) return false;
        if (sourceFilter !== 'ALL' && j.source !== sourceFilter) return false;
        if (daysWindow >= 365) return true;
        const ts = parseIsoDateTimestamp(j.Date);
        return Number.isFinite(ts) && ts >= cutoffMs;
      })
      .sort((a, b) => {
        const tsB = parseIsoDateTimestamp(b.Date) || 0;
        const tsA = parseIsoDateTimestamp(a.Date) || 0;
        if (tsB !== tsA) return tsB - tsA;
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
      ...filteredJobs.map((j, idx) => {
        const directUrl = safeExternalUrl(j.URL);
        const linkLine = directUrl !== '#' ? directUrl : 'Missing Apply URL';
        return `### ${idx + 1}. ${j.Title} @ ${j.Company} (${j.Score}/100 — ${j.source})\n- **Status:** ${j.Status}\n- **Signals:** ${j.Reasons}\n- **Lead Angle:** ${j.ResumeAngle}\n- **Outreach DM:** ${j.DM}\n- **Direct Apply Page:** ${linkLine}\n`;
      }),
    ];
    return lines.join('\n');
  };

  const copyExecutiveMarkdown = async () => {
    const ok = await copyToClipboardSafe(buildMarkdownBrief());
    if (ok) {
      setCopiedReport(true);
      setTimeout(() => setCopiedReport(false), 2000);
    }
  };

  const downloadMarkdownReport = () => {
    const blob = new Blob([buildMarkdownBrief()], { type: 'text/markdown;charset=utf-8;' });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = `kaisifos-digest-${new Date().toISOString().split('T')[0]}.md`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
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
            <Button
              type="button"
              onClick={runLiveCareerScout}
              disabled={scoutingLive}
              size="sm"
              className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs h-8 whitespace-nowrap shrink-0"
            >
              <Radar className={`h-3.5 w-3.5 mr-1.5 ${scoutingLive ? 'animate-spin' : ''}`} />
              {scoutingLive ? 'Scouting Career Pages...' : 'Run Live Career & ATS Scout'}
            </Button>

            <div className="flex items-center gap-1 p-1 bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-md">
              {[
                { label: 'Score ≥ 90', val: 90 },
                { label: 'Score ≥ 75', val: 75 },
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

        {sweepNotice && (
          <div className="bg-emerald-50 dark:bg-emerald-950/35 border border-emerald-200 dark:border-emerald-800/70 text-emerald-900 dark:text-emerald-200 px-4 py-3 rounded-md text-xs space-y-2">
            <div className="flex items-center justify-between gap-3">
              <span className="font-mono">{sweepNotice.summary}</span>
              <button
                type="button"
                onClick={() => setSweepNotice(null)}
                aria-label="Dismiss scout notice"
                className="text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white shrink-0 cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            {sweepNotice.committedJobs.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-1 border-t border-emerald-200/70 dark:border-emerald-800/50">
                {sweepNotice.committedJobs.map((cj, idx) => {
                  const href = safeExternalUrl(cj.url);
                  const host = extractExternalHost(cj.url);
                  return (
                    <div
                      key={`${cj.company}-${cj.title}-${idx}`}
                      className="inline-flex items-center gap-2 bg-white dark:bg-[#0B0F17] border border-emerald-200 dark:border-emerald-800/60 rounded px-2.5 py-1 text-[11px]"
                    >
                      <span className="font-medium text-slate-900 dark:text-white">
                        {cj.title} @ {cj.company}
                      </span>
                      <span className="font-mono text-emerald-600 dark:text-emerald-400 tabular-nums">
                        {cj.score}/100
                      </span>
                      {href !== '#' && (
                        <a
                          href={href}
                          target="_blank"
                          rel="noreferrer"
                          className="font-mono text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-0.5"
                        >
                          Apply ({host || 'Direct'}) <ArrowUpRight className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

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
        ) : jobs.length === 0 ? (
          <div className="text-center py-14 px-6 bg-white dark:bg-[#111827] rounded-lg border border-slate-200 dark:border-slate-800 space-y-3">
            <p className="text-sm font-medium text-slate-900 dark:text-white">
              No live scouted matches persisted yet.
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xl mx-auto">
              Synthetic sample entries have been removed so only real roles with verified apply
              pages appear here. Run a live sweep across your configured Company Career Pages and
              6 ATS providers to populate your digest.
            </p>
            <Button
              type="button"
              size="sm"
              disabled={scoutingLive}
              onClick={runLiveCareerScout}
              className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs"
            >
              <Radar className={`h-3.5 w-3.5 mr-1.5 ${scoutingLive ? 'animate-spin' : ''}`} />
              {scoutingLive ? 'Scouting Career Pages...' : 'Run Live Career & ATS Scout Now'}
            </Button>
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
                setMinScore(0);
                setDaysWindow(365);
                setSourceFilter('ALL');
              }}
              className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs"
            >
              Show All Evaluated Matches
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
                  {dateJobs.map((job) => {
                    const directUrl = safeExternalUrl(job.URL);
                    const applyHost = extractExternalHost(job.URL);
                    return (
                      <div key={job.rowId || `${job.Company}-${job.Title}`} className="space-y-1.5">
                        <div className="flex flex-wrap items-center justify-between gap-2 px-1">
                          <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono text-slate-500 dark:text-slate-400">
                            <span>
                              Source:{' '}
                              <strong className="text-slate-800 dark:text-slate-200">
                                {job.source}
                              </strong>{' '}
                              · ID: {job.id}
                            </span>
                            <span aria-hidden="true">·</span>
                            {directUrl !== '#' ? (
                              <a
                                href={directUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-0.5"
                              >
                                Direct Apply ({applyHost || 'External'}){' '}
                                <ArrowUpRight className="h-3 w-3" />
                              </a>
                            ) : (
                              <span className="text-amber-600 dark:text-amber-400">
                                Direct Apply URL missing
                              </span>
                            )}
                          </div>
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
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
