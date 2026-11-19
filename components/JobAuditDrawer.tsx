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
  Users,
  Sparkles,
  Download,
  FileText,
  Clock,
  MailCheck,
  Send,
} from 'lucide-react';
import { Button } from './ui/button';
import StatusBadge from './StatusBadge';
import {
  buildPeopleSearchLinks,
  computeJobFreshnessAndCadence,
  generateFollowUpDraft,
} from '@/lib/outreach-engine';
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
  appliedAt?: string | null;
  lastFollowUpAt?: string | null;
  followUpCount?: number;
  lastReplySummary?: string;
  lastReplyClassification?: string;
}

interface PrepPackResult {
  tailored_bullets: string[];
  screening_questions: Array<{ question: string; answer_framework: string }>;
  follow_up_sequence: { day_3_nudge: string; day_7_value_add: string };
  engine_used: string;
}

interface TailorPackPayload {
  tailored_summary: string;
  tailored_bullets: Array<{
    bullet: string;
    grounded_proof: string;
    jd_alignment: string;
  }>;
  ats_keywords_matched: string[];
  ats_keywords_to_prep: string[];
  cover_note_subject: string;
  cover_note_body: string;
  followup_bump_1: string;
  followup_bump_2: string;
  engine_used: string;
}

function escapeHtml(raw: string): string {
  return String(raw || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildTailorMarkdownClient(pack: TailorPackPayload, job: AuditableJob): string {
  const lines = [
    `# ATS Tailor Brief — ${job.title} @ ${job.company}`,
    job.location ? `**Location:** ${job.location}` : '',
    job.url ? `**Apply URL:** ${job.url}` : '',
    `**Engine:** ${pack.engine_used}`,
    '',
    '## Tailored ATS Summary',
    pack.tailored_summary,
    '',
    '## Grounded STAR Resume Bullets (Zero-Fabrication)',
    ...pack.tailored_bullets.map(
      (b, idx) =>
        `${idx + 1}. ${b.bullet}\n   - *Grounded Proof:* ${b.grounded_proof}\n   - *JD Alignment:* ${b.jd_alignment}`
    ),
    '',
    '## ATS Keywords Matched',
    pack.ats_keywords_matched.join(' · '),
    '',
    ...(pack.ats_keywords_to_prep.length > 0
      ? ['## Keywords to Address Honestly in Interview', pack.ats_keywords_to_prep.join(' · '), '']
      : []),
    '## Concise Hiring Manager Cover Note',
    `**Subject:** ${pack.cover_note_subject}`,
    '',
    pack.cover_note_body,
    '',
    '## Follow-Up Cadence',
    `- **Day 5 Bump #1:** ${pack.followup_bump_1}`,
    `- **Day 11 Bump #2:** ${pack.followup_bump_2}`,
  ];
  return lines.filter((l) => l !== undefined).join('\n');
}

function buildTailorPrintableHtml(pack: TailorPackPayload, job: AuditableJob): string {
  const bulletsHtml = pack.tailored_bullets
    .map(
      (b) => `<li>
        <div class="bullet-text">${escapeHtml(b.bullet)}</div>
        <div class="meta"><strong>Grounded Proof:</strong> ${escapeHtml(b.grounded_proof)} &middot; <strong>JD Alignment:</strong> ${escapeHtml(b.jd_alignment)}</div>
      </li>`
    )
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>ATS Tailor Brief — ${escapeHtml(job.title)} @ ${escapeHtml(job.company)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #0f172a; max-width: 780px; margin: 32px auto; padding: 0 24px; line-height: 1.55; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .sub { font-size: 12px; color: #475569; margin-bottom: 20px; font-family: ui-monospace, monospace; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.06em; color: #047857; border-bottom: 1px solid #cbd5e1; padding-bottom: 4px; margin-top: 22px; }
  ul { padding-left: 18px; }
  li { margin-bottom: 12px; }
  .bullet-text { font-size: 14px; font-weight: 500; }
  .meta { font-size: 11px; color: #475569; margin-top: 3px; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
  .chip { font-size: 11px; padding: 2px 8px; border-radius: 4px; background: #ecfdf5; color: #065f46; border: 1px solid #a7f3d0; }
  .chip.prep { background: #fffbeb; color: #92400e; border-color: #fde68a; }
  pre { white-space: pre-wrap; font-family: inherit; background: #f8fafc; padding: 12px; border-radius: 6px; border: 1px solid #e2e8f0; font-size: 13px; }
  @media print { body { margin: 12px; } }
</style>
</head>
<body>
  <h1>${escapeHtml(job.title)} &mdash; ${escapeHtml(job.company)}</h1>
  <div class="sub">${escapeHtml(job.location || 'India / Remote')} &middot; Score ${job.score}/100 &middot; ${escapeHtml(pack.engine_used)}</div>
  <h2>Tailored ATS Summary</h2>
  <p>${escapeHtml(pack.tailored_summary)}</p>
  <h2>Grounded STAR Resume Bullets</h2>
  <ul>${bulletsHtml}</ul>
  <h2>ATS Keywords Matched</h2>
  <div class="chips">${pack.ats_keywords_matched.map((k) => `<span class="chip">${escapeHtml(k)}</span>`).join('')}</div>
  ${
    pack.ats_keywords_to_prep.length > 0
      ? `<h2>Keywords to Prep Honestly</h2><div class="chips">${pack.ats_keywords_to_prep
          .map((k) => `<span class="chip prep">${escapeHtml(k)}</span>`)
          .join('')}</div>`
      : ''
  }
  <h2>Cover Note</h2>
  <p><strong>Subject:</strong> ${escapeHtml(pack.cover_note_subject)}</p>
  <pre>${escapeHtml(pack.cover_note_body)}</pre>
  <h2>Follow-Up Cadence</h2>
  <p><strong>Day 5 Bump #1:</strong> ${escapeHtml(pack.followup_bump_1)}</p>
  <p><strong>Day 11 Bump #2:</strong> ${escapeHtml(pack.followup_bump_2)}</p>
</body>
</html>`;
}

function triggerBlobDownload(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1200);
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
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [outreachTab, setOutreachTab] = useState<'dm' | 'email' | 'angle'>('dm');
  const [editableDm, setEditableDm] = useState('');
  const [editableEmail, setEditableEmail] = useState('');
  const [editableAngle, setEditableAngle] = useState('');
  const [savingOutreach, setSavingOutreach] = useState(false);
  const [markingFollowUp, setMarkingFollowUp] = useState(false);
  const [rescoring, setRescoring] = useState(false);
  const [rescoreNote, setRescoreNote] = useState<string | null>(null);
  const [chainStatus, setChainStatus] = useState<Record<string, string> | null>(null);
  const [skillOverlap, setSkillOverlap] = useState<{ matched: string[]; missing: string[] } | null>(
    null
  );
  const [prepPack, setPrepPack] = useState<PrepPackResult | null>(null);
  const [loadingPrep, setLoadingPrep] = useState(false);
  const [tailorPack, setTailorPack] = useState<TailorPackPayload | null>(null);
  const [loadingTailor, setLoadingTailor] = useState(false);
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
    setTailorPack(null);
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
  const peopleLinks = buildPeopleSearchLinks({
    title: localJob.title,
    company: localJob.company,
    location: localJob.location,
  });
  const cadence = computeJobFreshnessAndCadence({
    date: localJob.date,
    status: localJob.status,
    appliedAt: localJob.appliedAt,
    lastFollowUpAt: localJob.lastFollowUpAt,
    followUpCount: localJob.followUpCount,
  });
  const nextBumpNumber: 1 | 2 = (localJob.followUpCount || 0) >= 1 ? 2 : 1;
  const followUpDraft = generateFollowUpDraft(
    {
      title: localJob.title,
      company: localJob.company,
      resumeAngle: localJob.resumeAngle,
    },
    {},
    nextBumpNumber
  );

  const reasonItems = (localJob.reasons || '')
    .split('|')
    .map((r) => r.trim())
    .filter(Boolean);

  const isDeterministicOnly =
    localJob.needsLlmRetry ||
    localJob.evaluationStatus === 'DETERMINISTIC_ONLY' ||
    /Deterministic 4-Pillar Rubric/i.test(localJob.reasons);

  const copyText = async (text: string, key: string) => {
    const ok = await copyToClipboardSafe(text);
    if (ok) {
      setCopiedField(key);
      setTimeout(() => setCopiedField(null), 1800);
    }
  };

  const handleMarkFollowUpSent = async () => {
    setMarkingFollowUp(true);
    setDrawerError(null);
    setRescoreNote(null);
    try {
      const res = await fetch('/api/sheet-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: localJob.id,
          canonicalKey: localJob.canonicalKey,
          rowId: localJob.rowId,
          markFollowUpSent: true,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error || `Failed to log follow-up (HTTP ${res.status})`);
      }
      const nextCount = (Number(localJob.followUpCount) || 0) + 1;
      setLocalJob({
        ...localJob,
        followUpCount: nextCount,
        lastFollowUpAt: new Date().toISOString(),
      });
      setRescoreNote(`Follow-up Bump #${nextCount} logged to pipeline ledger.`);
      if (onJobUpdated) onJobUpdated();
    } catch (e) {
      setDrawerError((e as Error).message || 'Unable to log follow-up bump.');
    } finally {
      setMarkingFollowUp(false);
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

  const handleGenerateTailor = async () => {
    setLoadingTailor(true);
    setDrawerError(null);
    try {
      const res = await fetch('/api/tailor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: localJob.title,
          company: localJob.company,
          location: localJob.location || '',
          reasons: localJob.reasons,
          gap: localJob.gap,
          resumeAngle: localJob.resumeAngle,
          description: `${localJob.title} at ${localJob.company}. Lead angle: ${localJob.resumeAngle}. Signals: ${localJob.reasons}`,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error || `ATS Tailor failed (HTTP ${res.status}).`);
      }
      setTailorPack(await res.json());
    } catch (e) {
      setDrawerError((e as Error).message || 'Unable to generate grounded ATS Tailor Brief.');
    } finally {
      setLoadingTailor(false);
    }
  };

  const sourcesList =
    Array.isArray(localJob.sourcesSeen) && localJob.sourcesSeen.length > 0
      ? localJob.sourcesSeen
      : [{ source: localJob.source, url: localJob.url, id: localJob.id }];

  const slugName = `${localJob.company}-${localJob.title}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);

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
                  rel="noopener noreferrer"
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
                        rel="noopener noreferrer"
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

          {/* Last Recruiter Reply Intelligence Banner */}
          {localJob.lastReplySummary && (
            <div
              className={`rounded-lg px-4 py-3 text-xs border space-y-1 ${
                localJob.lastReplyClassification === 'INTERVIEW_INVITE'
                  ? 'bg-emerald-50 dark:bg-emerald-950/35 border-emerald-200 dark:border-emerald-800/70 text-emerald-900 dark:text-emerald-200'
                  : localJob.lastReplyClassification === 'REJECTION'
                  ? 'bg-rose-50 dark:bg-rose-950/35 border-rose-200 dark:border-rose-800/70 text-rose-900 dark:text-rose-200'
                  : 'bg-blue-50 dark:bg-blue-950/35 border-blue-200 dark:border-blue-800/70 text-blue-900 dark:text-blue-200'
              }`}
            >
              <div className="font-mono font-semibold inline-flex items-center gap-1.5">
                <MailCheck className="h-3.5 w-3.5" />
                Reply Intelligence ·{' '}
                {(localJob.lastReplyClassification || 'RECRUITER_REPLY').replace(/_/g, ' ')}
              </div>
              <p className="leading-relaxed">{localJob.lastReplySummary}</p>
            </div>
          )}

          {/* Score Banner & Primary Intelligence Actions */}
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
                    <a href={externalUrl} target="_blank" rel="noopener noreferrer">
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
                onClick={handleGenerateTailor}
                disabled={loadingTailor}
                className="bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 text-emerald-800 dark:text-emerald-300 text-xs h-8 px-3 whitespace-nowrap shrink-0"
              >
                <Sparkles
                  className={`h-3.5 w-3.5 mr-1.5 ${loadingTailor ? 'animate-spin' : ''}`}
                />
                {loadingTailor ? 'Tailoring ATS Brief...' : 'ATS Tailor Studio'}
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

          {/* 1-Click LinkedIn Boolean People Finder */}
          <div className="bg-slate-50 dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-lg p-4 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-900 dark:text-white inline-flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                1-Click Hiring Manager &amp; Warm Referral Finder
              </span>
              <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                LinkedIn Boolean
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {peopleLinks.map((link) => (
                <a
                  key={link.role}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="bg-white dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 hover:border-emerald-500 rounded-md p-2.5 transition-colors group"
                >
                  <div className="flex items-center justify-between gap-1 text-xs font-medium text-slate-900 dark:text-white group-hover:text-emerald-600 dark:group-hover:text-emerald-400">
                    <span className="truncate">{link.label}</span>
                    <ArrowUpRight className="h-3.5 w-3.5 shrink-0" />
                  </div>
                  <div className="text-[10px] font-mono text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                    {link.personaHint}
                  </div>
                </a>
              ))}
            </div>
          </div>

          {/* Follow-Up Cadence Bar for APPLIED / OUTREACH_DRAFTED */}
          {(localJob.status === 'APPLIED' || localJob.status === 'OUTREACH_DRAFTED') && (
            <div className="bg-blue-50/70 dark:bg-blue-950/25 border border-blue-200 dark:border-blue-800/60 rounded-lg p-4 space-y-2.5 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-blue-900 dark:text-blue-200 inline-flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                  Follow-Up Cadence · {cadence.daysSinceApplied ?? 0}d since applied ·{' '}
                  {cadence.followUpCount} bump(s) sent
                </span>
                <span className="text-[11px] font-mono text-blue-700 dark:text-blue-300">
                  {cadence.nextActionLabel}
                </span>
              </div>
              <p className="text-xs text-slate-700 dark:text-slate-300 bg-white dark:bg-[#0B0F17] border border-blue-200/70 dark:border-blue-900/60 rounded p-2.5 leading-relaxed">
                {followUpDraft.dm}
              </p>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => copyText(followUpDraft.dm, 'cadence_bump')}
                  className="bg-white dark:bg-[#0B0F17] border-blue-300 dark:border-blue-800 text-slate-800 dark:text-slate-200 text-xs h-7 px-2.5"
                >
                  {copiedField === 'cadence_bump' ? (
                    <>
                      <Check className="h-3 w-3 mr-1 text-emerald-600 dark:text-emerald-400" />{' '}
                      Bump #{nextBumpNumber} Copied
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3 mr-1" /> Copy Bump #{nextBumpNumber} Draft
                    </>
                  )}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={markingFollowUp}
                  onClick={handleMarkFollowUpSent}
                  className="bg-blue-600 hover:bg-blue-500 text-white text-xs h-7 px-2.5"
                >
                  <Send className="h-3 w-3 mr-1" />
                  {markingFollowUp ? 'Logging...' : 'Mark Follow-Up Sent'}
                </Button>
              </div>
            </div>
          )}

          {/* Grounded ATS Tailor Studio Panel */}
          {tailorPack && (
            <div className="bg-slate-50 dark:bg-[#111827] border border-emerald-300 dark:border-emerald-800/70 rounded-lg p-4 space-y-4 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-800 pb-2.5">
                <div>
                  <div className="font-semibold text-emerald-700 dark:text-emerald-400 inline-flex items-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5" /> Grounded ATS Tailor Studio
                  </div>
                  <div className="text-[10px] font-mono text-slate-500 dark:text-slate-400 mt-0.5">
                    Zero-Fabrication Proof Mapping · {tailorPack.engine_used}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      copyText(buildTailorMarkdownClient(tailorPack, localJob), 'tailor_all')
                    }
                    className="px-2 py-1 rounded text-[11px] font-mono bg-white dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-700 hover:border-emerald-500 text-slate-700 dark:text-slate-200 inline-flex items-center gap-1 cursor-pointer"
                  >
                    {copiedField === 'tailor_all' ? (
                      <>
                        <Check className="h-3 w-3 text-emerald-600" /> Copied
                      </>
                    ) : (
                      <>
                        <Copy className="h-3 w-3" /> Copy All
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      triggerBlobDownload(
                        buildTailorMarkdownClient(tailorPack, localJob),
                        `ats-tailor-${slugName}.md`,
                        'text/markdown;charset=utf-8;'
                      )
                    }
                    className="px-2 py-1 rounded text-[11px] font-mono bg-white dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-700 hover:border-emerald-500 text-slate-700 dark:text-slate-200 inline-flex items-center gap-1 cursor-pointer"
                  >
                    <Download className="h-3 w-3" /> .md
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      triggerBlobDownload(
                        buildTailorPrintableHtml(tailorPack, localJob),
                        `ats-tailor-${slugName}.html`,
                        'text/html;charset=utf-8;'
                      )
                    }
                    className="px-2 py-1 rounded text-[11px] font-mono bg-emerald-600 hover:bg-emerald-500 text-white inline-flex items-center gap-1 cursor-pointer"
                  >
                    <FileText className="h-3 w-3" /> Print HTML
                  </button>
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-slate-900 dark:text-white">
                    Tailored ATS Summary
                  </span>
                  <button
                    type="button"
                    onClick={() => copyText(tailorPack.tailored_summary, 'tailor_summary')}
                    className="text-[11px] font-mono text-emerald-600 dark:text-emerald-400 hover:underline cursor-pointer"
                  >
                    {copiedField === 'tailor_summary' ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <p className="text-slate-700 dark:text-slate-300 bg-white dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded p-2.5 leading-relaxed">
                  {tailorPack.tailored_summary}
                </p>
              </div>

              <div className="space-y-2">
                <div className="font-medium text-slate-900 dark:text-white">
                  Grounded STAR Resume Bullets
                </div>
                {tailorPack.tailored_bullets.map((item, idx) => (
                  <div
                    key={idx}
                    className="bg-white dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded p-2.5 space-y-1.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-slate-800 dark:text-slate-200 leading-relaxed">
                        • {item.bullet}
                      </p>
                      <button
                        type="button"
                        onClick={() => copyText(item.bullet, `tb_${idx}`)}
                        className="text-[10px] font-mono text-slate-500 hover:text-emerald-600 dark:hover:text-emerald-400 shrink-0 cursor-pointer"
                      >
                        {copiedField === `tb_${idx}` ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-mono">
                      <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800/60">
                        Proof: {item.grounded_proof}
                      </span>
                      <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700">
                        JD: {item.jd_alignment}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <div className="text-[11px] font-mono text-emerald-700 dark:text-emerald-400 mb-1.5">
                    ATS Keywords Matched
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {tailorPack.ats_keywords_matched.map((kw) => (
                      <span
                        key={kw}
                        className="px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-50 text-emerald-800 border border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800/60"
                      >
                        {kw}
                      </span>
                    ))}
                  </div>
                </div>
                {tailorPack.ats_keywords_to_prep.length > 0 && (
                  <div>
                    <div className="text-[11px] font-mono text-amber-700 dark:text-amber-400 mb-1.5">
                      Prep Honestly (Not in Profile)
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {tailorPack.ats_keywords_to_prep.map((kw) => (
                        <span
                          key={kw}
                          className="px-2 py-0.5 rounded text-[10px] font-mono bg-amber-50 text-amber-800 border border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800/60"
                        >
                          {kw}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-1.5 border-t border-slate-200 dark:border-slate-800 pt-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-slate-900 dark:text-white">
                    Cover Note ·{' '}
                    <span className="font-mono text-[11px] text-slate-500">
                      {tailorPack.cover_note_subject}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      copyText(
                        `Subject: ${tailorPack.cover_note_subject}\n\n${tailorPack.cover_note_body}`,
                        'tailor_cover'
                      )
                    }
                    className="text-[11px] font-mono text-emerald-600 dark:text-emerald-400 hover:underline shrink-0 cursor-pointer"
                  >
                    {copiedField === 'tailor_cover' ? 'Copied' : 'Copy Cover Note'}
                  </button>
                </div>
                <pre className="whitespace-pre-wrap font-sans text-xs text-slate-700 dark:text-slate-300 bg-white dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded p-2.5 leading-relaxed">
                  {tailorPack.cover_note_body}
                </pre>
              </div>
            </div>
          )}

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
                <span>Identified Risk &amp; Interview Mitigation</span>
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
                    <Copy className="h-3 w-3" /> Copy Active Draft
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
