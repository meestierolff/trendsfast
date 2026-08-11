import type { CanonicalSignal, ProviderAdapter } from "../types";
import { ProviderRunRequestSchema } from "../request-schema";
import { PROVIDER_METADATA } from "../fixtures";
import { normalizeTavilyResult } from "../normalization";
import { hasRequiredCredentials } from "../runtime";
import { cleanText, finiteMetric } from "../util";
import {
  boundedIntegerEnvironment,
  elapsedMilliseconds,
  fetchJson,
  numericEnvironment,
  providerResult,
  unconfiguredResult,
} from "./common";

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export function createTavilyAdapter(): ProviderAdapter {
  const metadata = PROVIDER_METADATA.tavily;
  return {
    metadata,
    requestSchema: ProviderRunRequestSchema,
    estimate: (request, context) => {
      const maximum = context
        ? boundedIntegerEnvironment(context, "TAVILY_MAX_CREDITS_PER_SCAN", 2, 2)
        : 2;
      const calls = Math.min(
        maximum,
        request.queries.filter((query) => query.provider === "tavily").length,
      );
      const perCredit = context
        ? numericEnvironment(context, "TAVILY_ESTIMATED_COST_USD_PER_CREDIT", 0.01)
        : 0.01;
      return { calls, estimatedUsd: calls * perCredit, quotaUnits: calls };
    },
    collect: async (request, context) => {
      const maximumCredits = boundedIntegerEnvironment(
        context,
        "TAVILY_MAX_CREDITS_PER_SCAN",
        2,
        2,
      );
      const queries = request.queries
        .filter((query) => query.provider === "tavily")
        .slice(0, maximumCredits);
      const estimatedUsd =
        queries.length * numericEnvironment(context, "TAVILY_ESTIMATED_COST_USD_PER_CREDIT", 0.01);
      if (!hasRequiredCredentials(metadata.requiredEnvironmentVariables, context)) {
        return unconfiguredResult(
          "tavily",
          metadata.requiredEnvironmentVariables,
          context,
          estimatedUsd,
        );
      }
      const startedAt = context.now().toISOString();
      const signals: CanonicalSignal[] = [];
      let credits = 0;
      for (const query of queries) {
        const { data } = await fetchJson(
          context,
          "https://api.tavily.com/search",
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${context.env.TAVILY_API_KEY!.trim()}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              query: query.query,
              topic: query.role === "news_trigger" ? "news" : "general",
              search_depth: "basic",
              max_results: Math.min(10, query.limit),
              include_answer: false,
              include_raw_content: false,
            }),
          },
          metadata.timeoutMs,
        );
        const response = record(data);
        const requestId = cleanText(response.request_id, 200);
        const usage = record(response.usage);
        credits += finiteMetric(usage.credits ?? response.credits) ?? 1;
        const results = Array.isArray(response.results) ? response.results : [];
        signals.push(
          ...results.map((result) =>
            normalizeTavilyResult(result, query.id, context.now().toISOString(), requestId),
          ),
        );
      }
      const unique = [...new Map(signals.map((signal) => [signal.url, signal])).values()].slice(
        0,
        20,
      );
      return providerResult({
        provider: "tavily",
        status: unique.length > 0 ? "SUCCESS" : "DEGRADED",
        signals: unique,
        calls: queries.length,
        quotaUsed: credits,
        estimatedUsd,
        startedAt,
        finishedAt: context.now().toISOString(),
        limitations: [
          "Raw Tavily result records are used; answer generation is disabled.",
          "Tavily did not provide settled USD cost in the search response; estimated cost is retained.",
          ...(unique.length > 0 ? [] : ["Tavily returned no usable original URLs."]),
        ],
      });
    },
    healthCheck: async (context) => {
      if (!hasRequiredCredentials(metadata.requiredEnvironmentVariables, context)) {
        return {
          status: "UNCONFIGURED",
          checkedAt: context.now().toISOString(),
          message: "TAVILY_API_KEY is required.",
        };
      }
      const started = context.now().getTime();
      try {
        await fetchJson(
          context,
          "https://api.tavily.com/usage",
          {
            method: "GET",
            headers: {
              authorization: `Bearer ${context.env.TAVILY_API_KEY!.trim()}`,
            },
          },
          metadata.timeoutMs,
        );
        return {
          status: "HEALTHY",
          checkedAt: context.now().toISOString(),
          message: "Tavily credential and usage read-back succeeded; source remains BETA.",
          latencyMs: elapsedMilliseconds(started, context),
        };
      } catch {
        return {
          status: "FAILED",
          checkedAt: context.now().toISOString(),
          message: "Tavily read-back failed.",
          latencyMs: elapsedMilliseconds(started, context),
        };
      }
    },
  };
}
