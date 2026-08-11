import type { ProjectContext } from "@trendsfast/schemas";

type FixtureAction = "PUBLISH" | "REPLY" | "REMIX" | "WAIT";

export type DogfoodFixture = {
  name: string;
  slug: string;
  url: string;
  source: "REPOSITORY_CONTEXT" | "FOUNDER_BRIEF_ASSUMPTION";
  context: ProjectContext;
  move: {
    action: FixtureAction;
    channel: string;
    format: string;
    topic: string;
    angle: string;
  };
  evidencePlan: string[];
  limitations: string[];
};

function context(
  input: Partial<ProjectContext> &
    Pick<ProjectContext, "name" | "url" | "category" | "audience" | "problem" | "desiredOutcome">,
): ProjectContext {
  return {
    credibleClaims: [],
    alternatives: [],
    competitors: [],
    markets: ["US"],
    language: "en",
    suitableChannels: ["x"],
    availableFormats: ["founder_text"],
    credibleTopics: [],
    assumptions: ["Fixture context requires founder correction before any live recommendation."],
    ...input,
  };
}

export const DOGFOOD_FIXTURES: readonly DogfoodFixture[] = [
  {
    name: "TrendsFast",
    slug: "trendsfast",
    url: "https://trendsfast.com",
    source: "FOUNDER_BRIEF_ASSUMPTION",
    context: context({
      name: "TrendsFast",
      url: "https://trendsfast.com",
      category: "distribution intelligence API",
      audience: "Technical solo founders and small AI, B2B SaaS, and developer-tool teams",
      problem:
        "Founders spend hours comparing fragmented signals but still do not know what to distribute now.",
      desiredOutcome: "Choose one timely, credible distribution action with original evidence.",
      credibleClaims: ["Returns PUBLISH, REPLY, REMIX, or WAIT", "No auto-posting"],
      alternatives: ["manual platform research", "generic LLM ideation"],
      competitors: ["social listening dashboards"],
      markets: ["US", "EU"],
      suitableChannels: ["x", "reddit", "hacker_news", "github"],
      availableFormats: ["founder_text", "technical_tutorial"],
      credibleTopics: ["distribution research", "evidence-bound agents", "trend truth"],
    }),
    move: {
      action: "PUBLISH",
      channel: "x",
      format: "founder_text",
      topic: "Why a signal feed still does not tell a founder what to do",
      angle: "Open the engine and show one decision with its receipts and limitations.",
    },
    evidencePlan: [
      "Google Trends: distribution agents",
      "Hacker News: founder research pain",
      "GitHub: agent workflow adoption",
    ],
    limitations: ["Fixture only; no source read-back or outcome evidence."],
  },
  {
    name: "Halio",
    slug: "halio",
    url: "https://halio.nl",
    source: "REPOSITORY_CONTEXT",
    context: context({
      name: "Halio",
      url: "https://halio.nl",
      category: "portfolio risk and retirement calculation software",
      audience:
        "Dutch self-directed investors who want a calm second opinion on concentration and cash flow",
      problem:
        "ETF look-through, Box 3, concentration, and retirement scenarios are difficult to reason about together.",
      desiredOutcome:
        "Understand exposure and scenario tradeoffs without presenting calculation software as advice.",
      credibleClaims: ["Calculation software, not investment or tax advice"],
      alternatives: ["spreadsheets", "broker dashboards"],
      competitors: ["portfolio trackers"],
      markets: ["NL"],
      language: "nl",
      suitableChannels: ["linkedin", "youtube"],
      availableFormats: ["annotated_chart", "screen_recording"],
      credibleTopics: ["ETF overlap", "portfolio concentration", "Box 3 scenarios"],
    }),
    move: {
      action: "REMIX",
      channel: "linkedin",
      format: "annotated_chart",
      topic: "The hidden company overlap inside two ordinary ETFs",
      angle:
        "Translate a proven portfolio teardown into a Dutch, calculation-first example with an advice disclaimer.",
    },
    evidencePlan: [
      "Google Trends NL: ETF overlap",
      "YouTube: portfolio teardown formats",
      "Open web: Dutch Box 3 trigger",
    ],
    limitations: ["Issuer holdings and production product claims require founder verification."],
  },
  {
    name: "ShipToUsers",
    slug: "ship-to-users",
    url: "https://shiptousers.com",
    source: "REPOSITORY_CONTEXT",
    context: context({
      name: "ShipToUsers",
      url: "https://shiptousers.com",
      category: "agent-native distribution platform",
      audience:
        "Developers who ship products but lack a repeatable path to finding and learning from users",
      problem:
        "Fast product shipping is disconnected from evidence, distribution execution, and learning.",
      desiredOutcome: "Turn product context into an approved, measurable distribution action.",
      credibleClaims: ["Distribution for developers", "Manual publishing boundary"],
      alternatives: ["launch checklists", "social schedulers"],
      competitors: ["founder growth playbooks"],
      markets: ["US", "EU"],
      suitableChannels: ["hacker_news", "github"],
      availableFormats: ["technical_post", "architecture_diagram"],
      credibleTopics: ["distribution systems", "human approval", "venture context"],
    }),
    move: {
      action: "REPLY",
      channel: "hacker_news",
      format: "technical_reply",
      topic: "A developer asks what comes after shipping the MVP",
      angle:
        "Offer the context → action → approval → learning loop as a useful answer before mentioning the product.",
    },
    evidencePlan: [
      "Hacker News: active post-launch question",
      "GitHub: developer distribution tooling",
    ],
    limitations: [
      "Repository describes a pre-launch direction; avoid implying production-verified integrations.",
    ],
  },
  {
    name: "Eve",
    slug: "eve",
    url: "https://eve-reader.example",
    source: "REPOSITORY_CONTEXT",
    context: context({
      name: "Eve",
      url: "https://eve-reader.example",
      category: "Kindle-first read-later tool",
      audience: "Thoughtful web readers who want a finite evening reading edition on Kindle",
      problem: "Read-later queues grow without creating a calm, finishable reading ritual.",
      desiredOutcome:
        "Save worthwhile articles, shape a finite EPUB, and deliver it through an authorized Kindle address.",
      credibleClaims: ["Finite evening EPUB", "Kindle-first beta"],
      alternatives: ["endless read-later queues", "browser tabs"],
      competitors: ["Pocket", "Instapaper"],
      suitableChannels: ["youtube", "x"],
      availableFormats: ["screen_recording", "founder_text"],
      credibleTopics: ["finite reading", "Kindle workflows", "attention rituals"],
    }),
    move: {
      action: "PUBLISH",
      channel: "youtube",
      format: "screen_recording",
      topic: "Turn twelve open tabs into one finite evening edition",
      angle:
        "Show the calm endpoint and the explicit authorized-delivery boundary in under a minute.",
    },
    evidencePlan: [
      "YouTube: Kindle workflow traction",
      "Google Trends: read later Kindle",
      "Open web: attention fatigue",
    ],
    limitations: ["The URL is a fixture placeholder; founder must confirm public name and claims."],
  },
  {
    name: "Ask Me Someday",
    slug: "ask-me-someday",
    url: "https://askmesomeday.example",
    source: "REPOSITORY_CONTEXT",
    context: context({
      name: "Ask Me Someday",
      url: "https://askmesomeday.example",
      category: "private family audio memory archive",
      audience: "Parents who want to preserve short stories for a child across ages and years",
      problem:
        "Meaningful family memories are easy to postpone and hard to organize into a durable archive.",
      desiredOutcome: "Record, safely save, revisit, and export a private audio memory.",
      credibleClaims: ["Protected local media", "Free ownership and export"],
      alternatives: ["voice memos", "photo libraries"],
      competitors: ["family journal apps"],
      suitableChannels: ["instagram", "linkedin"],
      availableFormats: ["founder_story", "audio_waveform"],
      credibleTopics: ["family memory rituals", "private-by-design media", "audio archives"],
    }),
    move: {
      action: "WAIT",
      channel: "instagram",
      format: "founder_story",
      topic: "No current family-memory conversation has enough independent evidence",
      angle:
        "Hold the founder story draft and re-check around a relevant seasonal or platform trigger.",
    },
    evidencePlan: ["Google Trends: family audio memories", "Open web: privacy or seasonal trigger"],
    limitations: [
      "Current repository name is Kinloom; brand mapping and public URL require founder correction.",
    ],
  },
  {
    name: "Not An Insider",
    slug: "not-an-insider",
    url: "https://notaninsider.example",
    source: "REPOSITORY_CONTEXT",
    context: context({
      name: "Not An Insider",
      url: "https://notaninsider.example",
      category: "public 13F portfolio explorer and one-dollar internet club",
      audience:
        "Curious retail investors who enjoy public superinvestor filings and an authored clubhouse experience",
      problem:
        "Public filings are delayed and cumbersome, while finance products overstate what the data means.",
      desiredOutcome:
        "Explore reviewed public holdings with visible limitations and optionally join a playful club.",
      credibleClaims: [
        "Public data remains public",
        "Membership does not unlock secret financial information",
      ],
      alternatives: ["raw SEC filings", "finance newsletters"],
      competitors: ["13F aggregators"],
      markets: ["US", "EU"],
      suitableChannels: ["reddit", "x"],
      availableFormats: ["data_story", "founder_text"],
      credibleTopics: ["13F limitations", "portfolio disclosures", "internet clubs"],
    }),
    move: {
      action: "REPLY",
      channel: "reddit_manual",
      format: "data_reply",
      topic: "A filing thread treats a delayed 13F as a live portfolio",
      angle:
        "Explain the delay and incompleteness with a sourced example; mention the explorer only if useful.",
    },
    evidencePlan: [
      "Manual founder evidence: relevant public Reddit URL",
      "Open web: official SEC filing context",
    ],
    limitations: ["Reddit is manual evidence only; nothing here is investment advice."],
  },
  {
    name: "Payout Rank",
    slug: "payout-rank",
    url: "https://payoutrank.example",
    source: "FOUNDER_BRIEF_ASSUMPTION",
    context: context({
      name: "Payout Rank",
      url: "https://payoutrank.example",
      category: "payout comparison and ranking product",
      audience:
        "Operators comparing payout methods, economics, or rankings before choosing a provider",
      problem:
        "Payout options are hard to compare when fees, timing, eligibility, and evidence are inconsistent.",
      desiredOutcome: "Make a defensible payout comparison from transparent criteria.",
      credibleClaims: [],
      alternatives: ["spreadsheets", "affiliate comparison pages"],
      competitors: [],
      suitableChannels: ["linkedin", "open_web"],
      availableFormats: ["comparison_table", "methodology_post"],
      credibleTopics: ["payout methodology", "fee transparency", "comparison evidence"],
    }),
    move: {
      action: "WAIT",
      channel: "linkedin",
      format: "methodology_post",
      topic: "Product context is too ambiguous for a credible payout claim",
      angle:
        "Hold the methodology post and request founder correction on payout category, buyer, and criteria before collecting signals.",
    },
    evidencePlan: [
      "Product website: category correction",
      "Google Trends: only after terminology is confirmed",
    ],
    limitations: [
      "No repository or verified public URL was available; this fixture intentionally returns WAIT.",
    ],
  },
  {
    name: "Top of the World",
    slug: "top-of-the-world",
    url: "https://topoftheworld.nl",
    source: "REPOSITORY_CONTEXT",
    context: context({
      name: "Top of the World",
      url: "https://topoftheworld.nl",
      category: "tailor-made Himalaya journey planning",
      audience:
        "Dutch travellers considering human-planned Nepal, Bhutan, Tibet, or Darjeeling/Sikkim journeys",
      problem:
        "Complex Himalaya trips need trustworthy local coordination and realistic planning, not a self-serve checkout.",
      desiredOutcome:
        "Discover an itinerary and start a qualified conversation with a local-operator network.",
      credibleClaims: ["Human-led proposal, closing, coordination, and fulfilment"],
      alternatives: ["generic tour marketplaces", "DIY itineraries"],
      competitors: ["specialist travel agencies"],
      markets: ["NL"],
      language: "nl",
      suitableChannels: ["youtube", "pinterest"],
      availableFormats: ["route_map", "traveller_guide"],
      credibleTopics: ["Himalaya planning", "seasonal route tradeoffs", "local operators"],
    }),
    move: {
      action: "REMIX",
      channel: "pinterest",
      format: "route_map",
      topic: "A visual decision guide: Nepal or Bhutan for a first Himalaya journey",
      angle:
        "Adapt the comparison-map format to season, pace, permits, and human planning without unverified savings claims.",
    },
    evidencePlan: [
      "Google Trends NL: Nepal vs Bhutan",
      "YouTube: Himalaya itinerary formats",
      "Open web: current permit or access trigger",
    ],
    limitations: [
      "All operational travel claims require product-truth and current-source verification.",
    ],
  },
] as const;

export function fixtureDecision(fixture: DogfoodFixture) {
  return {
    context: fixture.context,
    move: fixture.move,
    evidencePlan: fixture.evidencePlan,
    limitations: fixture.limitations,
    founderReviewed: false,
    autoPublish: false as const,
  };
}

export function dogfoodFixtureForUrl(url: string): DogfoodFixture | null {
  const hostname = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  return (
    DOGFOOD_FIXTURES.find((fixture) => {
      const fixtureHost = new URL(fixture.url).hostname.replace(/^www\./, "").toLowerCase();
      return hostname === fixtureHost;
    }) ?? null
  );
}
