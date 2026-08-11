export type PublicSourceStatus = "LIVE" | "BETA" | "ADAPTER_ONLY" | "LEGAL_REVIEW" | "PLANNED";
export type SourceEngineeringState =
  | PublicSourceStatus
  | "UNVERIFIED"
  | "VERIFIED"
  | "DEGRADED"
  | "FAILED"
  | "UNCONFIGURED"
  | "FIXTURE"
  | "DISABLED";
export type PublicSourceLabel =
  "Connected" | "Limited" | "Coming soon" | "Unavailable" | "Permission required";

export type SourceCatalogItem = {
  slug: string;
  name: string;
  provider: string;
  status: PublicSourceStatus;
  fixtureAvailable: boolean;
  engineeringState: SourceEngineeringState;
  exampleAvailable: boolean;
  productionVerified: boolean;
  role: string;
  limitation: string;
};

/**
 * Public launch intent. LIVE means the adapter is part of the launch panel, while
 * productionVerified is deliberately separate and only changes after a real read-back.
 */
export const SOURCE_CATALOG: readonly SourceCatalogItem[] = [
  {
    slug: "website",
    name: "Product website",
    provider: "Direct fetch",
    status: "LIVE",
    fixtureAvailable: true,
    engineeringState: "UNVERIFIED",
    exampleAvailable: true,
    productionVerified: false,
    role: "Product context and credible topics",
    limitation:
      "Untrusted page content; bounded HTML extraction only. Production read-back pending.",
  },
  {
    slug: "x",
    name: "X",
    provider: "xAI X Search",
    status: "BETA",
    fixtureAvailable: true,
    engineeringState: "UNVERIFIED",
    exampleAvailable: true,
    productionVerified: false,
    role: "Current narratives and reply opportunities",
    limitation: "One to two bounded searches; managed credential read-back pending.",
  },
  {
    slug: "google-trends",
    name: "Google Trends",
    provider: "DataForSEO Google Trends",
    status: "LIVE",
    fixtureAvailable: true,
    engineeringState: "UNVERIFIED",
    exampleAvailable: true,
    productionVerified: false,
    role: "Measured search-demand time series",
    limitation: "At most five related keywords; production credential read-back pending.",
  },
  {
    slug: "hacker-news",
    name: "Hacker News",
    provider: "Algolia",
    status: "LIVE",
    fixtureAvailable: true,
    engineeringState: "UNVERIFIED",
    exampleAvailable: true,
    productionVerified: false,
    role: "Developer pain, launches, and objections",
    limitation: "Seven-day default window and at most five queries.",
  },
  {
    slug: "github",
    name: "GitHub",
    provider: "Official API",
    status: "LIVE",
    fixtureAvailable: true,
    engineeringState: "UNVERIFIED",
    exampleAvailable: true,
    productionVerified: false,
    role: "Releases, issues, and ecosystem activity",
    limitation: "Public metadata only; no star-velocity claim without stored snapshots.",
  },
  {
    slug: "open-web",
    name: "Open web / news",
    provider: "Tavily",
    status: "BETA",
    fixtureAvailable: true,
    engineeringState: "UNVERIFIED",
    exampleAvailable: true,
    productionVerified: false,
    role: "Trigger events and independent verification",
    limitation: "Two basic searches maximum; production credential read-back pending.",
  },
  {
    slug: "youtube",
    name: "YouTube",
    provider: "YouTube Data API",
    status: "BETA",
    fixtureAvailable: true,
    engineeringState: "UNVERIFIED",
    exampleAvailable: true,
    productionVerified: false,
    role: "Video traction, hooks, and formats",
    limitation: "Public search and statistics only; no transcript or comment crawl.",
  },
  {
    slug: "manual",
    name: "Manual evidence",
    provider: "Founder review",
    status: "LIVE",
    fixtureAvailable: true,
    engineeringState: "UNVERIFIED",
    exampleAvailable: true,
    productionVerified: false,
    role: "Founder-observed public evidence",
    limitation:
      "Founder-authenticated entry is callable. New records are supplemental and cannot qualify approval or alter decision counts until synthesis is recomputed and evidence is rebound.",
  },
  {
    slug: "reddit",
    name: "Reddit automation",
    provider: "None",
    status: "LEGAL_REVIEW",
    fixtureAvailable: false,
    engineeringState: "LEGAL_REVIEW",
    exampleAvailable: false,
    productionVerified: false,
    role: "Not automated in v0.1",
    limitation: "No commercial ingestion before permission and legal review.",
  },
] as const;

export function productionStatus(source: SourceCatalogItem): string {
  if (
    source.status === "ADAPTER_ONLY" ||
    source.status === "LEGAL_REVIEW" ||
    source.status === "PLANNED"
  ) {
    return source.status;
  }
  return source.productionVerified ? source.status : "READ_BACK_PENDING";
}

/** Friendly public projection; exact technical truth stays in engineeringState. */
export function publicSourceLabel(source: SourceCatalogItem): PublicSourceLabel {
  if (source.engineeringState === "LEGAL_REVIEW") return "Permission required";
  if (source.engineeringState === "DISABLED" || source.engineeringState === "FAILED") {
    return "Unavailable";
  }
  if (source.engineeringState === "VERIFIED" && source.productionVerified) return "Connected";
  if (source.engineeringState === "DEGRADED") return "Limited";
  return "Coming soon";
}
