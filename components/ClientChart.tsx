'use client';
import React, { useState } from 'react';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Cell,
} from 'recharts';

export interface ScoreTrendPoint {
  date: string;
  avgScore: number;
  count?: number;
}

export interface FunnelStagePoint {
  stage: string;
  count: number;
  conversionPct: number;
}

export interface SourceYieldPoint {
  source: string;
  count: number;
  avgScore: number;
}

export interface PillarPoint {
  pillar: string;
  earned: number;
  max: number;
  pct: number;
}

interface ClientChartProps {
  data: ScoreTrendPoint[];
  funnelData?: FunnelStagePoint[];
  sourceYieldData?: SourceYieldPoint[];
  pillarData?: PillarPoint[];
  mode?: 'compact' | 'full';
}

export default function ClientChart({
  data,
  funnelData = [],
  sourceYieldData = [],
  pillarData = [],
  mode = 'compact',
}: ClientChartProps) {
  const [activeTab, setActiveTab] = useState<'trend' | 'funnel' | 'sources' | 'pillars'>('trend');

  if (mode === 'compact' && funnelData.length === 0) {
    return (
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
          <defs>
            <linearGradient id="scoreGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#10B981" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#10B981" stopOpacity={0.0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fill: '#64748B', fontSize: 10, fontFamily: 'var(--font-mono)' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            domain={[70, 100]}
            tick={{ fill: '#64748B', fontSize: 10, fontFamily: 'var(--font-mono)' }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: '#0F172A',
              border: '1px solid #334155',
              borderRadius: '6px',
              fontSize: '11px',
              fontFamily: 'var(--font-mono)',
            }}
            itemStyle={{ color: '#10B981' }}
            labelStyle={{ color: '#94A3B8', marginBottom: '2px' }}
          />
          <Area
            type="monotone"
            dataKey="avgScore"
            name="Mean Score"
            stroke="#10B981"
            strokeWidth={2}
            fillOpacity={1}
            fill="url(#scoreGradient)"
          />
        </AreaChart>
      </ResponsiveContainer>
    );
  }

  return (
    <div className="flex flex-col h-full w-full">
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3 mb-3 border-b border-slate-800">
        <div className="text-xs font-medium text-slate-300">
          {activeTab === 'trend' && '30-Day Match Conviction Trajectory'}
          {activeTab === 'funnel' && 'Pipeline Stage Conversion Funnel'}
          {activeTab === 'sources' && 'Source & FreeHire ATS Yield (Mean Fit Score)'}
          {activeTab === 'pillars' && '4-Pillar Rubric Efficiency (% of Max Pillar Points)'}
        </div>
        <div className="flex items-center gap-1 bg-[#0B0F17] border border-slate-800 p-0.5 rounded-md">
          {[
            { id: 'trend', label: 'Score Trend' },
            { id: 'funnel', label: 'Conversion Funnel' },
            { id: 'sources', label: 'Source & ATS Yield' },
            { id: 'pillars', label: '4-Pillar Rubric' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id as typeof activeTab)}
              className={`px-2.5 py-1 text-[11px] font-mono transition-colors rounded cursor-pointer whitespace-nowrap ${
                activeTab === tab.id
                  ? 'bg-slate-800 text-white font-medium'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 min-h-[190px] w-full">
        {activeTab === 'trend' && (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="scoreGradFull" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10B981" stopOpacity={0.28} />
                  <stop offset="95%" stopColor="#10B981" stopOpacity={0.0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fill: '#64748B', fontSize: 10, fontFamily: 'var(--font-mono)' }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                domain={[75, 100]}
                tick={{ fill: '#64748B', fontSize: 10, fontFamily: 'var(--font-mono)' }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#0F172A',
                  border: '1px solid #334155',
                  borderRadius: '6px',
                  fontSize: '11px',
                  fontFamily: 'var(--font-mono)',
                }}
                itemStyle={{ color: '#10B981' }}
                labelStyle={{ color: '#94A3B8' }}
              />
              <Area
                type="monotone"
                dataKey="avgScore"
                name="Mean Fit Score"
                stroke="#10B981"
                strokeWidth={2}
                fillOpacity={1}
                fill="url(#scoreGradFull)"
              />
            </AreaChart>
          </ResponsiveContainer>
        )}

        {activeTab === 'funnel' && (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={funnelData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" vertical={false} />
              <XAxis
                dataKey="stage"
                tick={{ fill: '#64748B', fontSize: 10, fontFamily: 'var(--font-mono)' }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                allowDecimals={false}
                tick={{ fill: '#64748B', fontSize: 10, fontFamily: 'var(--font-mono)' }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#0F172A',
                  border: '1px solid #334155',
                  borderRadius: '6px',
                  fontSize: '11px',
                  fontFamily: 'var(--font-mono)',
                }}
              />
              <Bar dataKey="count" name="Roles in Stage" radius={[3, 3, 0, 0]}>
                {funnelData.map((_, idx) => (
                  <Cell
                    key={idx}
                    fill={idx >= 4 ? '#10B981' : idx >= 2 ? '#3B82F6' : '#64748B'}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}

        {activeTab === 'sources' && (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={sourceYieldData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" vertical={false} />
              <XAxis
                dataKey="source"
                tick={{ fill: '#64748B', fontSize: 10, fontFamily: 'var(--font-mono)' }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                domain={[70, 100]}
                tick={{ fill: '#64748B', fontSize: 10, fontFamily: 'var(--font-mono)' }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#0F172A',
                  border: '1px solid #334155',
                  borderRadius: '6px',
                  fontSize: '11px',
                  fontFamily: 'var(--font-mono)',
                }}
              />
              <Bar dataKey="avgScore" name="Mean Fit Score" fill="#10B981" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}

        {activeTab === 'pillars' && (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={pillarData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" vertical={false} />
              <XAxis
                dataKey="pillar"
                tick={{ fill: '#64748B', fontSize: 10, fontFamily: 'var(--font-mono)' }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                domain={[0, 100]}
                tick={{ fill: '#64748B', fontSize: 10, fontFamily: 'var(--font-mono)' }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#0F172A',
                  border: '1px solid #334155',
                  borderRadius: '6px',
                  fontSize: '11px',
                  fontFamily: 'var(--font-mono)',
                }}
              />
              <Bar dataKey="pct" name="Pillar Score %" fill="#3B82F6" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
