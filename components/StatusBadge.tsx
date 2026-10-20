import React from 'react';

const STATUS_CONFIG: Record<string, { classes: string; label: string }> = {
  new: {
    classes: 'text-slate-300 bg-slate-800/70 border-slate-700/80',
    label: 'New',
  },
  shortlisted: {
    classes: 'text-cyan-300 bg-cyan-950/60 border-cyan-800/60',
    label: 'Shortlisted',
  },
  applied: {
    classes: 'text-blue-300 bg-blue-950/60 border-blue-800/60',
    label: 'Applied',
  },
  replied: {
    classes: 'text-emerald-300 bg-emerald-950/60 border-emerald-800/60',
    label: 'Replied',
  },
  interview: {
    classes: 'text-violet-300 bg-violet-950/60 border-violet-800/60',
    label: 'Interview',
  },
  offer: {
    classes: 'text-amber-300 bg-amber-950/60 border-amber-700/60',
    label: 'Offer',
  },
  rejected: {
    classes: 'text-rose-300 bg-rose-950/50 border-rose-800/50',
    label: 'Rejected',
  },
  withdrawn: {
    classes: 'text-slate-400 bg-slate-900 border-slate-800',
    label: 'Withdrawn',
  },
  ghosted: {
    classes: 'text-slate-500 bg-slate-900/80 border-slate-800/80',
    label: 'Ghosted',
  },
  ignored: {
    classes: 'text-slate-500 bg-slate-900/50 border-slate-800/50',
    label: 'Ignored',
  },
};

export const ALL_STATUSES = [
  'NEW',
  'SHORTLISTED',
  'APPLIED',
  'REPLIED',
  'INTERVIEW',
  'OFFER',
  'REJECTED',
  'WITHDRAWN',
  'GHOSTED',
  'IGNORED',
];

export default function StatusBadge({ status }: { status: string }) {
  const key = (status || 'new').toLowerCase();
  const cfg = STATUS_CONFIG[key] || STATUS_CONFIG.new;

  return (
    <span
      className={`px-2 py-0.5 inline-flex items-center text-[11px] font-medium rounded border whitespace-nowrap shrink-0 ${cfg.classes}`}
    >
      {cfg.label}
    </span>
  );
}
