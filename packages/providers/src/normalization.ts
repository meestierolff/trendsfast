import type { CanonicalSignal, ProviderMeasurement, ProviderQuery } from "./types";
import {
  cleanText,
  compactMetrics,
  finiteMetric,
  hashPayload,
  safeIsoDate,
  stableId,
} from "./util";

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value !== null && typeof value === "object" ? (value as UnknownRecord) : {};
}

function records(value: unknown): UnknownRecord[] {
  return Array.isArray(value) ? value.map(record) : [];
}

function requiredString(value: unknown, field: string): string {
  const output = cleanText(
    typeof value === "string" || typeof value === "number" || typeof value === "bigint"
      ? String(value)
      : value,
    2_000,
  );
  if (!output) throw new Error(`Provider payload is missing ${field}`);
  return output;
}

function optionalAuthor(value: unknown): CanonicalSignal["author"] | undefined {
  const input = record(value);
  const id = input.id === undefined ? undefined : String(input.id);
  const handle = cleanText(input.login ?? input.handle, 200);
  const displayName = cleanText(input.name ?? input.display_name, 300);
  if (!id && !handle && !displayName) return undefined;
  return {
    ...(id === undefined ? {} : { id }),
    ...(handle === undefined ? {} : { handle }),
    ...(displayName === undefined ? {} : { displayName }),
  };
}

export function normalizeHackerNewsHit(
  payload: unknown,
  queryId: string,
  observedAt: string,
  requestId?: string,
): CanonicalSignal {
  const hit = record(payload);
  const sourceId = requiredString(hit.objectID, "objectID");
  const title = cleanText(hit.title ?? hit.story_title, 500) ?? `Hacker News item ${sourceId}`;
  // Engagement belongs to the HN item, so its canonical evidence URL must be the HN discussion,
  // never the externally linked story URL.
  const url = `https://news.ycombinator.com/item?id=${encodeURIComponent(sourceId)}`;
  const author = cleanText(hit.author, 200);
  const publishedAt = safeIsoDate(hit.created_at);
  const textExcerpt = cleanText(hit.comment_text ?? hit.story_text, 2_000);
  return {
    id: stableId("sig", `hacker_news:${sourceId}`),
    source: "hacker_news",
    sourceId,
    url,
    title,
    ...(textExcerpt === undefined ? {} : { textExcerpt }),
    ...(author === undefined ? {} : { author: { handle: author } }),
    ...(publishedAt === undefined ? {} : { publishedAt }),
    observedAt,
    metrics: compactMetrics({
      points: finiteMetric(hit.points),
      comments: finiteMetric(hit.num_comments),
    }),
    queryId,
    provenance: {
      provider: "hn_algolia",
      ...(requestId === undefined ? {} : { requestId }),
      retrievedAt: observedAt,
      cached: false,
      rawPayloadHash: hashPayload(hit),
    },
  };
}

export function normalizeGitHubItem(
  payload: unknown,
  kind: "repository" | "issue" | "release",
  queryId: string,
  observedAt: string,
  requestId?: string,
): CanonicalSignal {
  const item = record(payload);
  const sourceId = requiredString(item.id, "id");
  const url = requiredString(item.html_url, "html_url");
  const titleValue =
    kind === "repository"
      ? (item.full_name ?? item.name)
      : kind === "release"
        ? (item.name ?? item.tag_name)
        : item.title;
  const title = cleanText(titleValue, 500) ?? `GitHub ${kind} ${sourceId}`;
  const textExcerpt = cleanText(kind === "repository" ? item.description : item.body, 2_000);
  const author = optionalAuthor(
    kind === "repository" ? item.owner : kind === "release" ? item.author : item.user,
  );
  const publishedAt = safeIsoDate(
    kind === "repository"
      ? (item.pushed_at ?? item.updated_at)
      : kind === "release"
        ? (item.published_at ?? item.created_at)
        : item.created_at,
  );
  return {
    id: stableId("sig", `github:${kind}:${sourceId}`),
    source: "github",
    sourceId: `${kind}:${sourceId}`,
    url,
    title,
    ...(textExcerpt === undefined ? {} : { textExcerpt }),
    ...(author === undefined ? {} : { author }),
    ...(publishedAt === undefined ? {} : { publishedAt }),
    observedAt,
    metrics:
      kind === "repository"
        ? compactMetrics({
            stars: finiteMetric(item.stargazers_count),
            forks: finiteMetric(item.forks_count),
            comments: finiteMetric(item.open_issues_count),
          })
        : kind === "issue"
          ? compactMetrics({ comments: finiteMetric(item.comments) })
          : {},
    queryId,
    provenance: {
      provider: "github_api",
      ...(requestId === undefined ? {} : { requestId }),
      retrievedAt: observedAt,
      cached: false,
      rawPayloadHash: hashPayload(item),
    },
  };
}

function xPostParts(rawUrl: string): { url: string; handle: string; statusId: string } | undefined {
  try {
    const url = new URL(rawUrl);
    const host = url.hostname.toLocaleLowerCase("en").replace(/^www\./, "");
    if (host !== "x.com" && host !== "twitter.com") return undefined;
    const match = /^\/([^/]+)\/status\/(\d+)(?:\/|$)/.exec(url.pathname);
    if (!match?.[1] || !match[2]) return undefined;
    url.hash = "";
    return { url: url.href, handle: match[1], statusId: match[2] };
  } catch {
    return undefined;
  }
}

const X_SNOWFLAKE_EPOCH_MS = 1_288_834_974_657n;

/**
 * X status IDs encode their creation millisecond in the upper Snowflake bits.
 * This is provider-origin metadata, not a generated metric. Invalid, future,
 * or non-representable IDs intentionally produce no publication timestamp.
 */
export function xStatusPublishedAt(statusId: string, retrievedAt: string): string | undefined {
  try {
    if (!/^\d{1,32}$/.test(statusId)) return undefined;
    const retrievedMs = new Date(retrievedAt).getTime();
    if (!Number.isFinite(retrievedMs)) return undefined;
    const timestampMs = Number((BigInt(statusId) >> 22n) + X_SNOWFLAKE_EPOCH_MS);
    if (
      !Number.isSafeInteger(timestampMs) ||
      timestampMs < Number(X_SNOWFLAKE_EPOCH_MS) ||
      timestampMs > retrievedMs
    ) {
      return undefined;
    }
    return new Date(timestampMs).toISOString();
  } catch {
    return undefined;
  }
}

function collectCitationObjects(payload: UnknownRecord): Array<{ url: string; title?: string }> {
  const candidates: unknown[] = [];
  if (Array.isArray(payload.citations)) candidates.push(...payload.citations);
  for (const output of records(payload.output)) {
    if (Array.isArray(output.citations)) candidates.push(...output.citations);
    for (const content of records(output.content)) {
      if (Array.isArray(content.annotations)) candidates.push(...content.annotations);
    }
  }
  return candidates.flatMap((candidate) => {
    if (typeof candidate === "string") return [{ url: candidate }];
    const item = record(candidate);
    const url = cleanText(item.url, 2_000);
    if (!url) return [];
    const title = cleanText(item.title, 500);
    return [{ url, ...(title === undefined ? {} : { title }) }];
  });
}

export type NormalizedXSearchResponse = {
  signals: CanonicalSignal[];
  requestId?: string;
  inputTokens?: number;
  outputTokens?: number;
  sourcesUsed?: number;
};

export function normalizeXaiXSearchResponse(
  payload: unknown,
  queryId: string,
  observedAt: string,
): NormalizedXSearchResponse {
  const response = record(payload);
  const requestId = cleanText(response.id, 200);
  const usage = record(response.usage);
  const seen = new Set<string>();
  const signals: CanonicalSignal[] = [];
  for (const citation of collectCitationObjects(response)) {
    const parts = xPostParts(citation.url);
    if (!parts || seen.has(parts.statusId)) continue;
    seen.add(parts.statusId);
    const publishedAt = xStatusPublishedAt(parts.statusId, observedAt);
    if (publishedAt === undefined) continue;
    signals.push({
      id: stableId("sig", `x:${parts.statusId}`),
      source: "x",
      sourceId: parts.statusId,
      url: parts.url,
      title: citation.title ?? `X post by @${parts.handle}`,
      author: { handle: parts.handle },
      publishedAt,
      observedAt,
      metrics: {},
      queryId,
      provenance: {
        provider: "xai_x_search",
        ...(requestId === undefined ? {} : { requestId }),
        retrievedAt: observedAt,
        cached: false,
        rawPayloadHash: hashPayload(citation),
      },
    });
  }
  const inputTokens = finiteMetric(usage.input_tokens);
  const outputTokens = finiteMetric(usage.output_tokens);
  const sourcesUsed = finiteMetric(usage.num_sources_used);
  return {
    signals,
    ...(requestId === undefined ? {} : { requestId }),
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
    ...(sourcesUsed === undefined ? {} : { sourcesUsed }),
  };
}

export function normalizeTavilyResult(
  payload: unknown,
  queryId: string,
  observedAt: string,
  requestId?: string,
): CanonicalSignal {
  const result = record(payload);
  const url = requiredString(result.url, "url");
  const title = cleanText(result.title, 500) ?? new URL(url).hostname;
  const textExcerpt = cleanText(result.content ?? result.raw_content, 2_000);
  const publishedAt = safeIsoDate(result.published_date ?? result.publishedAt);
  return {
    id: stableId("sig", `tavily:${url}`),
    source: "tavily",
    sourceId: stableId("web", url),
    url,
    title,
    ...(textExcerpt === undefined ? {} : { textExcerpt }),
    ...(publishedAt === undefined ? {} : { publishedAt }),
    observedAt,
    metrics: {},
    queryId,
    provenance: {
      provider: "tavily_search",
      ...(requestId === undefined ? {} : { requestId }),
      retrievedAt: observedAt,
      cached: false,
      rawPayloadHash: hashPayload(result),
    },
  };
}

export function normalizeYouTubeVideo(
  payload: unknown,
  queryId: string,
  observedAt: string,
  requestId?: string,
): CanonicalSignal {
  const video = record(payload);
  const sourceId = requiredString(video.id, "id");
  const snippet = record(video.snippet);
  const statistics = record(video.statistics);
  const title = cleanText(snippet.title, 500) ?? `YouTube video ${sourceId}`;
  const textExcerpt = cleanText(snippet.description, 2_000);
  const channelId = cleanText(snippet.channelId, 200);
  const channelTitle = cleanText(snippet.channelTitle, 300);
  const publishedAt = safeIsoDate(snippet.publishedAt);
  const author =
    channelId || channelTitle
      ? {
          ...(channelId === undefined ? {} : { id: channelId }),
          ...(channelTitle === undefined ? {} : { displayName: channelTitle }),
        }
      : undefined;
  return {
    id: stableId("sig", `youtube:${sourceId}`),
    source: "youtube",
    sourceId,
    url: `https://www.youtube.com/watch?v=${encodeURIComponent(sourceId)}`,
    title,
    ...(textExcerpt === undefined ? {} : { textExcerpt }),
    ...(author === undefined ? {} : { author }),
    ...(publishedAt === undefined ? {} : { publishedAt }),
    observedAt,
    metrics: compactMetrics({
      views: finiteMetric(statistics.viewCount),
      likes: finiteMetric(statistics.likeCount),
      comments: finiteMetric(statistics.commentCount),
    }),
    queryId,
    provenance: {
      provider: "youtube_data_api",
      ...(requestId === undefined ? {} : { requestId }),
      retrievedAt: observedAt,
      cached: false,
      rawPayloadHash: hashPayload(video),
    },
  };
}

type TrendsQuery = Pick<ProviderQuery, "id" | "query">;

export type NormalizedGoogleTrends = {
  signals: CanonicalSignal[];
  measurements: ProviderMeasurement[];
  actualCostUsd: number;
  requestIds: string[];
};

function graphPointValues(value: unknown): number[] {
  const values = Array.isArray(value) ? value : [value];
  return values.map(finiteMetric).filter((entry): entry is number => entry !== undefined);
}

export function normalizeDataForSeoGoogleTrends(
  payload: unknown,
  queries: TrendsQuery[],
  observedAt: string,
): NormalizedGoogleTrends {
  const response = record(payload);
  const tasks = records(response.tasks);
  const requestIds = tasks
    .map((task) => cleanText(task.id, 200))
    .filter((value): value is string => value !== undefined);
  const reportedTopLevelCost = finiteMetric(response.cost);
  const actualCostUsd =
    reportedTopLevelCost ?? tasks.reduce((sum, task) => sum + (finiteMetric(task.cost) ?? 0), 0);
  const signals: CanonicalSignal[] = [];
  const measurements: ProviderMeasurement[] = [];

  for (const task of tasks) {
    if (finiteMetric(task.status_code) !== 20_000) continue;
    const requestId = cleanText(task.id, 200);
    for (const result of records(task.result)) {
      const keywords = Array.isArray(result.keywords)
        ? result.keywords
            .map((keyword) => cleanText(keyword, 100))
            .filter((keyword): keyword is string => Boolean(keyword))
        : queries.map((query) => query.query);
      const checkUrl = cleanText(result.check_url, 2_000);
      const graph = records(result.items).find((item) => item.type === "google_trends_graph");
      if (!graph) continue;
      const data = records(graph.data);
      for (let index = 0; index < Math.min(keywords.length, queries.length); index += 1) {
        const keyword = keywords[index]!;
        const query = queries[index]!;
        const points = data.flatMap((point) => {
          if (point.missing_data === true) return [];
          const timestamp = finiteMetric(point.timestamp);
          const values = graphPointValues(point.values);
          const value = values[index] ?? values[0];
          if (timestamp === undefined || value === undefined) return [];
          return [{ at: new Date(timestamp * 1_000).toISOString(), value }];
        });
        if (points.length === 0) continue;
        // DataForSEO's provider-supplied check URL is the evidence boundary.
        // Never manufacture a Google Trends URL when the read-back omitted it:
        // a reconstructed URL cannot prove that the exact source was observed.
        if (!checkUrl || !/^https:\/\//i.test(checkUrl)) continue;
        const url = checkUrl;
        signals.push({
          id: stableId("sig", `google_trends:${query.id}:${keyword}`),
          source: "google_trends",
          sourceId: `${requestId ?? "request"}:${keyword}`,
          url,
          title: `Google Trends interest for “${keyword}”`,
          observedAt,
          metrics: {},
          queryId: query.id,
          provenance: {
            provider: "dataforseo_google_trends",
            ...(requestId === undefined ? {} : { requestId }),
            retrievedAt: observedAt,
            cached: false,
            rawPayloadHash: hashPayload({ keyword, points }),
          },
        });
        measurements.push({
          id: stableId("measure", `google_trends:${query.id}:${keyword}`),
          source: "google_trends",
          provider: "dataforseo_google_trends",
          queryId: query.id,
          kind: "EXTERNAL_TIME_SERIES",
          label: keyword,
          points,
          unit: "RELATIVE_INTEREST",
          ...(requestId === undefined ? {} : { requestId }),
        });
      }
    }
  }
  return { signals, measurements, actualCostUsd, requestIds };
}
