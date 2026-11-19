import { NextRequest, NextResponse } from 'next/server';
import { getCookieSecurityOptions, isSameOriginRequest } from '@/lib/auth';

export async function POST(req: NextRequest) {
  if (!isSameOriginRequest(req.headers)) {
    return NextResponse.json({ error: 'Cross-origin request blocked.' }, { status: 403 });
  }

  const response = NextResponse.json({ success: true }, { status: 200 });
  const cookieOpts = getCookieSecurityOptions(req.headers, req.url);
  response.cookies.delete('kaisifos_auth');
  response.cookies.set('kaisifos_locked', '1', {
    ...cookieOpts,
    maxAge: 60 * 60 * 24,
  });
  return response;
}
