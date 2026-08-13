import "server-only";

import { randomUUID } from "node:crypto";

import { loadEnv, paidMonitoringRuntimeEnabled } from "@trendsfast/config";
import { ScanCostLimitError } from "@trendsfast/database";
import {
  ModelCostSettlementError,
  ProviderOutcomeUnknownError,
  ScanDeadlineError,
} from "@trendsfast/orchestration";

import { runPersistedScan } from "./scan-processing";
import { getWorkerRepositories } from "./server-database";

export type MonitoringBatchSummary = {
  claimed: number;
  reviewRequired: number;
  completed: number;
  failed: number;
  retryWait: number;
  quarantined: number;
  deadLetter: number;
  stale: number;
};

function failureDisposition(error: unknown) {
  if (error instanceof ProviderOutcomeUnknownError || error instanceof ModelCostSettlementError) {
    return "OUTCOME_UNKNOWN" as const;
  }
  if (error instanceof ScanDeadlineError || error instanceof ScanCostLimitError) {
    return "KNOWN_RETRYABLE" as const;
  }
  return "KNOWN_TERMINAL" as const;
}

function failureCode(error: unknown): string {
  if (error instanceof ScanCostLimitError) return "MONITORING_COST_REJECTED";
  return error instanceof Error ? error.name : "MONITORING_FAILED";
}

export async function runMonitoringBatch(
  options: { now?: () => Date } = {},
): Promise<MonitoringBatchSummary> {
  const env = loadEnv();
  if (!paidMonitoringRuntimeEnabled(env)) {
    throw new Error("PAID_MONITORING_NOT_ENABLED");
  }
  if (env.PROVIDER_CREDENTIAL_MODE !== "fixture" && !env.PROVIDER_CALLS_ENABLED) {
    throw new Error("PROVIDER_CALLS_NOT_ENABLED");
  }
  const repositories = getWorkerRepositories();
  const summary: MonitoringBatchSummary = {
    claimed: 0,
    reviewRequired: 0,
    completed: 0,
    failed: 0,
    retryWait: 0,
    quarantined: 0,
    deadLetter: 0,
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
      maxAttempts: env.MONITORING_MAX_ATTEMPTS,
      retryBaseSeconds: env.MONITORING_RETRY_BASE_SECONDS,
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
        const outcome = await repositories.monitoring.fail({
          runId: claim.id,
          leaseOwner: claim.leaseOwner,
          failureCode: `SCAN_${result.state}`,
          disposition:
            result.state === "RUNNING" || result.state === "QUEUED"
              ? "KNOWN_RETRYABLE"
              : "KNOWN_TERMINAL",
          now: now(),
        });
        if (!outcome.current) summary.stale++;
        else if (outcome.state === "RETRY_WAIT") summary.retryWait++;
        else if (outcome.state === "QUARANTINED") summary.quarantined++;
        else if (outcome.state === "DEAD_LETTER") summary.deadLetter++;
        else summary.failed++;
      }
    } catch (error) {
      const outcome = await repositories.monitoring.fail({
        runId: claim.id,
        leaseOwner: claim.leaseOwner,
        failureCode: failureCode(error),
        disposition: failureDisposition(error),
        now: now(),
      });
      if (!outcome.current) summary.stale++;
      else if (outcome.state === "RETRY_WAIT") summary.retryWait++;
      else if (outcome.state === "QUARANTINED") summary.quarantined++;
      else if (outcome.state === "DEAD_LETTER") summary.deadLetter++;
      else summary.failed++;
    }
  }
  return summary;
}
