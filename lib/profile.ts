import fs from 'fs';
import path from 'path';

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
}

export const FORK_PROFILE_TEMPLATES: Record<string, CandidateProfile> = {
  pm_growth: {
    system_name: 'CareerOS',
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
    target_cities: ['Hyderabad', 'Bengaluru'],
    open_to_relocation: true,
    relocation_preference: {
      willing: true,
      requirements: [
        'relocation package OR accommodation provided OR housing allowance',
        'visa sponsorship if outside India',
        'competitive salary for location (min $30k USD equivalent abroad OR ₹8 LPA India)',
      ],
      preferred_regions: ['UAE', 'Singapore', 'UK', 'Europe', 'Southeast Asia', 'India'],
      avoid: ['unpaid', 'self-sponsored visa only with no support'],
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
      'AI tooling',
      'Cloudflare Workers',
      'Vibe-coding',
    ],
    languages: ['English (fluent)', 'Telugu (native)', 'Hindi (conversational)'],
    resume_synthesizer_url: 'https://portjitterglitter.vercel.app/resume',
  },
  swe_ai: {
    system_name: 'ScoutOS',
    name: 'Alex Rivera (Fork Owner)',
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
  },
  data_ml: {
    system_name: 'VectorOS',
    name: 'Priya Sharma (Fork Owner)',
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
  },
  blank_fork: {
    system_name: 'MyCareerOS',
    name: 'Your Name Here',
    email: 'you@example.com',
    target_roles: [
      'Product Manager',
      'Software Engineer',
      'Growth Strategist',
      'Founding Team Member',
    ],
    target_cities: ['Remote', 'Your City'],
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
      'Delivered X% measurable growth in core product/engineering KPI',
      'Built and shipped Y end-to-end system serving Z users',
      'Automated workflow reducing manual turnaround time by N%',
    ],
    skills: ['Core Skill 1', 'Core Skill 2', 'Core Skill 3', 'Analytics', 'AI Workflows'],
    languages: ['English (fluent)'],
    resume_synthesizer_url: 'https://your-portfolio.com/resume',
  },
};

export function getCandidateProfile(): CandidateProfile {
  try {
    const profilePath = path.join(process.cwd(), 'data', 'profile.json');
    const raw = fs.readFileSync(profilePath, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      system_name: parsed.system_name || 'CareerOS',
      ...parsed,
    };
  } catch {
    return FORK_PROFILE_TEMPLATES.pm_growth;
  }
}
