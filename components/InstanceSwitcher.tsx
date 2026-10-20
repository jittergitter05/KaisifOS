'use client';
import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { UserCheck, Sparkles, Check, RefreshCw, Sliders } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface InstanceSwitcherProps {
  currentProfile: {
    system_name?: string;
    name: string;
    target_roles: string[];
    target_cities: string[];
    min_salary_lpa: number;
    min_salary_usd_annual: number;
    experience_level: string;
    experience_years: number;
    key_metrics: string[];
    skills: string[];
    email: string;
    open_to_relocation: boolean;
    relocation_preference: {
      willing: boolean;
      requirements: string[];
      preferred_regions: string[];
      avoid: string[];
    };
    portfolio: string;
    languages: string[];
    resume_synthesizer_url: string;
  };
}

const PERSONA_OPTIONS = [
  {
    key: 'pm_growth',
    label: 'Product / Growth (Kaisif Default)',
    desc: 'APM, PMM & Growth roles · Bengaluru / Hyderabad / Global Relo',
  },
  {
    key: 'swe_ai',
    label: 'Full-Stack / AI Engineer',
    desc: 'SWE & Founding AI Engineer · Remote / SF / London ($85k+)',
  },
  {
    key: 'data_ml',
    label: 'Data Science & ML',
    desc: 'Data Scientist & ML Engineer · Python, SQL, PyTorch, dbt',
  },
  {
    key: 'blank_fork',
    label: 'Blank Fork Template',
    desc: 'Clean white-label template ready for your own identity',
  },
];

export default function InstanceSwitcher({ currentProfile }: InstanceSwitcherProps) {
  const router = useRouter();
  const [openCustom, setOpenCustom] = useState(false);
  const [systemName, setSystemName] = useState(currentProfile.system_name || 'CareerOS');
  const [ownerName, setOwnerName] = useState(currentProfile.name || '');
  const [rolesText, setRolesText] = useState(
    currentProfile.target_roles.slice(0, 4).join(', ')
  );
  const [citiesText, setCitiesText] = useState(currentProfile.target_cities.join(', '));
  const [leadMetric, setLeadMetric] = useState(
    currentProfile.key_metrics[0] || 'Delivered measurable impact across core KPIs'
  );
  const [saving, setSaving] = useState(false);
  const [savedBanner, setSavedBanner] = useState<string | null>(null);

  const applyPreset = async (presetKey: string) => {
    setSaving(true);
    setSavedBanner(null);
    try {
      const res = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ presetKey }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.profile) {
          setSystemName(data.profile.system_name || 'CareerOS');
          setOwnerName(data.profile.name);
          setRolesText(data.profile.target_roles.slice(0, 4).join(', '));
          setCitiesText(data.profile.target_cities.join(', '));
          setLeadMetric(data.profile.key_metrics[0] || '');
        }
        setSavedBanner('Instance recalibrated! Public page, evaluator & console now reflect this owner.');
        router.refresh();
      }
    } catch (e) {
      console.error('Preset switch failed:', e);
    } finally {
      setSaving(false);
    }
  };

  const saveQuickClaim = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSavedBanner(null);
    try {
      const updated = {
        ...currentProfile,
        system_name: systemName.trim() || 'CareerOS',
        name: ownerName.trim() || 'Instance Owner',
        target_roles: rolesText
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        target_cities: citiesText
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        key_metrics: [
          leadMetric.trim() || 'Delivered measurable product & engineering impact',
          ...currentProfile.key_metrics.slice(1),
        ],
      };

      const res = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      });
      if (res.ok) {
        setSavedBanner(`Instance claimed by ${updated.name} (${updated.system_name}).`);
        setOpenCustom(false);
        router.refresh();
      }
    } catch (err) {
      console.error('Quick claim error:', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-[#111827] border border-slate-800/90 rounded-xl p-6 space-y-5">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <div className="text-xs font-mono text-emerald-400 flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5" /> White-Label Fork & Ownership Calibration
          </div>
          <h3 className="text-base font-display font-semibold text-white mt-0.5">
            Own This Engine — Re-Target System to Your Identity in 1 Click
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Forked this repository? Switch to a role template or claim this instance with your own
            name, brand, roles, and proof metrics. All changes persist to{' '}
            <span className="font-mono text-slate-200">data/profile.json</span>.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setOpenCustom(!openCustom)}
            className="bg-[#0B0F17] border-slate-700 hover:bg-slate-800 text-slate-200 text-xs"
          >
            <Sliders className="h-3.5 w-3.5 mr-1.5 text-emerald-400" />
            {openCustom ? 'Hide Customizer' : 'Claim with Your Name & Brand'}
          </Button>
        </div>
      </div>

      {savedBanner && (
        <div className="bg-emerald-950/40 border border-emerald-700/60 text-emerald-300 px-4 py-2.5 rounded-lg text-xs flex items-center gap-2">
          <Check className="h-4 w-4 text-emerald-400 shrink-0" />
          <span>{savedBanner}</span>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {PERSONA_OPTIONS.map((p) => {
          const isCurrent =
            (p.key === 'pm_growth' && currentProfile.name.includes('Kaisif')) ||
            (p.key === 'swe_ai' && currentProfile.name.includes('Alex Rivera')) ||
            (p.key === 'data_ml' && currentProfile.name.includes('Priya Sharma')) ||
            (p.key === 'blank_fork' && currentProfile.name === 'Your Name Here');
          return (
            <button
              key={p.key}
              type="button"
              disabled={saving}
              onClick={() => applyPreset(p.key)}
              className={`text-left p-3.5 rounded-lg border transition-colors cursor-pointer flex flex-col justify-between ${
                isCurrent
                  ? 'bg-[#0D131F] border-emerald-500/80'
                  : 'bg-[#0B0F17] border-slate-800 hover:border-slate-700'
              }`}
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-display font-semibold text-white">{p.label}</span>
                  {isCurrent && (
                    <span className="text-[10px] font-mono text-emerald-400">Active</span>
                  )}
                </div>
                <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">{p.desc}</p>
              </div>
              <div className="mt-3 pt-2 border-t border-slate-800/80 text-[11px] font-mono text-emerald-400">
                Load Persona →
              </div>
            </button>
          );
        })}
      </div>

      {openCustom && (
        <form
          onSubmit={saveQuickClaim}
          className="bg-[#0B0F17] border border-slate-800 rounded-lg p-4 space-y-4"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">
                System Brand Name
              </label>
              <input
                type="text"
                value={systemName}
                onChange={(e) => setSystemName(e.target.value)}
                placeholder="e.g. CareerOS, AlexOS"
                className="w-full bg-[#111827] border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">
                Your Full Name (Instance Owner)
              </label>
              <input
                type="text"
                value={ownerName}
                onChange={(e) => setOwnerName(e.target.value)}
                placeholder="Your Name"
                className="w-full bg-[#111827] border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">
                Target Roles (Comma-separated)
              </label>
              <input
                type="text"
                value={rolesText}
                onChange={(e) => setRolesText(e.target.value)}
                placeholder="Product Manager, Growth Lead"
                className="w-full bg-[#111827] border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">
                Target Cities / Remote
              </label>
              <input
                type="text"
                value={citiesText}
                onChange={(e) => setCitiesText(e.target.value)}
                placeholder="Remote, Bengaluru, London"
                className="w-full bg-[#111827] border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
            <div className="flex-1">
              <label className="block text-xs font-medium text-slate-400 mb-1">
                Primary Quantified Proof Metric (Injected into Synthesized Outreach DMs)
              </label>
              <input
                type="text"
                value={leadMetric}
                onChange={(e) => setLeadMetric(e.target.value)}
                placeholder="e.g. Scaled organic conversion by 320% in 6 months"
                className="w-full bg-[#111827] border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
              />
            </div>
            <Button
              type="submit"
              disabled={saving}
              className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium px-4 py-2 whitespace-nowrap shrink-0"
            >
              {saving ? (
                <>
                  <RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Applying...
                </>
              ) : (
                <>
                  <UserCheck className="h-3.5 w-3.5 mr-1.5" /> Apply Ownership to Entire App
                </>
              )}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
