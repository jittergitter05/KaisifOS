import { NextRequest, NextResponse } from 'next/server';
import {
  signToken,
  DEFAULT_OPERATOR_USER,
  DEFAULT_OPERATOR_KEY,
  isCustomAuthConfigured,
  hasPartialAuthConfig,
  isSameOriginRequest,
  constantTimeEqual,
  getCookieSecurityOptions,
} from '@/lib/auth';
import { getCandidateProfileAsync } from '@/lib/profile';
import { checkRateLimit, extractClientIp } from '@/lib/rate-limit';
import { siteConfig } from '@/config/site';

export const dynamic = 'force-dynamic';

export async function GET() {
  const profile = await getCandidateProfileAsync();
  return NextResponse.json({
    customAuthConfigured: isCustomAuthConfigured(),
    partialAuthMisconfigured: hasPartialAuthConfig(),
    brandName: profile.system_name || siteConfig.name,
  });
}

export async function POST(req: NextRequest) {
  try {
    if (!isSameOriginRequest(req.headers)) {
      return NextResponse.json({ error: 'Cross-origin login request blocked.' }, { status: 403 });
    }

    if (hasPartialAuthConfig()) {
      return NextResponse.json(
        {
          error:
            'Authentication is misconfigured: set BOTH ADMIN_USER and ADMIN_PASS (or remove both for local fork mode).',
        },
        { status: 503 }
      );
    }

    const ip = extractClientIp(req.headers);
    const limitResult = checkRateLimit(`auth:login:${ip}`, 15, 5 * 60 * 1000);
    if (!limitResult.allowed) {
      return NextResponse.json(
        { error: `Too many login attempts. Retry in ${limitResult.retryAfterSeconds}s.` },
        {
          status: 429,
          headers: { 'Retry-After': String(limitResult.retryAfterSeconds) },
        }
      );
    }

    const { username, password, quickAccess } = await req.json();

    const adminUser = process.env.ADMIN_USER || DEFAULT_OPERATOR_USER;
    const adminPass = process.env.ADMIN_PASS || DEFAULT_OPERATOR_KEY;
    const customConfigured = isCustomAuthConfigured();

    const userStr = typeof username === 'string' ? username : '';
    const passStr = typeof password === 'string' ? password : '';

    const isValidCredentials =
      (constantTimeEqual(userStr, adminUser) && constantTimeEqual(passStr, adminPass)) ||
      (!customConfigured &&
        constantTimeEqual(userStr, 'admin') &&
        constantTimeEqual(passStr, 'secret'));
    const isQuickOperatorAccess = quickAccess === true && !customConfigured;

    if (isValidCredentials || isQuickOperatorAccess) {
      const response = NextResponse.json(
        {
          success: true,
          mode: customConfigured ? 'cloud-secured' : 'fork-operator',
        },
        { status: 200 }
      );
      const token = await signToken();
      const cookieOpts = getCookieSecurityOptions(req.headers, req.url);
      response.cookies.set('kaisifos_auth', token, {
        ...cookieOpts,
        maxAge: 60 * 60 * 24 * 7,
      });
      response.cookies.delete('kaisifos_locked');
      return response;
    }

    return NextResponse.json({ error: 'Invalid operator credentials' }, { status: 401 });
  } catch {
    return NextResponse.json({ error: 'Invalid request payload' }, { status: 400 });
  }
}
