import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  loadEnv: vi.fn(),
  resolveProviderCosts: vi.fn(),
  resolvedProviderCostEnvironment: vi.fn(() => ({})),
  createProviderContext: vi.fn((input) => ({
    credentialMode: input.credentialMode,
    env: input.env,
  })),
  createProviderRegistry: vi.fn(),
  providerCollect: vi.fn(),
  verifyProviderReadback: vi.fn(),
  getRepositories: vi.fn(),
  deploymentProvenance: vi.fn(() => ({
    deploymentEnvironment: "preview",
    releaseSha: "verification-test-sha",
    deploymentHost: "preview.trendsfast.example",
    deploymentId: "verification-test-deployment",
  })),
}));

vi.mock("@trendsfast/config", () => ({
  loadEnv: mocks.loadEnv,
  resolveProviderCosts: mocks.resolveProviderCosts,
  resolvedProviderCostEnvironment: mocks.resolvedProviderCostEnvironment,
}));
vi.mock("@trendsfast/providers", () => ({
  createProviderContext: mocks.createProviderContext,
  createProviderRegistry: mocks.createProviderRegistry,
  verifyProviderReadback: mocks.verifyProviderReadback,
}));
vi.mock("../../lib/server-database", () => ({ getRepositories: mocks.getRepositories }));
vi.mock("../../lib/deployment-provenance", () => ({
  deploymentProvenance: mocks.deploymentProvenance,
}));

import { runConfiguredProviderVerification } from "../../lib/provider-verification-service";

function record(id: string) {
  const now = new Date("2026-08-12T10:00:00.000Z");
  return {
    id,
    source: "tavily" as const,
    provider: "Tavily",
    state: "RUNNING" as const,
    credentialMode: "managed",
    deploymentEnvironment: "preview",
    releaseSha: "verification-test-sha",
    deploymentHost: "preview.trendsfast.example",
    deploymentId: "verification-test-deployment",
    healthStatus: null,
    readbackVerified: false,
    canonicalUrls: [],
    latencyMs: null,
    estimatedCostUsd: "0.500000",
    actualCostUsd: null,
    quotaUsed: "0.0000",
    limitations: [],
    failureCode: null,
    failureMessage: null,
    initiatedBy: "founder:test",
    startedAt: now,
    checkedAt: null,
    completedAt: null,
    createdAt: now,
  };
}

describe("provider verification paid-effect admission", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    mocks.loadEnv.mockReturnValue({
      PROVIDER_CREDENTIAL_MODE: "managed",
      PROVIDER_TIMEOUT_MS: 15_000,
      TAVILY_API_KEY: "server-side-key",
    });
    mocks.resolveProviderCosts.mockReturnValue({
      tavilyCreditUsd: 0.25,
      youtubeQuotaUnitUsd: 0.01,
      maximumProviderCostUsdPerScan: 1,
    });
    mocks.createProviderRegistry.mockReturnValue(
      new Map([
        [
          "tavily",
          {
            metadata: {
              slug: "tavily",
              publicName: "Tavily",
              requiredEnvironmentVariables: ["TAVILY_API_KEY"],
              retryPolicy: { maxAttempts: 2 },
              maxResultsPerScan: 3,
            },
            estimate: vi.fn(() => ({ estimatedUsd: 0.25, calls: 1, quotaUnits: 1 })),
            collect: mocks.providerCollect,
          },
        ],
      ]),
    );
  });

  it("lets exactly one concurrent caller own the provider effect", async () => {
    const attempts = new Map<string, ReturnType<typeof record>>();
    const repository = {
      admitAttempt: vi.fn(async (input: { attemptId: string }) => {
        const existing = attempts.get(input.attemptId);
        if (existing) return { record: existing, created: false, admitted: false };
        const created = record(input.attemptId);
        attempts.set(input.attemptId, created);
        return { record: created, created: true, admitted: true };
      }),
      complete: vi.fn(async (input: { id: string; state: string }) => ({
        ...attempts.get(input.id)!,
        state: input.state,
        completedAt: new Date("2026-08-12T10:00:01.000Z"),
      })),
    };
    mocks.getRepositories.mockReturnValue({ providerVerifications: repository });
    const verificationResult = {
      state: "VERIFIED",
      healthStatus: "HEALTHY",
      readbackVerified: true,
      canonicalUrls: ["https://example.com/original"],
      latencyMs: 10,
      estimatedCostUsd: 0.25,
      actualCostUsd: 0.2,
      quotaUsed: 1,
      limitations: [],
      checkedAt: "2026-08-12T10:00:01.000Z",
    };
    mocks.verifyProviderReadback.mockImplementation(async ({ adapter, request, context }) => {
      await adapter.collect(request, context);
      return verificationResult;
    });
    const input = {
      attemptId: "bc8c6d7d-bc0a-4a9e-aeb3-92ebc30f9ee2",
      provider: "tavily" as const,
      initiatedBy: "founder:test",
      query: "distribution research",
    };

    const results = await Promise.all([
      runConfiguredProviderVerification(input),
      runConfiguredProviderVerification(input),
    ]);

    expect(mocks.verifyProviderReadback).toHaveBeenCalledTimes(1);
    expect(mocks.providerCollect).toHaveBeenCalledTimes(1);
    expect(repository.complete).toHaveBeenCalledTimes(1);
    expect(results.filter((result) => result.reused)).toHaveLength(1);
  });

  it("never invokes provider verification when durable cost admission denies the attempt", async () => {
    const denied = {
      ...record("f2d7fdc4-ab80-4f50-b6d0-b1930ec131bb"),
      state: "FAILED" as const,
      estimatedCostUsd: "0.000000",
      failureCode: "VERIFICATION_COST_LIMIT",
      completedAt: new Date("2026-08-12T10:00:00.000Z"),
    };
    const repository = {
      admitAttempt: vi.fn(async () => ({ record: denied, created: true, admitted: false })),
      complete: vi.fn(),
    };
    mocks.getRepositories.mockReturnValue({ providerVerifications: repository });

    const result = await runConfiguredProviderVerification({
      attemptId: denied.id,
      provider: "tavily",
      initiatedBy: "founder:test",
      query: "distribution research",
    });

    expect(result.failureCode).toBe("VERIFICATION_COST_LIMIT");
    expect(mocks.verifyProviderReadback).not.toHaveBeenCalled();
    expect(repository.complete).not.toHaveBeenCalled();
  });

  it("does not truncate a retry-inclusive reservation to the configured ceiling", async () => {
    const attemptId = "382531bc-3455-48b9-a04e-266ee1c77b36";
    const adapter = mocks.createProviderRegistry().get("tavily")!;
    vi.mocked(adapter.estimate).mockReturnValue({ estimatedUsd: 0.75, calls: 1, quotaUnits: 1 });
    const denied = {
      ...record(attemptId),
      state: "FAILED" as const,
      failureCode: "VERIFICATION_COST_LIMIT",
    };
    const repository = {
      admitAttempt: vi.fn(async () => ({ record: denied, created: true, admitted: false })),
      complete: vi.fn(),
    };
    mocks.getRepositories.mockReturnValue({ providerVerifications: repository });

    await runConfiguredProviderVerification({
      attemptId,
      provider: "tavily",
      initiatedBy: "founder:test",
      query: "distribution research",
    });

    expect(repository.admitAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ estimatedCostReservationUsd: 1.5, maximumCostUsd: 1 }),
    );
    expect(mocks.verifyProviderReadback).not.toHaveBeenCalled();
  });

  it("records YouTube health quota even when its configured USD unit value is zero", async () => {
    vi.stubEnv("YOUTUBE_API_KEY", "server-side-key");
    mocks.loadEnv.mockReturnValue({
      PROVIDER_CREDENTIAL_MODE: "managed",
      PROVIDER_TIMEOUT_MS: 15_000,
      YOUTUBE_API_KEY: "server-side-key",
    });
    mocks.resolveProviderCosts.mockReturnValue({
      tavilyCreditUsd: 0.25,
      youtubeQuotaUnitUsd: 0,
      maximumProviderCostUsdPerScan: 1,
    });
    mocks.createProviderRegistry.mockReturnValue(
      new Map([
        [
          "youtube",
          {
            metadata: {
              slug: "youtube",
              publicName: "YouTube",
              requiredEnvironmentVariables: ["YOUTUBE_API_KEY"],
              retryPolicy: { maxAttempts: 1 },
              maxResultsPerScan: 3,
            },
            estimate: vi.fn(() => ({ estimatedUsd: 0, calls: 1, quotaUnits: 100 })),
          },
        ],
      ]),
    );
    const attemptId = "19ad5181-2d34-4a01-8496-bf740bc4a564";
    const admitted = { ...record(attemptId), source: "youtube" as const, provider: "YouTube" };
    const repository = {
      admitAttempt: vi.fn(async () => ({ record: admitted, created: true, admitted: true })),
      complete: vi.fn(async () => ({
        ...admitted,
        state: "DEGRADED" as const,
        completedAt: new Date("2026-08-12T10:00:01.000Z"),
      })),
    };
    mocks.getRepositories.mockReturnValue({ providerVerifications: repository });
    mocks.verifyProviderReadback.mockResolvedValue({
      state: "DEGRADED",
      healthStatus: "DEGRADED",
      readbackVerified: false,
      canonicalUrls: [],
      estimatedCostUsd: 0,
      quotaUsed: 1,
      limitations: [],
      checkedAt: "2026-08-12T10:00:01.000Z",
    });

    await runConfiguredProviderVerification({
      attemptId,
      provider: "youtube",
      initiatedBy: "founder:test",
      query: "distribution research",
    });

    expect(mocks.verifyProviderReadback).toHaveBeenCalledWith(
      expect.objectContaining({ healthCheckEstimatedCostUsd: 0, healthCheckQuotaUnits: 1 }),
    );
  });
});
