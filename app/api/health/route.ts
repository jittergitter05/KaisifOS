import { NextResponse } from 'next/server';
import { getStorageHealthInfo } from '@/lib/sheets';

export const dynamic = 'force-dynamic';

export async function GET() {
  const health = getStorageHealthInfo();
  return NextResponse.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    persistenceMode: health.storageMode,
    localWritable: health.localWritable,
    ephemeralFallback: health.ephemeralFallback,
    cloudConfigured: health.cloudConfigured,
  });
}
