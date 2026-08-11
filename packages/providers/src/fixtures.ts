import type {
  CanonicalSignal,
  ManualEvidenceInput,
  ProviderAdapter,
  ProviderExecutionContext,
  ProviderMeasurement,
  ProviderMetadata,
  ProviderQuery,
  ProviderRunRequest,
  ProviderRunResult,
  ProviderSlug,
  SignalMetrics,
} from "./types";
import { ProviderRunRequestSchema } from "./request-schema";
import { cleanText, compactMetrics, stableHash, stableId } from "./util";

const RETRY_POLICY = { maxAttempts: 2, baseDelayMs: 100, maxDelayMs: 500 } as const;

const METADATA: Record<ProviderSlug, ProviderMetadata> = {
  website: {
    slug: "website",
    publicName: "Product website",
    declaredStatus: "LIVE",
    capabilities: ["CONTEXT"],
    requiredEnvironmentVariables: [],
    timeoutMs: 8_000,
    retryPolicy: RETRY_POLICY,
    maxCallsPerScan: 1,
    maxResultsPerScan: 1,
  },
  google_trends: {
    slug: "google_trends",
    publicName: "Google Trends",
    declaredStatus: "LIVE",
    capabilities: ["SEARCH", "TIME_SERIES"],
    requiredEnvironmentVariables: ["DATAFORSEO_LOGIN", "DATAFORSEO_PASSWORD"],
    timeoutMs: 20_000,
    retryPolicy: RETRY_POLICY,
    maxCallsPerScan: 1,
    maxResultsPerScan: 10,
  },
  hacker_news: {
    slug: "hacker_news",
    publicName: "Hacker News",
    declaredStatus: "LIVE",
    capabilities: ["SEARCH", "METRICS"],
    requiredEnvironmentVariables: [],
    timeoutMs: 8_000,
    retryPolicy: RETRY_POLICY,
    maxCallsPerScan: 5,
    maxResultsPerScan: 30,
  },
  github: {
    slug: "github",
    publicName: "GitHub",
    declaredStatus: "LIVE",
    capabilities: ["SEARCH", "METRICS"],
    requiredEnvironmentVariables: [],
    timeoutMs: 8_000,
    retryPolicy: RETRY_POLICY,
    maxCallsPerScan: 3,
    maxResultsPerScan: 20,
  },
  x: {
    slug: "x",
    publicName: "X",
    declaredStatus: "BETA",
    capabilities: ["SEARCH", "METRICS"],
    requiredEnvironmentVariables: ["XAI_API_KEY", "XAI_MODEL"],
    timeoutMs: 20_000,
    retryPolicy: RETRY_POLICY,
    maxCallsPerScan: 2,
    maxResultsPerScan: 20,
  },
  tavily: {
    slug: "tavily",
    publicName: "Open web/news",
    declaredStatus: "BETA",
    capabilities: ["SEARCH"],
    requiredEnvironmentVariables: ["TAVILY_API_KEY"],
    timeoutMs: 10_000,
    retryPolicy: RETRY_POLICY,
    maxCallsPerScan: 2,
    maxResultsPerScan: 20,
  },
  youtube: {
    slug: "youtube",
    publicName: "YouTube",
    declaredStatus: "BETA",
    capabilities: ["SEARCH", "METRICS"],
    requiredEnvironmentVariables: ["YOUTUBE_API_KEY"],
    timeoutMs: 10_000,
    retryPolicy: RETRY_POLICY,
    maxCallsPerScan: 3,
    maxResultsPerScan: 20,
  },
  manual: {
    slug: "manual",
    publicName: "Manual founder evidence",
    declaredStatus: "LIVE",
    capabilities: ["MANUAL_INGESTION"],
    requiredEnvironmentVariables: [],
    timeoutMs: 1_000,
    retryPolicy: { maxAttempts: 1, baseDelayMs: 0, maxDelayMs: 0 },
    maxCallsPerScan: 0,
    maxResultsPerScan: 20,
  },
};

function fixtureUrl(source: ProviderSlug, token: string, productUrl?: string): string {
  switch (source) {
    case "website":
      return productUrl ?? "https://trendsfast.com";
    case "google_trends":
      return `https://trends.google.com/trends/explore?q=${encodeURIComponent(token)}`;
    case "hacker_news":
      return `https://news.ycombinator.com/item?id=${Number.parseInt(stableHash(token, 8), 16)}`;
    case "github":
      return `https://github.com/trendsfast/${stableHash(token, 10)}`;
    case "x":
      return `https://x.com/founder/status/${BigInt(`0x${stableHash(token, 15)}`)
        .toString()
        .slice(0, 19)}`;
    case "tavily":
      return `https://news.example.org/research/${stableHash(token, 12)}`;
    case "youtube":
      return `https://www.youtube.com/watch?v=${stableHash(token, 11)}`;
    case "manual":
      return `https://example.com/manual/${stableHash(token, 12)}`;
  }
}

function fixtureMetrics(source: ProviderSlug, index: number): SignalMetrics {
  switch (source) {
    case "hacker_news":
      return { points: 38 + index * 7, comments: 12 + index * 3 };
    case "github":
      return { stars: 340 + index * 41, forks: 31 + index * 4, comments: 7 + index };
    case "x":
      return {
        views: 8_400 + index * 1_100,
        likes: 126 + index * 13,
        comments: 24 + index * 2,
        shares: 19 + index,
      };
    case "youtube":
      return { views: 12_000 + index * 1_700, likes: 610 + index * 21, comments: 74 + index * 4 };
    default:
      return {};
  }
}

function makeSignal(
  source: ProviderSlug,
  query: ProviderQuery,
  index: number,
  request: ProviderRunRequest,
  context: ProviderExecutionContext,
): CanonicalSignal {
  const observedAt = context.now().toISOString();
  const seed = `${request.scanId}:${source}:${query.id}:${index}`;
  const fixtureHost = (() => {
    try {
      return new URL(request.productUrl ?? query.query).hostname.replace(/^www\./, "");
    } catch {
      return "fixture product";
    }
  })();
  const publishedAt = new Date(context.now().getTime() - (2 + index * 3) * 3_600_000).toISOString();
  const titles: Record<ProviderSlug, string> = {
    website: `${fixtureHost} — fixture product context`,
    google_trends: `Search interest is rising for “${query.query}”`,
    hacker_news: `Ask HN: how do technical founders validate ${query.query}?`,
    github: `Developers are adopting tools around ${query.query}`,
    x: `Founder discussion: ${query.query}`,
    tavily: `Current market trigger for ${query.query}`,
    youtube: `Practical walkthrough: ${query.query}`,
    manual: `Founder-reviewed evidence for ${query.query}`,
  };
  return {
    id: stableId("sig", seed),
    source,
    sourceId: `fixture-${stableHash(seed, 16)}`,
    url: fixtureUrl(source, seed, request.productUrl),
    title: titles[source],
    textExcerpt:
      source === "website"
        ? `${fixtureHost} is represented by deterministic, untrusted fixture website content for a complete local scan.`
        : `A realistic deterministic fixture showing a current ${query.role.replaceAll("_", " ")} signal related to ${query.query}.`,
    author: {
      id: `fixture-author-${source}`,
      handle: source === "x" ? "technicalfounder" : `fixture-${source}`,
      displayName: source === "x" ? "Technical Founder" : `${METADATA[source].publicName} fixture`,
    },
    ...(source === "website" || source === "google_trends" ? {} : { publishedAt }),
    observedAt,
    language: request.language ?? query.language ?? "en",
    metrics: compactMetrics(fixtureMetrics(source, index)),
    queryId: query.id,
    provenance: {
      provider: `fixture:${source}`,
      requestId: stableId("fixture_req", `${request.scanId}:${source}`),
      retrievedAt: observedAt,
      cached: true,
      rawPayloadHash: stableHash(seed, 64),
    },
  };
}

function manualSignal(
  evidence: ManualEvidenceInput,
  index: number,
  request: ProviderRunRequest,
  context: ProviderExecutionContext,
): CanonicalSignal {
  const observedAt = context.now().toISOString();
  const seed = `${request.scanId}:manual:${evidence.url}:${index}`;
  const textExcerpt = cleanText(evidence.excerpt, 2_000);
  return {
    id: stableId("sig", seed),
    source: "manual",
    sourceId: `manual-${stableHash(seed, 16)}`,
    url: evidence.url,
    title: evidence.title,
    ...(textExcerpt === undefined ? {} : { textExcerpt }),
    author: { displayName: evidence.reviewedBy },
    ...(evidence.publishedAt === undefined ? {} : { publishedAt: evidence.publishedAt }),
    observedAt,
    metrics: compactMetrics(evidence.visibleEngagement ?? {}),
    queryId: `manual:${request.scanId}`,
    provenance: {
      provider: "fixture:manual",
      requestId: stableId("fixture_req", `${request.scanId}:manual`),
      retrievedAt: observedAt,
      cached: true,
      rawPayloadHash: stableHash(seed, 64),
    },
  };
}

function fixtureResult(
  source: ProviderSlug,
  signals: CanonicalSignal[],
  measurements: ProviderMeasurement[],
  calls: number,
  context: ProviderExecutionContext,
): ProviderRunResult {
  const timestamp = context.now().toISOString();
  return {
    provider: source,
    status: "SUCCESS",
    signals: signals.slice(0, METADATA[source].maxResultsPerScan),
    measurements,
    calls,
    quota: { used: 0 },
    cost: { estimatedUsd: 0, actualUsd: 0 },
    startedAt: timestamp,
    finishedAt: timestamp,
    limitations: ["Deterministic fixture data; not live provider evidence."],
    errors: [],
  };
}

function fixtureAdapter(source: ProviderSlug): ProviderAdapter {
  return {
    metadata: METADATA[source],
    requestSchema: ProviderRunRequestSchema,
    estimate: () => ({ calls: 0, estimatedUsd: 0, quotaUnits: 0 }),
    collect: async (request, context) => {
      if (source === "manual") {
        const inputs = request.manualEvidence ?? [];
        return fixtureResult(
          source,
          inputs.map((input, index) => manualSignal(input, index, request, context)),
          [],
          0,
          context,
        );
      }
      const queries = request.queries.filter((query) => query.provider === source);
      const signals = queries.flatMap((query, queryIndex) => {
        const count = source === "website" || source === "google_trends" ? 1 : 2;
        return Array.from({ length: count }, (_, index) =>
          makeSignal(source, query, queryIndex * 2 + index, request, context),
        );
      });
      const measurements: ProviderMeasurement[] =
        source === "google_trends"
          ? queries.map((query, index) => ({
              id: stableId("measure", `${request.scanId}:${query.id}`),
              source: "google_trends",
              provider: "fixture:google_trends",
              queryId: query.id,
              kind: "EXTERNAL_TIME_SERIES",
              label: query.query,
              unit: "RELATIVE_INTEREST",
              points: [
                {
                  at: new Date(context.now().getTime() - 30 * 86_400_000).toISOString(),
                  value: 24 + index * 2,
                },
                {
                  at: new Date(context.now().getTime() - 7 * 86_400_000).toISOString(),
                  value: 39 + index * 2,
                },
                { at: context.now().toISOString(), value: 58 + index * 3 },
              ],
            }))
          : [];
      const calls =
        source === "google_trends"
          ? Math.min(1, queries.length)
          : source === "youtube"
            ? queries.length + (queries.length > 0 ? 1 : 0)
            : queries.length;
      return fixtureResult(source, signals, measurements, calls, context);
    },
    healthCheck: async (context) => ({
      status: "HEALTHY",
      checkedAt: context.now().toISOString(),
      message: "Fixture adapter is ready; no external read-back was performed.",
    }),
  };
}

export function createFixtureAdapters(): ProviderAdapter[] {
  return [
    fixtureAdapter("website"),
    fixtureAdapter("google_trends"),
    fixtureAdapter("hacker_news"),
    fixtureAdapter("github"),
    fixtureAdapter("x"),
    fixtureAdapter("tavily"),
    fixtureAdapter("youtube"),
    fixtureAdapter("manual"),
  ];
}

export function createFixtureProviderRegistry(): ReadonlyMap<ProviderSlug, ProviderAdapter> {
  return new Map(createFixtureAdapters().map((adapter) => [adapter.metadata.slug, adapter]));
}

export { METADATA as PROVIDER_METADATA };
