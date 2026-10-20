import { NextRequest, NextResponse } from 'next/server';
import { isAuthorizedRequest } from '@/lib/auth';

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (!pathname.startsWith('/admin')) {
    return NextResponse.next();
  }

  const authCookie = request.cookies.get('kaisifos_auth')?.value;
  const lockedCookie = request.cookies.get('kaisifos_locked')?.value;

  const authorized = await isAuthorizedRequest(authCookie, lockedCookie);

  if (!authorized) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/admin/:path*'],
};
