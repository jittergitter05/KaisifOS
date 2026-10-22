'use client';
import React, { useState } from 'react';
import { X, Copy, Check, ArrowUpRight, ShieldAlert, CheckCircle2, Layers } from 'lucide-react';
import { Button } from './ui/button';
import StatusBadge from './StatusBadge';

export interface AuditableJob {
  rowId?: number;
  id: string;
  date: string;
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

export function deriveJobPillarBreakdown(job: AuditableJob) {
  const s = Math.min(100, Math.max(20, job.score || 85));
  const reasonsText = job.reasons || '';

  // Parse explicit pillar scores if present in reasons string, otherwise compute deterministically
  const roleExplicit = reasonsText.match(/(\d{1,2})\/40/);
  const skillExplicit = reasonsText.match(/(\d{1,2})\/30/);
  const senExplicit = reasonsText.match(/(\d{1,2})\/15\s*Seniority/i);
  const compExplicit = reasonsText.match(/(\d{1,2})\/15\s*Comp/i);

  const role = roleExplicit ? parseInt(roleExplicit[1], 10) : Math.min(40, Math.round(s * 0.39));
  const skill = skillExplicit ? parseInt(skillExplicit[1], 10) : Math.min(30, Math.round(s * 0.29));
  const seniority = senExplicit
    ? parseInt(senExplicit[1], 10)
    : Math.min(15, Math.round(s * 0.16));
  const compGeo = compExplicit
    ? parseInt(compExplicit[1], 10)
    : Math.min(15, Math.max(8, s - role - skill - seniority));

  return {
    role: { earned: role, max: 40, label: 'Role & Charter Affinity' },
    skill: { earned: skill, max: 30, label: 'Skill & Quantified Proof Overlap' },
    seniority: { earned: seniority, max: 15, label: 'Seniority & Tenure Calibration' },
    compGeo: { earned: compGeo, max: 15, label: 'Compensation Floor & Geo/Relo Fit' },
  };
}

export default function JobAuditDrawer({
  job,
  onClose,
}: {
  job: AuditableJob | null;
  onClose: () => void;
}) {
  const [copiedField, setCopiedField] = useState<'dm' | 'angle' | 'email' | null>(null);

  if (!job) return null;

  const pillars = deriveJobPillarBreakdown(job);
  const reasonItems = (job.reasons || '')
    .split('|')
    .map((r) => r.trim())
    .filter(Boolean);

  const synthesizedEmail = `Subject: ${job.title} @ ${job.company} — Quantified GTM & Product Execution\n\nHi ${job.company} Hiring Team,\n\n${job.dm}\n\nPositioning focus for this role: ${job.resumeAngle || 'Direct domain & metric alignment'}\n\nApplication reference: ${job.url}`;

  const copyText = (text: string, key: 'dm' | 'angle' | 'email') => {
    navigator.clipboard.writeText(text);
    setCopiedField(key);
    setTimeout(() => setCopiedField(null), 1800);
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-xs">
      <div
        className="w-full max-w-xl bg-[#0B0F17] border-l border-slate-800 h-full overflow-y-auto flex flex-col justify-between shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6 space-y-6">
          {/* Header */}
          <div className="flex items-start justify-between gap-4 border-b border-slate-800 pb-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs font-mono text-slate-400">
                <span>{job.source}</span>
                <span aria-hidden="true">·</span>
                <span className="tabular-nums">{job.date}</span>
                <span aria-hidden="true">·</span>
                <span className="truncate">{job.id}</span>
              </div>
              <h2 className="text-lg font-display font-bold text-white mt-1">
                {job.title}
              </h2>
              <div className="text-sm text-slate-300 mt-0.5">{job.company}</div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close audit drawer"
              className="p-1.5 rounded-md border border-slate-800 text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Score Banner */}
          <div className="bg-[#111827] border border-slate-800 rounded-lg p-4 flex items-center justify-between gap-4">
            <div>
              <div className="text-[11px] font-mono text-slate-400 uppercase tracking-wider">
                Composite 4-Pillar Rubric Score
              </div>
              <div className="flex items-baseline gap-2 mt-1">
                <span className="text-3xl font-mono font-bold text-emerald-400 tabular-nums">
                  {job.score}
                </span>
                <span className="text-xs font-mono text-slate-500 tabular-nums">/ 100</span>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <StatusBadge status={job.status} />
              <Button
                asChild
                size="sm"
                className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs h-8 px-3"
              >
                <a href={job.url} target="_blank" rel="noreferrer">
                  Apply <ArrowUpRight className="h-3.5 w-3.5 ml-1" />
                </a>
              </Button>
            </div>
          </div>

          {/* 4-Pillar Breakdown Bars */}
          <div className="bg-[#111827] border border-slate-800 rounded-lg p-4 space-y-3.5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
              <div className="flex items-center gap-2 text-xs font-medium text-white">
                <Layers className="h-3.5 w-3.5 text-emerald-400" />
                <span>4-Pillar Subscore Decomposition</span>
              </div>
              <span className="text-[11px] font-mono text-slate-400 tabular-nums">
                40 + 30 + 15 + 15 = 100 pts
              </span>
            </div>

            {Object.values(pillars).map((p) => {
              const pct = Math.round((p.earned / p.max) * 100);
              return (
                <div key={p.label} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-300">{p.label}</span>
                    <span className="font-mono tabular-nums text-white font-semibold">
                      {p.earned} / {p.max} pts{' '}
                      <span className="text-slate-500 font-normal">({pct}%)</span>
                    </span>
                  </div>
                  <div className="w-full h-1.5 bg-slate-800 rounded-xs overflow-hidden">
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
          </div>

          {/* Match Signals & Risk Gap */}
          <div className="space-y-4">
            <div className="bg-[#111827] border border-slate-800 rounded-lg p-4">
              <div className="flex items-center gap-2 text-xs font-medium text-emerald-400 mb-2">
                <CheckCircle2 className="h-3.5 w-3.5" />
                <span>Verified Rubric Match Signals</span>
              </div>
              <ul className="space-y-1.5 text-xs text-slate-300 leading-relaxed">
                {reasonItems.map((r, i) => (
                  <li key={i} className="flex items-baseline gap-2">
                    <span className="font-mono text-slate-500 tabular-nums">0{i + 1}.</span>
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="bg-[#111827] border border-slate-800 rounded-lg p-4">
              <div className="flex items-center gap-2 text-xs font-medium text-amber-400 mb-1.5">
                <ShieldAlert className="h-3.5 w-3.5" />
                <span>Identified Risk & Interview Mitigation</span>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                {job.gap || 'No hard blockers identified; lead with quantified execution proof.'}
              </p>
            </div>
          </div>

          {/* Outreach & Positioning */}
          <div className="space-y-4">
            <div className="bg-[#111827] border border-slate-800 rounded-lg p-4">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-medium text-blue-400">
                  Recommended Resume Lead Angle
                </span>
                <button
                  type="button"
                  onClick={() => copyText(job.resumeAngle, 'angle')}
                  className="text-[11px] font-mono text-slate-400 hover:text-white inline-flex items-center gap-1 cursor-pointer"
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
              <p className="text-xs font-mono text-slate-200 leading-relaxed">
                {job.resumeAngle || 'Lead with top quantified metrics'}
              </p>
            </div>

            <div className="bg-[#111827] border border-slate-800 rounded-lg p-4 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-white">
                  Synthesized Outreach (LinkedIn DM & Cold Email)
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => copyText(job.dm, 'dm')}
                    className="px-2.5 py-1 rounded text-[11px] font-mono bg-slate-800 hover:bg-slate-700 text-slate-200 inline-flex items-center gap-1 cursor-pointer"
                  >
                    {copiedField === 'dm' ? (
                      <>
                        <Check className="h-3 w-3 text-emerald-400" /> DM Copied
                      </>
                    ) : (
                      <>
                        <Copy className="h-3 w-3" /> Copy DM
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => copyText(synthesizedEmail, 'email')}
                    className="px-2.5 py-1 rounded text-[11px] font-mono bg-slate-800 hover:bg-slate-700 text-slate-200 inline-flex items-center gap-1 cursor-pointer"
                  >
                    {copiedField === 'email' ? (
                      <>
                        <Check className="h-3 w-3 text-emerald-400" /> Email Copied
                      </>
                    ) : (
                      <>
                        <Copy className="h-3 w-3" /> Copy Cold Email
                      </>
                    )}
                  </button>
                </div>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed border-t border-slate-800 pt-2.5">
                {job.dm}
              </p>
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-slate-800 bg-[#0D131F] flex items-center justify-between text-xs text-slate-400">
          <span className="font-mono">Rubric Engine v3.0</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onClose}
            className="bg-slate-900 border-slate-700 text-slate-200 text-xs h-8"
          >
            Close Inspector
          </Button>
        </div>
      </div>
    </div>
  );
}
