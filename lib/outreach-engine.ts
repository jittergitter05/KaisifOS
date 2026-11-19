import { parseIsoDateTimestamp } from './utils';

export interface PeopleSearchLink {
  role: 'hiring_manager' | 'recruiter' | 'team_peers';
  label: string;
  personaHint: string;
  url: string;
}

export interface CadenceAssessment {
  ageDays: number;
  daysSinceApplied: number | null;
  daysSinceLastFollowUp: number | null;
  followUpCount: number;
  isStaleNew: boolean;
  isFollowUpDue: boolean;
  cadenceStage: 'NONE' | 'DUE_BUMP_1' | 'DUE_BUMP_2' | 'COOLING_GHOSTED';
  nextActionLabel: string;
  urgency: 'low' | 'medium' | 'high';
}

export interface CadenceJobInput {
  date?: string;
  status?: string;
  appliedAt?: string | null;
  lastFollowUpAt?: string | null;
  followUpCount?: number | null;
}

export interface FollowUpDraftSet {
  bumpNumber: 1 | 2;
  subject: string;
  dm: string;
  emailBody: string;
}

function cleanCompanyForSearch(company: string): string {
  return String(company || '')
    .replace(/\b(private\s+limited|pvt\.?\s*ltd\.?|limited|ltd\.?|inc\.?|llc|technologies|solutions|india)(?=\s|$|[,.])/gi, '')
    .replace(/[^\w\s&.-]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[\s.,-]+$/g, '')
    .trim();
}

function inferHiringManagerBoolean(title: string): { query: string; personaHint: string } {
  const lower = String(title || '').toLowerCase();

  if (/\b(founder|chief of staff|ceo|entrepreneur in residence|eir)\b/.test(lower)) {
    return {
      query: '("Founder" OR "Co-Founder" OR "CEO" OR "Chief of Staff")',
      personaHint: 'Founder / Chief of Staff',
    };
  }
  if (/\b(product marketing|pmm|gtm|go-to-market|brand|content)\b/.test(lower)) {
    return {
      query: '("Head of Product Marketing" OR "VP Marketing" OR "Marketing Lead" OR "Head of Growth")',
      personaHint: 'VP Marketing / PMM Lead',
    };
  }
  if (/\b(growth|seo|performance marketing|acquisition|demand gen)\b/.test(lower)) {
    return {
      query: '("Head of Growth" OR "Growth Lead" OR "VP Growth" OR "VP Marketing")',
      personaHint: 'Head of Growth / VP Marketing',
    };
  }
  if (/\b(product manager|apm|product owner|product analyst|product)\b/.test(lower)) {
    return {
      query: '("VP Product" OR "Head of Product" OR "Group Product Manager" OR "Director of Product")',
      personaHint: 'Head / VP of Product',
    };
  }
  if (/\b(data|analytics|business analyst|bi|scientist|ml|ai)\b/.test(lower)) {
    return {
      query: '("Head of Analytics" OR "Head of Data" OR "Data Science Manager" OR "Analytics Lead")',
      personaHint: 'Head of Data / Analytics',
    };
  }
  if (/\b(engineer|developer|sde|swe|frontend|backend|fullstack|devops)\b/.test(lower)) {
    return {
      query: '("Engineering Manager" OR "VP Engineering" OR "CTO" OR "Tech Lead")',
      personaHint: 'Engineering Manager / CTO',
    };
  }
  return {
    query: '("Hiring Manager" OR "Head of Product" OR "Head of Growth" OR "Founder")',
    personaHint: 'Hiring Lead / Founder',
  };
}

function inferPeerRoleKeyword(title: string): string {
  const lower = String(title || '').toLowerCase();
  if (/\b(product marketing|pmm)\b/.test(lower)) return '"Product Marketing"';
  if (/\b(growth)\b/.test(lower)) return '"Growth"';
  if (/\b(product analyst|business analyst|data analyst)\b/.test(lower)) return '"Product Analyst" OR "Data Analyst"';
  if (/\b(product|apm)\b/.test(lower)) return '"Product Manager" OR "Associate Product Manager"';
  if (/\b(founder|chief of staff)\b/.test(lower)) return '"Founder\'s Office" OR "Strategy"';
  return `"${String(title || 'Product').replace(/"/g, '').trim().slice(0, 48)}"`;
}

/**
 * Generates 1-click LinkedIn People Boolean search URLs to find the Hiring Manager,
 * Talent Recruiter, and Team Peers for warm referrals in seconds.
 */
export function buildPeopleSearchLinks(
  job: { title: string; company: string; location?: string },
  preferredCities?: string[]
): PeopleSearchLink[] {
  const companyClean = cleanCompanyForSearch(job.company || '');
  const companyQuoted = companyClean ? `"${companyClean}"` : 'Tech';
  const locLower = `${job.location || ''} ${(preferredCities || []).join(' ')}`.toLowerCase();
  const geoHint = locLower.includes('hyderabad')
    ? 'Hyderabad'
    : locLower.includes('bengaluru') || locLower.includes('bangalore')
    ? 'Bengaluru'
    : locLower.includes('india')
    ? 'India'
    : '';

  const hm = inferHiringManagerBoolean(job.title);
  const peerKeyword = inferPeerRoleKeyword(job.title);

  const buildUrl = (keywords: string) =>
    `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(
      keywords.replace(/\s+/g, ' ').trim()
    )}`;

  return [
    {
      role: 'hiring_manager',
      label: 'Find Hiring Manager',
      personaHint: hm.personaHint,
      url: buildUrl(`${companyQuoted} ${hm.query} ${geoHint}`),
    },
    {
      role: 'recruiter',
      label: 'Find Recruiter',
      personaHint: 'Talent Acquisition / HR',
      url: buildUrl(`${companyQuoted} ("Talent Acquisition" OR "Recruiter" OR "People Operations") ${geoHint}`),
    },
    {
      role: 'team_peers',
      label: 'Find Team Peers',
      personaHint: 'Warm Referral / Team',
      url: buildUrl(`${companyQuoted} (${peerKeyword}) ${geoHint}`),
    },
  ];
}

function parseTimestampSafe(value: string | null | undefined): number {
  if (!value) return NaN;
  const isoDate = parseIsoDateTimestamp(value);
  if (Number.isFinite(isoDate)) return isoDate;
  return new Date(value).getTime();
}

/**
 * Computes discovery staleness (>14d NEW/SHORTLISTED) and structured follow-up cadence
 * for APPLIED / OUTREACH_DRAFTED roles (Day 5 Bump #1, Day 11 Bump #2, Day 21 Cooling).
 */
export function computeJobFreshnessAndCadence(
  job: CadenceJobInput,
  nowMs: number = Date.now(),
  options?: { staleNewDays?: number; bump1Days?: number; bump2Days?: number; coolingDays?: number }
): CadenceAssessment {
  const staleNewDays = options?.staleNewDays ?? 14;
  const bump1Days = options?.bump1Days ?? 5;
  const bump2Days = options?.bump2Days ?? 11;
  const coolingDays = options?.coolingDays ?? 21;
  const DAY_MS = 24 * 60 * 60 * 1000;

  const discoveredTs = parseTimestampSafe(job.date);
  const ageDays = Number.isFinite(discoveredTs)
    ? Math.max(0, Math.floor((nowMs - discoveredTs) / DAY_MS))
    : 0;

  const status = String(job.status || 'NEW').toUpperCase();
  const followUpCount = Math.max(0, Math.floor(Number(job.followUpCount || 0)));

  const isStaleNew =
    (status === 'NEW' || status === 'SHORTLISTED') && ageDays >= staleNewDays;

  const appliedRefTs = parseTimestampSafe(job.appliedAt || job.date);
  const daysSinceApplied =
    (status === 'APPLIED' || status === 'OUTREACH_DRAFTED') && Number.isFinite(appliedRefTs)
      ? Math.max(0, Math.floor((nowMs - appliedRefTs) / DAY_MS))
      : null;

  const lastFollowUpTs = parseTimestampSafe(job.lastFollowUpAt);
  const daysSinceLastFollowUp = Number.isFinite(lastFollowUpTs)
    ? Math.max(0, Math.floor((nowMs - lastFollowUpTs) / DAY_MS))
    : null;

  if (status === 'APPLIED' || status === 'OUTREACH_DRAFTED') {
    const dApplied = daysSinceApplied ?? 0;

    if (dApplied >= coolingDays && followUpCount >= 2) {
      return {
        ageDays,
        daysSinceApplied: dApplied,
        daysSinceLastFollowUp,
        followUpCount,
        isStaleNew: false,
        isFollowUpDue: true,
        cadenceStage: 'COOLING_GHOSTED',
        nextActionLabel: `No reply after ${dApplied}d & 2 bumps — consider marking Ghosted`,
        urgency: 'low',
      };
    }

    if (followUpCount === 0 && dApplied >= bump1Days) {
      return {
        ageDays,
        daysSinceApplied: dApplied,
        daysSinceLastFollowUp,
        followUpCount,
        isStaleNew: false,
        isFollowUpDue: true,
        cadenceStage: 'DUE_BUMP_1',
        nextActionLabel: `Day-${dApplied} Bump #1 Due (send concise nudge)`,
        urgency: dApplied >= 8 ? 'high' : 'medium',
      };
    }

    if (
      followUpCount === 1 &&
      dApplied >= bump2Days &&
      (daysSinceLastFollowUp === null || daysSinceLastFollowUp >= 5)
    ) {
      return {
        ageDays,
        daysSinceApplied: dApplied,
        daysSinceLastFollowUp,
        followUpCount,
        isStaleNew: false,
        isFollowUpDue: true,
        cadenceStage: 'DUE_BUMP_2',
        nextActionLabel: `Day-${dApplied} Bump #2 Due (send value-add tear-down)`,
        urgency: 'high',
      };
    }

    if (dApplied >= coolingDays) {
      return {
        ageDays,
        daysSinceApplied: dApplied,
        daysSinceLastFollowUp,
        followUpCount,
        isStaleNew: false,
        isFollowUpDue: true,
        cadenceStage: 'COOLING_GHOSTED',
        nextActionLabel: `Applied ${dApplied}d ago — send final bump or mark Ghosted`,
        urgency: 'medium',
      };
    }
  }

  return {
    ageDays,
    daysSinceApplied,
    daysSinceLastFollowUp,
    followUpCount,
    isStaleNew,
    isFollowUpDue: false,
    cadenceStage: 'NONE',
    nextActionLabel: isStaleNew ? `Stale listing (${ageDays}d old) — verify live or archive` : 'On track',
    urgency: isStaleNew ? 'medium' : 'low',
  };
}

/**
 * Generates crisp, strictly profile-grounded Day-5 (Bump #1) and Day-11 (Bump #2) follow-up messages.
 */
export function generateFollowUpDraft(
  job: { title: string; company: string; resumeAngle?: string },
  profile: { name?: string; portfolio?: string; key_metrics?: string[] },
  bumpNumber: 1 | 2 = 1
): FollowUpDraftSet {
  const name = profile.name || 'Candidate';
  const metric1 = profile.key_metrics?.[0] || 'quantified growth & product impact';
  const metric2 = profile.key_metrics?.[1] || 'end-to-end execution across core product KPIs';
  const portfolio = profile.portfolio ? ` Portfolio: ${profile.portfolio}` : '';
  const company = job.company || 'your team';
  const title = job.title || 'the role';

  if (bumpNumber === 1) {
    return {
      bumpNumber: 1,
      subject: `Following up: ${title} @ ${company}`,
      dm: `Hi ${company} team — circling back on my application for ${title} earlier this week. I'd love to bring the same momentum behind ${metric1} to your roadmap.${portfolio} Open to a quick 10-min chat?`,
      emailBody: `Hi ${company} Hiring Team,\n\nI applied for the ${title} opening a few days ago and wanted to share a quick follow-up.\n\nMost recently, I delivered ${metric1}. Given ${company}'s focus right now, I'd love to walk through how I can contribute immediately in the first 30 days.${portfolio ? `\n\n${portfolio.trim()}` : ''}\n\nBest regards,\n${name}`,
    };
  }

  return {
    bumpNumber: 2,
    subject: `Quick 30-day angle for ${title} @ ${company}`,
    dm: `Hi ${company} team — final quick follow-up on ${title}. I mapped out two concrete growth/product experiments inspired by ${metric2} (${job.resumeAngle || 'funnel + activation telemetry'}). Happy to send the 1-pager if you're still reviewing candidates!`,
    emailBody: `Hi ${company} Hiring Team,\n\nSending one final note on the ${title} role — I know inboxes get busy.\n\nDrawing from ${metric2}, I put together a brief 30-day execution angle around ${job.resumeAngle || 'measurable activation and product discovery improvements'} tailored to ${company}. Happy to share it or hop on a brief intro call if the role is still open.${portfolio ? `\n\n${portfolio.trim()}` : ''}\n\nBest,\n${name}`,
  };
}
