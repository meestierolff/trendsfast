import { describe, expect, it } from "vitest";
import {
  BreakoutPotentialSchema,
  reconcileVersionedNextMove,
  VersionedNextMoveSchema,
  type ProjectContext,
  type Signal,
} from "@trendsfast/schemas";
import type { OpportunityScoreComponents } from "@trendsfast/scoring";

import {
  assertActionDetailsBoundToStoredEvidence,
  assertVersionedNextMoveContentSafety,
  deriveVersionedNextMove,
  type DecisionContractInput,
} from "../src/decision-contract";

const now = new Date("2026-08-13T10:17:00.000Z");

const context: ProjectContext = {
  name: "Example",
  url: "https://example.com",
  category: "distribution intelligence",
  audience: "technical founders",
  problem: "distribution research takes too long",
  desiredOutcome: "choose one timely distribution move",
  credibleClaims: ["uses evidence receipts"],
  alternatives: ["manual research"],
  competitors: [],
  markets: ["US"],
  language: "en",
  suitableChannels: ["x", "hacker_news"],
  availableFormats: ["founder_text", "screen_recording"],
  credibleTopics: ["evidence-led distribution"],
  assumptions: [],
};

function signal(id: string, source: Signal["source"], url: string, author: string): Signal {
  return {
    id,
    source,
    sourceId: `${source}-${id}`,
    url,
    title: `Stored title for ${id}`,
    textExcerpt: `Stored excerpt for ${id}`,
    author: { handle: author },
    publishedAt: "2026-08-13T07:00:00.000Z",
    observedAt: "2026-08-13T09:00:00.000Z",
    language: "en",
    metrics: { comments: 13, likes: 29 },
    queryId: `query_${id}`,
    provenance: {
      provider: `fixture:${source}`,
      retrievedAt: "2026-08-13T09:00:00.000Z",
      cached: false,
    },
  };
}

const storedSignals = [
  signal("signal_x", "x", "https://x.com/stored/status/1", "stored-author"),
  signal("signal_hn", "hacker_news", "https://news.ycombinator.com/item?id=111", "hn-author"),
  signal("signal_yt", "youtube", "https://www.youtube.com/watch?v=stored", "video-author"),
];

const components: OpportunityScoreComponents = {
  audienceFit: 0.84,
  productRelevance: 0.82,
  measuredOrCorroboratedMomentum: 0.8,
  novelty: 0.74,
  productCredibility: 0.78,
  formatFit: 0.81,
  remainingWindow: 0.72,
  sourceQuality: 0.8,
  saturation: 0.24,
  evidenceDependency: 0.1,
};

function input(
  action: DecisionContractInput["action"],
  evidenceSignalIds: string[],
  overrides: Partial<DecisionContractInput> = {},
): DecisionContractInput {
  return {
    action,
    context,
    topic: "Evidence-led distribution is becoming more important",
    channel: action === "REPLY" ? "x" : "linkedin",
    format: "founder_text",
    angle: "Show the decision rule and its limitations.",
    hook: "Research should change the next distribution decision.",
    outline: ["Tension", "Evidence", "Worked example"],
    cta: "Compare the rule with your current process.",
    priority: action === "WAIT" ? 0 : 81,
    confidence: 0.79,
    signalClass: action === "WAIT" ? "INSUFFICIENT_SIGNAL" : "CORROBORATED_SIGNAL",
    saturation: "low_to_medium",
    components,
    storedSignals,
    evidenceSignalIds,
    qualityReasons: action === "WAIT" ? ["PUBLISH_REQUIRES_TWO_INDEPENDENT_EVIDENCE_ITEMS"] : [],
    coverage: {
      website: "SUCCEEDED",
      google_trends: "SUCCEEDED",
      hacker_news: "SUCCEEDED",
      x: "SUCCEEDED",
    },
    now,
    ...overrides,
  };
}

describe("versioned deterministic decision contract", () => {
  it("applies the shared final safety boundary to the fully reconciled nested deliverable", () => {
    const original = deriveVersionedNextMove(input("PUBLISH", ["signal_x", "signal_hn"]));
    if (original.details.action !== "PUBLISH") throw new Error("Expected PUBLISH details");
    const unsafeStoredNestedCopy = VersionedNextMoveSchema.parse({
      ...original,
      details: {
        ...original.details,
        blueprint: {
          ...original.details.blueprint,
          audience_tension: "Guaranteed portfolio profits without risk.",
        },
      },
    });
    const reconciled = reconcileVersionedNextMove({
      move: unsafeStoredNestedCopy,
      prose: {
        channel: original.channel,
        topic: "A refined evidence-led topic",
        angle: original.angle,
        format: original.format,
        hook: original.hook,
        outline: original.outline,
        cta: original.cta,
      },
    });

    expect(() => assertVersionedNextMoveContentSafety(reconciled, context)).toThrow(
      /final content-safety boundary/i,
    );
    expect(() =>
      assertVersionedNextMoveContentSafety(original, context, [
        "Guaranteed 500% returns without risk; buy TSLA immediately.",
      ]),
    ).toThrow(/final content-safety boundary/i);
  });

  it("binds every REPLY factual field to the exact stored source records", () => {
    const move = deriveVersionedNextMove(input("REPLY", ["signal_x", "signal_hn"]));

    expect(move.action).toBe("REPLY");
    if (move.action !== "REPLY") throw new Error("Expected REPLY details");
    expect(move.details.primary_target).toMatchObject({
      source: "x",
      url: "https://x.com/stored/status/1",
      author: "stored-author",
      title_or_excerpt: "Stored title for signal_x",
      published_at: "2026-08-13T07:00:00.000Z",
      observed_at: "2026-08-13T09:00:00.000Z",
    });
    expect(move.details.secondary_targets.map((target) => target.url)).toEqual([
      "https://news.ycombinator.com/item?id=111",
    ]);
    expect("metrics" in move.details.primary_target).toBe(false);
    expect("views" in move.details.primary_target).toBe(false);
    expect(() =>
      assertActionDetailsBoundToStoredEvidence({
        details: move.details,
        evidenceSignalIds: ["signal_x", "signal_hn"],
        storedSignals,
      }),
    ).not.toThrow();
  });

  it("never projects an X receipt without publishedAt as a secondary REPLY target", () => {
    const xWithoutPublishedAt = { ...storedSignals[0]! };
    delete xWithoutPublishedAt.publishedAt;
    const move = deriveVersionedNextMove(
      input("REPLY", ["signal_hn", "signal_x"], {
        timingSignalId: "signal_hn",
        storedSignals: [storedSignals[1]!, xWithoutPublishedAt],
      }),
    );

    expect(move.action).toBe("REPLY");
    if (move.action !== "REPLY") throw new Error("Expected REPLY details");
    expect(move.details.primary_target.url).toBe(storedSignals[1]!.url);
    expect(move.details.secondary_targets).toEqual([]);
  });

  it("keeps broader mixed-cluster evidence while targeting only stored conversations", () => {
    const move = deriveVersionedNextMove(input("REPLY", ["signal_yt", "signal_x", "signal_hn"]));
    if (move.action !== "REPLY") throw new Error("Expected REPLY details");

    expect(move.details.primary_target.url).toBe("https://x.com/stored/status/1");
    expect(move.details.secondary_targets.map((target) => target.url)).toEqual([
      "https://news.ycombinator.com/item?id=111",
    ]);
    expect(
      [move.details.primary_target, ...move.details.secondary_targets].some(
        (target) => target.source === "youtube",
      ),
    ).toBe(false);
  });

  it("rejects invented target URLs and authors at the binding boundary", () => {
    const move = deriveVersionedNextMove(input("REPLY", ["signal_x"]));
    if (move.action !== "REPLY") throw new Error("Expected REPLY details");

    expect(() =>
      assertActionDetailsBoundToStoredEvidence({
        details: {
          ...move.details,
          primary_target: {
            ...move.details.primary_target,
            url: "https://invented.example/post",
          },
        },
        evidenceSignalIds: ["signal_x"],
        storedSignals,
      }),
    ).toThrow(/URL is not evidence-bound/i);
    expect(() =>
      assertActionDetailsBoundToStoredEvidence({
        details: {
          ...move.details,
          primary_target: { ...move.details.primary_target, author: "invented-author" },
        },
        evidenceSignalIds: ["signal_x"],
        storedSignals,
      }),
    ).toThrow(/author is not evidence-bound/i);
  });

  it("binds REMIX source content and describes transformation without copying", () => {
    const move = deriveVersionedNextMove(input("REMIX", ["signal_yt"]));

    expect(move.action).toBe("REMIX");
    if (move.action !== "REMIX") throw new Error("Expected REMIX details");
    expect(move.details.source_content).toEqual([
      expect.objectContaining({
        source: "youtube",
        url: "https://www.youtube.com/watch?v=stored",
        author: "video-author",
        observed_hook: "Stored title for signal_yt",
        observed_format_family: "video",
      }),
    ]);
    expect(move.details.do_not_copy.join(" ")).toMatch(/wording|identity|assets/i);
    expect(move.details.blueprint.format_basis).toBe("PRODUCT_FIT");
    expect(() =>
      assertActionDetailsBoundToStoredEvidence({
        details: move.details,
        evidenceSignalIds: ["signal_yt"],
        storedSignals,
      }),
    ).not.toThrow();
  });

  it("claims source-observed format basis only when stored content exposes a pattern", () => {
    const observed = deriveVersionedNextMove(input("PUBLISH", ["signal_x"]));
    const compatibleVideo = deriveVersionedNextMove(
      input("REMIX", ["signal_yt"], { format: "screen_recording" }),
    );
    const incompatibleVideo = deriveVersionedNextMove(input("REMIX", ["signal_yt"]));
    const noPatternSignal = signal(
      "signal_tavily",
      "tavily",
      "https://example.net/source",
      "source-author",
    );
    delete noPatternSignal.title;
    delete noPatternSignal.textExcerpt;
    const inferred = deriveVersionedNextMove(
      input("PUBLISH", ["signal_tavily"], {
        storedSignals: [...storedSignals, noPatternSignal],
      }),
    );
    if (
      observed.action !== "PUBLISH" ||
      inferred.action !== "PUBLISH" ||
      compatibleVideo.action !== "REMIX" ||
      incompatibleVideo.action !== "REMIX"
    ) {
      throw new Error("Expected PUBLISH and REMIX details");
    }
    expect(observed.details.blueprint.format_basis).toBe("SOURCE_OBSERVED");
    expect(compatibleVideo.details.blueprint.format_basis).toBe("SOURCE_OBSERVED");
    expect(incompatibleVideo.details.blueprint.format_basis).toBe("PRODUCT_FIT");
    expect(inferred.details.blueprint.format_basis).toBe("PRODUCT_FIT");
  });

  it("returns an actionable WAIT with explicit watch conditions and no fake duration", () => {
    const move = deriveVersionedNextMove(
      input("WAIT", ["signal_x"], {
        coverage: { website: "FAILED", hacker_news: "SUCCEEDED" },
        qualityReasons: [
          "PROVIDER_COVERAGE_INADEQUATE",
          "PUBLISH_REQUIRES_TWO_INDEPENDENT_EVIDENCE_ITEMS",
        ],
      }),
    );

    expect(move.action).toBe("WAIT");
    if (move.action !== "WAIT") throw new Error("Expected WAIT details");
    expect(move.details.failure_reasons).toEqual(
      expect.arrayContaining(["MISSING_COVERAGE", "DEPENDENT_EVIDENCE"]),
    );
    expect(move.details.do_not_act_on).not.toHaveLength(0);
    expect(move.details.watch_conditions).not.toHaveLength(0);
    expect(move.trendWindow).toMatchObject({ state: "UNKNOWN", basis: "UNKNOWN" });
    expect(move.trendWindow.estimated_remaining_hours).toBeUndefined();
    expect(move.details.recheck_at).toBe(move.trendWindow.recheck_at);
  });

  it("distinguishes measured, corroborated, and single-signal timing truth", () => {
    const measured = deriveVersionedNextMove(
      input("PUBLISH", ["signal_x", "signal_hn"], {
        signalClass: "MEASURED_EXTERNAL_SERIES",
      }),
    );
    const corroborated = deriveVersionedNextMove(input("PUBLISH", ["signal_x", "signal_hn"]));
    const single = deriveVersionedNextMove(
      input("REPLY", ["signal_x"], { signalClass: "EMERGING_SIGNAL" }),
    );

    expect(measured.trendWindow).toMatchObject({
      state: "RISING",
      basis: "MEASURED_EXTERNAL_SERIES",
      estimated_remaining_hours: { min: 24, max: 72 },
    });
    expect(corroborated.trendWindow).toMatchObject({
      state: "ACTIVE",
      basis: "CORROBORATED_INFERENCE",
      estimated_remaining_hours: { min: 12, max: 36 },
    });
    expect(single.trendWindow).toMatchObject({
      state: "EARLY",
      basis: "SINGLE_SIGNAL_INFERENCE",
      estimated_remaining_hours: { min: 4, max: 12 },
    });
    expect(measured.trendWindow.valid_until).toMatch(/T\d{2}:00:00\.000Z$/);
  });

  it("keeps brief and draft decisions identical except for optional draft prose", () => {
    const brief = deriveVersionedNextMove(
      input("PUBLISH", ["signal_x", "signal_hn"], { generationLevel: "brief" }),
    );
    const draft = deriveVersionedNextMove(
      input("PUBLISH", ["signal_x", "signal_hn"], { generationLevel: "draft" }),
    );

    expect(brief.draftContent).toBeUndefined();
    expect(draft.draftContent).toContain("Evidence-led distribution is becoming more important");
    expect(draft.draftContent).toContain("Example");
    expect(draft.draftContent).toContain("uses evidence receipts");
    expect(draft.draftContent).not.toMatch(/founder approval required|^- |open with|show the/imu);
    expect({ ...draft, generationLevel: "brief", draftContent: undefined }).toEqual({
      ...brief,
      draftContent: undefined,
    });
    expect(draft.action).toBe(brief.action);
    expect(draft.details).toEqual(brief.details);
    expect(draft.trendWindow).toEqual(brief.trendWindow);
    expect(draft.breakoutPotential).toEqual(brief.breakoutPotential);
  });

  it("uses the bounded saved voice and enabled production capabilities for a draft", () => {
    const move = deriveVersionedNextMove(
      input("PUBLISH", ["signal_x", "signal_hn"], {
        generationLevel: "draft",
        format: "screen_recording",
        contentCapabilities: {
          founder_text: false,
          founder_on_camera: false,
          screen_recording: true,
          ai_avatar: true,
          carousel: false,
          product_demo: false,
          long_form: false,
        },
        voiceProfile: {
          traits: ["dry", "technical"],
          preferred_phrases: ["Here is the decision rule"],
          avoid_phrases: ["guaranteed growth"],
          sample_texts: ["A bounded sample informs tone only."],
          sample_urls: [],
        },
      }),
    );
    if (move.action !== "PUBLISH") throw new Error("Expected PUBLISH details");
    expect(move.details.blueprint.production_options).toEqual(["SCREEN_RECORDING", "AI_AVATAR"]);
    expect(move.details.blueprint.tone).toEqual(
      expect.arrayContaining(["dry", "technical", "evidence-aware"]),
    );
    expect(move.details.blueprint.hook_variants[0]?.text).toMatch(/^Here is the decision rule/);
    expect(move.details.blueprint.channel_instructions.join(" ")).toContain("guaranteed growth");
    expect(move.draftContent).not.toContain("guaranteed growth");
    expect(move.draftContent).toContain("Here is the decision rule");
  });

  it("always includes the exact suggested reply and never adds reply draft content", () => {
    const brief = deriveVersionedNextMove(
      input("REPLY", ["signal_x"], { generationLevel: "brief" }),
    );
    const draft = deriveVersionedNextMove(
      input("REPLY", ["signal_x"], { generationLevel: "draft" }),
    );
    if (brief.action !== "REPLY" || draft.action !== "REPLY") {
      throw new Error("Expected REPLY details");
    }
    expect(brief.details.primary_target.suggested_reply).toBe(
      draft.details.primary_target.suggested_reply,
    );
    expect(draft.details.primary_target.suggested_reply).toContain(
      "Evidence-led distribution is becoming more important",
    );
    expect(draft.details.primary_target.suggested_reply).toContain("Example");
    expect(draft.details.primary_target.suggested_reply).toContain("uses evidence receipts");
    expect(draft.details.primary_target.suggested_reply).toContain("technical founders");
    expect(draft.details.primary_target.suggested_reply).not.toContain("https://");
    expect(draft.draftContent).toBeUndefined();
  });

  it("emits finished product-specific PUBLISH and REMIX copy instead of production instructions", () => {
    const publish = deriveVersionedNextMove(
      input("PUBLISH", ["signal_x", "signal_hn"], { generationLevel: "draft" }),
    );
    const remix = deriveVersionedNextMove(
      input("REMIX", ["signal_yt", "signal_x"], { generationLevel: "draft" }),
    );

    for (const move of [publish, remix]) {
      expect(move.draftContent).toContain("Example");
      expect(move.draftContent).toContain("uses evidence receipts");
      expect(move.draftContent).toContain("Evidence-led distribution is becoming more important");
      expect(move.draftContent).toContain("distribution research takes too long");
      expect(move.draftContent).not.toMatch(
        /founder approval required|do not auto-publish|^- |open with|show the strongest|close with/imu,
      );
    }
    expect(publish.action).toBe("PUBLISH");
    expect(remix.action).toBe("REMIX");
  });

  it("keeps TrendsFast and Halio draft copy materially product-specific", () => {
    const trendsFastContext: ProjectContext = {
      ...context,
      name: "TrendsFast",
      category: "distribution intelligence",
      audience: "technical founders building APIs",
      problem: "live distribution research takes too long",
      desiredOutcome: "choose one evidence-backed distribution move",
      credibleClaims: ["immutable evidence receipts"],
      credibleTopics: ["evidence-led distribution"],
    };
    const halioContext: ProjectContext = {
      ...context,
      name: "Halio",
      category: "portfolio clarity",
      audience: "Dutch self-directed investors",
      problem: "portfolio data is fragmented and hard to interpret",
      desiredOutcome: "understand portfolio concentration without trading permissions",
      credibleClaims: ["read-only portfolio clarity"],
      credibleTopics: ["portfolio clarity"],
      assumptions: ["No buy or sell advice."],
    };
    const trendsFast = deriveVersionedNextMove(
      input("PUBLISH", ["signal_x", "signal_hn"], {
        context: trendsFastContext,
        topic: "Evidence receipts for distribution decisions",
        generationLevel: "draft",
      }),
    );
    const halio = deriveVersionedNextMove(
      input("PUBLISH", ["signal_x", "signal_hn"], {
        context: halioContext,
        topic: "Read-only portfolio clarity",
        generationLevel: "draft",
      }),
    );

    expect(trendsFast.draftContent).toContain("TrendsFast");
    expect(trendsFast.draftContent).toContain("immutable evidence receipts");
    expect(trendsFast.draftContent).not.toContain("Halio");
    expect(halio.draftContent).toContain("Halio");
    expect(halio.draftContent).toContain("read-only portfolio clarity");
    expect(halio.draftContent).not.toContain("TrendsFast");
    expect(trendsFast.draftContent).not.toBe(halio.draftContent);
  });

  it("forces an unsafe derived product contribution to a no-draft WAIT", () => {
    const move = deriveVersionedNextMove(
      input("PUBLISH", ["signal_x", "signal_hn"], {
        context: {
          ...context,
          audience: "self-directed investors",
          credibleClaims: ["guaranteed returns"],
        },
        generationLevel: "draft",
      }),
    );

    expect(move).toMatchObject({
      action: "WAIT",
      topic: "No safe distribution claim is available yet",
      priority: 0,
      details: { action: "WAIT", failure_reasons: expect.arrayContaining(["LOW_CREDIBILITY"]) },
    });
    expect(move.draftContent).toBeUndefined();
  });

  it("never creates fake draft content for a draft-level WAIT", () => {
    const wait = deriveVersionedNextMove(input("WAIT", ["signal_x"], { generationLevel: "draft" }));
    expect(wait.action).toBe("WAIT");
    expect(wait.draftContent).toBeUndefined();
  });

  it("rejects a missing stored evidence identifier and probability-shaped output", () => {
    expect(() => deriveVersionedNextMove(input("REPLY", ["not_stored"]))).toThrow(
      /not present in the stored signal set/i,
    );
    const breakout = deriveVersionedNextMove(
      input("PUBLISH", ["signal_x", "signal_hn"]),
    ).breakoutPotential;
    expect(BreakoutPotentialSchema.safeParse({ ...breakout, probability: 0.81 }).success).toBe(
      false,
    );
    expect(breakout.explanation).toMatch(/not a.*probability/i);
  });

  it("keeps the action and nested detail discriminant linked", () => {
    const publish = deriveVersionedNextMove(input("PUBLISH", ["signal_x", "signal_hn"]));
    expect(
      VersionedNextMoveSchema.safeParse({
        ...publish,
        details: { ...publish.details, action: "WAIT" },
      }).success,
    ).toBe(false);
  });
});
