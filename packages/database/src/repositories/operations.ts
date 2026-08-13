import { createHash, randomUUID } from "node:crypto";

import { and, asc, count, eq, gte, inArray, lte, min, or, sql } from "drizzle-orm";

import { redactSecrets } from "@trendsfast/core";

import type { TrendsFastDatabase } from "../client";
import {
  apiKeyAuthEvents,
  billingWebhookEvents,
  operationsAlertQueue,
  operationsAlertCodes,
  operationsHealthChecks,
  operationsReconciliationRuns,
  providerVerificationRecords,
  scanRequests,
  scanRuns,
  sourceRuns,
  type OperationsAlertEvent,
  type OperationsAlertPayload,
} from "../schema";

const ALERT_EVENTS = new Set<OperationsAlertEvent>([
  "MONITORING_FAILURE",
  "REVIEW_QUEUE_AGE",
  "PROVIDER_DEGRADATION",
  "COST_REJECTION",
  "STRIPE_WEBHOOK_FAILURE",
  "BACKUP_RETENTION_FAILURE",
]);
const ALERT_CODES = new Set<string>(operationsAlertCodes);

type AlertSeverity = "warning" | "critical";
type DatabaseExecutor = TrendsFastDatabase;

function validDate(value: Date, label: string): Date {
  if (Number.isNaN(value.getTime())) throw new Error(`${label} is invalid`);
  return value;
}

function safeInteger(value: number | undefined, label: string, maximum = 1_000_000) {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new Error(`${label} must be a bounded non-negative integer`);
  }
  return value;
}

export function operationsCode(value: string): string {
  const redacted = redactSecrets(value).trim();
  if (!/^[A-Za-z][A-Za-z0-9:_-]{0,99}$/.test(redacted)) return "UNSPECIFIED_FAILURE";
  return redacted.toUpperCase();
}

function alertPayload(input: OperationsAlertPayload): OperationsAlertPayload {
  const code = input.code;
  if (code !== undefined && !ALERT_CODES.has(code)) {
    throw new Error("Unsupported operations alert code");
  }
  const count = safeInteger(input.count, "Operations alert count");
  const maxAgeSeconds = safeInteger(
    input.maxAgeSeconds,
    "Operations alert maximum age",
    31_536_000,
  );
  return {
    ...(code === undefined ? {} : { code }),
    ...(count === undefined ? {} : { count }),
    ...(maxAgeSeconds === undefined ? {} : { maxAgeSeconds }),
  };
}

function alertDedupeHash(eventType: OperationsAlertEvent, dedupeKey: string): string {
  if (!dedupeKey.trim() || dedupeKey.length > 1_000) {
    throw new Error("Operations alerts require a bounded stable dedupe key");
  }
  return `sha256:${createHash("sha256")
    .update(`trendsfast:ops-alert:v1\0${eventType}\0${dedupeKey}`)
    .digest("hex")}`;
}

function boundedLeaseOwner(owner: string): string {
  const normalized = operationsCode(owner).slice(0, 50);
  return `${normalized}:${randomUUID()}`;
}

export async function enqueueOperationsAlert(
  db: DatabaseExecutor,
  input: {
    eventType: OperationsAlertEvent;
    severity: AlertSeverity;
    dedupeKey: string;
    payload?: OperationsAlertPayload;
    occurredAt?: Date;
    maxAttempts?: number;
  },
) {
  if (!ALERT_EVENTS.has(input.eventType)) throw new Error("Unsupported operations alert event");
  if (input.severity !== "warning" && input.severity !== "critical") {
    throw new Error("Unsupported operations alert severity");
  }
  const maxAttempts = input.maxAttempts ?? 3;
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) {
    throw new Error("Operations alert attempts must be between 1 and 10");
  }
  const occurredAt = validDate(input.occurredAt ?? new Date(), "Operations alert time");
  const dedupeHash = alertDedupeHash(input.eventType, input.dedupeKey);
  const [inserted] = await db
    .insert(operationsAlertQueue)
    .values({
      eventType: input.eventType,
      severity: input.severity,
      dedupeHash,
      payload: alertPayload(input.payload ?? {}),
      maxAttempts,
      nextAttemptAt: occurredAt,
      occurredAt,
    })
    .onConflictDoNothing()
    .returning();
  if (inserted) return { alert: inserted, created: true as const };
  const [existing] = await db
    .select()
    .from(operationsAlertQueue)
    .where(eq(operationsAlertQueue.dedupeHash, dedupeHash))
    .limit(1);
  if (!existing) throw new Error("The operations alert dedupe record could not be resolved");
  return { alert: existing, created: false as const };
}

export type OperationsAlertClaim = typeof operationsAlertQueue.$inferSelect & {
  leaseOwner: string;
  leaseExpiresAt: Date;
};

export type ReliabilitySignals = {
  reviewQueueAge: { count: number; maxAgeSeconds: number };
  providerDegradationCount: number;
  costRejectionCount: number;
  stripeWebhookFailureCount: number;
  unhealthyOperationalCheckCount: number;
};

export class OperationsRepository {
  constructor(private readonly db: TrendsFastDatabase) {}

  /** Opaque fail-closed fence for managed provider/model effects; returns no policy values. */
  async assertManagedPolicyRevision(expectedRevision: string): Promise<void> {
    if (!/^[A-Za-z0-9_-]{32,200}$/.test(expectedRevision)) {
      throw new Error("Managed runtime policy revision is invalid");
    }
    await this.db.execute(sql`
      select public.trendsfast_assert_managed_policy_revision(${expectedRevision})
    `);
  }

  enqueueAlert(input: Parameters<typeof enqueueOperationsAlert>[1]) {
    return enqueueOperationsAlert(this.db, input);
  }

  async claimDueAlerts(input: {
    now: Date;
    batchSize: number;
    leaseSeconds: number;
    leaseOwner: string;
  }): Promise<{ claims: OperationsAlertClaim[]; deadLetter: number }> {
    validDate(input.now, "Operations alert claim time");
    if (!Number.isSafeInteger(input.batchSize) || input.batchSize < 1 || input.batchSize > 10) {
      throw new Error("Operations alert batch size must be between 1 and 10");
    }
    if (
      !Number.isSafeInteger(input.leaseSeconds) ||
      input.leaseSeconds < 10 ||
      input.leaseSeconds > 300
    ) {
      throw new Error("Operations alert lease must be between 10 and 300 seconds");
    }
    const claims: OperationsAlertClaim[] = [];
    for (let index = 0; index < input.batchSize; index++) {
      const outcome = await this.db.transaction(async (tx) => {
        const [candidate] = await tx
          .select()
          .from(operationsAlertQueue)
          .where(
            or(
              and(
                eq(operationsAlertQueue.state, "PENDING"),
                lte(operationsAlertQueue.nextAttemptAt, input.now),
              ),
              and(
                eq(operationsAlertQueue.state, "SENDING"),
                lte(operationsAlertQueue.leaseExpiresAt, input.now),
              ),
            ),
          )
          .orderBy(asc(operationsAlertQueue.nextAttemptAt))
          .limit(1)
          .for("update", { skipLocked: true });
        if (!candidate) return { state: "EMPTY" as const };
        if (candidate.attempt >= candidate.maxAttempts) {
          await tx
            .update(operationsAlertQueue)
            .set({
              state: "DEAD_LETTER",
              leaseOwner: null,
              leaseExpiresAt: null,
              lastFailureCode: candidate.lastFailureCode ?? "ALERT_ATTEMPTS_EXHAUSTED",
              updatedAt: input.now,
            })
            .where(eq(operationsAlertQueue.id, candidate.id));
          return { state: "DEAD_LETTER" as const };
        }
        const leaseOwner = boundedLeaseOwner(input.leaseOwner);
        const leaseExpiresAt = new Date(input.now.getTime() + input.leaseSeconds * 1_000);
        const [claimed] = await tx
          .update(operationsAlertQueue)
          .set({
            state: "SENDING",
            attempt: candidate.attempt + 1,
            leaseOwner,
            leaseExpiresAt,
            updatedAt: input.now,
          })
          .where(eq(operationsAlertQueue.id, candidate.id))
          .returning();
        return claimed
          ? {
              state: "CLAIMED" as const,
              claim: { ...claimed, leaseOwner, leaseExpiresAt } as OperationsAlertClaim,
            }
          : { state: "STALE" as const };
      });
      if (outcome.state === "EMPTY") break;
      if (outcome.state === "DEAD_LETTER") {
        continue;
      }
      if (outcome.state === "CLAIMED") claims.push(outcome.claim);
    }
    // Report durable queue health, not only transitions performed by this
    // invocation. A final-attempt crash must keep the authenticated cron red
    // until an operator resolves the dead letter instead of disappearing from
    // the next dispatch summary.
    const [deadLetters] = await this.db
      .select({ total: count() })
      .from(operationsAlertQueue)
      .where(eq(operationsAlertQueue.state, "DEAD_LETTER"));
    return { claims, deadLetter: Number(deadLetters?.total ?? 0) };
  }

  async completeAlert(input: { id: string; leaseOwner: string; now: Date }) {
    const [updated] = await this.db
      .update(operationsAlertQueue)
      .set({
        state: "DELIVERED",
        leaseOwner: null,
        leaseExpiresAt: null,
        lastFailureCode: null,
        deliveredAt: validDate(input.now, "Operations alert delivery time"),
        updatedAt: input.now,
      })
      .where(
        and(
          eq(operationsAlertQueue.id, input.id),
          eq(operationsAlertQueue.state, "SENDING"),
          eq(operationsAlertQueue.leaseOwner, input.leaseOwner),
        ),
      )
      .returning({ id: operationsAlertQueue.id });
    return Boolean(updated);
  }

  async failAlert(input: {
    id: string;
    leaseOwner: string;
    failureCode: string;
    retryBaseSeconds: number;
    now: Date;
  }) {
    validDate(input.now, "Operations alert failure time");
    if (
      !Number.isSafeInteger(input.retryBaseSeconds) ||
      input.retryBaseSeconds < 10 ||
      input.retryBaseSeconds > 3_600
    ) {
      throw new Error("Operations alert retry base must be between 10 and 3600 seconds");
    }
    return this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(operationsAlertQueue)
        .where(
          and(
            eq(operationsAlertQueue.id, input.id),
            eq(operationsAlertQueue.state, "SENDING"),
            eq(operationsAlertQueue.leaseOwner, input.leaseOwner),
          ),
        )
        .limit(1)
        .for("update");
      if (!current) return { current: false as const, deadLetter: false as const };
      const exhausted = current.attempt >= current.maxAttempts;
      const retryDelaySeconds = Math.min(
        3_600,
        input.retryBaseSeconds * 2 ** Math.max(0, current.attempt - 1),
      );
      await tx
        .update(operationsAlertQueue)
        .set({
          state: exhausted ? "DEAD_LETTER" : "PENDING",
          leaseOwner: null,
          leaseExpiresAt: null,
          lastFailureCode: operationsCode(input.failureCode),
          nextAttemptAt: exhausted
            ? current.nextAttemptAt
            : new Date(input.now.getTime() + retryDelaySeconds * 1_000),
          updatedAt: input.now,
        })
        .where(eq(operationsAlertQueue.id, current.id));
      return { current: true as const, deadLetter: exhausted };
    });
  }

  async claimDailyReconciliation(input: { now: Date; leaseSeconds: number; leaseOwner: string }) {
    validDate(input.now, "Operations reconciliation time");
    if (
      !Number.isSafeInteger(input.leaseSeconds) ||
      input.leaseSeconds < 30 ||
      input.leaseSeconds > 300
    ) {
      throw new Error("Operations reconciliation lease must be between 30 and 300 seconds");
    }
    const periodStart = new Date(
      Date.UTC(input.now.getUTCFullYear(), input.now.getUTCMonth(), input.now.getUTCDate()),
    );
    return this.db.transaction(async (tx) => {
      const leaseOwner = boundedLeaseOwner(input.leaseOwner);
      const leaseExpiresAt = new Date(input.now.getTime() + input.leaseSeconds * 1_000);
      const [created] = await tx
        .insert(operationsReconciliationRuns)
        .values({
          periodStart,
          state: "RUNNING",
          leaseOwner,
          leaseExpiresAt,
          startedAt: input.now,
        })
        .onConflictDoNothing()
        .returning();
      if (created) return { ...created, leaseOwner, leaseExpiresAt };
      const [existing] = await tx
        .select()
        .from(operationsReconciliationRuns)
        .where(eq(operationsReconciliationRuns.periodStart, periodStart))
        .limit(1)
        .for("update");
      if (!existing || existing.state === "COMPLETED") return null;
      if (
        existing.state === "RUNNING" &&
        existing.leaseExpiresAt &&
        existing.leaseExpiresAt > input.now
      ) {
        return null;
      }
      const [reclaimed] = await tx
        .update(operationsReconciliationRuns)
        .set({
          state: "RUNNING",
          leaseOwner,
          leaseExpiresAt,
          summary: {},
          failureCode: null,
          startedAt: input.now,
          completedAt: null,
          updatedAt: input.now,
        })
        .where(eq(operationsReconciliationRuns.id, existing.id))
        .returning();
      return reclaimed ? { ...reclaimed, leaseOwner, leaseExpiresAt } : null;
    });
  }

  async completeDailyReconciliation(input: {
    id: string;
    leaseOwner: string;
    summary: ReliabilitySignals;
    now: Date;
  }) {
    const flatSummary = {
      reviewQueueCount: input.summary.reviewQueueAge.count,
      reviewQueueMaxAgeSeconds: input.summary.reviewQueueAge.maxAgeSeconds,
      providerDegradationCount: input.summary.providerDegradationCount,
      costRejectionCount: input.summary.costRejectionCount,
      stripeWebhookFailureCount: input.summary.stripeWebhookFailureCount,
      unhealthyOperationalCheckCount: input.summary.unhealthyOperationalCheckCount,
    };
    const [updated] = await this.db
      .update(operationsReconciliationRuns)
      .set({
        state: "COMPLETED",
        leaseOwner: null,
        leaseExpiresAt: null,
        summary: flatSummary,
        failureCode: null,
        completedAt: validDate(input.now, "Operations reconciliation completion time"),
        updatedAt: input.now,
      })
      .where(
        and(
          eq(operationsReconciliationRuns.id, input.id),
          eq(operationsReconciliationRuns.state, "RUNNING"),
          eq(operationsReconciliationRuns.leaseOwner, input.leaseOwner),
        ),
      )
      .returning({ id: operationsReconciliationRuns.id });
    return Boolean(updated);
  }

  async failDailyReconciliation(input: {
    id: string;
    leaseOwner: string;
    failureCode: string;
    now: Date;
  }) {
    const [updated] = await this.db
      .update(operationsReconciliationRuns)
      .set({
        state: "FAILED",
        leaseOwner: null,
        leaseExpiresAt: null,
        failureCode: operationsCode(input.failureCode),
        completedAt: validDate(input.now, "Operations reconciliation failure time"),
        updatedAt: input.now,
      })
      .where(
        and(
          eq(operationsReconciliationRuns.id, input.id),
          eq(operationsReconciliationRuns.state, "RUNNING"),
          eq(operationsReconciliationRuns.leaseOwner, input.leaseOwner),
        ),
      )
      .returning({ id: operationsReconciliationRuns.id });
    return Boolean(updated);
  }

  async collectReliabilitySignals(input: {
    now: Date;
    reviewAlertAgeSeconds: number;
    healthMaxAgeSeconds: number;
  }): Promise<ReliabilitySignals> {
    validDate(input.now, "Operations signal collection time");
    for (const [label, value] of [
      ["Review alert age", input.reviewAlertAgeSeconds],
      ["Health maximum age", input.healthMaxAgeSeconds],
    ] as const) {
      if (!Number.isSafeInteger(value) || value < 60 || value > 31_536_000) {
        throw new Error(`${label} must be between 60 seconds and one year`);
      }
    }
    const since = new Date(input.now.getTime() - 86_400_000);
    const reviewCutoff = new Date(input.now.getTime() - input.reviewAlertAgeSeconds * 1_000);
    const healthCutoff = new Date(input.now.getTime() - input.healthMaxAgeSeconds * 1_000);
    const [review, providerVerifications, degradedSources, costs, stripe, health] =
      await Promise.all([
        this.db
          .select({ total: count(), oldest: min(scanRequests.updatedAt) })
          .from(scanRequests)
          .where(
            and(
              eq(scanRequests.state, "REVIEW_REQUIRED"),
              lte(scanRequests.updatedAt, reviewCutoff),
            ),
          ),
        this.db
          .select({ total: count() })
          .from(providerVerificationRecords)
          .where(
            and(
              eq(providerVerificationRecords.deploymentEnvironment, "production"),
              inArray(providerVerificationRecords.state, ["DEGRADED", "FAILED"]),
              gte(providerVerificationRecords.completedAt, since),
            ),
          ),
        this.db
          .select({ total: count() })
          .from(sourceRuns)
          .innerJoin(scanRuns, eq(sourceRuns.scanRunId, scanRuns.id))
          .where(
            and(inArray(sourceRuns.state, ["DEGRADED", "FAILED"]), gte(scanRuns.startedAt, since)),
          ),
        this.db
          .select({ total: count() })
          .from(apiKeyAuthEvents)
          .where(
            and(
              eq(apiKeyAuthEvents.outcome, "COST_LIMITED"),
              gte(apiKeyAuthEvents.occurredAt, since),
            ),
          ),
        this.db
          .select({ total: count() })
          .from(billingWebhookEvents)
          .where(
            and(
              eq(billingWebhookEvents.state, "FAILED"),
              gte(billingWebhookEvents.receivedAt, since),
            ),
          ),
        this.db
          .select({
            checkType: operationsHealthChecks.checkType,
            lastSucceededAt: operationsHealthChecks.lastSucceededAt,
            lastFailedAt: operationsHealthChecks.lastFailedAt,
          })
          .from(operationsHealthChecks),
      ]);
    const oldestReview = review[0]?.oldest;
    const healthByType = new Map(health.map((record) => [record.checkType, record]));
    const unhealthyOperationalCheckCount = (["BACKUP", "RETENTION"] as const).filter((type) => {
      const record = healthByType.get(type);
      if (!record?.lastSucceededAt || record.lastSucceededAt < healthCutoff) return true;
      return Boolean(record.lastFailedAt && record.lastFailedAt > record.lastSucceededAt);
    }).length;
    return {
      reviewQueueAge: {
        count: Number(review[0]?.total ?? 0),
        maxAgeSeconds: oldestReview
          ? Math.max(0, Math.floor((input.now.getTime() - oldestReview.getTime()) / 1_000))
          : 0,
      },
      providerDegradationCount:
        Number(providerVerifications[0]?.total ?? 0) + Number(degradedSources[0]?.total ?? 0),
      costRejectionCount: Number(costs[0]?.total ?? 0),
      stripeWebhookFailureCount: Number(stripe[0]?.total ?? 0),
      unhealthyOperationalCheckCount,
    };
  }

  async recordBackupHealth(input: { succeeded: boolean; failureCode?: string }): Promise<void> {
    const failureCode = input.succeeded
      ? null
      : operationsCode(input.failureCode ?? "BACKUP_FAILED");
    await this.db.execute(sql`
      select public.trendsfast_record_backup_health(${input.succeeded}, ${failureCode})
    `);
    if (!input.succeeded) {
      const now = new Date();
      await enqueueOperationsAlert(this.db, {
        eventType: "BACKUP_RETENTION_FAILURE",
        severity: "critical",
        dedupeKey: `BACKUP:${now.toISOString()}`,
        payload: { code: "BACKUP_FAILED", count: 1 },
        occurredAt: now,
      });
    }
  }
}
