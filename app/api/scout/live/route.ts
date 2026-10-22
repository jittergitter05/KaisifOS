import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { isAuthorizedRequest } from '@/lib/auth';
import { getCandidateProfile } from '@/lib/profile';
import { deterministicEvaluateJob } from '@/lib/llm';
import { appendLocalJobRecord, readLocalJobRows } from '@/lib/sheets';

interface RawAtsJob {
  id: string;
  title: string;
  company: string;
  location: string;
  url: string;
  description: string;
}

export async function POST() {
  const cookieStore = cookies();
  const authCookie = cookieStore.get('kaisifos_auth')?.value;
  const lockedCookie = cookieStore.get('kaisifos_locked')?.value;
  if (!(await isAuthorizedRequest(authCookie, lockedCookie))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const profile = getCandidateProfile();
    const ats = profile.ats_companies || {
      greenhouse: ['razorpay', 'postman', 'vercel'],
      lever: ['zepto', 'cred'],
      ashby: ['linear', 'posthog', 'supabase'],
    };

    const discovered: RawAtsJob[] = [];

    // 1. Greenhouse Direct-ATS (strelov1/freehire architecture)
    await Promise.allSettled(
      (ats.greenhouse || []).slice(0, 3).map(async (slug) => {
        const res = await fetch(
          `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs?content=true`,
          { signal: AbortSignal.timeout(5000) }
        );
        if (!res.ok) return;
        const data = await res.json();
        for (const j of (data.jobs || []).slice(0, 8)) {
          discovered.push({
            id: `greenhouse_${slug}_${j.id}`,
            title: String(j.title || ''),
            company: slug.charAt(0).toUpperCase() + slug.slice(1),
            location: String(j.location?.name || 'Remote / Hybrid'),
            url: String(j.absolute_url || `https://boards.greenhouse.io/${slug}`),
            description: String(j.content || '').replace(/<[^>]*>/g, ' ').slice(0, 800),
          });
        }
      })
    );

    // 2. Lever Direct-ATS (strelov1/freehire architecture)
    await Promise.allSettled(
      (ats.lever || []).slice(0, 3).map(async (slug) => {
        const res = await fetch(
          `https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`,
          { signal: AbortSignal.timeout(5000) }
        );
        if (!res.ok) return;
        const data = await res.json();
        if (!Array.isArray(data)) return;
        for (const j of data.slice(0, 8)) {
          discovered.push({
            id: `lever_${slug}_${j.id}`,
            title: String(j.text || ''),
            company: slug.charAt(0).toUpperCase() + slug.slice(1),
            location: String(j.categories?.location || 'Remote / Hybrid'),
            url: String(j.hostedUrl || j.applyUrl || ''),
            description: String(j.descriptionPlain || j.description || '')
              .replace(/<[^>]*>/g, ' ')
              .slice(0, 800),
          });
        }
      })
    );

    // 3. Ashby Direct-ATS (strelov1/freehire architecture)
    await Promise.allSettled(
      (ats.ashby || []).slice(0, 3).map(async (slug) => {
        const res = await fetch(
          `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}`,
          { signal: AbortSignal.timeout(5000) }
        );
        if (!res.ok) return;
        const data = await res.json();
        for (const j of (data.jobs || []).slice(0, 8)) {
          discovered.push({
            id: `ashby_${slug}_${j.id}`,
            title: String(j.title || ''),
            company: slug.charAt(0).toUpperCase() + slug.slice(1),
            location: String(j.location || 'Remote'),
            url: String(j.jobUrl || j.applyUrl || ''),
            description: String(j.descriptionPlain || '').slice(0, 800),
          });
        }
      })
    );

    // 4. Remotive Live API
    try {
      const res = await fetch('https://remotive.com/api/remote-jobs?limit=12', {
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const data = await res.json();
        for (const j of (data.jobs || []).slice(0, 10)) {
          discovered.push({
            id: `remotive_${j.id}`,
            title: String(j.title || ''),
            company: String(j.company_name || 'Remote Partner'),
            location: String(j.candidate_required_location || 'Remote'),
            url: String(j.url || ''),
            description: String(j.description || '').replace(/<[^>]*>/g, ' ').slice(0, 800),
          });
        }
      }
    } catch {}

    // Filter against existing IDs
    const existingRows = readLocalJobRows();
    const existingIds = new Set(existingRows.slice(1).map((r) => r[1]));

    const scored = discovered
      .filter((j) => j.title && !existingIds.has(j.id))
      .map((j) => {
        const evalRes = deterministicEvaluateJob(
          {
            title: j.title,
            company: j.company,
            location: j.location,
            salary: 'Competitive',
            description: j.description,
          },
          profile
        );
        return { job: j, evalRes };
      })
      .sort((a, b) => b.evalRes.score - a.evalRes.score);

    const committed: string[] = [];
    for (const item of scored.slice(0, 3)) {
      appendLocalJobRecord({
        date: new Date().toISOString().split('T')[0],
        id: item.job.id,
        title: item.job.title,
        company: item.job.company,
        score: item.evalRes.score,
        reasons: item.evalRes.match_reasons.join(' | '),
        gap: item.evalRes.gap,
        url: item.job.url,
        dm: item.evalRes.dm_draft,
        resumeAngle: item.evalRes.resume_angle,
        status: item.evalRes.score >= 90 ? 'SHORTLISTED' : 'NEW',
      });
      committed.push(`${item.job.title} @ ${item.job.company} (${item.evalRes.score}/100)`);
    }

    return NextResponse.json({
      scanned: discovered.length,
      addedCount: committed.length,
      addedRoles: committed,
    });
  } catch (err) {
    console.error('[Live Scout API] Error:', err);
    return NextResponse.json({ error: 'Live scout run failed' }, { status: 500 });
  }
}
