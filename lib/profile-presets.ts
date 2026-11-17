import { siteConfig } from '../config/site';

export interface AtsCompanyTargets {
  greenhouse: string[];
  lever: string[];
  ashby: string[];
  workable?: string[];
  smartrecruiters?: string[];
  recruitee?: string[];
}

export interface CandidateProfile {
  system_name?: string;
  name: string;
  email: string;
  target_roles: string[];
  target_cities: string[];
  open_to_relocation: boolean;
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
  'https://linear.app/careers',
  'https://posthog.com/careers',
];

export const DEFAULT_ATS_COMPANIES: AtsCompanyTargets = {
  greenhouse: ['razorpay', 'postman', 'stripe', 'vercel', 'cloudflare'],
  lever: ['zepto', 'cred', 'mistral'],
  ashby: ['linear', 'posthog', 'supabase', 'langchain'],
  workable: ['raycast'],
  smartrecruiters: ['Visa'],
  recruitee: ['framer'],
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
