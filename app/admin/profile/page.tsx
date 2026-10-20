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
  Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

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
}

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
            className="inline-flex items-center gap-1.5 bg-[#0B0F17] border border-slate-800 text-slate-200 text-xs rounded-md px-2.5 py-1"
          >
            {item}
            <button
              type="button"
              onClick={() => onChange(items.filter((_, j) => j !== i))}
              className="text-slate-500 hover:text-rose-400 transition-colors"
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
          className="flex-1 bg-[#0B0F17] border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
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

  const save = async () => {
    if (!profile) return;
    setSaving(true);
    setStatus('idle');
    try {
      const res = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profile),
      });
      if (!res.ok) throw new Error('Save failed');
      setStatus('saved');
      setTimeout(() => setStatus('idle'), 3000);
    } catch {
      setStatus('error');
    }
    setSaving(false);
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

  const update = (patch: Partial<Profile>) =>
    setProfile((prev) => (prev ? { ...prev, ...patch } : prev));

  const compiledPromptPreview = useMemo(() => {
    if (!profile) return '';
    const isFresher = profile.experience_years === 0;
    const targetCities = profile.target_cities.join(', ');
    const expRule = isFresher
      ? `2. Experience match (25 pts): Candidate is a FRESHER (0 full-time years). Full marks only if entry-level/junior/associate. Penalise (0/25) if 2+ years required.`
      : `2. Experience match (25 pts): Candidate has ${profile.experience_years} years of experience.`;
    const locRule = profile.open_to_relocation
      ? `3. Location (20 pts): Open to relocation globally (${profile.relocation_preference?.preferred_regions?.join(', ')}).`
      : `3. Location (20 pts): MUST be located in ${targetCities} or fully remote.`;

    return `SYSTEM INSTANCE: ${profile.system_name || 'CareerOS'}
CANDIDATE:
Name: ${profile.name}
Target Roles: ${profile.target_roles.join(', ')}
Base: ${targetCities}
Experience: ${profile.experience_level} — ${profile.experience_years} years
Key Metrics: ${profile.key_metrics.join(' | ')}
Skills: ${profile.skills.join(', ')}
Min Salary: ₹${profile.min_salary_lpa} LPA India / $${profile.min_salary_usd_annual} USD abroad

SCORING RUBRIC:
1. Role match (40 pts): Alignment with ${profile.target_roles.slice(0, 4).join(' / ')}
${expRule}
${locRule}
4. Salary (15 pts): ≥ ₹${profile.min_salary_lpa} LPA or ≥ $${profile.min_salary_usd_annual} USD`;
  }, [profile]);

  if (loading)
    return (
      <div className="flex-1 flex items-center justify-center p-12 text-slate-400 font-mono text-xs">
        Loading candidate targeting matrix...
      </div>
    );
  if (!profile)
    return (
      <div className="flex-1 flex items-center justify-center p-12 text-rose-400 font-mono text-xs">
        Failed to load profile.json.
      </div>
    );

  return (
    <div className="flex flex-col flex-1 w-full bg-[#0B0F17] text-[#F8FAFC]">
      <div className="flex-1 py-6 px-4 sm:px-6 lg:px-8 max-w-6xl mx-auto w-full pb-24 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800/90 pb-5">
          <div>
            <h1 className="text-2xl font-display font-bold tracking-tight text-white">
              Owner Identity, Brand & Targeting Matrix
            </h1>
            <p className="text-xs text-slate-400 mt-1">
              Changes persist directly to <span className="font-mono">data/profile.json</span> and
              re-brand the entire Public Workbench, Live Role Evaluator, and Daily Scout.
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
              ? 'Persisting...'
              : status === 'saved'
              ? 'Saved to profile.json'
              : status === 'error'
              ? 'Save Failed'
              : 'Save Owner Profile'}
          </Button>
        </div>

        {/* 1-Click Fork Persona Templates */}
        <div className="bg-[#111827] border border-slate-800/90 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-xs text-slate-300">
            <Sparkles className="h-4 w-4 text-emerald-400 shrink-0" />
            <span>
              <strong>Fork Quick-Start Templates:</strong> Load a pre-built persona or blank
              white-label template in 1 click:
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {[
              { key: 'blank_fork', label: 'Blank Fork Template' },
              { key: 'swe_ai', label: 'Full-Stack / AI SWE' },
              { key: 'data_ml', label: 'Data Science / ML' },
              { key: 'pm_growth', label: 'PM / Growth (Kaisif Ref)' },
            ].map((tpl) => (
              <button
                key={tpl.key}
                type="button"
                onClick={() => applyPreset(tpl.key)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-[#0B0F17] border border-slate-800 hover:border-emerald-500/60 text-slate-200 transition-colors cursor-pointer"
              >
                {tpl.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <div className="lg:col-span-7 space-y-6">
            <div className="bg-[#111827] border border-slate-800/90 rounded-xl p-6 space-y-4">
              <h2 className="text-sm font-display font-semibold text-white border-b border-slate-800 pb-3">
                01. System Brand & Owner Identity
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-slate-400 mb-1 block">
                    System Brand Name (Navbar & Console Title)
                  </label>
                  <input
                    type="text"
                    value={profile.system_name || 'CareerOS'}
                    onChange={(e) => update({ system_name: e.target.value })}
                    placeholder="e.g. CareerOS, ScoutOS, AlexOS"
                    className="w-full bg-[#0B0F17] border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-400 mb-1 block">
                    Owner Full Name
                  </label>
                  <input
                    type="text"
                    value={profile.name}
                    onChange={(e) => update({ name: e.target.value })}
                    className="w-full bg-[#0B0F17] border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-400 mb-1 block">Email</label>
                  <input
                    type="email"
                    value={profile.email}
                    onChange={(e) => update({ email: e.target.value })}
                    className="w-full bg-[#0B0F17] border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-400 mb-1 block">
                    Experience Level Label
                  </label>
                  <input
                    type="text"
                    value={profile.experience_level}
                    onChange={(e) => update({ experience_level: e.target.value })}
                    className="w-full bg-[#0B0F17] border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-400 mb-1 block">
                    Full-Time Experience (Years)
                  </label>
                  <input
                    type="number"
                    value={profile.experience_years}
                    onChange={(e) =>
                      update({ experience_years: Math.max(0, parseInt(e.target.value) || 0) })
                    }
                    className="w-full bg-[#0B0F17] border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono tabular-nums text-slate-100 focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>
            </div>

            <div className="bg-[#111827] border border-slate-800/90 rounded-xl p-6 space-y-5">
              <h2 className="text-sm font-display font-semibold text-white border-b border-slate-800 pb-3">
                02. Role Whitelist, Geography & Salary Floors
              </h2>
              <ArrayEditor
                label="Target Role Titles (Used for Whitelist Regex & 40-Pt Role Rubric)"
                items={profile.target_roles}
                onChange={(v) => update({ target_roles: v })}
                placeholder="e.g. Associate Product Manager"
              />
              <ArrayEditor
                label="Primary Target Cities"
                items={profile.target_cities}
                onChange={(v) => update({ target_cities: v })}
                placeholder="e.g. Bengaluru"
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-slate-400 mb-1 block">
                    Minimum India Compensation (₹ LPA)
                  </label>
                  <input
                    type="number"
                    value={profile.min_salary_lpa}
                    onChange={(e) => update({ min_salary_lpa: parseInt(e.target.value) || 0 })}
                    className="w-full bg-[#0B0F17] border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono tabular-nums text-slate-100 focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-400 mb-1 block">
                    Minimum International Compensation ($ USD/yr)
                  </label>
                  <input
                    type="number"
                    value={profile.min_salary_usd_annual}
                    onChange={(e) =>
                      update({ min_salary_usd_annual: parseInt(e.target.value) || 0 })
                    }
                    className="w-full bg-[#0B0F17] border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono tabular-nums text-slate-100 focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>
              <div className="flex items-center gap-3 pt-1">
                <input
                  id="relocation-toggle"
                  type="checkbox"
                  checked={profile.open_to_relocation}
                  onChange={(e) => update({ open_to_relocation: e.target.checked })}
                  className="accent-emerald-500 rounded"
                />
                <label htmlFor="relocation-toggle" className="text-xs text-slate-200">
                  Candidate is open to global relocation (enables +5–10 pt visa/housing bonus)
                </label>
              </div>
              {profile.open_to_relocation && (
                <ArrayEditor
                  label="Preferred Global Relocation Regions"
                  items={profile.relocation_preference?.preferred_regions || []}
                  onChange={(v) =>
                    update({
                      relocation_preference: {
                        ...profile.relocation_preference,
                        preferred_regions: v,
                      },
                    })
                  }
                  placeholder="e.g. UAE, Singapore, UK"
                />
              )}
            </div>

            <div className="bg-[#111827] border border-slate-800/90 rounded-xl p-6 space-y-5">
              <h2 className="text-sm font-display font-semibold text-white border-b border-slate-800 pb-3">
                03. Verified Proof Metrics & Skills (Injected into Outreach DMs)
              </h2>
              <ArrayEditor
                label="Quantified Proof Metrics (Ranked by Impact)"
                items={profile.key_metrics}
                onChange={(v) => update({ key_metrics: v })}
                placeholder="e.g. ~425% organic search growth at Smatr AI"
              />
              <ArrayEditor
                label="Core Technical & GTM Skills"
                items={profile.skills}
                onChange={(v) => update({ skills: v })}
                placeholder="e.g. Python EDA, GA4, GTM Strategy"
              />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                <div>
                  <label className="text-xs font-medium text-slate-400 mb-1 block">
                    Portfolio URL
                  </label>
                  <input
                    type="url"
                    value={profile.portfolio}
                    onChange={(e) => update({ portfolio: e.target.value })}
                    className="w-full bg-[#0B0F17] border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono text-slate-200 focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-400 mb-1 block">
                    Resume Synthesizer URL
                  </label>
                  <input
                    type="url"
                    value={profile.resume_synthesizer_url}
                    onChange={(e) => update({ resume_synthesizer_url: e.target.value })}
                    className="w-full bg-[#0B0F17] border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono text-slate-200 focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="lg:col-span-5 lg:sticky lg:top-20 bg-[#111827] border border-slate-800/90 rounded-xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <div className="text-xs text-emerald-400 font-mono">Live Compiler Output</div>
                <h3 className="text-sm font-display font-semibold text-white">
                  Generated LLM Scoring Prompt
                </h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(compiledPromptPreview);
                  setCopiedPrompt(true);
                  setTimeout(() => setCopiedPrompt(false), 1800);
                }}
                className="px-2.5 py-1 rounded text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 inline-flex items-center gap-1.5"
              >
                {copiedPrompt ? (
                  <>
                    <Check className="h-3 w-3 text-emerald-400" /> Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3" /> Copy Prompt
                  </>
                )}
              </button>
            </div>

            <pre className="bg-[#0B0F17] border border-slate-800 rounded-lg p-4 text-[11px] font-mono text-slate-300 whitespace-pre-wrap leading-relaxed overflow-x-auto">
              {compiledPromptPreview}
            </pre>

            <div className="text-xs text-slate-400 leading-relaxed">
              This prompt is compiled dynamically by <span className="font-mono">buildPrompt()</span>{' '}
              in <span className="font-mono">scripts/scout.js</span> and{' '}
              <span className="font-mono">/api/evaluate</span>.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
