import { describe, expect, it } from "vitest";
import type { ProjectContext, Signal } from "@trendsfast/schemas";
import { decideDeterministically } from "../src/decision";

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

describe("deterministic decision engine", () => {
  it("can publish only with independent current evidence and binds stored ids", async () => {
    const signals = [
      signal("sig_hn", "hacker_news", "https://news.ycombinator.com/item?id=1"),
      signal("sig_gh", "github", "https://github.com/example/research"),
    ];
    const draft = await decideDeterministically({
      context,
      signals,
      measurements: [],
      coverage: {
        website: "SUCCEEDED",
        hacker_news: "SUCCEEDED",
        github: "SUCCEEDED",
        google_trends: "SUCCEEDED",
      },
      now: new Date("2026-08-11T12:00:00.000Z"),
    });
    expect(draft.move.action).toBe("PUBLISH");
    expect(new Set(draft.evidenceSignalIds)).toEqual(new Set(["sig_hn", "sig_gh"]));
  });

  it("returns WAIT under inadequate critical coverage", async () => {
    const draft = await decideDeterministically({
      context,
      signals: [signal("sig_hn", "hacker_news", "https://news.ycombinator.com/item?id=1")],
      measurements: [],
      coverage: { website: "FAILED", google_trends: "FAILED", hacker_news: "SUCCEEDED" },
      now: new Date("2026-08-11T12:00:00.000Z"),
    });
    expect(draft.move.action).toBe("WAIT");
    expect(draft.limitations.join(" ")).toMatch(/coverage|quality floor/i);
  });

  it("never includes an evidence id that was not supplied", async () => {
    const draft = await decideDeterministically({
      context,
      signals: [signal("sig_hn", "hacker_news", "https://news.ycombinator.com/item?id=1")],
      measurements: [],
      coverage: { website: "SUCCEEDED", hacker_news: "SUCCEEDED" },
      now: new Date("2026-08-11T12:00:00.000Z"),
    });
    expect(draft.evidenceSignalIds.every((id) => id === "sig_hn")).toBe(true);
  });

  it("does not attach a rising measurement from an unrelated query to a cluster", async () => {
    const draft = await decideDeterministically({
      context,
      signals: [
        signal("sig_hn", "hacker_news", "https://news.ycombinator.com/item?id=1"),
        signal("sig_gh", "github", "https://github.com/example/research"),
      ],
      measurements: [
        {
          id: "measurement_flat_hn",
          source: "google_trends",
          provider: "fixture:google_trends",
          queryId: "query_hacker_news",
          kind: "EXTERNAL_TIME_SERIES",
          label: "Flat measurement for the clustered query",
          points: [
            { at: "2026-08-10T12:00:00.000Z", value: 50 },
            { at: "2026-08-11T12:00:00.000Z", value: 50 },
          ],
        },
        {
          id: "measurement_rising_unrelated",
          source: "google_trends",
          provider: "fixture:google_trends",
          queryId: "query_unrelated",
          kind: "EXTERNAL_TIME_SERIES",
          label: "Rising measurement for an unrelated query",
          points: [
            { at: "2026-08-10T12:00:00.000Z", value: 10 },
            { at: "2026-08-11T12:00:00.000Z", value: 90 },
          ],
        },
      ],
      coverage: {
        website: "SUCCEEDED",
        hacker_news: "SUCCEEDED",
        github: "SUCCEEDED",
        google_trends: "SUCCEEDED",
      },
      now: new Date("2026-08-11T12:00:00.000Z"),
    });

    expect(draft.signalClass).toBe("CORROBORATED_SIGNAL");
    expect(draft.whyNow).not.toMatch(/external Google Trends series/i);
  });
});
