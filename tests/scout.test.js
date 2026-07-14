import { describe, it, expect, vi } from 'vitest';
import { buildPrompt, stripHtmlTags, scoreJobWithGemini, scoreJobWithGroq } from '../scripts/scout.js';

describe('Scout logic tests', () => {
  it('strips HTML tags correctly', () => {
    const raw = '<p>Hello <b>world</b></p>';
    expect(stripHtmlTags(raw)).toBe('Hello world');
  });

  const validProfile = {
    name: 'Test',
    target_roles: ['Dev'],
    target_cities: ['NY'],
    experience_level: 'Fresher',
    experience_years: 0,
    open_to_relocation: true,
    relocation_preference: { preferred_regions: ['Remote'] },
    key_metrics: [],
    skills: [],
    min_salary_lpa: 5,
  };

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
          candidates: [{ content: { parts: [{ text: '```json\n{"score": 90, "match_reasons": []}\n```' }] } }]
        })
      });

      const res = await scoreJobWithGemini({}, validProfile, 'dummy_key');
      expect(res.score).toBe(0);
    }, 20000);

    it('handles out of bounds scores', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: '{"score": 150}' }] } }]
        })
      });

      const res = await scoreJobWithGemini({}, validProfile, 'dummy_key');
      expect(res.score).toBe(0); // script rejects > 100
    });
  });
});
