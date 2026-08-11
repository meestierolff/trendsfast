import type { CanonicalSignal, ProviderAdapter } from "../types";
import { ProviderRunRequestSchema } from "../request-schema";
import { PROVIDER_METADATA } from "../fixtures";
import { normalizeYouTubeVideo } from "../normalization";
import { hasRequiredCredentials } from "../runtime";
import { cleanText } from "../util";
import {
  boundedIntegerEnvironment,
  elapsedMilliseconds,
  fetchJson,
  providerResult,
  unconfiguredResult,
} from "./common";

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

type SearchReference = { queryId: string; searchSnippet: Record<string, unknown> };

export function createYouTubeAdapter(): ProviderAdapter {
  const metadata = PROVIDER_METADATA.youtube;
  return {
    metadata,
    requestSchema: ProviderRunRequestSchema,
    estimate: (request, context) => {
      const maximum = context
        ? boundedIntegerEnvironment(context, "YOUTUBE_MAX_SEARCHES_PER_SCAN", 2, 2)
        : 2;
      const searches = Math.min(
        maximum,
        request.queries.filter((query) => query.provider === "youtube").length,
      );
      return {
        calls: searches + (searches > 0 ? 1 : 0),
        estimatedUsd: 0,
        quotaUnits: searches + (searches > 0 ? 1 : 0),
      };
    },
    collect: async (request, context) => {
      const maximumSearches = boundedIntegerEnvironment(
        context,
        "YOUTUBE_MAX_SEARCHES_PER_SCAN",
        2,
        2,
      );
      const queries = request.queries
        .filter((query) => query.provider === "youtube")
        .slice(0, maximumSearches);
      if (!hasRequiredCredentials(metadata.requiredEnvironmentVariables, context)) {
        return unconfiguredResult("youtube", metadata.requiredEnvironmentVariables, context);
      }
      const startedAt = context.now().toISOString();
      const apiKey = context.env.YOUTUBE_API_KEY!.trim();
      const references = new Map<string, SearchReference>();
      for (const query of queries) {
        const url = new URL("https://www.googleapis.com/youtube/v3/search");
        url.searchParams.set("part", "snippet");
        url.searchParams.set("type", "video");
        url.searchParams.set("order", "date");
        url.searchParams.set("safeSearch", "moderate");
        url.searchParams.set("maxResults", String(Math.min(10, query.limit)));
        url.searchParams.set("q", query.query);
        url.searchParams.set("key", apiKey);
        if (query.language ?? request.language) {
          url.searchParams.set("relevanceLanguage", (query.language ?? request.language)!);
        }
        if (query.market ?? request.market) {
          url.searchParams.set("regionCode", (query.market ?? request.market)!);
        }
        if (query.lookbackHours) {
          url.searchParams.set(
            "publishedAfter",
            new Date(context.now().getTime() - query.lookbackHours * 3_600_000).toISOString(),
          );
        }
        const { data } = await fetchJson(context, url, { method: "GET" }, metadata.timeoutMs);
        const response = record(data);
        for (const rawItem of Array.isArray(response.items) ? response.items : []) {
          const item = record(rawItem);
          const id = record(item.id);
          const videoId = cleanText(id.videoId, 100);
          if (!videoId || references.has(videoId)) continue;
          references.set(videoId, { queryId: query.id, searchSnippet: record(item.snippet) });
        }
      }
      const ids = [...references.keys()].slice(0, 20);
      const signals: CanonicalSignal[] = [];
      if (ids.length > 0) {
        const url = new URL("https://www.googleapis.com/youtube/v3/videos");
        url.searchParams.set("part", "snippet,statistics");
        url.searchParams.set("id", ids.join(","));
        url.searchParams.set("key", apiKey);
        const { data, response } = await fetchJson(
          context,
          url,
          { method: "GET" },
          metadata.timeoutMs,
        );
        const payload = record(data);
        const requestId = response.headers.get("x-goog-request-id") ?? undefined;
        for (const rawVideo of Array.isArray(payload.items) ? payload.items : []) {
          const video = record(rawVideo);
          const videoId = cleanText(video.id, 100);
          if (!videoId) continue;
          const reference = references.get(videoId);
          if (!reference) continue;
          const snippet =
            Object.keys(record(video.snippet)).length > 0
              ? record(video.snippet)
              : reference.searchSnippet;
          signals.push(
            normalizeYouTubeVideo(
              { ...video, snippet },
              reference.queryId,
              context.now().toISOString(),
              requestId,
            ),
          );
        }
      }
      const calls = queries.length + (ids.length > 0 ? 1 : 0);
      const quotaUsed = queries.length + (ids.length > 0 ? 1 : 0);
      return providerResult({
        provider: "youtube",
        status: signals.length > 0 ? "SUCCESS" : "DEGRADED",
        signals: signals.slice(0, 20),
        calls,
        quotaUsed,
        quotaBreakdown: {
          searchQueries: queries.length,
          generalUnits: ids.length > 0 ? 1 : 0,
        },
        estimatedUsd: 0,
        actualUsd: 0,
        startedAt,
        finishedAt: context.now().toISOString(),
        limitations: [
          "Quota units are recorded separately from USD cost; no customer OAuth or private data is used.",
          "No transcripts or comment crawl are collected in v0.1.",
          ...(signals.length > 0 ? [] : ["YouTube returned no usable public videos."]),
        ],
      });
    },
    healthCheck: async (context) => {
      if (!hasRequiredCredentials(metadata.requiredEnvironmentVariables, context)) {
        return {
          status: "UNCONFIGURED",
          checkedAt: context.now().toISOString(),
          message: "YOUTUBE_API_KEY is required.",
        };
      }
      const started = context.now().getTime();
      try {
        const url = new URL("https://www.googleapis.com/youtube/v3/videos");
        url.searchParams.set("part", "id");
        url.searchParams.set("id", "dQw4w9WgXcQ");
        url.searchParams.set("key", context.env.YOUTUBE_API_KEY!.trim());
        await fetchJson(context, url, { method: "GET" }, metadata.timeoutMs);
        return {
          status: "HEALTHY",
          checkedAt: context.now().toISOString(),
          message: "YouTube public Data API read-back succeeded; source remains BETA.",
          latencyMs: elapsedMilliseconds(started, context),
        };
      } catch {
        return {
          status: "FAILED",
          checkedAt: context.now().toISOString(),
          message: "YouTube Data API read-back failed.",
          latencyMs: elapsedMilliseconds(started, context),
        };
      }
    },
  };
}
