import type { ProviderAdapter } from "../types";
import { ProviderRunRequestSchema } from "../request-schema";
import { PROVIDER_METADATA } from "../fixtures";
import { normalizeHackerNewsHit } from "../normalization";
import { cleanText } from "../util";
import { elapsedMilliseconds, fetchJson, providerResult } from "./common";

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export function createHackerNewsAdapter(): ProviderAdapter {
  const metadata = PROVIDER_METADATA.hacker_news;
  return {
    metadata,
    requestSchema: ProviderRunRequestSchema,
    estimate: (request) => {
      const calls = Math.min(
        5,
        request.queries.filter((query) => query.provider === "hacker_news").length,
      );
      return { calls, estimatedUsd: 0, quotaUnits: calls };
    },
    collect: async (request, context) => {
      const started = context.now();
      const startedAt = started.toISOString();
      const queries = request.queries
        .filter((query) => query.provider === "hacker_news")
        .slice(0, 5);
      const signals = [];
      for (const query of queries) {
        const url = new URL("https://hn.algolia.com/api/v1/search_by_date");
        url.searchParams.set("query", query.query);
        url.searchParams.set("tags", "story");
        url.searchParams.set("hitsPerPage", String(Math.min(10, query.limit)));
        const cutoff = Math.floor(
          (context.now().getTime() - (query.lookbackHours ?? 168) * 3_600_000) / 1_000,
        );
        url.searchParams.set("numericFilters", `created_at_i>${cutoff}`);
        const { data, response } = await fetchJson(
          context,
          url,
          { method: "GET" },
          metadata.timeoutMs,
        );
        const payload = record(data);
        const hits = Array.isArray(payload.hits) ? payload.hits : [];
        const requestId = response.headers.get("x-request-id") ?? cleanText(payload.queryID, 200);
        signals.push(
          ...hits.map((hit) =>
            normalizeHackerNewsHit(
              hit,
              query.id,
              context.now().toISOString(),
              requestId ?? undefined,
            ),
          ),
        );
      }
      const unique = [
        ...new Map(signals.map((signal) => [signal.sourceId, signal])).values(),
      ].slice(0, 30);
      return providerResult({
        provider: "hacker_news",
        signals: unique,
        calls: queries.length,
        quotaUsed: queries.length,
        estimatedUsd: 0,
        actualUsd: 0,
        startedAt,
        finishedAt: context.now().toISOString(),
      });
    },
    healthCheck: async (context) => {
      const started = context.now().getTime();
      try {
        await fetchJson(
          context,
          "https://hn.algolia.com/api/v1/search?query=developer&tags=story&hitsPerPage=1",
          { method: "GET" },
          metadata.timeoutMs,
        );
        return {
          status: "HEALTHY",
          checkedAt: context.now().toISOString(),
          latencyMs: elapsedMilliseconds(started, context),
        };
      } catch {
        return {
          status: "FAILED",
          checkedAt: context.now().toISOString(),
          message: "Hacker News Algolia read-back failed.",
          latencyMs: elapsedMilliseconds(started, context),
        };
      }
    },
  };
}
