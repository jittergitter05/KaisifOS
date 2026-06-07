'use client';
import React from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

export default function ClientChart({ data }: { data: any[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data}>
        <XAxis dataKey="date" hide />
        <YAxis hide domain={['dataMin - 5', 100]} />
        <Tooltip 
          contentStyle={{ backgroundColor: '#1E293B', border: '1px solid #334155', borderRadius: '8px', fontSize: '10px' }}
          itemStyle={{ color: '#10B981' }}
          labelStyle={{ color: '#94A3B8', marginBottom: '4px' }}
        />
        <Line type="monotone" dataKey="avgScore" name="Avg Score" stroke="#10B981" strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
