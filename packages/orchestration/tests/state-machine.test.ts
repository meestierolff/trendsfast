import { describe, expect, it, vi } from "vitest";
import type { ProjectContext } from "@trendsfast/schemas";
import type { ProviderRunResult, ProviderSlug, QueryPlan } from "@trendsfast/providers";
import {
  processScan,
  ProviderOutcomeUnknownError,
  ScanDeadlineError,
  StaleProcessingClaimError,
  type DecisionDraft,
  type ProviderRunner,
  type ProcessingStore,
} from "../src/state-machine";
import {
  ModelCostSettlementError,
  type ModelCostReservation,
  type ModelCostSettlement,
} from "../src/synthesis";

const project: ProjectContext = {
  name: "Example",
  url: "https://example.com",
  category: "developer tool",
  audience: "technical founders",
  problem: "distribution research takes too long",
  desiredOutcome: "choose a credible next action",
  credibleClaims: [],
  alternatives: [],
  competitors: [],
  markets: ["US"],
  language: "en",
  suitableChannels: ["x"],
  availableFormats: ["founder_text"],
  credibleTopics: ["distribution research"],
  assumptions: ["Fixture context"],
};

const plan: QueryPlan = {
  version: "query-plan-v1",
  generatedAt: "2026-08-11T12:00:00.000Z",
  entries: [
    {
      id: "query_hn",
      provider: "hacker_news",
      role: "developer_pain",
      query: "founder distribution",
      limit: 5,
      lookbackHours: 168,
    },
    {
      id: "query_gh",
      provider: "github",
      role: "repository_adoption",
      query: "distribution agent",
      limit: 5,
    },
  ],
};

function result(provider: ProviderSlug, cost = 0, actualCost = cost): ProviderRunResult {
  return {
    provider,
    status: "SUCCESS",
    signals: [],
    measurements: [],
    calls: 1,
    attempts: 1,
    quota: { used: 1 },
    cost: { estimatedUsd: cost, actualUsd: actualCost },
    startedAt: "2026-08-11T12:00:00.000Z",
    finishedAt: "2026-08-11T12:00:01.000Z",
    limitations: [],
    errors: [],
  };
}

async function accountedResult(
  provider: ProviderSlug,
  budget: Parameters<ProviderRunner["execute"]>[2],
  value = result(provider),
): Promise<ProviderRunResult> {
  await budget.reserveAttempt({
    provider,
    attempt: 1,
    estimatedCostUsd: value.cost.estimatedUsd,
    calls: value.calls,
    quotaUnits: value.quota.used,
  });
  await budget.settleAttempt({
    provider,
    attempt: 1,
    estimatedCostUsd: value.cost.estimatedUsd,
    calls: value.calls,
    quotaUnits: value.quota.used,
    ...(value.cost.actualUsd === undefined ? {} : { actualCostUsd: value.cost.actualUsd }),
    actualQuotaUnits: value.quota.used,
    status: value.status,
    finishedAt: value.finishedAt,
  });
  return value;
}

function waitDraft(topic = "Wait for stronger evidence"): DecisionDraft {
  return {
    move: {
      action: "WAIT",
      channel: "x",
      topic,
      angle: "Hold the draft.",
      format: "founder_text",
      hook: "Do not force it.",
      outline: ["Recheck later"],
      cta: "None",
      priority: 0,
      confidence: 0.9,
      validUntil: "2026-08-14T12:00:00.000Z",
    },
    whyNow: "Evidence is insufficient.",
    signalClass: "INSUFFICIENT_SIGNAL",
    independentSourceCount: 0,
    saturation: "unknown",
    limitations: ["No action cleared the quality floor"],
    evidenceSignalIds: [],
    promptVersion: "fixture-v1",
    scoreVersion: "opportunity-v1",
  };
}

function modelReservation(
  operation: "context" | "synthesis",
  estimatedCostUsd: number,
): ModelCostReservation {
  return {
    ledgerKey: `model:${operation}:attempt:1`,
    provider: "openai",
    model: "priced-model",
    operation,
    attempt: 1,
    inputBytes: 1_000,
    inputTokenUpperBound: 1_256,
    outputTokenUpperBound: 512,
    inputUsdPerMillionTokens: 1,
    outputUsdPerMillionTokens: 2,
    estimatedCostUsd,
  };
}

function modelSettlement(operation: "context" | "synthesis"): ModelCostSettlement {
  return {
    ledgerKey: `model:${operation}:attempt:1`,
    provider: "openai",
    model: "priced-model",
    operation,
    attempt: 1,
    inputTokens: 100,
    outputTokens: 20,
    actualCostUsd: 0.00014,
    finishedAt: "2026-08-11T12:00:01.000Z",
  };
}

function store(sourceStates: Partial<Record<ProviderSlug, string>> = {}) {
  const events: string[] = [];
  let committedProviderCostUsd = 0;
  const providerEstimates = new Map<string, number>();
  const fixture: ProcessingStore = {
    load: vi.fn(async () => ({
      requestId: "request_1",
      publicId: "scan_1",
      url: "https://example.com",
      state: "QUEUED" as const,
    })),
    claim: vi.fn(async () => ({
      requestId: "request_1",
      runId: "run_1",
      processingFence: "fence_1",
      state: "RUNNING" as const,
      sourceStates,
    })),
    saveContext: vi.fn(async () => {
      events.push("context");
      return { contextVersionId: "context_1" };
    }),
    saveQueryPlan: vi.fn(async () => {
      events.push("plan");
    }),
    beginProvider: vi.fn(async (provider) => {
      events.push(`begin:${provider}`);
    }),
    completeProvider: vi.fn(async (provider) => {
      events.push(`complete:${provider}`);
    }),
    failProvider: vi.fn(async (provider) => {
      events.push(`fail:${provider}`);
    }),
    reserveProviderAttempt: vi.fn(async (_claim, reservation) => {
      const key = `${reservation.provider}:${reservation.attempt}`;
      if (providerEstimates.has(key)) {
        return { created: false, projectedCostUsd: committedProviderCostUsd };
      }
      providerEstimates.set(key, reservation.estimatedCostUsd);
      committedProviderCostUsd += reservation.estimatedCostUsd;
      return { created: true, projectedCostUsd: committedProviderCostUsd };
    }),
    settleProviderAttempt: vi.fn(async (_claim, settlement) => {
      const estimate = providerEstimates.get(`${settlement.provider}:${settlement.attempt}`) ?? 0;
      committedProviderCostUsd += Math.max(0, (settlement.actualCostUsd ?? 0) - estimate);
      return { committedCostUsd: committedProviderCostUsd };
    }),
    reserveModelCost: vi.fn(async () => ({ created: true, projectedCostUsd: 0 })),
    settleModelCost: vi.fn(async () => ({ committedCostUsd: 0 })),
    loadCollectedData: vi.fn(async () => ({ signals: [], measurements: [], coverage: {} })),
    saveDraft: vi.fn(async () => {
      events.push("draft");
      return { nextMoveId: "move_1" };
    }),
    requireReview: vi.fn(async () => {
      events.push("review");
    }),
    failScan: vi.fn(async (_ids, code) => {
      events.push(`scan-failed:${code}`);
    }),
  };
  return { fixture, events };
}

describe("resumable scan state machine", () => {
  it("persists before and after each external source and stops for founder review", async () => {
    const { fixture, events } = store();
    const output = await processScan("scan_1", {
      store: fixture,
      inferContext: vi.fn(async () => project),
      planQueries: vi.fn(() => plan),
      providers: {
        order: ["hacker_news", "github"],
        estimate: vi.fn(() => 0),
        execute: vi.fn(async (provider, _work, budget) => accountedResult(provider, budget)),
      },
      decide: vi.fn(async () => waitDraft()),
      maxCostUsd: 0.25,
      maxDurationMs: 60_000,
      now: () => new Date("2026-08-11T12:00:00.000Z"),
    });
    expect(output.state).toBe("REVIEW_REQUIRED");
    expect(events).toEqual([
      "begin:website",
      "complete:website",
      "context",
      "plan",
      "begin:hacker_news",
      "complete:hacker_news",
      "begin:github",
      "complete:github",
      "draft",
      "review",
    ]);
  });

  it("uses one persisted ceiling for context, synthesis, and provider work", async () => {
    const { fixture } = store();
    let committedCostUsd = 0;
    vi.mocked(fixture.reserveModelCost).mockImplementation(
      async (_claim, reservation, maximumCostUsd) => {
        committedCostUsd += reservation.estimatedCostUsd;
        expect(committedCostUsd).toBeLessThanOrEqual(maximumCostUsd);
        return { created: true, projectedCostUsd: committedCostUsd };
      },
    );

    const output = await processScan("scan_1", {
      store: fixture,
      inferContext: vi.fn(async (_url, _signals, controls) => {
        await controls.reserveModelCost(modelReservation("context", 0.04));
        return project;
      }),
      planQueries: vi.fn(() => plan),
      providers: {
        order: [],
        estimate: vi.fn(() => 0),
        execute: vi.fn(async (provider, _work, budget) => accountedResult(provider, budget)),
      },
      decide: vi.fn(async (input) => {
        await input.reserveModelCost(modelReservation("synthesis", 0.03));
        return waitDraft();
      }),
      maxCostUsd: 0.25,
      maxDurationMs: 60_000,
      now: () => new Date("2026-08-11T12:00:00.000Z"),
    });

    expect(output.costUsd).toBe(0.07);
    expect(fixture.reserveModelCost).toHaveBeenNthCalledWith(
      1,
      { requestId: "request_1", runId: "run_1", processingFence: "fence_1" },
      expect.objectContaining({ operation: "context", estimatedCostUsd: 0.04 }),
      0.25,
    );
    expect(fixture.reserveModelCost).toHaveBeenNthCalledWith(
      2,
      { requestId: "request_1", runId: "run_1", processingFence: "fence_1" },
      expect.objectContaining({ operation: "synthesis", estimatedCostUsd: 0.03 }),
      0.25,
    );
  });

  it("skips a completed provider when resuming", async () => {
    const { fixture } = store({ website: "SUCCEEDED", hacker_news: "SUCCEEDED" });
    const execute = vi.fn(async (provider: ProviderSlug) => result(provider));
    await processScan("scan_1", {
      store: fixture,
      inferContext: vi.fn(async () => project),
      planQueries: vi.fn(() => plan),
      providers: { order: ["hacker_news", "github"], estimate: vi.fn(() => 0), execute },
      decide: vi.fn(async () => waitDraft("Wait")),
      maxCostUsd: 0.25,
      maxDurationMs: 60_000,
      now: () => new Date("2026-08-11T12:00:00.000Z"),
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith("github", expect.anything(), expect.anything());
  });

  it("skips work that would cross the hard cost ceiling", async () => {
    const { fixture, events } = store();
    await processScan("scan_1", {
      store: fixture,
      inferContext: vi.fn(async () => project),
      planQueries: vi.fn(() => plan),
      providers: {
        order: ["hacker_news", "github"],
        estimate: vi.fn(() => 0.2),
        execute: vi.fn(async (provider, _work, budget) =>
          accountedResult(provider, budget, result(provider, 0.2)),
        ),
      },
      decide: vi.fn(async () => waitDraft("Budget-limited wait")),
      maxCostUsd: 0.25,
      maxDurationMs: 60_000,
      now: () => new Date("2026-08-11T12:00:00.000Z"),
    });
    expect(events).toContain("fail:github");
    expect(events).not.toContain("begin:github");
  });

  it("keeps a provider estimate committed when its reported actual is lower", async () => {
    const { fixture, events } = store();
    await processScan("scan_1", {
      store: fixture,
      inferContext: vi.fn(async () => project),
      planQueries: vi.fn(() => plan),
      providers: {
        order: ["hacker_news", "github"],
        estimate: vi.fn((provider) =>
          provider === "hacker_news" ? 0.2 : provider === "github" ? 0.1 : 0,
        ),
        execute: vi.fn(async (provider, _work, budget) =>
          accountedResult(
            provider,
            budget,
            provider === "hacker_news" ? result(provider, 0.2, 0.01) : result(provider),
          ),
        ),
      },
      decide: vi.fn(async () => waitDraft("Conservative budget wait")),
      maxCostUsd: 0.25,
      maxDurationMs: 60_000,
      now: () => new Date("2026-08-11T12:00:00.000Z"),
    });

    expect(events).toContain("complete:hacker_news");
    expect(events).toContain("fail:github");
    expect(events).not.toContain("begin:github");
  });

  it("does not duplicate work after review is required", async () => {
    const { fixture } = store();
    vi.mocked(fixture.load).mockResolvedValue({
      requestId: "request_1",
      publicId: "scan_1",
      url: "https://example.com",
      state: "REVIEW_REQUIRED",
    });
    const output = await processScan("scan_1", {
      store: fixture,
      inferContext: vi.fn(),
      planQueries: vi.fn(),
      providers: { order: [], estimate: vi.fn(), execute: vi.fn() },
      decide: vi.fn(),
      maxCostUsd: 0.25,
      maxDurationMs: 60_000,
    });
    expect(output.state).toBe("REVIEW_REQUIRED");
    expect(fixture.claim).not.toHaveBeenCalled();
  });

  it("persists a bounded failure when the deadline is already exhausted", async () => {
    const { fixture } = store();
    const times = [new Date("2026-08-11T12:00:00.000Z"), new Date("2026-08-11T12:01:01.000Z")];
    await expect(
      processScan("scan_1", {
        store: fixture,
        inferContext: vi.fn(async () => project),
        planQueries: vi.fn(() => plan),
        providers: { order: ["hacker_news"], estimate: vi.fn(() => 0), execute: vi.fn() },
        decide: vi.fn(),
        maxCostUsd: 0.25,
        maxDurationMs: 60_000,
        now: () => times.shift() ?? new Date("2026-08-11T12:01:01.000Z"),
      }),
    ).rejects.toBeInstanceOf(ScanDeadlineError);
    expect(fixture.failScan).toHaveBeenCalledWith(
      expect.anything(),
      "SCAN_DEADLINE_EXCEEDED",
      expect.any(String),
    );
  });

  it("never grants a fresh hard deadline to an expired resumed run", async () => {
    const { fixture } = store({ website: "SUCCEEDED" });
    vi.mocked(fixture.claim).mockResolvedValue({
      requestId: "request_1",
      runId: "run_1",
      processingFence: "fence_1",
      state: "RUNNING",
      sourceStates: { website: "SUCCEEDED" },
      hardDeadlineAt: new Date("2026-08-11T11:59:59.000Z"),
    });
    const execute = vi.fn();

    await expect(
      processScan("scan_1", {
        store: fixture,
        inferContext: vi.fn(async () => project),
        planQueries: vi.fn(() => plan),
        providers: { order: ["website"], estimate: vi.fn(() => 0), execute },
        decide: vi.fn(async () => waitDraft()),
        maxCostUsd: 0.25,
        maxDurationMs: 60_000,
        now: () => new Date("2026-08-11T12:00:00.000Z"),
      }),
    ).rejects.toBeInstanceOf(ScanDeadlineError);

    expect(execute).not.toHaveBeenCalled();
    expect(fixture.failScan).toHaveBeenCalledWith(
      expect.anything(),
      "SCAN_DEADLINE_EXCEEDED",
      expect.any(String),
    );
  });

  it("classifies an interrupted provider before an expired resumed-run deadline", async () => {
    const { fixture } = store({ hacker_news: "RUNNING" });
    vi.mocked(fixture.claim).mockResolvedValue({
      requestId: "request_1",
      runId: "run_1",
      processingFence: "fence_1",
      state: "RUNNING",
      sourceStates: { hacker_news: "RUNNING" },
      hardDeadlineAt: new Date("2026-08-11T11:59:59.000Z"),
    });

    await expect(
      processScan("scan_1", {
        store: fixture,
        inferContext: vi.fn(async () => project),
        planQueries: vi.fn(() => plan),
        providers: { order: ["hacker_news"], estimate: vi.fn(() => 0), execute: vi.fn() },
        decide: vi.fn(async () => waitDraft()),
        maxCostUsd: 0.25,
        maxDurationMs: 60_000,
        now: () => new Date("2026-08-11T12:00:00.000Z"),
      }),
    ).rejects.toBeInstanceOf(ProviderOutcomeUnknownError);

    expect(fixture.failScan).toHaveBeenCalledWith(
      expect.anything(),
      "PROVIDER_OUTCOME_UNKNOWN",
      expect.stringMatching(/automatic replay is disabled/i),
    );
  });

  it("does not replay a provider whose external effect was left indeterminate", async () => {
    const { fixture } = store({ website: "SUCCEEDED", hacker_news: "RUNNING" });
    vi.mocked(fixture.claim).mockResolvedValue({
      requestId: "request_1",
      runId: "run_1",
      processingFence: "fence_1",
      state: "RUNNING",
      context: project,
      contextVersionId: "context_1",
      queryPlan: plan,
      sourceStates: { website: "SUCCEEDED", hacker_news: "RUNNING" },
      hardDeadlineAt: new Date("2026-08-11T12:01:00.000Z"),
    });
    const execute = vi.fn();

    await expect(
      processScan("scan_1", {
        store: fixture,
        inferContext: vi.fn(async () => project),
        planQueries: vi.fn(() => plan),
        providers: { order: ["hacker_news", "github"], estimate: vi.fn(() => 0), execute },
        decide: vi.fn(async () => waitDraft()),
        maxCostUsd: 0.25,
        maxDurationMs: 60_000,
        now: () => new Date("2026-08-11T12:00:00.000Z"),
      }),
    ).rejects.toBeInstanceOf(ProviderOutcomeUnknownError);

    expect(execute).not.toHaveBeenCalled();
    expect(fixture.failScan).toHaveBeenCalledWith(
      expect.anything(),
      "PROVIDER_OUTCOME_UNKNOWN",
      expect.stringMatching(/automatic replay is disabled/i),
    );
  });

  it("stops a stale worker without overwriting the current owner's state", async () => {
    const { fixture } = store();
    vi.mocked(fixture.completeProvider).mockRejectedValue(
      new StaleProcessingClaimError("claim rotated"),
    );
    vi.mocked(fixture.failProvider).mockRejectedValue(
      new StaleProcessingClaimError("claim rotated"),
    );

    const output = await processScan("scan_1", {
      store: fixture,
      inferContext: vi.fn(async () => project),
      planQueries: vi.fn(() => plan),
      providers: {
        order: ["hacker_news"],
        estimate: vi.fn(() => 0),
        execute: vi.fn(async (provider, _work, budget) => accountedResult(provider, budget)),
      },
      decide: vi.fn(async () => waitDraft()),
      maxCostUsd: 0.25,
      maxDurationMs: 60_000,
      now: () => new Date("2026-08-11T12:00:00.000Z"),
    });

    expect(output.state).toBe("RUNNING");
    expect(fixture.failProvider).not.toHaveBeenCalled();
    expect(fixture.failScan).not.toHaveBeenCalled();
  });

  it("fails the scan as outcome-unknown when post-effect cost settlement cannot commit", async () => {
    const { fixture } = store();
    vi.mocked(fixture.settleProviderAttempt).mockImplementation(async (_claim, settlement) => {
      if (settlement.provider === "hacker_news") {
        throw new Error("database write unavailable after provider response");
      }
      return { committedCostUsd: 0 };
    });
    const execute = vi.fn(async (provider: ProviderSlug, _work, budget) =>
      accountedResult(provider, budget, result(provider, 0.02, 0.01)),
    );

    await expect(
      processScan("scan_1", {
        store: fixture,
        inferContext: vi.fn(async () => project),
        planQueries: vi.fn(() => plan),
        providers: { order: ["hacker_news", "github"], estimate: vi.fn(() => 0.02), execute },
        decide: vi.fn(async () => waitDraft()),
        maxCostUsd: 0.25,
        maxDurationMs: 60_000,
        now: () => new Date("2026-08-11T12:00:00.000Z"),
      }),
    ).rejects.toBeInstanceOf(ProviderOutcomeUnknownError);

    expect(execute).toHaveBeenCalledTimes(2); // website context, then the first planned provider
    expect(fixture.completeProvider).toHaveBeenCalledTimes(1); // website only
    expect(fixture.failProvider).not.toHaveBeenCalled();
    expect(fixture.failScan).toHaveBeenCalledWith(
      expect.anything(),
      "PROVIDER_OUTCOME_UNKNOWN",
      expect.stringMatching(/cost outcome could not be durably settled/i),
    );
  });

  it("fails model work as outcome-unknown when reported usage cannot settle", async () => {
    const { fixture } = store({ website: "SUCCEEDED" });
    vi.mocked(fixture.settleModelCost).mockRejectedValue(
      new Error("database write unavailable after model response"),
    );

    await expect(
      processScan("scan_1", {
        store: fixture,
        inferContext: vi.fn(async (_url, _signals, controls) => {
          await controls.reserveModelCost(modelReservation("context", 0.04));
          await controls.settleModelCost(modelSettlement("context"));
          return project;
        }),
        planQueries: vi.fn(() => plan),
        providers: { order: [], estimate: vi.fn(() => 0), execute: vi.fn() },
        decide: vi.fn(async () => waitDraft()),
        maxCostUsd: 0.25,
        maxDurationMs: 60_000,
        now: () => new Date("2026-08-11T12:00:00.000Z"),
      }),
    ).rejects.toBeInstanceOf(ModelCostSettlementError);

    expect(fixture.saveContext).not.toHaveBeenCalled();
    expect(fixture.failScan).toHaveBeenCalledWith(
      expect.anything(),
      "MODEL_OUTCOME_UNKNOWN",
      expect.stringMatching(/cost outcome could not be durably settled/i),
    );
  });
});
