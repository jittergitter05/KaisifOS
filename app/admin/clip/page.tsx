'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  BookmarkPlus,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Copy,
  Check,
  ExternalLink,
  Mail,
  Sparkles,
  ArrowRight,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { copyToClipboardSafe, safeExternalUrl } from '@/lib/utils';

interface IngestedOutcome {
  id: string;
  canonicalKey: string;
  title: string;
  company: string;
  location: string;
  url: string;
  source: string;
  score: number;
  status: string;
  evaluationStatus: string;
  needsLlmRetry: boolean;
  eligible: boolean;
  rejectReason?: string;
  mergedDuplicate?: boolean;
  dmDraft?: string;
  resumeAngle?: string;
  gap?: string;
  reasons?: string[];
  engineUsed?: string;
}

interface IngestResponse {
  success: boolean;
  receivedCount: number;
  ingestedCount: number;
  duplicatesMerged: number;
  rejectedByGate: number;
  queuedForRetry: number;
  persistenceMode: string;
  results: IngestedOutcome[];
  warnings?: string[];
  error?: string;
}

function inferCompanyFromUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.replace(/^www\./i, '');
    if (host.includes('myworkdayjobs.com')) {
      return host.split('.')[0].replace(/[-_]/g, ' ');
    }
    if (
      host === 'boards.greenhouse.io' ||
      host === 'jobs.lever.co' ||
      host === 'jobs.ashbyhq.com'
    ) {
      const slug = parsed.pathname.split('/').filter(Boolean)[0];
      if (slug) return slug.replace(/[-_]/g, ' ');
    }
    if (!/naukri|linkedin|wellfound|instahyre|cutshort|hirist/i.test(host)) {
      const core = host.split('.')[0];
      if (core && core !== 'careers' && core !== 'jobs') {
        return core.charAt(0).toUpperCase() + core.slice(1);
      }
    }
  } catch {
    // ignore invalid URL
  }
  return '';
}

export default function ClipJobPage() {
  const [mode, setMode] = useState<'job_form' | 'email_alert'>('job_form');
  const [title, setTitle] = useState('');
  const [company, setCompany] = useState('');
  const [location, setLocation] = useState('Hyderabad, India');
  const [salary, setSalary] = useState('Not listed');
  const [url, setUrl] = useState('');
  const [source, setSource] = useState('');
  const [description, setDescription] = useState('');

  const [emailFrom, setEmailFrom] = useState('alerts@naukri.com');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');

  const [forceSave, setForceSave] = useState(true);
  const [forceRescore, setForceRescore] = useState(false);
  const [prefilledBanner, setPrefilledBanner] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<IngestResponse | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    try {
      const hash = window.location.hash || '';
      const searchParams = new URLSearchParams(window.location.search);
      let payloadObj: Record<string, string> | null = null;

      if (hash.startsWith('#payload=')) {
        const decoded = decodeURIComponent(hash.slice('#payload='.length));
        const parsed = JSON.parse(decoded);
        if (parsed && typeof parsed === 'object') {
          payloadObj = parsed as Record<string, string>;
        }
      } else if (
        searchParams.has('url') ||
        searchParams.has('title') ||
        searchParams.has('description')
      ) {
        payloadObj = {
          url: searchParams.get('url') || '',
          title: searchParams.get('title') || '',
          company: searchParams.get('company') || '',
          location: searchParams.get('location') || '',
          salary: searchParams.get('salary') || '',
          source: searchParams.get('source') || '',
          description: searchParams.get('description') || '',
        };
      }

      if (payloadObj) {
        const nextUrl = String(payloadObj.url || '').trim();
        const nextTitle = String(payloadObj.title || '').trim();
        const nextCompany =
          String(payloadObj.company || '').trim() || inferCompanyFromUrl(nextUrl);

        if (nextUrl) setUrl(nextUrl);
        if (nextTitle) setTitle(nextTitle);
        if (nextCompany) setCompany(nextCompany);
        if (payloadObj.location) setLocation(String(payloadObj.location));
        if (payloadObj.salary) setSalary(String(payloadObj.salary));
        if (payloadObj.source) setSource(String(payloadObj.source));
        if (payloadObj.description) setDescription(String(payloadObj.description));
        setPrefilledBanner(true);

        if (hash) {
          window.history.replaceState(
            null,
            '',
            window.location.pathname + window.location.search
          );
        }
      }
    } catch {
      // Ignore malformed bookmarklet hash payload cleanly
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setResult(null);

    try {
      const bodyPayload =
        mode === 'job_form'
          ? {
              channel: 'clipper',
              forceSave,
              forceRescore,
              title: title.trim(),
              company: company.trim() || inferCompanyFromUrl(url) || 'Target Company',
              location: location.trim() || 'Hyderabad / India',
              salary: salary.trim() || 'Not listed',
              url: url.trim(),
              source: source.trim() || undefined,
              description: description.trim(),
            }
          : {
              channel: 'clipper',
              forceSave,
              forceRescore,
              from: emailFrom.trim(),
              subject: emailSubject.trim(),
              textBody: emailBody.trim(),
              htmlBody: /<[a-z][\s\S]*>/i.test(emailBody) ? emailBody : '',
            };

      const res = await fetch('/api/ingest/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyPayload),
      });

      if (res.status === 401) {
        window.location.href = '/login';
        return;
      }

      const data = (await res.json().catch(() => null)) as IngestResponse | null;
      if (!res.ok || !data) {
        throw new Error(data?.error || `Clipper request failed (HTTP ${res.status}).`);
      }

      setResult(data);
    } catch (err) {
      setError((err as Error).message || 'Failed to ingest clipped job.');
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setTitle('');
    setCompany('');
    setLocation('Hyderabad, India');
    setSalary('Not listed');
    setUrl('');
    setSource('');
    setDescription('');
    setEmailSubject('');
    setEmailBody('');
    setPrefilledBanner(false);
    setError(null);
    setResult(null);
  };

  return (
    <div className="flex flex-col flex-1 w-full bg-slate-50 dark:bg-[#0B0F17] text-slate-900 dark:text-[#F8FAFC]">
      <div className="flex-1 py-6 px-4 sm:px-6 lg:px-8 max-w-5xl mx-auto w-full pb-24 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-5">
          <div>
            <h1 className="text-2xl font-display font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-2.5">
              <BookmarkPlus className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
              1-Click Job Clipper &amp; Alert Parser
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Clip listings from Naukri, LinkedIn, Wellfound, Instahire, or any company portal —
              automatically scored against your 4-Pillar Rubric and synced to Neon Postgres.
            </p>
          </div>
          <div className="flex items-center gap-2.5 shrink-0">
            <Link
              href="/admin/settings"
              className="px-3 py-1.5 rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 transition-colors"
            >
              Bookmarklet &amp; Apps Script Setup
            </Link>
            <Link
              href="/admin/tracker"
              className="px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium inline-flex items-center gap-1.5 transition-colors"
            >
              Pipeline Tracker <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>

        {prefilledBanner && (
          <div className="bg-emerald-50 dark:bg-emerald-950/35 border border-emerald-200 dark:border-emerald-800/70 text-emerald-800 dark:text-emerald-200 px-4 py-3 rounded-lg text-xs flex items-center justify-between gap-3">
            <span className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span>
                <strong>Captured from browser tab:</strong> Review company name &amp; location, then
                click <strong>Evaluate &amp; Save to Pipeline</strong>.
              </span>
            </span>
            <button
              type="button"
              onClick={resetForm}
              className="text-emerald-700 dark:text-emerald-300 hover:underline font-mono shrink-0 cursor-pointer inline-flex items-center gap-1"
            >
              <Trash2 className="h-3.5 w-3.5" /> Clear
            </button>
          </div>
        )}

        <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-[#0D131F] flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-1 bg-white dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 p-1 rounded-md">
              <button
                type="button"
                onClick={() => setMode('job_form')}
                className={`px-3 py-1.5 text-xs font-medium rounded flex items-center gap-1.5 transition-colors cursor-pointer ${
                  mode === 'job_form'
                    ? 'bg-slate-200 dark:bg-slate-800 text-slate-900 dark:text-white'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                <BookmarkPlus className="h-3.5 w-3.5" />
                Single Job Clip
              </button>
              <button
                type="button"
                onClick={() => setMode('email_alert')}
                className={`px-3 py-1.5 text-xs font-medium rounded flex items-center gap-1.5 transition-colors cursor-pointer ${
                  mode === 'email_alert'
                    ? 'bg-slate-200 dark:bg-slate-800 text-slate-900 dark:text-white'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                <Mail className="h-3.5 w-3.5" />
                Paste Naukri / LinkedIn Alert Email
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-4 text-xs">
              <label className="inline-flex items-center gap-2 cursor-pointer select-none text-slate-700 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={forceSave}
                  onChange={(e) => setForceSave(e.target.checked)}
                  className="accent-emerald-600 rounded"
                />
                <span>Force Save Even If Below Score Floor</span>
              </label>
              <label className="inline-flex items-center gap-2 cursor-pointer select-none text-slate-700 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={forceRescore}
                  onChange={(e) => setForceRescore(e.target.checked)}
                  className="accent-emerald-600 rounded"
                />
                <span>Allow Re-Scoring Duplicate</span>
              </label>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="p-6 space-y-5">
            {mode === 'job_form' ? (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-1 block">
                      Role Title <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="e.g. Associate Product Manager"
                      className="w-full bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded-md px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-1 block">
                      Company Name <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={company}
                      onChange={(e) => setCompany(e.target.value)}
                      placeholder="e.g. Darwinbox, Razorpay, ServiceNow"
                      className="w-full bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded-md px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-1 block">
                      Job Posting URL (HTTPS)
                    </label>
                    <input
                      type="url"
                      value={url}
                      onChange={(e) => {
                        const v = e.target.value;
                        setUrl(v);
                        if (!company) {
                          const inferred = inferCompanyFromUrl(v);
                          if (inferred) setCompany(inferred);
                        }
                      }}
                      placeholder="https://www.naukri.com/job-listings-..."
                      className="w-full bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded-md px-3 py-2 text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-1 block">
                        Location
                      </label>
                      <input
                        type="text"
                        value={location}
                        onChange={(e) => setLocation(e.target.value)}
                        placeholder="Hyderabad, India"
                        className="w-full bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded-md px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-emerald-500"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-1 block">
                        CTC / Salary
                      </label>
                      <input
                        type="text"
                        value={salary}
                        onChange={(e) => setSalary(e.target.value)}
                        placeholder="₹10–14 LPA"
                        className="w-full bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded-md px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-emerald-500"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <label className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-1 block">
                    Job Description / Requirements
                  </label>
                  <textarea
                    rows={7}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Paste role responsibilities, required skills, experience band, or let auto-enrichment fetch the public URL if left short..."
                    className="w-full bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded-md p-3.5 text-xs font-mono text-slate-800 dark:text-slate-200 leading-relaxed focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-1 block">
                      Sender / Platform Hint
                    </label>
                    <input
                      type="text"
                      value={emailFrom}
                      onChange={(e) => setEmailFrom(e.target.value)}
                      placeholder="alerts@naukri.com or jobs-noreply@linkedin.com"
                      className="w-full bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded-md px-3 py-2 text-xs font-mono text-slate-900 dark:text-slate-100 focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-1 block">
                      Email Subject
                    </label>
                    <input
                      type="text"
                      value={emailSubject}
                      onChange={(e) => setEmailSubject(e.target.value)}
                      placeholder="e.g. 5 New Associate Product Manager jobs in Hyderabad"
                      className="w-full bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded-md px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-1 block">
                    Alert Email Body (Plain Text or Raw HTML containing job links)
                  </label>
                  <textarea
                    rows={8}
                    required
                    value={emailBody}
                    onChange={(e) => setEmailBody(e.target.value)}
                    placeholder="Paste full Naukri / LinkedIn / Wellfound digest email text or HTML..."
                    className="w-full bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded-md p-3.5 text-xs font-mono text-slate-800 dark:text-slate-200 leading-relaxed focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={resetForm}
                className="text-xs font-mono text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white cursor-pointer"
              >
                Reset Fields
              </button>
              <Button
                type="submit"
                disabled={submitting}
                className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium px-5 py-2"
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />
                    Evaluating &amp; Syncing...
                  </>
                ) : (
                  <>
                    <BookmarkPlus className="h-3.5 w-3.5 mr-2" />
                    Evaluate &amp; Save to Pipeline
                  </>
                )}
              </Button>
            </div>
          </form>
        </div>

        {error && (
          <div className="bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/70 text-rose-800 dark:text-rose-200 px-4 py-3 rounded-lg text-xs font-mono flex items-center gap-2.5">
            <AlertTriangle className="h-4 w-4 text-rose-600 dark:text-rose-400 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {result && (
          <section className="space-y-4">
            <div className="bg-white dark:bg-[#111827] border border-emerald-300 dark:border-emerald-800/70 rounded-lg p-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 text-xs">
                <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <span>
                  Processed <strong>{result.receivedCount}</strong> · Saved{' '}
                  <strong>{result.ingestedCount}</strong> · Merged duplicates{' '}
                  <strong>{result.duplicatesMerged}</strong> · Queued retry{' '}
                  <strong>{result.queuedForRetry}</strong>
                </span>
              </div>
              <span className="text-[11px] font-mono px-2.5 py-1 rounded bg-slate-100 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300">
                Store: {result.persistenceMode}
              </span>
            </div>

            {result.results.map((item) => (
              <div
                key={item.id + item.canonicalKey}
                className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-lg p-5 space-y-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-3.5">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-sm font-display font-semibold text-slate-900 dark:text-white">
                        {item.title}
                      </h2>
                      <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                        {item.source}
                      </span>
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                      {item.company} · {item.location} · Status: {item.status}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-right">
                      <div className="text-lg font-mono font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                        {item.score}/100
                      </div>
                      <div className="text-[10px] font-mono text-slate-500 dark:text-slate-400">
                        {item.engineUsed || item.evaluationStatus}
                      </div>
                    </div>
                    {safeExternalUrl(item.url) !== '#' && (
                      <a
                        href={safeExternalUrl(item.url)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="p-2 rounded-md border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:text-emerald-600 dark:hover:text-emerald-400"
                        aria-label="Open original posting"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    )}
                  </div>
                </div>

                {!item.eligible && item.rejectReason && (
                  <div className="text-xs font-mono text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 px-3 py-2 rounded">
                    Hard-Gate Warning: {item.rejectReason}
                  </div>
                )}

                {item.reasons && item.reasons.length > 0 && (
                  <ul className="space-y-1 text-xs text-slate-700 dark:text-slate-300">
                    {item.reasons.map((r, idx) => (
                      <li key={idx}>• {r}</li>
                    ))}
                  </ul>
                )}

                {item.gap && (
                  <div className="text-xs text-slate-600 dark:text-slate-400">
                    <strong className="text-slate-800 dark:text-slate-200">Gap Note:</strong>{' '}
                    {item.gap}
                  </div>
                )}

                {item.resumeAngle && (
                  <div className="text-xs text-slate-600 dark:text-slate-400">
                    <strong className="text-slate-800 dark:text-slate-200">Resume Angle:</strong>{' '}
                    {item.resumeAngle}
                  </div>
                )}

                {item.dmDraft && (
                  <div className="bg-slate-50 dark:bg-[#0B0F17] border border-slate-200 dark:border-slate-800 rounded-md p-3.5 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                        Outreach DM Draft
                      </span>
                      <button
                        type="button"
                        onClick={async () => {
                          const ok = await copyToClipboardSafe(item.dmDraft || '');
                          if (ok) {
                            setCopiedId(item.id);
                            setTimeout(() => setCopiedId(null), 1800);
                          }
                        }}
                        className="text-[11px] font-mono text-emerald-600 dark:text-emerald-400 hover:underline inline-flex items-center gap-1 cursor-pointer"
                      >
                        {copiedId === item.id ? (
                          <>
                            <Check className="h-3 w-3" /> Copied
                          </>
                        ) : (
                          <>
                            <Copy className="h-3 w-3" /> Copy DM
                          </>
                        )}
                      </button>
                    </div>
                    <p className="text-xs text-slate-700 dark:text-slate-300 whitespace-pre-wrap">
                      {item.dmDraft}
                    </p>
                  </div>
                )}
              </div>
            ))}
          </section>
        )}
      </div>
    </div>
  );
}
