/**
 * Shared HTML decoding, canonical cross-source fingerprinting, full-JD requirement parsing,
 * and strict allowlist geo/work-auth/seniority eligibility gate used across Next.js live scouting,
 * Neon Postgres deduplication, deterministic scoring, LLM guardrails, and scripts/scout.js.
 */

const CITY_ALIAS_MAP = {
  hyderabad: [
    'hyderabad',
    'hyd',
    'secunderabad',
    'telangana',
    'hitec city',
    'hitech city',
    'gachibowli',
    'madhapur',
    'kondapur',
    'jubilee hills',
    'banjara hills',
    'financial district',
  ],
  bengaluru: ['bengaluru', 'bangalore', 'blr', 'karnataka', 'whitefield', 'koramangala', 'hsr layout'],
  bangalore: ['bengaluru', 'bangalore', 'blr', 'karnataka', 'whitefield', 'koramangala', 'hsr layout'],
  mumbai: ['mumbai', 'bombay', 'navi mumbai', 'thane', 'powai', 'bkc'],
  delhi: ['delhi', 'new delhi', 'ncr', 'gurugram', 'gurgaon', 'noida'],
  chennai: ['chennai', 'madras'],
  pune: ['pune', 'hinjewadi', 'kharadi'],
};

const KNOWN_NON_TARGET_LOCATIONS = [
  'bengaluru',
  'bangalore',
  'mumbai',
  'pune',
  'delhi',
  'new delhi',
  'gurugram',
  'gurgaon',
  'noida',
  'chennai',
  'kolkata',
  'ahmedabad',
  'jaipur',
  'kochi',
  'indore',
  'chandigarh',
  'coimbatore',
  'san francisco',
  'bay area',
  'new york',
  'nyc',
  'seattle',
  'austin',
  'boston',
  'chicago',
  'los angeles',
  'washington',
  'arlington',
  'silver spring',
  'manassas',
  'gaithersburg',
  'largo',
  'atlanta',
  'denver',
  'miami',
  'dallas',
  'houston',
  'philadelphia',
  'san diego',
  'san jose',
  'palo alto',
  'mountain view',
  'sunnyvale',
  'menlo park',
  'london',
  'berlin',
  'munich',
  'frankfurt',
  'hamburg',
  'amsterdam',
  'paris',
  'toronto',
  'vancouver',
  'montreal',
  'dublin',
  'zurich',
  'geneva',
  'sydney',
  'melbourne',
  'singapore',
  'dubai',
  'uae',
  'abu dhabi',
  'stockholm',
  'madrid',
  'barcelona',
  'lisbon',
  'warsaw',
  'prague',
  'vienna',
  'brussels',
  'copenhagen',
  'oslo',
  'helsinki',
  'tokyo',
  'seoul',
  'hong kong',
  'taipei',
  'manila',
  'jakarta',
  'kuala lumpur',
  'bangkok',
  'ho chi minh',
  'tel aviv',
  'sao paulo',
  'mexico city',
  'buenos aires',
  'bogota',
  'santiago',
  'lagos',
  'nairobi',
  'cairo',
  'johannesburg',
  'united states',
  'usa',
  'u.s.',
  'u.s.a.',
  'canada',
  'united kingdom',
  'germany',
  'france',
  'netherlands',
  'australia',
  'ireland',
  'spain',
  'italy',
  'poland',
  'sweden',
  'switzerland',
  'austria',
  'belgium',
  'denmark',
  'norway',
  'finland',
  'portugal',
  'brazil',
  'mexico',
  'argentina',
  'colombia',
  'chile',
  'japan',
  'south korea',
  'china',
  'philippines',
  'indonesia',
  'malaysia',
  'thailand',
  'vietnam',
  'israel',
];

export function decodeAndStripHtml(input) {
  if (!input || typeof input !== 'string') return '';

  let decoded = input
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;|&#x27;/gi, "'")
    .replace(/&ndash;|&mdash;/gi, '-')
    .replace(/&#(\d+);/g, (_m, code) => {
      const n = parseInt(code, 10);
      return Number.isFinite(n) && n > 0 && n < 65535 ? String.fromCharCode(n) : ' ';
    });

  // Remove script/style blocks completely before stripping tags
  decoded = decoded
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ');

  // Preserve sentence/line boundaries for block tags; strip inline formatting tags without adding stray spaces before punctuation
  decoded = decoded
    .replace(/<\/?(?:p|div|li|br|hr|h[1-6]|tr|td|th|section|article|blockquote|ul|ol)\b[^>]*>/gi, ' ')
    .replace(/<\/?(?:b|strong|em|i|u|span|a|small|code|sub|sup)\b[^>]*>/gi, '');

  let previous;
  let guard = 0;
  do {
    previous = decoded;
    decoded = decoded.replace(/<[^>]*>/g, ' ');
    guard++;
  } while (decoded !== previous && guard < 12);

  return decoded.replace(/\s+/g, ' ').trim();
}

export function extractRequiredYearsStrict(fullText) {
  if (!fullText || typeof fullText !== 'string') return null;

  const nonReqYearsRegex =
    /\b\d{1,2}\+?\s*years?\s+(?:in\s+business|of\s+history|old|ago|strong|legacy|founded|operating|market\s+presence|combined|collective|industry\s+leadership)\b/gi;
  const upperBoundPrefixRegex = /\b(?:up\s+to|less\s+than|under|below|0\s*(?:to|[-–])\s*)\s*$/i;

  const sentences = fullText.split(/[\n.!?;]+/);
  let requiredYears = null;

  for (const rawSentence of sentences) {
    const s = rawSentence.trim();
    if (!s) continue;
    const cleaned = s.replace(nonReqYearsRegex, '');
    const yearsMatches = [
      ...cleaned.matchAll(
        /(?:minimum(?:\s+of)?|at\s+least|requires?|requiring|with|having)?\s*\b(\d{1,2})\s*(?:[-–to]+\s*(\d{1,2}))?\s*\+?\s*(?:years?|yrs?)\b/gi
      ),
    ];
    for (const m of yearsMatches) {
      const idx = m.index ?? 0;
      const prefixWindow = cleaned.slice(Math.max(0, idx - 18), idx);
      if (upperBoundPrefixRegex.test(prefixWindow)) continue;

      const minY = parseInt(m[1], 10);
      if (Number.isFinite(minY) && minY <= 25) {
        requiredYears = requiredYears === null ? minY : Math.max(requiredYears, minY);
      }
    }
  }

  return requiredYears;
}

function escapeRegExp(str) {
  return String(str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasWholeWord(text, token) {
  const clean = String(token || '').trim();
  if (!clean) return false;
  return new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(clean)}(?:$|[^a-z0-9])`, 'i').test(text);
}

/**
 * Normalizes a company name, role title, and optional location into a canonical cross-source key
 * so identical jobs across Career Pages, Greenhouse, Lever, Ashby, JSearch, and Internshala merge cleanly.
 */
export function buildCanonicalJobKey(company, title, location = '') {
  const cleanCompany = String(company || 'unknown')
    .toLowerCase()
    .replace(
      /\b(private|pvt|limited|ltd|inc|incorporated|llc|llp|corp|corporation|co|company|technologies|technology|tech|software|solutions|services|labs|lab|group|holdings|global|india|international|gmbh|ag|plc)\b/g,
      ' '
    )
    .replace(/[^a-z0-9]+/g, '')
    .trim();

  const cleanTitle = String(title || 'role')
    .toLowerCase()
    // Strip trailing location or requisition tags like "- Hyderabad", "(Remote)", "[Fresher]", "at ATCC in Gaithersburg"
    .replace(/\s+(?:at\s+[a-z0-9\s]+)?\bin\s+[a-z\s,]+$/i, '')
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/\b(fresher|entry\s*level|immediate\s*joiner|remote|hybrid|onsite|on-site|hyderabad|bangalore|bengaluru|india|full\s*time|req\s*#?\d+)\b/gi, ' ')
    .replace(/\b(jr\.?|junior)\b/g, 'associate')
    .replace(/\bapm\b/g, 'associateproductmanager')
    .replace(/\bpmm\b/g, 'productmarketingmanager')
    .replace(/[^a-z0-9]+/g, '')
    .trim();

  const locLower = String(location || '').toLowerCase();
  let geoBucket = 'global';
  if (/\b(hyderabad|hyd|secunderabad|telangana|gachibowli|hitec|madhapur)\b/i.test(locLower)) {
    geoBucket = 'hyd';
  } else if (/\b(remote|wfh|work from home|anywhere|worldwide)\b/i.test(locLower)) {
    geoBucket = 'remote';
  } else if (/\b(india|bengaluru|bangalore|mumbai|pune|delhi|gurugram|gurgaon|noida|chennai)\b/i.test(locLower)) {
    geoBucket = 'in';
  }

  return `${cleanCompany || 'company'}::${cleanTitle || 'role'}::${geoBucket}`;
}

/**
 * Ranks job source URLs so official Company Career Pages and Direct-ATS links
 * always take priority over aggregators like JSearch or Internshala when merging duplicates.
 */
export function getSourceUrlPriority(sourceOrUrl = '') {
  const s = String(sourceOrUrl || '').toLowerCase();
  if (s.includes('career') || s.includes('greenhouse') || s.includes('lever') || s.includes('ashby')) return 100;
  if (s.includes('workable') || s.includes('smartrecruiters') || s.includes('recruitee')) return 95;
  if (s.includes('himalayas') || s.includes('remotive') || s.includes('remoteok')) return 80;
  if (s.includes('internshala') || s.includes('arbeitnow') || s.includes('themuse')) return 70;
  if (s.includes('jsearch') || s.includes('linkedin') || s.includes('indeed')) return 50;
  return 60;
}

export function evaluateHardEligibility(job, profile) {
  const title = String(job?.title || '');
  const titleLower = title.toLowerCase();
  const locRaw = String(job?.location || '').trim();
  const locLower = locRaw.toLowerCase();
  const cleanDesc = decodeAndStripHtml(String(job?.description || ''));
  const descLower = cleanDesc.toLowerCase();
  const fullText = `${titleLower} ${locLower} ${descLower}`;

  const targetCities =
    Array.isArray(profile?.target_cities) && profile.target_cities.length > 0
      ? profile.target_cities
      : ['Hyderabad'];
  const openToRelocation = Boolean(profile?.open_to_relocation);
  const candidateYears = profile?.experience_years ?? 0;

  const targetTokens = new Set();
  for (const city of targetCities) {
    const c = String(city || '').trim().toLowerCase();
    if (!c) continue;
    targetTokens.add(c);
    const aliases = CITY_ALIAS_MAP[c];
    if (aliases) {
      for (const a of aliases) targetTokens.add(a);
    }
  }
  const targetTokenArr = Array.from(targetTokens);
  const locMatchesTargetHub = targetTokenArr.some((t) => hasWholeWord(locLower, t));
  const descMatchesTargetHub = targetTokenArr.some((t) => hasWholeWord(descLower, t));

  const locIndicatesIndia =
    /\b(india|hyderabad|hyd|telangana|bengaluru|bangalore|mumbai|delhi|ncr|gurugram|gurgaon|noida|pune|chennai|kolkata|pan[\s-]?india)\b/i.test(
      locLower
    ) || /,\s*in$/i.test(locRaw);

  const descIndicatesIndiaRemote =
    /\b(remote\s*(?:in|from|within|across|:|-|–)?\s*india|india\s*(?:remote|only)|based\s+in\s+india|pan[\s-]?india|anywhere\s+in\s+india|remote\s*\(india\)|work\s+from\s+anywhere\s+in\s+india)\b/i.test(
      descLower
    );
  const descIndicatesGlobalRemote =
    /\b(work\s+from\s+anywhere|anywhere\s+in\s+the\s+world|worldwide\s+remote|remote\s*(?:worldwide|globally|anywhere)|global\s+remote|100%\s+remote\s+worldwide|distributed\s+team\s+globally)\b/i.test(
      descLower
    );
  const locSaysRemote = /\b(remote|worldwide|global|anywhere|work\s+from\s+home|wfh)\b/i.test(
    locLower
  );
  const isVaguePortalLoc =
    !locLower ||
    /^(not specified|direct career portal|flexible|on-?site|hybrid|remote\s*\/\s*hybrid|hybrid\s*\/\s*on-?site)$/i.test(
      locLower
    );

  const reasons = [];

  // 1. Work authorization / no-sponsorship / US-citizenship / STEM OPT / German Werkstudent check across FULL text
  const noSponsorPattern =
    /\b(?:do\s+not|don['’]?t|does\s+not|doesn['’]?t|will\s+not|won['’]?t|unable\s+to|cannot|can['’]?t|not|no|without)\s+(?:currently\s+)?(?:require|provide|offer|support|sponsor|participate\s+in)(?:\s+(?:current|or|future|employer|visa|work))*\s*(?:sponsor(?:ship|ing)?|stem[\s-]?opt|visa)\b/i;
  const usWorkAuthPattern =
    /\b(?:stem[\s-]?opt|opt[\s/]?cpt|h-?1b|tn\s+visa|w-?2\s+only|no\s+c2c|e-?verify|i-?9\s+(?:form|verification|eligibility)|security\s+clearance|u\.?s\.?\s+citizens?\s+only|us\s+permanent\s+residents?\s+only|green\s+card\s+holders?\s+only|u\.?s\.?\s+work\s+authoriz(?:ation|ed)|authorized\s+to\s+work\s+in\s+the\s+(?:united\s+states|u\.?s\.?a?\.?|uk|united\s+kingdom|canada|european\s+union|eu|australia|germany)|legally\s+authorized\s+to\s+work\s+in\s+the\s+(?:united\s+states|u\.?s\.?a?\.?|uk|eu|canada|germany)|werkstudent(?:in|:in|\*in)?|working\s+student\s+in\s+germany|immatrikuliert)\b/i;

  let workAuthBlocked = false;
  if (noSponsorPattern.test(fullText) || usWorkAuthPattern.test(fullText)) {
    const isPureIndiaPosting =
      (locMatchesTargetHub || locIndicatesIndia) &&
      !/\b(stem[\s-]?opt|h-?1b|u\.?s\.?|united\s+states|uk|european\s+union|canada|australia|werkstudent)\b/i.test(
        fullText
      );
    if (!isPureIndiaPosting) {
      workAuthBlocked = true;
      reasons.push(
        'Blocked: Requires US/EU/foreign work authorization, local student enrollment, or states no visa/STEM OPT sponsorship'
      );
    }
  }

  // 2. Geographic / Foreign Country Suffix / Fake-Remote / Strict Allowlist Target Hub Check
  let geoBlocked = false;

  // Catch ISO 2-letter foreign country suffixes like "Largo, US", "Silver Spring, US", "London, GB", "Berlin, DE", "Toronto, CA"
  const foreignCountryCodeSuffixPattern =
    /(?:,\s*|\b-\s*|\()(?:us|usa|uk|gb|de|fr|nl|es|it|ch|se|no|dk|fi|pl|at|be|ie|pt|ca|au|nz|sg|ae|jp|kr|cn|br|mx|il|za)(?:\)|\s*$)/i;

  const foreignRemoteLocPattern =
    /\b(?:us[\s-]*only|u\.?s\.?[\s-]*only|usa[\s-]*only|united\s+states|north\s+america|americas|latam|latin\s+america|emea|europe(?:\s*\/\s*global|\s+only)?|eu[\s-]*only|uk[\s-]*only|united\s+kingdom|canada(?:\s+only)?|australia|germany|france|netherlands|spain|ireland|sweden|switzerland|pst|est|cst|mst|cet|bst)\b/i;

  // US 2-letter state codes after comma or space-separated after major US city/state formats
  const usStateLocPattern =
    /(?:,\s*|\b(?:in|at)\s+[a-z\s]+,\s*)(?:al|ak|az|ar|ca|co|ct|de|fl|ga|hi|id|il|ia|ks|ky|la|me|md|ma|mi|mn|ms|mo|mt|ne|nv|nh|nj|nm|ny|nc|nd|oh|ok|or|pa|ri|sc|sd|tn|tx|ut|vt|va|wa|wv|wi|wy|dc)\b/i;

  // Title-embedded non-target location (e.g. "Associate Product Manager at ATCC in Gaithersburg, Maryland" or "Werkstudent:in")
  const titleMentionsForeignLoc =
    /\b(?:maryland|virginia|california|texas|new\s+york|washington|seattle|boston|chicago|london|berlin|munich|germany|toronto|canada|sydney|australia|united\s+states|u\.?s\.?a?\.?|uk|eu|werkstudent)\b/i.test(
      titleLower
    );

  const explicitNonTargetCityInLoc = KNOWN_NON_TARGET_LOCATIONS.find(
    (c) => !targetTokenArr.includes(c) && hasWholeWord(locLower, c)
  );

  const hasExplicitForeignLocMarker =
    foreignCountryCodeSuffixPattern.test(locRaw) ||
    foreignRemoteLocPattern.test(locLower) ||
    usStateLocPattern.test(locRaw) ||
    usStateLocPattern.test(title) ||
    titleMentionsForeignLoc ||
    Boolean(explicitNonTargetCityInLoc);

  if (hasExplicitForeignLocMarker && !locMatchesTargetHub && !openToRelocation) {
    geoBlocked = true;
    reasons.push(
      `Blocked: Location "${locRaw || title}" is outside strict target hubs (${targetCities.join(', ')})`
    );
  }

  // Detect "Remote, but strong preference for NYC/Seattle/SF/US/UK/EU" or residency/travel locks in JD
  const metroPrefRegex =
    /(?:strong\s+preference\s+for\s+(?:candidates|applicants)|prefer\s+(?:candidates|applicants)|prioritize\s+applicants\s+who\s+live|concentrated\s+in\s+(?:those|these|the)\s+areas|must\s+(?:reside|live|be\s+based|be\s+located)\s+in|candidates\s+(?:must\s+be\s+)?(?:based|located)\s+in|hiring\s+(?:only|exclusively)\s+in|only\s+(?:open|accepting\s+applications)\s+(?:to|from)\s+(?:candidates|applicants|residents)\s+(?:in|from)|travel\s+(?:to|for)\s+(?:an?\s+)?in-person|quarterly\s+in-person|in-person\s+collaboration)/gi;

  // Note: Only exempt if `locMatchesTargetHub` is explicitly true (never let an incidental word in `desc` bypass a remote/foreign lock)
  if (!geoBlocked && !locMatchesTargetHub && !openToRelocation) {
    const prefMatches = [...descLower.matchAll(metroPrefRegex)];
    for (const pm of prefMatches) {
      const idx = pm.index ?? 0;
      const snippet = descLower.slice(Math.max(0, idx - 120), Math.min(descLower.length, idx + 220));
      const mentionsTargetOrIndia =
        targetTokenArr.some((t) => hasWholeWord(snippet, t)) || /\bindia\b/i.test(snippet);
      const mentionsForeignArea =
        /\b(?:new york|nyc|san francisco|bay area|seattle|austin|boston|chicago|los angeles|washington|maryland|virginia|london|berlin|amsterdam|paris|toronto|dublin|zurich|sydney|melbourne|united states|u\.?s\.?a?\.?|north america|americas|europe|eu|uk|emea|canada|areas|those|these)\b/i.test(
          snippet
        ) ||
        usStateLocPattern.test(snippet) ||
        /\bin-person|quarterly\b/i.test(pm[0]);

      if (mentionsForeignArea && !mentionsTargetOrIndia) {
        geoBlocked = true;
        reasons.push(
          'Blocked: JD enforces foreign metro/residency preference or periodic in-person travel outside target hubs'
        );
        break;
      }
    }
  }

  // Catch US-only timezone / remote-(US) / 401(k)-without-global markers in JD
  if (!geoBlocked && !locMatchesTargetHub && !openToRelocation) {
    const usOnlyJdMarkers =
      /\b(?:remote\s*[-–:(]+\s*(?:us|usa|u\.?s\.?|united states|north america|uk|eu|emea|germany|canada)|(?:us|north america|european|pacific|eastern)\s+time\s*zones?\s+only|(?:pst|est|cst|mst|cet)\s+working\s+hours\s+only|united\s+states\s+only|must\s+be\s+located\s+in\s+the\s+(?:us|united\s+states|uk|eu|germany|canada))\b/i;
    const usBenefitsOnly =
      /\b401\s*\(?k\)?\b|\bhealth,?\s*dental,?\s*(?:and\s+)?vision\b|\bw-?2\s+employment\b/i.test(
        descLower
      ) &&
      !descIndicatesIndiaRemote &&
      !descIndicatesGlobalRemote &&
      !locIndicatesIndia &&
      !descMatchesTargetHub;

    if (usOnlyJdMarkers.test(descLower) || usBenefitsOnly) {
      geoBlocked = true;
      reasons.push(
        'Blocked: US/foreign-locked remote role (timezone, residency, or US-only benefits with no India/global track)'
      );
    }
  }

  // POSITIVE ALLOWLIST ENFORCEMENT when open_to_relocation is false:
  // A job MUST either:
  // (a) Explicitly match target hub in location (or in description if location is vague/portal/India), OR
  // (b) Be a clean Remote role with zero foreign location locks.
  if (!geoBlocked && !openToRelocation) {
    const isVerifiedTargetHub =
      locMatchesTargetHub ||
      ((isVaguePortalLoc || locSaysRemote || locLower === 'india') && descMatchesTargetHub);

    const isCleanRemote =
      (locSaysRemote || descIndicatesIndiaRemote || descIndicatesGlobalRemote) &&
      !hasExplicitForeignLocMarker;

    if (!isVerifiedTargetHub && !isCleanRemote) {
      // Check if it's a vague portal stub where description mentions a foreign city
      const foreignInDesc = KNOWN_NON_TARGET_LOCATIONS.find(
        (c) => !targetTokenArr.includes(c) && hasWholeWord(descLower, c)
      );
      geoBlocked = true;
      reasons.push(
        foreignInDesc
          ? `Blocked: Role references "${foreignInDesc}" with no ${targetCities.join('/')} or India-remote track`
          : `Blocked: Location "${locRaw || 'Unspecified'}" is not in allowlist (${targetCities.join(', ')} or India/Global Remote)`
      );
    }
  }

  // 3. Strict Fresher / Entry-Level Seniority & Role Quality Enforcement
  const requiredYears = extractRequiredYearsStrict(fullText);
  let seniorityBlocked = false;

  if (candidateYears <= 1) {
    const hardSeniorTitle =
      /\b(senior|sr\.?|staff|principal|director|vp|vice\s+president|head\s+of|chief|architect|evp|svp|avp|manager\s+(?:ii|iii|iv|2|3|4)|ii|iii|iv)\b/i.test(
        titleLower
      );
    const matchesExactTargetTitle = (profile?.target_roles || []).some(
      (r) => String(r || '').trim().toLowerCase() === titleLower.trim()
    );
    const leadTitleBlock =
      candidateYears === 0 &&
      /\blead\b/i.test(titleLower) &&
      !matchesExactTargetTitle &&
      !/\b(associate|junior|intern|fresher|entry|trainee|graduate)\b/i.test(titleLower);

    // Block generic mid-career "Product Manager" (without Associate/Junior/Intern/APM/Entry-level/0-1 yr signal) if JD requires 2+ yrs
    const minAllowedYears = candidateYears === 0 ? 2 : candidateYears + 2;
    const yearsBlocked = requiredYears !== null && requiredYears >= minAllowedYears;
    const noFreshersBlocked =
      /\b(?:not\s+entry[- ]level|no\s+freshers|experienced\s+(?:candidates|professionals?)\s+only|proven\s+track\s+record\s+of\s+[3-9]\+?\s*years)\b/i.test(
        descLower
      );

    if (hardSeniorTitle || leadTitleBlock || yearsBlocked || noFreshersBlocked) {
      seniorityBlocked = true;
      if (yearsBlocked) {
        reasons.push(
          `Blocked: Requires ${requiredYears}+ years experience (candidate has ${candidateYears} yrs / Fresher)`
        );
      } else {
        reasons.push(
          `Blocked: Senior/Lead role "${title}" incompatible with ${profile?.experience_level || 'Fresher'} (${candidateYears} yrs)`
        );
      }
    }
  }

  const eligible = !workAuthBlocked && !geoBlocked && !seniorityBlocked;
  const matchesTargetHub =
    !geoBlocked &&
    (locMatchesTargetHub || ((isVaguePortalLoc || locSaysRemote) && descMatchesTargetHub));
  const isIndiaAccessibleRemote =
    !workAuthBlocked &&
    !geoBlocked &&
    (descIndicatesIndiaRemote ||
      descIndicatesGlobalRemote ||
      (locSaysRemote && !hasExplicitForeignLocMarker));

  return {
    eligible,
    reasons,
    flags: {
      workAuthBlocked,
      geoBlocked,
      seniorityBlocked,
      matchesTargetHub,
      isIndiaAccessibleRemote,
      hasStrictFresherBlocker: seniorityBlocked,
      requiredYears,
      descriptionLength: cleanDesc.length,
      hasThinDescription: cleanDesc.length < 180,
    },
  };
}
