import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { isAuthorizedRequest, isSameOriginRequest } from '@/lib/auth';
import { getCandidateProfileAsync } from '@/lib/profile';
import { parseResumeInput } from '@/lib/resume-parser';
import { checkRateLimit, extractClientIp } from '@/lib/rate-limit';
import { redactSecrets } from '@/lib/utils';

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB limit

export async function POST(req: NextRequest) {
  if (!isSameOriginRequest(req.headers)) {
    return NextResponse.json({ error: 'Cross-origin request blocked.' }, { status: 403 });
  }

  const ip = extractClientIp(req.headers);
  const limit = checkRateLimit(`profile:parse-resume:${ip}`, 15, 5 * 60 * 1000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: `Rate limit exceeded. Retry in ${limit.retryAfterSeconds}s.` },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } }
    );
  }

  const cookieStore = cookies();
  const authCookie = cookieStore.get('kaisifos_auth')?.value;
  const lockedCookie = cookieStore.get('kaisifos_locked')?.value;
  if (!(await isAuthorizedRequest(authCookie, lockedCookie))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const contentType = req.headers.get('content-type') || '';
    const currentProfile = await getCandidateProfileAsync();

    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      const file = formData.get('file') as File | null;
      if (!file) {
        return NextResponse.json({ error: 'No PDF or text file provided in form data.' }, { status: 400 });
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        return NextResponse.json({ error: 'Uploaded file exceeds the 10 MB size limit.' }, { status: 413 });
      }
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const isPdf =
        file.name.toLowerCase().endsWith('.pdf') ||
        file.type === 'application/pdf' ||
        buffer.slice(0, 4).toString('ascii') === '%PDF';

      const result = await parseResumeInput({
        sourceChannel: 'pdf_upload',
        pdfBuffer: isPdf ? buffer : undefined,
        rawText: isPdf ? undefined : buffer.toString('utf8'),
        currentProfile,
      });
      return NextResponse.json(result);
    }

    const body = await req.json();
    const mode = body.mode as 'pdf_upload' | 'google_drive' | 'raw_text' | undefined;

    if (mode === 'google_drive' || body.driveUrl) {
      const driveUrl = String(body.driveUrl || '').trim();
      if (!driveUrl) {
        return NextResponse.json({ error: 'Please provide a valid Google Drive or Google Docs share URL.' }, { status: 400 });
      }
      const result = await parseResumeInput({
        sourceChannel: 'google_drive',
        driveUrl,
        currentProfile,
      });
      return NextResponse.json(result);
    }

    if (mode === 'pdf_upload' && body.pdfBase64) {
      const base64Clean = String(body.pdfBase64).replace(/^data:application\/pdf;base64,/, '');
      if (base64Clean.length > MAX_UPLOAD_BYTES * 1.37) {
        return NextResponse.json({ error: 'PDF payload exceeds the 10 MB size limit.' }, { status: 413 });
      }
      const pdfBuffer = Buffer.from(base64Clean, 'base64');
      const result = await parseResumeInput({
        sourceChannel: 'pdf_upload',
        pdfBuffer,
        rawText: typeof body.extractedClientText === 'string' ? body.extractedClientText : undefined,
        currentProfile,
      });
      return NextResponse.json(result);
    }

    const rawText = String(body.rawText || body.text || '').trim();
    if (!rawText || rawText.length < 20) {
      return NextResponse.json(
        { error: 'Resume text is too short. Paste your full resume text, upload a PDF, or provide a Google Drive link.' },
        { status: 400 }
      );
    }

    const result = await parseResumeInput({
      sourceChannel: 'raw_text',
      rawText: rawText.slice(0, 100000),
      currentProfile,
    });

    return NextResponse.json(result);
  } catch (err) {
    const safeMsg = redactSecrets((err as Error)?.message || 'Failed to parse resume parameters.', 240);
    console.error('[Resume Parser API] Error:', safeMsg);
    return NextResponse.json(
      { error: safeMsg },
      { status: 500 }
    );
  }
}
