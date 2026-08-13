import "server-only";

import { randomUUID } from "node:crypto";

import { loadEnv } from "@trendsfast/config";
import type { OperationsAlertEvent, OperationsAlertPayload } from "@trendsfast/database";

import { getWorkerRepositories } from "./server-database";

export type OperationsReconciliationSummary = {
  ran: boolean;
  alertsQueued: number;
  failed: boolean;
};

type ReconciliationAlert = {
  eventType: OperationsAlertEvent;
  severity: "warning" | "critical";
  dedupeKey: string;
  payload: OperationsAlertPayload;
};

export async function runDailyOperationsReconciliation(
  options: { now?: () => Date } = {},
): Promise<OperationsReconciliationSummary> {
  const env = loadEnv();
  const now = options.now ?? (() => new Date());
  const repositories = getWorkerRepositories();
  const claim = await repositories.operations.claimDailyReconciliation({
    now: now(),
    leaseSeconds: 60,
    leaseOwner: `reconcile-${randomUUID().slice(0, 12)}`,
  });
  if (!claim) return { ran: false, alertsQueued: 0, failed: false };
  let alertsQueued = 0;
  try {
    const signals = await repositories.operations.collectReliabilitySignals({
      now: now(),
      reviewAlertAgeSeconds: env.MONITORING_REVIEW_ALERT_AGE_SECONDS,
      healthMaxAgeSeconds: env.OPS_HEALTH_MAX_AGE_SECONDS,
    });
    const period = claim.periodStart.toISOString();
    const alertCandidates: Array<ReconciliationAlert | null> = [
      signals.reviewQueueAge.count > 0
        ? {
            eventType: "REVIEW_QUEUE_AGE" as const,
            severity: "warning" as const,
            dedupeKey: `${period}:review-queue-age`,
            payload: {
              count: signals.reviewQueueAge.count,
              maxAgeSeconds: signals.reviewQueueAge.maxAgeSeconds,
            },
          }
        : null,
      signals.providerDegradationCount > 0
        ? {
            eventType: "PROVIDER_DEGRADATION" as const,
            severity: "warning" as const,
            dedupeKey: `${period}:provider-degradation`,
            payload: { code: "PROVIDER_DEGRADED", count: signals.providerDegradationCount },
          }
        : null,
      signals.costRejectionCount > 0
        ? {
            eventType: "COST_REJECTION" as const,
            severity: "warning" as const,
            dedupeKey: `${period}:cost-rejection`,
            payload: { code: "COST_REJECTED", count: signals.costRejectionCount },
          }
        : null,
      signals.stripeWebhookFailureCount > 0
        ? {
            eventType: "STRIPE_WEBHOOK_FAILURE" as const,
            severity: "critical" as const,
            dedupeKey: `${period}:stripe-webhook-failure`,
            payload: {
              code: "STRIPE_WEBHOOK_PROJECTION_FAILED",
              count: signals.stripeWebhookFailureCount,
            },
          }
        : null,
      signals.unhealthyOperationalCheckCount > 0
        ? {
            eventType: "BACKUP_RETENTION_FAILURE" as const,
            severity: "critical" as const,
            dedupeKey: `${period}:backup-retention-freshness`,
            payload: {
              code: "BACKUP_RETENTION_HEARTBEAT_STALE",
              count: signals.unhealthyOperationalCheckCount,
            },
          }
        : null,
    ];
    const alerts = alertCandidates.filter((alert): alert is ReconciliationAlert => alert !== null);
    for (const alert of alerts) {
      const result = await repositories.operations.enqueueAlert({ ...alert, occurredAt: now() });
      if (result.created) alertsQueued++;
    }
    const completed = await repositories.operations.completeDailyReconciliation({
      id: claim.id,
      leaseOwner: claim.leaseOwner,
      summary: signals,
      now: now(),
    });
    return { ran: completed, alertsQueued, failed: !completed };
  } catch {
    await repositories.operations.failDailyReconciliation({
      id: claim.id,
      leaseOwner: claim.leaseOwner,
      failureCode: "DAILY_RECONCILIATION_FAILED",
      now: now(),
    });
    await repositories.operations.enqueueAlert({
      eventType: "MONITORING_FAILURE",
      severity: "critical",
      dedupeKey: `${claim.periodStart.toISOString()}:daily-reconciliation-failed`,
      payload: { code: "DAILY_RECONCILIATION_FAILED", count: 1 },
      occurredAt: now(),
    });
    return { ran: true, alertsQueued: alertsQueued + 1, failed: true };
  }
}
