import type { ZodType } from "zod";

export type CredentialMode = "fixture" | "managed" | "byok";

export type ProviderSlug =
  "website" | "google_trends" | "hacker_news" | "github" | "x" | "tavily" | "youtube" | "manual";

export type SourceMatrixSlug = ProviderSlug | "reddit" | "other";
export type SourceStatus = "LIVE" | "BETA" | "DEGRADED" | "LEGAL_REVIEW" | "PLANNED";
export type ProviderHealthStatus = "HEALTHY" | "DEGRADED" | "UNCONFIGURED" | "FAILED";
export type ProviderCapability =
  "CONTEXT" | "SEARCH" | "TIME_SERIES" | "METRICS" | "MANUAL_INGESTION";

export type ProviderRunStatus =
  | "SUCCESS"
  | "DEGRADED"
  | "UNAVAILABLE"
  | "FAILED"
  | "BUDGET_EXCEEDED"
  | "QUOTA_EXCEEDED"
  | "CIRCUIT_OPEN";

export type SignalMetrics = {
  views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  points?: number;
  stars?: number;
  forks?: number;
};

export type CanonicalSignal = {
  id: string;
  source: string;
  sourceId: string;
  url: string;
  title?: string;
  textExcerpt?: string;
  author?: {
    id?: string;
    handle?: string;
    displayName?: string;
    followerCount?: number;
  };
  publishedAt?: string;
  observedAt: string;
  language?: string;
  metrics: SignalMetrics;
  queryId: string;
  provenance: {
    provider: string;
    requestId?: string;
    retrievedAt: string;
    cached: boolean;
    rawPayloadHash?: string;
  };
};

export type MeasurementPoint = {
  at: string;
  value: number;
};

export type ProviderMeasurement = {
  id: string;
  source: ProviderSlug;
  provider: string;
  queryId: string;
  kind: "EXTERNAL_TIME_SERIES";
  label: string;
  points: MeasurementPoint[];
  unit?: "RELATIVE_INTEREST";
  requestId?: string;
};

export type ProviderQueryRole =
  | "product_context"
  | "search_demand"
  | "related_rising_query"
  | "developer_pain"
  | "launch_narrative"
  | "repository_adoption"
  | "issue_pain"
  | "release_activity"
  | "current_narrative"
  | "reply_opportunity"
  | "news_trigger"
  | "independent_verification"
  | "video_traction"
  | "content_format"
  | "manual_evidence";

export type ProviderQuery = {
  id: string;
  provider: ProviderSlug;
  role: ProviderQueryRole;
  query: string;
  limit: number;
  lookbackHours?: number;
  market?: string;
  language?: string;
};

export type QueryPlan = {
  version: "query-plan-v1";
  generatedAt: string;
  entries: ProviderQuery[];
};

export type ProductQueryContext = {
  category: string;
  pain: string;
  desiredOutcome: string;
  productTerminology: string[];
  buyerTerminology: string[];
  alternatives: string[];
  competitors: string[];
  adjacentNarratives: string[];
  credibleTopics: string[];
  triggerEvents: string[];
  repositories: string[];
};

export type ManualEvidenceInput = {
  url: string;
  sourceLabel: string;
  title: string;
  excerpt?: string;
  publishedAt?: string;
  visibleEngagement?: SignalMetrics;
  reason: string;
  reviewedBy: string;
};

export type ProviderRunRequest = {
  scanId: string;
  productUrl?: string;
  queries: ProviderQuery[];
  manualEvidence?: ManualEvidenceInput[];
  market?: string;
  language?: string;
};

export type ProviderEstimate = {
  calls: number;
  estimatedUsd: number;
  quotaUnits: number;
};

export type ProviderRunError = {
  code: string;
  message: string;
  retryable: boolean;
};

export type ProviderRunResult = {
  provider: ProviderSlug;
  status: ProviderRunStatus;
  signals: CanonicalSignal[];
  measurements: ProviderMeasurement[];
  calls: number;
  attempts?: number;
  quota: {
    used: number;
    limit?: number;
    breakdown?: Record<string, number>;
  };
  cost: {
    estimatedUsd: number;
    actualUsd?: number;
  };
  startedAt: string;
  finishedAt: string;
  limitations: string[];
  errors: ProviderRunError[];
};

export type ProviderHealthResult = {
  status: ProviderHealthStatus;
  checkedAt: string;
  message?: string;
  latencyMs?: number;
};

export type ProviderMetadata = {
  slug: ProviderSlug;
  publicName: string;
  declaredStatus: "LIVE" | "BETA";
  capabilities: ProviderCapability[];
  requiredEnvironmentVariables: string[];
  timeoutMs: number;
  retryPolicy: {
    maxAttempts: number;
    baseDelayMs: number;
    maxDelayMs: number;
  };
  maxCallsPerScan: number;
  maxResultsPerScan: number;
};

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type DnsAddress = { address: string; family: number };
export type DnsResolver = (hostname: string) => Promise<DnsAddress[]>;

export type WebsiteTransportRequest = {
  url: URL;
  addresses: readonly DnsAddress[];
  signal: AbortSignal;
  headers: Readonly<Record<string, string>>;
};

/**
 * A website-only transport that connects using an address set which has already
 * passed the SSRF policy. Unlike a general FetchLike, it must not resolve the
 * URL hostname again.
 */
export type WebsiteTransport = (request: WebsiteTransportRequest) => Promise<Response>;

export type ProviderExecutionContext = {
  credentialMode: CredentialMode;
  env: Readonly<Record<string, string | undefined>>;
  fetch: FetchLike;
  websiteTransport: WebsiteTransport;
  resolveDns: DnsResolver;
  now: () => Date;
  sleep: (milliseconds: number) => Promise<void>;
  /** Absolute boundary for the current provider attempt, when one is enforced. */
  deadline?: Date;
  /** Aborted when the current provider attempt may no longer perform side effects. */
  abortSignal?: AbortSignal;
};

export type ProviderAdapter = {
  metadata: ProviderMetadata;
  requestSchema: ZodType<ProviderRunRequest>;
  estimate: (request: ProviderRunRequest, context?: ProviderExecutionContext) => ProviderEstimate;
  collect: (
    request: ProviderRunRequest,
    context: ProviderExecutionContext,
  ) => Promise<ProviderRunResult>;
  healthCheck: (context: ProviderExecutionContext) => Promise<ProviderHealthResult>;
};

export type SourceStatusDefinition = {
  slug: SourceMatrixSlug;
  publicName: string;
  declaredStatus: SourceStatus;
  requiresVerifiedReadback: boolean;
};
