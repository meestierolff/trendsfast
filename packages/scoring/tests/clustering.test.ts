import { describe, expect, it } from "vitest";

import {
  canonicalizeSignalUrl,
  clusterSignals,
  countIndependentSources,
  deduplicateSignals,
  sourceIndependenceKey,
  type ScoringSignal,
} from "../src/index";

function signal(
  overrides: Partial<ScoringSignal> & Pick<ScoringSignal, "id" | "source" | "url">,
): ScoringSignal {
  return {
    id: overrides.id,
    source: overrides.source,
    sourceId: overrides.sourceId ?? overrides.id,
    url: overrides.url,
    title: overrides.title ?? "Founders need evidence-backed distribution decisions",
    textExcerpt:
      overrides.textExcerpt ??
      "Technical founders spend hours researching current distribution opportunities.",
    publishedAt: overrides.publishedAt ?? "2026-08-11T06:00:00.000Z",
    observedAt: overrides.observedAt ?? "2026-08-11T08:00:00.000Z",
    metrics: overrides.metrics ?? {},
    queryId: overrides.queryId ?? "query_1",
    provenance: overrides.provenance ?? {
      provider: `fixture:${overrides.source}`,
      retrievedAt: "2026-08-11T08:00:00.000Z",
      cached: true,
    },
  };
}

describe("deterministic deduplication and clustering", () => {
  it("canonicalizes tracking variants without changing the evidence record", () => {
    expect(
      canonicalizeSignalUrl("HTTPS://Example.COM:443/path/?utm_source=x&b=2&a=1#section"),
    ).toBe("https://example.com/path?a=1&b=2");
  });

  it("deduplicates exact source IDs and canonical URLs, retaining the richer record", () => {
    const sparse = signal({
      id: "sig_sparse",
      source: "x",
      sourceId: "status-1",
      url: "https://x.com/founder/status/1?utm_source=feed",
      textExcerpt: "",
      metrics: {},
    });
    const rich = signal({
      id: "sig_rich",
      source: "manual",
      sourceId: "manual-1",
      url: "https://x.com/founder/status/1",
      textExcerpt: "A detailed discussion of evidence-backed founder distribution research.",
      metrics: { likes: 42, comments: 9 },
    });

    const result = deduplicateSignals([sparse, rich]);

    expect(result.signals).toHaveLength(1);
    expect(result.signals[0]?.id).toBe("sig_rich");
    expect(result.duplicateOf.get("sig_sparse")).toBe("sig_rich");
    expect(result.signals[0]?.url).toBe("https://x.com/founder/status/1");
  });

  it("clusters the same topic across sources and is stable across input order", () => {
    const x = signal({
      id: "sig_x",
      source: "x",
      url: "https://x.com/founder/status/2",
      title: "Technical founders need evidence-backed distribution decisions",
    });
    const hn = signal({
      id: "sig_hn",
      source: "hacker_news",
      url: "https://news.ycombinator.com/item?id=2",
      title: "Ask HN: evidence-backed distribution decisions for technical founders",
    });
    const unrelated = signal({
      id: "sig_video",
      source: "youtube",
      url: "https://youtube.com/watch?v=abcdefghijk",
      title: "PostgreSQL query planner internals",
      textExcerpt: "A deep technical database tutorial.",
    });

    const first = clusterSignals([x, hn, unrelated]);
    const second = clusterSignals([unrelated, hn, x]);

    expect(first).toEqual(second);
    expect(first).toHaveLength(2);
    const topic = first.find((cluster) => cluster.memberIds.includes("sig_x"));
    expect(topic?.memberIds).toEqual(["sig_hn", "sig_x"]);
    expect(topic?.independentSourceCount).toBe(2);
  });

  it("does not mistake a manual copy of an X URL for an independent source", () => {
    const native = signal({
      id: "sig_native",
      source: "x",
      url: "https://x.com/founder/status/3",
    });
    const manual = signal({
      id: "sig_manual",
      source: "manual",
      url: "https://twitter.com/founder/status/3",
    });

    expect(sourceIndependenceKey(native)).toBe("platform:x");
    expect(sourceIndependenceKey(manual)).toBe("platform:x");
    expect(countIndependentSources([native, manual])).toBe(1);
  });
});
