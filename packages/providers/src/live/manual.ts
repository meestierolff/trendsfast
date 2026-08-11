import type { CanonicalSignal, ProviderAdapter } from "../types";
import { ProviderRunRequestSchema } from "../request-schema";
import { PROVIDER_METADATA } from "../fixtures";
import { cleanText, compactMetrics, hashPayload, safeIsoDate, stableId } from "../util";
import { validatePublicHttpUrl } from "../website-security";
import { providerResult } from "./common";

export function createManualEvidenceAdapter(): ProviderAdapter {
  const metadata = PROVIDER_METADATA.manual;
  return {
    metadata,
    requestSchema: ProviderRunRequestSchema,
    estimate: () => ({ calls: 0, estimatedUsd: 0, quotaUnits: 0 }),
    collect: async (request, context) => {
      const startedAt = context.now().toISOString();
      const signals: CanonicalSignal[] = [];
      for (const [index, evidence] of (request.manualEvidence ?? []).slice(0, 20).entries()) {
        const url = (await validatePublicHttpUrl(evidence.url, context.resolveDns)).url.href;
        const observedAt = context.now().toISOString();
        const textExcerpt = cleanText(evidence.excerpt, 2_000);
        const publishedAt = safeIsoDate(evidence.publishedAt);
        signals.push({
          id: stableId("sig", `manual:${request.scanId}:${url}:${index}`),
          source: "manual",
          sourceId: stableId("manual", `${request.scanId}:${url}:${index}`),
          url,
          title: cleanText(evidence.title, 500) ?? new URL(url).hostname,
          ...(textExcerpt === undefined ? {} : { textExcerpt }),
          author: { displayName: evidence.reviewedBy },
          ...(publishedAt === undefined ? {} : { publishedAt }),
          observedAt,
          metrics: compactMetrics(evidence.visibleEngagement ?? {}),
          queryId: `manual:${request.scanId}`,
          provenance: {
            provider: "MANUAL_FOUNDER_EVIDENCE",
            requestId: stableId("manual_review", `${request.scanId}:${evidence.reviewedBy}`),
            retrievedAt: observedAt,
            cached: false,
            rawPayloadHash: hashPayload({
              url,
              title: evidence.title,
              excerpt: evidence.excerpt,
              reason: evidence.reason,
              reviewedBy: evidence.reviewedBy,
            }),
          },
        });
      }
      return providerResult({
        provider: "manual",
        signals,
        calls: 0,
        quotaUsed: 0,
        estimatedUsd: 0,
        actualUsd: 0,
        startedAt,
        finishedAt: context.now().toISOString(),
        limitations: [
          "Evidence was entered and reviewed manually; visible metrics were not fetched.",
        ],
      });
    },
    healthCheck: async (context) => ({
      status: "HEALTHY",
      checkedAt: context.now().toISOString(),
      message: "Manual founder evidence path is available.",
    }),
  };
}
