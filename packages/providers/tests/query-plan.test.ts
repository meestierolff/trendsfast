import { describe, expect, it } from "vitest";

import {
  PROVIDER_LIMITS,
  buildQueryPlan,
  validateQueryPlan,
  type ProductQueryContext,
} from "../src/index";

const context: ProductQueryContext = {
  category: "developer observability",
  pain: "small teams cannot tell which distribution opportunity is timely",
  desiredOutcome: "choose one evidence-backed distribution move",
  productTerminology: ["distribution intelligence", "next move"],
  buyerTerminology: ["technical founder", "developer tools"],
  alternatives: ["social listening", "trend dashboard"],
  competitors: ["Example Radar"],
  adjacentNarratives: ["founder-led distribution", "agent workflows"],
  credibleTopics: ["Google Trends", "launch research"],
  triggerEvents: ["new developer-tool launches"],
  repositories: ["trendsfast/trendsfast"],
};

describe("bounded query planning", () => {
  it("builds deterministic, provider-specific roles within every hard limit", () => {
    const options = {
      productUrl: "https://trendsfast.com",
      now: new Date("2026-08-11T08:00:00.000Z"),
      market: "US",
      language: "en",
    };

    const first = buildQueryPlan(context, options);
    const second = buildQueryPlan(context, options);

    expect(first).toEqual(second);
    expect(validateQueryPlan(first)).toEqual([]);

    for (const [provider, limits] of Object.entries(PROVIDER_LIMITS)) {
      const queries = first.entries.filter((entry) => entry.provider === provider);
      expect(queries.length).toBeLessThanOrEqual(limits.maxQueries);
      for (const query of queries) {
        expect(query.limit).toBeLessThanOrEqual(limits.maxResultsPerCall);
        expect(query.query.length).toBeLessThanOrEqual(180);
      }
    }

    expect(first.entries.filter((entry) => entry.provider === "google_trends")).toHaveLength(5);
    expect(first.entries.filter((entry) => entry.provider === "x")).toHaveLength(2);
    expect(first.entries.filter((entry) => entry.provider === "tavily")).toHaveLength(2);
    expect(first.entries.filter((entry) => entry.provider === "youtube")).toHaveLength(2);
    expect(first.entries.filter((entry) => entry.provider === "github")).toHaveLength(3);
    expect(first.entries.filter((entry) => entry.provider === "hacker_news")).toHaveLength(5);
  });

  it("does not broadcast an identical generic query to every provider", () => {
    const plan = buildQueryPlan(context, {
      productUrl: "https://trendsfast.com",
      now: new Date("2026-08-11T08:00:00.000Z"),
    });

    const byProvider = new Map<string, Set<string>>();
    for (const entry of plan.entries) {
      const queries = byProvider.get(entry.provider) ?? new Set<string>();
      queries.add(entry.query.toLocaleLowerCase("en"));
      byProvider.set(entry.provider, queries);
    }

    const providersForQuery = new Map<string, Set<string>>();
    for (const [provider, queries] of byProvider) {
      for (const query of queries) {
        const providers = providersForQuery.get(query) ?? new Set<string>();
        providers.add(provider);
        providersForQuery.set(query, providers);
      }
    }

    expect(Math.max(...[...providersForQuery.values()].map((providers) => providers.size))).toBe(1);
  });

  it("reports tampered plans instead of silently running unbounded work", () => {
    const plan = buildQueryPlan(context, {
      productUrl: "https://trendsfast.com",
      now: new Date("2026-08-11T08:00:00.000Z"),
    });
    plan.entries.push({
      id: "query_overflow",
      provider: "x",
      role: "current_narrative",
      query: "overflow",
      limit: 20,
      lookbackHours: 72,
    });

    expect(validateQueryPlan(plan)).toContain("x exceeds max queries per scan (2)");
  });
});
