'use client';
import React, { useEffect, useState, useMemo, useCallback } from 'react';
import JobCard, { JobData } from '@/components/JobCard';
import { RefreshCw, Calendar } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function DigestPage() {
  const [jobs, setJobs] = useState<JobData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [minScore, setMinScore] = useState<number>(90);
  const [daysWindow, setDaysWindow] = useState<number>(7);

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
          const parsedJobs: JobData[] = data.rows
            .map((r: string[], i: number) => ({
              rowId: i + 1,
              Date: r[0] || '',
              Title: r[2] || '',
              Company: r[3] || '',
              Score: parseInt(r[4] || '0', 10),
              Reasons: r[5] || '',
              Gap: r[6] || '',
              URL: r[7] || '',
              DM: r[8] || '',
              ResumeAngle: r[9] || '',
              Status: r[10] || 'NEW',
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
    const prev = [...jobs];
    setJobs(jobs.map((j) => (j.rowId === rowId ? { ...j, Status: newStatus } : j)));
    try {
      const res = await fetch('/api/sheet-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rowId, status: newStatus }),
      });
      if (!res.ok) throw new Error('Status update failed');
    } catch {
      setJobs(prev);
    }
  };

  const filteredJobs = useMemo(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysWindow);

    return jobs
      .filter((j) => {
        if (j.Score < minScore) return false;
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
  }, [jobs, minScore, daysWindow]);

  const groupedJobs = useMemo(() => {
    const groups: Record<string, JobData[]> = {};
    filteredJobs.forEach((job) => {
      if (!groups[job.Date]) groups[job.Date] = [];
      groups[job.Date].push(job);
    });
    return groups;
  }, [filteredJobs]);

  return (
    <div className="flex flex-col flex-1 w-full bg-[#0B0F17] text-[#F8FAFC]">
      <div className="flex-1 py-6 px-4 sm:px-6 lg:px-8 max-w-5xl mx-auto w-full pb-24 space-y-6">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-slate-800/90 pb-5">
          <div>
            <h1 className="text-2xl font-display font-bold tracking-tight text-white">
              High-Conviction Scout Digest
            </h1>
            <p className="text-xs text-slate-400 mt-1">
              Curated daily role matches with pre-synthesized LinkedIn outreach and resume
              positioning angles.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <div className="flex items-center gap-1 p-1 bg-[#111827] border border-slate-800 rounded-lg">
              {[
                { label: 'Score ≥ 90', val: 90 },
                { label: 'Score ≥ 85', val: 85 },
                { label: 'All Scores', val: 0 },
              ].map((opt) => (
                <button
                  key={opt.val}
                  type="button"
                  onClick={() => setMinScore(opt.val)}
                  className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                    minScore === opt.val
                      ? 'bg-slate-800 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <select
              aria-label="Digest time window"
              value={daysWindow}
              onChange={(e) => setDaysWindow(Number(e.target.value))}
              className="bg-[#111827] border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
            >
              <option value={7}>Past 7 Days</option>
              <option value={14}>Past 14 Days</option>
              <option value={365}>All Dates</option>
            </select>

            <Button
              onClick={fetchDigest}
              disabled={loading}
              variant="outline"
              size="sm"
              className="shrink-0 bg-[#111827] border-slate-800 hover:bg-slate-800 text-slate-300 text-xs h-8"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 mr-1.5 ${loading ? 'animate-spin text-emerald-400' : ''}`}
              />
              Refresh
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, idx) => (
              <div
                key={idx}
                className="h-48 bg-[#111827] border border-slate-800 rounded-xl animate-pulse"
              />
            ))}
          </div>
        ) : error ? (
          <div className="text-center py-12 text-rose-400 font-mono text-xs">{error}</div>
        ) : filteredJobs.length === 0 ? (
          <div className="text-center py-14 bg-[#111827] rounded-xl border border-slate-800 space-y-3">
            <p className="text-sm font-medium text-white">
              No matches found for Score ≥ {minScore} in the selected window.
            </p>
            <p className="text-xs text-slate-400">
              Lower the conviction threshold filter or expand the date window to inspect all
              evaluated leads.
            </p>
            <Button
              type="button"
              size="sm"
              onClick={() => {
                setMinScore(85);
                setDaysWindow(14);
              }}
              className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs"
            >
              Show Score ≥ 85 (14 Days)
            </Button>
          </div>
        ) : (
          <div className="space-y-10 pb-12">
            {Object.entries(groupedJobs).map(([date, dateJobs]) => (
              <section key={date} className="space-y-4">
                <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
                  <div className="flex items-center gap-2.5">
                    <Calendar className="h-4 w-4 text-emerald-400" />
                    <h2 className="text-base font-display font-semibold text-white font-mono tabular-nums">
                      {date}
                    </h2>
                  </div>
                  <span className="text-xs font-mono tabular-nums text-slate-400">
                    {dateJobs.length} {dateJobs.length === 1 ? 'role' : 'roles'} matched
                  </span>
                </div>
                <div className="space-y-4">
                  {dateJobs.map((job) => (
                    <JobCard
                      key={job.rowId || `${job.Company}-${job.Title}`}
                      job={job}
                      onStatusChange={handleStatusChange}
                    />
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
