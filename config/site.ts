export const siteConfig = {
  name: "OpenScout OS",
  author: "[Your Name]",
  description: "An autonomous, AI-driven job searching agent. It scouts, evaluates, and tracks roles programmatically without manual intervention.",
  githubRepo: "https://github.com/yourusername/openscout-os",
  stats: {
    scouted_label: "Jobs Scouted (7d)",
    match_label: "Avg Match Score",
    sent_label: "Applications Sent",
    response_label: "Response Rate",
  },
  features: [
    {
      title: "Scout",
      description: "API fetches daily roles based on profile"
    },
    {
      title: "Score",
      description: "AI grades fit & drafts outreach"
    },
    {
      title: "Track",
      description: "High scores yield G-Sheet entry & ping"
    },
    {
      title: "Act",
      description: "Gmail API monitors threads & replies"
    }
  ]
};
