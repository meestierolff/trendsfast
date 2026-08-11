import { describe, expect, it } from "vitest";

import {
  SOURCE_STATUS_MATRIX,
  assertProviderContract,
  validateProviderRunResult,
  buildQueryPlan,
  createFixtureAdapters,
  createProviderContext,
  resolveSourceStatus,
  type ProductQueryContext,
} from "../src/index";

const context: ProductQueryContext = {
  category: "AI developer tools",
  pain: "distribution research is fragmented",
  desiredOutcome: "find one credible next move",
  productTerminology: ["TrendsFast", "distribution intelligence"],
  buyerTerminology: ["technical founders"],
  alternatives: ["social listening"],
  competitors: ["generic trend dashboards"],
  adjacentNarratives: ["founder-led growth"],
  credibleTopics: ["evidence-backed distribution"],
  triggerEvents: ["new AI tool launches"],
  repositories: ["trendsfast/trendsfast"],
};

describe("fixture provider contract", () => {
  it("has one deterministic adapter for every launch source", async () => {
    const adapters = createFixtureAdapters();
    expect(adapters.map((adapter) => adapter.metadata.slug)).toEqual([
      "website",
      "google_trends",
      "hacker_news",
      "github",
      "x",
      "tavily",
      "youtube",
      "manual",
    ]);

    const plan = buildQueryPlan(context, {
      productUrl: "https://trendsfast.com",
      now: new Date("2026-08-11T08:00:00.000Z"),
    });
    const runtime = createProviderContext({
      credentialMode: "fixture",
      now: () => new Date("2026-08-11T08:00:00.000Z"),
    });

    for (const adapter of adapters) {
      expect(assertProviderContract(adapter)).toEqual([]);
      const queries = plan.entries.filter((entry) => entry.provider === adapter.metadata.slug);
      const request = {
        scanId: "scan_fixture_contract",
        productUrl: "https://trendsfast.com",
        queries,
        ...(adapter.metadata.slug === "manual"
          ? {
              manualEvidence: [
                {
                  url: "https://example.com/founder-note",
                  sourceLabel: "Founder note",
                  title: "A relevant founder discussion",
                  excerpt: "Founders are looking for evidence-backed distribution decisions.",
                  reason: "Direct evidence of the target pain.",
                  reviewedBy: "founder",
                },
              ],
            }
          : {}),
      };

      const first = await adapter.collect(request, runtime);
      const second = await adapter.collect(request, runtime);

      expect(first).toEqual(second);
      expect(validateProviderRunResult(adapter, first)).toEqual([]);
      expect(first.status).toBe("SUCCESS");
      expect(first.signals.length).toBeGreaterThan(0);
      expect(first.signals.length).toBeLessThanOrEqual(adapter.metadata.maxResultsPerScan);
      expect(first.cost.actualUsd).toBe(0);
      expect(first.cost.estimatedUsd).toBe(0);
      expect(first.calls).toBeLessThanOrEqual(adapter.metadata.maxCallsPerScan);

      for (const signal of first.signals) {
        expect(signal.source).toBe(adapter.metadata.slug);
        expect(signal.queryId).toBeTruthy();
        expect(new URL(signal.url).protocol).toMatch(/^https?:$/);
        expect(signal.provenance.provider).toBe(`fixture:${adapter.metadata.slug}`);
        expect(signal.provenance.cached).toBe(true);
      }
    }
  });

  it("keeps declared lifecycle status separate from verified runtime health", () => {
    expect(SOURCE_STATUS_MATRIX.reddit.declaredStatus).toBe("LEGAL_REVIEW");
    expect(resolveSourceStatus(SOURCE_STATUS_MATRIX.google_trends, "UNCONFIGURED")).toBe(
      "DEGRADED",
    );
    expect(resolveSourceStatus(SOURCE_STATUS_MATRIX.google_trends, "HEALTHY")).toBe("LIVE");
    expect(resolveSourceStatus(SOURCE_STATUS_MATRIX.x, "HEALTHY")).toBe("BETA");
    expect(resolveSourceStatus(SOURCE_STATUS_MATRIX.youtube, "FAILED")).toBe("DEGRADED");
    expect(
      resolveSourceStatus(SOURCE_STATUS_MATRIX.google_trends, "HEALTHY", {
        credentialMode: "fixture",
      }),
    ).toBe("DEGRADED");
    expect(
      resolveSourceStatus(SOURCE_STATUS_MATRIX.manual, "HEALTHY", {
        credentialMode: "fixture",
      }),
    ).toBe("LIVE");
  });

  it("does not reuse TrendsFast website context for another fixture product", async () => {
    const website = createFixtureAdapters().find((adapter) => adapter.metadata.slug === "website")!;
    const runtime = createProviderContext({
      credentialMode: "fixture",
      now: () => new Date("2026-08-11T08:00:00.000Z"),
    });
    const first = await website.collect(
      {
        scanId: "scan_trendsfast",
        productUrl: "https://trendsfast.com",
        queries: [
          {
            id: "query_trendsfast",
            provider: "website",
            role: "product_context",
            query: "https://trendsfast.com",
            limit: 1,
          },
        ],
      },
      runtime,
    );
    const second = await website.collect(
      {
        scanId: "scan_halio",
        productUrl: "https://halio.nl",
        queries: [
          {
            id: "query_halio",
            provider: "website",
            role: "product_context",
            query: "https://halio.nl",
            limit: 1,
          },
        ],
      },
      runtime,
    );
    expect(first.signals[0]?.title).not.toBe(second.signals[0]?.title);
    expect(second.signals[0]?.textExcerpt).toContain("halio.nl");
  });
});
