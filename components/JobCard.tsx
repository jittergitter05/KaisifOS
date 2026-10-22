'use client';
import React, { useState } from 'react';
import MetricBar from './MetricBar';
import StatusBadge, { ALL_STATUSES } from './StatusBadge';
import { Button } from './ui/button';
import { Copy, Check, ArrowUpRight, BookOpen, RefreshCw } from 'lucide-react';

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
  const [showPrep, setShowPrep] = useState(false);
  const [loadingPrep, setLoadingPrep] = useState(false);
  const [prepData, setPrepData] = useState<any>(null);

  const copyText = (text: string, field: 'dm' | 'angle') => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 1800);
  };

  const handleLoadPrep = async () => {
    if (showPrep) {
      setShowPrep(false);
      return;
    }
    setShowPrep(true);
    if (prepData) return;
    setLoadingPrep(true);
    try {
      const res = await fetch('/api/prep', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: job.Title,
          company: job.Company,
          reasons: job.Reasons,
          gap: job.Gap,
        }),
      });
      if (res.ok) {
        setPrepData(await res.json());
      }
    } catch (e) {
      console.error('Prep load failed:', e);
    } finally {
      setLoadingPrep(false);
    }
  };

  const reasonItems = (job.Reasons || '')
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean);

  // Reconstruct 4-pillar distribution from score
  const rolePillar = Math.min(40, Math.round(job.Score * 0.4));
  const expPillar = Math.min(25, Math.round(job.Score * 0.25));
  const geoPillar = Math.min(20, Math.round(job.Score * 0.2));
  const compPillar = Math.min(15, Math.max(5, job.Score - (rolePillar + expPillar + geoPillar)));

  return (
    <div className="bg-[#111827] border border-slate-800/90 rounded-xl p-6 transition-colors hover:border-slate-700">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-4 border-b border-slate-800/80">
        <div>
          <div className="flex items-center gap-2 text-xs text-slate-400 mb-1">
            <span className="font-medium text-slate-200">{job.Company}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">{job.Date}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums text-slate-300">
              Role {rolePillar}/40 · Seniority {expPillar}/25 · Geo {geoPillar}/20 · Comp{' '}
              {compPillar}/15
            </span>
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

      {showPrep && (
        <div className="mt-4 bg-[#0B0F17] border border-slate-800 rounded-lg p-4 space-y-3 text-xs">
          {loadingPrep ? (
            <div className="py-4 text-center text-slate-400 font-mono flex items-center justify-center gap-2">
              <RefreshCw className="h-4 w-4 animate-spin text-emerald-400" /> Generating Role Prep
              Pack...
            </div>
          ) : prepData ? (
            <>
              <div>
                <div className="font-semibold text-emerald-400 mb-1">
                  Tailored STAR Resume Bullets for {job.Company}
                </div>
                <ul className="space-y-1 text-slate-200 leading-relaxed">
                  {(prepData.tailored_bullets || []).map((b: string, i: number) => (
                    <li key={i}>• {b}</li>
                  ))}
                </ul>
              </div>
              <div className="border-t border-slate-800 pt-2.5">
                <div className="font-semibold text-blue-400 mb-1">
                  Day-3 & Day-7 Recruiter Follow-Up Sequence
                </div>
                <p className="text-slate-300 leading-relaxed">
                  <strong className="text-white">Day 3:</strong>{' '}
                  {prepData.follow_up_sequence?.day_3_nudge}
                </p>
              </div>
            </>
          ) : null}
        </div>
      )}

      <div className="pt-4 mt-2 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-500 font-mono tabular-nums">
            Score: {job.Score}/100 · Target threshold ≥90
          </span>
          <button
            type="button"
            onClick={handleLoadPrep}
            className="text-xs font-medium text-emerald-400 hover:text-emerald-300 inline-flex items-center gap-1 cursor-pointer"
          >
            <BookOpen className="h-3.5 w-3.5" />
            {showPrep ? 'Hide Interview & Resume Prep' : 'Interview & STAR Bullet Prep'}
          </button>
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
