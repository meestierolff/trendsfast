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
  healthStatus: string | null;
  readbackVerified: boolean;
  canonicalUrlCount: number;
  latencyMs: number | null;
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
    healthStatus: string | null;
    canonicalUrlCount: number;
    latencyMs: number | null;
    checkedAt: string | null;
  } | null;
};

export type CurrentProductionDeployment = {
  deploymentEnvironment: "local" | "preview" | "production";
  releaseSha: string | null;
  deploymentHost: string | null;
  deploymentId: string | null;
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
  if (["ADAPTER_ONLY", "LEGAL_REVIEW", "PLANNED"].includes(source.status)) return source;
  const verifiedState =
    verification.state === "VERIFIED" && verification.healthStatus !== "HEALTHY"
      ? "DEGRADED"
      : verification.state;
  const effectiveState =
    source.slug === "manual" && verifiedState === "VERIFIED" ? "DEGRADED" : verifiedState;
  return {
    ...source,
    engineeringState: effectiveState,
    productionVerified:
      effectiveState === "VERIFIED" &&
      verification.healthStatus === "HEALTHY" &&
      verification.readbackVerified === true &&
      verification.deploymentEnvironment === "production" &&
      source.slug !== "manual",
  };
}

/**
 * Pure source projection used by both the public API and server-rendered pages.
 * Missing/unavailable database state can never upgrade a static source claim.
 */
export function projectPublicSourceStatuses(
  latestVerifications: readonly SourceVerificationView[],
  currentDeployment: CurrentProductionDeployment,
): PublicSourceStatusView[] {
  const bySource = new Map<string, SourceVerificationView>();
  for (const record of latestVerifications) {
    if (
      currentDeployment.deploymentEnvironment !== "production" ||
      !currentDeployment.releaseSha ||
      !currentDeployment.deploymentHost ||
      !currentDeployment.deploymentId ||
      record.deploymentEnvironment !== "production" ||
      !Number.isSafeInteger(record.canonicalUrlCount) ||
      record.canonicalUrlCount < 0
    ) {
      continue;
    }
    const existing = bySource.get(record.source);
    const completedAt = record.completedAt?.getTime() ?? 0;
    if (!existing || completedAt > (existing.completedAt?.getTime() ?? 0)) {
      bySource.set(record.source, record);
    }
  }
  return SOURCE_CATALOG.map((catalogItem) => {
    const candidate = bySource.get(catalogToSource[catalogItem.slug] ?? catalogItem.slug);
    const verification = ["ADAPTER_ONLY", "LEGAL_REVIEW", "PLANNED"].includes(catalogItem.status)
      ? undefined
      : candidate;
    const source = applyVerification(catalogItem, verification);
    const completedAt = verification?.completedAt?.toISOString() ?? null;
    return {
      slug: source.slug,
      name: source.name,
      provider: source.provider,
      publicLabel: publicSourceLabel(source),
      role: source.role,
      limitation: source.limitation,
      limitations: [source.limitation],
      exampleAvailable: source.exampleAvailable,
      productionVerified: source.productionVerified,
      lastVerifiedAt: verification?.checkedAt?.toISOString() ?? completedAt,
      technicalState: source.engineeringState,
      readBackEvidence: verification
        ? {
            provider: verification.provider,
            credentialMode: verification.credentialMode,
            deploymentEnvironment: verification.deploymentEnvironment,
            healthStatus: verification.healthStatus,
            // Verification targets can belong to private founder scans. The
            // durable ops record retains exact URLs; the public projection
            // exposes only proof cardinality.
            canonicalUrlCount: verification.canonicalUrlCount,
            latencyMs: verification.latencyMs,
            checkedAt: verification.checkedAt?.toISOString() ?? completedAt,
          }
        : null,
    };
  });
}
