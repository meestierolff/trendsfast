import {
  SOURCE_CATALOG,
  publicSourceLabel,
  type PublicSourceLabel,
  type SourceCatalogItem,
  type SourceEngineeringState,
} from "./source-catalog";

export type SourceVerificationView = {
  source: string;
  provider: string;
  state: SourceEngineeringState | "RUNNING";
  credentialMode: string;
  deploymentEnvironment: "local" | "preview" | "production";
  releaseSha: string | null;
  deploymentHost: string | null;
  deploymentId: string | null;
  healthStatus: string | null;
  readbackVerified: boolean;
  canonicalUrls: string[];
  latencyMs: number | null;
  estimatedCostUsd: string;
  actualCostUsd: string | null;
  quotaUsed: string;
  limitations: string[];
  failureCode: string | null;
  failureMessage: string | null;
  checkedAt: Date | null;
  completedAt: Date | null;
};

export type PublicSourceStatusView = {
  slug: string;
  name: string;
  provider: string;
  publicLabel: PublicSourceLabel;
  role: string;
  limitation: string;
  limitations: string[];
  exampleAvailable: boolean;
  productionVerified: boolean;
  lastVerifiedAt: string | null;
  technicalState: SourceEngineeringState;
  readBackEvidence: {
    provider: string;
    credentialMode: string;
    deploymentEnvironment: "local" | "preview" | "production";
    releaseSha: string | null;
    healthStatus: string | null;
    canonicalUrlCount: number;
    latencyMs: number | null;
    estimatedCostUsd: string;
    actualCostUsd: string | null;
    quotaUsed: string;
    failureCode: string | null;
    checkedAt: string | null;
  } | null;
};

const catalogToSource: Readonly<Record<string, string>> = {
  website: "website",
  x: "x",
  "google-trends": "google_trends",
  "hacker-news": "hacker_news",
  github: "github",
  "open-web": "tavily",
  youtube: "youtube",
  manual: "manual",
  reddit: "reddit",
};

function applyVerification(
  source: SourceCatalogItem,
  verification: SourceVerificationView | undefined,
): SourceCatalogItem {
  if (!verification || verification.state === "RUNNING") return source;
  return {
    ...source,
    engineeringState: verification.state,
    productionVerified:
      verification.state === "VERIFIED" &&
      verification.readbackVerified === true &&
      verification.deploymentEnvironment === "production" &&
      Boolean(verification.releaseSha && verification.deploymentHost),
  };
}

/**
 * Pure source projection used by both the public API and server-rendered pages.
 * Missing/unavailable database state can never upgrade a static source claim.
 */
export function projectPublicSourceStatuses(
  latestVerifications: readonly SourceVerificationView[] = [],
): PublicSourceStatusView[] {
  const bySource = new Map<string, SourceVerificationView>();
  for (const record of latestVerifications) {
    if (record.deploymentEnvironment !== "production") continue;
    const existing = bySource.get(record.source);
    const completedAt = record.completedAt?.getTime() ?? 0;
    if (!existing || completedAt > (existing.completedAt?.getTime() ?? 0)) {
      bySource.set(record.source, record);
    }
  }
  return SOURCE_CATALOG.map((catalogItem) => {
    const verification = bySource.get(catalogToSource[catalogItem.slug] ?? catalogItem.slug);
    const source = applyVerification(catalogItem, verification);
    const completedAt = verification?.completedAt?.toISOString() ?? null;
    return {
      slug: source.slug,
      name: source.name,
      provider: source.provider,
      publicLabel: publicSourceLabel(source),
      role: source.role,
      limitation: source.limitation,
      limitations: verification?.limitations.length
        ? [...verification.limitations]
        : [source.limitation],
      exampleAvailable: source.exampleAvailable,
      productionVerified: source.productionVerified,
      lastVerifiedAt: verification?.checkedAt?.toISOString() ?? completedAt,
      technicalState: source.engineeringState,
      readBackEvidence: verification
        ? {
            provider: verification.provider,
            credentialMode: verification.credentialMode,
            deploymentEnvironment: verification.deploymentEnvironment,
            releaseSha: verification.releaseSha,
            healthStatus: verification.healthStatus,
            // Verification targets can belong to private founder scans. The
            // durable ops record retains exact URLs; the public projection
            // exposes only proof cardinality.
            canonicalUrlCount: verification.canonicalUrls.length,
            latencyMs: verification.latencyMs,
            estimatedCostUsd: verification.estimatedCostUsd,
            actualCostUsd: verification.actualCostUsd,
            quotaUsed: verification.quotaUsed,
            failureCode: verification.failureCode,
            checkedAt: verification.checkedAt?.toISOString() ?? completedAt,
          }
        : null,
    };
  });
}
