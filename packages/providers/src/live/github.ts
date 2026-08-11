import type { ProviderAdapter } from "../types";
import { ProviderRunRequestSchema } from "../request-schema";
import { PROVIDER_METADATA } from "../fixtures";
import { normalizeGitHubItem } from "../normalization";
import { elapsedMilliseconds, fetchJson, providerResult } from "./common";

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function headers(token: string | undefined): HeadersInit {
  return {
    accept: "application/vnd.github+json",
    "user-agent": "TrendsFast/0.1",
    "x-github-api-version": "2022-11-28",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
}

export function createGitHubAdapter(): ProviderAdapter {
  const metadata = PROVIDER_METADATA.github;
  return {
    metadata,
    requestSchema: ProviderRunRequestSchema,
    estimate: (request) => {
      const calls = Math.min(
        3,
        request.queries.filter((query) => query.provider === "github").length,
      );
      return { calls, estimatedUsd: 0, quotaUnits: calls };
    },
    collect: async (request, context) => {
      const startedAt = context.now().toISOString();
      const token = context.env.GITHUB_TOKEN?.trim();
      const queries = request.queries.filter((query) => query.provider === "github").slice(0, 3);
      const signals = [];
      let rateLimit = 0;
      let rateUsed = 0;
      for (const query of queries) {
        const repositoryMatch = /^([\w.-]+)\/([\w.-]+)$/.exec(query.query);
        const kind =
          query.role === "issue_pain"
            ? "issue"
            : query.role === "release_activity" && repositoryMatch
              ? "release"
              : "repository";
        const url =
          kind === "release"
            ? new URL(
                `https://api.github.com/repos/${encodeURIComponent(repositoryMatch![1]!)}/${encodeURIComponent(repositoryMatch![2]!)}/releases`,
              )
            : new URL(
                kind === "issue"
                  ? "https://api.github.com/search/issues"
                  : "https://api.github.com/search/repositories",
              );
        if (kind === "release") {
          url.searchParams.set("per_page", String(Math.min(10, query.limit)));
        } else {
          url.searchParams.set("q", query.query);
          url.searchParams.set("sort", kind === "issue" ? "created" : "updated");
          url.searchParams.set("order", "desc");
          url.searchParams.set("per_page", String(Math.min(10, query.limit)));
        }
        const { data, response } = await fetchJson(
          context,
          url,
          { method: "GET", headers: headers(token) },
          metadata.timeoutMs,
        );
        const payload = record(data);
        const items =
          kind === "release"
            ? Array.isArray(data)
              ? data
              : []
            : Array.isArray(payload.items)
              ? payload.items
              : [];
        const requestId = response.headers.get("x-github-request-id") ?? undefined;
        rateLimit = Math.max(rateLimit, Number(response.headers.get("x-ratelimit-limit")) || 0);
        rateUsed = Math.max(rateUsed, Number(response.headers.get("x-ratelimit-used")) || 0);
        signals.push(
          ...items.map((item) =>
            normalizeGitHubItem(item, kind, query.id, context.now().toISOString(), requestId),
          ),
        );
      }
      const unique = [
        ...new Map(signals.map((signal) => [signal.sourceId, signal])).values(),
      ].slice(0, 20);
      return providerResult({
        provider: "github",
        signals: unique,
        calls: queries.length,
        quotaUsed: rateUsed || queries.length,
        ...(rateLimit > 0 ? { quotaLimit: rateLimit } : {}),
        estimatedUsd: 0,
        actualUsd: 0,
        startedAt,
        finishedAt: context.now().toISOString(),
        limitations: token
          ? []
          : ["GitHub token is not configured; unauthenticated public rate limits apply."],
      });
    },
    healthCheck: async (context) => {
      const started = context.now().getTime();
      const token = context.env.GITHUB_TOKEN?.trim();
      try {
        await fetchJson(
          context,
          "https://api.github.com/rate_limit",
          { method: "GET", headers: headers(token) },
          metadata.timeoutMs,
        );
        return {
          status: "HEALTHY",
          checkedAt: context.now().toISOString(),
          message: token
            ? "Authenticated official API read-back succeeded."
            : "Unauthenticated official API read-back succeeded; rate limits are lower.",
          latencyMs: elapsedMilliseconds(started, context),
        };
      } catch {
        return {
          status: "FAILED",
          checkedAt: context.now().toISOString(),
          message: "GitHub official API read-back failed.",
          latencyMs: elapsedMilliseconds(started, context),
        };
      }
    },
  };
}
