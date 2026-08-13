import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const repositories = vi.hoisted(() => ({
  getStatusByPublicId: vi.fn(),
  listSignalsForRun: vi.fn(),
  appendOnce: vi.fn(),
}));

vi.mock("../../lib/server-database", () => ({
  getRepositories: () => ({
    scans: {
      getStatusByPublicId: repositories.getStatusByPublicId,
      getPublicStatusByPublicId: repositories.getStatusByPublicId,
    },
    scanData: {
      listSignalsForRun: repositories.listSignalsForRun,
      listPublicSignalsForRun: repositories.listSignalsForRun,
      listPublicSourceStatesForRun: vi.fn(async () => []),
      listSourceRuns: vi.fn(async () => []),
    },
    delivery: { getResultByToken: vi.fn(async () => null) },
    analytics: { appendOnce: repositories.appendOnce },
  }),
}));

import { getReadyResultByToken, getScanStatusByToken } from "../../lib/scan-view-service";

const validUntil = new Date("2036-08-14T10:00:00.000Z");
const observedAt = new Date("2026-08-13T09:00:00.000Z");
const publishedAt = new Date("2026-08-13T07:00:00.000Z");

function readyStatus(proposalStale = false) {
  return {
    request: {
      id: "request_1",
      publicId: "scan_ready",
      state: "READY",
      submittedUrl: "https://example.com",
      submittedAt: observedAt,
      failureCode: null,
    },
    run: { id: "run_1" },
    move: {
      id: "move_internal",
      publicId: "move_public",
      scanRunId: "run_1",
      state: "READY",
      action: "REPLY",
      channel: "x",
      topic: "A stored founder conversation",
      angle: "Contribute an evidence framework.",
      format: "technical_reply",
      hook: "Separate evidence from assumptions.",
      outline: ["Answer directly", "Show the rule"],
      cta: "Offer an example only if useful.",
      priority: 74,
      confidence: "0.74000",
      whyNow: "One exact current conversation is exceptionally relevant.",
      signalClass: "EMERGING_SIGNAL",
      independentSourceCount: 1,
      saturation: "low",
      limitations: ["One-source inference supports REPLY only."],
      founderReviewed: true,
      autoPublish: false,
      proposalStale,
      decisionContractVersion: "next-move-v1",
      generationLevel: "brief",
      draftContent: null,
      validUntil,
      actionDetails: {
        action: "REPLY",
        primary_target: {
          source: "x",
          url: "https://x.com/stored/status/1",
          author: "stored-author",
          title_or_excerpt: "Stored source title",
          published_at: publishedAt.toISOString(),
          observed_at: observedAt.toISOString(),
          why_this_target: "This exact stored conversation matches the audience problem.",
          credibility_reason: "The product has a concrete framework to contribute.",
          reply_objective: "Help participants make the next decision.",
          reply_angle: "Separate observed evidence from assumptions.",
          suggested_reply: "Separate evidence from assumptions, then show the trade-off.",
          tone: ["helpful", "non-promotional"],
          reply_by: validUntil.toISOString(),
        },
        secondary_targets: [],
      },
      trendWindow: {
        state: "EARLY",
        basis: "SINGLE_SIGNAL_INFERENCE",
        observed_since: publishedAt.toISOString(),
        last_confirmed_at: observedAt.toISOString(),
        recommended_action_by: validUntil.toISOString(),
        valid_until: validUntil.toISOString(),
        recheck_at: "2026-08-13T14:00:00.000Z",
        estimated_remaining_hours: { min: 4, max: 12 },
        confidence: 0.55,
        explanation: "One current source supports only a short inferred reply window.",
      },
      breakoutPotential: {
        level: "medium",
        basis: "HEURISTIC",
        factors: {
          audience_relevance: 0.9,
          timing: 0.8,
          novelty: 0.6,
          product_credibility: 0.72,
          format_fit: 0.8,
          saturation_risk: 0.2,
        },
        explanation: "A categorical heuristic label, not a probability.",
      },
    },
    context: {
      name: "Example",
      url: "https://example.com",
      category: "distribution intelligence",
      audience: "technical founders",
      problem: "Distribution research takes too long.",
      desiredOutcome: "Choose one timely move.",
      credibleClaims: ["Uses evidence receipts"],
      alternatives: ["manual research"],
      competitors: [],
      markets: ["US"],
      language: "en",
      suitableChannels: ["x"],
      availableFormats: ["founder_text"],
      credibleTopics: ["evidence-led distribution"],
      assumptions: [],
    },
    project: { id: "project_1", url: "https://example.com" },
    delivery: {
      id: "delivery_1",
      status: "DELIVERED",
      expiresAt: new Date("2037-08-13T10:00:00.000Z"),
    },
    evidence: [
      {
        id: "evidence_1",
        nextMoveId: "move_internal",
        moveVersion: 1,
        signalId: "signal_1",
        source: "x",
        canonicalUrl: "https://x.com/stored/status/1",
        title: "Stored source title",
        publishedAt,
        observedAt,
        reason: "The exact current conversation supports the reply.",
        provider: "fixture:x",
        bindingRole: "DECISION_SUPPORT",
        verified: true,
        availability: "AVAILABLE",
      },
    ],
  };
}

describe("enhanced private scan result", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    repositories.getStatusByPublicId.mockResolvedValue(readyStatus());
    repositories.listSignalsForRun.mockResolvedValue([
      {
        signal: {
          id: "signal_1",
          source: "x",
          sourceId: "stored-1",
          canonicalUrl: "https://x.com/stored/status/1",
          title: "Stored source title",
          textExcerpt: "Stored source excerpt",
          author: { handle: "stored-author" },
          publishedAt,
          observedAt,
          language: "en",
          metrics: { likes: 29 },
          queryId: "query_1",
          provider: "fixture:x",
          providerRequestId: "request_1",
          retrievedAt: observedAt,
          cached: false,
          rawPayloadHash: "sha256:stored",
          provenance: {},
        },
        sourceRun: {},
      },
    ]);
  });

  it("projects the current evidence-bound action payload and timing truth", async () => {
    await expect(getReadyResultByToken("scan_ready")).resolves.toMatchObject({
      contractVersion: "next-move-v1",
      generationLevel: "brief",
      actionDetails: {
        action: "REPLY",
        primary_target: { url: "https://x.com/stored/status/1", author: "stored-author" },
      },
      trendWindow: { state: "EARLY", basis: "SINGLE_SIGNAL_INFERENCE" },
      breakoutPotential: { level: "medium", basis: "HEURISTIC" },
      freshness: { state: "CURRENT", requires_new_scan: false },
    });
  });

  it("refuses stale and legacy READY rows as current private results", async () => {
    repositories.getStatusByPublicId.mockResolvedValue(readyStatus(true));
    await expect(getReadyResultByToken("scan_ready")).resolves.toBeNull();
    await expect(getScanStatusByToken("scan_ready")).resolves.toMatchObject({
      found: true,
      state: "READY",
      requiresNewScan: true,
    });

    const legacy = readyStatus();
    legacy.move.decisionContractVersion = null as unknown as "next-move-v1";
    repositories.getStatusByPublicId.mockResolvedValue(legacy);
    await expect(getReadyResultByToken("scan_ready")).resolves.toBeNull();
  });

  it("does not advertise a result token when strict action details are not evidence-bound", async () => {
    const corrupted = readyStatus();
    corrupted.move.actionDetails.primary_target.url = "https://x.com/invented/status/999";
    repositories.getStatusByPublicId.mockResolvedValue(corrupted);

    await expect(getScanStatusByToken("scan_ready")).resolves.toMatchObject({
      found: true,
      state: "READY",
      requiresNewScan: true,
    });
    const status = await getScanStatusByToken("scan_ready");
    expect(status).not.toHaveProperty("resultToken");
    await expect(getReadyResultByToken("scan_ready")).resolves.toBeNull();
  });

  it("stops polling when a reviewed result delivery is revoked", async () => {
    const revoked = readyStatus();
    revoked.delivery.status = "REVOKED";
    repositories.getStatusByPublicId.mockResolvedValue(revoked);

    await expect(getScanStatusByToken("scan_ready")).resolves.toMatchObject({
      found: true,
      state: "READY",
      requiresNewScan: true,
    });
    await expect(getReadyResultByToken("scan_ready")).resolves.toBeNull();
  });
});
