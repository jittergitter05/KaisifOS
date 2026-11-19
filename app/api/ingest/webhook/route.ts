import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  isAuthorizedRequest,
  isCustomAuthConfigured,
  isSameOriginRequest,
} from '@/lib/auth';
import { getCandidateProfileAsync } from '@/lib/profile';
import {
  ingestJobsIntoPipeline,
  parseAlertEmailToJobs,
} from '@/lib/ingest';
import { checkRateLimit, extractClientIp } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
export const maxDuration = 45;

function verifyBearerWebhookSecret(authHeader: string | null): boolean {
  const configuredSecret = process.env.INGEST_WEBHOOK_SECRET?.trim() || '';
  if (!configuredSecret || !authHeader) return false;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;
  const provided = match[1].trim();
  if (!provided) return false;

  // Constant-time comparison of SHA-256 hashes prevents length oracle and timing attacks
  const expectedDigest = crypto.createHash('sha256').update(configuredSecret).digest();
  const providedDigest = crypto.createHash('sha256').update(provided).digest();
  return crypto.timingSafeEqual(expectedDigest, providedDigest);
}

export async function GET() {
  const cookieStore = cookies();
  const authCookie = cookieStore.get('kaisifos_auth')?.value;
  const lockedCookie = cookieStore.get('kaisifos_locked')?.value;

  if (!(await isAuthorizedRequest(authCookie, lockedCookie))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return NextResponse.json({
    ok: true,
    webhookSecretConfigured: Boolean(process.env.INGEST_WEBHOOK_SECRET?.trim()),
    authConfigured: isCustomAuthConfigured(),
    endpointPath: '/api/ingest/webhook',
    supportedChannels: [
      'Naukri Email Alert (Google Apps Script)',
      'LinkedIn Job Alert (Google Apps Script)',
      'Wellfound / Instahire Alert Email',
      '1-Click Clipper (/admin/clip)',
    ],
  });
}

export async function POST(request: NextRequest) {
  const ip = extractClientIp(request.headers);
  const limit = checkRateLimit(`ingest-webhook:${ip}`, 30, 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded for ingestion endpoint.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } }
    );
  }

  const authHeader = request.headers.get('authorization');
  const hasBearer = Boolean(authHeader && /^Bearer\s+/i.test(authHeader));

  let isAuthenticatedClipperSession = false;
  if (hasBearer) {
    if (!verifyBearerWebhookSecret(authHeader)) {
      return NextResponse.json(
        { error: 'Invalid or unconfigured INGEST_WEBHOOK_SECRET bearer token.' },
        { status: 401 }
      );
    }
  } else {
    const cookieStore = cookies();
    const authCookie = cookieStore.get('kaisifos_auth')?.value;
    const lockedCookie = cookieStore.get('kaisifos_locked')?.value;
    const sessionOk = await isAuthorizedRequest(authCookie, lockedCookie);
    if (!sessionOk) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!isSameOriginRequest(request.headers)) {
      return NextResponse.json(
        { error: 'Cross-origin browser POST requires Authorization: Bearer <INGEST_WEBHOOK_SECRET>.' },
        { status: 403 }
      );
    }
    isAuthenticatedClipperSession = true;
  }

  try {
    const body = await request.json();
    const requestedChannel =
      body?.channel === 'clipper' && isAuthenticatedClipperSession ? 'clipper' : 'webhook';

    const candidates = parseAlertEmailToJobs(body, requestedChannel);
    if (candidates.length === 0) {
      return NextResponse.json(
        {
          error:
            'No valid public job postings or alert links found in payload. Provide { title, company, url } or forwarded alert email { from, subject, textBody, htmlBody }.',
        },
        { status: 400 }
      );
    }

    const profile = await getCandidateProfileAsync();
    const summary = await ingestJobsIntoPipeline(candidates, profile, {
      channel: requestedChannel,
      allowBelowThresholdCommit:
        isAuthenticatedClipperSession && body?.forceSave === true,
      skipDuplicateCheck:
        isAuthenticatedClipperSession && body?.forceRescore === true,
      autoEnrichUrls: body?.autoEnrichUrls !== false,
    });

    return NextResponse.json({
      success: true,
      ...summary,
    });
  } catch (err) {
    console.error('[Ingest Webhook] Error:', err);
    return NextResponse.json(
      { error: 'Failed to process ingestion payload.' },
      { status: 500 }
    );
  }
}
