export const siteConfig = {
  name: "KaisifOS",
  author: "Shaik Kaisif Basha",
  description:
    "An autonomous job intelligence and outreach engine that aggregates global & India roles, evaluates fit across a 100-point 4-pillar rubric, synthesizes metric-backed outreach, and monitors Gmail threads for recruiter replies.",
  githubRepo: "https://github.com/jittergitter05/KaisifOS",
  stats: {
    scouted_label: "Roles Evaluated (7d)",
    match_label: "Mean Fit Score",
    sent_label: "Active Applications",
    response_label: "Verified Reply Rate",
  },
  features: [
    {
      step: "01",
      title: "Multi-Source Scout",
      mechanism: "Parallel ingestion from Internshala, RemoteOK, Remotive & JSearch with persistent SeenJobs deduplication",
      outcome: "Eliminates manual board polling and duplicate role evaluation across daily runs",
    },
    {
      step: "02",
      title: "4-Pillar Rubric Scoring",
      mechanism: "Deterministic + LLM evaluation across Role (40), Experience (25), Location/Relo (20), and Salary (15)",
      outcome: "Surfaces only >=90 conviction matches while enforcing strict fresher & salary floors",
    },
    {
      step: "03",
      title: "Outreach Synthesis",
      mechanism: "Injects verified candidate metrics (425% SEO & 1,466% page growth) into tailored LinkedIn DMs & resume angles",
      outcome: "Zero generic cover letters; immediate high-conversion cold outreach drafts per role",
    },
    {
      step: "04",
      title: "Autonomous Reply Tracker",
      mechanism: "Polls Gmail API metadata headers every 6 hours against APPLIED companies and triggers Discord alerts",
      outcome: "Automatically transitions pipeline status to REPLIED for sub-2-hour recruiter turnaround",
    },
  ],
};
