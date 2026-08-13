export const PROOF_POINTS = [
  "Founder-reviewed",
  "Evidence-linked",
  "Private by default",
  "No auto-posting",
  "Open source",
] as const;

export const AUDIENCES = [
  {
    title: "AI founders",
    text: "Turn fast product cycles into timely, product-specific distribution decisions your agents can use.",
  },
  {
    title: "SaaS founders",
    text: "Find the conversations and demand shifts that matter to a narrow buyer instead of chasing broad hype.",
  },
  {
    title: "Developer-tool founders",
    text: "Connect developer adoption, search, community, and release signals to one useful next action.",
  },
  {
    title: "Agents and automation builders",
    text: "Give workflows structured trend intelligence without handing them a feed to interpret or a publishing key.",
  },
] as const;

export const HOW_IT_WORKS = [
  {
    number: "01",
    title: "Understand",
    text: "Read the public product, infer its buyer and credible topics, and keep assumptions visible for founder review.",
  },
  {
    number: "02",
    title: "Detect",
    text: "Check bounded social, search, developer, news, and content signals while preserving original URLs and source limits.",
  },
  {
    number: "03",
    title: "Decide",
    text: "Rank the evidence, apply the quality floor, and return one PUBLISH, REPLY, REMIX, or WAIT.",
  },
] as const;

export const FEATURES = [
  [
    "Relevant trend detection",
    "Signals are filtered against the product, buyer, credibility, timing, and usable formats.",
  ],
  [
    "Measured versus inferred momentum",
    "Time series and stored snapshots stay distinct from an emerging but unmeasured signal.",
  ],
  [
    "Cross-source confirmation",
    "Independent origins can strengthen a decision; copies of one announcement cannot.",
  ],
  [
    "One Next Move",
    "Every completed scan resolves to PUBLISH, REPLY, REMIX, or WAIT—never another research feed.",
  ],
  [
    "Evidence receipts",
    "Original URLs, observation times, reasons, and limitations stay attached to the recommendation.",
  ],
  [
    "WAIT quality floor",
    "Thin, stale, dependent, or poorly matched evidence stops the move instead of manufacturing urgency.",
  ],
  [
    "Founder review",
    "The first cohort gets a human context and evidence check before a result is delivered.",
  ],
  [
    "Agent-ready JSON",
    "The web result and REST API use the same bounded, structured decision contract.",
  ],
] as const;

export const AGENT_TOOLS = [
  "ChatGPT",
  "Claude",
  "Codex",
  "Cursor",
  "OpenClaw",
  "Hermes",
  "n8n",
  "Make",
  "Zapier",
] as const;

export const EVIDENCE_SOURCES = [
  "Search demand",
  "X",
  "Hacker News",
  "GitHub",
  "Web and news",
  "YouTube",
  "Product site",
  "Manual evidence",
] as const;

export const OUTPUT_CHANNELS = [
  "X",
  "LinkedIn",
  "Reddit",
  "YouTube",
  "TikTok",
  "Blog and newsletter",
] as const;

export const FAQS = [
  {
    question: "What is a Next Move?",
    answer:
      "One evidence-backed distribution action: PUBLISH, REPLY, REMIX, or WAIT, with a topic, channel, angle, hook, format, outline, why-now explanation, evidence, confidence, limitations, and validity window.",
  },
  {
    question: "Does one Next Move equal one content piece?",
    answer:
      "Not always. A move is one distribution action. It can power a post, reply, thread, article, short video, tutorial, or brief, but it is not promised as a finished asset.",
  },
  {
    question: "Is this a social media trend API?",
    answer:
      "Yes. TrendsFast combines social and search trend detection with product context, then returns a decision rather than reselling a raw feed.",
  },
  {
    question: "Does it guarantee viral content?",
    answer:
      "No. Relevant evidence can improve timing and fit, but TrendsFast never guarantees virality, views, users, customers, or revenue.",
  },
  {
    question: "Which sources are connected?",
    answer:
      "The source ledger distinguishes Connected, Limited, Coming soon, Unavailable, and Permission required. A source is never marked connected without a dated deployed read-back.",
  },
  {
    question: "Why can the result be WAIT?",
    answer:
      "WAIT protects your credibility when evidence is weak, stale, dependent, irrelevant, saturated, or outside the formats you can credibly make.",
  },
  {
    question: "Do I connect social accounts?",
    answer:
      "No. The free scan begins with one public product URL and does not ask for social-account access.",
  },
  {
    question: "Does it publish?",
    answer:
      "No. TrendsFast recommends one move and binds the evidence. You review, edit, and decide whether and where to publish.",
  },
  {
    question: "Can every agent call it?",
    answer:
      "Any tool that can make an authenticated HTTP request can use the REST contract once its project has approved API access. That is not the same as a native integration.",
  },
  {
    question: "What does unlimited agents mean?",
    answer:
      "Multiple agent clients may use the same project-scoped key. It never means unlimited research runs, projects, provider fan-out, or model usage.",
  },
  {
    question: "What are the plan limits?",
    answer:
      "Founder is €39/month and covers one monitored product, one scheduled run per day, ten accepted on-demand refreshes per billing month, at most one delivered move per day, and 30-day history.",
  },
  {
    question: "How does cloud differ from open source?",
    answer:
      "Open source includes the same decision engine with PostgreSQL and bring-your-own provider keys. Managed cloud adds provider accounts and operations when those services are enabled.",
  },
  {
    question: "How is submitted data handled?",
    answer:
      "Free scans are private by default, use unguessable links, and accept a public product URL. Public sharing is a separate explicit opt-in after delivery.",
  },
] as const;

export const FOUNDER_STORY =
  "Building became fast. Distribution research stayed slow. I kept reopening the same social, search, developer, news, and video tabs—then still had to decide what was relevant to say. More raw data did not solve that last mile. TrendsFast is built around one decision: understand the product, detect a credible moment, and return one evidence-backed Next Move. The first cohort is founder-reviewed because context and trust matter more than volume. The engine is open source, results are private by default, and nothing auto-posts.";
