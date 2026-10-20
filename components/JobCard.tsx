'use client';
import React, { useState } from 'react';
import MetricBar from './MetricBar';
import StatusBadge, { ALL_STATUSES } from './StatusBadge';
import { Button } from './ui/button';
import { Copy, Check, ArrowUpRight } from 'lucide-react';

export interface JobData {
  rowId?: number;
  Date: string;
  Title: string;
  Company: string;
  Score: number;
  Reasons: string;
  Gap: string;
  URL: string;
  DM: string;
  ResumeAngle: string;
  Status?: string;
}

export default function JobCard({
  job,
  onStatusChange,
}: {
  job: JobData;
  onStatusChange?: (rowId: number, newStatus: string) => void;
}) {
  const [copiedField, setCopiedField] = useState<'dm' | 'angle' | null>(null);

  const copyText = (text: string, field: 'dm' | 'angle') => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 1800);
  };

  const reasonItems = (job.Reasons || '')
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean);

  return (
    <div className="bg-[#111827] border border-slate-800/90 rounded-xl p-6 transition-colors hover:border-slate-700">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-4 border-b border-slate-800/80">
        <div>
          <div className="flex items-center gap-2 text-xs text-slate-400 mb-1">
            <span className="font-medium text-slate-200">{job.Company}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">{job.Date}</span>
            {job.ResumeAngle && (
              <>
                <span aria-hidden="true">·</span>
                <span className="text-emerald-400/90 truncate max-w-[260px]">
                  Lead metric ready
                </span>
              </>
            )}
          </div>
          <h3 className="text-lg font-display font-semibold text-white tracking-tight">
            {job.Title}
          </h3>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <MetricBar score={job.Score} />
          {job.Status && (
            <div className="relative">
              {onStatusChange && job.rowId ? (
                <>
                  <select
                    aria-label="Update application status"
                    value={job.Status}
                    onChange={(e) => onStatusChange(job.rowId!, e.target.value)}
                    className="absolute inset-0 opacity-0 cursor-pointer w-full z-20"
                  >
                    {ALL_STATUSES.map((s) => (
                      <option key={s} value={s} className="bg-slate-900 text-slate-200">
                        {s}
                      </option>
                    ))}
                  </select>
                  <StatusBadge status={job.Status} />
                </>
              ) : (
                <StatusBadge status={job.Status} />
              )}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 py-5 border-b border-slate-800/80">
        <div>
          <div className="text-xs font-medium text-slate-400 mb-2">
            Rubric Alignment Reasons
          </div>
          {reasonItems.length > 1 ? (
            <ul className="space-y-1.5 text-sm text-slate-300 leading-relaxed">
              {reasonItems.map((r, idx) => (
                <li key={idx} className="flex items-baseline gap-2">
                  <span className="text-emerald-400 font-mono text-xs tabular-nums">
                    0{idx + 1}.
                  </span>
                  <span>{r}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-300 leading-relaxed">
              {job.Reasons || 'Direct alignment with target role and location criteria.'}
            </p>
          )}
        </div>

        <div className="space-y-4">
          <div>
            <div className="text-xs font-medium text-amber-400/90 mb-1">
              Identified Risk & Mitigation Angle
            </div>
            <p className="text-sm text-slate-300 leading-relaxed">
              {job.Gap || 'No critical blockers detected; emphasize shipped AI & GTM metrics.'}
            </p>
          </div>

          {job.ResumeAngle && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-blue-400">
                  Recommended Resume Positioning
                </span>
                <button
                  type="button"
                  onClick={() => copyText(job.ResumeAngle, 'angle')}
                  className="text-xs text-slate-400 hover:text-slate-200 inline-flex items-center gap-1 transition-colors whitespace-nowrap shrink-0"
                >
                  {copiedField === 'angle' ? (
                    <>
                      <Check className="h-3 w-3 text-emerald-400" /> Copied
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3" /> Copy Angle
                    </>
                  )}
                </button>
              </div>
              <p className="text-xs text-slate-300 font-mono">{job.ResumeAngle}</p>
            </div>
          )}
        </div>
      </div>

      {job.DM && (
        <div className="pt-4 pb-2">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-slate-400">
              Synthesized Founder / Recruiter Outreach Draft
            </span>
            <button
              type="button"
              onClick={() => copyText(job.DM, 'dm')}
              className="px-2.5 py-1 rounded text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
            >
              {copiedField === 'dm' ? (
                <>
                  <Check className="h-3.5 w-3.5 text-emerald-400" /> Copied to Clipboard
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" /> Copy Outreach DM
                </>
              )}
            </button>
          </div>
          <p className="text-sm text-slate-300 leading-relaxed bg-[#0B0F17] border border-slate-800/80 rounded-lg p-3.5">
            {job.DM}
          </p>
        </div>
      )}

      <div className="pt-4 mt-2 flex items-center justify-between gap-4">
        <div className="text-xs text-slate-500 font-mono tabular-nums">
          Score: {job.Score}/100 · Target threshold ≥90
        </div>
        <Button
          asChild
          variant="outline"
          size="sm"
          className="text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-500 border-0 whitespace-nowrap shrink-0"
        >
          <a href={job.URL} target="_blank" rel="noreferrer">
            Open Application <ArrowUpRight className="ml-1.5 h-3.5 w-3.5" />
          </a>
        </Button>
      </div>
    </div>
  );
}
