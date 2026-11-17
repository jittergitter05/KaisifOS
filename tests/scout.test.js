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
        'greenhouse_stripe_1',
        'lever_zepto_1',
        'ashby_linear_1',
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
  });
});



