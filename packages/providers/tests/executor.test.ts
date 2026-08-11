import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  ProviderBudget,
  ProviderCircuitBreaker,
  ProviderError,
  createProviderContext,
  executeProvider,
  type ProviderAdapter,
  type ProviderRunRequest,
} from "../src/index";

const request: ProviderRunRequest = {
  scanId: "scan_executor",
  queries: [
    {
      id: "q1",
      provider: "hacker_news",
      role: "developer_pain",
      query: "developer distribution pain",
      limit: 10,
      lookbackHours: 168,
    },
  ],
};

function testAdapter(collect: ProviderAdapter["collect"]): ProviderAdapter {
  return {
    metadata: {
      slug: "hacker_news",
      publicName: "Hacker News",
      declaredStatus: "LIVE",
      capabilities: ["SEARCH"],
      requiredEnvironmentVariables: [],
      timeoutMs: 1_000,
      retryPolicy: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 2 },
      maxCallsPerScan: 5,
      maxResultsPerScan: 30,
    },
    requestSchema: z.custom<ProviderRunRequest>(),
    estimate: (runRequest) => ({
      calls: runRequest.queries.length,
      estimatedUsd: 0.02,
      quotaUnits: runRequest.queries.length,
    }),
    collect,
    healthCheck: async () => ({ status: "HEALTHY", checkedAt: "2026-08-11T08:00:00.000Z" }),
  };
}

describe("provider execution guardrails", () => {
  it("retries retryable errors with a bounded attempt count", async () => {
    const collect = vi
      .fn<ProviderAdapter["collect"]>()
      .mockRejectedValueOnce(
        new ProviderError("temporary", { retryable: true, code: "UPSTREAM_503" }),
      )
      .mockResolvedValue({
        provider: "hacker_news",
        status: "SUCCESS",
        signals: [],
        measurements: [],
        calls: 1,
        quota: { used: 1 },
        cost: { estimatedUsd: 0.02, actualUsd: 0.01 },
        startedAt: "2026-08-11T08:00:00.000Z",
        finishedAt: "2026-08-11T08:00:00.000Z",
        limitations: [],
        errors: [],
      });
    const sleep = vi.fn(async () => undefined);

    const result = await executeProvider(testAdapter(collect), request, {
      context: createProviderContext({
        credentialMode: "fixture",
        now: () => new Date("2026-08-11T08:00:00.000Z"),
        sleep,
      }),
      budget: new ProviderBudget(0.25),
      circuitBreaker: new ProviderCircuitBreaker(),
    });

    expect(result.status).toBe("SUCCESS");
    expect(result.attempts).toBe(2);
    expect(result.calls).toBe(2);
    expect(result.cost).toEqual({ estimatedUsd: 0.04, actualUsd: 0.03 });
    expect(collect).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it("never starts a paid retry that would cross the hard budget", async () => {
    const collect = vi
      .fn<ProviderAdapter["collect"]>()
      .mockRejectedValue(new ProviderError("temporary", { retryable: true, code: "UPSTREAM_503" }));
    const budget = new ProviderBudget(0.03);

    const result = await executeProvider(testAdapter(collect), request, {
      context: createProviderContext({
        credentialMode: "fixture",
        sleep: async () => undefined,
      }),
      budget,
      circuitBreaker: new ProviderCircuitBreaker(),
    });

    expect(result.status).toBe("BUDGET_EXCEEDED");
    expect(result.errors[0]?.code).toBe("PROVIDER_RETRY_COST_LIMIT");
    expect(result.attempts).toBe(1);
    expect(result.cost).toEqual({ estimatedUsd: 0.02, actualUsd: 0.02 });
    expect(collect).toHaveBeenCalledTimes(1);
    expect(budget.usedUsd).toBe(0.02);
  });

  it("returns a visible budget result without calling the provider", async () => {
    const collect = vi.fn<ProviderAdapter["collect"]>();
    const budget = new ProviderBudget(0.01);

    const result = await executeProvider(testAdapter(collect), request, {
      context: createProviderContext({ credentialMode: "fixture" }),
      budget,
      circuitBreaker: new ProviderCircuitBreaker(),
    });

    expect(result.status).toBe("BUDGET_EXCEEDED");
    expect(result.cost.estimatedUsd).toBe(0.02);
    expect(result.errors[0]?.code).toBe("PROVIDER_COST_LIMIT");
    expect(collect).not.toHaveBeenCalled();
  });

  it("opens a per-provider circuit after repeated terminal failures", async () => {
    const collect = vi
      .fn<ProviderAdapter["collect"]>()
      .mockRejectedValue(
        new ProviderError("bad request", { retryable: false, code: "UPSTREAM_400" }),
      );
    const breaker = new ProviderCircuitBreaker({ failureThreshold: 2, cooldownMs: 60_000 });
    const runtime = createProviderContext({
      credentialMode: "fixture",
      now: () => new Date("2026-08-11T08:00:00.000Z"),
    });

    const first = await executeProvider(testAdapter(collect), request, {
      context: runtime,
      budget: new ProviderBudget(1),
      circuitBreaker: breaker,
    });
    const second = await executeProvider(testAdapter(collect), request, {
      context: runtime,
      budget: new ProviderBudget(1),
      circuitBreaker: breaker,
    });
    const third = await executeProvider(testAdapter(collect), request, {
      context: runtime,
      budget: new ProviderBudget(1),
      circuitBreaker: breaker,
    });

    expect(first.status).toBe("FAILED");
    expect(second.status).toBe("FAILED");
    expect(third.status).toBe("CIRCUIT_OPEN");
    expect(collect).toHaveBeenCalledTimes(2);
  });

  it("rejects requests that exceed the adapter call cap", async () => {
    const collect = vi.fn<ProviderAdapter["collect"]>();
    const overflowingRequest = {
      ...request,
      queries: Array.from({ length: 6 }, (_, index) => ({
        ...request.queries[0]!,
        id: `q${index}`,
      })),
    };

    const result = await executeProvider(testAdapter(collect), overflowingRequest, {
      context: createProviderContext({ credentialMode: "fixture" }),
      budget: new ProviderBudget(1),
      circuitBreaker: new ProviderCircuitBreaker(),
    });

    expect(result.status).toBe("QUOTA_EXCEEDED");
    expect(result.errors[0]?.code).toBe("PROVIDER_CALL_LIMIT");
    expect(collect).not.toHaveBeenCalled();
  });

  it("discards provider data when reported actual cost breaches the hard scan ceiling", async () => {
    const collect = vi.fn<ProviderAdapter["collect"]>().mockResolvedValue({
      provider: "hacker_news",
      status: "SUCCESS",
      signals: [],
      measurements: [],
      calls: 1,
      quota: { used: 1 },
      cost: { estimatedUsd: 0.02, actualUsd: 0.3 },
      startedAt: "2026-08-11T08:00:00.000Z",
      finishedAt: "2026-08-11T08:00:01.000Z",
      limitations: [],
      errors: [],
    });
    const result = await executeProvider(testAdapter(collect), request, {
      context: createProviderContext({ credentialMode: "fixture" }),
      budget: new ProviderBudget(0.25),
      circuitBreaker: new ProviderCircuitBreaker(),
    });

    expect(result.status).toBe("BUDGET_EXCEEDED");
    expect(result.errors.at(-1)?.code).toBe("PROVIDER_ACTUAL_COST_LIMIT");
  });

  it("surfaces an upstream 429 as quota exhaustion", async () => {
    const collect = vi
      .fn<ProviderAdapter["collect"]>()
      .mockRejectedValue(
        new ProviderError("rate limited", { retryable: false, code: "UPSTREAM_HTTP_429" }),
      );
    const result = await executeProvider(testAdapter(collect), request, {
      context: createProviderContext({ credentialMode: "fixture" }),
      budget: new ProviderBudget(1),
      circuitBreaker: new ProviderCircuitBreaker(),
    });

    expect(result.status).toBe("QUOTA_EXCEEDED");
    expect(result.attempts).toBe(1);
  });

  it("does not start or retry work beyond the absolute scan deadline", async () => {
    const now = new Date("2026-08-11T08:00:00.000Z");
    const collect = vi.fn<ProviderAdapter["collect"]>();
    const expired = await executeProvider(testAdapter(collect), request, {
      context: createProviderContext({ credentialMode: "fixture", now: () => now }),
      budget: new ProviderBudget(1),
      circuitBreaker: new ProviderCircuitBreaker(),
      deadline: now,
    });

    expect(expired.errors[0]?.code).toBe("PROVIDER_DEADLINE_EXCEEDED");
    expect(expired.cost.actualUsd).toBe(0);
    expect(collect).not.toHaveBeenCalled();

    const retrying = vi
      .fn<ProviderAdapter["collect"]>()
      .mockRejectedValue(new ProviderError("temporary", { retryable: true, code: "UPSTREAM_503" }));
    const noTimeForRetry = await executeProvider(testAdapter(retrying), request, {
      context: createProviderContext({ credentialMode: "fixture", now: () => now }),
      budget: new ProviderBudget(1),
      circuitBreaker: new ProviderCircuitBreaker(),
      deadline: new Date(now.getTime() + 1),
    });

    expect(noTimeForRetry.errors[0]?.code).toBe("PROVIDER_DEADLINE_EXCEEDED");
    expect(noTimeForRetry.attempts).toBe(1);
    expect(retrying).toHaveBeenCalledTimes(1);
  });
});
