import { Buffer } from "node:buffer";

import type { ProviderAdapter } from "../types";
import { ProviderRunRequestSchema } from "../request-schema";
import { PROVIDER_METADATA } from "../fixtures";
import { normalizeDataForSeoGoogleTrends } from "../normalization";
import { hasRequiredCredentials } from "../runtime";
import {
  elapsedMilliseconds,
  fetchJson,
  numericEnvironment,
  providerResult,
  unconfiguredResult,
} from "./common";

const LIVE_ENDPOINT = "https://api.dataforseo.com/v3/keywords_data/google_trends/explore/live";
const USER_DATA_ENDPOINT = "https://api.dataforseo.com/v3/appendix/user_data";

function authorization(login: string, password: string): string {
  return `Basic ${Buffer.from(`${login}:${password}`, "utf8").toString("base64")}`;
}

export function createGoogleTrendsAdapter(): ProviderAdapter {
  const metadata = PROVIDER_METADATA.google_trends;
  return {
    metadata,
    requestSchema: ProviderRunRequestSchema,
    estimate: (request, context) => {
      const hasQueries = request.queries.some((query) => query.provider === "google_trends");
      return {
        calls: hasQueries ? 1 : 0,
        estimatedUsd: hasQueries
          ? context
            ? numericEnvironment(context, "DATAFORSEO_ESTIMATED_COST_USD_PER_TASK", 0.01)
            : 0.01
          : 0,
        quotaUnits: hasQueries ? 1 : 0,
      };
    },
    collect: async (request, context) => {
      const queries = request.queries
        .filter((query) => query.provider === "google_trends")
        .slice(0, 5);
      const estimatedUsd =
        queries.length > 0
          ? numericEnvironment(context, "DATAFORSEO_ESTIMATED_COST_USD_PER_TASK", 0.01)
          : 0;
      if (!hasRequiredCredentials(metadata.requiredEnvironmentVariables, context)) {
        return unconfiguredResult(
          "google_trends",
          metadata.requiredEnvironmentVariables,
          context,
          estimatedUsd,
        );
      }
      if (queries.length === 0) {
        const timestamp = context.now().toISOString();
        return providerResult({
          provider: "google_trends",
          calls: 0,
          quotaUsed: 0,
          estimatedUsd: 0,
          actualUsd: 0,
          startedAt: timestamp,
          finishedAt: timestamp,
        });
      }
      const startedAt = context.now().toISOString();
      const login = context.env.DATAFORSEO_LOGIN!.trim();
      const password = context.env.DATAFORSEO_PASSWORD!.trim();
      const configuredMode = context.env.DATAFORSEO_GOOGLE_TRENDS_MODE?.trim() || "live";
      const language = request.language?.slice(0, 10) ?? queries[0]?.language?.slice(0, 10);
      const market = request.market ?? queries[0]?.market;
      const task = {
        keywords: queries.map((query) => query.query.slice(0, 100)),
        type: "web",
        time_range: "past_30_days",
        item_types: ["google_trends_graph"],
        tag: request.scanId.slice(0, 255),
        ...(language ? { language_code: language } : {}),
        ...(market && market.length > 2 ? { location_name: market } : {}),
      };
      const { data } = await fetchJson(
        context,
        LIVE_ENDPOINT,
        {
          method: "POST",
          headers: {
            authorization: authorization(login, password),
            "content-type": "application/json",
          },
          body: JSON.stringify([task]),
        },
        metadata.timeoutMs,
      );
      const normalized = normalizeDataForSeoGoogleTrends(
        data,
        queries,
        context.now().toISOString(),
      );
      return providerResult({
        provider: "google_trends",
        status: normalized.signals.length > 0 ? "SUCCESS" : "DEGRADED",
        signals: normalized.signals.slice(0, 10),
        measurements: normalized.measurements,
        calls: 1,
        quotaUsed: 1,
        estimatedUsd,
        actualUsd: normalized.actualCostUsd,
        startedAt,
        finishedAt: context.now().toISOString(),
        limitations: [
          "Google Trends values are relative interest (0-100), not absolute search volume.",
          "The single bounded graph task does not request related-rising-query lists in v0.1.",
          ...(configuredMode === "live"
            ? []
            : [
                "Standard queue mode is configured but this alpha adapter used the bounded live endpoint.",
              ]),
          ...(normalized.signals.length > 0 ? [] : ["Provider returned no usable graph series."]),
        ],
      });
    },
    healthCheck: async (context) => {
      if (!hasRequiredCredentials(metadata.requiredEnvironmentVariables, context)) {
        return {
          status: "UNCONFIGURED",
          checkedAt: context.now().toISOString(),
          message: "DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD are required.",
        };
      }
      const started = context.now().getTime();
      try {
        await fetchJson(
          context,
          USER_DATA_ENDPOINT,
          {
            method: "GET",
            headers: {
              authorization: authorization(
                context.env.DATAFORSEO_LOGIN!.trim(),
                context.env.DATAFORSEO_PASSWORD!.trim(),
              ),
            },
          },
          metadata.timeoutMs,
        );
        return {
          status: "DEGRADED",
          checkedAt: context.now().toISOString(),
          message:
            "DataForSEO credential read-back succeeded, but a paid Google Trends source read-back is still required before LIVE.",
          latencyMs: elapsedMilliseconds(started, context),
        };
      } catch {
        return {
          status: "FAILED",
          checkedAt: context.now().toISOString(),
          message: "DataForSEO credential read-back failed.",
          latencyMs: elapsedMilliseconds(started, context),
        };
      }
    },
  };
}
