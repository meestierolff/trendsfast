import { beforeEach, describe, expect, it, vi } from "vitest";

import { ScanCostLimitError } from "@trendsfast/database";
import { ProviderOutcomeUnknownError } from "@trendsfast/orchestration";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  claimDue: vi.fn(),
  finish: vi.fn(),
  fail: vi.fn(),
  runPersistedScan: vi.fn(),
}));
vi.mock("@trendsfast/config", () => ({
  paidMonitoringRuntimeEnabled: () => true,
  loadEnv: () => ({
    BILLING_ENABLED: true,
    PAID_MONITORING_ENABLED: true,
    MONITORING_ENABLED: true,
    PROVIDER_CREDENTIAL_MODE: "fixture",
    PROVIDER_CALLS_ENABLED: false,
    MONITORING_CRON_BATCH_SIZE: 2,
    MONITORING_LEASE_SECONDS: 300,
    MONITORING_MAX_ATTEMPTS: 3,
    MONITORING_RETRY_BASE_SECONDS: 300,
  }),
}));
vi.mock("../../lib/server-database", () => ({
  getWorkerRepositories: () => ({
    monitoring: {
      claimDue: mocks.claimDue,
      finish: mocks.finish,
      fail: mocks.fail,
    },
  }),
}));
vi.mock("../../lib/scan-processing", () => ({ runPersistedScan: mocks.runPersistedScan }));

import { runMonitoringBatch } from "../../lib/monitoring-service";

describe("monitoring batch scheduling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.claimDue
      .mockResolvedValueOnce([{ id: "run_1", leaseOwner: "lease_1", scanPublicId: "scan_1" }])
      .mockResolvedValueOnce([{ id: "run_2", leaseOwner: "lease_2", scanPublicId: "scan_2" }]);
    mocks.runPersistedScan.mockResolvedValue({ state: "REVIEW_REQUIRED" });
    mocks.finish.mockResolvedValue(true);
  });

  it("claims each scan just-in-time after the prior scan has finished", async () => {
    const times = [
      new Date("2026-08-11T10:00:00Z"),
      new Date("2026-08-11T10:04:00Z"),
      new Date("2026-08-11T10:04:01Z"),
      new Date("2026-08-11T10:08:01Z"),
    ];
    const summary = await runMonitoringBatch({ now: () => times.shift()! });

    expect(summary).toEqual({
      claimed: 2,
      reviewRequired: 2,
      completed: 0,
      failed: 0,
      retryWait: 0,
      quarantined: 0,
      deadLetter: 0,
      stale: 0,
    });
    expect(mocks.claimDue).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ batchSize: 1, now: new Date("2026-08-11T10:00:00Z") }),
    );
    expect(mocks.claimDue).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ batchSize: 1, now: new Date("2026-08-11T10:04:01Z") }),
    );
    expect(mocks.runPersistedScan.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.claimDue.mock.invocationCallOrder[1]!,
    );
    expect(mocks.finish.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.claimDue.mock.invocationCallOrder[1]!,
    );
    expect(mocks.claimDue).toHaveBeenCalledWith(
      expect.objectContaining({ maxAttempts: 3, retryBaseSeconds: 300 }),
    );
  });

  it("classifies an ambiguous provider effect for quarantine instead of blind replay", async () => {
    mocks.claimDue.mockReset();
    mocks.claimDue
      .mockResolvedValueOnce([{ id: "run_1", leaseOwner: "lease_1", scanPublicId: "scan_1" }])
      .mockResolvedValueOnce([]);
    mocks.runPersistedScan.mockRejectedValue(
      new ProviderOutcomeUnknownError("provider result was not durably confirmed"),
    );
    mocks.fail.mockResolvedValue({ current: true, state: "QUARANTINED" });

    const summary = await runMonitoringBatch();

    expect(summary.quarantined).toBe(1);
    expect(summary.retryWait).toBe(0);
    expect(mocks.fail).toHaveBeenCalledWith(
      expect.objectContaining({ disposition: "OUTCOME_UNKNOWN" }),
    );
  });

  it("retries a known pre-call cost rejection under the stored attempt cap", async () => {
    mocks.claimDue.mockReset();
    mocks.claimDue
      .mockResolvedValueOnce([{ id: "run_1", leaseOwner: "lease_1", scanPublicId: "scan_1" }])
      .mockResolvedValueOnce([]);
    mocks.runPersistedScan.mockRejectedValue(new ScanCostLimitError(1.113, 0.731));
    mocks.fail.mockResolvedValue({ current: true, state: "RETRY_WAIT" });

    const summary = await runMonitoringBatch();

    expect(summary.retryWait).toBe(1);
    expect(mocks.fail).toHaveBeenCalledWith(
      expect.objectContaining({
        disposition: "KNOWN_RETRYABLE",
        failureCode: "MONITORING_COST_REJECTED",
      }),
    );
  });
});
