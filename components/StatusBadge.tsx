import React from 'react';

const STATUS_CONFIG: Record<string, { classes: string; label: string }> = {
  new: {
    classes:
      'text-slate-700 bg-slate-100 border-slate-300 dark:text-slate-300 dark:bg-slate-800/70 dark:border-slate-700/80',
    label: 'New',
  },
  shortlisted: {
    classes:
      'text-cyan-800 bg-cyan-50 border-cyan-300 dark:text-cyan-300 dark:bg-cyan-950/60 dark:border-cyan-800/60',
    label: 'Shortlisted',
  },
  applied: {
    classes:
      'text-blue-800 bg-blue-50 border-blue-300 dark:text-blue-300 dark:bg-blue-950/60 dark:border-blue-800/60',
    label: 'Applied',
  },
  replied: {
    classes:
      'text-emerald-800 bg-emerald-50 border-emerald-300 dark:text-emerald-300 dark:bg-emerald-950/60 dark:border-emerald-800/60',
    label: 'Replied',
  },
  interview: {
    classes:
      'text-violet-800 bg-violet-50 border-violet-300 dark:text-violet-300 dark:bg-violet-950/60 dark:border-violet-800/60',
    label: 'Interview',
  },
  offer: {
    classes:
      'text-amber-800 bg-amber-50 border-amber-300 dark:text-amber-300 dark:bg-amber-950/60 dark:border-amber-700/60',
    label: 'Offer',
  },
  rejected: {
    classes:
      'text-rose-800 bg-rose-50 border-rose-300 dark:text-rose-300 dark:bg-rose-950/50 dark:border-rose-800/50',
    label: 'Rejected',
  },
  withdrawn: {
    classes:
      'text-slate-600 bg-slate-100 border-slate-300 dark:text-slate-400 dark:bg-slate-900 dark:border-slate-800',
    label: 'Withdrawn',
  },
  ghosted: {
    classes:
      'text-slate-500 bg-slate-100 border-slate-200 dark:text-slate-500 dark:bg-slate-900/80 dark:border-slate-800/80',
    label: 'Ghosted',
  },
  ignored: {
    classes:
      'text-slate-500 bg-slate-50 border-slate-200 dark:text-slate-500 dark:bg-slate-900/50 dark:border-slate-800/50',
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
