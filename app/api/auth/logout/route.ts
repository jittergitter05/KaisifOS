import { NextRequest, NextResponse } from 'next/server';
import { getCookieSecurityOptions } from '@/lib/auth';

export async function POST(req: NextRequest) {
  const response = NextResponse.json({ success: true }, { status: 200 });
  const cookieOpts = getCookieSecurityOptions(req.headers, req.url);
  response.cookies.delete('kaisifos_auth');
  response.cookies.set('kaisifos_locked', '1', {
    ...cookieOpts,
    maxAge: 60 * 60 * 24,
  });
  return response;
}
