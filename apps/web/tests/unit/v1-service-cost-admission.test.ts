import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const repositoryMocks = vi.hoisted(() => ({
  usageSince: vi.fn(),
  recordLimited: vi.fn(),
  resolveApiIdempotency: vi.fn(),
  admitApiRequest: vi.fn(),
  getStatusByPublicId: vi.fn(),
  appendAnalytics: vi.fn(),
  getProject: vi.fn(),
}));

vi.mock("@trendsfast/config", () => ({
  loadEnv: () => ({
    APP_URL: "https://app.example",
    PROVIDER_CREDENTIAL_MODE: "managed",
    MAX_PROVIDER_COST_USD_PER_SCAN: 0.25,
  }),
}));

vi.mock("../../lib/server-database", () => ({
  getRepositories: () => ({
    apiKeys: {
      usageSince: repositoryMocks.usageSince,
      recordLimited: repositoryMocks.recordLimited,
    },
    scans: {
      resolveApiIdempotency: repositoryMocks.resolveApiIdempotency,
      admitApiRequest: repositoryMocks.admitApiRequest,
      getStatusByPublicId: repositoryMocks.getStatusByPublicId,
    },
    analytics: { append: repositoryMocks.appendAnalytics },
    scanData: { getProject: repositoryMocks.getProject },
  }),
}));

import { createV1Service } from "../../lib/v1-service";

describe("v1 service cost admission wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    repositoryMocks.usageSince.mockResolvedValue({
      successfulRequests: 1,
      estimatedCostUsd: 0,
      actualCostUsd: 0,
    });
    repositoryMocks.resolveApiIdempotency.mockResolvedValue(null);
    repositoryMocks.appendAnalytics.mockResolvedValue(undefined);
  });

  it("reserves the live per-scan ceiling atomically and schedules only a created request", async () => {
    const persistedRequest = {
      id: "request_1",
      publicId: "scan_1",
      apiKeyId: "key_1",
      projectId: null,
      state: "QUEUED",
    };
    repositoryMocks.admitApiRequest.mockResolvedValue({
      status: "CREATED",
      request: persistedRequest,
    });
    repositoryMocks.getStatusByPublicId.mockResolvedValue({
      request: persistedRequest,
      run: null,
      move: null,
      context: null,
      project: null,
      delivery: null,
      evidence: [],
    });
    const schedule = vi.fn();
    const service = createV1Service({ schedule });

    await expect(
      service.createOrReuse({
        principal: {
          apiKeyId: "key_1",
          environment: "live",
          scopes: ["next_move:write"],
          rateLimitPerHour: 20,
          providerCostLimitUsd: 5,
        },
        idempotencyKey: "5c55b81c-bd64-4bdb-b579-91017b476b7f",
        request: { product_url: "https://example.com" },
      }),
    ).resolves.toMatchObject({ id: "scan_1", status: "QUEUED" });

    expect(repositoryMocks.admitApiRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKeyId: "key_1",
        idempotencyKey: "5c55b81c-bd64-4bdb-b579-91017b476b7f",
        costReservationUsd: 0.25,
        since: expect.any(Date),
        now: expect.any(Date),
      }),
    );
    expect(schedule).toHaveBeenCalledOnce();
    expect(schedule).toHaveBeenCalledWith("scan_1");
  });
});
