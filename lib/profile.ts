import fs from 'fs';
import path from 'path';
import { siteConfig } from '../config/site';
import {
  CandidateProfile,
  DEFAULT_ATS_COMPANIES,
  FORK_PROFILE_TEMPLATES,
} from './profile-presets';

export * from './profile-presets';

export function getCandidateProfile(): CandidateProfile {
  try {
    const profilePath = path.join(process.cwd(), 'data', 'profile.json');
    const raw = fs.readFileSync(profilePath, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      ...parsed,
      system_name:
        parsed.system_name && parsed.system_name !== 'CareerOS' && parsed.system_name !== 'OpenScout'
          ? parsed.system_name
          : siteConfig.name,
      ats_companies: parsed.ats_companies || DEFAULT_ATS_COMPANIES,
    };
  } catch {
    return FORK_PROFILE_TEMPLATES.pm_growth;
  }
}
