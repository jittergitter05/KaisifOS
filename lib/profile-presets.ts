import { siteConfig } from '../config/site';

export interface WorkdayBoardTarget {
  tenant: string;
  site: string;
  host?: string;
  company?: string;
}

export function parseWorkdayBoardTarget(raw: unknown): WorkdayBoardTarget | null {
  if (!raw) return null;
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    const tenant = String(obj.tenant || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
    const site = String(obj.site || '').trim().replace(/[^a-zA-Z0-9_-]/g, '');
    const hostRaw = String(obj.host || 'wd5').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    const host = /^wd\d+$/.test(hostRaw) ? hostRaw : 'wd5';
    const company = String(obj.company || '').trim().slice(0, 80);
    if (!tenant || !site) return null;
    return {
      tenant,
      site,
      host,
      company: company || tenant.charAt(0).toUpperCase() + tenant.slice(1),
    };
  }

  const str = String(raw).trim();
  if (!str) return null;

  // Support Workday career URL: https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite
  const wdUrlMatch = str.match(
    /^https?:\/\/([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?([a-zA-Z0-9_-]+)/i
  );
  if (wdUrlMatch) {
    const tenant = wdUrlMatch[1].toLowerCase();
    const host = wdUrlMatch[2].toLowerCase();
    const site = wdUrlMatch[3];
    return {
      tenant,
      site,
      host,
      company: tenant.charAt(0).toUpperCase() + tenant.slice(1),
    };
  }

  if (/^https?:\/\//i.test(str) || str.includes('://')) {
    return null;
  }

  // Support pipe/slash syntax: "tenant|wdHost|site|Company" or "tenant/wdHost/site"
  const parts = str.split(/[|/]+/).map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const tenant = parts[0].toLowerCase().replace(/[^a-z0-9-]/g, '');
    const secondIsHost = /^wd\d+$/i.test(parts[1]);
    const host = secondIsHost ? parts[1].toLowerCase() : 'wd5';
    const site = (secondIsHost ? parts[2] : parts[1])?.replace(/[^a-zA-Z0-9_-]/g, '') || '';
    const company = (secondIsHost ? parts[3] : parts[2])?.slice(0, 80);
    if (!tenant || !site) return null;
    return {
      tenant,
      site,
      host,
      company: company || tenant.charAt(0).toUpperCase() + tenant.slice(1),
    };
  }

  return null;
}

export function formatWorkdayBoardTarget(item: string | WorkdayBoardTarget): string {
  const parsed = parseWorkdayBoardTarget(item);
  if (!parsed) return typeof item === 'string' ? item : '';
  return `${parsed.tenant}|${parsed.host || 'wd5'}|${parsed.site}${parsed.company ? `|${parsed.company}` : ''}`;
}

export interface AtsCompanyTargets {
  greenhouse: string[];
  lever: string[];
  ashby: string[];
  workable?: string[];
  smartrecruiters?: string[];
  recruitee?: string[];
  workday?: Array<string | WorkdayBoardTarget>;
}

export interface CandidateProfile {
  system_name?: string;
  name: string;
  email: string;
  target_roles: string[];
  target_cities: string[];
  open_to_relocation: boolean;
  enable_internshala?: boolean;
  relocation_preference: {
    willing: boolean;
    requirements: string[];
    preferred_regions: string[];
    avoid: string[];
  };
  min_salary_lpa: number;
  min_salary_usd_annual: number;
  experience_years: number;
  experience_level: string;
  portfolio: string;
  key_metrics: string[];
  skills: string[];
  languages: string[];
  resume_synthesizer_url: string;
  ats_companies?: AtsCompanyTargets;
  career_urls?: string[];
}

export const DEFAULT_CAREER_URLS: string[] = [
  'https://www.postman.com/company/careers/',
  'https://razorpay.com/jobs/',
  'https://www.darwinbox.com/careers',
  'https://www.keka.com/careers',
  'https://careers.swiggy.com/',
  'https://linear.app/careers',
  'https://posthog.com/careers',
];

export const DEFAULT_ATS_COMPANIES: AtsCompanyTargets = {
  greenhouse: [
    'razorpay',
    'postman',
    'browserstack',
    'chargebee',
    'phonepe',
    'groww',
    'stripe',
    'vercel',
    'cloudflare',
    'rubrik',
  ],
  lever: ['zepto', 'cred', 'meesho', 'keka', 'mistral'],
  ashby: ['linear', 'posthog', 'supabase', 'langchain'],
  workable: ['raycast'],
  smartrecruiters: ['Visa', 'PublicisSapient', 'BoschGroup'],
  recruitee: ['framer'],
  workday: [
    { tenant: 'salesforce', site: 'External_Career_Site', host: 'wd12', company: 'Salesforce' },
    { tenant: 'servicenow', site: 'Careers', host: 'wd1', company: 'ServiceNow' },
    { tenant: 'nvidia', site: 'NVIDIAExternalCareerSite', host: 'wd5', company: 'NVIDIA' },
    { tenant: 'adobe', site: 'external_experienced', host: 'wd5', company: 'Adobe' },
  ],
};

export interface ProfilePresetMetadata {
  key: 'pm_growth' | 'swe_ai' | 'data_ml' | 'blank_fork';
  label: string;
  desc: string;
}

export const PROFILE_PRESET_METADATA: ProfilePresetMetadata[] = [
  {
    key: 'pm_growth',
    label: 'Product & Growth',
    desc: 'APM, PMM & Growth · Hyderabad / Fresher-Only',
  },
  {
    key: 'swe_ai',
    label: 'Full-Stack & AI SWE',
    desc: 'Software & AI Engineer · Remote / SF / London',
  },
  {
    key: 'data_ml',
    label: 'Data Science & ML',
    desc: 'Data Scientist & ML · Python, SQL, PyTorch',
  },
  {
    key: 'blank_fork',
    label: 'Clean White-Label',
    desc: 'Neutral baseline ready for resume upload',
  },
];

export const FORK_PROFILE_TEMPLATES: Record<string, CandidateProfile> = {
  pm_growth: {
    system_name: siteConfig.name,
    name: 'Shaik Kaisif Basha',
    email: 'shaikkaisifbasha04@gmail.com',
    target_roles: [
      'Associate Product Manager',
      'Product Marketing Manager',
      'Growth Manager',
      "Founder's Associate",
      'Product Analyst',
      'Digital Content Lead',
      'Growth Marketing Analyst',
      'Marketing Operations Analyst',
    ],
    target_cities: ['Hyderabad'],
    open_to_relocation: false,
    enable_internshala: false,
    relocation_preference: {
      willing: false,
      requirements: [
        'Hyderabad on-site/hybrid OR explicitly India-accessible remote with zero US residency/sponsorship blocks',
        'Fresher / Entry-Level (0–1 years experience)',
        'Minimum ₹8 LPA India or $30k USD equivalent abroad',
      ],
      preferred_regions: ['Hyderabad', 'India Remote'],
      avoid: [
        'unpaid',
        'US-only / NYC / SF / Seattle metro preference',
        'requires US work authorization / no STEM OPT / no sponsorship',
      ],
    },
    min_salary_lpa: 8,
    min_salary_usd_annual: 30000,
    experience_years: 0,
    experience_level: 'Fresher / Entry Level',
    portfolio: 'https://portjitterglitter.vercel.app',
    key_metrics: [
      '~425% organic search growth at Smatr AI',
      '~1,466% product page view growth at Smatr AI',
      'Created digital contact database for 2,000+ alumni',
      'Grew unique monthly traffic to 1,000+ visits',
      'Executed product marketing across Reddit, Discord, Pinterest',
    ],
    skills: [
      'GTM Strategy',
      'Product Marketing',
      'SEO',
      'Growth Marketing',
      'Python EDA',
      'GA4',
      'Google Search Console',
      'Notion',
      'AI Workflow Automation',
      'Cloudflare Workers',
      'Full-Stack Prototyping',
    ],
    languages: ['English (fluent)', 'Telugu (native)', 'Hindi (conversational)'],
    resume_synthesizer_url: 'https://portjitterglitter.vercel.app/resume',
    ats_companies: DEFAULT_ATS_COMPANIES,
    career_urls: DEFAULT_CAREER_URLS,
  },
  swe_ai: {
    system_name: siteConfig.name,
    name: 'Alex Rivera',
    email: 'alex.rivera@example.com',
    target_roles: [
      'Full-Stack Software Engineer',
      'AI Application Engineer',
      'Frontend Systems Engineer',
      'Founding Engineer',
      'Developer Experience Engineer',
    ],
    target_cities: ['Remote', 'San Francisco', 'Bengaluru', 'London'],
    open_to_relocation: true,
    relocation_preference: {
      willing: true,
      requirements: ['Visa sponsorship & relocation stipend for international hubs'],
      preferred_regions: ['US', 'UK', 'Europe', 'Singapore', 'Remote'],
      avoid: ['unpaid trial projects'],
    },
    min_salary_lpa: 18,
    min_salary_usd_annual: 85000,
    experience_years: 2,
    experience_level: 'Early Career / Mid-Level (1–3 yrs)',
    portfolio: 'https://github.com/your-username',
    key_metrics: [
      'Reduced API p99 latency by 64% across 1.2M daily requests',
      'Shipped multi-agent LLM evaluation pipeline processing 50k+ jobs/week',
      'Maintainer of open-source TypeScript SDK with 1,800+ GitHub stars',
    ],
    skills: [
      'TypeScript',
      'Next.js',
      'React',
      'Node.js',
      'PostgreSQL',
      'Python',
      'LLM Orchestration',
      'Docker',
      'Redis',
    ],
    languages: ['English (fluent)'],
    resume_synthesizer_url: 'https://github.com/your-username',
    ats_companies: DEFAULT_ATS_COMPANIES,
    career_urls: DEFAULT_CAREER_URLS,
  },
  data_ml: {
    system_name: siteConfig.name,
    name: 'Priya Sharma',
    email: 'priya.data@example.com',
    target_roles: [
      'Data Scientist',
      'Machine Learning Engineer',
      'Product Data Analyst',
      'Decision Science Analyst',
      'Analytics Engineer',
    ],
    target_cities: ['Bengaluru', 'Hyderabad', 'Mumbai', 'Remote'],
    open_to_relocation: true,
    relocation_preference: {
      willing: true,
      requirements: ['Relocation assistance or remote flexibility'],
      preferred_regions: ['India', 'Europe', 'Singapore', 'UAE'],
      avoid: ['unpaid internships'],
    },
    min_salary_lpa: 14,
    min_salary_usd_annual: 60000,
    experience_years: 1,
    experience_level: 'Associate / 1 Year Experience',
    portfolio: 'https://github.com/your-data-portfolio',
    key_metrics: [
      'Improved churn prediction AUC from 0.74 to 0.91 across 400k subscribers',
      'Automated dbt + BigQuery ETL pipelines saving 18 engineering hours/week',
      'Built real-time experimentation attribution dashboard in Python & SQL',
    ],
    skills: [
      'Python',
      'SQL',
      'PyTorch',
      'Scikit-Learn',
      'dbt',
      'BigQuery',
      'A/B Testing',
      'Causal Inference',
      'Tableau',
    ],
    languages: ['English (fluent)', 'Hindi (native)'],
    resume_synthesizer_url: 'https://github.com/your-data-portfolio',
    ats_companies: DEFAULT_ATS_COMPANIES,
    career_urls: DEFAULT_CAREER_URLS,
  },
  blank_fork: {
    system_name: siteConfig.name,
    name: 'Candidate Workspace',
    email: 'you@example.com',
    target_roles: [
      'Product Manager',
      'Software Engineer',
      'Growth Strategist',
      'Founding Team Member',
    ],
    target_cities: ['Remote', 'Bengaluru'],
    open_to_relocation: true,
    relocation_preference: {
      willing: true,
      requirements: ['Standard relocation support'],
      preferred_regions: ['Global Remote', 'Local Hub'],
      avoid: ['unpaid'],
    },
    min_salary_lpa: 10,
    min_salary_usd_annual: 50000,
    experience_years: 1,
    experience_level: 'Entry / Early Career',
    portfolio: 'https://your-portfolio.com',
    key_metrics: [
      'Delivered 45% measurable growth in core product/engineering KPI',
      'Built and shipped end-to-end system serving 10,000+ active users',
      'Automated operational workflow reducing turnaround time by 60%',
    ],
    skills: ['Product Strategy', 'SQL', 'Python', 'TypeScript', 'Analytics'],
    languages: ['English (fluent)'],
    resume_synthesizer_url: 'https://your-portfolio.com/resume',
    ats_companies: DEFAULT_ATS_COMPANIES,
    career_urls: DEFAULT_CAREER_URLS,
  },
};

/**
 * Structurally detects which track preset matches an arbitrary candidate profile
 * using normalized target-role Jaccard similarity (>= 0.65), avoiding fragile name substring checks.
 */
export function detectMatchingPresetKey(
  profile: Pick<CandidateProfile, 'target_roles' | 'name'>
): ProfilePresetMetadata['key'] | null {
  const roles = new Set(
    (profile.target_roles || []).map((r) => r.trim().toLowerCase()).filter(Boolean)
  );
  if (roles.size === 0) return null;

  let bestKey: ProfilePresetMetadata['key'] | null = null;
  let bestScore = 0;

  for (const meta of PROFILE_PRESET_METADATA) {
    const tpl = FORK_PROFILE_TEMPLATES[meta.key];
    const tplRoles = new Set(
      (tpl.target_roles || []).map((r) => r.trim().toLowerCase()).filter(Boolean)
    );
    if (tplRoles.size === 0) continue;

    let intersection = 0;
    for (const r of roles) {
      if (tplRoles.has(r)) intersection++;
    }
    const union = new Set([...roles, ...tplRoles]).size;
    const jaccard = union > 0 ? intersection / union : 0;

    if (jaccard >= 0.65 && jaccard > bestScore) {
      bestScore = jaccard;
      bestKey = meta.key;
    }
  }

  return bestKey;
}
