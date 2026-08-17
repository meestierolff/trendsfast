import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const environment = vi.hoisted(() => ({ credentialMode: "fixture" }));
vi.mock("@trendsfast/config", () => ({
  loadEnv: () => ({ PROVIDER_CREDENTIAL_MODE: environment.credentialMode }),
}));

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
  measurementFragment: vi.fn(
    (value: { measurements?: Array<{ id: string }> } | null) => value?.measurements ?? [],
  ),
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
  beforeEach(() => {
    vi.clearAllMocks();
    environment.credentialMode = "fixture";
  });

  it("excludes a current-version founder-rejected signal without excluding unbound stored signals", async () => {
    const persist = vi.fn(async (input) => input);
    const repositories = {
      scans: {
        getStatusByPublicId: vi.fn(async () => ({
          request: { state: "REVIEW_REQUIRED" },
          run: { id: "run_1" },
          move: {
            id: "move_1",
            reviewVersion: 4,
            validUntil: new Date("2026-08-16T12:00:00.000Z"),
          },
          context,
          project: { id: "project_1" },
        })),
      },
      scanData: {
        listSignalsForRun: vi.fn(async () => [
          {
            signal: { id: "signal_rejected" },
            sourceRun: { id: "source_succeeded", state: "SUCCEEDED" },
          },
          {
            signal: { id: "signal_historically_rejected" },
            sourceRun: { id: "source_succeeded", state: "SUCCEEDED" },
          },
          {
            signal: { id: "signal_retained" },
            sourceRun: { id: "source_succeeded", state: "SUCCEEDED" },
          },
          {
            signal: { id: "signal_unbound" },
            sourceRun: { id: "source_succeeded", state: "SUCCEEDED" },
          },
        ]),
        listHistoricalMetricSnapshotsForRun: vi.fn(async () => []),
        listSourceRuns: vi.fn(async () => [
          {
            id: "source_succeeded",
            source: "hacker_news",
            state: "SUCCEEDED",
            providerPayloadFragment: null,
          },
        ]),
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

  it("matches managed live eligibility by excluding degraded evidence, measurements, and historical snapshots", async () => {
    environment.credentialMode = "managed";
    const persist = vi.fn(async (input) => input);
    const historicalSnapshots = vi.fn(async () => [
      {
        signalId: "signal_succeeded",
        observedAt: new Date("2026-08-11T12:00:00.000Z"),
        metrics: { points: 10 },
      },
    ]);
    const repositories = {
      scans: {
        getStatusByPublicId: vi.fn(async () => ({
          request: { state: "REVIEW_REQUIRED", goal: null, generationLevel: "brief" },
          run: { id: "run_1" },
          move: {
            id: "move_1",
            reviewVersion: 4,
            validUntil: new Date("2026-08-14T12:00:00.000Z"),
          },
          context,
          project: { id: "project_1" },
        })),
      },
      scanData: {
        listSignalsForRun: vi.fn(async () => [
          {
            signal: { id: "signal_succeeded" },
            sourceRun: { id: "source_succeeded", state: "SUCCEEDED" },
          },
          {
            signal: { id: "signal_degraded" },
            sourceRun: { id: "source_degraded", state: "DEGRADED" },
          },
        ]),
        listHistoricalMetricSnapshotsForRun: historicalSnapshots,
        listSourceRuns: vi.fn(async () => [
          {
            id: "source_succeeded",
            source: "hacker_news",
            state: "SUCCEEDED",
            providerPayloadFragment: { measurements: [{ id: "measurement_succeeded" }] },
          },
          {
            id: "source_degraded",
            source: "x",
            state: "DEGRADED",
            providerPayloadFragment: { measurements: [{ id: "measurement_degraded" }] },
          },
        ]),
        getCurrentProjectProfile: vi.fn(async () => null),
      },
      reviews: {
        listEvidenceHistory: vi.fn(async () => []),
        recomputeFromStoredEvidence: persist,
      },
    };

    await recomputeStoredReview(repositories as never, {
      scanPublicId: "scan_public_1",
      nextMoveId: "move_1",
      reviewerId: "founder:reviewer",
      expectedVersion: 4,
      reason: "Recompute against exact live-eligible current-run evidence only.",
      now: new Date("2026-08-12T12:00:00.000Z"),
    });

    expect(historicalSnapshots).not.toHaveBeenCalled();
    expect(orchestration.decide).toHaveBeenCalledWith(
      expect.objectContaining({
        signals: [{ id: "signal_succeeded" }],
        snapshots: [],
        measurements: [{ id: "measurement_succeeded" }],
        coverage: { hacker_news: "SUCCEEDED", x: "DEGRADED" },
      }),
    );
    expect(persist).toHaveBeenCalledWith(
      expect.objectContaining({
        draft: expect.objectContaining({
          move: expect.objectContaining({ validUntil: "2026-08-14T12:00:00.000Z" }),
        }),
      }),
    );
  });
});
