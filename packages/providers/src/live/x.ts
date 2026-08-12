import type { CanonicalSignal, ProviderAdapter } from "../types";
import { ProviderRunRequestSchema } from "../request-schema";
import { PROVIDER_METADATA } from "../fixtures";
import { normalizeXaiXSearchResponse } from "../normalization";
import { hasRequiredCredentials } from "../runtime";
import { finiteMetric } from "../util";
import {
  boundedIntegerEnvironment,
  elapsedMilliseconds,
  fetchJson,
  requiredNonnegativeEnvironment,
  providerResult,
  unconfiguredResult,
} from "./common";

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export function createXAdapter(): ProviderAdapter {
  const metadata = PROVIDER_METADATA.x;
  return {
    metadata,
    requestSchema: ProviderRunRequestSchema,
    estimate: (request, context) => {
      const maximum = context
        ? boundedIntegerEnvironment(context, "XAI_MAX_TOOL_CALLS_PER_SCAN", 2, 2)
        : 2;
      const calls = Math.min(
        maximum,
        request.queries.filter((query) => query.provider === "x").length,
      );
      if (calls > 0 && !context) throw new Error("X Search estimation requires runtime costs");
      const configured = Boolean(context?.env.XAI_API_KEY?.trim() && context.env.XAI_MODEL?.trim());
      const perCall =
        context && calls > 0 && configured
          ? requiredNonnegativeEnvironment(context, "XAI_ESTIMATED_COST_USD_PER_SEARCH")
          : 0;
      return { calls, estimatedUsd: calls * perCall, quotaUnits: calls };
    },
    collect: async (request, context) => {
      const maximumSearches = boundedIntegerEnvironment(
        context,
        "XAI_MAX_TOOL_CALLS_PER_SCAN",
        2,
        2,
      );
      const queries = request.queries
        .filter((query) => query.provider === "x")
        .slice(0, maximumSearches);
      if (!hasRequiredCredentials(metadata.requiredEnvironmentVariables, context)) {
        return unconfiguredResult("x", metadata.requiredEnvironmentVariables, context);
      }
      const perCallEstimate = requiredNonnegativeEnvironment(
        context,
        "XAI_ESTIMATED_COST_USD_PER_SEARCH",
      );
      const estimatedUsd = queries.length * perCallEstimate;
      const startedAt = context.now().toISOString();
      const signals: CanonicalSignal[] = [];
      let actualCostUsd = 0;
      let actualCostKnown = true;
      let inputTokens = 0;
      let outputTokens = 0;
      for (const query of queries) {
        const toDate = context.now().toISOString().slice(0, 10);
        const fromDate = new Date(context.now().getTime() - (query.lookbackHours ?? 72) * 3_600_000)
          .toISOString()
          .slice(0, 10);
        const { data } = await fetchJson(
          context,
          "https://api.x.ai/v1/responses",
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${context.env.XAI_API_KEY!.trim()}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              model: context.env.XAI_MODEL!.trim(),
              input: [
                {
                  role: "user",
                  content: `Search X for current posts matching this bounded research query: ${query.query}. Return original post citations. Do not invent URLs or engagement metrics.`,
                },
              ],
              tools: [{ type: "x_search", from_date: fromDate, to_date: toDate }],
              max_tool_calls: 1,
              temperature: 0,
            }),
          },
          metadata.timeoutMs,
        );
        const normalized = normalizeXaiXSearchResponse(data, query.id, context.now().toISOString());
        signals.push(...normalized.signals);
        inputTokens += normalized.inputTokens ?? 0;
        outputTokens += normalized.outputTokens ?? 0;
        const response = record(data);
        const usage = record(response.usage);
        const reportedCost = finiteMetric(usage.cost_usd ?? usage.cost ?? response.cost_usd);
        if (reportedCost === undefined) actualCostKnown = false;
        else actualCostUsd += reportedCost;
      }
      const unique = [
        ...new Map(signals.map((signal) => [signal.sourceId, signal])).values(),
      ].slice(0, 20);
      return providerResult({
        provider: "x",
        status: unique.length > 0 ? "SUCCESS" : "DEGRADED",
        signals: unique,
        calls: queries.length,
        quotaUsed: queries.length,
        estimatedUsd,
        ...(actualCostKnown ? { actualUsd: actualCostUsd } : {}),
        startedAt,
        finishedAt: context.now().toISOString(),
        limitations: [
          "Only original X post citations are stored; model-written summaries are discarded as evidence.",
          `Token usage recorded: ${inputTokens} input and ${outputTokens} output tokens.`,
          ...(!actualCostKnown
            ? ["xAI did not return an actual USD cost; the bounded estimate is retained."]
            : []),
          ...(unique.length > 0 ? [] : ["X Search returned no usable original post citations."]),
        ],
      });
    },
    healthCheck: async (context) => {
      if (!hasRequiredCredentials(metadata.requiredEnvironmentVariables, context)) {
        return {
          status: "UNCONFIGURED",
          checkedAt: context.now().toISOString(),
          message: "XAI_API_KEY and XAI_MODEL are required.",
        };
      }
      const started = context.now().getTime();
      try {
        await fetchJson(
          context,
          "https://api.x.ai/v1/models",
          {
            method: "GET",
            headers: { authorization: `Bearer ${context.env.XAI_API_KEY!.trim()}` },
          },
          metadata.timeoutMs,
        );
        return {
          status: "HEALTHY",
          checkedAt: context.now().toISOString(),
          message: "xAI credential read-back succeeded; X Search remains BETA.",
          latencyMs: elapsedMilliseconds(started, context),
        };
      } catch {
        return {
          status: "FAILED",
          checkedAt: context.now().toISOString(),
          message: "xAI credential read-back failed.",
          latencyMs: elapsedMilliseconds(started, context),
        };
      }
    },
  };
}
