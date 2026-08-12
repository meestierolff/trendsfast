import "server-only";

import { randomUUID } from "node:crypto";

import { loadEnv } from "@trendsfast/config";

import { runPersistedScan } from "./scan-processing";
import { getRepositories } from "./server-database";

export type MonitoringBatchSummary = {
  claimed: number;
  reviewRequired: number;
  completed: number;
  failed: number;
  stale: number;
};

export async function runMonitoringBatch(
  options: { now?: () => Date } = {},
): Promise<MonitoringBatchSummary> {
  const env = loadEnv();
  if (!env.BILLING_ENABLED || !env.PAID_MONITORING_ENABLED) {
    throw new Error("PAID_MONITORING_NOT_ENABLED");
  }
  const repositories = getRepositories();
  const summary: MonitoringBatchSummary = {
    claimed: 0,
    reviewRequired: 0,
    completed: 0,
    failed: 0,
    stale: 0,
  };
  const now = options.now ?? (() => new Date());

  // Claim just-in-time before each sequential scan. Claiming the full batch up
  // front could let later leases expire while an earlier scan is still running.
  for (let index = 0; index < env.MONITORING_CRON_BATCH_SIZE; index++) {
    const [claim] = await repositories.monitoring.claimDue({
      now: now(),
      batchSize: 1,
      leaseSeconds: env.MONITORING_LEASE_SECONDS,
      leaseOwner: `cron-${randomUUID().slice(0, 12)}`,
    });
    if (!claim) break;
    summary.claimed++;
    try {
      const result = await runPersistedScan(claim.scanPublicId);
      if (result.state === "REVIEW_REQUIRED") {
        const current = await repositories.monitoring.finish({
          runId: claim.id,
          leaseOwner: claim.leaseOwner,
          state: "REVIEW_REQUIRED",
          now: now(),
        });
        if (current) summary.reviewRequired++;
        else summary.stale++;
      } else if (result.state === "READY") {
        const current = await repositories.monitoring.finish({
          runId: claim.id,
          leaseOwner: claim.leaseOwner,
          state: "COMPLETED",
          now: now(),
        });
        if (current) summary.completed++;
        else summary.stale++;
      } else {
        const current = await repositories.monitoring.fail({
          runId: claim.id,
          leaseOwner: claim.leaseOwner,
          failureCode: `SCAN_${result.state}`,
          now: now(),
        });
        if (current) summary.failed++;
        else summary.stale++;
      }
    } catch (error) {
      const current = await repositories.monitoring.fail({
        runId: claim.id,
        leaseOwner: claim.leaseOwner,
        failureCode: error instanceof Error ? error.name : "MONITORING_FAILED",
        now: now(),
      });
      if (current) summary.failed++;
      else summary.stale++;
    }
  }
  return summary;
}
