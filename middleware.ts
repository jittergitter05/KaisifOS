import { NextRequest, NextResponse } from 'next/server';

export function middleware(req: NextRequest) {
  const isProtectedPath = 
    req.nextUrl.pathname.startsWith('/admin') || 
    req.nextUrl.pathname.startsWith('/api/admin');

  if (!isProtectedPath) {
    return NextResponse.next();
  }

  const authCookie = req.cookies.get('kaisifos_auth')?.value;
  
  if (authCookie === 'authenticated') {
    return NextResponse.next();
  }

  // If doing an API request, return 401 JSON so the client can handle it
  if (req.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Otherwise, redirect to login page
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  // Optional: url.searchParams.set('redirect', req.nextUrl.pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|login|api/auth).*)'],
};
