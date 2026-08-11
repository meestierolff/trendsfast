import { describe, expect, it } from "vitest";

import {
  calculateDeterministicSignalFeatures,
  sourceSpecificRelativeEngagement,
  type ScoringSignal,
} from "../src/index";

function signal(overrides: Partial<ScoringSignal> = {}): ScoringSignal {
  return {
    id: "sig_x",
    source: "x",
    sourceId: "status-1",
    url: "https://x.com/founder/status/1",
    title: "Technical founders need evidence-backed distribution research",
    textExcerpt: "A current distribution intelligence workflow for founders.",
    publishedAt: "2026-08-11T06:00:00.000Z",
    observedAt: "2026-08-11T08:00:00.000Z",
    metrics: { views: 10_000, likes: 300, comments: 40, shares: 20 },
    queryId: "query_x",
    provenance: {
      provider: "xai_x_search",
      retrievedAt: "2026-08-11T08:00:00.000Z",
      cached: false,
    },
    ...overrides,
  };
}

describe("deterministic pre-model features", () => {
  it("calculates query, audience, product, independence and evidence completeness features", () => {
    const primary = signal();
    const manualCopy = signal({
      id: "sig_manual",
      source: "manual",
      sourceId: "manual-1",
      url: "https://twitter.com/founder/status/1?utm_source=copy",
      provenance: {
        provider: "MANUAL_FOUNDER_EVIDENCE",
        retrievedAt: "2026-08-11T08:00:00.000Z",
        cached: false,
      },
    });
    const features = calculateDeterministicSignalFeatures({
      signal: primary,
      peers: [manualCopy],
      query: "founder distribution research",
      audienceTerms: ["technical founders"],
      productTerms: ["distribution intelligence"],
      credibleTerms: ["evidence-backed distribution research"],
      historicalTopicTerms: ["generic social media calendar"],
      channelFit: 0.9,
      formatFit: 0.8,
      now: new Date("2026-08-11T08:00:00.000Z"),
    });

    expect(features.duplicateUrl).toBe(true);
    expect(features.independentSourceCount).toBe(1);
    expect(features.queryRelevance).toBeGreaterThan(0);
    expect(features.audienceRelevance).toBeGreaterThan(0);
    expect(features.productRelevance).toBeGreaterThan(0);
    expect(features.evidenceCompleteness).toBe(1);
    expect(features.channelFit).toBe(0.9);
  });

  it("normalizes engagement inside each source instead of comparing raw counts cross-platform", () => {
    const x = signal({ metrics: { views: 1_000, likes: 100, comments: 10 } });
    const github = signal({
      source: "github",
      url: "https://github.com/example/tool",
      metrics: { stars: 1_000, comments: 100, forks: 10 },
    });
    expect(sourceSpecificRelativeEngagement(x)).not.toBe(sourceSpecificRelativeEngagement(github));
  });
});
