import { describe, it, expect, vi } from 'vitest';
import {
  buildPrompt,
  stripHtmlTags,
  scoreJobWithGemini,
  deriveDynamicSearchParams,
  scoreJobDeterministic,
} from '../scripts/scout.js';
import { deterministicParseResumeText } from '../lib/resume-parser';
import { FORK_PROFILE_TEMPLATES } from '../lib/profile';

describe('Scout logic & Dynamic FreeHire/Rubric tests', () => {
  it('strips HTML tags correctly', () => {
    const raw = '<p>Hello <b>world</b></p>';
    expect(stripHtmlTags(raw)).toBe('Hello world');
  });

  const validProfile = {
    name: 'Test',
    target_roles: ['Associate Product Manager', 'Growth Marketing Analyst'],
    target_cities: ['Hyderabad', 'Bengaluru'],
    experience_level: 'Fresher',
    experience_years: 0,
    open_to_relocation: true,
    relocation_preference: { preferred_regions: ['Remote', 'UAE'] },
    key_metrics: ['~425% organic search growth at Smatr AI'],
    skills: ['Python EDA', 'SEO', 'GA4', 'Product Marketing'],
    min_salary_lpa: 8,
    min_salary_usd_annual: 30000,
  };

  it('derives dynamic search slugs and tags from profile without hardcoding', () => {
    const derived = deriveDynamicSearchParams(validProfile);
    expect(derived.internshalaSlugs).toContain('product-management');
    expect(derived.internshalaSlugs).toContain('digital-marketing');
    expect(derived.remoteOkTags).toContain('product');
    expect(derived.remoteOkTags).toContain('growth');
    expect(derived.remotiveKeywords).toContain('associate product manager');
  });

  it('computes deterministic 4-pillar score and caps senior roles for freshers', () => {
    const goodJob = {
      title: 'Associate Product Manager (Entry Level)',
      company: { display_name: 'Acme' },
      location: 'Bengaluru',
      description: 'Looking for an entry-level APM with Python EDA, GA4, and SEO skills.',
    };
    const goodScore = scoreJobDeterministic(goodJob, validProfile);
    expect(goodScore.score).toBeGreaterThanOrEqual(85);
    expect(goodScore.subscores.role_match).toBeGreaterThanOrEqual(34);

    const seniorJob = {
      title: 'Senior Director of Engineering',
      company: { display_name: 'Legacy' },
      location: 'New York',
      description: 'Requires 8+ years of experience.',
    };
    const seniorScore = scoreJobDeterministic(seniorJob, validProfile);
    expect(seniorScore.score).toBeLessThanOrEqual(50);
  });

  it('parses resume text deterministically into structured roles, skills, and quantified metrics', () => {
    const sampleCv = `Shaik Kaisif Basha
shaikkaisifbasha04@gmail.com | https://portjitterglitter.vercel.app | Bengaluru, India
Fresher (0 years) Product Marketing Manager & Associate Product Manager
• Drove ~425% organic search growth at Smatr AI using SEO and Google Search Console.
• Scaled ~1,466% product page view growth at Smatr AI using GA4 and Python EDA.
Skills: GTM Strategy, Product Marketing, SEO, Python EDA, SQL, GA4, TypeScript, Next.js`;

    const res = deterministicParseResumeText(sampleCv, FORK_PROFILE_TEMPLATES.pm_growth);
    expect(res.parsed.email).toBe('shaikkaisifbasha04@gmail.com');
    expect(res.parsed.experience_years).toBe(0);
    expect(res.parsed.target_roles).toContain('Product Marketing Manager');
    expect(res.parsed.skills).toContain('Python EDA');
    expect(res.parsed.key_metrics.some((m) => m.includes('425%'))).toBe(true);
  });

  it('buildPrompt enforces fresher constraints for 0 years experience', () => {
    const job = { title: 'Senior Engineer', description: 'Requires 5 years of experience.' };
    const prompt = buildPrompt(job, validProfile);
    expect(prompt).toContain('Candidate is a FRESHER');
    expect(prompt).toContain('DO NOT score above 48 total if the role explicitly requires 2+ years');
  });

  it('buildPrompt enforces location constraints when relocation is false', () => {
    const job = { title: 'Software Engineer', location: 'Bengaluru' };
    const profileNoRelo = { ...validProfile, open_to_relocation: false, target_cities: ['Hyderabad'] };
    const prompt = buildPrompt(job, profileNoRelo);
    expect(prompt).toContain('MUST be located in Hyderabad');
  });

  it('prevents role stop-word inflation, zero-skill phantom inflation, salary floor violation, and seniority overshoot in deterministic scoring', async () => {
    const { deterministicEvaluateJob } = await import('../lib/llm');
    const { deriveJobPillarBreakdown } = await import('../lib/utils');

    const pmmProfile = {
      ...validProfile,
      target_roles: ['Product Marketing Manager'],
      skills: ['Python EDA', 'SEO', 'GA4'],
      min_salary_lpa: 12,
      min_salary_usd_annual: 60000,
    };

    // Unrelated "Manager" title with zero matching skills must stay low
    const unrelated = deterministicEvaluateJob(
      {
        title: 'Warehouse Operations Manager',
        company: 'LogisticsCo',
        location: 'Bengaluru',
        description: 'Manage physical warehouse inventory, forklifts, and shift schedules.',
      },
      pmmProfile
    );
    expect(unrelated.subscores.role_match).toBeLessThanOrEqual(12);
    expect(unrelated.subscores.skill_match).toBe(4);
    expect(unrelated.score).toBeLessThanOrEqual(45);

    // Below salary floor penalizes comp_geo_match compared to fair-pay equivalent
    const underpaid = deterministicEvaluateJob(
      {
        title: 'Product Marketing Manager',
        company: 'LowPayCo',
        location: 'Bengaluru',
        salary: '4 LPA',
        description: 'Entry-level Product Marketing Manager with SEO and GA4.',
      },
      pmmProfile
    );
    const fairPaid = deterministicEvaluateJob(
      {
        title: 'Product Marketing Manager',
        company: 'FairPayCo',
        location: 'Bengaluru',
        salary: '14 LPA',
        description: 'Entry-level Product Marketing Manager with SEO and GA4.',
      },
      pmmProfile
    );
    expect(underpaid.subscores.comp_geo_match).toBeLessThan(fairPaid.subscores.comp_geo_match);
    expect(underpaid.subscores.comp_geo_match).toBeLessThanOrEqual(9);

    // 11+ years seniority caps fresher at <= 48
    const leadRole = deterministicEvaluateJob(
      {
        title: 'Product Marketing Manager',
        company: 'EnterpriseCo',
        location: 'Remote',
        description: 'Requires 11+ years of B2B SaaS product marketing, SEO, and GA4 experience.',
      },
      pmmProfile
    );
    expect(leadRole.subscores.seniority_match).toBeLessThanOrEqual(5);
    expect(leadRole.score).toBeLessThanOrEqual(48);

    // Pillar breakdown reconciles cleanly to stored job.score
    for (const s of [35, 48, 75, 96]) {
      const b = deriveJobPillarBreakdown({ score: s, reasons: '' });
      expect(b.role.earned + b.skill.earned + b.seniority.earned + b.compGeo.earned).toBe(s);
    }
  });

  it('merges overlapping multi-year work intervals while ignoring education dates in resume parser', () => {
    const experiencedCv = `Alex Rivera
alex@example.com | Bengaluru
Experience:
Senior Product Manager, BetaCorp (2020 - 2024)
Product Manager, AlphaTech (2019 - 2021)
Education:
B.Tech Computer Science, IIT Madras (2014 - 2018)
Skills: SQL, Python, GTM Strategy`;

    const res = deterministicParseResumeText(experiencedCv, FORK_PROFILE_TEMPLATES.pm_growth);
    // Work span 2019-2024 merged = 5 years; 2014-2018 education must not inflate it
    expect(res.parsed.experience_years).toBe(5);
    expect(res.parsed.experience_level).toBe('Mid-Level (5 yrs)');
  });

  describe('scoreJobWithGemini', () => {
    it('returns a score of 0 when JSON is malformed/hallucinated', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: '```json\n{"score": 90, "match_reasons": []}\n```' }] } }],
        }),
      });

      const res = await scoreJobWithGemini({}, validProfile, 'dummy_key');
      expect(res.score).toBe(0);
    }, 20000);

    it('handles out of bounds scores', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: '{"score": 150}' }] } }],
        }),
      });

      const res = await scoreJobWithGemini({}, validProfile, 'dummy_key');
      expect(res.score).toBe(0);
    });
  });

  describe('Accuracy & End-to-End Hardening Upgrades', () => {
    it('parseLooseJSON extracts valid JSON from markdown fences and prose', async () => {
      const { parseLooseJSON } = await import('../lib/utils');
      const wrapped = 'Sure! Here is the evaluation:\n```json\n{"score": 91, "gap": "None"}\n```\nHope this helps.';
      expect(parseLooseJSON(wrapped)).toEqual({ score: 91, gap: 'None' });
      expect(parseLooseJSON('not valid json')).toBeNull();
    });

    it('extractHighSignalJdContext retains bottom-of-JD experience and compensation lines', async () => {
      const { extractHighSignalJdContext } = await import('../lib/utils');
      const filler = 'We are building next-generation cloud tooling for modern teams. '.repeat(45);
      const tail =
        'Requirements: Requires 6+ years of B2B SaaS leadership. Compensation: $140,000 USD with No Visa Sponsorship.';
      const extracted = extractHighSignalJdContext(`${filler}\n${tail}`, 1200);
      expect(extracted.length).toBeLessThanOrEqual(1200);
      expect(extracted).toContain('6+ years');
      expect(extracted).toContain('$140,000 USD');
    });

    it('deriveJobPillarBreakdown flags isExact accurately based on marker presence', async () => {
      const { deriveJobPillarBreakdown } = await import('../lib/utils');
      const exact = deriveJobPillarBreakdown({
        score: 94,
        reasons: 'Role fit (38/40 Role) | Core stack (28/30 Skill) | Seniority (14/15 Seniority) & Comp (14/15 Comp)',
      });
      expect(exact.isExact).toBe(true);
      expect(exact.role.earned).toBe(38);
      expect(exact.skill.earned).toBe(28);

      const estimated = deriveJobPillarBreakdown({
        score: 88,
        reasons: 'Strong overall growth and analytics fit.',
      });
      expect(estimated.isExact).toBe(false);
      expect(
        estimated.role.earned +
          estimated.skill.earned +
          estimated.seniority.earned +
          estimated.compGeo.earned
      ).toBe(88);
    });

    it('detects embedded compensation in job description when structured salary field is absent', async () => {
      const { deterministicEvaluateJob } = await import('../lib/llm');
      const embeddedUnderpaid = deterministicEvaluateJob(
        {
          title: 'Product Marketing Manager',
          company: 'BootstrapCo',
          location: 'Bengaluru',
          salary: '',
          description:
            'Entry-level Product Marketing Manager with SEO and GA4 skills. Fixed package is 4 LPA.',
        },
        { ...validProfile, target_roles: ['Product Marketing Manager'], min_salary_lpa: 12 }
      );
      expect(embeddedUnderpaid.subscores.comp_geo_match).toBeLessThanOrEqual(9);
    });

    it('parseResumeInput rejects blank/scanned PDFs instead of falling back to current profile', async () => {
      const { parseResumeInput } = await import('../lib/resume-parser');
      const prevKey = process.env.GEMINI_API_KEY;
      delete process.env.GEMINI_API_KEY;
      try {
        await expect(
          parseResumeInput({
            sourceChannel: 'pdf_upload',
            pdfBuffer: Buffer.from('%PDF-1.4\n%blank-image-only\n%%EOF', 'latin1'),
            currentProfile: FORK_PROFILE_TEMPLATES.pm_growth,
          })
        ).rejects.toThrow(/Could not extract selectable text/i);
      } finally {
        if (prevKey !== undefined) process.env.GEMINI_API_KEY = prevKey;
      }
    });

    it('normalizes hourly, monthly, full-INR, EUR, and GBP salaries cleanly in evaluateSalaryFloorSignal', async () => {
      const { evaluateSalaryFloorSignal } = await import('../lib/llm');
      expect(evaluateSalaryFloorSignal('$35/hr', '', 8, 50000)).toBe(2); // 35 * 2080 = 72,800 >= 50k
      expect(evaluateSalaryFloorSignal('$2,000/mo', '', 8, 40000)).toBe(-4); // 24,000 < 40k
      expect(evaluateSalaryFloorSignal('₹90,000/mo', '', 8, 40000)).toBe(2); // 10.8L >= 8L
      expect(evaluateSalaryFloorSignal('£45,000', '', 8, 45000)).toBe(2); // 45k * 1.26 = 56.7k >= 45k
      expect(evaluateSalaryFloorSignal('€25,000', '', 8, 45000)).toBe(-4); // 25k * 1.08 = 27k < 45k
    });

    it('ignores company age phrases in extractRequiredYearsFromText while catching true seniority floors', async () => {
      const { extractRequiredYearsFromText } = await import('../lib/llm');
      expect(
        extractRequiredYearsFromText(
          'Founded 20 years ago with 15 years in business serving developers worldwide. Entry-level applicants welcome.'
        )
      ).toBeNull();
      expect(
        extractRequiredYearsFromText(
          'Founded 20 years ago. Minimum 6+ years of B2B SaaS growth experience required.'
        )
      ).toBe(6);
    });

    it('sanitizes dangerous spreadsheet formula prefixes and normalizes canonical fingerprints', async () => {
      const { sanitizeSheetCell } = await import('../lib/sheets');
      const { normalizeCanonicalFingerprint, detectSource } = await import('../lib/utils');

      expect(sanitizeSheetCell('=CMD|"/C calc"!A0')).toMatch(/^'=CMD/);
      expect(sanitizeSheetCell('+SUM(A1:A2)')).toMatch(/^'\+SUM/);
      expect(sanitizeSheetCell('-1+1')).toMatch(/^'-1/);
      expect(sanitizeSheetCell('@IMPORTXML')).toMatch(/^'@IMPORTXML/);
      expect(sanitizeSheetCell('\tHYPERLINK')).toMatch(/^'HYPERLINK/);
      expect(sanitizeSheetCell('\t=HYPERLINK')).toMatch(/^'=HYPERLINK/);

      expect(
        normalizeCanonicalFingerprint('Stripe, Inc.', 'Associate Product Marketing Manager')
      ).toBe(normalizeCanonicalFingerprint('Stripe', 'Associate Product Marketing Manager'));
      expect(detectSource('himalayas_99123')).toBe('Himalayas');
    });

    it('deterministicEvaluateJob always emits exact 4-pillar markers parsed by deriveJobPillarBreakdown', async () => {
      const { deterministicEvaluateJob } = await import('../lib/llm');
      const { deriveJobPillarBreakdown } = await import('../lib/utils');

      const ev = deterministicEvaluateJob(
        {
          title: 'Associate Product Manager',
          company: 'Sarvam AI',
          location: 'Bengaluru',
          salary: '14 LPA',
          description: 'Associate Product Manager using Python EDA, SEO, and GA4.',
        },
        validProfile
      );
      const breakdown = deriveJobPillarBreakdown({
        score: ev.score,
        reasons: ev.match_reasons.join(' | '),
      });
      expect(breakdown.isExact).toBe(true);
      expect(
        breakdown.role.earned +
          breakdown.skill.earned +
          breakdown.seniority.earned +
          breakdown.compGeo.earned
      ).toBe(ev.score);
    });

    it('detects matching track presets structurally and returns null for custom CVs', async () => {
      const { detectMatchingPresetKey } = await import('../lib/profile-presets');

      expect(detectMatchingPresetKey(FORK_PROFILE_TEMPLATES.pm_growth)).toBe('pm_growth');
      expect(detectMatchingPresetKey(FORK_PROFILE_TEMPLATES.swe_ai)).toBe('swe_ai');
      expect(detectMatchingPresetKey(FORK_PROFILE_TEMPLATES.data_ml)).toBe('data_ml');
      expect(
        detectMatchingPresetKey({
          name: 'Custom Candidate',
          target_roles: ['Embedded Firmware Engineer', 'FPGA Architect'],
        })
      ).toBeNull();
    });

    it('keeps SOURCE_FILTER_OPTIONS synchronized with detectSource prefixes', async () => {
      const { SOURCE_FILTER_OPTIONS, detectSource } = await import('../lib/utils');

      const sampleIds = [
        'career_postman_1',
        'greenhouse_stripe_1',
        'lever_zepto_1',
        'ashby_linear_1',
        'workable_raycast_1',
        'smartrecruiters_visa_1',
        'recruitee_framer_1',
        'freehire_123',
        'himalayas_99123',
        'internshala_55',
        'remoteok_42',
        'remotive_11',
        'arbeitnow_slug',
        'themuse_77',
        'eval_12345',
        'jsearch_abc',
      ];
      for (const sampleId of sampleIds) {
        expect(SOURCE_FILTER_OPTIONS).toContain(detectSource(sampleId));
      }
    });

    it('scoreJobWithOpenRouter cascades across all 3 :free models on upstream failure', async () => {
      const { scoreJobWithOpenRouter } = await import('../scripts/scout.js');
      const modelsAttempted = [];

      global.fetch = vi.fn().mockImplementation(async (_url, init) => {
        const parsedBody = JSON.parse(init.body);
        modelsAttempted.push(parsedBody.model);
        if (modelsAttempted.length < 3) {
          return { ok: false, status: 429 };
        }
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { content: '```json\n{"score": 89, "gap": "Minor"}\n```' } }],
          }),
        };
      });

      const res = await scoreJobWithOpenRouter(
        { title: 'Associate Product Manager', company: { display_name: 'Linear' } },
        validProfile,
        'or-test-key'
      );

      expect(modelsAttempted).toEqual([
        'meta-llama/llama-3.3-70b-instruct:free',
        'google/gemma-3-27b-it:free',
        'openrouter/free',
      ]);
      expect(res.score).toBe(89);
    });

    it('blocks SSRF metadata/private IPs and unsafe schemes while allowing public HTTPS URLs', async () => {
      const { validateSafePublicUrl } = await import('../lib/utils');

      expect(validateSafePublicUrl('http://169.254.169.254/latest/meta-data').ok).toBe(false);
      expect(validateSafePublicUrl('http://metadata.google.internal/computeMetadata/v1').ok).toBe(false);
      expect(validateSafePublicUrl('http://10.0.0.5:8080/jobs').ok).toBe(false);
      expect(validateSafePublicUrl('http://192.168.1.10/jobs').ok).toBe(false);
      expect(validateSafePublicUrl('file:///etc/passwd').ok).toBe(false);
      expect(validateSafePublicUrl('https://jobs.example.com/api/v1/jobs').ok).toBe(true);
    });

    it('neutralizes CSV formula injection prefixes cleanly', async () => {
      const { sanitizeCsvCell } = await import('../lib/utils');

      expect(sanitizeCsvCell('=CMD()')).toBe('"\'=CMD()"');
      expect(sanitizeCsvCell('+1+1')).toBe('"\'+1+1"');
      expect(sanitizeCsvCell('-2*3')).toBe('"\'-2*3"');
      expect(sanitizeCsvCell('@SUM(A1)')).toBe('"\'@SUM(A1)"');
      expect(sanitizeCsvCell('\tHYPERLINK("x")')).toBe('"\'\tHYPERLINK(""x"")"');
      expect(sanitizeCsvCell('Acme "Growth" Corp')).toBe('"Acme ""Growth"" Corp"');
    });

    it('parses YYYY-MM-DD consistently at local noon to preserve calendar day ordering', async () => {
      const { parseIsoDateTimestamp } = await import('../lib/utils');

      const d1 = parseIsoDateTimestamp('2026-11-15');
      const d2 = parseIsoDateTimestamp('2026-11-16');
      expect(Number.isFinite(d1)).toBe(true);
      expect(Number.isFinite(d2)).toBe(true);
      expect(d2).toBeGreaterThan(d1);
      expect(d2 - d1).toBe(24 * 60 * 60 * 1000);
      expect(Number.isNaN(parseIsoDateTimestamp(''))).toBe(true);
    });

    it('ignores VC funding and SaaS pricing figures while catching real salary compensation in JDs', async () => {
      const { evaluateSalaryFloorSignal } = await import('../lib/llm');

      expect(
        evaluateSalaryFloorSignal(
          '',
          'Recently raised $50M Series B funding backed by top investors. Seeking Associate Product Manager.',
          8,
          50000
        )
      ).toBe(0);

      expect(
        evaluateSalaryFloorSignal(
          '',
          'Serving 100,000+ users at $12M ARR with a Pro pricing plan at $20/mo subscription tier.',
          8,
          50000
        )
      ).toBe(0);

      expect(
        evaluateSalaryFloorSignal('', 'Total cash compensation: $140,000 USD base + equity.', 8, 50000)
      ).toBe(2);
    });

    it('enforces bounded sliding/fixed-window rate limiting and computes positive Retry-After', async () => {
      const { checkRateLimit } = await import('../lib/rate-limit');
      const uniqueBucket = `test-bucket-${Date.now()}-${Math.random()}`;

      const first = checkRateLimit(uniqueBucket, 2, 60000);
      const second = checkRateLimit(uniqueBucket, 2, 60000);
      const blocked = checkRateLimit(uniqueBucket, 2, 60000);

      expect(first.allowed).toBe(true);
      expect(first.remaining).toBe(1);
      expect(second.allowed).toBe(true);
      expect(second.remaining).toBe(0);
      expect(blocked.allowed).toBe(false);
      expect(blocked.remaining).toBe(0);
      expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
    });

    it('persists and reads runtime JSON overlay cleanly via KAISIFOS_DATA_DIR', async () => {
      const fs = await import('fs');
      const os = await import('os');
      const path = await import('path');
      const { writeRuntimeJsonFile, readRuntimeJsonFile } = await import('../lib/sheets');

      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kaisifos-runtime-'));
      const prevDir = process.env.KAISIFOS_DATA_DIR;
      process.env.KAISIFOS_DATA_DIR = tmpDir;

      try {
        const writeRes = writeRuntimeJsonFile('test-overlay.json', { status: 'ok', count: 42 });
        expect(writeRes.ok).toBe(true);
        const readBack = readRuntimeJsonFile('test-overlay.json', null);
        expect(readBack).toEqual({ status: 'ok', count: 42 });
      } finally {
        if (prevDir === undefined) delete process.env.KAISIFOS_DATA_DIR;
        else process.env.KAISIFOS_DATA_DIR = prevDir;
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('trips Gemini circuit breaker after repeated 503s so subsequent jobs skip Gemini immediately', async () => {
      const { scoreJob, resetProviderBreakers } = await import('../scripts/scout.js');
      resetProviderBreakers();
      const prevGem = process.env.GEMINI_API_KEY;
      const prevOr = process.env.OPENROUTER_API_KEY;
      process.env.GEMINI_API_KEY = 'dummy-gemini-key';
      delete process.env.OPENROUTER_API_KEY;

      let geminiCalls = 0;
      const prevFetch = global.fetch;
      global.fetch = vi.fn().mockImplementation(async (url) => {
        if (String(url).includes('generativelanguage.googleapis.com')) {
          geminiCalls += 1;
          return {
            ok: false,
            status: 503,
            text: async () => '{"error":{"code":503,"status":"UNAVAILABLE"}}',
          };
        }
        return { ok: false, status: 500, text: async () => '' };
      });

      const mockGroq = {
        chat: {
          completions: {
            create: vi.fn().mockResolvedValue({
              choices: [{ message: { content: JSON.stringify({ score: 87, gap: 'None' }) } }],
            }),
          },
        },
      };

      const sampleJob = {
        id: 'test_cb_1',
        title: 'Associate Product Manager',
        company: { display_name: 'Linear' },
        location: 'Remote',
        description: 'Entry level APM with Python EDA and SEO skills.',
      };

      try {
        // Call 1 (2 attempts -> fails 503, falls back to Groq -> 87)
        const r1 = await scoreJob(sampleJob, validProfile, mockGroq);
        // Call 2 (2 attempts -> fails 503, trips breaker, falls back to Groq -> 87)
        const r2 = await scoreJob(sampleJob, validProfile, mockGroq);
        const callsAfterTrip = geminiCalls;
        // Call 3 must bypass Gemini in 0ms and go straight to Groq
        const r3 = await scoreJob(sampleJob, validProfile, mockGroq);

        expect(r1.score).toBe(87);
        expect(r2.score).toBe(87);
        expect(r3.score).toBe(87);
        expect(callsAfterTrip).toBe(4);
        expect(geminiCalls).toBe(4); // Zero extra calls on Call 3 because circuit is open
      } finally {
        resetProviderBreakers();
        global.fetch = prevFetch;
        if (prevGem === undefined) delete process.env.GEMINI_API_KEY;
        else process.env.GEMINI_API_KEY = prevGem;
        if (prevOr === undefined) delete process.env.OPENROUTER_API_KEY;
        else process.env.OPENROUTER_API_KEY = prevOr;
      }
    }, 15000);

    it('retries JSearch once on transient error and strips HTML from descriptions', async () => {
      const { fetchJSearchJobs } = await import('../scripts/scout.js');
      const prevRapid = process.env.RAPIDAPI_KEY;
      process.env.RAPIDAPI_KEY = 'dummy-rapidapi-key';

      let attempts = 0;
      const prevFetch = global.fetch;
      global.fetch = vi.fn().mockImplementation(async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error('The operation was aborted due to timeout');
        }
        return {
          ok: true,
          json: async () => ({
            data: [
              {
                job_id: 'js1',
                job_title: 'Associate Product Manager',
                employer_name: 'Acme AI',
                job_description: '<p>Entry-level <b>APM</b> with visa sponsorship.</p>',
                job_apply_link: 'https://example.com/apply',
                job_city: 'Bengaluru',
                job_country: 'IN',
              },
            ],
          }),
        };
      });

      try {
        const jobs = await fetchJSearchJobs(validProfile);
        expect(attempts).toBe(2);
        expect(jobs).toHaveLength(1);
        expect(jobs[0].description).toBe('Entry-level APM with visa sponsorship.');
        expect(jobs[0].has_relocation).toBe(true);
      } finally {
        global.fetch = prevFetch;
        if (prevRapid === undefined) delete process.env.RAPIDAPI_KEY;
        else process.env.RAPIDAPI_KEY = prevRapid;
      }
    }, 10000);

    it('lib/llm.ts tracks provider circuit breakers and skips cooled-down OpenRouter failures', async () => {
      const { generateStructuredJSONWithLLM, resetLlmCircuitBreakers } = await import('../lib/llm');
      resetLlmCircuitBreakers();

      const prevGem = process.env.GEMINI_API_KEY;
      const prevGroq = process.env.GROQ_API_KEY;
      const prevOr = process.env.OPENROUTER_API_KEY;
      delete process.env.GEMINI_API_KEY;
      delete process.env.GROQ_API_KEY;
      process.env.OPENROUTER_API_KEY = 'dummy-or-key';

      let orCalls = 0;
      const prevFetch = global.fetch;
      global.fetch = vi.fn().mockImplementation(async () => {
        orCalls += 1;
        return { ok: false, status: 503 };
      });

      try {
        await generateStructuredJSONWithLLM('prompt 1');
        await generateStructuredJSONWithLLM('prompt 2');
        const callsBeforeCooldown = orCalls;
        await generateStructuredJSONWithLLM('prompt 3');
        expect(callsBeforeCooldown).toBeGreaterThan(0);
        expect(orCalls).toBe(callsBeforeCooldown);
      } finally {
        resetLlmCircuitBreakers();
        global.fetch = prevFetch;
        if (prevGem !== undefined) process.env.GEMINI_API_KEY = prevGem;
        if (prevGroq !== undefined) process.env.GROQ_API_KEY = prevGroq;
        if (prevOr === undefined) delete process.env.OPENROUTER_API_KEY;
        else process.env.OPENROUTER_API_KEY = prevOr;
      }
    }, 15000);

    it('extracts Schema.org JobPosting JSON-LD, embedded ATS boards, and career anchors while blocking SSRF URLs', async () => {
      const {
        extractJsonLdJobPostings,
        detectEmbeddedAtsBoards,
        extractCareerPageAnchors,
        fetchCompanyCareerPages,
      } = await import('../lib/career-scraper');

      const ldHtml = `
        <html><head>
          <script type="application/ld+json">
            {
              "@context": "https://schema.org",
              "@graph": [
                {
                  "@type": "JobPosting",
                  "title": "Associate Product Manager",
                  "hiringOrganization": { "name": "Postman" },
                  "url": "/careers/openings/apm-101",
                  "jobLocation": { "address": { "addressLocality": "Bengaluru", "addressCountry": "IN" } },
                  "baseSalary": { "currency": "INR", "value": { "minValue": 1400000, "maxValue": 1800000 } },
                  "description": "<p>Build API developer workflows with SQL and Python.</p>"
                }
              ]
            }
          </script>
        </head></html>
      `;

      const ldJobs = extractJsonLdJobPostings(ldHtml, 'https://www.postman.com/company/careers/');
      expect(ldJobs).toHaveLength(1);
      expect(ldJobs[0].id.startsWith('career_')).toBe(true);
      expect(ldJobs[0].company).toBe('Postman');
      expect(ldJobs[0].url).toBe('https://www.postman.com/careers/openings/apm-101');
      expect(ldJobs[0].location).toBe('Bengaluru, IN');
      expect(ldJobs[0].salary).toBe('INR 1400000 - 1800000');

      const embeddedHtml = `
        <iframe src="https://boards.greenhouse.io/embed/job_board?for=acme"></iframe>
        <a href="https://jobs.lever.co/zepto/123">Lever</a>
        <a href="https://jobs.ashbyhq.com/linear/456">Ashby</a>
        <a href="https://apply.workable.com/raycast/">Workable</a>
        <a href="https://jobs.smartrecruiters.com/Visa/789">SR</a>
        <a href="https://framer.recruitee.com/o/pm">Recruitee</a>
      `;
      const embedded = detectEmbeddedAtsBoards(embeddedHtml);
      expect(embedded.lever).toContain('zepto');
      expect(embedded.ashby).toContain('linear');
      expect(embedded.workable).toContain('raycast');
      expect(embedded.smartrecruiters).toContain('Visa');
      expect(embedded.recruitee).toContain('framer');

      const anchorHtml = `
        <nav><a href="/about">About Us</a><a href="/privacy">Privacy</a></nav>
        <a href="/careers/growth-product-manager">Growth Product Manager</a>
        <a href="/jobs/ai-systems-engineer">AI Systems Engineer</a>
      `;
      const anchors = extractCareerPageAnchors(anchorHtml, 'https://linear.app/careers', 'Linear');
      expect(anchors.map((a) => a.title)).toEqual([
        'Growth Product Manager',
        'AI Systems Engineer',
      ]);
      expect(anchors[0].url).toBe('https://linear.app/careers/growth-product-manager');

      const prevFetch = global.fetch;
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: async () => ldHtml,
      });
      try {
        const res = await fetchCompanyCareerPages([
          'http://169.254.169.254/latest/meta-data',
          'https://www.postman.com/company/careers/',
        ]);
        expect(res.jobs.length).toBe(1);
        expect(res.failedBoards.some((f) => f.includes('169.254.169.254'))).toBe(true);
      } finally {
        global.fetch = prevFetch;
      }
    });

    it('decodes Greenhouse HTML entities before stripping tags and preserves bottom-of-JD visa clauses', async () => {
      const { decodeAndStripHtml } = await import('../lib/eligibility.js');
      const { extractHighSignalJdContext } = await import('../lib/utils');

      const entityHtml =
        '&lt;p&gt;Associate Product Manager in &lt;strong&gt;Hyderabad&lt;/strong&gt;.&lt;/p&gt; &lt;script&gt;alert(1)&lt;/script&gt; ';
      expect(decodeAndStripHtml(entityHtml)).toBe('Associate Product Manager in Hyderabad.');

      const longFiller = 'Collaborate across engineering and design squads to iterate rapidly. '.repeat(65);
      const bottomClause =
        'We strongly prefer candidates who do not require current or future employer sponsorship or participation (including STEM OPT) to maintain US work authorization.';
      const excerpt = extractHighSignalJdContext(`${longFiller}\n${bottomClause}`, 3500);
      expect(excerpt).toContain('STEM OPT');
      expect(excerpt).toContain('sponsorship');
    });

    it('strictly blocks fake-remote NYC/Seattle/SF metro roles and bottom-of-JD STEM OPT / US-auth requirements', async () => {
      const { evaluateHardEligibility } = await import('../lib/eligibility.js');
      const { deterministicEvaluateJob } = await import('../lib/llm');

      const strictHydProfile = {
        ...validProfile,
        target_cities: ['Hyderabad'],
        open_to_relocation: false,
        experience_years: 0,
        experience_level: 'Fresher (0 yrs)',
      };

      const filler = 'Lead product launches, experimentation, and growth funnels using SEO, GA4, and Python EDA. '.repeat(45);

      // Case 1: Remote claiming NYC / Seattle / SF Bay Area preference + quarterly travel
      const fakeRemoteMetroJob = {
        title: 'Associate Product Manager',
        company: 'MetroBiasAI',
        location: 'Remote',
        salary: '$120,000',
        description: `${filler} This role is fully remote, and we have a strong preference for candidates based in the New York City, Seattle, or San Francisco Bay Area metros. Much of the team you'll work with most closely is concentrated in those areas, and we'll prioritize applicants who live there. You should also be able to travel for in-person collaboration roughly once per quarter.`,
      };
      const metroElig = evaluateHardEligibility(fakeRemoteMetroJob, strictHydProfile);
      expect(metroElig.eligible).toBe(false);
      expect(metroElig.flags.geoBlocked).toBe(true);

      const metroEval = deterministicEvaluateJob(fakeRemoteMetroJob, strictHydProfile);
      expect(metroEval.subscores.comp_geo_match).toBeLessThanOrEqual(2);
      expect(metroEval.score).toBeLessThanOrEqual(32);

      const metroScoutEval = scoreJobDeterministic(
        { ...fakeRemoteMetroJob, company: { display_name: 'MetroBiasAI' } },
        strictHydProfile
      );
      expect(metroScoutEval.score).toBeLessThanOrEqual(32);

      // Case 2: Late-JD STEM OPT / no US sponsorship clause past char 3000
      const stemOptJob = {
        title: 'Product Marketing Manager',
        company: 'USAuthCorp',
        location: 'Remote',
        salary: '$110,000',
        description: `${filler} We strongly prefer candidates who do not require current or future employer sponsorship or participation (including STEM OPT) to maintain US work authorization.`,
      };
      const authElig = evaluateHardEligibility(stemOptJob, strictHydProfile);
      expect(authElig.eligible).toBe(false);
      expect(authElig.flags.workAuthBlocked).toBe(true);

      const authEval = deterministicEvaluateJob(stemOptJob, strictHydProfile);
      expect(authEval.subscores.comp_geo_match).toBeLessThanOrEqual(2);
      expect(authEval.score).toBeLessThanOrEqual(32);

      const authScoutEval = scoreJobDeterministic(
        { ...stemOptJob, company: { display_name: 'USAuthCorp' } },
        strictHydProfile
      );
      expect(authScoutEval.score).toBeLessThanOrEqual(32);

      // Case 3: Physical Bengaluru role & 3+ yr role blocked for strict Hyderabad + Fresher
      const blrJob = {
        title: 'Associate Product Manager',
        company: 'BLRCo',
        location: 'Bengaluru, India',
        description: 'Associate Product Manager working on SEO, GA4, and Python EDA.',
      };
      expect(evaluateHardEligibility(blrJob, strictHydProfile).eligible).toBe(false);
      expect(deterministicEvaluateJob(blrJob, strictHydProfile).score).toBeLessThanOrEqual(32);

      const twoYrRole = {
        title: 'Associate Product Manager',
        company: 'HydCorp',
        location: 'Hyderabad, India',
        description: 'Requires at least 2+ years of product management experience.',
      };
      expect(evaluateHardEligibility(twoYrRole, strictHydProfile).flags.seniorityBlocked).toBe(true);
      expect(deterministicEvaluateJob(twoYrRole, strictHydProfile).score).toBeLessThanOrEqual(32);

      // Case 4: Genuine Hyderabad Fresher role & true India/Worldwide Remote role score cleanly >= 85
      const validHydJob = {
        title: 'Associate Product Manager',
        company: 'HyderabadTech',
        location: 'Hyderabad, Telangana',
        salary: '12 LPA',
        description: 'Entry-level Associate Product Manager in Hyderabad. Skills: Python EDA, SEO, GA4, Product Marketing.',
      };
      expect(evaluateHardEligibility(validHydJob, strictHydProfile).eligible).toBe(true);
      expect(deterministicEvaluateJob(validHydJob, strictHydProfile).score).toBeGreaterThanOrEqual(85);

      const validGlobalRemoteJob = {
        title: 'Growth Marketing Analyst',
        company: 'AsyncGlobal',
        location: 'Remote / Worldwide',
        salary: '$65,000',
        description: 'Work from anywhere in the world (India remote welcome). Entry-level 0-1 years role using Python EDA, SEO, and GA4.',
      };
      expect(evaluateHardEligibility(validGlobalRemoteJob, strictHydProfile).eligible).toBe(true);
      expect(deterministicEvaluateJob(validGlobalRemoteJob, strictHydProfile).score).toBeGreaterThanOrEqual(85);
    });

    it('canonicalizes cross-source duplicates and enforces strict positive geo allowlist against US/German leaks', async () => {
      const { buildCanonicalJobKey, getSourceUrlPriority, evaluateHardEligibility } = await import(
        '../lib/eligibility.js'
      );

      // Same role scraped from Greenhouse vs JSearch vs Career Page produces identical canonical key
      const k1 = buildCanonicalJobKey(
        'Razorpay Software Pvt. Ltd.',
        'Associate Product Manager (Entry Level) - Remote',
        'Hyderabad, Telangana'
      );
      const k2 = buildCanonicalJobKey(
        'Razorpay',
        'APM',
        'Hyderabad, India'
      );
      expect(k1).toBe(k2);

      // Different country bucket produces distinct key
      const kUs = buildCanonicalJobKey('Cheez', 'Associate Product Manager', 'Largo, US');
      const kHyd = buildCanonicalJobKey('Cheez', 'Associate Product Manager', 'Hyderabad, India');
      expect(kUs).not.toBe(kHyd);

      // Direct Career Page / ATS outranks JSearch aggregator
      expect(getSourceUrlPriority('https://boards.greenhouse.io/razorpay/jobs/1')).toBeGreaterThan(
        getSourceUrlPriority('jsearch_123')
      );

      const strictHydProfile = {
        ...validProfile,
        target_cities: ['Hyderabad'],
        open_to_relocation: false,
        experience_years: 0,
        experience_level: 'Fresher (0 yrs)',
      };

      // Real-world leaked roles from user log must be hard-blocked
      const leakedRoles = [
        {
          title: 'Associate Product Manager @ Social app startup',
          company: 'Cheez',
          location: 'Largo, US',
          description: 'Social app startup looking for an Associate Product Manager.',
        },
        {
          title: 'Associate Product Manager',
          company: 'Volexity',
          location: 'Silver Spring, US',
          description: 'Associate Product Manager role in Silver Spring, Maryland. Global offices include Hyderabad.',
        },
        {
          title: 'Associate Product Manager at ATCC in Gaithersburg, Maryland',
          company: 'disABLEDperson Inc',
          location: 'Manassas Park, US',
          description: 'Entry level APM role.',
        },
        {
          title: 'Digital Marketing Associate',
          company: 'AV',
          location: 'Arlington, US',
          description: 'Digital Marketing Associate.',
        },
        {
          title: 'Werkstudent:in Marketing',
          company: 'Tokura GmbH',
          location: 'Berlin',
          description: 'Working student marketing role in Berlin.',
        },
      ];

      for (const badJob of leakedRoles) {
        const res = evaluateHardEligibility(badJob, strictHydProfile);
        expect(res.eligible).toBe(false);
        expect(res.flags.geoBlocked).toBe(true);
      }
    });

    it('classifies deterministic fallback engine_used properly and updates local rows by canonicalKey', async () => {
      const fs = await import('fs');
      const os = await import('os');
      const path = await import('path');
      const { deterministicEvaluateJob } = await import('../lib/llm');
      const {
        appendLocalJobRecordDetailed,
        updateLocalJobRow,
        batchUpdateLocalJobRows,
        readLocalJobRecords,
      } = await import('../lib/sheets');

      const detEval = deterministicEvaluateJob(
        {
          title: 'Associate Product Manager',
          company: 'HyderaTech',
          location: 'Hyderabad',
          salary: '12 LPA',
          description: 'Entry-level APM role with SEO and Python EDA.',
        },
        validProfile
      );
      expect(detEval.engine_used.toLowerCase()).toContain('deterministic');

      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kaisifos-retry-'));
      const prevDir = process.env.KAISIFOS_DATA_DIR;
      process.env.KAISIFOS_DATA_DIR = tmpDir;

      try {
        const cKey = 'hydratech::associate product manager::india-hyderabad';
        const writeRes = appendLocalJobRecordDetailed({
          date: '2026-11-17',
          id: 'greenhouse_hydratech_1',
          canonicalKey: cKey,
          title: 'Associate Product Manager',
          company: 'HyderaTech',
          location: 'Hyderabad',
          score: 76,
          reasons: 'Matched core role',
          gap: 'None',
          url: 'https://boards.greenhouse.io/hydratech/jobs/1',
          dm: 'Hi team',
          resumeAngle: 'PM execution',
          status: 'NEW',
          evaluationStatus: 'DETERMINISTIC_ONLY',
          needsLlmRetry: true,
        });
        expect(writeRes.ok).toBe(true);

        // Update via canonicalKey only (no id or rowId)
        const patchOk = updateLocalJobRow(
          { canonicalKey: cKey },
          {
            score: 92,
            status: 'SHORTLISTED',
            evaluationStatus: 'LLM_SCORED',
            needsLlmRetry: false,
            emailDraft: 'Subject: Application for APM',
          }
        );
        expect(patchOk).toBe(true);

        const afterPatch = readLocalJobRecords();
        expect(afterPatch).toHaveLength(1);
        expect(afterPatch[0].score).toBe(92);
        expect(afterPatch[0].status).toBe('SHORTLISTED');
        expect(afterPatch[0].evaluationStatus).toBe('LLM_SCORED');
        expect(afterPatch[0].needsLlmRetry).toBe(false);
        expect(afterPatch[0].emailDraft).toBe('Subject: Application for APM');

        // Batch update via canonicalKey
        const batchCount = batchUpdateLocalJobRows([{ canonicalKey: cKey }], 'APPLIED');
        expect(batchCount).toBe(1);
        expect(readLocalJobRecords()[0].status).toBe('APPLIED');
      } finally {
        if (prevDir === undefined) delete process.env.KAISIFOS_DATA_DIR;
        else process.env.KAISIFOS_DATA_DIR = prevDir;
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('exports consistent computeProfileVersionHash and Neon DB module surface', async () => {
      const neon = await import('../lib/neon-db.js');
      const hashA = neon.computeProfileVersionHash(FORK_PROFILE_TEMPLATES.pm_growth);
      const hashB = neon.computeProfileVersionHash({
        ...FORK_PROFILE_TEMPLATES.pm_growth,
        open_to_relocation: !FORK_PROFILE_TEMPLATES.pm_growth.open_to_relocation,
      });
      expect(hashA).toMatch(/^v_[0-9a-f]+$/);
      expect(hashA).not.toBe(hashB);
      expect(typeof neon.getNeonPipelineJobs).toBe('function');
      expect(typeof neon.upsertNeonCanonicalJob).toBe('function');
      expect(typeof neon.recordNeonScoutRun).toBe('function');
    });
  });
});





