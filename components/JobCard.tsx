'use client';
import React from 'react';
import StatusBadge from './StatusBadge';
import MetricBar from './MetricBar';
import { motion } from 'motion/react';

interface JobData {
    Date: string; Title: string; Company: string; Score: number;
    Reasons: string; Gap: string; URL: string; DM: string; ResumeAngle: string;
}

export default function JobCard({ job }: { job: JobData }) {
  return (
    <motion.div 
      whileHover={{ scale: 1.01, translateY: -2 }}
      transition={{ duration: 0.2 }}
      className="bg-slate-900 border border-slate-800 rounded-xl p-5 sm:p-6 hover:border-slate-700 transition-colors shadow-sm"
    >
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-4 gap-4 sm:gap-0">
        <div>
           <h3 className="text-base sm:text-lg font-medium text-white">{job.Title}</h3>
           <p className="text-xs text-slate-500">{job.Company}</p>
        </div>
        <div className="shrink-0">
          <MetricBar score={job.Score} />
        </div>
      </div>
      <div className="space-y-4 pt-2">
          <div><h4 className="text-[10px] font-bold tracking-wider text-slate-500 uppercase mb-1">Match Reasons</h4><p className="text-sm text-slate-300">{job.Reasons}</p></div>
          <div><h4 className="text-[10px] font-bold tracking-wider text-slate-500 uppercase mb-1">Caution / Gap</h4><p className="text-sm text-slate-300">{job.Gap}</p></div>
          <div className="bg-slate-800/50 p-4 rounded-md border border-slate-700/50"><h4 className="text-[10px] font-bold tracking-wider text-emerald-500 uppercase mb-2">DM Draft</h4><p className="text-sm italic text-slate-400">{job.DM}</p></div>
      </div>
      <div className="mt-6 pt-4 border-t border-slate-800 flex justify-between items-center">
         <span className="text-xs font-mono text-slate-500">Found {job.Date}</span>
         <a href={job.URL} target="_blank" rel="noreferrer" className="inline-flex items-center px-4 py-2 border border-emerald-500/20 text-xs font-medium rounded-md text-emerald-400 hover:bg-emerald-500/10 focus:outline-none transition-colors">Apply Now</a>
      </div>
    </motion.div>
  );
}
