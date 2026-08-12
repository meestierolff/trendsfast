import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  claimDue: vi.fn(),
  finish: vi.fn(),
  fail: vi.fn(),
  runPersistedScan: vi.fn(),
}));
vi.mock("@trendsfast/config", () => ({
  loadEnv: () => ({
    BILLING_ENABLED: true,
    PAID_MONITORING_ENABLED: true,
    MONITORING_CRON_BATCH_SIZE: 2,
    MONITORING_LEASE_SECONDS: 300,
  }),
}));
vi.mock("../../lib/server-database", () => ({
  getRepositories: () => ({
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
  });
});
