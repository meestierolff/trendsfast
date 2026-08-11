import { describe, expect, it, vi } from "vitest";

import {
  buildQueryPlan,
  createLiveProviderRegistry,
  createLiveAdapters,
  createProviderContext,
  assertProviderContract,
  type ProductQueryContext,
} from "../src/index";

const context: ProductQueryContext = {
  category: "developer tools",
  pain: "distribution research takes hours",
  desiredOutcome: "choose one move",
  productTerminology: ["TrendsFast"],
  buyerTerminology: ["technical founders"],
  alternatives: ["trend dashboards"],
  competitors: [],
  adjacentNarratives: ["founder distribution"],
  credibleTopics: ["distribution research"],
  triggerEvents: ["developer tool launches"],
  repositories: ["trendsfast/trendsfast"],
};

describe("live adapter degradation", () => {
  it("all live adapters satisfy the bounded provider contract", () => {
    for (const adapter of createLiveAdapters()) {
      expect(assertProviderContract(adapter)).toEqual([]);
    }
  });

  it("returns honest unavailable results for optional providers with missing credentials", async () => {
    const registry = createLiveProviderRegistry();
    const fetch = vi.fn();
    const runtime = createProviderContext({ credentialMode: "byok", env: {}, fetch });
    const plan = buildQueryPlan(context, {
      productUrl: "https://trendsfast.com",
      now: new Date("2026-08-11T08:00:00.000Z"),
    });

    for (const slug of ["google_trends", "x", "tavily", "youtube"] as const) {
      const adapter = registry.get(slug)!;
      const result = await adapter.collect(
        {
          scanId: "scan_missing_keys",
          queries: plan.entries.filter((query) => query.provider === slug),
        },
        runtime,
      );
      expect(result.status).toBe("UNAVAILABLE");
      expect(result.errors[0]?.code).toBe("PROVIDER_UNCONFIGURED");
      expect(result.signals).toEqual([]);
      expect((await adapter.healthCheck(runtime)).status).toBe("UNCONFIGURED");
    }

    expect(fetch).not.toHaveBeenCalled();
  });
});
