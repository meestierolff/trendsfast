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
  isProjectEntitled: vi.fn(),
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
    founderUsage: { isProjectEntitled: repositoryMocks.isProjectEntitled },
  }),
}));

import { createV1Service, isWithinFounderResultHistory } from "../../lib/v1-service";

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
    repositoryMocks.isProjectEntitled.mockResolvedValue(true);
    repositoryMocks.getProject.mockResolvedValue({
      id: "project_1",
      normalizedUrl: "https://example.com/",
    });
  });

  it("reserves the live per-scan ceiling atomically and schedules only a created request", async () => {
    const persistedRequest = {
      id: "request_1",
      publicId: "scan_1",
      apiKeyId: "key_1",
      projectId: "project_1",
      state: "QUEUED",
      createdAt: new Date(),
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
          projectId: "project_1",
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
        projectId: "project_1",
        since: expect.any(Date),
        now: expect.any(Date),
      }),
    );
    expect(schedule).toHaveBeenCalledOnce();
    expect(schedule).toHaveBeenCalledWith("scan_1");
  });

  it("exposes live results only inside the exact 30-day Founder history window", () => {
    const now = new Date("2026-08-31T12:00:00.000Z");
    expect(isWithinFounderResultHistory(new Date("2026-08-01T12:00:00.000Z"), now)).toBe(true);
    expect(isWithinFounderResultHistory(new Date("2026-08-01T11:59:59.999Z"), now)).toBe(false);
    expect(isWithinFounderResultHistory(new Date("2026-08-31T12:00:00.001Z"), now)).toBe(false);
  });

  it("hides live results when entitlement is inactive or the request is older than 30 days", async () => {
    const service = createV1Service({ schedule: vi.fn() });
    const principal = {
      apiKeyId: "key_1",
      projectId: "project_1",
      environment: "live" as const,
      scopes: ["next_move:read"],
    };
    repositoryMocks.getStatusByPublicId.mockResolvedValue({
      request: {
        id: "request_old",
        publicId: "scan_old",
        apiKeyId: "key_1",
        projectId: "project_1",
        state: "READY",
        createdAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1_000),
      },
      run: null,
      move: null,
      context: null,
      project: null,
      delivery: null,
      evidence: [],
    });

    await expect(service.getStatus({ principal, id: "scan_old" })).resolves.toBeNull();
    repositoryMocks.getStatusByPublicId.mockResolvedValue({
      request: {
        id: "request_current",
        publicId: "scan_current",
        apiKeyId: "key_1",
        projectId: "project_1",
        state: "QUEUED",
        createdAt: new Date(),
      },
      run: null,
      move: null,
      context: null,
      project: null,
      delivery: null,
      evidence: [],
    });
    repositoryMocks.isProjectEntitled.mockResolvedValue(false);
    await expect(service.getStatus({ principal, id: "scan_current" })).resolves.toBeNull();
  });

  it("surfaces a durable Founder monthly admission limit without scheduling work", async () => {
    repositoryMocks.getProject.mockResolvedValue({
      id: "project_1",
      normalizedUrl: "https://example.com/",
    });
    repositoryMocks.admitApiRequest.mockResolvedValue({
      status: "USAGE_LIMITED",
      reason: "ON_DEMAND_MONTHLY_LIMIT",
    });
    const schedule = vi.fn();
    const service = createV1Service({ schedule });

    await expect(
      service.createOrReuse({
        principal: {
          apiKeyId: "key_1",
          projectId: "project_1",
          environment: "live",
          scopes: ["next_move:write"],
        },
        idempotencyKey: "5c55b81c-bd64-4bdb-b579-91017b476b7f",
        request: { product_url: "https://example.com" },
      }),
    ).rejects.toMatchObject({ code: "USAGE_LIMITED", status: 429 });
    expect(schedule).not.toHaveBeenCalled();
  });
});
