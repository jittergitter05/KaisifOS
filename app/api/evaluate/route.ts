import { NextRequest, NextResponse } from 'next/server';
import { getCandidateProfile } from '@/lib/profile';
import { evaluateJobWithFreeChain } from '@/lib/llm';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const job = {
      title: String(body.title || 'Associate Product Marketing Manager').trim().slice(0, 200),
      company: String(body.company || 'Raycast').trim().slice(0, 160),
      location: String(body.location || 'Bengaluru / Remote').trim().slice(0, 160),
      salary: String(body.salary || '₹12 LPA / $45,000 USD').trim().slice(0, 120),
      description: String(body.description || '').trim().slice(0, 8000),
    };

    const profile = getCandidateProfile();
    const evaluation = await evaluateJobWithFreeChain(job, profile);
    return NextResponse.json(evaluation);
  } catch (err) {
    console.error('[Evaluate API] Error:', err);
    return NextResponse.json({ error: 'Failed to evaluate job' }, { status: 500 });
  }
}
