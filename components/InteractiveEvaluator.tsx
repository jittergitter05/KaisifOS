'use client';
import React, { useState, useEffect } from 'react';
import { Play, Copy, Check, Plus, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface EvaluationResult {
  score: number;
  subscores: {
    role_match: number;
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
  resume_angle: string;
  relocation_note: string;
  engine_used: string;
}

const PRESETS = [
  {
    label: 'APM / PMM (Visa Sponsored)',
    title: 'Associate Product Marketing Manager',
    company: 'Raycast',
    location: 'London, UK / Remote (Visa & Relocation Provided)',
    salary: '$52,000 USD + Relocation Stipend',
    description:
      'Entry-level Associate Product Marketing Manager to own developer product launches, SEO content growth, and community GTM across Reddit, Discord, and X. 0-1 years experience welcome for builders who have shipped AI tooling and can analyze funnels in GA4 and Google Search Console. Full UK visa sponsorship and relocation package included.',
  },
  {
    label: 'AI Growth / Product (Bengaluru)',
    title: 'Associate Product Manager — Growth & AI',
    company: 'Sarvam AI',
    location: 'Bengaluru, India',
    salary: '₹14 LPA',
    description:
      'Looking for a high-agency builder to drive user acquisition, organic search growth, and AI workflow experiments. Must have hands-on experience with Python, analytics, SEO, and rapid prototyping.',
  },
  {
    label: 'Founder’s Associate (Dubai Relo)',
    title: "Founder's Associate — GTM & Strategy",
    company: 'Careem',
    location: 'Dubai, UAE (Housing & Relocation Provided)',
    salary: '$48,000 USD Tax-Free',
    description:
      'Work directly with leadership on 0-to-1 product marketing, growth operations, and data pipelines. Ideal for an early-career generalist with proven growth metrics, workflow automation skills, and willingness to relocate to UAE with full company accommodation.',
  },
  {
    label: 'Seniority Guardrail Test (6+ Yrs)',
    title: 'Senior Director of Product Marketing',
    company: 'LegacyCorp',
    location: 'New York (No Visa Sponsorship)',
    salary: '$140,000 USD',
    description:
      'Requires 6+ years of enterprise B2B SaaS management experience leading a team of 10+ PMMs. Candidates with less than 5 years of full-time experience will not be considered. No relocation or visa sponsorship available.',
  },
];

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
  const [activePreset, setActivePreset] = useState(0);
  const [title, setTitle] = useState(PRESETS[0].title);
  const [company, setCompany] = useState(PRESETS[0].company);
  const [location, setLocation] = useState(PRESETS[0].location);
  const [salary, setSalary] = useState(PRESETS[0].salary);
  const [description, setDescription] = useState(PRESETS[0].description);
  const [url, setUrl] = useState('https://remoteok.com/remote-jobs/raycast-associate-pmm');

  const [evaluating, setEvaluating] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [committed, setCommitted] = useState(false);
  const [copiedTab, setCopiedTab] = useState<'dm' | 'email' | null>(null);
  const [outreachMode, setOutreachMode] = useState<'dm' | 'email'>('dm');

  const topMetric = initialMetrics?.[0] || '~425% organic search growth';
  const secondMetric = initialMetrics?.[1] || '~1,466% product page view growth';
  const portfolioUrl = initialPortfolio || 'https://portjitterglitter.vercel.app';

  const [result, setResult] = useState<EvaluationResult>({
    score: 96,
    subscores: {
      role_match: 38,
      experience_match: 25,
      location_match: 20,
      salary_match: 14,
      relocation_bonus: 5,
    },
    matched_skills: ['GTM Strategy', 'Product Marketing', 'SEO', 'GA4', 'AI tooling'],
    missing_skills: ['macOS Native SDK'],
    match_reasons: [
      'Direct alignment with target role whitelist (38/40 role score)',
      'Calibrated for candidate seniority & verified shipping proof (25/25 exp score)',
      'Full UK visa sponsorship and relocation stipend meets global criteria (20/20 geo + 5 bonus)',
    ],
    gap: 'Emphasize hands-on shipping velocity and quantitative funnel experimentation during screening.',
    dm_draft: `Hi Raycast team — I noticed the Associate Product Marketing Manager opening and wanted to reach out directly. In my recent work, I drove ${topMetric} and ${secondMetric} by combining technical execution, analytics, and community distribution. I'd love to bring that exact 0-to-1 launch velocity to Raycast.`,
    cold_email_subject: `Associate Product Marketing Manager @ Raycast — ${secondMetric}`,
    cold_email_body: `Hi Raycast team,\n\nI'm ${initialOwnerName || 'applying'} for the Associate Product Marketing Manager role.\n\nKey highlights from my recent work:\n• ${topMetric}\n• ${secondMetric}\n\nPortfolio & case studies: ${portfolioUrl}\n\nBest regards,\n${initialOwnerName || 'Candidate'}`,
    resume_angle: `Lead summary with "${secondMetric}" and "${topMetric}"`,
    relocation_note: 'Explicit visa sponsorship and relocation package verified in specification',
    engine_used: 'Deterministic Multi-Vector Rubric v2.5',
  });

  useEffect(() => {
    if (initialOwnerName) {
      setOwnerName(initialOwnerName);
    } else {
      fetch('/api/profile?public=true')
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (d?.name) setOwnerName(d.name);
        })
        .catch(() => {});
    }
  }, [initialOwnerName]);

  const applyPreset = (idx: number) => {
    const p = PRESETS[idx];
    setActivePreset(idx);
    setTitle(p.title);
    setCompany(p.company);
    setLocation(p.location);
    setSalary(p.salary);
    setDescription(p.description);
    setCommitted(false);
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
    try {
      const payload = override || { title, company, location, salary, description };
      const res = await fetch('/api/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const data = await res.json();
        setResult(data);
      }
    } catch (e) {
      console.error('Evaluation error:', e);
    } finally {
      setEvaluating(false);
    }
  };

  const commitToTracker = async () => {
    setCommitting(true);
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
            url: url || portfolioUrl,
            dm: result.dm_draft,
            resumeAngle: result.resume_angle,
            status: result.score >= 90 ? 'SHORTLISTED' : 'NEW',
          },
        }),
      });
      if (res.ok) {
        setCommitted(true);
        if (onRoleCommitted) onRoleCommitted();
      }
    } catch (e) {
      console.error('Commit failed:', e);
    } finally {
      setCommitting(false);
    }
  };

  const handleCopy = (text: string, type: 'dm' | 'email') => {
    navigator.clipboard.writeText(text);
    setCopiedTab(type);
    setTimeout(() => setCopiedTab(null), 1800);
  };

  return (
    <div className="bg-[#111827] border border-slate-800 rounded-xl overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4 bg-[#0D131F]">
        <div>
          <div className="text-xs text-slate-400">
            Interactive Scoring & Synthesis Workbench · Calibrated for:{' '}
            <span className="font-semibold text-emerald-400">{ownerName}</span>
          </div>
          <h3 className="text-base font-display font-semibold text-white mt-0.5">
            Live 4-Pillar Rubric & Cold Outreach Synthesizer
          </h3>
        </div>
        <div className="flex items-center gap-1.5 p-1 bg-slate-900 border border-slate-800 rounded-lg overflow-x-auto hide-scrollbar">
          {PRESETS.map((p, idx) => (
            <button
              key={p.label}
              type="button"
              onClick={() => applyPreset(idx)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activePreset === idx
                  ? 'bg-emerald-600 text-white'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-slate-800">
        <div className="lg:col-span-5 p-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Role Title</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full bg-[#0B0F17] border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Company</label>
              <input
                type="text"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                className="w-full bg-[#0B0F17] border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">
                Location & Relocation Terms
              </label>
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className="w-full bg-[#0B0F17] border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">
                Listed Compensation
              </label>
              <input
                type="text"
                value={salary}
                onChange={(e) => setSalary(e.target.value)}
                className="w-full bg-[#0B0F17] border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 font-mono tabular-nums focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">
              Application URL (Optional)
            </label>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://..."
              className="w-full bg-[#0B0F17] border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-300 font-mono focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">
              Raw Job Description / Requirements
            </label>
            <textarea
              rows={5}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full bg-[#0B0F17] border border-slate-800 rounded-lg p-3 text-xs text-slate-200 leading-relaxed focus:outline-none focus:border-emerald-500 resize-none"
            />
          </div>

          <div className="flex items-center gap-3 pt-1">
            <Button
              type="button"
              onClick={() => runEvaluation()}
              disabled={evaluating}
              className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium py-2 px-4 whitespace-nowrap shrink-0"
            >
              {evaluating ? (
                <>
                  <RefreshCw className="h-3.5 w-3.5 mr-2 animate-spin" /> Evaluating Fit...
                </>
              ) : (
                <>
                  <Play className="h-3.5 w-3.5 mr-2" /> Evaluate Against {ownerName.split(' ')[0]}&apos;s Profile
                </>
              )}
            </Button>

            <Button
              type="button"
              variant="outline"
              onClick={commitToTracker}
              disabled={committing || committed}
              className="bg-slate-900 border-slate-700 hover:bg-slate-800 text-slate-200 text-xs font-medium py-2 px-4 whitespace-nowrap shrink-0"
            >
              {committed ? (
                <>
                  <Check className="h-3.5 w-3.5 mr-1.5 text-emerald-400" /> Saved to Tracker
                </>
              ) : (
                <>
                  <Plus className="h-3.5 w-3.5 mr-1.5" /> Add to Tracker
                </>
              )}
            </Button>
          </div>
        </div>

        <div className="lg:col-span-7 p-6 space-y-6 bg-[#0E1422]">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-slate-800/80">
            <div>
              <div className="text-xs text-slate-400">
                Composite Conviction Score · {result.engine_used}
              </div>
              <div className="flex items-baseline gap-3 mt-1">
                <span
                  className={`text-4xl font-mono font-bold tabular-nums ${
                    result.score >= 90
                      ? 'text-emerald-400'
                      : result.score >= 75
                      ? 'text-blue-400'
                      : 'text-amber-400'
                  }`}
                >
                  {result.score}
                </span>
                <span className="text-sm font-mono text-slate-500 tabular-nums">/ 100</span>
                <span className="text-xs text-slate-400">
                  ·{' '}
                  {result.score >= 90
                    ? 'Auto-Shortlist & Discord Digest Triggered (≥90)'
                    : result.score >= 70
                    ? 'Moderate Fit — Manual Review'
                    : 'Rejected by Guardrail (<50 Seniority / Domain Cap)'}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-4 gap-3 bg-[#0B0F17] border border-slate-800/90 rounded-lg p-3 shrink-0">
              <div>
                <div className="text-[11px] text-slate-400">Role</div>
                <div className="text-sm font-mono font-semibold text-slate-100 tabular-nums">
                  {result.subscores.role_match}/40
                </div>
              </div>
              <div>
                <div className="text-[11px] text-slate-400">Exp</div>
                <div className="text-sm font-mono font-semibold text-slate-100 tabular-nums">
                  {result.subscores.experience_match}/25
                </div>
              </div>
              <div>
                <div className="text-[11px] text-slate-400">Location</div>
                <div className="text-sm font-mono font-semibold text-slate-100 tabular-nums">
                  {result.subscores.location_match}/20
                </div>
              </div>
              <div>
                <div className="text-[11px] text-slate-400">Salary</div>
                <div className="text-sm font-mono font-semibold text-slate-100 tabular-nums">
                  {result.subscores.salary_match}/15
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h4 className="text-xs font-medium text-slate-400 mb-2">Verified Fit Signals</h4>
              <ul className="space-y-2 text-xs text-slate-300 leading-relaxed">
                {result.match_reasons.map((r, i) => (
                  <li key={i} className="flex items-baseline gap-2">
                    <span className="font-mono text-emerald-400 tabular-nums">0{i + 1}.</span>
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="space-y-3">
              <div>
                <h4 className="text-xs font-medium text-amber-400 mb-1">
                  Gap Diagnosis & Mitigation Strategy
                </h4>
                <p className="text-xs text-slate-300 leading-relaxed">{result.gap}</p>
              </div>
              <div>
                <h4 className="text-xs font-medium text-slate-400 mb-1">
                  Skill Overlap & Relocation Assessment
                </h4>
                <p className="text-xs text-slate-300">
                  <span className="text-emerald-400">Matched:</span>{' '}
                  {result.matched_skills.join(' · ')}
                </p>
                <p className="text-xs text-slate-400 mt-1">
                  <span className="text-slate-300">Relocation:</span> {result.relocation_note}
                </p>
              </div>
            </div>
          </div>

          <div className="border-t border-slate-800/80 pt-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
              <div className="flex items-center gap-1 p-1 bg-[#0B0F17] border border-slate-800 rounded-lg w-fit">
                <button
                  type="button"
                  onClick={() => setOutreachMode('dm')}
                  className={`px-3 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    outreachMode === 'dm'
                      ? 'bg-slate-800 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  LinkedIn 3-Sentence DM
                </button>
                <button
                  type="button"
                  onClick={() => setOutreachMode('email')}
                  className={`px-3 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    outreachMode === 'email'
                      ? 'bg-slate-800 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Founder Cold Email
                </button>
              </div>

              <button
                type="button"
                onClick={() =>
                  handleCopy(
                    outreachMode === 'dm'
                      ? result.dm_draft
                      : `Subject: ${result.cold_email_subject}\n\n${result.cold_email_body}`,
                    outreachMode
                  )
                }
                className="px-3 py-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {copiedTab === outreachMode ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-emerald-400" /> Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" /> Copy{' '}
                    {outreachMode === 'dm' ? 'DM Draft' : 'Cold Email'}
                  </>
                )}
              </button>
            </div>

            {outreachMode === 'dm' ? (
              <div className="bg-[#0B0F17] border border-slate-800/90 rounded-lg p-4 text-xs text-slate-200 leading-relaxed">
                {result.dm_draft}
              </div>
            ) : (
              <div className="bg-[#0B0F17] border border-slate-800/90 rounded-lg p-4 text-xs text-slate-200 space-y-2 leading-relaxed">
                <div className="font-mono text-slate-400 border-b border-slate-800 pb-2">
                  Subject: <span className="text-slate-100">{result.cold_email_subject}</span>
                </div>
                <pre className="whitespace-pre-wrap font-sans text-xs text-slate-300 leading-relaxed">
                  {result.cold_email_body}
                </pre>
              </div>
            )}

            <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
              <span>
                <strong className="text-slate-200 font-medium">Resume Lead Angle:</strong>{' '}
                {result.resume_angle}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
