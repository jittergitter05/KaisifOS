import { NextRequest, NextResponse } from 'next/server'

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (!pathname.startsWith('/admin')) {
    return NextResponse.next()
  }

  const auth = request.headers.get('authorization')

  if (!auth || !auth.startsWith('Basic ')) {
    return new NextResponse(null, {
      status: 401,
      headers: {
        'WWW-Authenticate': 'Basic realm="KaisifOS Admin"'
      }
    })
  }

  const decoded = Buffer.from(
    auth.split(' ')[1], 'base64'
  ).toString('utf-8')
  
  const [user, pass] = decoded.split(':')

  if (
    user !== process.env.ADMIN_USER ||
    pass !== process.env.ADMIN_PASS
  ) {
    return new NextResponse(null, { status: 401 })
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/admin/:path*']
}
