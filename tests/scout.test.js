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
    expect(prompt).toContain('DO NOT score above 50 if the role explicitly requires 2+ years');
  });

  it('buildPrompt enforces location constraints when relocation is false', () => {
    const job = { title: 'Software Engineer', location: 'Bengaluru' };
    const profileNoRelo = { ...validProfile, open_to_relocation: false, target_cities: ['Hyderabad'] };
    const prompt = buildPrompt(job, profileNoRelo);
    expect(prompt).toContain('MUST be located in Hyderabad');
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
});
