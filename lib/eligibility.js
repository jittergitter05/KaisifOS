/**
 * Shared HTML decoding, full-JD requirement parsing, and strict geo/work-auth/seniority
 * eligibility gate used across Next.js live scouting, deterministic scoring, LLM guardrails,
 * and scripts/scout.js.
 */

const CITY_ALIAS_MAP = {
  hyderabad: ['hyderabad', 'hyd', 'secunderabad', 'telangana', 'hitec city', 'gachibowli', 'madhapur'],
  bengaluru: ['bengaluru', 'bangalore', 'blr'],
  bangalore: ['bengaluru', 'bangalore', 'blr'],
  mumbai: ['mumbai', 'bombay', 'navi mumbai'],
  delhi: ['delhi', 'new delhi', 'ncr', 'gurugram', 'gurgaon', 'noida'],
  chennai: ['chennai', 'madras'],
  pune: ['pune'],
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
  'san francisco',
  'bay area',
  'new york',
  'nyc',
  'seattle',
  'austin',
  'boston',
  'chicago',
  'los angeles',
  'london',
  'berlin',
  'amsterdam',
  'paris',
  'toronto',
  'dublin',
  'zurich',
  'sydney',
  'melbourne',
  'singapore',
  'dubai',
  'uae',
  'munich',
  'stockholm',
  'united states',
  'usa',
  'canada',
  'united kingdom',
  'germany',
  'france',
  'netherlands',
  'australia',
  'ireland',
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
    /\b\d{1,2}\+?\s*years?\s+(?:in\s+business|of\s+history|old|ago|strong|legacy|founded|operating|market\s+presence)\b/gi;
  const upperBoundPrefixRegex = /\b(?:up\s+to|less\s+than|under|below)\s+$/i;

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
      const prefixWindow = cleaned.slice(Math.max(0, idx - 16), idx);
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

export function evaluateHardEligibility(job, profile) {
  const title = String(job?.title || '');
  const titleLower = title.toLowerCase();
  const locLower = String(job?.location || '').toLowerCase();
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
    );
  const descIndicatesIndiaRemote =
    /\b(remote\s*(?:in|from|within|across|:|-|–)?\s*india|india\s*(?:remote|only)|based\s+in\s+india|pan[\s-]?india|anywhere\s+in\s+india|remote\s*\(india\))\b/i.test(
      descLower
    );
  const descIndicatesGlobalRemote =
    /\b(work\s+from\s+anywhere|anywhere\s+in\s+the\s+world|worldwide\s+remote|remote\s*(?:worldwide|globally|anywhere)|global\s+remote)\b/i.test(
      descLower
    );
  const locSaysRemote = /\b(remote|worldwide|global|anywhere|work\s+from\s+home|wfh)\b/i.test(
    locLower
  );

  const reasons = [];

  // 1. Work authorization / no-sponsorship / US-citizenship / STEM OPT check across FULL text
  const noSponsorPattern =
    /\b(?:do\s+not|don['’]?t|does\s+not|doesn['’]?t|will\s+not|won['’]?t|unable\s+to|cannot|can['’]?t|not|no|without)\s+(?:currently\s+)?(?:require|provide|offer|support|sponsor|participate\s+in)(?:\s+(?:current|or|future|employer|visa|work))*\s*(?:sponsor(?:ship|ing)?|stem[\s-]?opt|visa)\b/i;
  const usWorkAuthPattern =
    /\b(?:stem[\s-]?opt|opt[\s/]?cpt|h-?1b|tn\s+visa|w-?2\s+only|no\s+c2c|e-?verify|i-?9\s+(?:form|verification|eligibility)|security\s+clearance|u\.?s\.?\s+citizens?\s+only|us\s+permanent\s+residents?\s+only|green\s+card\s+holders?\s+only|u\.?s\.?\s+work\s+authoriz(?:ation|ed)|authorized\s+to\s+work\s+in\s+the\s+(?:united\s+states|u\.?s\.?a?\.?|uk|united\s+kingdom|canada|european\s+union|eu|australia)|legally\s+authorized\s+to\s+work\s+in\s+the\s+(?:united\s+states|u\.?s\.?a?\.?|uk|eu|canada))\b/i;

  let workAuthBlocked = false;
  if (noSponsorPattern.test(fullText) || usWorkAuthPattern.test(fullText)) {
    const isPureIndiaPosting =
      (locMatchesTargetHub || locIndicatesIndia) &&
      !/\b(stem[\s-]?opt|h-?1b|u\.?s\.?|united\s+states|uk|european\s+union|canada|australia)\b/i.test(
        fullText
      );
    if (!isPureIndiaPosting) {
      workAuthBlocked = true;
      reasons.push(
        'Blocked: Requires US/foreign work authorization or states no visa/STEM OPT sponsorship'
      );
    }
  }

  // 2. Geographic / fake-remote / metro-preference / strict target hub check
  let geoBlocked = false;

  const foreignRemoteLocPattern =
    /\b(?:us[\s-]*only|u\.?s\.?[\s-]*only|usa[\s-]*only|united\s+states|north\s+america|americas|latam|emea|europe(?:\s+only)?|eu[\s-]*only|uk[\s-]*only|united\s+kingdom|canada(?:\s+only)?|australia|germany|france|netherlands|spain|ireland|sweden|switzerland|pst|est|cst|cet)\b/i;
  const usStateLocPattern =
    /,\s*(?:al|ak|az|ar|ca|co|ct|de|fl|ga|hi|id|il|in|ia|ks|ky|la|me|md|ma|mi|mn|ms|mo|mt|ne|nv|nh|nj|nm|ny|nc|nd|oh|ok|or|pa|ri|sc|sd|tn|tx|ut|vt|va|wa|wv|wi|wy|dc)\b/i;

  if (
    (foreignRemoteLocPattern.test(locLower) || usStateLocPattern.test(locLower)) &&
    !locMatchesTargetHub &&
    !locIndicatesIndia &&
    !openToRelocation
  ) {
    geoBlocked = true;
    reasons.push(`Blocked: Location "${job?.location || ''}" is restricted outside target hubs`);
  }

  // Detect "Remote, but strong preference for NYC/Seattle/SF/US/UK/EU" or residency/travel locks in JD
  const metroPrefRegex =
    /(?:strong\s+preference\s+for\s+(?:candidates|applicants)|prefer\s+(?:candidates|applicants)|prioritize\s+applicants\s+who\s+live|concentrated\s+in\s+(?:those|these|the)\s+areas|must\s+(?:reside|live|be\s+based|be\s+located)\s+in|candidates\s+(?:must\s+be\s+)?(?:based|located)\s+in|hiring\s+(?:only|exclusively)\s+in|only\s+(?:open|accepting\s+applications)\s+(?:to|from)\s+(?:candidates|applicants|residents)\s+(?:in|from)|travel\s+(?:to|for)\s+(?:an?\s+)?in-person|quarterly\s+in-person|in-person\s+collaboration)/gi;

  if (!geoBlocked && !locMatchesTargetHub && !descMatchesTargetHub) {
    const prefMatches = [...descLower.matchAll(metroPrefRegex)];
    for (const pm of prefMatches) {
      const idx = pm.index ?? 0;
      const snippet = descLower.slice(Math.max(0, idx - 120), Math.min(descLower.length, idx + 220));
      const mentionsTargetOrIndia =
        targetTokenArr.some((t) => hasWholeWord(snippet, t)) || /\bindia\b/i.test(snippet);
      const mentionsForeignArea =
        /\b(?:new york|nyc|san francisco|bay area|seattle|austin|boston|chicago|los angeles|london|berlin|amsterdam|paris|toronto|dublin|zurich|sydney|melbourne|united states|u\.?s\.?a?\.?|north america|americas|europe|eu|uk|emea|canada|areas|those|these)\b/i.test(
          snippet
        ) ||
        usStateLocPattern.test(snippet) ||
        /\bin-person|quarterly\b/i.test(pm[0]);

      if (mentionsForeignArea && !mentionsTargetOrIndia && !openToRelocation) {
        geoBlocked = true;
        reasons.push(
          'Blocked: JD enforces foreign metro/residency preference or periodic in-person travel outside target hubs'
        );
        break;
      }
    }
  }

  // Catch US-only timezone / remote-(US) / 401(k)-without-global markers in JD
  if (!geoBlocked && !locMatchesTargetHub && !descMatchesTargetHub && !openToRelocation) {
    const usOnlyJdMarkers =
      /\b(?:remote\s*[-–:(]+\s*(?:us|usa|u\.?s\.?|united states|north america|uk|eu|emea)|(?:us|north america|european|pacific|eastern)\s+time\s*zones?\s+only|(?:pst|est|cst|cet)\s+working\s+hours\s+only|united\s+states\s+only|must\s+be\s+located\s+in\s+the\s+(?:us|united\s+states|uk|eu))\b/i;
    const usBenefitsOnly =
      /\b401\s*\(?k\)?\b|\bhealth,?\s*dental,?\s*(?:and\s+)?vision\b/i.test(descLower) &&
      !descIndicatesIndiaRemote &&
      !descIndicatesGlobalRemote &&
      !locIndicatesIndia;

    if (usOnlyJdMarkers.test(descLower) || usBenefitsOnly) {
      geoBlocked = true;
      reasons.push(
        'Blocked: US/foreign-locked remote role (timezone, residency, or US-only benefits with no India/global track)'
      );
    }
  }

  // Catch explicit physical non-target cities when open_to_relocation is false
  if (!geoBlocked && !openToRelocation && !locMatchesTargetHub && !descMatchesTargetHub) {
    const mentionedOtherCity = KNOWN_NON_TARGET_LOCATIONS.find(
      (c) => !targetTokenArr.includes(c) && hasWholeWord(locLower, c)
    );
    const hasGlobalOrIndiaRemote =
      (locSaysRemote && !mentionedOtherCity && !usStateLocPattern.test(locLower)) ||
      descIndicatesIndiaRemote ||
      descIndicatesGlobalRemote;

    if (mentionedOtherCity && !hasGlobalOrIndiaRemote) {
      geoBlocked = true;
      reasons.push(
        `Blocked: Location "${job?.location || mentionedOtherCity}" does not match strict target cities (${targetCities.join(', ')})`
      );
    } else if (!locSaysRemote && !locIndicatesIndia && !descIndicatesIndiaRemote && !descIndicatesGlobalRemote) {
      const vagueLoc = !locLower || /\b(not specified|direct career portal|flexible|on-?site|hybrid)\b/i.test(locLower);
      if (vagueLoc && cleanDesc.length > 0 && !descMatchesTargetHub) {
        const foreignInDesc = KNOWN_NON_TARGET_LOCATIONS.find(
          (c) => !targetTokenArr.includes(c) && hasWholeWord(descLower, c)
        );
        if (foreignInDesc) {
          geoBlocked = true;
          reasons.push(
            `Blocked: Role references ${foreignInDesc} with no ${targetCities.join('/')} or India-remote track`
          );
        }
      }
    }
  }

  // 3. Strict Fresher / Entry-Level Seniority Enforcement
  const requiredYears = extractRequiredYearsStrict(fullText);
  let seniorityBlocked = false;

  if (candidateYears <= 1) {
    const hardSeniorTitle =
      /\b(senior|sr\.?|staff|principal|director|vp|vice\s+president|head\s+of|chief|architect|evp|svp|avp|manager\s+(?:ii|iii|iv|2|3|4)|iii|iv)\b/i.test(
        titleLower
      );
    const matchesExactTargetTitle = (profile?.target_roles || []).some(
      (r) => String(r || '').trim().toLowerCase() === titleLower.trim()
    );
    const leadTitleBlock =
      candidateYears === 0 &&
      /\blead\b/i.test(titleLower) &&
      !matchesExactTargetTitle &&
      !/\b(associate|junior|intern|fresher|entry)\b/i.test(titleLower);

    const minAllowedYears = candidateYears === 0 ? 2 : candidateYears + 2;
    const yearsBlocked = requiredYears !== null && requiredYears >= minAllowedYears;
    const noFreshersBlocked =
      /\b(?:not\s+entry[- ]level|no\s+freshers|experienced\s+(?:candidates|professionals?)\s+only)\b/i.test(
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
  const isIndiaAccessibleRemote =
    !workAuthBlocked &&
    !geoBlocked &&
    (descIndicatesIndiaRemote ||
      (locSaysRemote && (locIndicatesIndia || descIndicatesGlobalRemote)) ||
      (locSaysRemote && !foreignRemoteLocPattern.test(locLower)));

  return {
    eligible,
    reasons,
    flags: {
      workAuthBlocked,
      geoBlocked,
      seniorityBlocked,
      matchesTargetHub: locMatchesTargetHub || descMatchesTargetHub,
      isIndiaAccessibleRemote,
      hasStrictFresherBlocker: seniorityBlocked,
      requiredYears,
      descriptionLength: cleanDesc.length,
      hasThinDescription: cleanDesc.length < 160,
    },
  };
}
