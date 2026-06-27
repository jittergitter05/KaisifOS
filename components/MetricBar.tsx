'use client';
import React from 'react';
import { motion } from 'motion/react';

export default function MetricBar({ score }: { score: number }) {
  const isHighMatch = score >= 85;
  const isMedMatch = score >= 70 && score < 85;
  let barColor = 'bg-slate-600';
  if (isHighMatch) barColor = 'bg-emerald-500';
  else if (isMedMatch) barColor = 'bg-yellow-500';
  let textColor = 'text-slate-400';
  if (isHighMatch) textColor = 'text-emerald-500';
  else if (isMedMatch) textColor = 'text-yellow-500';

  return (
    <div className="flex items-center space-x-3">
      <div className="w-24 bg-slate-800 h-1.5 rounded-full overflow-hidden">
        <motion.div 
          initial={{ width: 0 }}
          animate={{ width: `${Math.min(100, Math.max(0, score))}%` }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className={`h-full ${barColor}`} 
        />
      </div>
      <span className={`font-mono text-xs font-bold ${textColor}`}>{score}</span>
    </div>
  );
}
