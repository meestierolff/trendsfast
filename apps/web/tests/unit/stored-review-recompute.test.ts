import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const orchestration = vi.hoisted(() => ({
  decide: vi.fn(async (input: { signals: Array<{ id: string }> }) => ({
    move: {
      action: "WAIT",
      channel: "hacker_news",
      topic: "Wait for stronger evidence",
      angle: "The stored evidence is not yet sufficient.",
      format: "founder_text",
      hook: "Do not overclaim.",
      outline: ["Explain the evidence gap"],
      cta: "Collect another independent signal.",
      priority: 20,
      confidence: 0.2,
      validUntil: "2026-08-15T12:00:00.000Z",
    },
    evidenceSignalIds: input.signals.map((signal) => signal.id),
    whyNow: "The current evidence remains bounded.",
    limitations: [],
    promptVersion: "deterministic-v1",
    scoreVersion: "score-v1",
    signalClass: "INSUFFICIENT",
    saturation: "UNKNOWN",
    independentSourceCount: 0,
  })),
  storedSignal: vi.fn((row: { signal: { id: string } }) => ({ id: row.signal.id })),
  measurementFragment: vi.fn(() => []),
}));

vi.mock("@trendsfast/orchestration", () => ({
  decideDeterministically: orchestration.decide,
  storedSignal: orchestration.storedSignal,
  measurementFragment: orchestration.measurementFragment,
}));

import { recomputeStoredReview } from "../../lib/stored-review-recompute";

const context = {
  name: "TrendsFast",
  url: "https://trendsfast.example/",
  category: "distribution research",
  audience: "technical founders",
  problem: "distribution research takes too long",
  desiredOutcome: "choose one evidence-backed move",
  credibleClaims: ["founder-reviewed recommendations"],
  alternatives: ["manual research"],
  competitors: [],
  markets: ["US"],
  language: "en",
  suitableChannels: ["hacker_news"],
  availableFormats: ["founder_text"],
  credibleTopics: ["distribution"],
  assumptions: [],
};

describe("stored-evidence recompute truth boundary", () => {
  beforeEach(() => vi.clearAllMocks());

  it("excludes a current-version founder-rejected signal without excluding unbound stored signals", async () => {
    const persist = vi.fn(async (input) => input);
    const repositories = {
      scans: {
        getStatusByPublicId: vi.fn(async () => ({
          request: { state: "REVIEW_REQUIRED" },
          run: { id: "run_1" },
          move: { id: "move_1", reviewVersion: 4 },
          context,
          project: { id: "project_1" },
        })),
      },
      scanData: {
        listSignalsForRun: vi.fn(async () => [
          { signal: { id: "signal_rejected" } },
          { signal: { id: "signal_historically_rejected" } },
          { signal: { id: "signal_retained" } },
          { signal: { id: "signal_unbound" } },
        ]),
        listHistoricalMetricSnapshotsForRun: vi.fn(async () => []),
        listSourceRuns: vi.fn(async () => []),
        getCurrentProjectProfile: vi.fn(async () => null),
      },
      reviews: {
        listEvidenceHistory: vi.fn(async () => [
          { signalId: "signal_rejected", moveVersion: 4, availability: "REJECTED" },
          { signalId: "signal_retained", moveVersion: 4, availability: "AVAILABLE" },
          { signalId: "signal_rejected", moveVersion: 3, availability: "AVAILABLE" },
          {
            signalId: "signal_historically_rejected",
            moveVersion: 2,
            availability: "REJECTED",
          },
        ]),
        recomputeFromStoredEvidence: persist,
      },
    };

    await recomputeStoredReview(repositories as never, {
      scanPublicId: "scan_public_1",
      nextMoveId: "move_1",
      reviewerId: "founder:reviewer",
      expectedVersion: 4,
      reason: "Re-evaluate only evidence that remains eligible for founder review.",
      now: new Date("2026-08-12T12:00:00.000Z"),
    });

    expect(orchestration.decide).toHaveBeenCalledWith(
      expect.objectContaining({
        signals: [{ id: "signal_retained" }, { id: "signal_unbound" }],
      }),
    );
    expect(persist).toHaveBeenCalledWith(
      expect.objectContaining({
        draft: expect.objectContaining({
          evidenceSignalIds: ["signal_retained", "signal_unbound"],
        }),
      }),
    );
  });
});
