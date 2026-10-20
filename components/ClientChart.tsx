'use client';
import React from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';

export default function ClientChart({ data }: { data: { date: string; avgScore: number; count?: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
        <defs>
          <linearGradient id="scoreGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#10B981" stopOpacity={0.35} />
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
            borderRadius: '8px',
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
