'use client';
import React from 'react';
import MetricBar from './MetricBar';
import { motion } from 'motion/react';
import { Card, CardContent, CardFooter, CardHeader } from './ui/card';
import { Button } from './ui/button';
import { Zap, TriangleAlert, MessageSquareText, ArrowUpRight } from 'lucide-react';

interface JobData {
    Date: string; Title: string; Company: string; Score: number;
    Reasons: string; Gap: string; URL: string; DM: string; ResumeAngle: string;
}

export default function JobCard({ job }: { job: JobData }) {
  return (
    <motion.div 
      whileHover={{ scale: 1.01, translateY: -2 }}
      transition={{ duration: 0.2 }}
    >
      <Card className="hover:border-slate-700 transition-colors shadow-sm">
        <CardHeader className="flex flex-col sm:flex-row justify-between items-start sm:items-center pb-2 gap-4 sm:gap-0">
          <div>
            <h3 className="text-lg font-medium text-white">{job.Title}</h3>
            <p className="text-sm text-slate-400">{job.Company}</p>
          </div>
          <div className="shrink-0">
            <MetricBar score={job.Score} />
          </div>
        </CardHeader>
        <CardContent className="space-y-4 pt-2">
          <div className="flex gap-2 items-start">
            <Zap className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
            <div>
              <h4 className="text-[10px] font-bold tracking-wider text-slate-500 uppercase mb-1">Match Reasons</h4>
              <p className="text-sm text-slate-300">{job.Reasons}</p>
            </div>
          </div>
          <div className="flex gap-2 items-start">
            <TriangleAlert className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
            <div>
              <h4 className="text-[10px] font-bold tracking-wider text-slate-500 uppercase mb-1">Caution / Gap</h4>
              <p className="text-sm text-slate-300">{job.Gap}</p>
            </div>
          </div>
          <div className="bg-slate-900 p-4 rounded-md border border-slate-800 flex gap-3 items-start">
            <MessageSquareText className="h-4 w-4 text-blue-400 mt-0.5 shrink-0" />

            <div>
              <h4 className="text-[10px] font-bold tracking-wider text-blue-400 uppercase mb-2">Outreach Draft</h4>
              <p className="text-sm italic text-slate-400 leading-relaxed">{job.DM}</p>
            </div>
          </div>
        </CardContent>
        <CardFooter className="border-t border-slate-800 pt-4 flex justify-between items-center mt-2">
           <span className="text-xs font-mono text-slate-500 flex items-center gap-2">
             Discovered: {job.Date}
           </span>
           <Button asChild variant="outline" size="sm" className="text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/10">
             <a href={job.URL} target="_blank" rel="noreferrer">
               Apply Now <ArrowUpRight className="ml-2 h-3.5 w-3.5" />
             </a>
           </Button>
        </CardFooter>
      </Card>
    </motion.div>
  );
}
