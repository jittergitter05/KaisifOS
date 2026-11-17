'use client';
import React, { useState, useEffect } from 'react';
import {
  X,
  Copy,
  Check,
  ArrowUpRight,
  ShieldAlert,
  CheckCircle2,
  Layers,
  RefreshCw,
  BookOpen,
  AlertTriangle,
  Save,
} from 'lucide-react';
import { Button } from './ui/button';
import StatusBadge from './StatusBadge';

import {
  deriveJobPillarBreakdown,
  safeExternalUrl,
  extractExternalHost,
  copyToClipboardSafe,
} from '@/lib/utils';
export { deriveJobPillarBreakdown };

export interface AuditableJob {
  rowId?: number;
  id: string;
  canonicalKey?: string;
  date: string;
  title: string;
  company: string;
  location?: string;
  salary?: string;
  score: number;
  reasons: string;
  gap: string;
  url: string;
  dm: string;
  emailDraft?: string;
  resumeAngle: string;
  status: string;
  source: string;
  evaluationStatus?: 'LLM_SCORED' | 'DETERMINISTIC_ONLY' | 'REJECTED_GATE';
  needsLlmRetry?: boolean;
  sourcesSeen?: Array<{ source: string; url: string; id?: string; seenAt?: string }>;
}

interface PrepPackResult {
  tailored_bullets: string[];
  screening_questions: Array<{ question: string; answer_framework: string }>;
  follow_up_sequence: { day_3_nudge: string; day_7_value_add: string };
  engine_used: string;
}

export default function JobAuditDrawer({
  job,
  onClose,
  onJobUpdated,
}: {
  job: AuditableJob | null;
  onClose: () => void;
  onJobUpdated?: () => void;
}) {
  const [localJob, setLocalJob] = useState<AuditableJob | null>(job);
  const [copiedField, setCopiedField] = useState<'dm' | 'angle' | 'email' | 'nudge' | null>(null);
  const [outreachTab, setOutreachTab] = useState<'dm' | 'email' | 'angle'>('dm');
  const [editableDm, setEditableDm] = useState('');
  const [editableEmail, setEditableEmail] = useState('');
  const [editableAngle, setEditableAngle] = useState('');
  const [savingOutreach, setSavingOutreach] = useState(false);
  const [rescoring, setRescoring] = useState(false);
  const [rescoreNote, setRescoreNote] = useState<string | null>(null);
  const [chainStatus, setChainStatus] = useState<Record<string, string> | null>(null);
  const [skillOverlap, setSkillOverlap] = useState<{ matched: string[]; missing: string[] } | null>(
    null
  );
  const [prepPack, setPrepPack] = useState<PrepPackResult | null>(null);
  const [loadingPrep, setLoadingPrep] = useState(false);
  const [drawerError, setDrawerError] = useState<string | null>(null);

  useEffect(() => {
    setLocalJob(job);
    if (job) {
      setEditableDm(job.dm || '');
      const defaultEmail =
        job.emailDraft ||
        `Subject: ${job.title} @ ${job.company} — Application & Impact Summary\n\nHi ${job.company} Hiring Team,\n\n${job.dm}\n\nPositioning focus for this role: ${job.resumeAngle || 'Direct domain & metric alignment'}\n\nApplication reference: ${job.url}`;
      setEditableEmail(defaultEmail);
      setEditableAngle(job.resumeAngle || '');
    }
    setRescoreNote(null);
    setChainStatus(null);
    setSkillOverlap(null);
    setPrepPack(null);
    setDrawerError(null);
  }, [job]);

  useEffect(() => {
    if (!localJob) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [localJob, onClose]);

  if (!localJob) return null;

  const pillars = deriveJobPillarBreakdown(localJob);
  const externalUrl = safeExternalUrl(localJob.url);
  const applyHost = extractExternalHost(localJob.url);
  const reasonItems = (localJob.reasons || '')
    .split('|')
    .map((r) => r.trim())
    .filter(Boolean);

  const isDeterministicOnly =
    localJob.needsLlmRetry ||
    localJob.evaluationStatus === 'DETERMINISTIC_ONLY' ||
    /Deterministic 4-Pillar Rubric/i.test(localJob.reasons);

  const copyText = async (text: string, key: 'dm' | 'angle' | 'email' | 'nudge') => {
    const ok = await copyToClipboardSafe(text);
    if (ok) {
      setCopiedField(key);
      setTimeout(() => setCopiedField(null), 1800);
    }
  };

  const handleSaveOutreach = async (markDrafted = false) => {
    setSavingOutreach(true);
    setDrawerError(null);
    setRescoreNote(null);
    const nextStatus =
      markDrafted && (localJob.status === 'NEW' || localJob.status === 'SHORTLISTED')
        ? 'OUTREACH_DRAFTED'
        : localJob.status;
    try {
      const res = await fetch('/api/sheet-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: localJob.id,
          canonicalKey: localJob.canonicalKey,
          rowId: localJob.rowId,
          dm: editableDm,
          emailDraft: editableEmail,
          resumeAngle: editableAngle,
          status: nextStatus,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error || `Failed to save outreach (HTTP ${res.status})`);
      }
      setLocalJob({
        ...localJob,
        dm: editableDm,
        emailDraft: editableEmail,
        resumeAngle: editableAngle,
        status: nextStatus,
      });
      setRescoreNote(
        markDrafted && nextStatus === 'OUTREACH_DRAFTED'
          ? 'Outreach saved & stage advanced to Outreach Drafted'
          : 'Outreach drafts saved to ledger'
      );
      if (onJobUpdated) onJobUpdated();
    } catch (e) {
      setDrawerError((e as Error).message || 'Unable to save outreach drafts.');
    } finally {
      setSavingOutreach(false);
    }
  };

  const handleLiveRescore = async () => {
    setRescoring(true);
    setDrawerError(null);
    setRescoreNote(null);
    try {
      const evalRes = await fetch('/api/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: localJob.title,
          company: localJob.company,
          location: localJob.location || 'Hyderabad / Remote',
          salary: localJob.salary || '',
          description: `${localJob.title} at ${localJob.company}. Existing signals: ${localJob.reasons}. Potential risk/gap: ${localJob.gap}`,
        }),
      });
      if (!evalRes.ok) {
        const err = await evalRes.json().catch(() => null);
        throw new Error(err?.error || `Re-score failed (HTTP ${evalRes.status}).`);
      }
      const evalData = await evalRes.json();
      const nextReasons = Array.isArray(evalData.match_reasons)
        ? evalData.match_reasons.join(' | ')
        : localJob.reasons;

      setChainStatus(evalData.fallback_chain_status || null);
      setSkillOverlap({
        matched: Array.isArray(evalData.matched_skills) ? evalData.matched_skills : [],
        missing: Array.isArray(evalData.missing_skills) ? evalData.missing_skills : [],
      });

      const usedLlm = !String(evalData.engine_used || '').toLowerCase().includes('deterministic');
      const updated: AuditableJob = {
        ...localJob,
        score: evalData.score ?? localJob.score,
        reasons: nextReasons,
        gap: evalData.gap ?? localJob.gap,
        dm: evalData.dm_draft ?? localJob.dm,
        resumeAngle: evalData.resume_angle ?? localJob.resumeAngle,
        evaluationStatus: usedLlm ? 'LLM_SCORED' : 'DETERMINISTIC_ONLY',
        needsLlmRetry: !usedLlm,
      };
      setLocalJob(updated);
      setEditableDm(updated.dm);
      setEditableAngle(updated.resumeAngle);

      if (localJob.id || (localJob.rowId && localJob.rowId >= 2)) {
        const syncRes = await fetch('/api/sheet-sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: localJob.id || undefined,
            canonicalKey: localJob.canonicalKey,
            rowId: localJob.rowId,
            score: updated.score,
            reasons: updated.reasons,
            gap: updated.gap,
            dm: updated.dm,
            resumeAngle: updated.resumeAngle,
            evaluationStatus: updated.evaluationStatus,
            needsLlmRetry: updated.needsLlmRetry,
          }),
        });
        if (syncRes.ok) {
          setRescoreNote(`Re-scored & saved via ${evalData.engine_used}`);
          if (onJobUpdated) onJobUpdated();
        } else {
          setRescoreNote(`Preview updated via ${evalData.engine_used} (not persisted)`);
        }
      } else {
        setRescoreNote(`Evaluated via ${evalData.engine_used}`);
      }
    } catch (e) {
      setDrawerError((e as Error).message || 'Unable to re-score role.');
    } finally {
      setRescoring(false);
    }
  };

  const handleGeneratePrep = async () => {
    setLoadingPrep(true);
    setDrawerError(null);
    try {
      const res = await fetch('/api/prep', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: localJob.title,
          company: localJob.company,
          reasons: localJob.reasons,
          gap: localJob.gap,
          description: `${localJob.title} at ${localJob.company}. Lead angle: ${localJob.resumeAngle}`,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error || `Prep generation failed (HTTP ${res.status}).`);
      }
      setPrepPack(await res.json());
    } catch (e) {
      setDrawerError((e as Error).message || 'Unable to build STAR prep pack.');
    } finally {
      setLoadingPrep(false);
    }
  };

  const sourcesList =
    Array.isArray(localJob.sourcesSeen) && localJob.sourcesSeen.length > 0
      ? localJob.sourcesSeen
      : [{ source: localJob.source, url: localJob.url, id: localJob.id }];

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/50 dark:bg-black/60 backdrop-blur-xs"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`4-Pillar Audit for ${localJob.title}`}
    >
      <div
        className="w-full max-w-xl bg-white dark:bg-[#0B0F17] border-l border-slate-200 dark:border-slate-800 h-full overflow-y-auto flex flex-col justify-between shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6 space-y-5">
          {/* Header */}
          <div className="flex items-start justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-xs font-mono text-slate-500 dark:text-slate-400">
                <span>{localJob.source}</span>
                <span aria-hidden="true">·</span>
                <span className="tabular-nums">{localJob.date}</span>
                <span aria-hidden="true">·</span>
                <span
                  className={`px-1.5 py-0.5 rounded text-[10px] border ${
                    isDeterministicOnly
                      ? 'bg-amber-50 text-amber-800 border-amber-300 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800/60'
                      : 'bg-emerald-50 text-emerald-800 border-emerald-300 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800/60'
                  }`}
                >
                  {isDeterministicOnly ? 'Deterministic · Queued for LLM Retry' : 'LLM Verified'}
                </span>
              </div>
              <h2 className="text-lg font-display font-bold text-slate-900 dark:text-white mt-1">
                {localJob.title}
              </h2>
              <div className="text-sm text-slate-600 dark:text-slate-300 mt-0.5 flex flex-wrap items-center gap-2">
                <span>{localJob.company}</span>
                {localJob.location && (
                  <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
                    · {localJob.location}
                  </span>
                )}
              </div>
              {externalUrl !== '#' && (
                <a
                  href={externalUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-mono text-emerald-600 dark:text-emerald-400 hover:underline mt-1 break-all"
                >
                  {externalUrl} <ArrowUpRight className="h-3 w-3 shrink-0" />
                </a>
              )}
              {sourcesList.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 mt-2">
                  <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                    Seen on ({sourcesList.length}):
                  </span>
                  {sourcesList.map((s, idx) => {
                    const sHref = safeExternalUrl(s.url);
                    return sHref !== '#' ? (
                      <a
                        key={`${s.source}-${idx}`}
                        href={sHref}
                        target="_blank"
                        rel="noreferrer"
                        className="px-2 py-0.5 rounded text-[11px] font-mono bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:border-emerald-500 inline-flex items-center gap-1"
                      >
                        {s.source} <ArrowUpRight className="h-2.5 w-2.5" />
                      </a>
                    ) : (
                      <span
                        key={`${s.source}-${idx}`}
                        className="px-2 py-0.5 rounded text-[11px] font-mono bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400"
                      >
                        {s.source}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close audit drawer"
              className="p-1.5 rounded-md border border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {drawerError && (
            <div className="bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/70 text-rose-800 dark:text-rose-200 px-3.5 py-2.5 rounded-md text-xs font-mono flex items-center gap-2">
              <AlertTriangle className="h-3.5 w-3.5 text-rose-600 dark:text-rose-400 shrink-0" />
              <span>{drawerError}</span>
            </div>
          )}

          {rescoreNote && (
            <div className="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/60 text-emerald-700 dark:text-emerald-300 px-3.5 py-2 rounded-md text-xs font-mono">
              {rescoreNote}
            </div>
          )}

          {/* Score Banner */}
          <div className="bg-slate-50 dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  Composite 4-Pillar Rubric Score
                </div>
                <div className="flex items-baseline gap-2 mt-1">
                  <span className="text-3xl font-mono font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">
                    {localJob.score}
                  </span>
                  <span className="text-xs font-mono text-slate-500 tabular-nums">/ 100</span>
                </div>
              </div>
              <div className="flex items-center gap-2.5 flex-wrap justify-end">
                <StatusBadge status={localJob.status} />
                {externalUrl !== '#' ? (
                  <Button
                    asChild
                    size="sm"
                    className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs h-8 px-3 whitespace-nowrap shrink-0"
                  >
                    <a href={externalUrl} target="_blank" rel="noreferrer">
                      Apply ({applyHost || 'Direct'}) <ArrowUpRight className="h-3.5 w-3.5 ml-1" />
                    </a>
                  </Button>
                ) : (
                  <Button
                    type="button"
                    disabled
                    size="sm"
                    variant="outline"
                    className="text-xs h-8 px-3 opacity-60 cursor-not-allowed whitespace-nowrap shrink-0"
                  >
                    No Apply URL
                  </Button>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-2.5 border-t border-slate-200 dark:border-slate-800">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleLiveRescore}
                disabled={rescoring}
                className="bg-white dark:bg-[#0B0F17] border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200 text-xs h-8 px-3 whitespace-nowrap shrink-0"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 mr-1.5 text-emerald-600 dark:text-emerald-400 ${
                    rescoring ? 'animate-spin' : ''
                  }`}
                />
                {rescoring ? 'Re-Scoring...' : 'Re-Score with Live AI'}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleGeneratePrep}
                disabled={loadingPrep}
                className="bg-white dark:bg-[#0B0F17] border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200 text-xs h-8 px-3 whitespace-nowrap shrink-0"
              >
                <BookOpen className="h-3.5 w-3.5 mr-1.5 text-blue-600 dark:text-blue-400" />
                {loadingPrep ? 'Drafting Prep...' : 'STAR Prep Pack'}
              </Button>
            </div>
          </div>

          {chainStatus && (
            <div className="bg-slate-50 dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-lg px-4 py-2.5 text-[11px] font-mono text-slate-600 dark:text-slate-400 flex flex-wrap gap-x-4 gap-y-1">
              <span>
                Gemini:{' '}
                <strong className="text-slate-900 dark:text-slate-200">{chainStatus.gemini}</strong>
              </span>
              <span>
                Groq:{' '}
                <strong className="text-slate-900 dark:text-slate-200">{chainStatus.groq}</strong>
              </span>
              <span>
                OpenRouter:{' '}
                <strong className="text-slate-900 dark:text-slate-200">
                  {chainStatus.openrouter}
                </strong>
              </span>
              <span>
                Rubric:{' '}
                <strong className="text-emerald-600 dark:text-emerald-400">
                  {chainStatus.deterministic}
                </strong>
              </span>
            </div>
          )}

          {/* 4-Pillar Breakdown Bars */}
          <div className="bg-slate-50 dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-lg p-4 space-y-3.5">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-2.5 gap-2">
              <div className="flex items-center gap-2 text-xs font-medium text-slate-900 dark:text-white">
                <Layers className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                <span>4-Pillar Subscore Decomposition</span>
              </div>
              <span
                className="text-[11px] font-mono text-slate-500 dark:text-slate-400 tabular-nums"
                title={
                  pillars.isExact
                    ? 'Parsed directly from logged pillar markers'
                    : 'Estimated proportionally from total score'
                }
              >
                {pillars.isExact ? 'Exact Log' : 'Est. Split'} · 40+30+15+15
              </span>
            </div>

            {[pillars.role, pillars.skill, pillars.seniority, pillars.compGeo].map((p) => {
              const pct = Math.round((p.earned / p.max) * 100);
              return (
                <div key={p.label} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-700 dark:text-slate-300">{p.label}</span>
                    <span className="font-mono tabular-nums text-slate-900 dark:text-white font-semibold">
                      {p.earned} / {p.max} pts{' '}
                      <span className="text-slate-500 font-normal">({pct}%)</span>
                    </span>
                  </div>
                  <div className="w-full h-1.5 bg-slate-200 dark:bg-slate-800 rounded-xs overflow-hidden">
                    <div
                      style={{ width: `${pct}%` }}
                      className={`h-full ${
                        pct >= 85
                          ? 'bg-emerald-500'
                          : pct >= 70
                          ? 'bg-blue-500'
                          : 'bg-amber-500'
                      }`}
                    />
                  </div>
                </div>
              );
            })}

            {skillOverlap && (skillOverlap.matched.length > 0 || skillOverlap.missing.length > 0) && (
              <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-1.5 text-[11px] font-mono">
                {skillOverlap.matched.length > 0 && (
                  <div className="text-emerald-600 dark:text-emerald-400">
                    Matched:{' '}
                    <span className="text-slate-800 dark:text-slate-200">
                      {skillOverlap.matched.join(' · ')}
                    </span>
                  </div>
                )}
                {skillOverlap.missing.length > 0 && (
                  <div className="text-amber-600 dark:text-amber-400">
                    To Emphasize:{' '}
                    <span className="text-slate-700 dark:text-slate-300">
                      {skillOverlap.missing.join(' · ')}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>

          {prepPack && (
            <div className="bg-slate-50 dark:bg-[#111827] border border-blue-200 dark:border-blue-800/50 rounded-lg p-4 space-y-3 text-xs">
              <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-2">
                <span className="font-medium text-blue-600 dark:text-blue-400 inline-flex items-center gap-1.5">
                  <BookOpen className="h-3.5 w-3.5" /> Role STAR Prep Pack ({prepPack.engine_used})
                </span>
                <button
                  type="button"
                  onClick={() => copyText(prepPack.follow_up_sequence.day_3_nudge, 'nudge')}
                  className="text-[11px] font-mono text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white inline-flex items-center gap-1 cursor-pointer"
                >
                  {copiedField === 'nudge' ? (
                    <>
                      <Check className="h-3 w-3 text-emerald-600 dark:text-emerald-400" /> Nudge
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3" /> Copy Day-3 Nudge
                    </>
                  )}
                </button>
              </div>
              <ul className="space-y-1.5 text-slate-700 dark:text-slate-200 leading-relaxed">
                {prepPack.tailored_bullets.map((b, idx) => (
                  <li key={idx}>• {b}</li>
                ))}
              </ul>
              <div className="divide-y divide-slate-200 dark:divide-slate-800 pt-2 border-t border-slate-200 dark:border-slate-800">
                {prepPack.screening_questions.map((q, idx) => (
                  <div key={idx} className="py-2 first:pt-0 last:pb-0">
                    <div className="font-medium text-slate-900 dark:text-white">
                      Q{idx + 1}: {q.question}
                    </div>
                    <div className="text-slate-600 dark:text-slate-300 mt-1">
                      {q.answer_framework}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Match Signals & Risk Gap */}
          <div className="space-y-4">
            <div className="bg-slate-50 dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-lg p-4">
              <div className="flex items-center gap-2 text-xs font-medium text-emerald-600 dark:text-emerald-400 mb-2">
                <CheckCircle2 className="h-3.5 w-3.5" />
                <span>Verified Rubric Match Signals</span>
              </div>
              <ul className="space-y-1.5 text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                {reasonItems.map((r, i) => (
                  <li key={i} className="flex items-baseline gap-2">
                    <span className="font-mono text-slate-400 dark:text-slate-500 tabular-nums">
                      0{i + 1}.
                    </span>
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="bg-slate-50 dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-lg p-4">
              <div className="flex items-center gap-2 text-xs font-medium text-amber-600 dark:text-amber-400 mb-1.5">
                <ShieldAlert className="h-3.5 w-3.5" />
                <span>Identified Risk & Interview Mitigation</span>
              </div>
              <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                {localJob.gap || 'No hard blockers identified; lead with quantified execution proof.'}
              </p>
            </div>
          </div>

          {/* Interactive Outreach Composer */}
          <div className="bg-slate-50 dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2 border-b border-slate-200 dark:border-slate-800 pb-2.5">
              <div className="flex items-center gap-1">
                {[
                  { id: 'dm' as const, label: 'LinkedIn DM' },
                  { id: 'email' as const, label: 'Cold Email' },
                  { id: 'angle' as const, label: 'Resume Lead Angle' },
                ].map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setOutreachTab(t.id)}
                    className={`px-2.5 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      outreachTab === t.id
                        ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white border border-slate-200 dark:border-slate-700'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() =>
                  copyText(
                    outreachTab === 'dm'
                      ? editableDm
                      : outreachTab === 'email'
                      ? editableEmail
                      : editableAngle,
                    outreachTab
                  )
                }
                className="px-2.5 py-1 rounded text-[11px] font-mono bg-slate-200/80 dark:bg-slate-800 hover:bg-slate-300/80 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 inline-flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0"
              >
                {copiedField === outreachTab ? (
                  <>
                    <Check className="h-3 w-3 text-emerald-600 dark:text-emerald-400" /> Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3" /> CopyActive Draft
                  </>
                )}
              </button>
            </div>

            {outreachTab === 'dm' && (
              <textarea
                rows={4}
                value={editableDm}
                onChange={(e) => setEditableDm(e.target.value)}
                aria-label="LinkedIn DM Draft"
                className="w-full bg-white dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded-md p-2.5 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:border-emerald-500 leading-relaxed"
              />
            )}
            {outreachTab === 'email' && (
              <textarea
                rows={6}
                value={editableEmail}
                onChange={(e) => setEditableEmail(e.target.value)}
                aria-label="Cold Email Draft"
                className="w-full bg-white dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded-md p-2.5 text-xs font-mono text-slate-800 dark:text-slate-200 focus:outline-none focus:border-emerald-500 leading-relaxed"
              />
            )}
            {outreachTab === 'angle' && (
              <textarea
                rows={3}
                value={editableAngle}
                onChange={(e) => setEditableAngle(e.target.value)}
                aria-label="Resume Lead Angle"
                className="w-full bg-white dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded-md p-2.5 text-xs font-mono text-slate-800 dark:text-slate-200 focus:outline-none focus:border-emerald-500 leading-relaxed"
              />
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                Edit &amp; persist tailored outreach directly to your pipeline record
              </span>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={savingOutreach}
                  onClick={() => handleSaveOutreach(false)}
                  className="bg-white dark:bg-[#0B0F17] border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 text-xs h-7 px-2.5 whitespace-nowrap shrink-0"
                >
                  <Save className="h-3 w-3 mr-1" />
                  {savingOutreach ? 'Saving...' : 'Save Draft'}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={savingOutreach}
                  onClick={() => handleSaveOutreach(true)}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs h-7 px-2.5 whitespace-nowrap shrink-0"
                >
                  Save &amp; Mark Outreach Drafted
                </Button>
              </div>
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0D131F] flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
          <span className="font-mono">Rubric v3.2 · 4-Tier Free Multi-LLM Chain</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onClose}
            className="bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 text-xs h-8"
          >
            Close Inspector
          </Button>
        </div>
      </div>
    </div>
  );
}
