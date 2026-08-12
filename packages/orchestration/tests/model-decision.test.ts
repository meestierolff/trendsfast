import { describe, expect, it } from "vitest";
import type { ProjectContext, Signal } from "@trendsfast/schemas";

import { createModelAssistedDecision } from "../src/model-decision";

const context: ProjectContext = {
  name: "Example",
  url: "https://example.com",
  category: "distribution research tool",
  audience: "technical founders building developer tools",
  problem: "founders spend hours on distribution research",
  desiredOutcome: "choose an evidence-backed distribution action",
  credibleClaims: ["evidence receipts"],
  alternatives: ["manual research"],
  competitors: [],
  markets: ["US"],
  language: "en",
  suitableChannels: ["hacker_news", "x"],
  availableFormats: ["founder_text"],
  credibleTopics: ["distribution research", "developer distribution"],
  assumptions: [],
};

function signal(id: string, source: Signal["source"], url: string): Signal {
  return {
    id,
    source,
    sourceId: id,
    url,
    title: "Technical founders discuss evidence backed distribution research",
    textExcerpt:
      "Technical founders building developer tools discuss a distribution research tool because founders spend hours on distribution research and want to choose an evidence-backed distribution action with evidence receipts for developer distribution.",
    observedAt: "2026-08-11T12:00:00.000Z",
    publishedAt: "2026-08-11T09:00:00.000Z",
    language: "en",
    metrics: source === "hacker_news" ? { points: 90, comments: 35 } : { stars: 500 },
    queryId: `query_${source}`,
    provenance: {
      provider: `fixture:${source}`,
      retrievedAt: "2026-08-11T12:00:00.000Z",
      cached: true,
    },
  };
}

function proposal(action: "PUBLISH" | "REPLY" | "REMIX" | "WAIT", evidenceSignalIds: string[]) {
  return {
    action,
    channel: "model_selected_channel",
    topic: "Refined topic prose",
    angle: "Refined angle prose.",
    format: "model_selected_format",
    hook: "Refined hook prose.",
    outline: ["Refined outline prose."],
    cta: "Refined CTA prose.",
    whyNowSummary: "Refined why-now prose.",
    limitations: ["Refined limitation prose."],
    confidenceRationale: "Refined confidence rationale.",
    confidence: 1,
    priority: 100,
    validUntil: "2026-08-31T00:00:00.000Z",
    evidenceSignalIds,
  };
}

describe("model-assisted decision", () => {
  it("does not let synthesis override a deterministic WAIT quality-floor result", async () => {
    const decide = createModelAssistedDecision({
      async generate() {
        return JSON.stringify(proposal("PUBLISH", ["sig_hn"]));
      },
    });
    const result = await decide({
      context,
      signals: [signal("sig_hn", "hacker_news", "https://news.ycombinator.com/item?id=1")],
      measurements: [],
      coverage: { website: "FAILED", google_trends: "FAILED", hacker_news: "SUCCEEDED" },
      now: new Date("2026-08-11T12:00:00.000Z"),
    });

    expect(result.move.action).toBe("WAIT");
    expect(result.move.priority).toBe(0);
    expect(result.evidenceSignalIds).toEqual(["sig_hn"]);
    expect(result.independentSourceCount).toBe(1);
    expect(result.promptVersion).toBe("deterministic-ranking-v2");
    expect(result.limitations).toContain(
      "Model synthesis was unavailable or failed validation; deterministic output was retained.",
    );
  });

  it("retains evidence and source count when a WAIT synthesis drops its held evidence", async () => {
    const decide = createModelAssistedDecision({
      async generate() {
        return JSON.stringify(proposal("WAIT", []));
      },
    });
    const result = await decide({
      context,
      signals: [signal("sig_hn", "hacker_news", "https://news.ycombinator.com/item?id=1")],
      measurements: [],
      coverage: { website: "FAILED", google_trends: "FAILED", hacker_news: "SUCCEEDED" },
      now: new Date("2026-08-11T12:00:00.000Z"),
    });

    expect(result.move.action).toBe("WAIT");
    expect(result.evidenceSignalIds).toEqual(["sig_hn"]);
    expect(result.independentSourceCount).toBe(1);
    expect(result.promptVersion).toBe("deterministic-ranking-v2");
  });

  it("rejects an actionable synthesis that drops deterministic evidence", async () => {
    const decide = createModelAssistedDecision({
      async generate() {
        return JSON.stringify(proposal("PUBLISH", ["sig_hn"]));
      },
    });
    const result = await decide({
      context,
      signals: [
        signal("sig_hn", "hacker_news", "https://news.ycombinator.com/item?id=1"),
        signal("sig_gh", "github", "https://github.com/example/research"),
      ],
      measurements: [],
      coverage: {
        website: "SUCCEEDED",
        google_trends: "SUCCEEDED",
        hacker_news: "SUCCEEDED",
        github: "SUCCEEDED",
      },
      now: new Date("2026-08-11T12:00:00.000Z"),
    });

    expect(result.move.action).toBe("PUBLISH");
    expect(result.evidenceSignalIds).toEqual(["sig_gh", "sig_hn"]);
    expect(result.independentSourceCount).toBe(2);
    expect(result.promptVersion).toBe("deterministic-ranking-v2");
  });

  it("accepts prose refinements but keeps deterministic categorical fields", async () => {
    const decide = createModelAssistedDecision({
      async generate() {
        return JSON.stringify(proposal("PUBLISH", ["sig_gh", "sig_hn"]));
      },
    });
    const result = await decide({
      context,
      signals: [
        signal("sig_hn", "hacker_news", "https://news.ycombinator.com/item?id=1"),
        signal("sig_gh", "github", "https://github.com/example/research"),
      ],
      measurements: [],
      coverage: {
        website: "SUCCEEDED",
        google_trends: "SUCCEEDED",
        hacker_news: "SUCCEEDED",
        github: "SUCCEEDED",
      },
      now: new Date("2026-08-11T12:00:00.000Z"),
    });

    expect(result.move).toMatchObject({
      action: "PUBLISH",
      channel: "hacker_news",
      format: "founder_text",
      topic: "Refined topic prose",
      angle: "Refined angle prose.",
    });
    expect(result.evidenceSignalIds).toEqual(["sig_gh", "sig_hn"]);
    expect(result.independentSourceCount).toBe(2);
    expect(result.promptVersion).toBe("next-move-synthesis-v1");
  });
});
