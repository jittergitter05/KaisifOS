import React from 'react';

const STATUS_CONFIG: Record<string, string> = {
  new: 'bg-slate-800/80 text-slate-300 border border-slate-700',
  shortlisted: 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/30',
  applied: 'bg-blue-500/15 text-blue-400 border border-blue-500/30',
  replied: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30',
  interview: 'bg-purple-500/15 text-purple-400 border border-purple-500/30',
  offer: 'bg-amber-500/15 text-amber-400 border border-amber-500/30',
  rejected: 'bg-red-500/15 text-red-400 border border-red-500/30',
  withdrawn: 'bg-slate-600/20 text-slate-400 border border-slate-600/30',
  ghosted: 'bg-slate-700/20 text-slate-500 border border-slate-700/30',
  ignored: 'bg-slate-800/40 text-slate-500 border border-slate-800',
};

export const ALL_STATUSES = [
  'NEW', 'SHORTLISTED', 'APPLIED', 'REPLIED', 'INTERVIEW',
  'OFFER', 'REJECTED', 'WITHDRAWN', 'GHOSTED', 'IGNORED',
];

export default function StatusBadge({ status }: { status: string }) {
  const classes = STATUS_CONFIG[status.toLowerCase()] || STATUS_CONFIG.new;

  return (
    <span className={`px-2 py-0.5 inline-flex text-[10px] font-bold uppercase rounded ${classes}`}>
      {status}
    </span>
  );
}
