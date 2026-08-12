import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  env: {
    CRON_SECRET: "cron-route-secret-that-is-at-least-32-characters",
    BILLING_ENABLED: true,
    PAID_MONITORING_ENABLED: true,
  },
  runMonitoringBatch: vi.fn(),
}));
vi.mock("@trendsfast/config", () => ({ loadEnv: () => mocks.env }));
vi.mock("../../lib/monitoring-service", () => ({
  runMonitoringBatch: mocks.runMonitoringBatch,
}));

import { GET } from "../../app/api/cron/monitoring/route";

function request(token = mocks.env.CRON_SECRET) {
  return new Request("https://trendsfast.example/api/cron/monitoring", {
    headers: { authorization: `Bearer ${token}` },
  });
}

describe("monitoring cron route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.env.BILLING_ENABLED = true;
    mocks.env.PAID_MONITORING_ENABLED = true;
    mocks.runMonitoringBatch.mockResolvedValue({
      claimed: 2,
      reviewRequired: 1,
      completed: 0,
      failed: 1,
      stale: 0,
    });
  });

  it("requires the exact CRON_SECRET before querying due work", async () => {
    expect(await GET(request("wrong-secret"))).toMatchObject({ status: 401 });
    expect(mocks.runMonitoringBatch).not.toHaveBeenCalled();
  });

  it("requires both billing and paid-monitoring gates", async () => {
    mocks.env.PAID_MONITORING_ENABLED = false;
    expect(await GET(request())).toMatchObject({ status: 503 });
    mocks.env.PAID_MONITORING_ENABLED = true;
    mocks.env.BILLING_ENABLED = false;
    expect(await GET(request())).toMatchObject({ status: 503 });
    expect(mocks.runMonitoringBatch).not.toHaveBeenCalled();
  });

  it("returns bounded counters without project URLs, IDs, or claim tokens", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      ok: true,
      claimed: 2,
      reviewRequired: 1,
      completed: 0,
      failed: 1,
      stale: 0,
    });
    expect(JSON.stringify(body)).not.toMatch(/https?:|project|token|lease/i);
  });
});
