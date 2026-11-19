export type ReplyClassification =
  | 'INTERVIEW_INVITE'
  | 'RECRUITER_REPLY'
  | 'REJECTION'
  | 'AUTO_ACK';

export interface ReplyClassificationResult {
  classification: ReplyClassification;
  targetStage: 'INTERVIEW' | 'REPLIED' | 'REJECTED' | null;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  matchedSignals: string[];
  summary: string;
}

export interface IncomingEmailPayload {
  from: string;
  subject: string;
  snippet?: string;
  body?: string;
  date?: string;
  messageId?: string;
}

export interface ActiveJobTarget {
  id: string;
  canonicalKey?: string;
  title: string;
  company: string;
  status: string;
}

const GENERIC_EMAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'yahoo.co.in',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'icloud.com',
  'proton.me',
  'protonmail.com',
  'linkedin.com',
  'naukri.com',
  'infoedge.com',
  'indeed.com',
  'wellfound.com',
  'angel.co',
  'greenhouse.io',
  'greenhouse-mail.io',
  'lever.co',
  'ashbyhq.com',
  'myworkday.com',
  'workday.com',
  'workablemail.com',
  'smartrecruiters.com',
  'icims.com',
  'bamboohr.com',
  'keka.com',
  'darwinbox.in',
  'darwinbox.com',
  'instahyre.com',
  'cutshort.io',
]);

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function isCompanyWordBoundaryMatch(text: string, company: string): boolean {
  const clean = String(company || '')
    .replace(/\b(private\s+limited|pvt\.?\s*ltd\.?|limited|ltd\.?|inc\.?|llc)(?=\s|$|[,.])/gi, '')
    .replace(/[\s.,-]+$/g, '')
    .trim();
  if (!text || clean.length < 2) return false;
  return new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(clean)}(?:$|[^a-z0-9])`, 'i').test(text);
}

function extractSenderDomain(fromHeader: string): string {
  const match = String(fromHeader || '').match(/@([a-z0-9.-]+\.[a-z]{2,})/i);
  if (!match) return '';
  return match[1].toLowerCase().replace(/^(mail|careers|jobs|hr|talent|recruiting|noreply|no-reply)\./, '');
}

/**
 * Classifies an incoming email from a company you applied to into:
 * - INTERVIEW_INVITE -> auto-upgrades stage to INTERVIEW
 * - REJECTION -> auto-upgrades stage to REJECTED
 * - RECRUITER_REPLY -> auto-upgrades stage to REPLIED
 * - AUTO_ACK -> ignored for stage mutation so automated receipts don't create false REPLIED noise
 */
export function classifyRecruiterEmail(email: IncomingEmailPayload): ReplyClassificationResult {
  const from = String(email.from || '');
  const subject = String(email.subject || '');
  const textBody = `${subject}\n${email.snippet || ''}\n${email.body || ''}`.slice(0, 6000);
  const lower = textBody.toLowerCase();
  const fromLower = from.toLowerCase();

  const interviewSignals: Array<[RegExp, string]> = [
    [/\b(schedule\s+(?:an?\s+)?(?:interview|call|chat|round)|interview\s+(?:invitation|invite|slot|schedule|round))\b/i, 'interview-schedule'],
    [/\b(calendly\.com|cal\.com|goodtime\.io|ashbyhq\.com\/schedule|meet\.google\.com|zoom\.us\/j\/)\b/i, 'calendar-link'],
    [/\b(availability\s+for\s+(?:a\s+)?(?:call|chat|interview|discussion)|share\s+your\s+availability|preferred\s+time\s+slots?)\b/i, 'availability-request'],
    [/\b(shortlisted\s+for|moving\s+you\s+forward|next\s+round|technical\s+round|hiring\s+manager\s+round|case\s+study\s+assignment|coding\s+assessment|hackerrank|codility)\b/i, 'shortlisted-next-round'],
    [/\b(would\s+love\s+to\s+(?:chat|connect|speak)\s+(?:with\s+you|about))\b/i, 'intro-call-invite'],
  ];

  const rejectionSignals: Array<[RegExp, string]> = [
    [/\b(decided\s+not\s+to\s+move\s+forward|not\s+(?:be\s+)?moving\s+forward|will\s+not\s+be\s+proceeding|not\s+to\s+proceed)\b/i, 'not-moving-forward'],
    [/\b(regret\s+to\s+inform|unfortunately[\s,]+(?:we|your)|pursuing\s+other\s+candidates|other\s+candidates\s+whose)\b/i, 'regret-other-candidates'],
    [/\b(position\s+has\s+been\s+filled|role\s+has\s+been\s+closed|not\s+shortlisted|application\s+was\s+not\s+selected)\b/i, 'position-filled-or-rejected'],
  ];

  const autoAckSignals: Array<[RegExp, string]> = [
    [/\b(thank\s+you\s+for\s+applying|thanks\s+for\s+applying|application\s+(?:received|submitted|confirmation)|we\s+(?:have\s+)?received\s+your\s+application)\b/i, 'application-receipt'],
    [/\b(this\s+is\s+an?\s+automated\s+(?:email|message|response)|do\s+not\s+reply\s+to\s+this\s+email|we\s+will\s+review\s+your\s+application\s+and\s+get\s+back)\b/i, 'automated-receipt'],
    [/\b(no-?reply|donotreply|do-not-reply|notifications?@)\b/i, 'noreply-sender'],
  ];

  const humanRecruiterSignals: Array<[RegExp, string]> = [
    [/^\s*re:/i, 'reply-thread'],
    [/\b(current\s+ctc|expected\s+ctc|notice\s+period|earliest\s+joining|updated\s+resume|quick\s+question|are\s+you\s+available|can\s+we\s+connect)\b/i, 'recruiter-screening-question'],
    [/\b(looking\s+forward\s+to\s+hearing|let\s+me\s+know|please\s+confirm|happy\s+to\s+discuss)\b/i, 'human-conversational-reply'],
  ];

  const hitInterview = interviewSignals.filter(([rx]) => rx.test(textBody)).map(([, tag]) => tag);
  const hitRejection = rejectionSignals.filter(([rx]) => rx.test(textBody)).map(([, tag]) => tag);
  const hitAutoAck = autoAckSignals
    .filter(([rx, tag]) => (tag === 'noreply-sender' ? rx.test(fromLower) : rx.test(textBody)))
    .map(([, tag]) => tag);
  const hitHuman = humanRecruiterSignals
    .filter(([rx, tag]) => (tag === 'reply-thread' ? rx.test(subject) : rx.test(textBody)))
    .map(([, tag]) => tag);

  // 1. Interview invitations take top priority (even if sent via ATS noreply calendar invite)
  if (hitInterview.length > 0 && hitRejection.length === 0) {
    return {
      classification: 'INTERVIEW_INVITE',
      targetStage: 'INTERVIEW',
      confidence: hitInterview.length >= 2 ? 'HIGH' : 'MEDIUM',
      matchedSignals: hitInterview,
      summary: `Interview signal (${hitInterview.join(', ')}): ${subject.slice(0, 120)}`,
    };
  }

  // 2. Explicit rejections override automated receipts
  if (hitRejection.length > 0) {
    return {
      classification: 'REJECTION',
      targetStage: 'REJECTED',
      confidence: hitRejection.length >= 2 ? 'HIGH' : 'MEDIUM',
      matchedSignals: hitRejection,
      summary: `Rejection detected (${hitRejection.join(', ')}): ${subject.slice(0, 120)}`,
    };
  }

  // 3. Automated application acknowledgement -> ignore to prevent false REPLIED triggers
  const hasReceiptPhrase = hitAutoAck.includes('application-receipt') || hitAutoAck.includes('automated-receipt');
  if (hasReceiptPhrase && hitHuman.length === 0) {
    return {
      classification: 'AUTO_ACK',
      targetStage: null,
      confidence: 'HIGH',
      matchedSignals: hitAutoAck,
      summary: `Automated acknowledgement ignored: ${subject.slice(0, 120)}`,
    };
  }
  if (hitAutoAck.includes('noreply-sender') && hitHuman.length === 0 && !/\b(interview|call|chat|ctc|notice)\b/i.test(lower)) {
    return {
      classification: 'AUTO_ACK',
      targetStage: null,
      confidence: 'MEDIUM',
      matchedSignals: hitAutoAck,
      summary: `Automated no-reply notification ignored: ${subject.slice(0, 120)}`,
    };
  }

  // 4. Genuine human recruiter reply
  return {
    classification: 'RECRUITER_REPLY',
    targetStage: 'REPLIED',
    confidence: hitHuman.length > 0 ? 'HIGH' : 'MEDIUM',
    matchedSignals: hitHuman.length > 0 ? hitHuman : ['company-domain-or-mention'],
    summary: `Recruiter reply: ${subject.slice(0, 120)}`,
  };
}

/**
 * Matches an incoming email against active pipeline jobs (APPLIED / OUTREACH_DRAFTED / REPLIED / INTERVIEW).
 */
export function matchEmailToActiveJobs(
  email: IncomingEmailPayload,
  activeJobs: ActiveJobTarget[]
): ActiveJobTarget[] {
  const from = String(email.from || '');
  const subject = String(email.subject || '');
  const snippet = String(email.snippet || '').slice(0, 600);
  const headerCorpus = `${from} ${subject}`;
  const senderDomain = extractSenderDomain(from);
  const domainRoot =
    senderDomain && !GENERIC_EMAIL_DOMAINS.has(senderDomain)
      ? senderDomain.split('.')[0]
      : '';

  const scored: Array<{ job: ActiveJobTarget; score: number }> = [];

  for (const job of activeJobs) {
    const companyClean = String(job.company || '').trim();
    if (!companyClean || companyClean.length < 2) continue;

    let matchScore = 0;
    const companyCompact = companyClean.toLowerCase().replace(/[^a-z0-9]/g, '');

    if (domainRoot && domainRoot.length >= 3 && companyCompact.includes(domainRoot)) {
      matchScore += 5;
    }
    if (isCompanyWordBoundaryMatch(headerCorpus, companyClean)) {
      matchScore += 4;
    } else if (isCompanyWordBoundaryMatch(snippet, companyClean)) {
      matchScore += 2;
    }

    if (matchScore === 0) continue;

    // Tie-breaker bonus when the role title words also appear in subject/snippet
    const titleWords = String(job.title || '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 4 && !['manager', 'associate', 'senior', 'junior', 'india', 'remote'].includes(w));
    for (const w of titleWords) {
      if (headerCorpus.toLowerCase().includes(w)) matchScore += 1;
    }

    scored.push({ job, score: matchScore });
  }

  if (scored.length === 0) return [];
  scored.sort((a, b) => b.score - a.score);
  const topScore = scored[0].score;
  // Return best matches (all tied at top company/role match)
  return scored.filter((s) => s.score >= Math.max(4, topScore - 1)).map((s) => s.job);
}
