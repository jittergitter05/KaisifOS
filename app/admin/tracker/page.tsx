'use client';
import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import StatusBadge, { ALL_STATUSES } from '@/components/StatusBadge';
import MetricBar from '@/components/MetricBar';
import InteractiveEvaluator from '@/components/InteractiveEvaluator';
import JobAuditDrawer, { deriveJobPillarBreakdown } from '@/components/JobAuditDrawer';
import {
  SOURCE_FILTER_OPTIONS,
  detectSource,
  safeExternalUrl,
  extractExternalHost,
  sanitizeCsvCell,
  parseIsoDateTimestamp,
  copyToClipboardSafe,
} from '@/lib/utils';
import dynamic from 'next/dynamic';
import { motion, AnimatePresence } from 'motion/react';
import {
  RefreshCw,
  Download,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  Copy,
  Check,
  Plus,
  X,
  BarChart3,
  ArrowUpRight,
  Layers,
  Radar,
  Columns3,
  Table2,
  Sparkles,
  Clock,
  Archive,
  MailCheck,
} from 'lucide-react';
import { computeJobFreshnessAndCadence } from '@/lib/outreach-engine';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { useKeyboardNav } from '@/hooks/useKeyboardNav';

const ClientChart = dynamic(() => import('@/components/ClientChart'), { ssr: false });

interface JobRow {
  rowId: number;
  date: string;
  id: string;
  canonicalKey?: string;
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

const KANBAN_STAGES = [
  { key: 'NEW', label: 'New Triage' },
  { key: 'SHORTLISTED', label: 'Shortlisted' },
  { key: 'OUTREACH_DRAFTED', label: 'Outreach Drafted' },
  { key: 'APPLIED', label: 'Applied' },
  { key: 'INTERVIEW', label: 'Interview' },
  { key: 'OFFER', label: 'Offer' },
];

function predictReplyLikelihood(job: JobRow): number {
  if (job.status !== 'APPLIED') return -1;
  const parsedTime = parseIsoDateTimestamp(job.date);
  const daysSinceApplied = Number.isNaN(parsedTime)
    ? 0
    : Math.max(0, Math.floor((Date.now() - parsedTime) / (1000 * 60 * 60 * 24)));

  let prob = 0;
  prob += job.score * 0.42;
  prob += daysSinceApplied < 3 ? 28 : daysSinceApplied < 7 ? 20 : daysSinceApplied < 14 ? 10 : 4;
  prob += job.dm ? 14 : 0;
  prob += job.resumeAngle ? 8 : 0;
  return Math.min(98, Math.max(5, Math.round(prob)));
}

function isStale(job: JobRow, thresholdDays = 7): boolean {
  if (job.status !== 'APPLIED') return false;
  const parsed = parseIsoDateTimestamp(job.appliedAt || job.date);
  if (Number.isNaN(parsed)) return false;
  const days = Math.floor((Date.now() - parsed) / (1000 * 60 * 60 * 24));
  return days >= thresholdDays;
}

function exportToCSV(jobs: JobRow[]) {
  const headers = [
    'Date',
    'ID',
    'Source',
    'Title',
    'Company',
    'Location',
    'Score',
    'RolePillar(/40)',
    'SkillPillar(/30)',
    'SeniorityPillar(/15)',
    'CompPillar(/15)',
    'Status',
    'EvaluationMode',
    'URL',
    'Reasons',
    'Gap',
    'DM Draft',
    'Resume Angle',
  ];
  const rows = jobs.map((j) => {
    const p = deriveJobPillarBreakdown(j);
    return [
      j.date,
      j.id,
      j.source,
      j.title,
      j.company,
      j.location || '',
      j.score,
      p.role.earned,
      p.skill.earned,
      p.seniority.earned,
      p.compGeo.earned,
      j.status,
      j.needsLlmRetry ? 'DETERMINISTIC_ONLY' : 'LLM_SCORED',
      j.url,
      j.reasons,
      j.gap,
      j.dm,
      j.resumeAngle,
    ]
      .map((v) => sanitizeCsvCell(v))
      .join(',');
  });
  const csv = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = `kaisifos-tracker-${new Date().toISOString().split('T')[0]}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

export default function TrackerPage() {
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [storageMode, setStorageMode] = useState<string>('local-store');
  const [loading, setLoading] = useState(true);
  const [scoutingLive, setScoutingLive] = useState(false);
  const [retryingLlm, setRetryingLlm] = useState(false);
  const [viewMode, setViewMode] = useState<'table' | 'kanban' | 'retry'>('table');
  const [scoutBanner, setScoutBanner] = useState<{
    message: string;
    telemetryLine?: string;
    committedJobs?: Array<{
      title: string;
      company: string;
      score: number;
      url?: string;
      source?: string;
    }>;
  } | null>(null);
  const [filter, setFilter] = useState('ALL');
  const [sourceFilter, setSourceFilter] = useState('ALL');
  const [minScoreFilter, setMinScoreFilter] = useState<number>(0);
  const [staleOnly, setStaleOnly] = useState(false);
  const [needsFollowUpOnly, setNeedsFollowUpOnly] = useState(false);
  const [staleNewOnly, setStaleNewOnly] = useState(false);
  const [archivingStale, setArchivingStale] = useState(false);
  const [slaThresholdDays, setSlaThresholdDays] = useState<number>(7);
  const [sortField, setSortField] = useState<'date' | 'score' | 'company'>('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [searchQuery, setSearchQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [focusedRow, setFocusedRow] = useState(0);
  const [selectedJobIds, setSelectedJobIds] = useState<Set<string>>(new Set());
  const [showAnalytics, setShowAnalytics] = useState(true);
  const [showEvaluatorModal, setShowEvaluatorModal] = useState(false);
  const [auditDrawerJob, setAuditDrawerJob] = useState<JobRow | null>(null);

  const [editingDmRowId, setEditingDmRowId] = useState<number | null>(null);
  const [draftDmText, setDraftDmText] = useState<string>('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const jobsRef = useRef<JobRow[]>([]);

  useEffect(() => {
    jobsRef.current = jobs;
  }, [jobs]);

  const fetchJobs = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch('/api/sheet-sync')
      .then(async (res) => {
        if (res.status === 401) {
          window.location.href = '/login';
          return null;
        }
        if (!res.ok) throw new Error('Failed to fetch data');
        return res.json();
      })
      .then((data) => {
        if (data && data.rows) {
          if (data.persistenceMode || data.mode) {
            setStorageMode(data.persistenceMode || data.mode);
          }
          const richById = new Map<string, Record<string, any>>();
          if (Array.isArray(data.richRecords)) {
            for (const rec of data.richRecords) {
              if (rec && typeof rec.id === 'string') {
                richById.set(rec.id, rec);
              }
            }
          }
          const parsedJobs = data.rows
            .map((r: string[], i: number) => {
              const id = r[1] || '';
              const reasons = r[5] || '';
              const rich = richById.get(id);
              const inferredDet = /Deterministic 4-Pillar Rubric/i.test(reasons);
              const needsLlmRetry =
                typeof rich?.needsLlmRetry === 'boolean' ? rich.needsLlmRetry : inferredDet;
              return {
                rowId: i + 1,
                date: r[0] || '',
                id,
                canonicalKey: rich?.canonicalKey,
                title: r[2] || '',
                company: r[3] || '',
                location: rich?.location || '',
                salary: rich?.salary || '',
                score: parseInt(r[4] || '0', 10),
                reasons,
                gap: r[6] || '',
                url: r[7] || '',
                dm: r[8] || '',
                emailDraft: rich?.emailDraft || '',
                resumeAngle: r[9] || '',
                status: r[10] || 'NEW',
                source: detectSource(id),
                evaluationStatus:
                  rich?.evaluationStatus || (needsLlmRetry ? 'DETERMINISTIC_ONLY' : 'LLM_SCORED'),
                needsLlmRetry,
                sourcesSeen: Array.isArray(rich?.sourcesSeen) ? rich.sourcesSeen : undefined,
                appliedAt: rich?.appliedAt ?? null,
                lastFollowUpAt: rich?.lastFollowUpAt ?? null,
                followUpCount: Number(rich?.followUpCount || 0),
                lastReplySummary: rich?.lastReplySummary || '',
                lastReplyClassification: rich?.lastReplyClassification || '',
              } as JobRow;
            })
            .filter((j: JobRow) => j.title !== 'Title' && j.id);
          setJobs(parsedJobs);
        }
        setLoading(false);
      })
      .catch((err) => {
        console.error(err);
        setError('Failed to load tracker data.');
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  const executeSweepMode = async (mode: 'live_sweep' | 'retry_pending') => {
    if (mode === 'retry_pending') setRetryingLlm(true);
    else setScoutingLive(true);
    setScoutBanner(null);
    setActionError(null);
    try {
      const res = await fetch('/api/scout/live', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      if (res.status === 401) {
        window.location.href = '/login';
        return;
      }
      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        setActionError(errData?.error || `Live Direct-ATS sweep failed (HTTP ${res.status}).`);
        return;
      }
      const data = await res.json();
      if (data.persistenceMode || data.mode) {
        setStorageMode(data.persistenceMode || data.mode);
      }
      const healthValues =
        data.sourceHealth && typeof data.sourceHealth === 'object'
          ? (Object.values(data.sourceHealth) as Array<{ status?: string }>)
          : [];
      const healthSummary = healthValues.length
        ? ` (${healthValues.filter((s) => s?.status === 'ok').length}/${healthValues.length} feeds healthy)`
        : '';
      const warningText =
        Array.isArray(data.warnings) && data.warnings.length > 0
          ? ` — Notice: ${data.warnings.join(' | ')}`
          : '';
      const telemetryLine = `Canonical Duplicates Merged: ${data.canonicalDedupSaved ?? 0} · Hard-Gate Rejections: ${data.hardGateRejected ?? 0} · Queued for LLM Retry: ${data.queuedForRetryCount ?? 0}`;
      setScoutBanner({
        message:
          mode === 'retry_pending'
            ? `Re-evaluated ${data.evaluatedCount ?? 0} pending deterministic roles · Upgraded ${data.addedCount ?? 0} matches.${warningText}`
            : `Scanned ${data.scanned} live Career Page, Direct-ATS & remote postings · Added ${data.addedCount} top-scoring matches${healthSummary}.${warningText}`,
        telemetryLine,
        committedJobs: Array.isArray(data.committedJobs) ? data.committedJobs : [],
      });
      fetchJobs();
    } catch {
      setActionError('Network error while running live Direct-ATS sweep.');
    } finally {
      setScoutingLive(false);
      setRetryingLlm(false);
    }
  };

  const updateStatus = useCallback(async (rowId: number, newStatus: string) => {
    setActionError(null);
    const snapshot = jobsRef.current;
    const targetJob = snapshot.find((j) => j.rowId === rowId);
    const targetId = targetJob?.id;
    setJobs((prev) => prev.map((j) => (j.rowId === rowId ? { ...j, status: newStatus } : j)));
    try {
      const res = await fetch('/api/sheet-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: targetId,
          canonicalKey: targetJob?.canonicalKey,
          rowId,
          status: newStatus,
        }),
      });
      if (res.status === 401) {
        window.location.href = '/login';
        return;
      }
      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        throw new Error(errData?.error || `Server error: ${res.status}`);
      }
    } catch (e) {
      setJobs(snapshot);
      setActionError((e as Error).message || 'Failed to persist stage update.');
    }
  }, []);

  const saveInlineDm = async (rowId: number) => {
    setActionError(null);
    const targetJob = jobs.find((j) => j.rowId === rowId);
    const originalJobs = [...jobs];
    setJobs(jobs.map((j) => (j.rowId === rowId ? { ...j, dm: draftDmText } : j)));
    setEditingDmRowId(null);
    try {
      const res = await fetch('/api/sheet-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: targetJob?.id,
          canonicalKey: targetJob?.canonicalKey,
          rowId,
          dm: draftDmText,
        }),
      });
      if (res.status === 401) {
        window.location.href = '/login';
        return;
      }
      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        throw new Error(errData?.error || `Server error: ${res.status}`);
      }
    } catch (e) {
      setJobs(originalJobs);
      setActionError((e as Error).message || 'Failed to save DM draft.');
    }
  };

  const copyText = async (text: string, key: string) => {
    const ok = await copyToClipboardSafe(text);
    if (ok) {
      setCopiedId(key);
      setTimeout(() => setCopiedId(null), 1800);
    }
  };

  const pendingRetryCount = useMemo(
    () => jobs.filter((j) => j.needsLlmRetry).length,
    [jobs]
  );

  const followUpDueJobs = useMemo(
    () => jobs.filter((j) => computeJobFreshnessAndCadence(j).isFollowUpDue),
    [jobs]
  );

  const staleNewJobs = useMemo(
    () => jobs.filter((j) => computeJobFreshnessAndCadence(j).isStaleNew),
    [jobs]
  );

  const filteredJobs = useMemo(() => {
    let result = filter === 'ALL' ? jobs : jobs.filter((j) => j.status === filter);
    if (viewMode === 'retry') {
      result = result.filter((j) => j.needsLlmRetry);
    }
    if (sourceFilter !== 'ALL') {
      result = result.filter((j) => j.source === sourceFilter);
    }
    if (minScoreFilter > 0) {
      result = result.filter((j) => j.score >= minScoreFilter);
    }
    if (staleOnly) {
      result = result.filter((j) => isStale(j, slaThresholdDays));
    }
    if (needsFollowUpOnly) {
      result = result.filter((j) => computeJobFreshnessAndCadence(j).isFollowUpDue);
    }
    if (staleNewOnly) {
      result = result.filter((j) => computeJobFreshnessAndCadence(j).isStaleNew);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (j) =>
          j.title.toLowerCase().includes(q) ||
          j.company.toLowerCase().includes(q) ||
          j.reasons.toLowerCase().includes(q) ||
          j.source.toLowerCase().includes(q) ||
          (j.location || '').toLowerCase().includes(q)
      );
    }
    return [...result].sort((a, b) => {
      if (sortField === 'score') return sortDir === 'asc' ? a.score - b.score : b.score - a.score;
      if (sortField === 'date') {
        const tsA = parseIsoDateTimestamp(a.date) || 0;
        const tsB = parseIsoDateTimestamp(b.date) || 0;
        return sortDir === 'asc' ? tsA - tsB : tsB - tsA;
      }
      if (sortField === 'company')
        return sortDir === 'asc'
          ? a.company.localeCompare(b.company)
          : b.company.localeCompare(a.company);
      return 0;
    });
  }, [
    jobs,
    filter,
    viewMode,
    sourceFilter,
    minScoreFilter,
    staleOnly,
    needsFollowUpOnly,
    staleNewOnly,
    slaThresholdDays,
    sortField,
    sortDir,
    searchQuery,
  ]);

  const archiveAllStaleNew = async () => {
    if (staleNewJobs.length === 0 || archivingStale) return;
    setArchivingStale(true);
    setActionError(null);
    const staleIds = new Set(staleNewJobs.map((j) => j.id));
    const snapshot = [...jobs];
    setJobs((prev) =>
      prev.map((j) => (staleIds.has(j.id) ? { ...j, status: 'ARCHIVED' } : j))
    );
    try {
      const res = await fetch('/api/sheet-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'batch_update',
          status: 'ARCHIVED',
          targets: staleNewJobs.map((j) => ({
            id: j.id,
            canonicalKey: j.canonicalKey,
            rowId: j.rowId,
          })),
        }),
      });
      if (res.status === 401) {
        window.location.href = '/login';
        return;
      }
      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        throw new Error(errData?.error || `Archive stale failed (HTTP ${res.status}).`);
      }
      setStaleNewOnly(false);
    } catch (e) {
      setJobs(snapshot);
      setActionError((e as Error).message || 'Failed to archive stale roles.');
    } finally {
      setArchivingStale(false);
    }
  };

  const bulkUpdateStatus = async (newStatus: string) => {
    const targets = jobs.filter((j) => selectedJobIds.has(j.id));
    if (targets.length === 0) return;

    setActionError(null);
    const targetIds = new Set(targets.map((t) => t.id));
    const snapshot = [...jobs];
    setJobs((prev) =>
      prev.map((j) => (targetIds.has(j.id) ? { ...j, status: newStatus } : j))
    );
    setSelectedJobIds(new Set());

    try {
      const res = await fetch('/api/sheet-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'batch_update',
          status: newStatus,
          targets: targets.map((t) => ({ id: t.id, rowId: t.rowId })),
        }),
      });
      if (res.status === 401) {
        window.location.href = '/login';
        return;
      }
      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        throw new Error(errData?.error || `Batch update failed (HTTP ${res.status}).`);
      }
    } catch (e) {
      setJobs(snapshot);
      setActionError((e as Error).message || 'Batch status update failed.');
    }
  };

  const cycleStatus = useCallback(
    (index: number) => {
      const job = filteredJobs[index];
      if (!job) return;
      const currentIdx = ALL_STATUSES.indexOf(job.status);
      const nextStatus = ALL_STATUSES[(currentIdx + 1) % ALL_STATUSES.length];
      updateStatus(job.rowId, nextStatus);
    },
    [filteredJobs, updateStatus]
  );

  const analytics = useMemo(() => {
    if (jobs.length === 0) return null;
    const now = new Date();

    const sources: Record<string, { count: number; totalScore: number }> = {};
    let roleSum = 0;
    let skillSum = 0;
    let senSum = 0;
    let compSum = 0;

    jobs.forEach((j) => {
      if (!sources[j.source]) sources[j.source] = { count: 0, totalScore: 0 };
      sources[j.source].count += 1;
      sources[j.source].totalScore += j.score;

      const p = deriveJobPillarBreakdown(j);
      roleSum += p.role.earned;
      skillSum += p.skill.earned;
      senSum += p.seniority.earned;
      compSum += p.compGeo.earned;
    });

    const staleCount = jobs.filter((j) => isStale(j, slaThresholdDays)).length;

    const pipeline: Record<string, number> = {};
    ALL_STATUSES.forEach((s) => {
      pipeline[s] = jobs.filter((j) => j.status === s).length;
    });

    const last30Ms = now.getTime() - 30 * 24 * 60 * 60 * 1000;
    const dailyScores: Record<string, { total: number; count: number }> = {};
    jobs.forEach((job) => {
      const ts = parseIsoDateTimestamp(job.date);
      if (Number.isFinite(ts) && ts >= last30Ms) {
        const isoKey = /^\d{4}-\d{2}-\d{2}$/.test(job.date.trim())
          ? job.date.trim()
          : new Date(ts).toISOString().split('T')[0];
        if (!dailyScores[isoKey]) dailyScores[isoKey] = { total: 0, count: 0 };
        dailyScores[isoKey].total += job.score;
        dailyScores[isoKey].count += 1;
      }
    });
    const chartData = Object.keys(dailyScores)
      .sort()
      .map((isoKey) => ({
        date: isoKey.slice(5),
        avgScore: Math.round(dailyScores[isoKey].total / dailyScores[isoKey].count),
      }));

    const total = jobs.length;
    const shortlistedOrBeyond = jobs.filter((j) =>
      ['SHORTLISTED', 'OUTREACH_DRAFTED', 'APPLIED', 'REPLIED', 'INTERVIEW', 'OFFER'].includes(
        j.status
      )
    ).length;
    const appliedOrBeyond = jobs.filter((j) =>
      ['APPLIED', 'REPLIED', 'INTERVIEW', 'OFFER'].includes(j.status)
    ).length;
    const repliedOrBeyond = jobs.filter((j) =>
      ['REPLIED', 'INTERVIEW', 'OFFER'].includes(j.status)
    ).length;
    const interviewOrBeyond = jobs.filter((j) => ['INTERVIEW', 'OFFER'].includes(j.status)).length;
    const offers = jobs.filter((j) => j.status === 'OFFER').length;

    const funnelData = [
      { stage: 'Discovered', count: total, conversionPct: 100 },
      {
        stage: 'Shortlisted',
        count: shortlistedOrBeyond,
        conversionPct: Math.round((shortlistedOrBeyond / total) * 100),
      },
      {
        stage: 'Applied',
        count: appliedOrBeyond,
        conversionPct: Math.round((appliedOrBeyond / total) * 100),
      },
      {
        stage: 'Replied',
        count: repliedOrBeyond,
        conversionPct: Math.round((repliedOrBeyond / total) * 100),
      },
      {
        stage: 'Interview',
        count: interviewOrBeyond,
        conversionPct: Math.round((interviewOrBeyond / total) * 100),
      },
      { stage: 'Offer', count: offers, conversionPct: Math.round((offers / total) * 100) },
    ];

    const sourceYieldData = Object.entries(sources)
      .map(([source, v]) => ({
        source: source.replace(' ATS', ''),
        count: v.count,
        avgScore: Math.round(v.totalScore / v.count),
      }))
      .sort((a, b) => b.avgScore - a.avgScore);

    const pillarData = [
      {
        pillar: 'Role (/40)',
        earned: Math.round(roleSum / total),
        max: 40,
        pct: Math.round((roleSum / total / 40) * 100),
      },
      {
        pillar: 'Skill (/30)',
        earned: Math.round(skillSum / total),
        max: 30,
        pct: Math.round((skillSum / total / 30) * 100),
      },
      {
        pillar: 'Seniority (/15)',
        earned: Math.round(senSum / total),
        max: 15,
        pct: Math.round((senSum / total / 15) * 100),
      },
      {
        pillar: 'Comp/Geo (/15)',
        earned: Math.round(compSum / total),
        max: 15,
        pct: Math.round((compSum / total / 15) * 100),
      },
    ];

    return {
      totalLeads: jobs.length,
      appliedCount: appliedOrBeyond,
      intCount: interviewOrBeyond,
      offerCount: offers,
      avgScore: Math.round(jobs.reduce((a, b) => a + b.score, 0) / jobs.length),
      sources,
      staleCount,
      pipeline,
      chartData,
      funnelData,
      sourceYieldData,
      pillarData,
    };
  }, [jobs, slaThresholdDays]);

  const toggleSelectByIndex = useCallback(
    (index: number) => {
      const target = filteredJobs[index];
      if (!target) return;
      setSelectedJobIds((prev) => {
        const next = new Set(prev);
        if (next.has(target.id)) next.delete(target.id);
        else next.add(target.id);
        return next;
      });
    },
    [filteredJobs]
  );

  useEffect(() => {
    if (focusedRow >= filteredJobs.length && filteredJobs.length > 0) {
      setFocusedRow(filteredJobs.length - 1);
    }
  }, [filteredJobs.length, focusedRow]);

  useKeyboardNav({
    totalRows: filteredJobs.length,
    focusedRow,
    setFocusedRow,
    onToggleSelect: toggleSelectByIndex,
    onClearSelection: () => setSelectedJobIds(new Set()),
    expandedRow,
    setExpandedRow,
    onCycleStatus: cycleStatus,
  });

  const toggleSort = (field: 'date' | 'score' | 'company') => {
    if (sortField === field) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  const SortIcon = ({ field }: { field: 'date' | 'score' | 'company' }) => {
    if (sortField !== field) return <span className="opacity-0 group-hover:opacity-40 ml-1">↓</span>;
    return (
      <span className="text-emerald-600 dark:text-emerald-400 ml-1">
        {sortDir === 'asc' ? '↑' : '↓'}
      </span>
    );
  };

  const allFilteredSelected =
    filteredJobs.length > 0 && filteredJobs.every((j) => selectedJobIds.has(j.id));

  const selectAll = () => {
    if (allFilteredSelected) {
      setSelectedJobIds(new Set());
    } else {
      setSelectedJobIds(new Set(filteredJobs.map((j) => j.id)));
    }
  };

  return (
    <div className="flex flex-col flex-1 w-full bg-slate-50 dark:bg-[#0B0F17] text-slate-900 dark:text-[#F8FAFC]">
      <JobAuditDrawer
        job={auditDrawerJob}
        onClose={() => setAuditDrawerJob(null)}
        onJobUpdated={fetchJobs}
      />

      <div className="flex-1 p-4 sm:p-6 max-w-[1680px] mx-auto w-full space-y-6 pb-24">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-4">
          <div>
            <h1 className="text-2xl font-display font-bold tracking-tight text-slate-900 dark:text-white">
              Pipeline Telemetry &amp; 4-Pillar Audit Ledger
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Storage:{' '}
              <span className="font-mono text-slate-700 dark:text-slate-300">
                {storageMode === 'neon-postgres'
                  ? 'Neon Serverless Postgres (Canonical Dedup)'
                  : storageMode === 'cloud-sheets'
                  ? 'Google Sheets v4 Sync'
                  : storageMode === 'ephemeral-tmp'
                  ? 'Ephemeral /tmp Store (Read-Only Host)'
                  : storageMode === 'read-only'
                  ? 'Read-Only Container'
                  : 'Hybrid Local Store'}
              </span>{' '}
              · Click <span className="font-mono text-emerald-600 dark:text-emerald-400">Audit</span>{' '}
              on any role to inspect subscores &amp; outreach composer
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {pendingRetryCount > 0 && (
              <Button
                type="button"
                variant="outline"
                onClick={() => executeSweepMode('retry_pending')}
                disabled={retryingLlm || scoutingLive}
                className="bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-700/70 hover:bg-amber-100 dark:hover:bg-amber-900/50 text-amber-800 dark:text-amber-300 text-xs px-3 py-2 whitespace-nowrap shrink-0"
              >
                <Sparkles
                  className={`h-3.5 w-3.5 mr-1.5 ${retryingLlm ? 'animate-spin' : ''}`}
                />
                {retryingLlm
                  ? 'Retrying LLM Scoring...'
                  : `Retry Pending LLM (${pendingRetryCount})`}
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              onClick={() => executeSweepMode('live_sweep')}
              disabled={scoutingLive || retryingLlm}
              className="bg-white dark:bg-[#111827] border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200 text-xs px-3 py-2 whitespace-nowrap shrink-0"
            >
              <Radar
                className={`h-3.5 w-3.5 mr-1.5 text-emerald-600 dark:text-emerald-400 ${
                  scoutingLive ? 'animate-spin' : ''
                }`}
              />
              {scoutingLive ? 'Sweeping ATS Boards...' : 'Run Live ATS Sweep'}
            </Button>
            <Button
              type="button"
              onClick={() => setShowEvaluatorModal(!showEvaluatorModal)}
              className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium px-3.5 py-2 whitespace-nowrap shrink-0"
            >
              {showEvaluatorModal ? (
                <>
                  <X className="h-3.5 w-3.5 mr-1.5" /> Close Evaluator
                </>
              ) : (
                <>
                  <Plus className="h-3.5 w-3.5 mr-1.5" /> Evaluate &amp; Add Role
                </>
              )}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowAnalytics(!showAnalytics)}
              className="bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs whitespace-nowrap shrink-0"
            >
              <BarChart3 className="h-3.5 w-3.5 mr-1.5" />
              {showAnalytics ? 'Hide Charts' : 'Show Charts'}
            </Button>
          </div>
        </div>

        {scoutBanner && (
          <div className="bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-700/60 text-emerald-800 dark:text-emerald-300 px-4 py-3 rounded-md text-xs space-y-2">
            <div className="flex items-center justify-between gap-3 font-mono">
              <div className="space-y-0.5">
                <div>{scoutBanner.message}</div>
                {scoutBanner.telemetryLine && (
                  <div className="text-[11px] text-emerald-700/90 dark:text-emerald-400/90">
                    {scoutBanner.telemetryLine}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => setScoutBanner(null)}
                aria-label="Dismiss notice"
                className="text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white cursor-pointer shrink-0"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            {scoutBanner.committedJobs && scoutBanner.committedJobs.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-1.5 border-t border-emerald-200/70 dark:border-emerald-800/50">
                {scoutBanner.committedJobs.map((cj, idx) => {
                  const href = safeExternalUrl(cj.url);
                  const host = extractExternalHost(cj.url);
                  return (
                    <div
                      key={`${cj.company}-${cj.title}-${idx}`}
                      className="inline-flex items-center gap-2 bg-white dark:bg-[#0B0F17] border border-emerald-200 dark:border-emerald-800/60 rounded px-2.5 py-1 text-[11px]"
                    >
                      <span className="font-medium text-slate-900 dark:text-white">
                        {cj.title} @ {cj.company}
                      </span>
                      <span className="font-mono text-emerald-600 dark:text-emerald-400 tabular-nums">
                        {cj.score}/100
                      </span>
                      {href !== '#' && (
                        <a
                          href={href}
                          target="_blank"
                          rel="noreferrer"
                          className="font-mono text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-0.5"
                        >
                          Apply ({host || 'Direct'}) <ArrowUpRight className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {actionError && (
          <div className="bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/70 text-rose-800 dark:text-rose-200 px-4 py-2.5 rounded-md text-xs font-mono flex items-center justify-between gap-3">
            <span className="flex items-center gap-2">
              <AlertTriangle className="h-3.5 w-3.5 text-rose-600 dark:text-rose-400 shrink-0" />
              {actionError}
            </span>
            <button
              type="button"
              onClick={() => setActionError(null)}
              aria-label="Dismiss error"
              className="text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white shrink-0 cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        <AnimatePresence>
          {showEvaluatorModal && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18 }}
            >
              <InteractiveEvaluator
                onRoleCommitted={() => {
                  fetchJobs();
                }}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Top Multi-Tab Analytics Workbench */}
        {showAnalytics && analytics && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            <div className="lg:col-span-4 grid grid-cols-2 gap-3">
              <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-lg p-4 flex flex-col justify-between">
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  Total Pipeline Leads
                </div>
                <div className="text-2xl font-mono font-bold text-slate-900 dark:text-white tabular-nums mt-1">
                  {analytics.totalLeads}
                </div>
                <div className="text-[11px] font-mono text-slate-500 mt-1">
                  Across {Object.keys(analytics.sources).length} ingestion channels
                </div>
              </div>
              <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-lg p-4 flex flex-col justify-between">
                <div className="text-xs text-slate-500 dark:text-slate-400">Mean Fit Score</div>
                <div className="text-2xl font-mono font-bold text-emerald-600 dark:text-emerald-400 tabular-nums mt-1">
                  {analytics.avgScore}
                  <span className="text-xs text-slate-500 font-normal">/100</span>
                </div>
                <div className="text-[11px] font-mono text-slate-500 mt-1">
                  4-Pillar Rubric v3.2
                </div>
              </div>
              <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-lg p-4 flex flex-col justify-between">
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  Applied &amp; Active
                </div>
                <div className="text-2xl font-mono font-bold text-blue-600 dark:text-blue-400 tabular-nums mt-1">
                  {analytics.appliedCount}
                </div>
                <div className="text-[11px] font-mono text-slate-500 mt-1 tabular-nums">
                  {Math.round((analytics.appliedCount / analytics.totalLeads) * 100)}% application
                  rate
                </div>
              </div>
              <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-lg p-4 flex flex-col justify-between">
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  Interviews &amp; Offers
                </div>
                <div className="text-2xl font-mono font-bold text-slate-900 dark:text-white tabular-nums mt-1">
                  {analytics.intCount}
                </div>
                <div className="text-[11px] font-mono text-emerald-600 dark:text-emerald-400 mt-1 tabular-nums">
                  {analytics.offerCount} confirmed offer(s)
                </div>
              </div>
            </div>

            <div className="lg:col-span-8 bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-lg p-4">
              <ClientChart
                mode="full"
                data={analytics.chartData}
                funnelData={analytics.funnelData}
                sourceYieldData={analytics.sourceYieldData}
                pillarData={analytics.pillarData}
              />
            </div>
          </div>
        )}

        <div className="flex flex-col lg:grid lg:grid-cols-12 gap-6">
          {showAnalytics && analytics && (
            <div className="lg:col-span-3 space-y-4">
              {analytics.staleCount > 0 && (
                <div
                  className={`border rounded-lg p-4 space-y-2.5 transition-colors ${
                    staleOnly
                      ? 'bg-amber-100/80 dark:bg-amber-950/60 border-amber-400 dark:border-amber-600/60'
                      : 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800/50'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setStaleOnly(!staleOnly);
                      setFilter('ALL');
                    }}
                    className="w-full text-left cursor-pointer"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
                        <span className="text-xs font-semibold text-amber-800 dark:text-amber-300 tabular-nums">
                          {analytics.staleCount} SLA Follow-Up Alert(s)
                        </span>
                      </div>
                      <span className="text-[11px] font-mono text-amber-700 dark:text-amber-400 underline">
                        {staleOnly ? 'Show All' : 'Isolate'}
                      </span>
                    </div>
                    <p className="text-xs text-amber-700/90 dark:text-amber-200/70 mt-1">
                      Applied {slaThresholdDays}+ days ago with no recruiter response logged.
                    </p>
                  </button>
                  <div className="flex items-center justify-between pt-2 border-t border-amber-200 dark:border-amber-800/40 text-[11px] font-mono">
                    <span className="text-amber-700 dark:text-amber-300/80">SLA Threshold:</span>
                    <div className="flex items-center gap-1">
                      {[5, 7, 14].map((d) => (
                        <button
                          key={d}
                          type="button"
                          onClick={() => setSlaThresholdDays(d)}
                          className={`px-1.5 py-0.5 rounded cursor-pointer ${
                            slaThresholdDays === d
                              ? 'bg-amber-500/25 text-amber-900 dark:text-amber-200 font-semibold'
                              : 'text-amber-700/70 dark:text-amber-300/60 hover:text-amber-900 dark:hover:text-amber-200'
                          }`}
                        >
                          {d}d
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-lg p-4">
                <div className="text-xs font-medium text-slate-700 dark:text-slate-300 mb-3">
                  Stage Distribution Filter
                </div>
                <div className="space-y-2">
                  {[
                    'NEW',
                    'SHORTLISTED',
                    'OUTREACH_DRAFTED',
                    'APPLIED',
                    'REPLIED',
                    'INTERVIEW',
                    'OFFER',
                  ].map((s) => {
                    const count = analytics.pipeline[s] || 0;
                    const maxCount = Math.max(...Object.values(analytics.pipeline), 1);
                    const pct = Math.round((count / maxCount) * 100);
                    return (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setFilter(filter === s ? 'ALL' : s)}
                        className="w-full flex items-center gap-2.5 group text-left cursor-pointer"
                      >
                        <span className="text-[11px] text-slate-500 dark:text-slate-400 group-hover:text-slate-900 dark:group-hover:text-white w-28 font-mono truncate">
                          {s}
                        </span>
                        <div className="flex-1 bg-slate-200 dark:bg-slate-800/80 h-1.5 rounded-xs overflow-hidden">
                          <div
                            style={{ width: `${pct}%` }}
                            className="h-full bg-emerald-500/85 transition-all"
                          />
                        </div>
                        <span className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400 w-6 text-right">
                          {count}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-lg p-4">
                <div className="text-xs font-medium text-slate-700 dark:text-slate-300 mb-3">
                  Direct-ATS &amp; Board Yield
                </div>
                <div className="divide-y divide-slate-200/70 dark:divide-slate-800/70">
                  {Object.entries(analytics.sources)
                    .sort(([, a], [, b]) => b.count - a.count)
                    .map(([source, stat]) => {
                      const avg = Math.round(stat.totalScore / stat.count);
                      return (
                        <button
                          key={source}
                          type="button"
                          onClick={() =>
                            setSourceFilter(sourceFilter === source ? 'ALL' : source)
                          }
                          className="w-full py-2 flex items-center justify-between text-xs hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                        >
                          <span
                            className={
                              sourceFilter === source
                                ? 'text-emerald-600 dark:text-emerald-400 font-medium'
                                : 'text-slate-700 dark:text-slate-300'
                            }
                          >
                            {source}
                          </span>
                          <span className="font-mono tabular-nums text-slate-500 dark:text-slate-400">
                            {stat.count} ·{' '}
                            <span className="text-emerald-600 dark:text-emerald-400">{avg}</span>
                            /100
                          </span>
                        </button>
                      );
                    })}
                </div>
              </div>
            </div>
          )}

          <div
            className={`${
              showAnalytics ? 'lg:col-span-9' : 'lg:col-span-12'
            } flex flex-col bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden`}
          >
            <div className="p-3.5 border-b border-slate-200 dark:border-slate-800 flex flex-col gap-3 bg-slate-50 dark:bg-[#0D131F]">
              {/* Workspace View Switcher */}
              <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-slate-200/80 dark:border-slate-800/80">
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setViewMode('table')}
                    className={`px-3 py-1.5 rounded text-xs font-medium inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      viewMode === 'table'
                        ? 'bg-emerald-600 text-white'
                        : 'bg-white dark:bg-[#0B0F17] text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    <Table2 className="h-3.5 w-3.5" /> Triage Table ({filteredJobs.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode('kanban')}
                    className={`px-3 py-1.5 rounded text-xs font-medium inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      viewMode === 'kanban'
                        ? 'bg-emerald-600 text-white'
                        : 'bg-white dark:bg-[#0B0F17] text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    <Columns3 className="h-3.5 w-3.5" /> Stage Kanban Board
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode('retry')}
                    className={`px-3 py-1.5 rounded text-xs font-medium inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      viewMode === 'retry'
                        ? 'bg-amber-600 text-white'
                        : 'bg-white dark:bg-[#0B0F17] text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    <Sparkles className="h-3.5 w-3.5" /> Pending LLM Retry ({pendingRetryCount})
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setNeedsFollowUpOnly(!needsFollowUpOnly);
                      setStaleNewOnly(false);
                      setFilter('ALL');
                    }}
                    className={`px-3 py-1.5 rounded text-xs font-medium inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      needsFollowUpOnly
                        ? 'bg-blue-600 text-white'
                        : 'bg-white dark:bg-[#0B0F17] text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    <Clock className="h-3.5 w-3.5" /> Needs Follow-Up ({followUpDueJobs.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setStaleNewOnly(!staleNewOnly);
                      setNeedsFollowUpOnly(false);
                      setFilter('ALL');
                    }}
                    className={`px-3 py-1.5 rounded text-xs font-medium inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      staleNewOnly
                        ? 'bg-amber-600 text-white'
                        : 'bg-white dark:bg-[#0B0F17] text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    <Archive className="h-3.5 w-3.5" /> Stale &gt;14d ({staleNewJobs.length})
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  {staleNewJobs.length > 0 && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={archivingStale}
                      onClick={archiveAllStaleNew}
                      className="h-7 px-2.5 text-[11px] font-mono bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-700/70 text-amber-800 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/50 whitespace-nowrap"
                    >
                      <Archive className="h-3 w-3 mr-1" />
                      {archivingStale
                        ? 'Archiving...'
                        : `Archive All Stale (${staleNewJobs.length})`}
                    </Button>
                  )}
                  <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400 hidden xl:inline">
                    Canonical company-title-geo deduplication active
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-1 overflow-x-auto hide-scrollbar pb-1 sm:pb-0">
                  {['ALL', ...ALL_STATUSES.slice(0, 7)].map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => {
                        setFilter(f);
                        setStaleOnly(false);
                      }}
                      className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        filter === f && !staleOnly
                          ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white border border-slate-200 dark:border-slate-700 shadow-xs dark:shadow-none'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-800/50'
                      }`}
                    >
                      {f === 'ALL'
                        ? 'All Roles'
                        : f === 'OUTREACH_DRAFTED'
                        ? 'Outreach Drafted'
                        : f.charAt(0) + f.slice(1).toLowerCase()}
                    </button>
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                  <select
                    aria-label="Filter by source"
                    value={sourceFilter}
                    onChange={(e) => setSourceFilter(e.target.value)}
                    className="bg-white dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded-md px-2.5 py-1.5 text-xs text-slate-700 dark:text-slate-300 focus:outline-none focus:border-emerald-500"
                  >
                    <option
                      value="ALL"
                      className="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-200"
                    >
                      All Sources &amp; ATS
                    </option>
                    {SOURCE_FILTER_OPTIONS.map((src) => (
                      <option
                        key={src}
                        value={src}
                        className="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-200"
                      >
                        {src}
                      </option>
                    ))}
                  </select>

                  <select
                    aria-label="Filter by minimum score"
                    value={minScoreFilter}
                    onChange={(e) => setMinScoreFilter(Number(e.target.value))}
                    className="bg-white dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded-md px-2.5 py-1.5 text-xs font-mono text-slate-700 dark:text-slate-300 focus:outline-none focus:border-emerald-500"
                  >
                    <option
                      value={0}
                      className="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-200"
                    >
                      Score: All
                    </option>
                    <option
                      value={85}
                      className="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-200"
                    >
                      Score ≥ 85
                    </option>
                    <option
                      value={90}
                      className="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-200"
                    >
                      Score ≥ 90
                    </option>
                    <option
                      value={94}
                      className="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-200"
                    >
                      Score ≥ 94
                    </option>
                  </select>

                  <div className="relative flex-1 sm:w-52">
                    <input
                      type="text"
                      placeholder="Filter role, company, city..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full bg-white dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded-md px-3 py-1.5 text-xs text-slate-900 dark:text-slate-200 focus:outline-none focus:border-emerald-500 transition-colors"
                    />
                  </div>

                  <Button
                    type="button"
                    onClick={() => exportToCSV(filteredJobs)}
                    variant="outline"
                    size="sm"
                    className="shrink-0 bg-white dark:bg-[#0B0F17] border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs h-8 px-2.5 whitespace-nowrap"
                    title="Download CSV with 4-Pillar Subscores"
                  >
                    <Download className="h-3.5 w-3.5 mr-1.5" /> CSV
                  </Button>

                  <Button
                    type="button"
                    onClick={fetchJobs}
                    disabled={loading}
                    variant="outline"
                    size="icon"
                    className="shrink-0 bg-white dark:bg-[#0B0F17] border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 h-8 w-8"
                    title="Refresh Ledger"
                  >
                    <RefreshCw
                      className={`h-3.5 w-3.5 ${
                        loading ? 'animate-spin text-emerald-500 dark:text-emerald-400' : ''
                      }`}
                    />
                  </Button>
                </div>
              </div>
            </div>

            <AnimatePresence>
              {selectedJobIds.size > 0 && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="border-b border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900 px-4 py-2.5 flex items-center gap-3 overflow-hidden"
                >
                  <span className="text-xs text-emerald-600 dark:text-emerald-400 font-mono tabular-nums">
                    {selectedJobIds.size} selected
                  </span>
                  <div className="flex gap-1.5 flex-wrap">
                    {[
                      'SHORTLISTED',
                      'OUTREACH_DRAFTED',
                      'APPLIED',
                      'REPLIED',
                      'INTERVIEW',
                      'REJECTED',
                      'ARCHIVED',
                    ].map((s) => (
                      <Button
                        key={s}
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => bulkUpdateStatus(s)}
                        className="text-xs h-7 px-2.5 bg-white dark:bg-[#0B0F17] border-slate-300 dark:border-slate-700 hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200 whitespace-nowrap shrink-0"
                      >
                        Mark {s === 'OUTREACH_DRAFTED' ? 'Outreach Drafted' : s.charAt(0) + s.slice(1).toLowerCase()}
                      </Button>
                    ))}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedJobIds(new Set())}
                    className="text-xs text-slate-500 dark:text-slate-400 ml-auto h-7"
                  >
                    Clear Selection
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>

            {viewMode === 'kanban' ? (
              <div className="p-4 overflow-x-auto flex-1 bg-slate-50/60 dark:bg-[#0B0F17]/60">
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-3 min-w-[980px]">
                  {KANBAN_STAGES.map((stageCol, stageIdx) => {
                    const colJobs = filteredJobs.filter((j) => j.status === stageCol.key);
                    const prevStage = stageIdx > 0 ? KANBAN_STAGES[stageIdx - 1].key : null;
                    const nextStage =
                      stageIdx < KANBAN_STAGES.length - 1 ? KANBAN_STAGES[stageIdx + 1].key : null;

                    return (
                      <div
                        key={stageCol.key}
                        className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-lg p-3 flex flex-col gap-2.5 min-h-[420px]"
                      >
                        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-2">
                          <span className="text-xs font-semibold text-slate-900 dark:text-white">
                            {stageCol.label}
                          </span>
                          <span className="px-1.5 py-0.5 rounded text-[11px] font-mono tabular-nums bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                            {colJobs.length}
                          </span>
                        </div>

                        {colJobs.length === 0 ? (
                          <div className="flex-1 flex items-center justify-center text-[11px] font-mono text-slate-400 dark:text-slate-600 py-8 text-center">
                            No roles in {stageCol.label}
                          </div>
                        ) : (
                          <div className="space-y-2.5">
                            {colJobs.map((job) => {
                              const applyHref = safeExternalUrl(job.url);
                              const extraSources =
                                Array.isArray(job.sourcesSeen) && job.sourcesSeen.length > 1
                                  ? job.sourcesSeen.length - 1
                                  : 0;
                              return (
                                <div
                                  key={job.id || job.rowId}
                                  className="bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded-md p-2.5 space-y-2 hover:border-emerald-500/60 transition-colors"
                                >
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                      <div className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                                        {job.company}
                                      </div>
                                      <div className="text-[11px] text-slate-600 dark:text-slate-300 line-clamp-2">
                                        {job.title}
                                      </div>
                                    </div>
                                    <span className="px-1.5 py-0.5 rounded text-[11px] font-mono font-bold tabular-nums bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800/60 shrink-0">
                                      {job.score}
                                    </span>
                                  </div>

                                  <div className="flex flex-wrap items-center gap-1 text-[10px] font-mono text-slate-500 dark:text-slate-400">
                                    <span>{job.source}</span>
                                    {extraSources > 0 && (
                                      <span className="text-emerald-600 dark:text-emerald-400">
                                        +{extraSources} src
                                      </span>
                                    )}
                                    {job.location && <span>· {job.location}</span>}
                                  </div>

                                  <div className="flex items-center justify-between gap-1 pt-1.5 border-t border-slate-200/70 dark:border-slate-800/70">
                                    <div className="flex items-center gap-1">
                                      {prevStage && (
                                        <button
                                          type="button"
                                          onClick={() => updateStatus(job.rowId, prevStage)}
                                          title={`Move back to ${prevStage}`}
                                          className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-200/70 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-700 cursor-pointer"
                                        >
                                          ←
                                        </button>
                                      )}
                                      {nextStage && (
                                        <button
                                          type="button"
                                          onClick={() => updateStatus(job.rowId, nextStage)}
                                          title={`Advance to ${nextStage}`}
                                          className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-emerald-600/15 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-600/25 cursor-pointer"
                                        >
                                          Stage →
                                        </button>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                      <button
                                        type="button"
                                        onClick={() => setAuditDrawerJob(job)}
                                        className="text-[10px] font-mono text-slate-700 dark:text-slate-300 hover:text-emerald-600 dark:hover:text-emerald-400 underline cursor-pointer"
                                      >
                                        Outreach &amp; Audit
                                      </button>
                                      {applyHref !== '#' && (
                                        <a
                                          href={applyHref}
                                          target="_blank"
                                          rel="noreferrer"
                                          className="text-[10px] font-mono text-emerald-600 dark:text-emerald-400 hover:underline inline-flex items-center"
                                        >
                                          Apply <ArrowUpRight className="h-2.5 w-2.5" />
                                        </a>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="overflow-x-auto flex-1">
                <Table>
                  <TableHeader className="bg-slate-50 dark:bg-[#0D131F] sticky top-0 z-10 border-b border-slate-200 dark:border-slate-800">
                    <TableRow>
                      <TableHead className="w-10">
                        <input
                          type="checkbox"
                          aria-label="Select all rows"
                          checked={allFilteredSelected}
                          onChange={selectAll}
                          className="accent-emerald-500 rounded"
                        />
                      </TableHead>
                      <TableHead
                        className="w-[100px] cursor-pointer group hover:text-slate-900 dark:hover:text-slate-200 transition-colors text-xs whitespace-nowrap"
                        onClick={() => toggleSort('date')}
                      >
                        Date <SortIcon field="date" />
                      </TableHead>
                      <TableHead
                        className="cursor-pointer group hover:text-slate-900 dark:hover:text-slate-200 transition-colors text-xs"
                        onClick={() => toggleSort('company')}
                      >
                        Company &amp; Role <SortIcon field="company" />
                      </TableHead>
                      <TableHead className="text-xs w-[140px] whitespace-nowrap">
                        Source Lineage
                      </TableHead>
                      <TableHead
                        className="cursor-pointer group hover:text-slate-900 dark:hover:text-slate-200 transition-colors text-xs w-[125px] whitespace-nowrap"
                        onClick={() => toggleSort('score')}
                      >
                        Fit Score <SortIcon field="score" />
                      </TableHead>
                      <TableHead className="text-right text-xs w-[80px] whitespace-nowrap">
                        Reply Est.
                      </TableHead>
                      <TableHead className="text-center text-xs w-[125px] whitespace-nowrap">
                        Stage
                      </TableHead>
                      <TableHead className="text-right text-xs w-[140px] whitespace-nowrap">
                        Actions
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loading ? (
                      Array.from({ length: 5 }).map((_, skIdx) => (
                        <TableRow key={skIdx}>
                          <TableCell colSpan={8} className="py-3.5 px-4">
                            <div className="h-5 bg-slate-200/70 dark:bg-slate-800/50 rounded animate-pulse w-full" />
                          </TableCell>
                        </TableRow>
                      ))
                    ) : error ? (
                      <TableRow>
                        <TableCell
                          colSpan={8}
                          className="h-28 text-center text-xs font-mono text-rose-600 dark:text-rose-400"
                        >
                          {error}
                        </TableCell>
                      </TableRow>
                    ) : filteredJobs.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} className="py-12 text-center">
                          <div className="text-sm font-medium text-slate-900 dark:text-slate-200 mb-1">
                            {viewMode === 'retry'
                              ? 'No deterministic fallback roles pending LLM retry'
                              : 'No matching pipeline records'}
                          </div>
                          <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
                            {viewMode === 'retry'
                              ? 'All persisted roles have completed full LLM evaluation.'
                              : 'Reset your active filters or run a live Direct-ATS sweep.'}
                          </p>
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => {
                              setViewMode('table');
                              setFilter('ALL');
                              setSourceFilter('ALL');
                              setMinScoreFilter(0);
                              setStaleOnly(false);
                              setSearchQuery('');
                            }}
                            className="bg-slate-800 hover:bg-slate-700 text-xs text-white"
                          >
                            Reset Filters
                          </Button>
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredJobs.map((job, idx) => {
                        const prediction = predictReplyLikelihood(job);
                        const stale = isStale(job, slaThresholdDays);
                        const cadence = computeJobFreshnessAndCadence(job);
                        const isSelected = selectedJobIds.has(job.id);
                        const isFocused = focusedRow === idx;
                        const isExpanded = expandedRow === idx;
                        const seenSourcesCount = Array.isArray(job.sourcesSeen)
                          ? job.sourcesSeen.length
                          : 1;

                        return (
                          <React.Fragment key={job.id || job.rowId}>
                            <TableRow
                              className={`cursor-pointer transition-colors border-b border-slate-200/70 dark:border-slate-800/70 ${
                                isFocused ? 'bg-slate-100 dark:bg-slate-800/60' : ''
                              } ${
                                isSelected ? 'bg-emerald-50 dark:bg-emerald-950/20' : ''
                              } hover:bg-slate-50 dark:hover:bg-slate-800/40`}
                              onClick={() => setExpandedRow(isExpanded ? null : idx)}
                            >
                              <TableCell onClick={(e) => e.stopPropagation()} className="py-2.5">
                                <input
                                  type="checkbox"
                                  aria-label={`Select ${job.title} at ${job.company}`}
                                  checked={isSelected}
                                  onChange={() => {
                                    setSelectedJobIds((prev) => {
                                      const next = new Set(prev);
                                      if (next.has(job.id)) next.delete(job.id);
                                      else next.add(job.id);
                                      return next;
                                    });
                                  }}
                                  className="accent-emerald-500 rounded"
                                />
                              </TableCell>
                              <TableCell className="font-mono tabular-nums text-xs text-slate-500 dark:text-slate-400 py-2.5 whitespace-nowrap">
                                {job.date}
                              </TableCell>
                              <TableCell className="py-2.5">
                                <div className="flex items-center gap-2">
                                  {isExpanded ? (
                                    <ChevronDown className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                                  ) : (
                                    <ChevronRight className="h-3.5 w-3.5 text-slate-400 dark:text-slate-500 shrink-0" />
                                  )}
                                  <div className="min-w-0">
                                    <div className="font-medium text-slate-900 dark:text-white text-xs sm:text-sm truncate flex items-center gap-1.5">
                                      <span>{job.company}</span>
                                      <span className="text-slate-400 dark:text-slate-500 font-normal">
                                        ·
                                      </span>
                                      <span className="text-slate-600 dark:text-slate-300 font-normal truncate">
                                        {job.title}
                                      </span>
                                      {job.location && (
                                        <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 shrink-0">
                                          {job.location}
                                        </span>
                                      )}
                                      {job.needsLlmRetry && (
                                        <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-amber-50 text-amber-800 border border-amber-300 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800/60 shrink-0">
                                          Retry Queue
                                        </span>
                                      )}
                                      {cadence.isFollowUpDue && (
                                        <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-blue-50 text-blue-800 border border-blue-200 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800/60 shrink-0">
                                          {cadence.cadenceStage === 'DUE_BUMP_1'
                                            ? 'Bump #1 Due'
                                            : cadence.cadenceStage === 'DUE_BUMP_2'
                                            ? 'Bump #2 Due'
                                            : 'Cooling'}
                                        </span>
                                      )}
                                      {cadence.isStaleNew && (
                                        <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-amber-50 text-amber-800 border border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800/60 shrink-0">
                                          Stale {cadence.ageDays}d
                                        </span>
                                      )}
                                      {job.lastReplyClassification && (
                                        <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-emerald-50 text-emerald-800 border border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800/60 inline-flex items-center gap-0.5 shrink-0">
                                          <MailCheck className="h-2.5 w-2.5" />
                                          {job.lastReplyClassification.replace(/_/g, ' ')}
                                        </span>
                                      )}
                                    </div>
                                    {stale && (
                                      <div
                                        className="text-[11px] text-amber-600 dark:text-amber-400 flex items-center gap-2 mt-0.5"
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        <span className="inline-flex items-center gap-1">
                                          <AlertTriangle className="h-3 w-3" /> SLA Alert:{' '}
                                          {slaThresholdDays}+ days since applied
                                        </span>
                                        <button
                                          type="button"
                                          onClick={() =>
                                            copyText(
                                              `Hi ${job.company} team — circling back politely on my ${job.title} application. Highlighting: ${job.resumeAngle || 'relevant domain execution proof'}. Happy to share any extra context.`,
                                              `nudge_${job.rowId}`
                                            )
                                          }
                                          className="font-mono underline hover:text-amber-700 dark:hover:text-amber-300 cursor-pointer"
                                        >
                                          {copiedId === `nudge_${job.rowId}`
                                            ? 'Nudge Copied'
                                            : 'Copy Nudge'}
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </TableCell>
                              <TableCell className="text-xs font-mono text-slate-500 dark:text-slate-400 py-2.5 whitespace-nowrap">
                                <div className="flex items-center gap-1.5">
                                  <span>{job.source}</span>
                                  {seenSourcesCount > 1 && (
                                    <span
                                      className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800/60"
                                      title={job.sourcesSeen?.map((s) => s.source).join(' · ')}
                                    >
                                      +{seenSourcesCount - 1} merged
                                    </span>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell className="py-2.5">
                                <MetricBar score={job.score} />
                              </TableCell>
                              <TableCell className="text-right font-mono tabular-nums py-2.5 whitespace-nowrap">
                                {prediction >= 0 ? (
                                  <span
                                    className={`text-xs font-semibold ${
                                      prediction >= 65
                                        ? 'text-emerald-600 dark:text-emerald-400'
                                        : prediction >= 40
                                        ? 'text-blue-600 dark:text-blue-400'
                                        : 'text-slate-500 dark:text-slate-400'
                                    }`}
                                  >
                                    {prediction}%
                                  </span>
                                ) : (
                                  <span className="text-xs text-slate-400 dark:text-slate-500">
                                    —
                                  </span>
                                )}
                              </TableCell>
                              <TableCell
                                className="text-center py-2.5"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <div className="relative inline-flex items-center justify-center rounded focus-within:ring-2 focus-within:ring-emerald-500/60">
                                  <select
                                    aria-label="Change job status"
                                    value={job.status}
                                    onChange={(e) => updateStatus(job.rowId, e.target.value)}
                                    className="bg-transparent text-xs uppercase focus:ring-0 cursor-pointer p-1 rounded opacity-0 absolute inset-0 z-20 w-full"
                                  >
                                    {ALL_STATUSES.map((s) => (
                                      <option
                                        className="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-200"
                                        key={s}
                                        value={s}
                                      >
                                        {s}
                                      </option>
                                    ))}
                                  </select>
                                  <div className="relative z-10 inline-flex items-center justify-center">
                                    <StatusBadge status={job.status} />
                                  </div>
                                </div>
                              </TableCell>
                              <TableCell
                                className="text-right py-2.5"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <div className="inline-flex items-center justify-end gap-2">
                                  <button
                                    type="button"
                                    onClick={() => setAuditDrawerJob(job)}
                                    className="px-2 py-1 rounded text-[11px] font-mono bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 inline-flex items-center gap-1 cursor-pointer whitespace-nowrap"
                                    title="Open 4-Pillar Rubric & Outreach Composer"
                                  >
                                    <Layers className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />{' '}
                                    Audit
                                  </button>
                                  <a
                                    href={safeExternalUrl(job.url)}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 whitespace-nowrap"
                                  >
                                    Apply <ArrowUpRight className="h-3 w-3" />
                                  </a>
                                </div>
                              </TableCell>
                            </TableRow>

                            <AnimatePresence>
                              {isExpanded && (
                                <TableRow>
                                  <TableCell colSpan={8} className="p-0 border-0">
                                    <motion.div
                                      initial={{ height: 0, opacity: 0 }}
                                      animate={{ height: 'auto', opacity: 1 }}
                                      exit={{ height: 0, opacity: 0 }}
                                      transition={{ duration: 0.18 }}
                                      className="overflow-hidden"
                                    >
                                      <div className="p-5 pl-11 bg-slate-50 dark:bg-[#0B0F17] border-b border-slate-200 dark:border-slate-800 grid grid-cols-1 lg:grid-cols-12 gap-6">
                                        <div className="lg:col-span-6 space-y-4">
                                          <div>
                                            <div className="flex items-center justify-between mb-1.5">
                                              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                                                Rubric Alignment Breakdown
                                              </span>
                                              <button
                                                type="button"
                                                onClick={() => setAuditDrawerJob(job)}
                                                className="text-[11px] font-mono text-emerald-600 dark:text-emerald-400 hover:underline cursor-pointer"
                                              >
                                                Open Full 4-Pillar &amp; Outreach Composer →
                                              </button>
                                            </div>
                                            <p className="text-xs text-slate-800 dark:text-slate-200 leading-relaxed">
                                              {job.reasons || 'N/A'}
                                            </p>
                                          </div>

                                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-3 border-t border-slate-200 dark:border-slate-800/80">
                                            <div>
                                              <div className="text-xs font-medium text-amber-600 dark:text-amber-400 mb-1">
                                                Risk / Gap Mitigation
                                              </div>
                                              <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                                                {job.gap || 'N/A'}
                                              </p>
                                            </div>
                                            <div>
                                              <div className="flex items-center justify-between mb-1">
                                                <span className="text-xs font-medium text-blue-600 dark:text-blue-400">
                                                  Resume Lead Angle
                                                </span>
                                                {job.resumeAngle && (
                                                  <button
                                                    type="button"
                                                    onClick={() =>
                                                      copyText(
                                                        job.resumeAngle,
                                                        `angle_${job.rowId}`
                                                      )
                                                    }
                                                    className="text-[11px] text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white inline-flex items-center gap-1 cursor-pointer"
                                                  >
                                                    {copiedId === `angle_${job.rowId}` ? (
                                                      <>
                                                        <Check className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />{' '}
                                                        Copied
                                                      </>
                                                    ) : (
                                                      <>
                                                        <Copy className="h-3 w-3" /> Copy
                                                      </>
                                                    )}
                                                  </button>
                                                )}
                                              </div>
                                              <p className="text-xs text-slate-700 dark:text-slate-300 font-mono leading-relaxed">
                                                {job.resumeAngle || 'N/A'}
                                              </p>
                                            </div>
                                          </div>
                                        </div>

                                        <div className="lg:col-span-6 lg:border-l border-t lg:border-t-0 border-slate-200 dark:border-slate-800 pt-4 lg:pt-0 lg:pl-6 flex flex-col justify-between">
                                          <div>
                                            <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                                              <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
                                                Outreach DM Draft (LinkedIn / Cold Note)
                                              </span>
                                              <div className="flex items-center gap-2">
                                                {editingDmRowId === job.rowId ? (
                                                  <Button
                                                    type="button"
                                                    size="sm"
                                                    onClick={() => saveInlineDm(job.rowId)}
                                                    className="h-7 px-2.5 text-xs bg-emerald-600 hover:bg-emerald-500 text-white"
                                                  >
                                                    Save Draft
                                                  </Button>
                                                ) : (
                                                  <button
                                                    type="button"
                                                    onClick={() => {
                                                      setEditingDmRowId(job.rowId);
                                                      setDraftDmText(job.dm);
                                                    }}
                                                    className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white cursor-pointer"
                                                  >
                                                    Edit
                                                  </button>
                                                )}
                                                {job.dm && (
                                                  <>
                                                    <button
                                                      type="button"
                                                      onClick={() =>
                                                        copyText(job.dm, `dm_${job.rowId}`)
                                                      }
                                                      className="px-2.5 py-1 rounded text-xs bg-slate-200/80 dark:bg-slate-800 hover:bg-slate-300/80 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 inline-flex items-center gap-1 cursor-pointer"
                                                    >
                                                      {copiedId === `dm_${job.rowId}` ? (
                                                        <>
                                                          <Check className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />{' '}
                                                          Copied
                                                        </>
                                                      ) : (
                                                        <>
                                                          <Copy className="h-3 w-3" /> Copy DM
                                                        </>
                                                      )}
                                                    </button>
                                                    <button
                                                      type="button"
                                                      onClick={() =>
                                                        copyText(
                                                          `Subject: ${job.title} @ ${job.company} — Application & Impact Summary\n\nHi ${job.company} team,\n\n${job.dm}${
                                                            job.resumeAngle
                                                              ? `\n\nKey angle: ${job.resumeAngle}`
                                                              : ''
                                                          }\n`,
                                                          `email_${job.rowId}`
                                                        )
                                                      }
                                                      className="px-2.5 py-1 rounded text-xs bg-slate-200/80 dark:bg-slate-800 hover:bg-slate-300/80 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 inline-flex items-center gap-1 cursor-pointer"
                                                    >
                                                      {copiedId === `email_${job.rowId}` ? (
                                                        <>
                                                          <Check className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />{' '}
                                                          Copied
                                                        </>
                                                      ) : (
                                                        <>
                                                          <Copy className="h-3 w-3" /> Copy Cold Email
                                                        </>
                                                      )}
                                                    </button>
                                                  </>
                                                )}
                                              </div>
                                            </div>

                                            {editingDmRowId === job.rowId ? (
                                              <textarea
                                                rows={3}
                                                value={draftDmText}
                                                onChange={(e) => setDraftDmText(e.target.value)}
                                                className="w-full bg-white dark:bg-[#111827] border border-slate-300 dark:border-slate-700 rounded p-2.5 text-xs text-slate-900 dark:text-slate-200 focus:outline-none focus:border-emerald-500"
                                              />
                                            ) : (
                                              <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                                                {job.dm || 'No DM draft generated.'}
                                              </p>
                                            )}
                                          </div>
                                        </div>
                                      </div>
                                    </motion.div>
                                  </TableCell>
                                </TableRow>
                              )}
                            </AnimatePresence>
                          </React.Fragment>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
