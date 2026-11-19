import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { isAuthorizedRequest, isSameOriginRequest } from '@/lib/auth';
import { executeLiveScoutRun } from '@/lib/scout-runner';
import { parseWorkdayBoardTarget, type WorkdayBoardTarget } from '@/lib/profile';
import { checkRateLimit, extractClientIp } from '@/lib/rate-limit';
import { redactSecrets, validateSafePublicUrl } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function sanitizeSlugArray(val: unknown): string[] | undefined {
  if (!Array.isArray(val)) return undefined;
  return val
    .map((s) => String(s ?? '').trim().toLowerCase())
    .filter((s) => /^[a-z0-9][a-z0-9._-]{0,62}$/.test(s))
    .slice(0, 12);
}

function sanitizeCustomBoards(raw: unknown) {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;

  let workday: WorkdayBoardTarget[] | undefined;
  if (Array.isArray(obj.workday)) {
    workday = obj.workday
      .map((item) => parseWorkdayBoardTarget(item))
      .filter((w): w is WorkdayBoardTarget => Boolean(w))
      .slice(0, 12);
  }

  let careerUrls: string[] | undefined;
  if (Array.isArray(obj.career_urls)) {
    careerUrls = obj.career_urls
      .map((u) => String(u ?? '').trim())
      .filter((u) => validateSafePublicUrl(u, { allowLocalDev: false }).ok)
      .slice(0, 12);
  }

  return {
    greenhouse: sanitizeSlugArray(obj.greenhouse),
    lever: sanitizeSlugArray(obj.lever),
    ashby: sanitizeSlugArray(obj.ashby),
    workable: sanitizeSlugArray(obj.workable),
    smartrecruiters: sanitizeSlugArray(obj.smartrecruiters),
    recruitee: sanitizeSlugArray(obj.recruitee),
    workday,
    career_urls: careerUrls,
  };
}

export async function GET() {
  return NextResponse.json({
    sources: [
      { id: 'workday', name: 'Workday CXS Direct ATS', type: 'Enterprise Indian MNC Career Boards', free: true },
      { id: 'career_pages', name: 'Direct Company Career Pages (incl. Keka & Darwinbox)', type: 'Official Career Portals (JSON-LD & ATS Embeds)', free: true },
      { id: 'greenhouse', name: 'Greenhouse Direct ATS', type: 'Direct Company ATS', free: true },
      { id: 'ashby', name: 'Ashby Direct ATS', type: 'Direct Company ATS', free: true },
      { id: 'lever', name: 'Lever Direct ATS', type: 'Direct Company ATS', free: true },
      { id: 'workable', name: 'Workable Direct ATS', type: 'Direct Company ATS', free: true },
      { id: 'smartrecruiters', name: 'SmartRecruiters Direct ATS', type: 'Direct Company ATS', free: true },
      { id: 'recruitee', name: 'Recruitee Direct ATS', type: 'Direct Company ATS', free: true },
      { id: 'remoteok', name: 'RemoteOK Public API', type: 'Global Remote Board', free: true },
      { id: 'remotive', name: 'Remotive Public API', type: 'Global Remote Board', free: true },
      { id: 'himalayas', name: 'Himalayas Public API', type: 'Global Remote Board', free: true },
      { id: 'arbeitnow', name: 'Arbeitnow Visa Board', type: 'EU & Visa-Sponsored', free: true },
      { id: 'themuse', name: 'TheMuse Public API', type: 'Entry/Mid Tech & GTM', free: true },
      { id: 'webhook_clipper', name: 'Alert Email Webhook & 1-Click Clipper', type: 'Naukri / LinkedIn / Wellfound Ingestion', free: true },
      ...(process.env.FREEHIRE_API_URL
        ? [{ id: 'freehire', name: 'FreeHire Custom Endpoint', type: 'Custom ATS Feed', free: true }]
        : []),
    ],
  });
}

export async function POST(req: NextRequest) {
  if (!isSameOriginRequest(req.headers)) {
    return NextResponse.json({ error: 'Cross-origin request blocked.' }, { status: 403 });
  }

  const ip = extractClientIp(req.headers);
  const limit = checkRateLimit(`scout:run:${ip}`, 8, 5 * 60 * 1000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: `Scout rate limit exceeded. Retry in ${limit.retryAfterSeconds}s.` },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } }
    );
  }

  const cookieStore = cookies();
  const authCookie = cookieStore.get('kaisifos_auth')?.value;
  const lockedCookie = cookieStore.get('kaisifos_locked')?.value;
  if (!(await isAuthorizedRequest(authCookie, lockedCookie))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const minScoreToCommit =
      typeof body.minScoreToCommit === 'number' && Number.isFinite(body.minScoreToCommit)
        ? Math.min(100, Math.max(0, body.minScoreToCommit))
        : 80;
    const maxToEvaluate =
      typeof body.maxToEvaluate === 'number' && Number.isFinite(body.maxToEvaluate)
        ? Math.min(12, Math.max(2, body.maxToEvaluate))
        : 6;

    const summary = await executeLiveScoutRun({
      minScoreToCommit,
      maxToEvaluate,
      customBoards: sanitizeCustomBoards(body.customBoards),
      mode: body.mode === 'retry_pending' ? 'retry_pending' : 'live_sweep',
    });

    return NextResponse.json(summary);
  } catch (err: unknown) {
    const message = redactSecrets((err as Error)?.message || 'Scout execution failed', 240);
    const isReadOnly = /read-only|GOOGLE_SHEET_ID|persisting/i.test(message);
    console.error('[Scout Run API] Error:', message);
    return NextResponse.json(
      { error: message },
      { status: isReadOnly ? 503 : 500 }
    );
  }
}
