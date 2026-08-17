import { describe, expect, it } from "vitest";

import {
  ActionDetailsSchema,
  ContentBlueprintSchema,
  NextMoveRequestSchema,
  TrendWindowSchema,
  VersionedNextMoveSchema,
  convertVersionedNextMoveToWait,
  evaluateNextMoveFreshness,
  reconcileVersionedNextMove,
} from "../src/index";

const blueprint = {
  content_premise: "Turn a current distribution problem into one useful decision rule.",
  audience_tension: "Founders need timely ideas but cannot trust unsupported trend claims.",
  product_role: "Show the evidence boundary and a reproducible worked example.",
  format_family: "founder_text",
  format_basis: "PRODUCT_FIT" as const,
  hook_family: "tension to proof",
  hook_variants: [
    { style: "direct" as const, text: "Here is the decision rule." },
    { style: "contrarian" as const, text: "More signals do not always improve a decision." },
    { style: "proof" as const, text: "We tested the rule against stored evidence." },
  ],
  tone: ["specific"],
  structure: ["Tension", "Evidence", "Decision"],
  cta: "Compare the rule with your own process.",
  asset_requirements: [],
  channel_instructions: ["Keep the evidence limitation visible."],
  production_options: ["FOUNDER_TEXT" as const],
};

const trendWindow = {
  state: "ACTIVE" as const,
  basis: "CORROBORATED_INFERENCE" as const,
  observed_since: "2026-08-13T07:00:00.000Z",
  last_confirmed_at: "2026-08-13T09:00:00.000Z",
  recommended_action_by: "2026-08-14T22:00:00.000Z",
  valid_until: "2026-08-14T22:00:00.000Z",
  recheck_at: "2026-08-13T22:00:00.000Z",
  estimated_remaining_hours: { min: 12, max: 36 },
  confidence: 0.7,
  explanation: "Independent current sources support a rounded inferred range.",
};

const breakoutPotential = {
  level: "medium" as const,
  basis: "EVIDENCE_GROUNDED" as const,
  factors: {
    audience_relevance: 0.8,
    timing: 0.7,
    novelty: 0.6,
    product_credibility: 0.75,
    format_fit: 0.7,
    saturation_risk: 0.25,
  },
  explanation: "A categorical evidence-grounded label, not a probability.",
};

function draftPublishMove() {
  return VersionedNextMoveSchema.parse({
    contractVersion: "next-move-v1",
    generationLevel: "draft",
    action: "PUBLISH",
    channel: "linkedin",
    topic: "Evidence-led distribution",
    angle: "Show the decision rule.",
    format: "founder_text",
    hook: "Research should change the next decision.",
    outline: ["Tension", "Evidence", "Decision"],
    cta: blueprint.cta,
    priority: 80,
    confidence: 0.78,
    validUntil: trendWindow.valid_until,
    trendWindow,
    breakoutPotential,
    details: {
      action: "PUBLISH",
      content_type: "founder_text",
      blueprint,
      publish_by: trendWindow.valid_until,
    },
    draftContent: "Original bounded draft copy.",
  });
}

describe("Next Move v1 schemas", () => {
  it("accepts all four strict action-detail variants", () => {
    const variants = [
      {
        action: "PUBLISH",
        content_type: "text post",
        blueprint,
        publish_by: trendWindow.valid_until,
      },
      {
        action: "REPLY",
        primary_target: {
          source: "x",
          url: "https://x.com/stored/status/1",
          author: "stored-author",
          title_or_excerpt: "Stored title",
          published_at: "2026-08-13T07:00:00.000Z",
          observed_at: "2026-08-13T09:00:00.000Z",
          why_this_target: "This exact conversation matches the stored audience problem.",
          credibility_reason: "The product has a concrete framework to contribute.",
          reply_objective: "Help participants make the next decision.",
          reply_angle: "Separate observed evidence from assumptions.",
          suggested_reply: "Separate the evidence from assumptions, then show the trade-off.",
          tone: ["helpful"],
          reply_by: trendWindow.valid_until,
        },
        secondary_targets: [],
      },
      {
        action: "REMIX",
        source_content: [
          {
            source: "youtube",
            url: "https://www.youtube.com/watch?v=stored",
            author: "stored-author",
            observed_hook: "Stored source title",
            observed_format_family: "video",
            relevance_reason: "The stored pattern matches the audience tension.",
          },
        ],
        preserve: ["The useful problem-solving pattern"],
        transform: ["Use new product-specific wording and examples"],
        do_not_copy: ["Original wording, identity, or creative assets"],
        transformed_concept: "Apply the pattern to an evidence-bound founder decision.",
        blueprint: { ...blueprint, format_basis: "SOURCE_OBSERVED" },
        remix_by: trendWindow.valid_until,
      },
      {
        action: "WAIT",
        considered_opportunity: "A thin single-source topic",
        failure_reasons: ["WEAK_EVIDENCE"],
        do_not_act_on: ["Do not present the topic as corroborated yet."],
        watch_conditions: ["Wait for an independent source."],
        recheck_at: trendWindow.recheck_at,
      },
    ];

    for (const variant of variants) expect(ActionDetailsSchema.parse(variant)).toEqual(variant);
  });

  it("rejects duplicate or mislabeled hooks", () => {
    expect(
      ContentBlueprintSchema.safeParse({
        ...blueprint,
        hook_variants: [
          { style: "direct", text: "Same" },
          { style: "direct", text: "Same" },
          { style: "proof", text: "Different" },
        ],
      }).success,
    ).toBe(false);
  });

  it("links the immutable primary action to its details", () => {
    expect(
      VersionedNextMoveSchema.safeParse({
        contractVersion: "next-move-v1",
        generationLevel: "brief",
        action: "PUBLISH",
        channel: "linkedin",
        topic: "Evidence-led distribution",
        angle: "Show the decision rule.",
        format: "founder_text",
        hook: "Research should change the next decision.",
        outline: ["Tension", "Evidence", "Decision"],
        cta: "Compare the rule.",
        priority: 80,
        confidence: 0.78,
        validUntil: trendWindow.valid_until,
        trendWindow,
        breakoutPotential,
        details: {
          action: "WAIT",
          considered_opportunity: "Something else",
          failure_reasons: ["WEAK_EVIDENCE"],
          do_not_act_on: ["Do not act."],
          watch_conditions: ["Wait for evidence."],
          recheck_at: trendWindow.recheck_at,
        },
      }).success,
    ).toBe(false);
  });

  it("forbids precision claims when the trend window is unknown", () => {
    expect(
      TrendWindowSchema.safeParse({
        ...trendWindow,
        state: "UNKNOWN",
        basis: "UNKNOWN",
        estimated_remaining_hours: { min: 1, max: 2 },
      }).success,
    ).toBe(false);
  });

  it("defaults legacy API requests to a full brief", () => {
    expect(NextMoveRequestSchema.parse({ product_url: "https://example.com" })).toEqual({
      product_url: "https://example.com",
      generation_level: "brief",
    });
  });

  it("marks the exact expiry boundary stale and requires a new scan", () => {
    expect(
      evaluateNextMoveFreshness({
        validUntil: "2026-08-14T10:00:00.000Z",
        now: "2026-08-14T09:59:59.999Z",
      }),
    ).toMatchObject({ state: "CURRENT", requires_new_scan: false });
    expect(
      evaluateNextMoveFreshness({
        validUntil: "2026-08-14T10:00:00.000Z",
        now: "2026-08-14T10:00:00.000Z",
      }),
    ).toMatchObject({ state: "STALE", requires_new_scan: true });
    expect(
      evaluateNextMoveFreshness({
        validUntil: "2026-08-14T10:00:00.000Z",
        proposalStale: true,
        now: "2026-08-13T10:00:00.000Z",
      }),
    ).toMatchObject({ state: "STALE", requires_new_scan: true });
  });

  it("reconciles edited prose into every dependent nested field without changing the decision", () => {
    const original = draftPublishMove();
    const reconciled = reconcileVersionedNextMove({
      move: original,
      prose: {
        channel: "x",
        topic: "A refined evidence-led topic",
        angle: "Use the refined decision rule.",
        format: "long_form",
        hook: "A refined hook.",
        outline: ["New tension", "Stored evidence", "Bounded conclusion"],
        cta: "Try the refined rule.",
      },
      validUntil: "2026-08-14T20:00:00.000Z",
    });

    expect(reconciled).toMatchObject({
      action: original.action,
      priority: original.priority,
      confidence: original.confidence,
      breakoutPotential: original.breakoutPotential,
      topic: "A refined evidence-led topic",
      validUntil: "2026-08-14T20:00:00.000Z",
      trendWindow: { valid_until: "2026-08-14T20:00:00.000Z" },
      details: {
        action: "PUBLISH",
        content_type: "long_form",
        publish_by: "2026-08-14T20:00:00.000Z",
        blueprint: {
          content_premise: "A refined evidence-led topic: Use the refined decision rule.",
          format_family: "long_form",
          structure: ["New tension", "Stored evidence", "Bounded conclusion"],
          cta: "Try the refined rule.",
        },
      },
    });
    expect(reconciled.draftContent).toContain("A refined hook.");
    expect(reconciled.draftContent).not.toBe(original.draftContent);
  });

  it("never extends a reconciled action or reply timing boundary", () => {
    const original = draftPublishMove();
    expect(() =>
      reconcileVersionedNextMove({
        move: original,
        prose: {
          channel: original.channel,
          topic: original.topic,
          angle: original.angle,
          format: original.format,
          hook: original.hook,
          outline: original.outline,
          cta: original.cta,
        },
        validUntil: "2026-08-15T22:00:00.000Z",
      }),
    ).toThrow(/never extend/i);
  });

  it("preserves finished nested copy when reconciliation receives an exact prose echo", () => {
    const original = draftPublishMove();
    const reconciled = reconcileVersionedNextMove({
      move: original,
      prose: {
        channel: original.channel,
        topic: original.topic,
        angle: original.angle,
        format: original.format,
        hook: original.hook,
        outline: original.outline,
        cta: original.cta,
      },
      validUntil: original.validUntil,
    });

    expect(reconciled).toEqual(original);
    expect(reconciled.draftContent).toBe(original.draftContent);
  });

  it("converts an enhanced proposal to a fully synchronized WAIT contract", () => {
    const converted = convertVersionedNextMoveToWait({
      move: draftPublishMove(),
      reason: "Founder review found that the stored evidence is no longer actionable.",
      validUntil: "2026-08-15T22:00:00.000Z",
    });

    expect(converted).toMatchObject({
      action: "WAIT",
      channel: "none",
      priority: 0,
      validUntil: "2026-08-15T22:00:00.000Z",
      trendWindow: {
        state: "UNKNOWN",
        basis: "UNKNOWN",
        valid_until: "2026-08-15T22:00:00.000Z",
        recheck_at: "2026-08-15T22:00:00.000Z",
      },
      details: {
        action: "WAIT",
        recheck_at: "2026-08-15T22:00:00.000Z",
      },
    });
    expect(converted.draftContent).toBeUndefined();
  });
});
