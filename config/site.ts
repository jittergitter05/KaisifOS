export const siteConfig = {
  name: "KaisifOS",
  author: "Shaik Kaisif Basha",
  description:
    "Autonomous job intelligence and outreach engine: aggregates direct-ATS public boards (Greenhouse, Lever, Ashby) and global feeds, evaluates fit across a 100-point 4-pillar rubric with a 4-tier free AI failover chain, synthesizes metric-backed outreach, and monitors Gmail threads for recruiter replies.",
  githubRepo: "https://github.com/jittergitter05/KaisifOS",
  freehireAttributionUrl: "https://github.com/strelov1/freehire",
  workflows: {
    jobScoutSchedule: "0 4 * * 0,1,3,5",
    jobScoutHuman: "Sun, Mon, Wed, Fri · 04:00 UTC (09:30 IST)",
    replyTrackerSchedule: "30 3 * * 1-5",
    replyTrackerHuman: "Mon–Fri · 03:30 UTC (09:00 IST)",
  },
  stats: {
    scouted_label: "Roles Evaluated (7d)",
    match_label: "Mean Fit Score",
    sent_label: "Active Applications",
    response_label: "Verified Reply Rate",
  },
  features: [
    {
      step: "01",
      title: "Direct-ATS & Feed Scout",
      mechanism:
        "Parallel ingestion across Greenhouse, Lever, and Ashby public JSON boards (inspired by strelov1/freehire), RemoteOK, Remotive, Himalayas, Arbeitnow, Internshala, and optional FREEHIRE_API_URL / JSearch",
      outcome: "Eliminates manual board polling and duplicate role evaluation via canonical company::title deduplication",
    },
    {
      step: "02",
      title: "4-Tier Failover & Rubric Scoring",
      mechanism:
        "Cascades Gemini 4 Hydrogen -> Groq Llama 3.3 70B -> OpenRouter 3-model :free router -> Always-on Deterministic 4-Pillar Rubric v3.2 across Role (40), Skill (30), Seniority (15), and Comp/Geo (15)",
      outcome: "Surfaces verified conviction matches even with zero external API keys configured",
    },
    {
      step: "03",
      title: "Metric-Grounded Outreach Synthesis",
      mechanism:
        "Injects verified proof metrics and portfolio URLs directly from the active candidate profile into LinkedIn DMs, cold emails, and STAR prep packs",
      outcome: "Zero fabricated claims; tailored cold outreach and interview framing per role",
    },
    {
      step: "04",
      title: "Autonomous Reply Tracker",
      mechanism:
        "Polls Gmail API metadata headers on weekdays against APPLIED companies and dispatches high-signal Discord notifications",
      outcome: "Automatically transitions pipeline status to REPLIED when recruiters respond",
    },
  ],
};
