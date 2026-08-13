import type { ProviderAdapter } from "../types";
import { ProviderRunRequestSchema } from "../request-schema";
import { PROVIDER_METADATA } from "../fixtures";
import { ProviderError } from "../executor";
import {
  WebsiteFetchError,
  extractSameOriginContextLinks,
  extractWebsiteDocument,
  safeFetchWebsite,
} from "../website-security";
import { hashPayload, stableId } from "../util";
import { providerResult } from "./common";

export function createWebsiteAdapter(): ProviderAdapter {
  const metadata = PROVIDER_METADATA.website;
  return {
    metadata,
    requestSchema: ProviderRunRequestSchema,
    estimate: (request) => ({
      calls: request.productUrl ? metadata.maxCallsPerScan : 0,
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
        const queryId =
          request.queries.find((query) => query.provider === "website")?.id ??
          stableId("query", `${request.scanId}:website`);
        const maximumPages = metadata.maxCallsPerScan;
        const maximumTotalBytes = 1_500_000;
        const maximumPageBytes = 500_000;
        const requested = new URL(request.productUrl);
        requested.hash = "";
        const queue: string[] = [requested.href];
        const queued = new Set(queue);
        const visited = new Set<string>();
        const signals = [];
        const limitations: string[] = [];
        let calls = 0;
        let totalBytes = 0;
        const acceptedOrigin = requested.origin;

        const enqueue = (url: string): void => {
          if (queued.has(url) || visited.has(url) || queue.length + visited.size >= 30) return;
          queued.add(url);
          queue.push(url);
        };

        while (queue.length > 0 && calls < maximumPages && totalBytes < maximumTotalBytes) {
          const pageRemainingDeadlineMs = context.deadline
            ? context.deadline.getTime() - context.now().getTime()
            : Number.POSITIVE_INFINITY;
          if (pageRemainingDeadlineMs <= 0 || context.abortSignal?.aborted) {
            throw new ProviderError("Website request deadline was exhausted", {
              code: "PROVIDER_DEADLINE_EXCEEDED",
              retryable: false,
            });
          }
          const candidate = queue.shift()!;
          queued.delete(candidate);
          if (visited.has(candidate)) continue;
          visited.add(candidate);
          calls += 1;
          try {
            const fetched = await safeFetchWebsite(candidate, {
              resolve: context.resolveDns,
              transport: context.websiteTransport,
              limits: {
                timeoutMs: Math.max(0, Math.min(metadata.timeoutMs, pageRemainingDeadlineMs)),
                maxBytes: Math.min(maximumPageBytes, maximumTotalBytes - totalBytes),
              },
              allowedOrigin: acceptedOrigin,
              ...(context.abortSignal === undefined ? {} : { signal: context.abortSignal }),
            });
            const fetchedUrl = new URL(fetched.url);
            if (signals.length === 0) {
              const homepage = new URL("/", fetchedUrl);
              if (homepage.href !== fetchedUrl.href) enqueue(homepage.href);
            } else if (fetchedUrl.origin !== acceptedOrigin) {
              limitations.push("A context page redirected off origin and was excluded.");
              continue;
            }
            totalBytes += fetched.bytes;
            const document = extractWebsiteDocument(fetched.url, fetched.html);
            const observedAt = context.now().toISOString();
            const structuredExcerpt = [
              document.description ? `Description: ${document.description}` : "",
              document.openGraph.length > 0 ? `Open Graph: ${document.openGraph.join(" | ")}` : "",
              document.structuredData.length > 0
                ? `Structured data: ${document.structuredData.join(" | ")}`
                : "",
              document.headings.length > 0 ? `Headings: ${document.headings.join(" | ")}` : "",
              document.primaryCtas.length > 0
                ? `Primary CTAs: ${document.primaryCtas.join(" | ")}`
                : "",
              document.faqPrompts.length > 0
                ? `FAQ prompts: ${document.faqPrompts.join(" | ")}`
                : "",
              `Page text: ${document.text}`,
            ]
              .filter(Boolean)
              .join("\n")
              .slice(0, 4_000);
            signals.push({
              id: stableId("sig", `website:${fetched.url}`),
              source: "website" as const,
              sourceId: stableId("page", fetched.url),
              url: fetched.url,
              title: document.title,
              textExcerpt: structuredExcerpt,
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
            });
            for (const link of extractSameOriginContextLinks(fetched.url, fetched.html)) {
              if (new URL(link).origin === acceptedOrigin) enqueue(link);
            }
            if (signals.length === 1 && acceptedOrigin) {
              for (const path of [
                "/features",
                "/product",
                "/pricing",
                "/use-cases",
                "/about",
                "/docs",
              ]) {
                enqueue(new URL(path, acceptedOrigin).href);
              }
            }
          } catch (error) {
            if (signals.length === 0) throw error;
            limitations.push(
              error instanceof WebsiteFetchError
                ? `A bounded context page was skipped (${error.code}).`
                : "A bounded context page was skipped after a network failure.",
            );
          }
        }
        const observedAt = context.now().toISOString();
        return providerResult({
          provider: "website",
          signals,
          calls,
          quotaUsed: 0,
          estimatedUsd: 0,
          actualUsd: 0,
          startedAt,
          finishedAt: observedAt,
          limitations: [
            "Website content is sanitized plain text and remains explicitly untrusted input.",
            `Read ${signals.length} same-origin page(s) within a ${maximumPages}-page and ${maximumTotalBytes}-byte context bound.`,
            ...[...new Set(limitations)],
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
