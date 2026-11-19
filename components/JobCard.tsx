'use client';
import React, { useState } from 'react';
import MetricBar from './MetricBar';
import StatusBadge, { ALL_STATUSES } from './StatusBadge';
import { Button } from './ui/button';
import {
  Copy,
  Check,
  ArrowUpRight,
  BookOpen,
  RefreshCw,
  Link2,
  Users,
  Clock,
  MailCheck,
} from 'lucide-react';
import {
  deriveJobPillarBreakdown,
  safeExternalUrl,
  extractExternalHost,
  copyToClipboardSafe,
} from '@/lib/utils';
import {
  buildPeopleSearchLinks,
  computeJobFreshnessAndCadence,
} from '@/lib/outreach-engine';

export interface JobData {
  rowId?: number;
  Date: string;
  Title: string;
  Company: string;
  location?: string;
  Score: number;
  Reasons: string;
  Gap: string;
  URL: string;
  DM: string;
  ResumeAngle: string;
  Status?: string;
  appliedAt?: string | null;
  lastFollowUpAt?: string | null;
  followUpCount?: number;
  lastReplySummary?: string;
  lastReplyClassification?: string;
}

interface PrepData {
  tailored_bullets?: string[];
  follow_up_sequence?: {
    day_3_nudge?: string;
    day_7_value_add?: string;
  };
}

export default function JobCard({
  job,
  onStatusChange,
}: {
  job: JobData;
  onStatusChange?: (rowId: number, newStatus: string) => void;
}) {
  const [copiedField, setCopiedField] = useState<'dm' | 'angle' | 'url' | null>(null);
  const [showPrep, setShowPrep] = useState(false);
  const [loadingPrep, setLoadingPrep] = useState(false);
  const [prepData, setPrepData] = useState<PrepData | null>(null);
  const [prepError, setPrepError] = useState<string | null>(null);

  const copyText = async (text: string, field: 'dm' | 'angle' | 'url') => {
    if (!text) return;
    const ok = await copyToClipboardSafe(text);
    if (ok) {
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 1800);
    }
  };

  const handleLoadPrep = async () => {
    if (showPrep) {
      setShowPrep(false);
      return;
    }
    setShowPrep(true);
    if (prepData) return;
    setLoadingPrep(true);
    setPrepError(null);
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
      } else {
        setPrepError(`Unable to generate prep pack (HTTP ${res.status}).`);
      }
    } catch {
      setPrepError('Network error while generating role prep pack.');
    } finally {
      setLoadingPrep(false);
    }
  };

  const reasonItems = (job.Reasons || '')
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean);

  const pillars = deriveJobPillarBreakdown({ score: job.Score, reasons: job.Reasons });
  const externalUrl = safeExternalUrl(job.URL);
  const applyHost = extractExternalHost(job.URL);
  const peopleLinks = buildPeopleSearchLinks({
    title: job.Title,
    company: job.Company,
    location: job.location,
  });
  const cadence = computeJobFreshnessAndCadence({
    date: job.Date,
    status: job.Status,
    appliedAt: job.appliedAt,
    lastFollowUpAt: job.lastFollowUpAt,
    followUpCount: job.followUpCount,
  });

  return (
    <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800/90 rounded-xl p-6 transition-colors hover:border-slate-300 dark:hover:border-slate-700">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-4 border-b border-slate-200 dark:border-slate-800/80">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400 mb-1">
            <span className="font-medium text-slate-800 dark:text-slate-200">{job.Company}</span>
            {job.location && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono text-slate-600 dark:text-slate-300">{job.location}</span>
              </>
            )}
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">{job.Date}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums text-slate-600 dark:text-slate-300">
              Role {pillars.role.earned}/40 · Skill {pillars.skill.earned}/30 · Seniority{' '}
              {pillars.seniority.earned}/15 · Comp/Geo {pillars.compGeo.earned}/15
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-display font-semibold text-slate-900 dark:text-white tracking-tight">
              {job.Title}
            </h3>
            {cadence.isStaleNew && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono bg-amber-50 text-amber-800 border border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800/60">
                <Clock className="h-3 w-3" /> Stale {cadence.ageDays}d
              </span>
            )}
            {cadence.isFollowUpDue && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono bg-blue-50 text-blue-800 border border-blue-200 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800/60">
                <Clock className="h-3 w-3" />
                {cadence.cadenceStage === 'DUE_BUMP_1'
                  ? 'Bump #1 Due'
                  : cadence.cadenceStage === 'DUE_BUMP_2'
                  ? 'Bump #2 Due'
                  : 'Cooling / Ghosted'}
              </span>
            )}
            {job.lastReplyClassification && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono bg-emerald-50 text-emerald-800 border border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800/60">
                <MailCheck className="h-3 w-3" /> {job.lastReplyClassification.replace('_', ' ')}
              </span>
            )}
          </div>
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
                      <option
                        key={s}
                        value={s}
                        className="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-200"
                      >
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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 py-5 border-b border-slate-200 dark:border-slate-800/80">
        <div>
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">
            Rubric Alignment Reasons
          </div>
          {reasonItems.length > 1 ? (
            <ul className="space-y-1.5 text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
              {reasonItems.map((r, idx) => (
                <li key={idx} className="flex items-baseline gap-2">
                  <span className="text-emerald-600 dark:text-emerald-400 font-mono text-xs tabular-nums">
                    0{idx + 1}.
                  </span>
                  <span>{r}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
              {job.Reasons || 'Direct alignment with target role and location criteria.'}
            </p>
          )}
        </div>

        <div className="space-y-4">
          <div>
            <div className="text-xs font-medium text-amber-600 dark:text-amber-400/90 mb-1">
              Identified Risk &amp; Mitigation Angle
            </div>
            <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
              {job.Gap || 'No critical blockers detected; emphasize shipped AI & GTM metrics.'}
            </p>
          </div>

          {job.ResumeAngle && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-blue-600 dark:text-blue-400">
                  Recommended Resume Positioning
                </span>
                <button
                  type="button"
                  onClick={() => copyText(job.ResumeAngle, 'angle')}
                  className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 inline-flex items-center gap-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {copiedField === 'angle' ? (
                    <>
                      <Check className="h-3 w-3 text-emerald-600 dark:text-emerald-400" /> Copied
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3" /> Copy Angle
                    </>
                  )}
                </button>
              </div>
              <p className="text-xs text-slate-700 dark:text-slate-300 font-mono">
                {job.ResumeAngle}
              </p>
            </div>
          )}
        </div>
      </div>

      {job.DM && (
        <div className="pt-4 pb-2">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Synthesized Founder / Recruiter Outreach Draft
            </span>
            <button
              type="button"
              onClick={() => copyText(job.DM, 'dm')}
              className="px-2.5 py-1 rounded text-xs font-medium bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {copiedField === 'dm' ? (
                <>
                  <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" /> Copied
                  to Clipboard
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" /> Copy Outreach DM
                </>
              )}
            </button>
          </div>
          <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed bg-slate-50 dark:bg-[#0B0F17] rounded-lg p-3.5">
            {job.DM}
          </p>
        </div>
      )}

      {/* 1-Click LinkedIn People Finder */}
      <div className="pt-3 pb-1 flex flex-wrap items-center gap-2 text-xs">
        <span className="inline-flex items-center gap-1 text-[11px] font-mono text-slate-500 dark:text-slate-400 mr-1">
          <Users className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
          People Finder:
        </span>
        {peopleLinks.map((link) => (
          <a
            key={link.role}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            title={`LinkedIn Boolean search for ${link.personaHint}`}
            className="px-2.5 py-1 rounded-md text-[11px] font-mono bg-slate-100 dark:bg-slate-800/80 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 inline-flex items-center gap-1 transition-colors whitespace-nowrap"
          >
            {link.label.replace('Find ', '')}{' '}
            <span className="text-slate-400 dark:text-slate-500 hidden sm:inline">
              ({link.personaHint.split('/')[0].trim()})
            </span>
            <ArrowUpRight className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
          </a>
        ))}
      </div>

      {showPrep && (
        <div className="mt-4 bg-slate-50 dark:bg-[#0B0F17] rounded-lg p-4 space-y-3 text-xs border-t border-slate-200 dark:border-slate-800">
          {loadingPrep ? (
            <div className="py-4 text-center text-slate-500 dark:text-slate-400 font-mono flex items-center justify-center gap-2">
              <RefreshCw className="h-4 w-4 animate-spin text-emerald-500 dark:text-emerald-400" />{' '}
              Generating Role Prep Pack...
            </div>
          ) : prepError ? (
            <div className="py-2 text-rose-600 dark:text-rose-400 font-mono text-xs">
              {prepError}
            </div>
          ) : prepData ? (
            <>
              <div>
                <div className="font-semibold text-emerald-600 dark:text-emerald-400 mb-1">
                  Tailored STAR Resume Bullets for {job.Company}
                </div>
                <ul className="space-y-1 text-slate-700 dark:text-slate-200 leading-relaxed">
                  {(prepData.tailored_bullets || []).map((b: string, i: number) => (
                    <li key={i}>• {b}</li>
                  ))}
                </ul>
              </div>
              <div className="border-t border-slate-200 dark:border-slate-800 pt-2.5">
                <div className="font-semibold text-blue-600 dark:text-blue-400 mb-1">
                  Day-3 &amp; Day-7 Recruiter Follow-Up Sequence
                </div>
                <p className="text-slate-700 dark:text-slate-300 leading-relaxed">
                  <strong className="text-slate-900 dark:text-white">Day 3:</strong>{' '}
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
            className="text-xs font-medium text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 inline-flex items-center gap-1 cursor-pointer"
          >
            <BookOpen className="h-3.5 w-3.5" />
            {showPrep ? 'Hide Interview & Resume Prep' : 'Interview & STAR Bullet Prep'}
          </button>
        </div>
        <div className="flex items-center gap-2">
          {externalUrl !== '#' && (
            <button
              type="button"
              onClick={() => copyText(externalUrl, 'url')}
              className="px-2.5 py-1.5 rounded text-xs font-medium bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {copiedField === 'url' ? (
                <>
                  <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" /> Copied URL
                </>
              ) : (
                <>
                  <Link2 className="h-3.5 w-3.5" /> Copy Link
                </>
              )}
            </button>
          )}
          {externalUrl !== '#' ? (
            <Button
              asChild
              variant="outline"
              size="sm"
              className="text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-500 border-0 whitespace-nowrap shrink-0"
            >
              <a href={externalUrl} target="_blank" rel="noopener noreferrer">
                Apply on {applyHost || 'Company Site'} <ArrowUpRight className="ml-1.5 h-3.5 w-3.5" />
              </a>
            </Button>
          ) : (
            <Button
              type="button"
              disabled
              variant="outline"
              size="sm"
              className="text-xs font-medium opacity-60 cursor-not-allowed whitespace-nowrap shrink-0"
            >
              No Valid Apply URL
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
