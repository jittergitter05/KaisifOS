'use client';
import React, { useState } from 'react';
import JobAuditDrawer, { AuditableJob } from '@/components/JobAuditDrawer';
import { detectSource } from '@/lib/utils';

export interface PublicRecentMatchItem {
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
}

export default function PublicRecentMatches({ matches }: { matches: PublicRecentMatchItem[] }) {
  const [selectedJob, setSelectedJob] = useState<AuditableJob | null>(null);

  return (
    <>
      <JobAuditDrawer job={selectedJob} onClose={() => setSelectedJob(null)} />
      <div className="divide-y divide-slate-200 dark:divide-slate-800">
        {matches.length === 0 ? (
          <div className="py-6 text-xs text-slate-500 dark:text-slate-400">
            No matches logged yet. Run a Live Direct-ATS sweep in the Console.
          </div>
        ) : (
          matches.slice(0, 4).map((job) => (
            <button
              key={job.id}
              type="button"
              onClick={() =>
                setSelectedJob({
                  id: job.id,
                  date: job.date,
                  title: job.title,
                  company: job.company,
                  score: job.score,
                  reasons: job.reasons,
                  gap: job.gap,
                  url: job.url,
                  dm: job.dm,
                  resumeAngle: job.resumeAngle,
                  status: job.status || 'NEW',
                  source: detectSource(job.id || ''),
                })
              }
              className="w-full py-3 flex items-center justify-between gap-4 text-left hover:bg-slate-100/80 dark:hover:bg-slate-800/35 px-1.5 -mx-1.5 rounded transition-colors cursor-pointer"
            >
              <div className="min-w-0">
                <div className="text-xs font-medium text-slate-900 dark:text-white truncate">
                  {job.title}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
                  {job.company} · <span className="font-mono tabular-nums">{job.date}</span>
                </div>
              </div>
              <span className="font-mono tabular-nums text-xs font-semibold text-emerald-600 dark:text-emerald-400 shrink-0">
                {job.score}/100
              </span>
            </button>
          ))
        )}
      </div>
    </>
  );
}
