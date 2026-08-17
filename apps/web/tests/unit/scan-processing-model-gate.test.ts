import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => {
  const deterministicDecision = vi.fn();
  return {
    analyticsAppend: vi.fn(),
    assertManagedPolicyRevision: vi.fn(),
    createConfiguredClient: vi.fn(),
    createDatabaseProcessingStore: vi.fn(() => ({ kind: "store" })),
    createModelAssistedDecision: vi.fn(),
    createModelContextInferer: vi.fn(),
    createProviderRunner: vi.fn(() => ({ kind: "providers" })),
    deterministicDecision,
    loadProviderExecutionEligibility: vi.fn(),
    processScan: vi.fn(),
  };
});

vi.mock("@trendsfast/config", () => ({
  loadEnv: () => ({
    PROVIDER_CREDENTIAL_MODE: "managed",
    PROVIDER_CALLS_ENABLED: true,
    MANAGED_POLICY_REVISION: "policy-v1",
    PROVIDER_TIMEOUT_MS: 5_000,
    LLM_PROVIDER: "xai",
    LLM_MODEL: "grok-exact",
    XAI_MODEL: "grok-exact",
    XAI_API_KEY: "private-test-key",
    MAX_SCAN_DURATION_SECONDS: 300,
  }),
  resolveProviderCosts: () => ({ maximumProviderCostUsdPerScan: 1 }),
  resolvedProviderCostEnvironment: () => ({}),
}));

vi.mock("@trendsfast/observability", () => ({
  createLogger: () => ({ error: vi.fn(), warn: vi.fn() }),
}));

vi.mock("@trendsfast/providers", () => ({
  buildQueryPlan: vi.fn(() => []),
  createProviderContext: vi.fn(() => ({ env: {} })),
  createProviderRegistry: vi.fn(
    () =>
      new Map([
        [
          "x",
          {
            metadata: {
              slug: "x",
              publicName: "X",
              timeoutMs: 5_000,
              requiredEnvironmentVariables: ["XAI_API_KEY"],
            },
          },
        ],
      ]),
  ),
  projectContextToProductQueryContext: vi.fn((context) => context),
}));

vi.mock("@trendsfast/orchestration", () => ({
  createDatabaseProcessingStore: mocks.createDatabaseProcessingStore,
  createModelAssistedDecision: mocks.createModelAssistedDecision,
  createModelContextInferer: mocks.createModelContextInferer,
  createOpenAiCompatibleModelClient: mocks.createConfiguredClient,
  createProviderRunner: mocks.createProviderRunner,
  decideDeterministically: mocks.deterministicDecision,
  inferFixtureProjectContext: vi.fn(),
  processScan: mocks.processScan,
}));

vi.mock("../../lib/server-database", () => ({
  getWorkerRepositories: () => ({
    analytics: { append: mocks.analyticsAppend },
    operations: { assertManagedPolicyRevision: mocks.assertManagedPolicyRevision },
  }),
}));

vi.mock("../../lib/provider-execution-eligibility", () => ({
  loadProviderExecutionEligibility: mocks.loadProviderExecutionEligibility,
}));

import { runPersistedScan } from "../../lib/scan-processing";

describe("exact-deployment synthesis-model gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadProviderExecutionEligibility.mockResolvedValue(
      new Map([
        [
          "x",
          {
            eligible: false,
            code: "PROVIDER_VERIFICATION_UNAVAILABLE",
            message: "Exact production verification is unavailable.",
          },
        ],
      ]),
    );
    mocks.processScan.mockResolvedValue({
      state: "REVIEW_REQUIRED",
      requestId: "11111111-1111-4111-8111-111111111111",
      nextMoveId: "22222222-2222-4222-8222-222222222222",
    });
    mocks.analyticsAppend.mockResolvedValue(undefined);
    mocks.assertManagedPolicyRevision.mockResolvedValue(undefined);
  });

  it("uses deterministic saved-context decisions with zero model setup when verification lookup fails", async () => {
    await expect(runPersistedScan("scan_exact_model_gate")).resolves.toMatchObject({
      state: "REVIEW_REQUIRED",
    });

    expect(mocks.createConfiguredClient).not.toHaveBeenCalled();
    expect(mocks.createModelContextInferer).not.toHaveBeenCalled();
    expect(mocks.createModelAssistedDecision).not.toHaveBeenCalled();
    expect(mocks.processScan).toHaveBeenCalledWith(
      "scan_exact_model_gate",
      expect.objectContaining({ decide: mocks.deterministicDecision }),
    );
    expect(mocks.createProviderRunner).toHaveBeenCalledWith(
      expect.objectContaining({ eligibility: expect.any(Map) }),
    );
  });
});
