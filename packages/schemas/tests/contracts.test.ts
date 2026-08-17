import { describe, expect, it } from "vitest";

import {
  NextMoveAcceptedResponseSchema,
  NextMoveReadyResponseSchema,
  NextMoveRequestSchema,
  ProjectNextMoveRequestSchema,
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
      generation_level: "brief",
    });
    expect(() => NextMoveRequestSchema.parse({})).toThrow();
  });

  it("defaults the claimed-project contract to draft and rejects brief output", () => {
    expect(ProjectNextMoveRequestSchema.parse({})).toEqual({ generation_level: "draft" });
    expect(() => ProjectNextMoveRequestSchema.parse({ generation_level: "brief" })).toThrow();
  });

  it("accepts honest 202 and ready response shapes", () => {
    expect(
      NextMoveAcceptedResponseSchema.parse({
        id: "scan_fixture_1",
        status: "QUEUED",
        status_url: "/v1/next-moves/scan_fixture_1",
        poll_after_seconds: 30,
      }).status,
    ).toBe("QUEUED");

    expect(
      NextMoveReadyResponseSchema.parse({
        id: "move_fixture_1",
        status: "READY",
        contract_version: "next-move-v1",
        generation_level: "brief",
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
        action_details: {
          action: "PUBLISH",
          content_type: "founder_text",
          blueprint: {
            content_premise: "Explain a product-specific distribution decision.",
            audience_tension: "Technical founders need timely evidence without false precision.",
            product_role: "Show a reproducible evidence framework.",
            format_family: "founder_text",
            format_basis: "PRODUCT_FIT",
            hook_family: "tension to proof",
            hook_variants: [
              { style: "direct", text: "Here is the evidence rule." },
              { style: "contrarian", text: "More signals do not guarantee a better decision." },
              { style: "proof", text: "We tested the rule on stored evidence." },
            ],
            tone: ["specific"],
            structure: ["Problem", "Evidence", "Decision"],
            cta: "Share how you choose what to publish.",
            asset_requirements: [],
            channel_instructions: ["Keep the limitation visible."],
            production_options: ["FOUNDER_TEXT"],
          },
          publish_by: "2026-08-13T12:00:00.000Z",
        },
        trend_window: {
          state: "ACTIVE",
          basis: "CORROBORATED_INFERENCE",
          observed_since: observedAt,
          last_confirmed_at: observedAt,
          recommended_action_by: "2026-08-13T12:00:00.000Z",
          valid_until: "2026-08-13T12:00:00.000Z",
          recheck_at: "2026-08-12T12:00:00.000Z",
          estimated_remaining_hours: { min: 12, max: 36 },
          confidence: 0.7,
          explanation: "Independent current sources support a rounded inferred range.",
        },
        breakout_potential: {
          level: "medium",
          basis: "EVIDENCE_GROUNDED",
          factors: {
            audience_relevance: 0.8,
            timing: 0.7,
            novelty: 0.6,
            product_credibility: 0.75,
            format_fit: 0.7,
            saturation_risk: 0.25,
          },
          explanation: "A categorical evidence-grounded label, not a probability.",
        },
        freshness: {
          state: "CURRENT",
          evaluated_at: observedAt,
          requires_new_scan: false,
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
