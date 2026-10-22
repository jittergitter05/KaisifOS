import { NextRequest, NextResponse } from 'next/server';
import { generateRolePrepPack } from '@/lib/prep-engine';
import { getCandidateProfile } from '@/lib/profile';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const job = {
      title: String(body.title || 'Target Role').trim().slice(0, 200),
      company: String(body.company || 'Target Company').trim().slice(0, 160),
      reasons: String(body.reasons || '').trim().slice(0, 1000),
      gap: String(body.gap || '').trim().slice(0, 600),
      description: String(body.description || '').trim().slice(0, 8000),
    };

    const profile = getCandidateProfile();
    const pack = await generateRolePrepPack(job, profile);

    return NextResponse.json(pack);
  } catch (err) {
    console.error('[Prep API] Error:', err);
    return NextResponse.json({ error: 'Failed to generate role prep pack' }, { status: 500 });
  }
}
