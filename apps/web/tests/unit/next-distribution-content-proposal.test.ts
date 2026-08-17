import { describe, expect, it } from "vitest";

import { deriveVersionedNextMove, type DecisionContractInput } from "@trendsfast/orchestration";
import type { ProjectContext, Signal } from "@trendsfast/schemas";
import type { OpportunityScoreComponents } from "@trendsfast/scoring";

import {
  buildNextDistributionContentAgentHandoffV1,
  mapNextDistributionContentProposalV1,
  type NextDistributionContentProposalInputV1,
} from "../../lib/next-distribution-content-proposal";

const now = new Date("2026-08-17T10:00:00.000Z");

const context: ProjectContext = {
  name: "Halio",
  url: "https://halio.nl/",
  category: "read-only investment clarity",
  audience: "Dutch self-directed investors",
  problem: "portfolio information is fragmented",
  desiredOutcome: "understand a portfolio without granting trading permission",
  credibleClaims: ["read-only portfolio clarity"],
  alternatives: ["manual spreadsheets"],
  competitors: [],
  markets: ["NL"],
  language: "nl",
  suitableChannels: ["x", "linkedin", "youtube", "blog"],
  availableFormats: ["founder_text", "screen_recording"],
  credibleTopics: ["read-only portfolio clarity"],
  assumptions: ["No financial-performance claim is supported."],
};

function signal(id: string, source: Signal["source"], url: string, author: string): Signal {
  return {
    id,
    source,
    sourceId: `${source}-${id}`,
    url,
    title: `Exact stored title for ${id}`,
    textExcerpt: `Exact stored excerpt for ${id}`,
    author: { handle: author },
    publishedAt: "2026-08-17T07:00:00.000Z",
    observedAt: "2026-08-17T09:00:00.000Z",
    language: "en",
    metrics: { comments: 8 },
    queryId: `query_${id}`,
    provenance: {
      provider: `live:${source}`,
      retrievedAt: "2026-08-17T09:00:00.000Z",
      cached: false,
    },
  };
}

const storedSignals = [
  signal("signal_x", "x", "https://x.com/exact/status/1", "exact-author"),
  signal("signal_hn", "hacker_news", "https://news.ycombinator.com/item?id=42", "hn-author"),
  signal("signal_yt", "youtube", "https://www.youtube.com/watch?v=exact", "video-author"),
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

function decisionInput(
  action: DecisionContractInput["action"],
  generationLevel: "brief" | "draft" = "draft",
): DecisionContractInput {
  const evidenceSignalIds =
    action === "PUBLISH"
      ? ["signal_x", "signal_hn"]
      : action === "REMIX"
        ? ["signal_yt"]
        : ["signal_x"];
  return {
    action,
    context,
    topic: "Investors want clearer read-only portfolio context",
    channel: action === "REPLY" ? "x" : "linkedin",
    format: "founder_text",
    angle: "Explain what read-only access does and does not permit.",
    hook: "Portfolio clarity does not require trading permission.",
    outline: ["State the confusion", "Show the read-only boundary", "Explain the next step"],
    cta: "Review the read-only product boundary.",
    priority: action === "WAIT" ? 0 : 81,
    confidence: 0.79,
    signalClass: action === "WAIT" ? "INSUFFICIENT_SIGNAL" : "CORROBORATED_SIGNAL",
    saturation: "low_to_medium",
    components,
    storedSignals,
    evidenceSignalIds,
    qualityReasons: action === "WAIT" ? ["MISSING_CRITICAL_COVERAGE"] : [],
    coverage: {
      website: "SUCCEEDED",
      google_trends: action === "WAIT" ? "FAILED" : "SUCCEEDED",
      hacker_news: "SUCCEEDED",
      x: "SUCCEEDED",
    },
    generationLevel,
    now,
  };
}

function proposalInput(
  action: DecisionContractInput["action"],
  generationLevel: "brief" | "draft" = "draft",
): NextDistributionContentProposalInputV1 {
  const move = deriveVersionedNextMove(decisionInput(action, generationLevel));
  const exactEvidence = storedSignals
    .filter((item) => decisionInput(action, generationLevel).evidenceSignalIds.includes(item.id))
    .map((item) => ({
      source: item.source,
      url: item.url,
      ...(item.title === undefined ? {} : { title: item.title }),
      ...(item.publishedAt === undefined ? {} : { published_at: item.publishedAt }),
      observed_at: item.observedAt,
      reason: `Exact reason for ${item.id}`,
      provider: item.provenance.provider,
      role: "DECISION_SUPPORT" as const,
      verified: true,
      availability: "AVAILABLE" as const,
    }));
  return {
    generation_level: move.generationLevel,
    next_move: {
      action: move.action,
      channel: move.channel,
      topic: move.topic,
      angle: move.angle,
      format: move.format,
      hook: move.hook,
      outline: move.outline,
      cta: move.cta,
      priority: move.priority,
      confidence: move.confidence,
      valid_until: move.validUntil,
    },
    action_details: move.details,
    ...(move.draftContent === undefined ? {} : { draft_content: move.draftContent }),
    why_now: { summary: "Exact persisted why-now explanation." },
    evidence: exactEvidence,
    limitations: ["No investment-return claim is supported."],
    founder_reviewed: false,
    auto_publish: false,
  };
}

describe("NextDistributionContentProposalV1", () => {
  it("maps PUBLISH draft content and the complete exact blueprint fields", () => {
    const input = proposalInput("PUBLISH");
    const proposal = mapNextDistributionContentProposalV1(input);

    expect(proposal.action).toBe("PUBLISH");
    if (proposal.action !== "PUBLISH" || input.action_details.action !== "PUBLISH") return;
    expect(proposal).toMatchObject({
      destination: input.next_move.channel,
      act_before: input.action_details.publish_by,
      content: input.draft_content,
      product_role: input.action_details.blueprint.product_role,
      hook: input.next_move.hook,
      structure: input.action_details.blueprint.structure,
      cta: input.action_details.blueprint.cta,
      effort_minutes: null,
      founder_reviewed: false,
      auto_publish: false,
    });
    expect(proposal.evidence).toBe(input.evidence);
    expect(proposal.limitations).toBe(input.limitations);
  });

  it("maps a brief PUBLISH result to the full blueprint instead of an empty draft", () => {
    const input = proposalInput("PUBLISH", "brief");
    const proposal = mapNextDistributionContentProposalV1(input);

    expect(proposal.action).toBe("PUBLISH");
    if (proposal.action !== "PUBLISH" || input.action_details.action !== "PUBLISH") return;
    expect(proposal.content).toBe(input.action_details.blueprint);
  });

  it("maps REPLY to the exact target, suggested reply, optional target facts, and deadline", () => {
    const input = proposalInput("REPLY");
    const proposal = mapNextDistributionContentProposalV1(input);

    expect(proposal.action).toBe("REPLY");
    if (proposal.action !== "REPLY" || input.action_details.action !== "REPLY") return;
    const target = input.action_details.primary_target;
    expect(proposal).toMatchObject({
      destination: target.url,
      content: target.suggested_reply,
      product_role: target.credibility_reason,
      source: target.source,
      author: target.author,
      title_or_excerpt: target.title_or_excerpt,
      short_reply_variant: target.short_reply_variant,
      reply_by: target.reply_by,
      act_before: target.reply_by,
    });
  });

  it("fails closed when a REPLY channel or source is not the exact supported target", () => {
    const input = proposalInput("REPLY");
    if (input.action_details.action !== "REPLY") return;
    const details = input.action_details;

    expect(() =>
      mapNextDistributionContentProposalV1({
        ...input,
        next_move: { ...input.next_move, channel: "linkedin" },
      }),
    ).toThrow(/channel must match/i);
    expect(() =>
      mapNextDistributionContentProposalV1({
        ...input,
        action_details: {
          ...details,
          primary_target: { ...details.primary_target, source: "website" as "x" },
        },
      }),
    ).toThrow(/X or Hacker News/i);
  });

  it("hands an agent the exact proposal without asking it to re-decide facts", () => {
    const proposal = mapNextDistributionContentProposalV1(proposalInput("REPLY"));
    const handoff = buildNextDistributionContentAgentHandoffV1(proposal);
    const serialized = handoff.split("PERSISTED_PROPOSAL_JSON\n\n")[1];

    expect(handoff).toMatch(/do not choose a new opportunity/i);
    expect(handoff).toMatch(/Do not change the action, channel, destination, evidence set/i);
    expect(handoff).toMatch(/Never publish, post, or reply without explicit founder action/i);
    expect(serialized).toBeDefined();
    expect(JSON.parse(serialized!)).toEqual(proposal);
  });

  it("maps REMIX to exact source URLs, draft, transformation boundaries, and deadline", () => {
    const input = proposalInput("REMIX");
    const proposal = mapNextDistributionContentProposalV1(input);

    expect(proposal.action).toBe("REMIX");
    if (proposal.action !== "REMIX" || input.action_details.action !== "REMIX") return;
    expect(proposal).toMatchObject({
      destination: input.next_move.channel,
      content: input.draft_content,
      source_content: input.action_details.source_content,
      preserve: input.action_details.preserve,
      transform: input.action_details.transform,
      do_not_copy: input.action_details.do_not_copy,
      remix_by: input.action_details.remix_by,
      act_before: input.action_details.remix_by,
    });
    expect(proposal.source_content[0]?.url).toBe("https://www.youtube.com/watch?v=exact");
  });

  it("maps WAIT without fake content, destination, effort, or product role", () => {
    const input = proposalInput("WAIT");
    const proposal = mapNextDistributionContentProposalV1(input);

    expect(proposal.action).toBe("WAIT");
    if (proposal.action !== "WAIT" || input.action_details.action !== "WAIT") return;
    expect(proposal).toMatchObject({
      destination: null,
      content: null,
      product_role: null,
      effort_minutes: null,
      failure_reasons: input.action_details.failure_reasons,
      do_not_act_on: input.action_details.do_not_act_on,
      watch_conditions: input.action_details.watch_conditions,
      recheck_at: input.action_details.recheck_at,
      act_before: input.action_details.recheck_at,
    });
    expect(proposal.evidence).toBe(input.evidence);
    expect(proposal.evidence).not.toEqual([]);
  });

  it("rejects a mismatched action instead of inventing a fallback mapping", () => {
    const input = proposalInput("PUBLISH");
    const reply = proposalInput("REPLY");

    expect(() =>
      mapNextDistributionContentProposalV1({
        ...input,
        action_details: reply.action_details,
      }),
    ).toThrow(/do not match/i);
  });
});
