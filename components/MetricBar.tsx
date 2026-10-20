'use client';
import React from 'react';
import { motion } from 'motion/react';

export default function MetricBar({ score }: { score: number }) {
  const safeScore = Math.min(100, Math.max(0, Number(score) || 0));
  const isHighMatch = safeScore >= 90;
  const isStrongMatch = safeScore >= 80 && safeScore < 90;

  let barColor = 'bg-slate-500';
  let textColor = 'text-slate-300';

  if (isHighMatch) {
    barColor = 'bg-emerald-500';
    textColor = 'text-emerald-400';
  } else if (isStrongMatch) {
    barColor = 'bg-blue-500';
    textColor = 'text-blue-400';
  } else if (safeScore >= 65) {
    barColor = 'bg-amber-500';
    textColor = 'text-amber-400';
  }

  return (
    <div className="flex items-center gap-2.5 whitespace-nowrap shrink-0">
      <div className="w-20 bg-slate-800/90 h-1.5 rounded-sm overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${safeScore}%` }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          className={`h-full ${barColor}`}
        />
      </div>
      <span className={`font-mono tabular-nums text-xs font-semibold ${textColor}`}>
        {safeScore}
      </span>
    </div>
  );
}
