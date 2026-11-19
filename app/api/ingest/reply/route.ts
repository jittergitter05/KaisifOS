import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { isAuthorizedRequest, isSameOriginRequest } from '@/lib/auth';
import { checkRateLimit, extractClientIp } from '@/lib/rate-limit';
import {
  getNeonAppliedJobs,
  isCloudSheetsConfigured,
  isNeonPostgresConfigured,
  readLocalJobRecords,
  sanitizePlainField,
  updateCloudSheetRowFields,
  updateLocalJobRow,
  updateNeonJobFields,
} from '@/lib/sheets';
import {
  ActiveJobTarget,
  classifyRecruiterEmail,
  IncomingEmailPayload,
  matchEmailToActiveJobs,
} from '@/lib/reply-intelligence';
import { redactSecrets } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const ACTIVE_REPLY_STAGES = new Set(['APPLIED', 'OUTREACH_DRAFTED', 'REPLIED', 'INTERVIEW']);

function verifyBearerWebhookSecret(authHeader: string | null): boolean {
  const configuredSecret = process.env.INGEST_WEBHOOK_SECRET?.trim() || '';
  if (!configuredSecret || !authHeader) return false;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;
  const provided = match[1].trim();
  if (!provided) return false;

  const expectedDigest = crypto.createHash('sha256').update(configuredSecret).digest();
  const providedDigest = crypto.createHash('sha256').update(provided).digest();
  return crypto.timingSafeEqual(expectedDigest, providedDigest);
}

async function authorizeReplyRequest(
  request: NextRequest,
  requireSameOriginOnCookie: boolean
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const authHeader = request.headers.get('authorization');
  const hasBearer = Boolean(authHeader && /^Bearer\s+/i.test(authHeader));

  if (hasBearer) {
    if (!verifyBearerWebhookSecret(authHeader)) {
      return {
        ok: false,
        status: 401,
        error: 'Invalid or unconfigured INGEST_WEBHOOK_SECRET bearer token.',
      };
    }
    return { ok: true };
  }

  const cookieStore = cookies();
  const authCookie = cookieStore.get('kaisifos_auth')?.value;
  const lockedCookie = cookieStore.get('kaisifos_locked')?.value;
  const sessionOk = await isAuthorizedRequest(authCookie, lockedCookie);
  if (!sessionOk) {
    return { ok: false, status: 401, error: 'Unauthorized' };
  }
  if (requireSameOriginOnCookie && !isSameOriginRequest(request.headers)) {
    return {
      ok: false,
      status: 403,
      error: 'Cross-origin browser POST requires Authorization: Bearer <INGEST_WEBHOOK_SECRET>.',
    };
  }
  return { ok: true };
}

async function loadActiveReplyTargets(): Promise<ActiveJobTarget[]> {
  if (isNeonPostgresConfigured()) {
    try {
      const neonApplied = await getNeonAppliedJobs(200);
      if (Array.isArray(neonApplied) && neonApplied.length > 0) {
        return neonApplied.map((j) => ({
          id: j.id,
          canonicalKey: j.canonicalKey,
          title: j.title,
          company: j.company,
          status: j.status || 'APPLIED',
        }));
      }
    } catch (err) {
      console.warn('[ingest/reply] Neon active jobs lookup failed:', redactSecrets((err as Error).message));
    }
  }

  const local = readLocalJobRecords();
  return local
    .filter((r) => ACTIVE_REPLY_STAGES.has(String(r.status || '').toUpperCase()))
    .slice(0, 200)
    .map((r) => ({
      id: r.id,
      canonicalKey: r.canonicalKey,
      title: r.title,
      company: r.company,
      status: String(r.status || 'APPLIED').toUpperCase(),
    }));
}

async function sendDiscordReplyNotification(payload: {
  company: string;
  title: string;
  classification: string;
  targetStage: string;
  subject: string;
  summary: string;
}) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL?.trim();
  if (!webhookUrl || !/^https:\/\/discord(?:app)?\.com\/api\/webhooks\//i.test(webhookUrl)) {
    return;
  }

  const colorMap: Record<string, number> = {
    INTERVIEW: 0x10b981,
    REPLIED: 0x3b82f6,
    REJECTED: 0xef4444,
  };

  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        embeds: [
          {
            title:
              payload.targetStage === 'INTERVIEW'
                ? `Interview Signal: ${payload.company}`
                : payload.targetStage === 'REJECTED'
                ? `Status Update (Rejected): ${payload.company}`
                : `Recruiter Reply: ${payload.company}`,
            description: `**Role:** ${payload.title}\n**Stage Updated To:** \`${payload.targetStage}\`\n**Subject:** ${payload.subject.slice(0, 140)}\n**Summary:** ${payload.summary.slice(0, 220)}`,
            color: colorMap[payload.targetStage] ?? 0x6366f1,
            timestamp: new Date().toISOString(),
          },
        ],
      }),
      signal: AbortSignal.timeout(6000),
    });
  } catch (err) {
    console.warn('[ingest/reply] Discord notification failed:', redactSecrets((err as Error).message));
  }
}

export async function GET(request: NextRequest) {
  const ip = extractClientIp(request.headers);
  const limit = checkRateLimit(`ingest-reply:get:${ip}`, 60, 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } }
    );
  }

  const auth = await authorizeReplyRequest(request, false);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const activeJobs = await loadActiveReplyTargets();
  const companies = Array.from(
    new Set(activeJobs.map((j) => j.company.trim()).filter((c) => c.length >= 2))
  );

  return NextResponse.json({
    ok: true,
    endpointPath: '/api/ingest/reply',
    webhookSecretConfigured: Boolean(process.env.INGEST_WEBHOOK_SECRET?.trim()),
    activeCount: activeJobs.length,
    companies,
    activeJobs,
  });
}

export async function POST(request: NextRequest) {
  const ip = extractClientIp(request.headers);
  const limit = checkRateLimit(`ingest-reply:post:${ip}`, 60, 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded for reply ingestion endpoint.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } }
    );
  }

  const auth = await authorizeReplyRequest(request, true);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const body = await request.json();
    const rawMessages: unknown[] = Array.isArray(body?.messages)
      ? body.messages.slice(0, 25)
      : body && (body.from || body.subject || body.body || body.snippet)
      ? [body]
      : [];

    if (rawMessages.length === 0) {
      return NextResponse.json(
        {
          error:
            'Provide an email payload { from, subject, snippet?, body?, date? } or { messages: [...] }.',
        },
        { status: 400 }
      );
    }

    const activeJobs = await loadActiveReplyTargets();
    let matchedCount = 0;
    let updatedCount = 0;
    let ignoredAutoAckCount = 0;

    const outcomes: Array<{
      subject: string;
      from: string;
      classification: string;
      targetStage: string | null;
      confidence: string;
      matchedJobs: Array<{ id: string; company: string; title: string; updated: boolean }>;
      summary: string;
    }> = [];

    for (const raw of rawMessages) {
      if (!raw || typeof raw !== 'object') continue;
      const item = raw as Record<string, unknown>;
      const email: IncomingEmailPayload = {
        from: sanitizePlainField(item.from, 250),
        subject: sanitizePlainField(item.subject, 300),
        snippet: sanitizePlainField(item.snippet, 1000),
        body: sanitizePlainField(item.body, 5000),
        date: sanitizePlainField(item.date, 80),
        messageId: sanitizePlainField(item.messageId, 160),
      };

      const result = classifyRecruiterEmail(email);
      if (result.classification === 'AUTO_ACK' || !result.targetStage) {
        ignoredAutoAckCount += 1;
        outcomes.push({
          subject: email.subject,
          from: email.from,
          classification: result.classification,
          targetStage: null,
          confidence: result.confidence,
          matchedJobs: [],
          summary: result.summary,
        });
        continue;
      }

      const matches = matchEmailToActiveJobs(email, activeJobs);
      if (matches.length > 0) matchedCount += 1;

      const matchedSummaries: Array<{ id: string; company: string; title: string; updated: boolean }> = [];

      for (const job of matches) {
        // Don't downgrade an INTERVIEW back to REPLIED on follow-up recruiter chatter
        const shouldPromote =
          !(job.status === 'INTERVIEW' && result.targetStage === 'REPLIED');

        const patch = {
          status: shouldPromote ? result.targetStage : undefined,
          lastReplySummary: sanitizePlainField(result.summary, 480),
          lastReplyClassification: result.classification,
        };

        let updatedAny = false;
        if (isNeonPostgresConfigured()) {
          try {
            const ok = await updateNeonJobFields(
              { id: job.id, canonicalKey: job.canonicalKey },
              patch
            );
            if (ok) updatedAny = true;
          } catch (err) {
            console.warn('[ingest/reply] Neon update failed:', redactSecrets((err as Error).message));
          }
        }

        if (isCloudSheetsConfigured() && patch.status) {
          try {
            const ok = await updateCloudSheetRowFields({ id: job.id }, { status: patch.status });
            if (ok) updatedAny = true;
          } catch (err) {
            console.warn('[ingest/reply] Sheets update failed:', redactSecrets((err as Error).message));
          }
        }

        if (updateLocalJobRow({ id: job.id, canonicalKey: job.canonicalKey }, patch)) {
          updatedAny = true;
        }

        if (updatedAny) {
          updatedCount += 1;
          await sendDiscordReplyNotification({
            company: job.company,
            title: job.title,
            classification: result.classification,
            targetStage: patch.status || job.status,
            subject: email.subject,
            summary: result.summary,
          });
        }

        matchedSummaries.push({
          id: job.id,
          company: job.company,
          title: job.title,
          updated: updatedAny,
        });
      }

      outcomes.push({
        subject: email.subject,
        from: email.from,
        classification: result.classification,
        targetStage: result.targetStage,
        confidence: result.confidence,
        matchedJobs: matchedSummaries,
        summary: result.summary,
      });
    }

    return NextResponse.json({
      success: true,
      processed: rawMessages.length,
      activeMonitoredJobs: activeJobs.length,
      matchedCount,
      updatedCount,
      ignoredAutoAckCount,
      outcomes,
    });
  } catch (err) {
    console.error('[ingest/reply POST]', redactSecrets((err as Error).message));
    return NextResponse.json(
      { error: 'Failed to process reply intelligence payload.' },
      { status: 500 }
    );
  }
}
