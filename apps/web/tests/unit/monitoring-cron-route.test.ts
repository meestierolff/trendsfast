import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  env: {
    CRON_SECRET: "cron-route-secret-that-is-at-least-32-characters",
    BILLING_ENABLED: true,
    PAID_MONITORING_ENABLED: true,
    MONITORING_ENABLED: true,
    OPS_ALERT_WEBHOOK_URL: "https://alerts.example.test/trendsfast",
  },
  runtimeAllowed: true,
  runMonitoringBatch: vi.fn(),
  runDailyOperationsReconciliation: vi.fn(),
  dispatchOperationsAlerts: vi.fn(),
}));
vi.mock("@trendsfast/config", () => ({
  loadEnv: () => mocks.env,
  paidMonitoringRuntimeEnabled: () =>
    mocks.runtimeAllowed &&
    mocks.env.BILLING_ENABLED &&
    mocks.env.PAID_MONITORING_ENABLED &&
    mocks.env.MONITORING_ENABLED,
}));
vi.mock("../../lib/monitoring-service", () => ({
  runMonitoringBatch: mocks.runMonitoringBatch,
}));
vi.mock("../../lib/operations-reconciliation-service", () => ({
  runDailyOperationsReconciliation: mocks.runDailyOperationsReconciliation,
}));
vi.mock("../../lib/ops-alert-service", () => ({
  dispatchOperationsAlerts: mocks.dispatchOperationsAlerts,
}));

import { GET, maxDuration } from "../../app/api/cron/monitoring/route";

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
    mocks.env.MONITORING_ENABLED = true;
    mocks.runtimeAllowed = true;
    mocks.runMonitoringBatch.mockResolvedValue({
      claimed: 2,
      reviewRequired: 1,
      completed: 0,
      failed: 1,
      retryWait: 0,
      quarantined: 0,
      deadLetter: 0,
      stale: 0,
    });
    mocks.runDailyOperationsReconciliation.mockResolvedValue({
      ran: true,
      alertsQueued: 1,
      failed: false,
    });
    mocks.dispatchOperationsAlerts.mockResolvedValue({
      enabled: true,
      claimed: 1,
      delivered: 1,
      failed: 0,
      deadLetter: 0,
      stale: 0,
    });
  });

  it("requires the exact CRON_SECRET before querying due work", async () => {
    expect(await GET(request("wrong-secret"))).toMatchObject({ status: 401 });
    expect(mocks.runMonitoringBatch).not.toHaveBeenCalled();
  });

  it("commits a bounded paid cadence while the Hobby config has no cron", () => {
    const paid = JSON.parse(
      readFileSync(fileURLToPath(new URL("../../vercel.json", import.meta.url)), "utf8"),
    );
    const hobby = JSON.parse(
      readFileSync(fileURLToPath(new URL("../../vercel.hobby.json", import.meta.url)), "utf8"),
    );
    expect(maxDuration).toBe(300);
    expect(paid.crons).toEqual([{ path: "/api/cron/monitoring", schedule: "*/10 * * * *" }]);
    expect(hobby.crons).toBeUndefined();
  });

  it("drains reconciliation and queued alerts while paid monitoring is disabled", async () => {
    mocks.env.PAID_MONITORING_ENABLED = false;
    mocks.runtimeAllowed = false;

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      monitoring: { enabled: false },
      reconciliation: { ran: true, alertsQueued: 1, failed: false },
      alerts: {
        enabled: true,
        claimed: 1,
        delivered: 1,
        failed: 0,
        deadLetter: 0,
        stale: 0,
      },
    });
    expect(mocks.runMonitoringBatch).not.toHaveBeenCalled();
    expect(mocks.runDailyOperationsReconciliation).toHaveBeenCalledOnce();
    expect(mocks.dispatchOperationsAlerts).toHaveBeenCalledOnce();
  });

  it("does not run paid work on preview but still drains operational alerts", async () => {
    mocks.runtimeAllowed = false;
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(mocks.runMonitoringBatch).not.toHaveBeenCalled();
    expect(mocks.runDailyOperationsReconciliation).toHaveBeenCalledOnce();
    expect(mocks.dispatchOperationsAlerts).toHaveBeenCalledOnce();
  });

  it("still drains a queued alert after the paid monitoring batch crashes", async () => {
    mocks.runMonitoringBatch.mockRejectedValueOnce(new Error("private database details"));

    const response = await GET(request());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      ok: false,
      monitoring: { enabled: true, error: "MONITORING_BATCH_FAILED" },
      reconciliation: { ran: true, alertsQueued: 1, failed: false },
      alerts: {
        enabled: true,
        claimed: 1,
        delivered: 1,
        failed: 0,
        deadLetter: 0,
        stale: 0,
      },
    });
    expect(mocks.runDailyOperationsReconciliation).toHaveBeenCalledOnce();
    expect(mocks.dispatchOperationsAlerts).toHaveBeenCalledOnce();
  });

  it("fails the cron visibly when an alert remains retryable or dead-letters", async () => {
    mocks.dispatchOperationsAlerts.mockResolvedValueOnce({
      enabled: true,
      claimed: 1,
      delivered: 0,
      failed: 1,
      deadLetter: 0,
      stale: 0,
    });
    expect(await GET(request())).toMatchObject({ status: 500 });

    mocks.dispatchOperationsAlerts.mockResolvedValueOnce({
      enabled: true,
      claimed: 1,
      delivered: 0,
      failed: 0,
      deadLetter: 1,
      stale: 0,
    });
    const response = await GET(request());
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({
      ok: false,
      alerts: { deadLetter: 1 },
    });
  });

  it("returns bounded counters without project URLs, IDs, or claim tokens", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      ok: true,
      monitoring: {
        enabled: true,
        claimed: 2,
        reviewRequired: 1,
        completed: 0,
        failed: 1,
        retryWait: 0,
        quarantined: 0,
        deadLetter: 0,
        stale: 0,
      },
      reconciliation: { ran: true, alertsQueued: 1, failed: false },
      alerts: {
        enabled: true,
        claimed: 1,
        delivered: 1,
        failed: 0,
        deadLetter: 0,
        stale: 0,
      },
    });
    expect(JSON.stringify(body)).not.toMatch(/https?:|project|token|lease/i);
  });
});
