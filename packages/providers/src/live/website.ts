import type { ProviderAdapter } from "../types";
import { ProviderRunRequestSchema } from "../request-schema";
import { PROVIDER_METADATA } from "../fixtures";
import { ProviderError } from "../executor";
import { WebsiteFetchError, extractWebsiteDocument, safeFetchWebsite } from "../website-security";
import { hashPayload, stableId } from "../util";
import { providerResult } from "./common";

export function createWebsiteAdapter(): ProviderAdapter {
  const metadata = PROVIDER_METADATA.website;
  return {
    metadata,
    requestSchema: ProviderRunRequestSchema,
    estimate: (request) => ({
      calls: request.productUrl ? 1 : 0,
      estimatedUsd: 0,
      quotaUnits: 0,
    }),
    collect: async (request, context) => {
      if (!request.productUrl) {
        throw new ProviderError("Website provider requires productUrl", {
          code: "WEBSITE_URL_REQUIRED",
          retryable: false,
        });
      }
      const startedAt = context.now().toISOString();
      try {
        const remainingDeadlineMs = context.deadline
          ? context.deadline.getTime() - context.now().getTime()
          : Number.POSITIVE_INFINITY;
        if (remainingDeadlineMs <= 0 || context.abortSignal?.aborted) {
          throw new ProviderError("Website request deadline was exhausted", {
            code: "PROVIDER_DEADLINE_EXCEEDED",
            retryable: false,
          });
        }
        const fetched = await safeFetchWebsite(request.productUrl, {
          resolve: context.resolveDns,
          transport: context.websiteTransport,
          limits: {
            timeoutMs: Math.max(0, Math.min(metadata.timeoutMs, remainingDeadlineMs)),
          },
          ...(context.abortSignal === undefined ? {} : { signal: context.abortSignal }),
        });
        const document = extractWebsiteDocument(fetched.url, fetched.html);
        const observedAt = context.now().toISOString();
        const queryId =
          request.queries.find((query) => query.provider === "website")?.id ??
          stableId("query", `${request.scanId}:website`);
        const signal = {
          id: stableId("sig", `website:${fetched.url}`),
          source: "website",
          sourceId: stableId("page", fetched.url),
          url: fetched.url,
          title: document.title,
          textExcerpt: document.text.slice(0, 2_000),
          observedAt,
          metrics: {},
          queryId,
          provenance: {
            provider: "website_fetch",
            requestId: stableId("req", `${request.scanId}:${fetched.url}:${observedAt}`),
            retrievedAt: observedAt,
            cached: false,
            rawPayloadHash: hashPayload({
              url: fetched.url,
              contentType: fetched.contentType,
              bytes: fetched.bytes,
              text: document.text,
            }),
          },
        };
        return providerResult({
          provider: "website",
          signals: [signal],
          calls: 1,
          quotaUsed: 0,
          estimatedUsd: 0,
          actualUsd: 0,
          startedAt,
          finishedAt: observedAt,
          limitations: [
            "Website content is sanitized plain text and remains explicitly untrusted input.",
          ],
        });
      } catch (error) {
        if (error instanceof WebsiteFetchError) {
          throw new ProviderError(error.message, {
            code: `WEBSITE_${error.code}`,
            retryable: error.retryable,
            cause: error,
          });
        }
        throw error;
      }
    },
    healthCheck: async (context) => ({
      status: "HEALTHY",
      checkedAt: context.now().toISOString(),
      message:
        "Website safety subsystem is ready; verification still requires a successful target URL read-back.",
    }),
  };
}
