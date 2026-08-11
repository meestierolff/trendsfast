import { describe, expect, it } from "vitest";

import {
  NextMoveAcceptedResponseSchema,
  NextMoveReadyResponseSchema,
  NextMoveRequestSchema,
  ProjectContextSchema,
  QueryPlanSchema,
  ScanStateSchema,
  SignalMetricSnapshotSchema,
  SignalSchema,
} from "../src/index";

const observedAt = "2026-08-11T12:00:00.000Z";

describe("canonical signal contracts", () => {
  it("accepts a provenance-bound signal without inventing velocity", () => {
    const signal = SignalSchema.parse({
      id: "sig_fixture_hn_1",
      source: "hacker_news",
      sourceId: "44123123",
      url: "https://news.ycombinator.com/item?id=44123123",
      title: "How founders find timely distribution ideas",
      textExcerpt: "A compact excerpt, not a full provider payload.",
      author: { handle: "fixture-founder" },
      publishedAt: observedAt,
      observedAt,
      language: "en",
      metrics: { points: 42, comments: 13 },
      queryId: "qry_hn_distribution",
      provenance: {
        provider: "hn_algolia",
        requestId: "fixture-request-1",
        retrievedAt: observedAt,
        cached: false,
        rawPayloadHash: "sha256:fixture",
      },
    });

    expect(signal.source).toBe("hacker_news");
    expect("velocity" in signal.metrics).toBe(false);
    expect(() => SignalSchema.parse({ ...signal, metrics: { views: -1 } })).toThrow();
  });

  it("requires snapshot times independently from the original observation", () => {
    expect(
      SignalMetricSnapshotSchema.parse({
        signalId: "sig_fixture_hn_1",
        observedAt,
        metrics: { points: 43, comments: 14 },
      }),
    ).toMatchObject({ signalId: "sig_fixture_hn_1" });
  });
});

describe("project, query, and next-move API contracts", () => {
  it("validates inferred context and a bounded provider-specific query plan", () => {
    const project = ProjectContextSchema.parse({
      name: "TrendsFast",
      url: "https://trendsfast.com",
      category: "distribution intelligence",
      audience: "technical founders",
      problem: "Founders spend hours researching what to distribute.",
      desiredOutcome: "One timely evidence-backed distribution move.",
      credibleClaims: ["Returns one founder-reviewed move"],
      alternatives: ["manual research"],
      competitors: [],
      markets: ["US"],
      language: "en",
      suitableChannels: ["x", "hacker_news"],
      availableFormats: ["founder_text", "technical_post"],
      credibleTopics: ["distribution research", "trend evidence"],
      assumptions: ["The founder can publish technical content"],
    });

    const plan = QueryPlanSchema.parse({
      id: "qplan_fixture_1",
      projectContextVersionId: "ctx_fixture_1",
      version: "query-plan-v1",
      generatedAt: observedAt,
      providers: [
        {
          id: "qgrp_hn_1",
          source: "hacker_news",
          role: "developer pain and launch narratives",
          terms: ["distribution research", "founder marketing"],
          constraints: { maxCalls: 5, maxResults: 30, lookbackHours: 168 },
        },
      ],
    });

    expect(project.credibleTopics).toHaveLength(2);
    expect(plan.providers[0]?.constraints.maxCalls).toBe(5);
  });

  it("keeps product_url as the only required request field", () => {
    expect(NextMoveRequestSchema.parse({ product_url: "https://example.com" })).toEqual({
      product_url: "https://example.com",
    });
    expect(() => NextMoveRequestSchema.parse({})).toThrow();
  });

  it("accepts honest 202 and ready response shapes", () => {
    expect(
      NextMoveAcceptedResponseSchema.parse({
        id: "scan_fixture_1",
        status: "QUEUED",
        status_url: "/v1/next-moves/scan_fixture_1",
      }).status,
    ).toBe("QUEUED");

    expect(
      NextMoveReadyResponseSchema.parse({
        id: "move_fixture_1",
        status: "READY",
        project: {
          name: "Example",
          url: "https://example.com",
          audience: "technical founders",
          problem: "Distribution research takes too long.",
          credible_topics: ["developer distribution"],
          assumptions: ["The founder can post on X"],
        },
        next_move: {
          action: "PUBLISH",
          channel: "x",
          topic: "Distribution evidence",
          angle: "Show the decision process",
          format: "founder_text",
          hook: "Shipping got faster. Distribution research did not.",
          outline: ["Problem", "Evidence", "Decision"],
          cta: "Share how you choose what to publish.",
          priority: 86,
          confidence: 0.82,
          valid_until: "2026-08-13T12:00:00.000Z",
        },
        why_now: {
          summary: "Independent sources show current interest.",
          signal_class: "CORROBORATED_SIGNAL",
          independent_source_count: 2,
          saturation: "low_to_medium",
        },
        evidence: [
          {
            source: "hacker_news",
            url: "https://news.ycombinator.com/item?id=44123123",
            title: "A current discussion",
            published_at: observedAt,
            observed_at: observedAt,
            reason: "Technical founders are discussing the same pain.",
            provider: "hn_algolia",
            role: "DECISION_SUPPORT",
            verified: true,
          },
        ],
        limitations: ["Fixture evidence is illustrative"],
        founder_reviewed: true,
        auto_publish: false,
      }).next_move.action,
    ).toBe("PUBLISH");
  });

  it("exposes exactly the public lifecycle states", () => {
    expect(ScanStateSchema.options).toEqual([
      "QUEUED",
      "RUNNING",
      "REVIEW_REQUIRED",
      "READY",
      "FAILED",
    ]);
  });
});
