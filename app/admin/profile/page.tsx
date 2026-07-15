'use client';
import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Save, Plus, X, Loader2, CheckCircle, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';

interface Profile {
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

function ArrayEditor({ label, items, onChange, placeholder }: { label: string; items: string[]; onChange: (items: string[]) => void; placeholder?: string }) {
  const [newItem, setNewItem] = useState('');
  return (
    <div>
      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2 block">{label}</label>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {items.map((item, i) => (
          <span key={i} className="inline-flex items-center gap-1 bg-slate-800 border border-slate-700 text-slate-300 text-xs rounded-full px-3 py-1">
            {item}
            <button onClick={() => onChange(items.filter((_, j) => j !== i))} className="text-slate-500 hover:text-red-400 transition-colors"><X className="h-3 w-3" /></button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input type="text" value={newItem} onChange={(e) => setNewItem(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && newItem.trim()) { onChange([...items, newItem.trim()]); setNewItem(''); } }} placeholder={placeholder || 'Add item...'} className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500" />
        <Button variant="outline" size="sm" onClick={() => { if (newItem.trim()) { onChange([...items, newItem.trim()]); setNewItem(''); } }} className="bg-slate-900 border-slate-800 text-slate-400 h-8"><Plus className="h-3 w-3" /></Button>
      </div>
    </div>
  );
}

export default function ProfilePage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle');

  useEffect(() => {
    fetch('/api/profile')
      .then(async res => {
        if (res.status === 401) { window.location.href = '/login'; return null; }
        if (!res.ok) throw new Error('Failed');
        return res.json();
      })
      .then(data => { if (data) setProfile(data); setLoading(false); })
      .catch(() => { setLoading(false); });
  }, []);

  const save = async () => {
    if (!profile) return;
    setSaving(true);
    setStatus('idle');
    try {
      const res = await fetch('/api/profile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(profile) });
      if (!res.ok) throw new Error('Save failed');
      setStatus('saved');
      setTimeout(() => setStatus('idle'), 3000);
    } catch { setStatus('error'); }
    setSaving(false);
  };

  const update = (patch: Partial<Profile>) => setProfile(prev => prev ? { ...prev, ...patch } : prev);

  if (loading) return <div className="flex-1 flex items-center justify-center text-slate-500 font-mono text-xs">Loading profile...</div>;
  if (!profile) return <div className="flex-1 flex items-center justify-center text-red-400 font-mono text-xs">Failed to load profile.</div>;

  return (
    <div className="flex flex-col flex-1 w-full bg-slate-950 text-slate-50">
      <motion.main initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="flex-1 py-6 px-4 sm:px-6 lg:px-8 max-w-4xl mx-auto w-full pb-24">
        <div className="flex items-center justify-between mb-8 border-b border-slate-800 pb-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white">Profile</h1>
            <p className="text-xs text-slate-500 mt-1">Configure what the scout engine looks for</p>
          </div>
          <Button onClick={save} disabled={saving} className="bg-emerald-600 hover:bg-emerald-500 text-white">
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : status === 'saved' ? <CheckCircle className="h-4 w-4 mr-2" /> : status === 'error' ? <AlertCircle className="h-4 w-4 mr-2" /> : <Save className="h-4 w-4 mr-2" />}
            {saving ? 'Saving...' : status === 'saved' ? 'Saved' : status === 'error' ? 'Error' : 'Save'}
          </Button>
        </div>

        <div className="space-y-6">
          {/* Identity */}
          <Card className="bg-slate-900 border-slate-800">
            <CardHeader className="pb-3"><h3 className="text-sm font-bold text-slate-200">Identity</h3></CardHeader>
            <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1 block">Name</label>
                <input type="text" value={profile.name} onChange={(e) => update({ name: e.target.value })} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-emerald-500" />
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1 block">Email</label>
                <input type="email" value={profile.email} onChange={(e) => update({ email: e.target.value })} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-emerald-500" />
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1 block">Experience Level</label>
                <input type="text" value={profile.experience_level} onChange={(e) => update({ experience_level: e.target.value })} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-emerald-500" />
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1 block">Experience Years</label>
                <input type="number" value={profile.experience_years} onChange={(e) => update({ experience_years: parseInt(e.target.value) || 0 })} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-emerald-500" />
              </div>
            </CardContent>
          </Card>

          {/* Targeting */}
          <Card className="bg-slate-900 border-slate-800">
            <CardHeader className="pb-3"><h3 className="text-sm font-bold text-slate-200">Targeting</h3></CardHeader>
            <CardContent className="space-y-4">
              <ArrayEditor label="Target Roles" items={profile.target_roles} onChange={(v) => update({ target_roles: v })} placeholder="e.g. Product Manager" />
              <ArrayEditor label="Target Cities" items={profile.target_cities} onChange={(v) => update({ target_cities: v })} placeholder="e.g. Bengaluru" />
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1 block">Min Salary (₹ LPA)</label>
                  <input type="number" value={profile.min_salary_lpa} onChange={(e) => update({ min_salary_lpa: parseInt(e.target.value) || 0 })} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-emerald-500" />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1 block">Min Salary ($ USD/yr)</label>
                  <input type="number" value={profile.min_salary_usd_annual} onChange={(e) => update({ min_salary_usd_annual: parseInt(e.target.value) || 0 })} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-emerald-500" />
                </div>
              </div>
              <div className="flex items-center gap-3">
                <input type="checkbox" checked={profile.open_to_relocation} onChange={(e) => update({ open_to_relocation: e.target.checked })} className="accent-emerald-500 rounded" />
                <label className="text-xs text-slate-300">Open to relocation</label>
              </div>
              {profile.open_to_relocation && (
                <ArrayEditor label="Preferred Regions" items={profile.relocation_preference?.preferred_regions || []} onChange={(v) => update({ relocation_preference: { ...profile.relocation_preference, preferred_regions: v } })} placeholder="e.g. UAE" />
              )}
            </CardContent>
          </Card>

          {/* Skills & Metrics */}
          <Card className="bg-slate-900 border-slate-800">
            <CardHeader className="pb-3"><h3 className="text-sm font-bold text-slate-200">Skills & Metrics</h3></CardHeader>
            <CardContent className="space-y-4">
              <ArrayEditor label="Skills" items={profile.skills} onChange={(v) => update({ skills: v })} placeholder="e.g. SEO" />
              <ArrayEditor label="Key Metrics" items={profile.key_metrics} onChange={(v) => update({ key_metrics: v })} placeholder="e.g. 425% organic growth" />
              <ArrayEditor label="Languages" items={profile.languages} onChange={(v) => update({ languages: v })} placeholder="e.g. English (fluent)" />
            </CardContent>
          </Card>

          {/* Links */}
          <Card className="bg-slate-900 border-slate-800">
            <CardHeader className="pb-3"><h3 className="text-sm font-bold text-slate-200">Links</h3></CardHeader>
            <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1 block">Portfolio URL</label>
                <input type="url" value={profile.portfolio} onChange={(e) => update({ portfolio: e.target.value })} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-emerald-500" />
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1 block">Resume URL</label>
                <input type="url" value={profile.resume_synthesizer_url} onChange={(e) => update({ resume_synthesizer_url: e.target.value })} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-emerald-500" />
              </div>
            </CardContent>
          </Card>
        </div>
      </motion.main>
    </div>
  );
}
