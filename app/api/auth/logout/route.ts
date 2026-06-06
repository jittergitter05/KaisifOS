import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const response = NextResponse.json({ success: true }, { status: 200 });
  response.cookies.delete('kaisifos_auth');
  return response;
}
