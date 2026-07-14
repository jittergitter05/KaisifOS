'use client';
import React, { useEffect, useState, useMemo } from 'react';
import JobCard from '@/components/JobCard';
import { motion } from 'motion/react';
import { RefreshCw, Calendar } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface DigestJob {
  rowId: number;
  Date: string;
  Title: string;
  Company: string;
  Score: number;
  Reasons: string;
  Gap: string;
  URL: string;
  DM: string;
  ResumeAngle: string;
  Status: string;
}

export default function DigestPage() {
  const [jobs, setJobs] = useState<DigestJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDigest = () => {
    setLoading(true);
    setError(null);
    fetch('/api/sheet-sync')
      .then(async res => {
        if (res.status === 401) {
          window.location.href = '/login';
          return null;
        }
        if (!res.ok) throw new Error('Failed to fetch data');
        return res.json();
      })
      .then(data => {
        if (data && data.rows) {
          // Get past 7 days
          const sevenDaysAgo = new Date();
          sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

          const parsedJobs = data.rows.map((r: string[], i: number) => ({
            rowId: i + 1, Date: r[0] || '', Title: r[2] || '', Company: r[3] || '',
            Score: parseInt(r[4] || '0', 10), Reasons: r[5] || '', Gap: r[6] || '',
            URL: r[7] || '', DM: r[8] || '', ResumeAngle: r[9] || '', Status: r[10] || 'NEW',
          })).filter((j: DigestJob) => {
             if (j.Title === 'Title' || !j.Date) return false;
             try {
                const jobDate = new Date(j.Date);
                // Keep jobs from the last 7 days with a score >= 90
                return jobDate >= sevenDaysAgo && j.Score >= 90;
             } catch {
                return false;
             }
          });
          setJobs(parsedJobs.sort((a: DigestJob, b: DigestJob) => {
             // Sort by Date desc, then Score desc
             const dateDiff = new Date(b.Date).getTime() - new Date(a.Date).getTime();
             if (dateDiff !== 0) return dateDiff;
             return b.Score - a.Score;
          }));
        }
        setLoading(false);
      })
      .catch((err) => {
        console.error(err);
        setError('Failed to load digest data.');
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchDigest();
  }, []);

  const groupedJobs = useMemo(() => {
    const groups: Record<string, DigestJob[]> = {};
    jobs.forEach(job => {
       if (!groups[job.Date]) groups[job.Date] = [];
       groups[job.Date].push(job);
    });
    return groups;
  }, [jobs]);

  return (
    <div className="flex flex-col flex-1 w-full bg-slate-950 text-slate-50">
      <motion.main 
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="flex-1 py-8 px-4 sm:px-6 lg:px-8 max-w-4xl mx-auto w-full pb-24"
      >
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 gap-4 border-b border-slate-800 pb-6">
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-white mb-2">Scout Digest</h1>
              <p className="text-sm text-slate-400">Review the highest-matching roles from the past 7 days (Score &ge; 90)</p>
            </div>
            <Button onClick={fetchDigest} disabled={loading} variant="outline" size="sm" className="shrink-0 bg-slate-900 border-slate-800 hover:bg-slate-800 text-slate-400 flex items-center gap-2">
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin text-emerald-500' : ''}`} />
              Refresh
            </Button>
        </div>

        {loading ? <div className="text-center py-12 text-slate-500 font-mono text-xs">Loading latest matches...</div> :
         error ? <div className="text-center py-12 text-slate-500 font-mono text-xs text-red-400">{error}</div> :
         jobs.length === 0 ? <div className="text-center py-12 bg-slate-950 rounded-xl shadow-sm border border-slate-800 text-slate-400 gap-4 flex flex-col items-center"><p className="text-sm font-medium text-white">No top matches found recently.</p><p className="text-[10px] font-mono text-slate-500 tracking-wider">Cron runs daily at 08:00 UTC</p></div> :
         <div className="space-y-12 pb-12">
            {Object.entries(groupedJobs).map(([date, dateJobs]) => (
              <div key={date} className="relative">
                 <div className="flex items-center gap-3 mb-6 sticky top-16 bg-slate-950/90 backdrop-blur py-2 z-10 border-b border-slate-800">
                    <Calendar className="h-5 w-5 text-blue-500" />
                    <h2 className="text-xl font-bold text-slate-100">{date}</h2>
                    <span className="px-2 py-0.5 rounded-full bg-slate-900 border border-slate-800 text-xs font-mono text-slate-400">
                      {dateJobs.length} roles
                    </span>
                 </div>
                 <div className="space-y-6">
                   {dateJobs.map(job => <JobCard key={job.rowId} job={job} />)}
                 </div>
              </div>
            ))}
         </div>}
      </motion.main>
    </div>
  );
}
