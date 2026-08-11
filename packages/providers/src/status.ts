import type {
  CredentialMode,
  ProviderHealthStatus,
  SourceStatus,
  SourceStatusDefinition,
} from "./types";

export const SOURCE_STATUS_MATRIX = {
  website: {
    slug: "website",
    publicName: "Product website",
    declaredStatus: "LIVE",
    requiresVerifiedReadback: true,
  },
  google_trends: {
    slug: "google_trends",
    publicName: "Google Trends",
    declaredStatus: "LIVE",
    requiresVerifiedReadback: true,
  },
  hacker_news: {
    slug: "hacker_news",
    publicName: "Hacker News",
    declaredStatus: "LIVE",
    requiresVerifiedReadback: true,
  },
  github: {
    slug: "github",
    publicName: "GitHub",
    declaredStatus: "LIVE",
    requiresVerifiedReadback: true,
  },
  x: {
    slug: "x",
    publicName: "X",
    declaredStatus: "BETA",
    requiresVerifiedReadback: true,
  },
  tavily: {
    slug: "tavily",
    publicName: "Open web/news",
    declaredStatus: "BETA",
    requiresVerifiedReadback: true,
  },
  youtube: {
    slug: "youtube",
    publicName: "YouTube",
    declaredStatus: "BETA",
    requiresVerifiedReadback: true,
  },
  manual: {
    slug: "manual",
    publicName: "Manual founder evidence",
    declaredStatus: "LIVE",
    requiresVerifiedReadback: false,
  },
  reddit: {
    slug: "reddit",
    publicName: "Reddit automation",
    declaredStatus: "LEGAL_REVIEW",
    requiresVerifiedReadback: false,
  },
  other: {
    slug: "other",
    publicName: "Other sources",
    declaredStatus: "PLANNED",
    requiresVerifiedReadback: false,
  },
} as const satisfies Record<string, SourceStatusDefinition>;

export function resolveSourceStatus(
  definition: SourceStatusDefinition,
  health: ProviderHealthStatus,
  options: { credentialMode?: CredentialMode; productionReadbackVerified?: boolean } = {},
): SourceStatus {
  if (definition.declaredStatus === "LEGAL_REVIEW" || definition.declaredStatus === "PLANNED") {
    return definition.declaredStatus;
  }
  if (health === "FAILED" || health === "UNCONFIGURED" || health === "DEGRADED") {
    return "DEGRADED";
  }
  if (
    definition.requiresVerifiedReadback &&
    (options.credentialMode === "fixture" || options.productionReadbackVerified === false)
  ) {
    return "DEGRADED";
  }
  return definition.declaredStatus;
}
