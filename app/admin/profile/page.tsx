'use client';
import React, { useEffect, useState, useMemo } from 'react';
import {
  Save,
  Plus,
  X,
  Loader2,
  CheckCircle,
  AlertCircle,
  Copy,
  Check,
  FileText,
  Upload,
  Link2,
  ArrowRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ParsedResumeParameters, ResumeParseDiagnostics } from '@/lib/resume-parser';

interface Profile {
  system_name?: string;
  name: string;
  email: string;
  target_roles: string[];
  target_cities: string[];
  open_to_relocation: boolean;
  relocation_preference: {
    willing: boolean;
    requirements: string[];
    preferred_regions: string[];
    avoid: string[];
  };
  min_salary_lpa: number;
  min_salary_usd_annual: number;
  experience_years: number;
  experience_level: string;
  portfolio: string;
  key_metrics: string[];
  skills: string[];
  languages: string[];
  resume_synthesizer_url: string;
  ats_companies?: {
    greenhouse: string[];
    lever: string[];
    ashby: string[];
  };
}

const SAMPLE_RESUME_TEXT = `SHAIK KAISIF BASHA
shaikkaisifbasha04@gmail.com | https://portjitterglitter.vercel.app | Hyderabad & Bengaluru, India

SUMMARY
Entry-level Product, Growth & AI Systems Builder (0 full-time years / Fresher) specializing in product marketing, technical SEO, Python EDA, and automated GTM pipelines. Open to global relocation (UAE, Singapore, UK, Europe).

EXPERIENCE & KEY INITIATIVES
Growth & Product Marketing — Smatr AI (2024)
• Drove ~425% organic search growth at Smatr AI through programmatic SEO and Google Search Console telemetry.
• Scaled ~1,466% product page view growth at Smatr AI via conversion funnel experimentation in GA4.
• Executed product marketing across Reddit, Discord, and Pinterest driving 1,000+ unique monthly visits.
• Created digital contact database for 2,000+ alumni and automated outreach workflows using Python and Cloudflare Workers.

SKILLS
GTM Strategy, Product Marketing, Growth Marketing, SEO, Python, Python EDA, SQL, GA4, Google Search Console, Notion, Cloudflare Workers, TypeScript, Next.js, AI Workflow Automation, A/B Testing`;

function ArrayEditor({
  label,
  items,
  onChange,
  placeholder,
}: {
  label: string;
  items: string[];
  onChange: (items: string[]) => void;
  placeholder?: string;
}) {
  const [newItem, setNewItem] = useState('');
  return (
    <div>
      <label className="text-xs font-medium text-slate-300 mb-2 block">{label}</label>
      <div className="flex flex-wrap gap-1.5 mb-2.5">
        {items.map((item, i) => (
          <span
            key={i}
            className="inline-flex items-center gap-1.5 bg-[#0B0F17] border border-slate-800 text-slate-200 text-xs rounded px-2.5 py-1 font-mono"
          >
            {item}
            <button
              type="button"
              onClick={() => onChange(items.filter((_, j) => j !== i))}
              className="text-slate-500 hover:text-rose-400 transition-colors cursor-pointer"
              aria-label={`Remove ${item}`}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={newItem}
          onChange={(e) => setNewItem(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && newItem.trim()) {
              e.preventDefault();
              onChange([...items, newItem.trim()]);
              setNewItem('');
            }
          }}
          placeholder={placeholder || 'Add item...'}
          className="flex-1 bg-[#0B0F17] border border-slate-800 rounded-md px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            if (newItem.trim()) {
              onChange([...items, newItem.trim()]);
              setNewItem('');
            }
          }}
          className="bg-slate-900 border-slate-800 hover:bg-slate-800 text-slate-300 h-8 px-3 text-xs"
        >
          <Plus className="h-3.5 w-3.5 mr-1" /> Add
        </Button>
      </div>
    </div>
  );
}

export default function ProfilePage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  const [copiedPrompt, setCopiedPrompt] = useState(false);

  const [parserTab, setParserTab] = useState<'pdf_upload' | 'google_drive' | 'raw_text'>(
    'pdf_upload'
  );
  const [resumeText, setResumeText] = useState('');
  const [driveUrl, setDriveUrl] = useState('');
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [parsedResult, setParsedResult] = useState<{
    parsed: ParsedResumeParameters;
    diagnostics: ResumeParseDiagnostics;
  } | null>(null);

  const [mergeSelection, setMergeSelection] = useState({
    identity: true,
    experience: true,
    roles: true,
    skills: true,
    metrics: true,
    geographyComp: true,
  });

  useEffect(() => {
    fetch('/api/profile')
      .then(async (res) => {
        if (res.status === 401) {
          window.location.href = '/login';
          return null;
        }
        if (!res.ok) throw new Error('Failed');
        return res.json();
      })
      .then((data) => {
        if (data) setProfile(data);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, []);

  const saveProfileData = async (targetProfile: Profile) => {
    setSaving(true);
    setStatus('idle');
    try {
      const res = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(targetProfile),
      });
      if (!res.ok) throw new Error('Save failed');
      setStatus('saved');
      setTimeout(() => setStatus('idle'), 3000);
    } catch {
      setStatus('error');
    }
    setSaving(false);
  };

  const save = () => {
    if (profile) saveProfileData(profile);
  };

  const applyPreset = async (presetKey: string) => {
    setSaving(true);
    setStatus('idle');
    try {
      const res = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ presetKey }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.profile) setProfile(data.profile);
        setStatus('saved');
        setTimeout(() => setStatus('idle'), 3000);
      }
    } catch {
      setStatus('error');
    }
    setSaving(false);
  };

  const runResumeParser = async (overrideText?: string) => {
    setParsing(true);
    setParseError(null);
    setParsedResult(null);

    try {
      let res: Response;
      if (overrideText !== undefined) {
        res = await fetch('/api/profile/parse-resume', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'raw_text', rawText: overrideText }),
        });
      } else if (parserTab === 'pdf_upload') {
        if (!pdfFile) {
          setParseError('Select a PDF or text resume file first.');
          setParsing(false);
          return;
        }
        const formData = new FormData();
        formData.append('file', pdfFile);
        res = await fetch('/api/profile/parse-resume', {
          method: 'POST',
          body: formData,
        });
      } else if (parserTab === 'google_drive') {
        if (!driveUrl.trim()) {
          setParseError('Enter a public Google Drive or Google Docs link.');
          setParsing(false);
          return;
        }
        res = await fetch('/api/profile/parse-resume', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'google_drive', driveUrl: driveUrl.trim() }),
        });
      } else {
        if (!resumeText.trim()) {
          setParseError('Paste your resume text before running the parser.');
          setParsing(false);
          return;
        }
        res = await fetch('/api/profile/parse-resume', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'raw_text', rawText: resumeText.trim() }),
        });
      }

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Resume parsing failed.');
      }
      setParsedResult(data);
    } catch (err) {
      setParseError((err as Error).message);
    } finally {
      setParsing(false);
    }
  };

  const commitMergedResumeParameters = async () => {
    if (!profile || !parsedResult) return;
    const p = parsedResult.parsed;

    const nextProfile: Profile = {
      ...profile,
      ...(mergeSelection.identity
        ? {
            name: p.name || profile.name,
            email: p.email || profile.email,
            portfolio: p.portfolio || profile.portfolio,
          }
        : {}),
      ...(mergeSelection.experience
        ? {
            experience_years: p.experience_years,
            experience_level: p.experience_level,
          }
        : {}),
      ...(mergeSelection.roles ? { target_roles: p.target_roles } : {}),
      ...(mergeSelection.skills ? { skills: p.skills } : {}),
      ...(mergeSelection.metrics ? { key_metrics: p.key_metrics } : {}),
      ...(mergeSelection.geographyComp
        ? {
            target_cities: p.target_cities,
            min_salary_lpa: p.min_salary_lpa,
            min_salary_usd_annual: p.min_salary_usd_annual,
          }
        : {}),
    };

    setProfile(nextProfile);
    await saveProfileData(nextProfile);
    setParsedResult(null);
  };

  const update = (patch: Partial<Profile>) =>
    setProfile((prev) => (prev ? { ...prev, ...patch } : prev));

  const compiledPromptPreview = useMemo(() => {
    if (!profile) return '';
    const isFresher = profile.experience_years === 0;
    const targetCities = profile.target_cities.join(', ');
    const expRule = isFresher
      ? `3. Seniority (15 pts): Candidate has 0 full-time years. Cap total score at 50 if 2+ years required.`
      : `3. Seniority (15 pts): Candidate has ${profile.experience_years} years of experience.`;
    const locRule = profile.open_to_relocation
      ? `4. Comp & Geo (15 pts): Open to relocation (${profile.relocation_preference?.preferred_regions?.join(', ')}). Floor: ₹${profile.min_salary_lpa}L / $${profile.min_salary_usd_annual}.`
      : `4. Comp & Geo (15 pts): Must be in ${targetCities} or Remote.`;

    return `Instance: ${profile.system_name || 'CareerOS'}
Owner: ${profile.name} (${profile.experience_level})
Roles: ${profile.target_roles.join(', ')}
Hubs: ${targetCities}
Floor: ₹${profile.min_salary_lpa} LPA / $${profile.min_salary_usd_annual} USD
Proof: ${profile.key_metrics.join(' | ')}
Skills: ${profile.skills.join(', ')}

Rubric:
1. Role (40 pts): ${profile.target_roles.slice(0, 4).join(' / ')}
2. Skill (30 pts): ${profile.skills.slice(0, 5).join(', ')}
${expRule}
${locRule}`;
  }, [profile]);

  if (loading)
    return (
      <div className="flex-1 flex items-center justify-center p-12 text-slate-400 font-mono text-xs">
        Loading profile...
      </div>
    );
  if (!profile)
    return (
      <div className="flex-1 flex items-center justify-center p-12 text-rose-400 font-mono text-xs">
        Failed to load profile.json.
      </div>
    );

  const atsCompanies = profile.ats_companies || {
    greenhouse: ['razorpay', 'postman', 'stripe', 'vercel'],
    lever: ['zepto', 'cred', 'mistral'],
    ashby: ['linear', 'posthog', 'supabase'],
  };

  return (
    <div className="flex flex-col flex-1 w-full bg-[#0B0F17] text-[#F8FAFC]">
      <div className="flex-1 py-6 px-4 sm:px-6 lg:px-8 max-w-6xl mx-auto w-full pb-24 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-5">
          <div>
            <h1 className="text-2xl font-display font-bold tracking-tight text-white">
              Owner & Targeting Parameters
            </h1>
            <p className="text-xs text-slate-400 mt-1">
              Parse a resume or edit parameters directly in{' '}
              <span className="font-mono">data/profile.json</span>.
            </p>
          </div>
          <Button
            onClick={save}
            disabled={saving}
            className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium px-4 py-2 whitespace-nowrap shrink-0"
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />
            ) : status === 'saved' ? (
              <CheckCircle className="h-3.5 w-3.5 mr-2" />
            ) : status === 'error' ? (
              <AlertCircle className="h-3.5 w-3.5 mr-2" />
            ) : (
              <Save className="h-3.5 w-3.5 mr-2" />
            )}
            {saving
              ? 'Saving...'
              : status === 'saved'
              ? 'Saved'
              : status === 'error'
              ? 'Save Failed'
              : 'Save Profile'}
          </Button>
        </div>

        {/* Multi-Source Resume Parser */}
        <section className="bg-[#111827] border border-slate-800 rounded-lg overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-800 bg-[#0D131F] flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h2 className="text-sm font-display font-semibold text-white">
                Resume / CV Parameter Parser
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Upload a PDF, paste a Google Drive link, or paste raw text to extract roles, skills,
                and proof metrics.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <div className="flex items-center gap-1 bg-[#0B0F17] border border-slate-800 p-1 rounded-md">
                {[
                  { id: 'pdf_upload', label: 'Upload PDF', icon: Upload },
                  { id: 'google_drive', label: 'Google Drive Link', icon: Link2 },
                  { id: 'raw_text', label: 'Paste Text', icon: FileText },
                ].map((t) => {
                  const Icon = t.icon;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => {
                        setParserTab(t.id as typeof parserTab);
                        setParseError(null);
                      }}
                      className={`px-3 py-1.5 text-xs font-medium rounded flex items-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap ${
                        parserTab === t.id
                          ? 'bg-slate-800 text-white'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      <span>{t.label}</span>
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={() => {
                  setParserTab('raw_text');
                  setResumeText(SAMPLE_RESUME_TEXT);
                  runResumeParser(SAMPLE_RESUME_TEXT);
                }}
                className="px-3 py-1.5 text-xs font-mono bg-[#0B0F17] border border-slate-800 hover:border-emerald-500/60 text-slate-300 rounded-md cursor-pointer whitespace-nowrap"
              >
                Parse Sample CV
              </button>
            </div>
          </div>

          <div className="p-6 space-y-5">
            {parserTab === 'pdf_upload' && (
              <div className="border border-dashed border-slate-700 bg-[#0B0F17] rounded-lg p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="text-xs font-medium text-white">Resume File (.pdf or .txt)</div>
                  <p className="text-xs text-slate-400">
                    Extracts text via Gemini 2.5 Flash multimodal PDF comprehension or built-in zlib
                    stream decoding.
                  </p>
                  {pdfFile && (
                    <div className="text-xs font-mono text-emerald-400 pt-1">
                      Selected: {pdfFile.name} ({Math.round(pdfFile.size / 1024)} KB)
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2.5 shrink-0">
                  <label className="px-3.5 py-2 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-100 rounded-md cursor-pointer whitespace-nowrap">
                    Choose File
                    <input
                      type="file"
                      accept=".pdf,.txt,.md,application/pdf,text/plain"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0] || null;
                        setPdfFile(f);
                        setParseError(null);
                      }}
                    />
                  </label>
                  <Button
                    type="button"
                    disabled={parsing || !pdfFile}
                    onClick={() => runResumeParser()}
                    className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs h-9 px-4"
                  >
                    {parsing ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> Parsing...
                      </>
                    ) : (
                      <>
                        Parse PDF <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
                      </>
                    )}
                  </Button>
                </div>
              </div>
            )}

            {parserTab === 'google_drive' && (
              <div className="bg-[#0B0F17] border border-slate-800 rounded-lg p-5 space-y-3">
                <label className="block text-xs font-medium text-white">
                  Public Google Drive PDF or Google Docs URL
                </label>
                <div className="flex flex-col sm:flex-row gap-2.5">
                  <input
                    type="url"
                    value={driveUrl}
                    onChange={(e) => setDriveUrl(e.target.value)}
                    placeholder="https://drive.google.com/file/d/.../view"
                    className="flex-1 bg-[#111827] border border-slate-800 rounded-md px-3.5 py-2 text-xs font-mono text-slate-100 focus:outline-none focus:border-emerald-500"
                  />
                  <Button
                    type="button"
                    disabled={parsing}
                    onClick={() => runResumeParser()}
                    className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs h-9 px-4 whitespace-nowrap shrink-0"
                  >
                    {parsing ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> Fetching...
                      </>
                    ) : (
                      <>
                        Fetch & Parse <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
                      </>
                    )}
                  </Button>
                </div>
                <p className="text-[11px] text-slate-400">
                  Set link sharing to &ldquo;Anyone with the link can view&rdquo;.
                </p>
              </div>
            )}

            {parserTab === 'raw_text' && (
              <div className="space-y-3">
                <textarea
                  rows={6}
                  value={resumeText}
                  onChange={(e) => setResumeText(e.target.value)}
                  placeholder="Paste full resume text..."
                  className="w-full bg-[#0B0F17] border border-slate-800 rounded-md p-3.5 text-xs font-mono text-slate-200 leading-relaxed focus:outline-none focus:border-emerald-500"
                />
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-mono text-slate-400 tabular-nums">
                    {resumeText.length} characters
                  </span>
                  <Button
                    type="button"
                    disabled={parsing}
                    onClick={() => runResumeParser()}
                    className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs h-9 px-4"
                  >
                    {parsing ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> Parsing...
                      </>
                    ) : (
                      <>
                        Extract Parameters <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
                      </>
                    )}
                  </Button>
                </div>
              </div>
            )}

            {parseError && (
              <div className="bg-rose-950/40 border border-rose-800/70 text-rose-300 px-4 py-3 rounded-md text-xs font-mono">
                {parseError}
              </div>
            )}

            {parsedResult && (
              <div className="border border-emerald-700/60 bg-[#0B0F17] rounded-lg overflow-hidden space-y-4">
                <div className="px-5 py-3.5 bg-emerald-950/30 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-mono text-emerald-400">
                      Parsed via {parsedResult.diagnostics.engine_used}
                    </div>
                    <div className="text-[11px] text-slate-400 font-mono mt-0.5 tabular-nums">
                      Confidence: {parsedResult.diagnostics.confidence_score}% ·{' '}
                      {parsedResult.diagnostics.char_count} bytes
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setParsedResult(null)}
                      className="bg-slate-900 border-slate-700 text-slate-300 text-xs h-8"
                    >
                      Discard
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={commitMergedResumeParameters}
                      className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs h-8 px-3.5"
                    >
                      <Check className="h-3.5 w-3.5 mr-1.5" /> Merge Selected
                    </Button>
                  </div>
                </div>

                <div className="overflow-x-auto px-5 pb-4">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400 font-mono text-[11px]">
                        <th className="py-2.5 pr-3 w-10">Apply</th>
                        <th className="py-2.5 px-3 w-44">Parameter</th>
                        <th className="py-2.5 px-3">Current Value</th>
                        <th className="py-2.5 pl-3">Extracted Value</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/80">
                      <tr>
                        <td className="py-3 pr-3 align-top">
                          <input
                            type="checkbox"
                            checked={mergeSelection.identity}
                            onChange={(e) =>
                              setMergeSelection({ ...mergeSelection, identity: e.target.checked })
                            }
                            className="accent-emerald-500 rounded"
                          />
                        </td>
                        <td className="py-3 px-3 align-top font-medium text-white">Identity</td>
                        <td className="py-3 px-3 align-top text-slate-400 font-mono">
                          {profile.name} · {profile.email}
                        </td>
                        <td className="py-3 pl-3 align-top text-emerald-400 font-mono">
                          {parsedResult.parsed.name} · {parsedResult.parsed.email}
                        </td>
                      </tr>

                      <tr>
                        <td className="py-3 pr-3 align-top">
                          <input
                            type="checkbox"
                            checked={mergeSelection.experience}
                            onChange={(e) =>
                              setMergeSelection({ ...mergeSelection, experience: e.target.checked })
                            }
                            className="accent-emerald-500 rounded"
                          />
                        </td>
                        <td className="py-3 px-3 align-top font-medium text-white">Seniority</td>
                        <td className="py-3 px-3 align-top text-slate-400 font-mono tabular-nums">
                          {profile.experience_level} ({profile.experience_years} yrs)
                        </td>
                        <td className="py-3 pl-3 align-top text-emerald-400 font-mono tabular-nums">
                          {parsedResult.parsed.experience_level} (
                          {parsedResult.parsed.experience_years} yrs)
                        </td>
                      </tr>

                      <tr>
                        <td className="py-3 pr-3 align-top">
                          <input
                            type="checkbox"
                            checked={mergeSelection.roles}
                            onChange={(e) =>
                              setMergeSelection({ ...mergeSelection, roles: e.target.checked })
                            }
                            className="accent-emerald-500 rounded"
                          />
                        </td>
                        <td className="py-3 px-3 align-top font-medium text-white">
                          Target Roles ({parsedResult.parsed.target_roles.length})
                        </td>
                        <td className="py-3 px-3 align-top text-slate-400">
                          {profile.target_roles.join(' · ')}
                        </td>
                        <td className="py-3 pl-3 align-top text-emerald-300 font-medium">
                          {parsedResult.parsed.target_roles.join(' · ')}
                        </td>
                      </tr>

                      <tr>
                        <td className="py-3 pr-3 align-top">
                          <input
                            type="checkbox"
                            checked={mergeSelection.skills}
                            onChange={(e) =>
                              setMergeSelection({ ...mergeSelection, skills: e.target.checked })
                            }
                            className="accent-emerald-500 rounded"
                          />
                        </td>
                        <td className="py-3 px-3 align-top font-medium text-white">
                          Hard Skills ({parsedResult.parsed.skills.length})
                        </td>
                        <td className="py-3 px-3 align-top text-slate-400 font-mono">
                          {profile.skills.join(' · ')}
                        </td>
                        <td className="py-3 pl-3 align-top text-emerald-300 font-mono">
                          {parsedResult.parsed.skills.join(' · ')}
                        </td>
                      </tr>

                      <tr>
                        <td className="py-3 pr-3 align-top">
                          <input
                            type="checkbox"
                            checked={mergeSelection.metrics}
                            onChange={(e) =>
                              setMergeSelection({ ...mergeSelection, metrics: e.target.checked })
                            }
                            className="accent-emerald-500 rounded"
                          />
                        </td>
                        <td className="py-3 px-3 align-top font-medium text-white">
                          Proof Metrics ({parsedResult.parsed.key_metrics.length})
                        </td>
                        <td className="py-3 px-3 align-top text-slate-400">
                          {profile.key_metrics.slice(0, 2).join(' | ')}
                        </td>
                        <td className="py-3 pl-3 align-top text-emerald-300">
                          <ul className="space-y-1">
                            {parsedResult.parsed.key_metrics.map((m, idx) => (
                              <li key={idx}>• {m}</li>
                            ))}
                          </ul>
                        </td>
                      </tr>

                      <tr>
                        <td className="py-3 pr-3 align-top">
                          <input
                            type="checkbox"
                            checked={mergeSelection.geographyComp}
                            onChange={(e) =>
                              setMergeSelection({
                                ...mergeSelection,
                                geographyComp: e.target.checked,
                              })
                            }
                            className="accent-emerald-500 rounded"
                          />
                        </td>
                        <td className="py-3 px-3 align-top font-medium text-white">
                          Hubs & Floor
                        </td>
                        <td className="py-3 px-3 align-top text-slate-400 font-mono tabular-nums">
                          {profile.target_cities.join(', ')} · ₹{profile.min_salary_lpa}L / $
                          {profile.min_salary_usd_annual}
                        </td>
                        <td className="py-3 pl-3 align-top text-emerald-400 font-mono tabular-nums">
                          {parsedResult.parsed.target_cities.join(', ')} · ₹
                          {parsedResult.parsed.min_salary_lpa}L / $
                          {parsedResult.parsed.min_salary_usd_annual}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Track Presets */}
        <div className="bg-[#111827] border border-slate-800 rounded-lg p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="text-xs text-slate-300">
            <strong className="text-white">Role Track Presets:</strong> Load a baseline template in
            one click.
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {[
              { key: 'blank_fork', label: 'Clean White-Label' },
              { key: 'swe_ai', label: 'Full-Stack / AI SWE' },
              { key: 'data_ml', label: 'Data Science / ML' },
              { key: 'pm_growth', label: 'PM / Growth' },
            ].map((tpl) => (
              <button
                key={tpl.key}
                type="button"
                onClick={() => applyPreset(tpl.key)}
                className="px-3 py-1.5 rounded-md text-xs font-medium bg-[#0B0F17] border border-slate-800 hover:border-emerald-500/60 text-slate-200 transition-colors cursor-pointer"
              >
                {tpl.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <div className="lg:col-span-7 space-y-6">
            <div className="bg-[#111827] border border-slate-800 rounded-lg p-6 space-y-4">
              <h2 className="text-sm font-display font-semibold text-white border-b border-slate-800 pb-3">
                01. Identity & Seniority
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-slate-400 mb-1 block">
                    Workspace Title
                  </label>
                  <input
                    type="text"
                    value={profile.system_name || 'CareerOS'}
                    onChange={(e) => update({ system_name: e.target.value })}
                    className="w-full bg-[#0B0F17] border border-slate-800 rounded-md px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-400 mb-1 block">
                    Candidate Name
                  </label>
                  <input
                    type="text"
                    value={profile.name}
                    onChange={(e) => update({ name: e.target.value })}
                    className="w-full bg-[#0B0F17] border border-slate-800 rounded-md px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-400 mb-1 block">Email</label>
                  <input
                    type="email"
                    value={profile.email}
                    onChange={(e) => update({ email: e.target.value })}
                    className="w-full bg-[#0B0F17] border border-slate-800 rounded-md px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-400 mb-1 block">
                    Experience Band
                  </label>
                  <input
                    type="text"
                    value={profile.experience_level}
                    onChange={(e) => update({ experience_level: e.target.value })}
                    className="w-full bg-[#0B0F17] border border-slate-800 rounded-md px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-400 mb-1 block">
                    Full-Time Years
                  </label>
                  <input
                    type="number"
                    value={profile.experience_years}
                    onChange={(e) =>
                      update({ experience_years: Math.max(0, parseInt(e.target.value) || 0) })
                    }
                    className="w-full bg-[#0B0F17] border border-slate-800 rounded-md px-3 py-2 text-xs font-mono tabular-nums text-slate-100 focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>
            </div>

            <div className="bg-[#111827] border border-slate-800 rounded-lg p-6 space-y-5">
              <h2 className="text-sm font-display font-semibold text-white border-b border-slate-800 pb-3">
                02. Target Roles, Hubs & Salary Floors
              </h2>
              <ArrayEditor
                label="Target Role Titles (40-Pt Role Pillar)"
                items={profile.target_roles}
                onChange={(v) => update({ target_roles: v })}
                placeholder="e.g. Associate Product Manager"
              />
              <ArrayEditor
                label="Target Hubs"
                items={profile.target_cities}
                onChange={(v) => update({ target_cities: v })}
                placeholder="e.g. Bengaluru"
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-slate-400 mb-1 block">
                    India Salary Floor (₹ LPA)
                  </label>
                  <input
                    type="number"
                    value={profile.min_salary_lpa}
                    onChange={(e) => update({ min_salary_lpa: parseInt(e.target.value) || 0 })}
                    className="w-full bg-[#0B0F17] border border-slate-800 rounded-md px-3 py-2 text-xs font-mono tabular-nums text-slate-100 focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-400 mb-1 block">
                    Global Salary Floor ($ USD/yr)
                  </label>
                  <input
                    type="number"
                    value={profile.min_salary_usd_annual}
                    onChange={(e) =>
                      update({ min_salary_usd_annual: parseInt(e.target.value) || 0 })
                    }
                    className="w-full bg-[#0B0F17] border border-slate-800 rounded-md px-3 py-2 text-xs font-mono tabular-nums text-slate-100 focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>
            </div>

            <div className="bg-[#111827] border border-slate-800 rounded-lg p-6 space-y-5">
              <h2 className="text-sm font-display font-semibold text-white border-b border-slate-800 pb-3">
                03. Proof Metrics & Skills
              </h2>
              <ArrayEditor
                label="Quantified Proof Metrics"
                items={profile.key_metrics}
                onChange={(v) => update({ key_metrics: v })}
                placeholder="e.g. ~425% organic search growth at Smatr AI"
              />
              <ArrayEditor
                label="Hard & Domain Skills (30-Pt Skill Pillar)"
                items={profile.skills}
                onChange={(v) => update({ skills: v })}
                placeholder="e.g. Python EDA, GA4, GTM Strategy"
              />
            </div>

            <div className="bg-[#111827] border border-slate-800 rounded-lg p-6 space-y-5">
              <h2 className="text-sm font-display font-semibold text-white border-b border-slate-800 pb-3">
                04. FreeHire Direct-ATS Company Slugs
              </h2>
              <ArrayEditor
                label="Greenhouse Boards"
                items={atsCompanies.greenhouse}
                onChange={(v) =>
                  update({ ats_companies: { ...atsCompanies, greenhouse: v } })
                }
                placeholder="e.g. stripe, razorpay, postman"
              />
              <ArrayEditor
                label="Lever Boards"
                items={atsCompanies.lever}
                onChange={(v) => update({ ats_companies: { ...atsCompanies, lever: v } })}
                placeholder="e.g. zepto, cred, mistral"
              />
              <ArrayEditor
                label="Ashby Boards"
                items={atsCompanies.ashby}
                onChange={(v) => update({ ats_companies: { ...atsCompanies, ashby: v } })}
                placeholder="e.g. linear, posthog, supabase"
              />
            </div>
          </div>

          <div className="lg:col-span-5 lg:sticky lg:top-20 bg-[#111827] border border-slate-800 rounded-lg p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-sm font-display font-semibold text-white">
                Compiled Rubric Context
              </h3>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(compiledPromptPreview);
                  setCopiedPrompt(true);
                  setTimeout(() => setCopiedPrompt(false), 1800);
                }}
                className="px-2.5 py-1 rounded text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 inline-flex items-center gap-1.5 cursor-pointer"
              >
                {copiedPrompt ? (
                  <>
                    <Check className="h-3 w-3 text-emerald-400" /> Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3" /> Copy
                  </>
                )}
              </button>
            </div>

            <pre className="bg-[#0B0F17] border border-slate-800 rounded-md p-4 text-[11px] font-mono text-slate-300 whitespace-pre-wrap leading-relaxed overflow-x-auto">
              {compiledPromptPreview}
            </pre>

            <p className="text-xs text-slate-400">
              Used by <span className="font-mono">scripts/scout.js</span> and{' '}
              <span className="font-mono">/api/evaluate</span>.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
