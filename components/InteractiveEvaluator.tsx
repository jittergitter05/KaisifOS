'use client';
import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { Play, Copy, Check, Plus, RefreshCw, BookOpen, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { copyToClipboardSafe } from '@/lib/utils';

interface EvaluationResult {
  score: number;
  subscores: {
    role_match: number;
    skill_match?: number;
    seniority_match?: number;
    comp_geo_match?: number;
    experience_match: number;
    location_match: number;
    salary_match: number;
    relocation_bonus: number;
  };
  matched_skills: string[];
  missing_skills: string[];
  match_reasons: string[];
  gap: string;
  dm_draft: string;
  cold_email_subject: string;
  cold_email_body: string;
  outreach_tones?: {
    warm_founder: string;
    direct_metric: string;
    peer_builder: string;
  };
  resume_angle: string;
  relocation_note: string;
  engine_used: string;
  fallback_chain_status?: {
    gemini: string;
    groq: string;
    openrouter: string;
    deterministic: string;
  };
}

interface PrepPack {
  tailored_bullets: string[];
  screening_questions: Array<{ question: string; answer_framework: string }>;
  follow_up_sequence: { day_3_nudge: string; day_7_value_add: string };
  engine_used: string;
}

const DEFAULT_METRIC_1 = 'Delivered measurable growth across core product & engineering KPIs';
const DEFAULT_METRIC_2 = 'Scaled conversion velocity and organic acquisition';
const DEFAULT_PORTFOLIO = 'https://your-portfolio.com';

const PRESETS = [
  {
    label: 'APM / PMM (Visa)',
    title: 'Associate Product Marketing Manager',
    company: 'Raycast',
    location: 'London, UK / Remote (Visa Sponsored)',
    salary: '$52,000 USD',
    url: 'https://boards.greenhouse.io/raycast/jobs/associate-pmm',
    description:
      'Entry-level Associate Product Marketing Manager to own developer product launches, SEO content growth, and community GTM across Reddit, Discord, and X. 0-1 years experience welcome for builders who analyze funnels in GA4 and Google Search Console. Full UK visa sponsorship included.',
  },
  {
    label: 'AI Growth (Bengaluru)',
    title: 'Associate Product Manager — Growth & AI',
    company: 'Sarvam AI',
    location: 'Bengaluru, India',
    salary: '₹14 LPA',
    url: 'https://jobs.lever.co/sarvam/associate-pm-growth',
    description:
      'Looking for a high-agency builder to drive user acquisition, organic search growth, and AI workflow experiments. Hands-on experience with Python, analytics, and SEO required.',
  },
  {
    label: 'Founder’s Associate (Dubai)',
    title: "Founder's Associate — GTM & Strategy",
    company: 'Careem',
    location: 'Dubai, UAE (Relocation Provided)',
    salary: '$48,000 USD',
    url: 'https://jobs.ashbyhq.com/careem/founders-associate-gtm',
    description:
      'Work directly with leadership on 0-to-1 product marketing, growth operations, and data pipelines. Ideal for an early-career generalist with proven growth metrics and workflow automation skills.',
  },
  {
    label: 'Seniority Guardrail (6+ Yrs)',
    title: 'Senior Director of Product Marketing',
    company: 'LegacyCorp',
    location: 'New York (No Visa Sponsorship)',
    salary: '$140,000 USD',
    url: 'https://boards.greenhouse.io/legacycorp/jobs/senior-director-pmm',
    description:
      'Requires 6+ years of enterprise B2B SaaS management experience leading a team of 10+ PMMs. Candidates with less than 5 years of full-time experience will not be considered.',
  },
];

function buildPreviewResult(
  name: string,
  metric1: string,
  metric2: string,
  portfolio: string
): EvaluationResult {
  return {
    score: 96,
    subscores: {
      role_match: 38,
      skill_match: 28,
      seniority_match: 15,
      comp_geo_match: 15,
      experience_match: 25,
      location_match: 20,
      salary_match: 15,
      relocation_bonus: 0,
    },
    matched_skills: ['GTM Strategy', 'Product Marketing', 'SEO', 'GA4'],
    missing_skills: ['macOS Native SDK'],
    match_reasons: [
      'Matches target role track (38/40 Role)',
      'Aligned with candidate skill & proof metrics (28/30 Skill)',
      'Calibrated seniority (15/15 Seniority) & compensation/relocation fit (15/15 Comp/Geo)',
    ],
    gap: 'Lead with shipped product velocity and funnel experiments.',
    dm_draft: `Hi ${PRESETS[0].company} team — I saw the ${PRESETS[0].title} role and wanted to reach out directly. Recently I ${metric1} and ${metric2}. Would love to bring that execution velocity to ${PRESETS[0].company}.`,
    cold_email_subject: `${PRESETS[0].title} @ ${PRESETS[0].company} — ${metric2}`,
    cold_email_body: `Hi ${PRESETS[0].company} team,\n\nI'm ${name} applying for the ${PRESETS[0].title} role.\n\nRecent outcomes:\n• ${metric1}\n• ${metric2}\n\nPortfolio: ${portfolio}\n\nBest,\n${name}`,
    resume_angle: `Lead with "${metric2}" and "${metric1}"`,
    relocation_note: 'Visa sponsorship verified in role description',
    engine_used: '4-Tier Free Multi-LLM Chain',
  };
}

export default function InteractiveEvaluator({
  onRoleCommitted,
  ownerName: initialOwnerName,
  ownerMetrics: initialMetrics,
  ownerPortfolio: initialPortfolio,
}: {
  onRoleCommitted?: () => void;
  ownerName?: string;
  ownerMetrics?: string[];
  ownerPortfolio?: string;
}) {
  const [ownerName, setOwnerName] = useState(initialOwnerName || 'Active Candidate');
  const [topMetric, setTopMetric] = useState(initialMetrics?.[0] || DEFAULT_METRIC_1);
  const [secondMetric, setSecondMetric] = useState(initialMetrics?.[1] || DEFAULT_METRIC_2);
  const [portfolioUrl, setPortfolioUrl] = useState(initialPortfolio || DEFAULT_PORTFOLIO);

  const [activePreset, setActivePreset] = useState(0);
  const [title, setTitle] = useState(PRESETS[0].title);
  const [company, setCompany] = useState(PRESETS[0].company);
  const [location, setLocation] = useState(PRESETS[0].location);
  const [salary, setSalary] = useState(PRESETS[0].salary);
  const [description, setDescription] = useState(PRESETS[0].description);
  const [url, setUrl] = useState(PRESETS[0].url);

  const [evaluating, setEvaluating] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [committed, setCommitted] = useState(false);
  const [copiedTab, setCopiedTab] = useState<'dm' | 'email' | 'prep' | null>(null);
  const [outreachMode, setOutreachMode] = useState<'dm' | 'email' | 'prep'>('dm');
  const [dmTone, setDmTone] = useState<'warm_founder' | 'direct_metric' | 'peer_builder'>(
    'direct_metric'
  );
  const [prepPack, setPrepPack] = useState<PrepPack | null>(null);
  const [loadingPrep, setLoadingPrep] = useState(false);
  const [evalError, setEvalError] = useState<{ message: string; needsAuth?: boolean } | null>(null);
  const [prepError, setPrepError] = useState<{ message: string; needsAuth?: boolean } | null>(null);
  const [commitError, setCommitError] = useState<{ message: string; needsAuth?: boolean } | null>(null);
  const hasEvaluatedRef = useRef(false);

  const [result, setResult] = useState<EvaluationResult>(() =>
    buildPreviewResult(
      initialOwnerName || 'Active Candidate',
      initialMetrics?.[0] || DEFAULT_METRIC_1,
      initialMetrics?.[1] || DEFAULT_METRIC_2,
      initialPortfolio || DEFAULT_PORTFOLIO
    )
  );

  const propMetric1 = initialMetrics?.[0] || '';
  const propMetric2 = initialMetrics?.[1] || '';

  useEffect(() => {
    if (initialOwnerName) {
      const m1 = propMetric1 || DEFAULT_METRIC_1;
      const m2 = propMetric2 || DEFAULT_METRIC_2;
      const pf = initialPortfolio || DEFAULT_PORTFOLIO;
      setOwnerName(initialOwnerName);
      setTopMetric(m1);
      setSecondMetric(m2);
      setPortfolioUrl(pf);
      setCommitted(false);
      setPrepPack(null);
      if (!hasEvaluatedRef.current) {
        setResult(buildPreviewResult(initialOwnerName, m1, m2, pf));
      }
      return;
    }

    let cancelled = false;
    fetch('/api/profile?public=true')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d) return;
        const resolvedName = d.name || 'Active Candidate';
        const resolvedM1 = d.key_metrics?.[0] || DEFAULT_METRIC_1;
        const resolvedM2 = d.key_metrics?.[1] || DEFAULT_METRIC_2;
        const resolvedPortfolio = d.portfolio || DEFAULT_PORTFOLIO;
        setOwnerName(resolvedName);
        setTopMetric(resolvedM1);
        setSecondMetric(resolvedM2);
        setPortfolioUrl(resolvedPortfolio);
        if (!hasEvaluatedRef.current) {
          setResult(
            buildPreviewResult(resolvedName, resolvedM1, resolvedM2, resolvedPortfolio)
          );
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [initialOwnerName, propMetric1, propMetric2, initialPortfolio]);

  const applyPreset = (idx: number) => {
    const p = PRESETS[idx];
    setActivePreset(idx);
    setTitle(p.title);
    setCompany(p.company);
    setLocation(p.location);
    setSalary(p.salary);
    setDescription(p.description);
    setUrl(p.url);
    setCommitted(false);
    setPrepPack(null);
    setCommitError(null);
    setPrepError(null);
    runEvaluation({
      title: p.title,
      company: p.company,
      location: p.location,
      salary: p.salary,
      description: p.description,
    });
  };

  const runEvaluation = async (override?: {
    title: string;
    company: string;
    location: string;
    salary: string;
    description: string;
  }) => {
    setEvaluating(true);
    setCommitted(false);
    setEvalError(null);
    setCommitError(null);
    try {
      const payload = override || { title, company, location, salary, description };
      const res = await fetch('/api/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.status === 401) {
        setEvalError({
          message: 'Sign in required to run live AI evaluation against your profile.',
          needsAuth: true,
        });
        return;
      }
      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        setEvalError({
          message: errData?.error || `Evaluation failed (HTTP ${res.status}).`,
        });
        return;
      }
      const data = await res.json();
      hasEvaluatedRef.current = true;
      setResult(data);
    } catch {
      setEvalError({ message: 'Network error while evaluating role fit.' });
    } finally {
      setEvaluating(false);
    }
  };

  const generatePrep = async () => {
    setOutreachMode('prep');
    if (prepPack) return;
    setLoadingPrep(true);
    setPrepError(null);
    try {
      const res = await fetch('/api/prep', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          company,
          reasons: result.match_reasons.join(' | '),
          gap: result.gap,
          description,
        }),
      });
      if (res.status === 401) {
        setPrepError({
          message: 'Sign in required to generate role-specific STAR prep notes.',
          needsAuth: true,
        });
        return;
      }
      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        setPrepError({
          message: errData?.error || `Unable to build prep notes (HTTP ${res.status}).`,
        });
        return;
      }
      setPrepPack(await res.json());
    } catch {
      setPrepError({ message: 'Network error while generating interview prep.' });
    } finally {
      setLoadingPrep(false);
    }
  };

  const commitToTracker = async () => {
    setCommitting(true);
    setCommitError(null);
    try {
      const res = await fetch('/api/sheet-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'append',
          job: {
            id: `eval_${Date.now()}`,
            title,
            company,
            score: result.score,
            reasons: result.match_reasons.join(' | '),
            gap: result.gap,
            url: url.trim() || portfolioUrl,
            dm: result.dm_draft,
            resumeAngle: result.resume_angle || `Lead with ${topMetric}`,
            status: result.score >= 90 ? 'SHORTLISTED' : 'NEW',
          },
        }),
      });
      if (res.status === 401) {
        setCommitError({
          message: 'Sign in required to save roles into the tracking pipeline.',
          needsAuth: true,
        });
        return;
      }
      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        setCommitError({
          message: errData?.error || `Save to pipeline failed (HTTP ${res.status}).`,
        });
        return;
      }
      setCommitted(true);
      if (onRoleCommitted) onRoleCommitted();
    } catch {
      setCommitError({ message: 'Network error while saving role to pipeline.' });
    } finally {
      setCommitting(false);
    }
  };

  const handleCopy = async (text: string, type: 'dm' | 'email' | 'prep') => {
    const ok = await copyToClipboardSafe(text);
    if (ok) {
      setCopiedTab(type);
      setTimeout(() => setCopiedTab(null), 1800);
    }
  };

  return (
    <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
      <div className="px-6 py-3.5 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 bg-slate-50 dark:bg-[#0D131F]">
        <div className="text-xs text-slate-600 dark:text-slate-300">
          Presets · Calibrated for{' '}
          <strong className="text-slate-900 dark:text-white">{ownerName}</strong>
        </div>
        <div className="flex items-center gap-1 p-1 bg-white dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded-md overflow-x-auto hide-scrollbar">
          {PRESETS.map((p, idx) => (
            <button
              key={p.label}
              type="button"
              onClick={() => applyPreset(idx)}
              className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activePreset === idx
                  ? 'bg-emerald-600 text-white'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-slate-200 dark:divide-slate-800">
        <div className="lg:col-span-5 p-6 space-y-3.5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                Role Title
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded-md px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                Company
              </label>
              <input
                type="text"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                className="w-full bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded-md px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                Location
              </label>
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className="w-full bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded-md px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                Compensation
              </label>
              <input
                type="text"
                value={salary}
                onChange={(e) => setSalary(e.target.value)}
                className="w-full bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded-md px-3 py-2 text-xs text-slate-900 dark:text-slate-100 font-mono tabular-nums focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
              Job URL{' '}
              <span className="text-slate-500 font-normal">(optional)</span>
            </label>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://boards.greenhouse.io/company/jobs/123"
              className="w-full bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded-md px-3 py-2 text-xs font-mono text-slate-800 dark:text-slate-200 focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
              Job Description
            </label>
            <textarea
              rows={5}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded-md p-3 text-xs text-slate-800 dark:text-slate-200 leading-relaxed focus:outline-none focus:border-emerald-500 resize-none"
            />
          </div>

          {(evalError || commitError) && (
            <div className="bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/70 text-rose-800 dark:text-rose-200 rounded-md px-3 py-2 text-xs flex items-start justify-between gap-2">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-3.5 w-3.5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                <span>{(evalError || commitError)?.message}</span>
              </div>
              {(evalError || commitError)?.needsAuth && (
                <Link
                  href="/login"
                  className="text-emerald-600 dark:text-emerald-400 hover:underline font-mono whitespace-nowrap shrink-0"
                >
                  Sign In →
                </Link>
              )}
            </div>
          )}

          <div className="flex items-center gap-2.5 pt-1">
            <Button
              type="button"
              onClick={() => runEvaluation()}
              disabled={evaluating}
              className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium py-2 px-4 whitespace-nowrap shrink-0"
            >
              {evaluating ? (
                <>
                  <RefreshCw className="h-3.5 w-3.5 mr-2 animate-spin" /> Scoring...
                </>
              ) : (
                <>
                  <Play className="h-3.5 w-3.5 mr-1.5" /> Score Role
                </>
              )}
            </Button>

            <Button
              type="button"
              variant="outline"
              onClick={commitToTracker}
              disabled={committing || committed}
              className="bg-slate-50 dark:bg-[#0B0F17] border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200 text-xs font-medium py-2 px-3.5 whitespace-nowrap shrink-0"
            >
              {committed ? (
                <>
                  <Check className="h-3.5 w-3.5 mr-1.5 text-emerald-600 dark:text-emerald-400" />{' '}
                  Saved
                </>
              ) : (
                <>
                  <Plus className="h-3.5 w-3.5 mr-1.5" /> Save to Pipeline
                </>
              )}
            </Button>
          </div>
        </div>

        <div className="lg:col-span-7 p-6 space-y-5 bg-slate-50/70 dark:bg-[#0E1422]">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800/80">
            <div>
              <div className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                {result.engine_used}
              </div>
              <div className="flex items-baseline gap-2.5 mt-1">
                <span
                  className={`text-3xl font-mono font-bold tabular-nums ${
                    result.score >= 90
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : result.score >= 75
                      ? 'text-blue-600 dark:text-blue-400'
                      : 'text-amber-600 dark:text-amber-400'
                  }`}
                >
                  {result.score}
                </span>
                <span className="text-xs font-mono text-slate-500 tabular-nums">/ 100</span>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  · {result.score >= 90 ? 'High Fit' : result.score >= 70 ? 'Moderate Fit' : 'Low Fit'}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-4 gap-3 bg-white dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded-md p-2.5 shrink-0">
              <div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">Role</div>
                <div className="text-xs font-mono font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
                  {result.subscores.role_match}/40
                </div>
              </div>
              <div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">Skill</div>
                <div className="text-xs font-mono font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
                  {result.subscores.skill_match ?? result.subscores.experience_match}/30
                </div>
              </div>
              <div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">Seniority</div>
                <div className="text-xs font-mono font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
                  {result.subscores.seniority_match ?? Math.min(15, result.subscores.location_match)}
                  /15
                </div>
              </div>
              <div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">Comp</div>
                <div className="text-xs font-mono font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
                  {result.subscores.comp_geo_match ?? result.subscores.salary_match}/15
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div>
              <h4 className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5">
                Fit Signals
              </h4>
              <ul className="space-y-1.5 text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                {result.match_reasons.map((r, i) => (
                  <li key={i} className="flex items-baseline gap-2">
                    <span className="font-mono text-emerald-600 dark:text-emerald-400 tabular-nums">
                      0{i + 1}.
                    </span>
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="space-y-2.5">
              <div>
                <h4 className="text-xs font-medium text-amber-600 dark:text-amber-400 mb-1">
                  Gap & Mitigation
                </h4>
                <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                  {result.gap}
                </p>
              </div>
              <div className="text-xs text-slate-600 dark:text-slate-400">
                <span className="text-slate-900 dark:text-slate-200 font-medium">
                  Matched Skills:
                </span>{' '}
                {result.matched_skills.join(' · ') || 'None detected'}
              </div>
              {result.missing_skills.length > 0 && (
                <div className="text-xs text-slate-600 dark:text-slate-400">
                  <span className="text-amber-700 dark:text-amber-300 font-medium">
                    Gap Skills:
                  </span>{' '}
                  {result.missing_skills.join(' · ')}
                </div>
              )}
            </div>
          </div>

          {result.fallback_chain_status && (
            <div className="border-t border-slate-200 dark:border-slate-800/80 pt-3 text-[11px] font-mono text-slate-500 dark:text-slate-400 flex flex-wrap gap-x-4 gap-y-1">
              <span>
                Gemini:{' '}
                <strong className="text-slate-800 dark:text-slate-200">
                  {result.fallback_chain_status.gemini}
                </strong>
              </span>
              <span>
                Groq:{' '}
                <strong className="text-slate-800 dark:text-slate-200">
                  {result.fallback_chain_status.groq}
                </strong>
              </span>
              <span>
                OpenRouter:{' '}
                <strong className="text-slate-800 dark:text-slate-200">
                  {result.fallback_chain_status.openrouter}
                </strong>
              </span>
              <span>
                Rubric:{' '}
                <strong className="text-emerald-600 dark:text-emerald-400">
                  {result.fallback_chain_status.deterministic}
                </strong>
              </span>
            </div>
          )}

          <div className="border-t border-slate-200 dark:border-slate-800/80 pt-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
              <div className="flex items-center gap-1 p-1 bg-white dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded-md w-fit">
                <button
                  type="button"
                  onClick={() => setOutreachMode('dm')}
                  className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    outreachMode === 'dm'
                      ? 'bg-slate-200 dark:bg-slate-800 text-slate-900 dark:text-white'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  LinkedIn DM
                </button>
                <button
                  type="button"
                  onClick={() => setOutreachMode('email')}
                  className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    outreachMode === 'email'
                      ? 'bg-slate-200 dark:bg-slate-800 text-slate-900 dark:text-white'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                  }`}
                >
                  Cold Email
                </button>
                <button
                  type="button"
                  onClick={generatePrep}
                  className={`px-2.5 py-1 text-xs font-medium rounded transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer ${
                    outreachMode === 'prep'
                      ? 'bg-emerald-600 text-white'
                      : 'text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300'
                  }`}
                >
                  <BookOpen className="h-3 w-3" /> Interview Prep
                </button>
              </div>

              {outreachMode !== 'prep' && (
                <button
                  type="button"
                  onClick={() => {
                    const activeDm =
                      (result.outreach_tones && result.outreach_tones[dmTone]) || result.dm_draft;
                    handleCopy(
                      outreachMode === 'dm'
                        ? activeDm
                        : `Subject: ${result.cold_email_subject}\n\n${result.cold_email_body}`,
                      outreachMode
                    );
                  }}
                  className="px-2.5 py-1 text-xs font-medium bg-slate-200/80 dark:bg-slate-800 hover:bg-slate-300/80 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 rounded inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {copiedTab === outreachMode ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />{' '}
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" /> Copy
                    </>
                  )}
                </button>
              )}
            </div>

            {outreachMode === 'dm' && (
              <div className="bg-white dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded-md p-3.5 text-xs text-slate-700 dark:text-slate-200 space-y-2.5 leading-relaxed">
                {result.outreach_tones && (
                  <div className="flex flex-wrap items-center gap-1.5 pb-2 border-b border-slate-200 dark:border-slate-800">
                    {[
                      { id: 'direct_metric', label: 'Direct Metric' },
                      { id: 'warm_founder', label: 'Warm Founder' },
                      { id: 'peer_builder', label: 'Peer Builder' },
                    ].map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setDmTone(t.id as typeof dmTone)}
                        className={`px-2 py-0.5 text-[11px] font-mono rounded transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                          dmTone === t.id
                            ? 'bg-emerald-600 text-white'
                            : 'bg-slate-100 dark:bg-slate-800/70 text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                        }`}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                )}
                <div>
                  {(result.outreach_tones && result.outreach_tones[dmTone]) || result.dm_draft}
                </div>
              </div>
            )}

            {outreachMode === 'email' && (
              <div className="bg-white dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded-md p-3.5 text-xs text-slate-700 dark:text-slate-200 space-y-2 leading-relaxed">
                <div className="font-mono text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800 pb-1.5">
                  Subject:{' '}
                  <span className="text-slate-900 dark:text-slate-100">
                    {result.cold_email_subject}
                  </span>
                </div>
                <pre className="whitespace-pre-wrap font-sans text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                  {result.cold_email_body}
                </pre>
              </div>
            )}

            {outreachMode === 'prep' && (
              <div className="bg-white dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded-md p-3.5 text-xs space-y-3">
                {loadingPrep ? (
                  <div className="py-4 text-center text-slate-500 dark:text-slate-400 font-mono flex items-center justify-center gap-2">
                    <RefreshCw className="h-4 w-4 animate-spin text-emerald-500 dark:text-emerald-400" />{' '}
                    Building prep notes...
                  </div>
                ) : prepError ? (
                  <div className="py-2 flex items-center justify-between gap-2 text-rose-600 dark:text-rose-300 font-mono text-xs">
                    <span>{prepError.message}</span>
                    {prepError.needsAuth && (
                      <Link
                        href="/login"
                        className="text-emerald-600 dark:text-emerald-400 hover:underline shrink-0"
                      >
                        Sign In →
                      </Link>
                    )}
                  </div>
                ) : prepPack ? (
                  <>
                    <div>
                      <div className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 mb-1">
                        STAR Resume Bullets
                      </div>
                      <ul className="space-y-1 text-slate-700 dark:text-slate-200 leading-relaxed">
                        {prepPack.tailored_bullets.map((b, i) => (
                          <li key={i}>• {b}</li>
                        ))}
                      </ul>
                    </div>
                    <div className="border-t border-slate-200 dark:border-slate-800 pt-2.5 space-y-2.5">
                      <div className="text-xs font-semibold text-blue-600 dark:text-blue-400">
                        Screening Q&A
                      </div>
                      <div className="divide-y divide-slate-200 dark:divide-slate-800">
                        {prepPack.screening_questions.map((q, i) => (
                          <div key={i} className="py-2 first:pt-0 last:pb-0">
                            <div className="font-medium text-slate-900 dark:text-white">
                              Q{i + 1}: {q.question}
                            </div>
                            <div className="text-slate-600 dark:text-slate-300 mt-1">
                              {q.answer_framework}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                ) : null}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
