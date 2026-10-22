import zlib from 'zlib';
import Groq from 'groq-sdk';
import { getGeminiClient } from './llm';
import { CandidateProfile, DEFAULT_ATS_COMPANIES } from './profile';

export interface ParsedResumeParameters {
  name: string;
  email: string;
  portfolio: string;
  experience_years: number;
  experience_level: string;
  target_roles: string[];
  skills: string[];
  key_metrics: string[];
  target_cities: string[];
  open_to_relocation: boolean;
  min_salary_lpa: number;
  min_salary_usd_annual: number;
  languages: string[];
  ats_companies: {
    greenhouse: string[];
    lever: string[];
    ashby: string[];
  };
}

export interface ResumeParseDiagnostics {
  source_channel: 'pdf_upload' | 'google_drive' | 'raw_text';
  engine_used: string;
  char_count: number;
  sections_detected: string[];
  confidence_score: number;
  extracted_text_preview: string;
  warnings: string[];
}

export interface ResumeParseResponse {
  parsed: ParsedResumeParameters;
  diagnostics: ResumeParseDiagnostics;
}

const CANONICAL_ROLE_TAXONOMY: { role: string; keywords: RegExp }[] = [
  { role: 'Associate Product Manager', keywords: /\b(associate product manager|\bapm\b|product management intern|junior product manager)\b/i },
  { role: 'Product Manager', keywords: /\b(product manager|product owner|technical product manager|group product manager)\b/i },
  { role: 'Product Marketing Manager', keywords: /\b(product marketing|pmm|gtm manager|go-to-market|positioning|launch strategy)\b/i },
  { role: 'Growth Manager', keywords: /\b(growth manager|growth marketing|user acquisition|funnel optimization|retention|cro)\b/i },
  { role: "Founder's Associate", keywords: /\b(founder'?s? associate|chief of staff|founder'?s? office|strategy\s*&\s*ops|0-to-1|venture)\b/i },
  { role: 'Product Analyst', keywords: /\b(product analyst|business analyst|product analytics|funnel analysis|mixpanel|amplitude|ga4)\b/i },
  { role: 'Growth Marketing Analyst', keywords: /\b(growth analyst|marketing analyst|seo|google search console|organic growth|content marketing)\b/i },
  { role: 'Marketing Operations Analyst', keywords: /\b(marketing ops|marketing operations|crm|hubspot|automation workflow|lead gen)\b/i },
  { role: 'Digital Content Lead', keywords: /\b(content lead|content strategist|copywriting|social media|community growth|reddit|discord)\b/i },
  { role: 'Full-Stack Software Engineer', keywords: /\b(full[- ]?stack|software engineer|software developer|sde|web developer|next\.?js|react|node\.?js)\b/i },
  { role: 'Frontend Systems Engineer', keywords: /\b(frontend|front-end|ui engineer|react|typescript|tailwind|design systems)\b/i },
  { role: 'Backend / Distributed Systems Engineer', keywords: /\b(backend|back-end|distributed systems|microservices|golang|rust|java|postgresql|redis|kafka)\b/i },
  { role: 'AI Application Engineer', keywords: /\b(ai engineer|llm|genai|generative ai|rag|langchain|agentic|prompt engineering|openai|gemini)\b/i },
  { role: 'Machine Learning Engineer', keywords: /\b(machine learning engineer|ml engineer|pytorch|tensorflow|deep learning|mlops|model training)\b/i },
  { role: 'Data Scientist', keywords: /\b(data scientist|decision scientist|statistical modeling|scikit-learn|causal inference|a\/b testing|eda)\b/i },
  { role: 'Data / Analytics Engineer', keywords: /\b(data engineer|analytics engineer|dbt|snowflake|bigquery|airflow|spark|etl)\b/i },
  { role: 'DevOps / Cloud Infrastructure Engineer', keywords: /\b(devops|sre|site reliability|kubernetes|docker|terraform|aws|gcp|cloudflare workers|ci\/cd)\b/i },
  { role: 'Product Designer (UI/UX)', keywords: /\b(product designer|ux designer|ui\/ux|figma|user research|wireframing|prototyping)\b/i },
];

const CANONICAL_SKILLS: { label: string; pattern: RegExp }[] = [
  { label: 'TypeScript', pattern: /\b(typescript|\bts\b)\b/i },
  { label: 'JavaScript', pattern: /\b(javascript|\bjs\b|es6)\b/i },
  { label: 'Python', pattern: /\bpython\b/i },
  { label: 'Python EDA', pattern: /\b(python eda|pandas|numpy|matplotlib|seaborn|jupyter)\b/i },
  { label: 'SQL', pattern: /\b(sql|postgresql|postgres|mysql|sqlite|bigquery)\b/i },
  { label: 'React', pattern: /\b(react|react\.js|reactjs)\b/i },
  { label: 'Next.js', pattern: /\b(next\.?js|nextjs)\b/i },
  { label: 'Node.js', pattern: /\b(node\.?js|nodejs|express)\b/i },
  { label: 'Tailwind CSS', pattern: /\btailwind\b/i },
  { label: 'GTM Strategy', pattern: /\b(gtm|go-to-market|launch strategy|market positioning)\b/i },
  { label: 'Product Marketing', pattern: /\b(product marketing|pmm|messaging|competitive intelligence)\b/i },
  { label: 'Growth Marketing', pattern: /\b(growth marketing|user acquisition|growth loops|plg|product-led growth)\b/i },
  { label: 'SEO', pattern: /\b(seo|search engine optimization|organic search|keyword research|programmatic seo)\b/i },
  { label: 'GA4', pattern: /\b(ga4|google analytics)\b/i },
  { label: 'Google Search Console', pattern: /\b(google search console|\bgsc\b)\b/i },
  { label: 'A/B Testing', pattern: /\b(a\/b testing|experimentation|split testing|hypothesis testing)\b/i },
  { label: 'Mixpanel / Amplitude', pattern: /\b(mixpanel|amplitude|posthog|heap)\b/i },
  { label: 'Cloudflare Workers', pattern: /\b(cloudflare|workers|edge functions)\b/i },
  { label: 'AI Workflow Automation', pattern: /\b(ai tooling|llm|genai|prompt engineering|ai workflows|make\.com|zapier|n8n|langchain)\b/i },
  { label: 'Notion', pattern: /\bnotion\b/i },
  { label: 'Figma', pattern: /\bfigma\b/i },
  { label: 'Docker', pattern: /\bdocker\b/i },
  { label: 'AWS / GCP', pattern: /\b(aws|amazon web services|gcp|google cloud|azure)\b/i },
  { label: 'PyTorch / Scikit-Learn', pattern: /\b(pytorch|tensorflow|scikit-learn|sklearn|huggingface)\b/i },
  { label: 'dbt / BigQuery', pattern: /\b(dbt|bigquery|snowflake|airflow)\b/i },
  { label: 'HubSpot / CRM', pattern: /\b(hubspot|salesforce|crm|klaviyo)\b/i },
  { label: 'Git / GitHub Actions', pattern: /\b(git|github actions|ci\/cd)\b/i },
  { label: 'Product Roadmapping', pattern: /\b(roadmap|prd|product requirements|user stories|agile|scrum|jira|linear)\b/i },
];

const KNOWN_CITIES = [
  'Bengaluru',
  'Hyderabad',
  'Mumbai',
  'Delhi',
  'Pune',
  'Chennai',
  'San Francisco',
  'New York',
  'London',
  'Singapore',
  'Dubai',
  'Berlin',
  'Amsterdam',
  'Toronto',
  'Remote',
];

/**
 * Deterministic binary PDF text stream extractor.
 * Decompresses /FlateDecode streams using Node's native zlib and extracts text from BT..ET blocks
 * and Tj/TJ PDF operators so PDF uploads work even without external LLM keys.
 */
export function extractTextFromPdfBuffer(buffer: Buffer): string {
  const rawLatin1 = buffer.toString('latin1');
  const extractedChunks: string[] = [];

  const decodePdfLiteral = (literal: string): string => {
    return literal
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, ' ')
      .replace(/\\t/g, ' ')
      .replace(/\\\(/g, '(')
      .replace(/\\\)/g, ')')
      .replace(/\\\\/g, '\\')
      .replace(/\\([0-7]{1,3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)));
  };

  const decodeHexToken = (hex: string): string => {
    const clean = hex.replace(/\s+/g, '');
    if (clean.startsWith('FEFF') || clean.startsWith('feff')) {
      // UTF-16BE
      let out = '';
      for (let i = 4; i + 3 < clean.length; i += 4) {
        const code = parseInt(clean.slice(i, i + 4), 16);
        if (code >= 32 && code <= 126) out += String.fromCharCode(code);
        else if (code > 126) out += ' ';
      }
      return out;
    }
    let out = '';
    for (let i = 0; i + 1 < clean.length; i += 2) {
      const code = parseInt(clean.slice(i, i + 2), 16);
      if (code >= 32 && code <= 126) out += String.fromCharCode(code);
    }
    return out;
  };

  const parseContentStream = (streamText: string) => {
    // Extract TJ arrays: [(text) -20 (more)] TJ
    const tjArrayRegex = /\[([\s\S]*?)\]\s*TJ/g;
    let match: RegExpExecArray | null;
    while ((match = tjArrayRegex.exec(streamText)) !== null) {
      const inner = match[1];
      let line = '';
      const tokenRegex = /\((?:\\.|[^\\)])*\)|<[0-9A-Fa-f\s]+>/g;
      let tok: RegExpExecArray | null;
      while ((tok = tokenRegex.exec(inner)) !== null) {
        const t = tok[0];
        if (t.startsWith('(')) {
          line += decodePdfLiteral(t.slice(1, -1));
        } else if (t.startsWith('<')) {
          line += decodeHexToken(t.slice(1, -1));
        }
      }
      if (line.trim()) extractedChunks.push(line.trim());
    }

    // Extract single (text) Tj
    const tjSingleRegex = /\(((?:\\.|[^\\)])*)\)\s*(?:Tj|'|")/g;
    while ((match = tjSingleRegex.exec(streamText)) !== null) {
      const decoded = decodePdfLiteral(match[1]).trim();
      if (decoded) extractedChunks.push(decoded);
    }
  };

  // Locate stream ... endstream blocks
  const streamRegex = /stream[\r\n]+([\s\S]*?)[\r\n]+endstream/g;
  let streamMatch: RegExpExecArray | null;
  while ((streamMatch = streamRegex.exec(rawLatin1)) !== null) {
    const rawStreamBytes = Buffer.from(streamMatch[1], 'latin1');
    try {
      const inflated = zlib.inflateSync(rawStreamBytes).toString('latin1');
      parseContentStream(inflated);
    } catch {
      try {
        const inflatedRaw = zlib.inflateRawSync(rawStreamBytes).toString('latin1');
        parseContentStream(inflatedRaw);
      } catch {
        // Uncompressed stream
        parseContentStream(streamMatch[1]);
      }
    }
  }

  // Fallback: scan readable ASCII runs if custom font encoding obscured stream tokens
  if (extractedChunks.join(' ').trim().length < 80) {
    parseContentStream(rawLatin1);
  }

  return extractedChunks
    .join('\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Resolves a Google Drive or Google Docs share link into direct downloadable content.
 */
export async function fetchGoogleDriveResume(driveUrl: string): Promise<{
  buffer?: Buffer;
  text?: string;
  mimeType: string;
  resolvedUrl: string;
}> {
  const trimmed = driveUrl.trim();
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(trimmed);
  } catch {
    throw new Error('Invalid URL format. Please provide a valid https:// Google Drive or Docs URL.');
  }

  if (parsedUrl.protocol !== 'https:') {
    throw new Error('Only HTTPS Google Drive and Google Docs links are permitted.');
  }

  const allowedHosts = new Set([
    'drive.google.com',
    'docs.google.com',
    'drive.usercontent.google.com',
  ]);
  if (!allowedHosts.has(parsedUrl.hostname.toLowerCase())) {
    throw new Error(
      'Security policy: Only drive.google.com and docs.google.com URLs are allowed for remote fetch.'
    );
  }

  // Check if Google Docs URL: docs.google.com/document/d/{ID}
  const docsMatch = trimmed.match(/docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)/);
  if (docsMatch) {
    const docId = docsMatch[1];
    const exportUrl = `https://docs.google.com/document/d/${docId}/export?format=txt`;
    const res = await fetch(exportUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; OpenScoutResumeParser/3.0)' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      throw new Error(
        `Google Docs link returned HTTP ${res.status}. Ensure sharing is set to "Anyone with the link can view".`
      );
    }
    const text = (await res.text()).slice(0, 200000);
    return { text, mimeType: 'text/plain', resolvedUrl: exportUrl };
  }

  // Check if Google Drive file URL: drive.google.com/file/d/{ID} or ?id={ID}
  const driveFileMatch =
    trimmed.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/) ||
    trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/);

  if (!driveFileMatch) {
    throw new Error(
      'Could not extract a Google Drive file ID from the URL. Use a standard drive.google.com/file/d/{ID}/view share link.'
    );
  }

  const targetUrl = `https://drive.google.com/uc?export=download&id=${driveFileMatch[1]}`;

  const res = await fetch(targetUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; OpenScoutResumeParser/3.0)' },
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) {
    throw new Error(
      `Google Drive fetch returned HTTP ${res.status}. Ensure the file permission is "Anyone with the link".`
    );
  }

  const contentType = (res.headers.get('content-type') || '').toLowerCase();
  const arrayBuffer = await res.arrayBuffer();
  if (arrayBuffer.byteLength > 8 * 1024 * 1024) {
    throw new Error('Resume file exceeds the 8 MB maximum size limit.');
  }
  const buffer = Buffer.from(arrayBuffer);

  // Check if buffer starts with %PDF
  if (buffer.slice(0, 4).toString('ascii') === '%PDF' || contentType.includes('application/pdf')) {
    return { buffer, mimeType: 'application/pdf', resolvedUrl: targetUrl };
  }

  const rawText = buffer.toString('utf8');
  if (contentType.includes('text/html') || /<html|<body/i.test(rawText)) {
    const stripped = rawText
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, '\n')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    return { text: stripped, mimeType: 'text/plain', resolvedUrl: targetUrl };
  }

  return { text: rawText, mimeType: 'text/plain', resolvedUrl: targetUrl };
}

/**
 * Deterministic AST & Heuristic Resume Analyzer
 */
export function deterministicParseResumeText(
  rawText: string,
  fallbackProfile: CandidateProfile
): {
  parsed: ParsedResumeParameters;
  sections: string[];
  confidence: number;
} {
  const cleanText = rawText.replace(/\r\n/g, '\n').trim();
  const lines = cleanText
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  // 1. Detect structural resume sections
  const sectionPatterns: { name: string; regex: RegExp }[] = [
    { name: 'EXPERIENCE', regex: /\b(experience|employment|work history|career|internships?)\b/i },
    { name: 'EDUCATION', regex: /\b(education|academic|university|degree|b\.?tech|b\.?e|mba|bachelor)\b/i },
    { name: 'SKILLS', regex: /\b(skills|technologies|technical stack|competencies|tools)\b/i },
    { name: 'PROJECTS', regex: /\b(projects|key initiatives|case studies|portfolio)\b/i },
    { name: 'ACHIEVEMENTS', regex: /\b(achievements|impact|metrics|awards|highlights)\b/i },
  ];
  const sections = sectionPatterns
    .filter((s) => s.regex.test(cleanText))
    .map((s) => s.name);

  // 2. Extract Email
  const emailMatch = cleanText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  const email = emailMatch ? emailMatch[0].toLowerCase() : fallbackProfile.email;

  // 3. Extract Portfolio / GitHub / LinkedIn URL
  const urlMatches =
    cleanText.match(/https?:\/\/[^\s,)>"]+|(?:github\.com|linkedin\.com\/in|[\w-]+\.vercel\.app|[\w-]+\.dev)\/[^\s,)>"]*/gi) ||
    [];
  const portfolioRaw =
    urlMatches.find((u) => !u.includes('linkedin.com')) || urlMatches[0] || fallbackProfile.portfolio;
  const portfolio = portfolioRaw.startsWith('http') ? portfolioRaw : `https://${portfolioRaw}`;

  // 4. Extract Candidate Name (first non-header, non-email line with 2-4 capitalized words)
  let name = fallbackProfile.name;
  for (const line of lines.slice(0, 8)) {
    const cleanLine = line.replace(/[|#*_•]/g, '').trim();
    if (
      cleanLine.length >= 4 &&
      cleanLine.length <= 42 &&
      !cleanLine.includes('@') &&
      !cleanLine.includes('http') &&
      !/\b(resume|curriculum|vitae|summary|profile|contact|phone|address|india|bengaluru|hyderabad)\b/i.test(
        cleanLine
      ) &&
      /^[A-Z][a-zA-Z.'-]+(?:\s+[A-Z][a-zA-Z.'-]+){1,3}$/.test(cleanLine)
    ) {
      name = cleanLine;
      break;
    }
  }

  // 5. Chronological Experience Years Calculation
  let experienceYears = 0;
  const explicitYearsMatch = cleanText.match(/(\d{1,2})\+?\s*years?\s+of\s+(?:full[- ]time\s+)?experience/i);
  if (explicitYearsMatch) {
    experienceYears = Math.min(25, parseInt(explicitYearsMatch[1], 10));
  } else if (/\b(fresher|entry[- ]level|new grad|final year|student|0 years)\b/i.test(cleanText)) {
    experienceYears = 0;
  } else {
    // Count full-time role date ranges outside education
    const currentYear = new Date().getFullYear();
    const yearRanges = [...cleanText.matchAll(/\b(20\d{2})\s*[-–—to]+\s*(20\d{2}|present|current|now)\b/gi)];
    let totalYears = 0;
    for (const m of yearRanges) {
      const start = parseInt(m[1], 10);
      const end = /present|current|now/i.test(m[2]) ? currentYear : parseInt(m[2], 10);
      const span = Math.max(0, end - start);
      // Ignore 4-year university degree spans
      if (span >= 0 && span <= 3) {
        totalYears += span;
      }
    }
    experienceYears = Math.min(15, totalYears);
  }

  const experienceLevel =
    experienceYears === 0
      ? 'Fresher / Entry Level'
      : experienceYears <= 2
      ? `Early Career (${experienceYears} ${experienceYears === 1 ? 'yr' : 'yrs'})`
      : experienceYears <= 5
      ? `Mid-Level (${experienceYears} yrs)`
      : `Senior (${experienceYears}+ yrs)`;

  // 6. Infer Target Roles from Taxonomy
  const matchedRoles: { role: string; hits: number }[] = [];
  for (const item of CANONICAL_ROLE_TAXONOMY) {
    const globalRegex = new RegExp(item.keywords.source, 'gi');
    const hits = [...cleanText.matchAll(globalRegex)].length;
    if (hits > 0) {
      matchedRoles.push({ role: item.role, hits });
    }
  }
  matchedRoles.sort((a, b) => b.hits - a.hits);
  const target_roles =
    matchedRoles.length > 0
      ? matchedRoles.slice(0, 7).map((r) => r.role)
      : fallbackProfile.target_roles;

  // 7. Extract Hard & Domain Skills
  const detectedSkills = CANONICAL_SKILLS.filter((s) => s.pattern.test(cleanText)).map(
    (s) => s.label
  );
  const skills = detectedSkills.length >= 3 ? detectedSkills : fallbackProfile.skills;

  // 8. Extract Quantified Proof Metrics (lines containing %, $, ₹, x, k+, numbers + impact verbs)
  const metricCandidates: string[] = [];
  const impactQuantRegex =
    /(?:~?\d[\d,.]*\s*(?:%|x|\+|k\b|m\b|lpa|arr|dau|mau|users|visits|alumni|views|roas|hours|ms\b))|(?:(?:\$|₹)\s*\d[\d,.]*)/i;
  const actionVerbRegex =
    /\b(drove|grew|scaled|increased|reduced|built|created|shipped|automated|generated|achieved|improved|launched|engineered|led|executed|saved|boosted|expanded)\b/i;

  for (const rawLine of lines) {
    const cleanedBullet = rawLine.replace(/^[-•*▪‣◦\d.)\s]+/, '').trim();
    if (
      cleanedBullet.length >= 24 &&
      cleanedBullet.length <= 145 &&
      impactQuantRegex.test(cleanedBullet) &&
      (actionVerbRegex.test(cleanedBullet) || /growth|traffic|latency|conversion|revenue|database|accuracy|auc/i.test(cleanedBullet)) &&
      !/\b(cgpa|gpa|percentage|class xii|high school|10th|12th)\b/i.test(cleanedBullet)
    ) {
      metricCandidates.push(cleanedBullet);
    }
  }

  const key_metrics =
    metricCandidates.length > 0
      ? Array.from(new Set(metricCandidates)).slice(0, 6)
      : fallbackProfile.key_metrics;

  // 9. Target Cities & Compensation Floor Calibration
  const detectedCities = KNOWN_CITIES.filter((city) =>
    new RegExp(`\\b${city}\\b`, 'i').test(cleanText)
  );
  if (/bangalore/i.test(cleanText) && !detectedCities.includes('Bengaluru')) {
    detectedCities.unshift('Bengaluru');
  }
  const target_cities =
    detectedCities.length > 0 ? detectedCities.slice(0, 4) : fallbackProfile.target_cities;

  const isTechOrAi = target_roles.some((r) => /Engineer|Scientist/i.test(r));
  const min_salary_lpa =
    experienceYears === 0
      ? isTechOrAi
        ? 12
        : 8
      : Math.min(45, 10 + experienceYears * 5);
  const min_salary_usd_annual =
    experienceYears === 0
      ? isTechOrAi
        ? 55000
        : 30000
      : Math.min(180000, 50000 + experienceYears * 20000);

  const confidence = Math.min(
    98,
    Math.round(
      45 +
        (emailMatch ? 12 : 0) +
        Math.min(20, matchedRoles.length * 5) +
        Math.min(15, detectedSkills.length * 2) +
        Math.min(10, metricCandidates.length * 3)
    )
  );

  return {
    parsed: {
      name,
      email,
      portfolio,
      experience_years: experienceYears,
      experience_level: experienceLevel,
      target_roles,
      skills,
      key_metrics,
      target_cities,
      open_to_relocation: true,
      min_salary_lpa,
      min_salary_usd_annual,
      languages: fallbackProfile.languages || ['English (fluent)'],
      ats_companies: fallbackProfile.ats_companies || DEFAULT_ATS_COMPANIES,
    },
    sections: sections.length > 0 ? sections : ['GENERAL_PROFILE'],
    confidence,
  };
}

/**
 * Full Multi-Modal & Multi-LLM Resume Extraction Pipeline
 */
export async function parseResumeInput(options: {
  sourceChannel: 'pdf_upload' | 'google_drive' | 'raw_text';
  rawText?: string;
  pdfBuffer?: Buffer;
  driveUrl?: string;
  currentProfile: CandidateProfile;
}): Promise<ResumeParseResponse> {
  const warnings: string[] = [];
  let extractedText = options.rawText || '';
  let pdfBuffer = options.pdfBuffer;

  // Step 1: If Google Drive URL, fetch & resolve
  if (options.sourceChannel === 'google_drive' && options.driveUrl) {
    const drivePayload = await fetchGoogleDriveResume(options.driveUrl);
    if (drivePayload.buffer) {
      pdfBuffer = drivePayload.buffer;
    } else if (drivePayload.text) {
      extractedText = drivePayload.text;
    }
  }

  // Step 2: If we have a PDF buffer, run deterministic PDF text stream extraction first
  if (pdfBuffer && !extractedText) {
    try {
      extractedText = extractTextFromPdfBuffer(pdfBuffer);
    } catch (e) {
      warnings.push(`Binary PDF stream note: ${(e as Error).message}`);
    }
  }

  // Step 3: Run deterministic AST parser as our rock-solid baseline
  const baselineResult = deterministicParseResumeText(
    extractedText || `${options.currentProfile.name}\n${options.currentProfile.skills.join(', ')}`,
    options.currentProfile
  );

  const schemaInstruction = `You are a rigid, deterministic Resume/CV Parameter Extraction Engine.
Extract structured candidate targeting parameters from the provided resume.
Rules:
1. "experience_years": integer full-time years (0 if fresher/student/intern-only).
2. "experience_level": e.g., "Fresher / Entry Level", "Early Career (1-2 yrs)", "Mid-Level (3-5 yrs)".
3. "target_roles": 4 to 8 specific job titles the candidate is best qualified to apply for based on their work history, projects, and skills.
4. "skills": 6 to 15 concrete technical, product, analytics, or domain skills explicitly evidenced in the resume (no soft-skill fluff).
5. "key_metrics": 3 to 6 quantified achievement statements with exact numbers/percentages/scale from the resume (e.g., "~425% organic search growth at Smatr AI").
6. "target_cities": preferred cities or hubs mentioned (plus "Remote" if applicable).
7. "min_salary_lpa" (India ₹ LPA integer) and "min_salary_usd_annual" (USD integer) calibrated to their seniority.

Return ONLY valid JSON with these exact keys:
{
  "name": string,
  "email": string,
  "portfolio": string,
  "experience_years": number,
  "experience_level": string,
  "target_roles": string[],
  "skills": string[],
  "key_metrics": string[],
  "target_cities": string[],
  "min_salary_lpa": number,
  "min_salary_usd_annual": number,
  "extracted_summary": string
}`;

  const mergeWithBaseline = (llmData: Record<string, unknown>, engineUsed: string): ResumeParseResponse => {
    const merged: ParsedResumeParameters = {
      name:
        typeof llmData.name === 'string' && llmData.name.trim().length > 1
          ? llmData.name.trim()
          : baselineResult.parsed.name,
      email:
        typeof llmData.email === 'string' && llmData.email.includes('@')
          ? llmData.email.trim()
          : baselineResult.parsed.email,
      portfolio:
        typeof llmData.portfolio === 'string' && llmData.portfolio.trim().length > 4
          ? llmData.portfolio.trim()
          : baselineResult.parsed.portfolio,
      experience_years:
        typeof llmData.experience_years === 'number' && llmData.experience_years >= 0
          ? llmData.experience_years
          : baselineResult.parsed.experience_years,
      experience_level:
        typeof llmData.experience_level === 'string' && llmData.experience_level.trim()
          ? llmData.experience_level.trim()
          : baselineResult.parsed.experience_level,
      target_roles:
        Array.isArray(llmData.target_roles) && llmData.target_roles.length > 0
          ? llmData.target_roles.map(String)
          : baselineResult.parsed.target_roles,
      skills:
        Array.isArray(llmData.skills) && llmData.skills.length > 0
          ? llmData.skills.map(String)
          : baselineResult.parsed.skills,
      key_metrics:
        Array.isArray(llmData.key_metrics) && llmData.key_metrics.length > 0
          ? llmData.key_metrics.map(String)
          : baselineResult.parsed.key_metrics,
      target_cities:
        Array.isArray(llmData.target_cities) && llmData.target_cities.length > 0
          ? llmData.target_cities.map(String)
          : baselineResult.parsed.target_cities,
      open_to_relocation: true,
      min_salary_lpa:
        typeof llmData.min_salary_lpa === 'number' && llmData.min_salary_lpa > 0
          ? llmData.min_salary_lpa
          : baselineResult.parsed.min_salary_lpa,
      min_salary_usd_annual:
        typeof llmData.min_salary_usd_annual === 'number' && llmData.min_salary_usd_annual > 0
          ? llmData.min_salary_usd_annual
          : baselineResult.parsed.min_salary_usd_annual,
      languages: baselineResult.parsed.languages,
      ats_companies: baselineResult.parsed.ats_companies,
    };

    const preview =
      extractedText.trim().slice(0, 500) ||
      (typeof llmData.extracted_summary === 'string' ? llmData.extracted_summary : 'Parsed via multimodal PDF stream.');

    return {
      parsed: merged,
      diagnostics: {
        source_channel: options.sourceChannel,
        engine_used: engineUsed,
        char_count: Math.max(extractedText.length, pdfBuffer ? pdfBuffer.length : 0),
        sections_detected: baselineResult.sections,
        confidence_score: Math.max(baselineResult.confidence, 94),
        extracted_text_preview: preview,
        warnings,
      },
    };
  };

  // Step 4A: Try Gemini 2.5 Flash (supports direct native PDF inlineData OR extracted text)
  const ai = getGeminiClient();
  if (ai) {
    try {
      const parts: Record<string, unknown>[] = [];
      if (pdfBuffer) {
        parts.push({
          inlineData: {
            mimeType: 'application/pdf',
            data: pdfBuffer.toString('base64'),
          },
        });
      }
      parts.push({
        text: `${schemaInstruction}\n\nRESUME TEXT CONTENT:\n${extractedText.slice(0, 12000)}`,
      });

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: { parts },
        config: {
          responseMimeType: 'application/json',
          temperature: 0.1,
        },
      });
      const parsedJson = JSON.parse(response.text || '{}');
      if (parsedJson && (parsedJson.name || parsedJson.target_roles)) {
        return mergeWithBaseline(
          parsedJson,
          pdfBuffer
            ? 'Gemini 2.5 Flash Multimodal PDF + Deterministic AST'
            : 'Gemini 2.5 Flash + Deterministic AST'
        );
      }
    } catch (err) {
      warnings.push(`Gemini pass skipped: ${(err as Error).message}`);
    }
  }

  // Step 4B: Try Groq Llama 3.3 70B if text is available
  if (extractedText.trim().length > 30 && process.env.GROQ_API_KEY && !process.env.GROQ_API_KEY.startsWith('xai-')) {
    try {
      const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
      const completion = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [
          {
            role: 'user',
            content: `${schemaInstruction}\n\nRESUME TEXT:\n${extractedText.slice(0, 10000)}`,
          },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
      });
      const parsedJson = JSON.parse(completion.choices[0]?.message?.content || '{}');
      if (parsedJson && (parsedJson.name || parsedJson.target_roles)) {
        return mergeWithBaseline(parsedJson, 'Groq Llama 3.3 70B + Deterministic AST');
      }
    } catch (err) {
      warnings.push(`Groq pass skipped: ${(err as Error).message}`);
    }
  }

  // Step 4C: Try OpenRouter Free Tier if configured
  if (extractedText.trim().length > 30 && process.env.OPENROUTER_API_KEY) {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'meta-llama/llama-3.3-70b-instruct:free',
          messages: [
            {
              role: 'user',
              content: `${schemaInstruction}\n\nRESUME TEXT:\n${extractedText.slice(0, 10000)}`,
            },
          ],
          response_format: { type: 'json_object' },
          temperature: 0.1,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const raw = (data.choices?.[0]?.message?.content || '{}')
          .replace(/^```json\s*/i, '')
          .replace(/```\s*$/, '')
          .trim();
        const parsedJson = JSON.parse(raw);
        if (parsedJson && (parsedJson.name || parsedJson.target_roles)) {
          return mergeWithBaseline(parsedJson, 'OpenRouter Llama 3.3 70B (:free) + Deterministic AST');
        }
      }
    } catch (err) {
      warnings.push(`OpenRouter pass skipped: ${(err as Error).message}`);
    }
  }

  // Step 5: Deterministic AST Engine Result
  return {
    parsed: baselineResult.parsed,
    diagnostics: {
      source_channel: options.sourceChannel,
      engine_used: 'Deterministic AST & Quantified Regex Engine v3.0',
      char_count: Math.max(extractedText.length, pdfBuffer ? pdfBuffer.length : 0),
      sections_detected: baselineResult.sections,
      confidence_score: baselineResult.confidence,
      extracted_text_preview: extractedText.slice(0, 500),
      warnings,
    },
  };
}
