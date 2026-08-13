import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  claimDailyReconciliation: vi.fn(),
  collectReliabilitySignals: vi.fn(),
  enqueueAlert: vi.fn(),
  completeDailyReconciliation: vi.fn(),
  failDailyReconciliation: vi.fn(),
}));
vi.mock("@trendsfast/config", () => ({
  loadEnv: () => ({
    MONITORING_REVIEW_ALERT_AGE_SECONDS: 86_400,
    OPS_HEALTH_MAX_AGE_SECONDS: 129_600,
  }),
}));
vi.mock("../../lib/server-database", () => ({
  getWorkerRepositories: () => ({ operations: mocks }),
}));

import { runDailyOperationsReconciliation } from "../../lib/operations-reconciliation-service";

describe("daily operations reconciliation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.claimDailyReconciliation.mockResolvedValue({
      id: "reconciliation-id",
      leaseOwner: "reconciliation-lease",
      periodStart: new Date("2026-08-12T00:00:00Z"),
    });
    mocks.collectReliabilitySignals.mockResolvedValue({
      reviewQueueAge: { count: 2, maxAgeSeconds: 172_800 },
      providerDegradationCount: 1,
      costRejectionCount: 1,
      stripeWebhookFailureCount: 1,
      unhealthyOperationalCheckCount: 2,
    });
    mocks.enqueueAlert.mockResolvedValue({ created: true });
    mocks.completeDailyReconciliation.mockResolvedValue(true);
    mocks.failDailyReconciliation.mockResolvedValue(true);
  });

  it("queues one aggregate alert for every required reliability class", async () => {
    const summary = await runDailyOperationsReconciliation({
      now: () => new Date("2026-08-12T12:00:00Z"),
    });

    expect(summary).toEqual({ ran: true, alertsQueued: 5, failed: false });
    expect(mocks.enqueueAlert.mock.calls.map(([alert]) => alert.eventType)).toEqual([
      "REVIEW_QUEUE_AGE",
      "PROVIDER_DEGRADATION",
      "COST_REJECTION",
      "STRIPE_WEBHOOK_FAILURE",
      "BACKUP_RETENTION_FAILURE",
    ]);
    expect(JSON.stringify(mocks.enqueueAlert.mock.calls)).not.toMatch(/https?:|@|evidence|token/i);
  });

  it("does not duplicate a completed UTC-day reconciliation", async () => {
    mocks.claimDailyReconciliation.mockResolvedValue(null);
    await expect(runDailyOperationsReconciliation()).resolves.toEqual({
      ran: false,
      alertsQueued: 0,
      failed: false,
    });
    expect(mocks.collectReliabilitySignals).not.toHaveBeenCalled();
  });
});
