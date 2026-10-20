import { NextRequest, NextResponse } from 'next/server';
import {
  signToken,
  DEFAULT_OPERATOR_USER,
  DEFAULT_OPERATOR_KEY,
  isCustomAuthConfigured,
} from '@/lib/auth';

export async function POST(req: NextRequest) {
  try {
    const { username, password, quickAccess } = await req.json();

    const adminUser = process.env.ADMIN_USER || DEFAULT_OPERATOR_USER;
    const adminPass = process.env.ADMIN_PASS || DEFAULT_OPERATOR_KEY;
    const customConfigured = isCustomAuthConfigured();

    const isValidCredentials =
      (username === adminUser && password === adminPass) ||
      (!customConfigured && username === 'admin' && password === 'secret');
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
      response.cookies.set('kaisifos_auth', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 7,
        path: '/',
      });
      response.cookies.delete('kaisifos_locked');
      return response;
    }

    return NextResponse.json({ error: 'Invalid operator credentials' }, { status: 401 });
  } catch {
    return NextResponse.json({ error: 'Invalid request payload' }, { status: 400 });
  }
}
