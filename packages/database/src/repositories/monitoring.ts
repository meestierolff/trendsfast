import { randomUUID } from "node:crypto";

import { and, asc, desc, eq, inArray, lte, or, sql } from "drizzle-orm";

import { createPublicScanToken, digestNextMoveRequest, redactSecrets } from "@trendsfast/core";
import type { NextMoveRequest } from "@trendsfast/schemas";

import type { TrendsFastDatabase } from "../client";
import {
  founderUsageEvents,
  monitoringRuns,
  monitoringSubscriptions,
  providerCostLedger,
  projectEntitlements,
  projects,
  scanRequests,
  scanRuns,
  sourceRuns,
  subscriptions,
} from "../schema";
import { admitFounderUsage, lockProjectEntitlementScope } from "./founder-usage";
import {
  decideMonitoringClaim,
  decideMonitoringFailure,
  monitoringRetryDelaySeconds,
  nextMonitoringDueAt,
  type MonitoringFailureDisposition,
} from "./monitoring-model";
import { enqueueOperationsAlert } from "./operations";

export type MonitoringClaim = Omit<
  typeof monitoringRuns.$inferSelect,
  "scanRequestId" | "leaseOwner" | "leaseExpiresAt"
> & {
  scanRequestId: string;
  leaseOwner: string;
  leaseExpiresAt: Date;
  scanPublicId: string;
};

function asClaim(run: typeof monitoringRuns.$inferSelect, scanPublicId: string): MonitoringClaim {
  if (!run.scanRequestId || !run.leaseOwner || !run.leaseExpiresAt) {
    throw new Error("A processing monitoring run is missing its claim fields");
  }
  return {
    ...run,
    scanRequestId: run.scanRequestId,
    leaseOwner: run.leaseOwner,
    leaseExpiresAt: run.leaseExpiresAt,
    scanPublicId,
  };
}

function validEntitlement(
  row: {
    entitlement: Pick<
      typeof projectEntitlements.$inferSelect,
      "projectId" | "subscriptionId" | "active" | "periodStart" | "periodEnd"
    >;
    subscription: Pick<typeof subscriptions.$inferSelect, "id" | "status">;
    project: typeof projects.$inferSelect;
  },
  now: Date,
) {
  const start = row.entitlement.periodStart;
  const end = row.entitlement.periodEnd;
  return Boolean(
    row.entitlement.active &&
    row.project.status === "ACTIVE" &&
    (row.subscription.status === "ACTIVE" || row.subscription.status === "TRIALING") &&
    start &&
    end &&
    now >= start &&
    now < end,
  );
}

function requestFromProject(
  project: typeof projects.$inferSelect,
  prior: typeof scanRequests.$inferSelect | undefined,
): NextMoveRequest {
  return {
    product_url: project.url,
    ...(prior?.goal ? { goal: prior.goal } : {}),
    ...(prior?.market ? { market: prior.market } : {}),
    ...(prior?.language ? { language: prior.language } : {}),
    ...(prior?.preferredChannels ? { preferred_channels: prior.preferredChannels } : {}),
    ...(prior?.availableFormats ? { available_formats: prior.availableFormats } : {}),
  };
}

function boundedLeaseOwner(owner: string) {
  const normalized = owner.trim();
  if (!normalized || normalized.length > 60) {
    throw new Error("Monitoring lease owner must contain 1–60 characters");
  }
  return `${normalized}:${randomUUID()}`;
}

function assertClaimBounds(input: { batchSize: number; leaseSeconds: number; now: Date }) {
  if (!Number.isSafeInteger(input.batchSize) || input.batchSize < 1 || input.batchSize > 10) {
    throw new Error("Monitoring batch size must be between 1 and 10");
  }
  if (
    !Number.isSafeInteger(input.leaseSeconds) ||
    input.leaseSeconds < 60 ||
    input.leaseSeconds > 900
  ) {
    throw new Error("Monitoring lease must be between 60 and 900 seconds");
  }
  if (Number.isNaN(input.now.getTime())) throw new Error("Monitoring claim time is invalid");
}

function assertRetryPolicy(input: { maxAttempts: number; retryBaseSeconds: number }) {
  if (!Number.isSafeInteger(input.maxAttempts) || input.maxAttempts < 1 || input.maxAttempts > 10) {
    throw new Error("Monitoring attempts must be between 1 and 10");
  }
  if (
    !Number.isSafeInteger(input.retryBaseSeconds) ||
    input.retryBaseSeconds < 30 ||
    input.retryBaseSeconds > 86_400
  ) {
    throw new Error("Monitoring retry base must be between 30 and 86400 seconds");
  }
}

async function latestScanRun(tx: TrendsFastDatabase, scanRequestId: string) {
  const [run] = await tx
    .select()
    .from(scanRuns)
    .where(eq(scanRuns.scanRequestId, scanRequestId))
    .orderBy(desc(scanRuns.attempt))
    .limit(1);
  return run ?? null;
}

async function hasUnknownExternalOutcome(tx: TrendsFastDatabase, scanRequestId: string) {
  const [[runningSource], [unsettledReservation]] = await Promise.all([
    tx
      .select({ id: sourceRuns.id })
      .from(sourceRuns)
      .innerJoin(scanRuns, eq(sourceRuns.scanRunId, scanRuns.id))
      .where(and(eq(scanRuns.scanRequestId, scanRequestId), eq(sourceRuns.state, "RUNNING")))
      .limit(1),
    tx
      .select({ id: providerCostLedger.id })
      .from(providerCostLedger)
      .innerJoin(scanRuns, eq(providerCostLedger.scanRunId, scanRuns.id))
      .where(
        and(
          eq(scanRuns.scanRequestId, scanRequestId),
          sql`${providerCostLedger.unitMetadata}->>'usage_status' = 'unknown_not_settled'`,
        ),
      )
      .limit(1),
  ]);
  return Boolean(runningSource || unsettledReservation);
}

async function failExpiredUnderlyingScan(
  tx: TrendsFastDatabase,
  scanRequestId: string,
  failureCode: string,
  now: Date,
) {
  const code = redactSecrets(failureCode).slice(0, 100) || "MONITORING_LEASE_EXPIRED";
  await tx
    .update(scanRequests)
    .set({
      state: "FAILED",
      completedAt: now,
      failureCode: code,
      failureMessage: "The monitoring worker lease expired before durable completion.",
      updatedAt: now,
    })
    .where(
      and(eq(scanRequests.id, scanRequestId), inArray(scanRequests.state, ["QUEUED", "RUNNING"])),
    );
  const run = await latestScanRun(tx, scanRequestId);
  if (run && (run.state === "QUEUED" || run.state === "RUNNING")) {
    await tx
      .update(scanRuns)
      .set({
        state: "FAILED",
        processingFence: null,
        completedAt: now,
        failureCode: code,
        failureMessage: "The monitoring worker lease expired before durable completion.",
        updatedAt: now,
      })
      .where(eq(scanRuns.id, run.id));
  }
}

async function transitionMonitoringFailure(
  tx: TrendsFastDatabase,
  input: {
    run: typeof monitoringRuns.$inferSelect;
    requestedDisposition: MonitoringFailureDisposition;
    failureCode: string;
    now: Date;
  },
) {
  const failureCode = redactSecrets(input.failureCode).slice(0, 100) || "MONITORING_FAILED";
  const unknownExternalOutcome = input.run.scanRequestId
    ? await hasUnknownExternalOutcome(tx, input.run.scanRequestId)
    : true;
  const decision = decideMonitoringFailure({
    requestedDisposition: input.requestedDisposition,
    hasUnknownExternalOutcome: unknownExternalOutcome,
    attempt: input.run.attempt,
    maxAttempts: input.run.maxAttempts,
  });
  const retryAt =
    decision.state === "RETRY_WAIT"
      ? new Date(
          input.now.getTime() +
            monitoringRetryDelaySeconds(input.run.attempt, input.run.retryBaseSeconds) * 1_000,
        )
      : null;
  const [updated] = await tx
    .update(monitoringRuns)
    .set({
      state: decision.state,
      leaseOwner: null,
      leaseExpiresAt: null,
      completedAt: decision.state === "RETRY_WAIT" ? null : input.now,
      failureCode,
      failureDisposition: decision.disposition,
      nextRetryAt: retryAt,
      quarantinedAt: decision.state === "QUARANTINED" ? input.now : null,
      deadLetteredAt: decision.state === "DEAD_LETTER" ? input.now : null,
      updatedAt: input.now,
    })
    .where(eq(monitoringRuns.id, input.run.id))
    .returning();
  if (!updated) throw new Error("The monitoring failure could not be persisted");
  if (decision.state !== "RETRY_WAIT") {
    await tx
      .update(monitoringSubscriptions)
      .set({ state: "PAUSED", updatedAt: input.now })
      .where(
        and(
          eq(monitoringSubscriptions.id, input.run.monitoringSubscriptionId),
          inArray(monitoringSubscriptions.state, ["ACTIVE", "PAUSED"]),
        ),
      );
  }
  await enqueueOperationsAlert(tx as unknown as TrendsFastDatabase, {
    eventType: "MONITORING_FAILURE",
    severity:
      decision.state === "QUARANTINED" || decision.state === "DEAD_LETTER" ? "critical" : "warning",
    dedupeKey: `${input.run.id}:${input.run.attempt}:${decision.state}`,
    payload: {
      code:
        decision.state === "RETRY_WAIT"
          ? "MONITORING_RETRY_SCHEDULED"
          : decision.state === "QUARANTINED"
            ? "PROVIDER_OUTCOME_UNKNOWN"
            : decision.state === "DEAD_LETTER"
              ? "MONITORING_ATTEMPTS_EXHAUSTED"
              : "MONITORING_TERMINAL_FAILURE",
      count: 1,
    },
    occurredAt: input.now,
  });
  return updated;
}

export class MonitoringRepository {
  constructor(private readonly db: TrendsFastDatabase) {}

  async claimDue(input: {
    now: Date;
    batchSize: number;
    leaseSeconds: number;
    leaseOwner: string;
    maxAttempts: number;
    retryBaseSeconds: number;
  }): Promise<MonitoringClaim[]> {
    assertClaimBounds(input);
    assertRetryPolicy(input);
    const claims: MonitoringClaim[] = [];

    // A bounded number of skipped candidates lets an inactive or daily-limited
    // subscription be repaired without allowing one row to starve the batch.
    for (
      let attempt = 0;
      attempt < input.batchSize * 4 && claims.length < input.batchSize;
      attempt++
    ) {
      const outcome = await this.claimOne(input);
      if (outcome.status === "EMPTY") break;
      if (outcome.status === "CLAIMED") claims.push(outcome.claim);
    }
    return claims;
  }

  private async claimRetry(input: {
    now: Date;
    leaseSeconds: number;
    leaseOwner: string;
    maxAttempts: number;
    retryBaseSeconds: number;
  }): Promise<{ status: "EMPTY" | "SKIPPED" } | { status: "CLAIMED"; claim: MonitoringClaim }> {
    return this.db.transaction(async (rawTx) => {
      const tx = rawTx as unknown as TrendsFastDatabase;
      const [candidateIdentity] = await tx
        .select({ id: monitoringRuns.id, projectId: monitoringSubscriptions.projectId })
        .from(monitoringRuns)
        .innerJoin(
          monitoringSubscriptions,
          eq(monitoringRuns.monitoringSubscriptionId, monitoringSubscriptions.id),
        )
        .where(
          and(eq(monitoringRuns.state, "RETRY_WAIT"), lte(monitoringRuns.nextRetryAt, input.now)),
        )
        .orderBy(asc(monitoringRuns.nextRetryAt))
        .limit(1);
      if (!candidateIdentity) return { status: "EMPTY" as const };
      await lockProjectEntitlementScope(tx, candidateIdentity.projectId);
      const [candidate] = await tx
        .select({
          run: monitoringRuns,
          monitoring: monitoringSubscriptions,
          entitlement: {
            projectId: projectEntitlements.projectId,
            subscriptionId: projectEntitlements.subscriptionId,
            active: projectEntitlements.active,
            periodStart: projectEntitlements.periodStart,
            periodEnd: projectEntitlements.periodEnd,
          },
          subscription: { id: subscriptions.id, status: subscriptions.status },
          project: projects,
        })
        .from(monitoringRuns)
        .innerJoin(
          monitoringSubscriptions,
          eq(monitoringRuns.monitoringSubscriptionId, monitoringSubscriptions.id),
        )
        .innerJoin(
          projectEntitlements,
          eq(monitoringSubscriptions.projectId, projectEntitlements.projectId),
        )
        .innerJoin(subscriptions, eq(monitoringSubscriptions.subscriptionId, subscriptions.id))
        .innerJoin(projects, eq(monitoringSubscriptions.projectId, projects.id))
        .where(
          and(
            eq(monitoringRuns.id, candidateIdentity.id),
            eq(monitoringRuns.state, "RETRY_WAIT"),
            lte(monitoringRuns.nextRetryAt, input.now),
          ),
        )
        .orderBy(asc(monitoringRuns.nextRetryAt))
        .limit(1)
        // Lock subscriptions before runs everywhere. Billing and fresh claims
        // use the same order, avoiding a run -> subscription deadlock while a
        // retry is being terminalized or an entitlement is revoked.
        .for("update", { of: monitoringSubscriptions, skipLocked: true });
      if (!candidate) return { status: "SKIPPED" as const };
      const [lockedRun] = await tx
        .select()
        .from(monitoringRuns)
        .where(
          and(
            eq(monitoringRuns.id, candidate.run.id),
            eq(monitoringRuns.state, "RETRY_WAIT"),
            lte(monitoringRuns.nextRetryAt, input.now),
          ),
        )
        .limit(1)
        .for("update");
      if (!lockedRun) return { status: "SKIPPED" as const };
      if (candidate.monitoring.state !== "ACTIVE" || !validEntitlement(candidate, input.now)) {
        await transitionMonitoringFailure(tx, {
          run: lockedRun,
          requestedDisposition: "KNOWN_TERMINAL",
          failureCode: "ENTITLEMENT_INACTIVE",
          now: input.now,
        });
        return { status: "SKIPPED" as const };
      }
      if (!lockedRun.scanRequestId) {
        await transitionMonitoringFailure(tx, {
          run: lockedRun,
          requestedDisposition: "OUTCOME_UNKNOWN",
          failureCode: "MONITORING_SCAN_IDENTITY_MISSING",
          now: input.now,
        });
        return { status: "SKIPPED" as const };
      }
      if (await hasUnknownExternalOutcome(tx, lockedRun.scanRequestId)) {
        await transitionMonitoringFailure(tx, {
          run: lockedRun,
          requestedDisposition: "OUTCOME_UNKNOWN",
          failureCode: "PROVIDER_OUTCOME_UNKNOWN",
          now: input.now,
        });
        return { status: "SKIPPED" as const };
      }
      const [request] = await tx
        .select()
        .from(scanRequests)
        .where(eq(scanRequests.id, lockedRun.scanRequestId))
        .limit(1)
        .for("update");
      if (!request || (request.state !== "FAILED" && request.state !== "QUEUED")) {
        await transitionMonitoringFailure(tx, {
          run: lockedRun,
          requestedDisposition: "OUTCOME_UNKNOWN",
          failureCode: "MONITORING_RETRY_STATE_CONFLICT",
          now: input.now,
        });
        return { status: "SKIPPED" as const };
      }
      if (lockedRun.attempt >= lockedRun.maxAttempts) {
        await transitionMonitoringFailure(tx, {
          run: lockedRun,
          requestedDisposition: "KNOWN_RETRYABLE",
          failureCode: lockedRun.failureCode ?? "MONITORING_ATTEMPTS_EXHAUSTED",
          now: input.now,
        });
        return { status: "SKIPPED" as const };
      }
      if (request.state === "FAILED") {
        await tx
          .update(scanRequests)
          .set({
            state: "QUEUED",
            completedAt: null,
            failureCode: null,
            failureMessage: null,
            updatedAt: input.now,
          })
          .where(eq(scanRequests.id, request.id));
      }
      const leaseOwner = boundedLeaseOwner(input.leaseOwner);
      const leaseExpiresAt = new Date(input.now.getTime() + input.leaseSeconds * 1_000);
      const [claimed] = await tx
        .update(monitoringRuns)
        .set({
          state: "PROCESSING",
          attempt: lockedRun.attempt + 1,
          leaseOwner,
          leaseExpiresAt,
          claimedAt: input.now,
          completedAt: null,
          failureCode: null,
          failureDisposition: null,
          nextRetryAt: null,
          quarantinedAt: null,
          deadLetteredAt: null,
          updatedAt: input.now,
        })
        .where(and(eq(monitoringRuns.id, lockedRun.id), eq(monitoringRuns.state, "RETRY_WAIT")))
        .returning();
      if (!claimed) return { status: "SKIPPED" as const };
      return { status: "CLAIMED" as const, claim: asClaim(claimed, request.publicId) };
    });
  }

  private async claimOne(input: {
    now: Date;
    leaseSeconds: number;
    leaseOwner: string;
    maxAttempts: number;
    retryBaseSeconds: number;
  }): Promise<{ status: "EMPTY" | "SKIPPED" } | { status: "CLAIMED"; claim: MonitoringClaim }> {
    const retry = await this.claimRetry(input);
    if (retry.status !== "EMPTY") return retry;
    return this.db.transaction(async (rawTx) => {
      const tx = rawTx as unknown as TrendsFastDatabase;
      const duePredicate = and(
        eq(monitoringSubscriptions.state, "ACTIVE"),
        or(
          and(
            lte(monitoringSubscriptions.nextDueAt, input.now),
            sql`NOT EXISTS (
              SELECT 1 FROM ${monitoringRuns}
              WHERE ${monitoringRuns.monitoringSubscriptionId} = ${monitoringSubscriptions.id}
                AND ${monitoringRuns.state} IN ('PROCESSING','RETRY_WAIT')
            )`,
          ),
          sql`EXISTS (
            SELECT 1 FROM ${monitoringRuns}
            WHERE ${monitoringRuns.monitoringSubscriptionId} = ${monitoringSubscriptions.id}
              AND ${monitoringRuns.state} = 'PROCESSING'
              AND ${monitoringRuns.leaseExpiresAt} <= ${input.now}
          )`,
        ),
      );
      const [candidateIdentity] = await tx
        .select({ id: monitoringSubscriptions.id, projectId: monitoringSubscriptions.projectId })
        .from(monitoringSubscriptions)
        .where(duePredicate)
        .orderBy(asc(monitoringSubscriptions.nextDueAt))
        .limit(1);
      if (!candidateIdentity) return { status: "EMPTY" as const };
      await lockProjectEntitlementScope(tx, candidateIdentity.projectId);
      const [candidate] = await tx
        .select({
          monitoring: monitoringSubscriptions,
          entitlement: {
            projectId: projectEntitlements.projectId,
            subscriptionId: projectEntitlements.subscriptionId,
            active: projectEntitlements.active,
            periodStart: projectEntitlements.periodStart,
            periodEnd: projectEntitlements.periodEnd,
          },
          subscription: { id: subscriptions.id, status: subscriptions.status },
          project: projects,
        })
        .from(monitoringSubscriptions)
        .innerJoin(
          projectEntitlements,
          eq(monitoringSubscriptions.projectId, projectEntitlements.projectId),
        )
        .innerJoin(subscriptions, eq(monitoringSubscriptions.subscriptionId, subscriptions.id))
        .innerJoin(projects, eq(monitoringSubscriptions.projectId, projects.id))
        .where(and(eq(monitoringSubscriptions.id, candidateIdentity.id), duePredicate))
        .orderBy(asc(monitoringSubscriptions.nextDueAt))
        .limit(1)
        .for("update", { of: monitoringSubscriptions, skipLocked: true });
      if (!candidate) return { status: "SKIPPED" as const };

      const [openRun] = await tx
        .select()
        .from(monitoringRuns)
        .where(
          and(
            eq(monitoringRuns.monitoringSubscriptionId, candidate.monitoring.id),
            inArray(monitoringRuns.state, ["PROCESSING", "RETRY_WAIT"]),
          ),
        )
        .limit(1)
        .for("update");
      const entitlementActive = validEntitlement(candidate, input.now);
      // The candidate predicate normally excludes RETRY_WAIT. Recheck after
      // locking so a concurrent PROCESSING -> RETRY_WAIT transition cannot
      // admit the next daily slot between the predicate and this row read.
      if (openRun?.state === "RETRY_WAIT" && entitlementActive) {
        return { status: "SKIPPED" as const };
      }
      const decision = decideMonitoringClaim({
        status: candidate.monitoring.state,
        entitlementActive,
        nextDueAt: candidate.monitoring.nextDueAt,
        now: input.now,
        openRunLeaseExpiresAt:
          openRun?.state === "PROCESSING" ? (openRun.leaseExpiresAt ?? null) : null,
      });

      if (decision === "PAUSE") {
        const terminal = ["CANCELED", "INCOMPLETE_EXPIRED"].includes(candidate.subscription.status);
        if (openRun) {
          await transitionMonitoringFailure(tx, {
            run: openRun,
            requestedDisposition: "KNOWN_TERMINAL",
            failureCode: "ENTITLEMENT_INACTIVE",
            now: input.now,
          });
        }
        // Apply terminal subscription truth after the helper's generic pause so
        // a canceled Stripe subscription cannot be reopened by recovery.
        await tx
          .update(monitoringSubscriptions)
          .set({ state: terminal ? "CANCELED" : "PAUSED", updatedAt: input.now })
          .where(eq(monitoringSubscriptions.id, candidate.monitoring.id));
        return { status: "SKIPPED" as const };
      }
      if (decision !== "CLAIM" && decision !== "RECLAIM") {
        return { status: "SKIPPED" as const };
      }

      const leaseOwner = boundedLeaseOwner(input.leaseOwner);
      const leaseExpiresAt = new Date(input.now.getTime() + input.leaseSeconds * 1_000);
      if (decision === "RECLAIM") {
        if (!openRun) throw new Error("A reclaim decision requires an expired monitoring run");
        if (!openRun.scanRequestId) {
          await transitionMonitoringFailure(tx as unknown as TrendsFastDatabase, {
            run: openRun,
            requestedDisposition: "OUTCOME_UNKNOWN",
            failureCode: "MONITORING_SCAN_IDENTITY_MISSING",
            now: input.now,
          });
          return { status: "SKIPPED" as const };
        }
        const [request] = await tx
          .select()
          .from(scanRequests)
          .where(eq(scanRequests.id, openRun.scanRequestId))
          .limit(1)
          .for("update");
        if (!request) {
          await transitionMonitoringFailure(tx as unknown as TrendsFastDatabase, {
            run: openRun,
            requestedDisposition: "OUTCOME_UNKNOWN",
            failureCode: "MONITORING_SCAN_IDENTITY_MISSING",
            now: input.now,
          });
          return { status: "SKIPPED" as const };
        }
        if (request.state === "REVIEW_REQUIRED" || request.state === "READY") {
          await tx
            .update(monitoringRuns)
            .set({
              state: request.state === "REVIEW_REQUIRED" ? "REVIEW_REQUIRED" : "COMPLETED",
              leaseOwner: null,
              leaseExpiresAt: null,
              completedAt: input.now,
              failureCode: null,
              failureDisposition: null,
              nextRetryAt: null,
              quarantinedAt: null,
              deadLetteredAt: null,
              updatedAt: input.now,
            })
            .where(eq(monitoringRuns.id, openRun.id));
          return { status: "SKIPPED" as const };
        }
        let requestedDisposition: MonitoringFailureDisposition =
          request.failureCode === "PROVIDER_OUTCOME_UNKNOWN" ||
          request.failureCode === "MODEL_OUTCOME_UNKNOWN"
            ? "OUTCOME_UNKNOWN"
            : request.failureCode === "SCAN_DEADLINE_EXCEEDED"
              ? "KNOWN_RETRYABLE"
              : request.state === "FAILED"
                ? "KNOWN_TERMINAL"
                : "KNOWN_RETRYABLE";
        let failureCode = request.failureCode ?? "MONITORING_LEASE_EXPIRED";
        if (request.state !== "FAILED") {
          const unknown = await hasUnknownExternalOutcome(
            tx as unknown as TrendsFastDatabase,
            request.id,
          );
          if (unknown) {
            requestedDisposition = "OUTCOME_UNKNOWN";
            failureCode = "PROVIDER_OUTCOME_UNKNOWN";
          }
          await failExpiredUnderlyingScan(
            tx as unknown as TrendsFastDatabase,
            request.id,
            failureCode,
            input.now,
          );
        }
        await transitionMonitoringFailure(tx as unknown as TrendsFastDatabase, {
          run: openRun,
          requestedDisposition,
          failureCode,
          now: input.now,
        });
        return { status: "SKIPPED" as const };
      }

      const scheduledFor = candidate.monitoring.nextDueAt;
      const idempotencyKey = `monitoring:${candidate.monitoring.id}:${scheduledFor.toISOString()}`;
      const admission = await admitFounderUsage(tx, {
        projectId: candidate.project.id,
        kind: "SCHEDULED_RUN_ACCEPTED",
        idempotencyKey,
        occurredAt: input.now,
      });
      if (admission.status === "LIMITED") {
        await tx
          .update(monitoringSubscriptions)
          .set({
            nextDueAt: nextMonitoringDueAt(candidate.monitoring.nextDueAt, input.now),
            updatedAt: input.now,
          })
          .where(eq(monitoringSubscriptions.id, candidate.monitoring.id));
        return { status: "SKIPPED" as const };
      }
      if (admission.status === "REUSED") {
        throw new Error("A monitoring usage acceptance exists without its durable run");
      }

      const [prior] = await tx
        .select()
        .from(scanRequests)
        .where(eq(scanRequests.projectId, candidate.project.id))
        .orderBy(sql`${scanRequests.submittedAt} DESC`)
        .limit(1);
      const request = requestFromProject(candidate.project, prior);
      const [createdRequest] = await tx
        .insert(scanRequests)
        .values({
          publicId: createPublicScanToken(),
          projectId: candidate.project.id,
          origin: "MONITORING",
          state: "QUEUED",
          submittedUrl: request.product_url,
          normalizedUrl: candidate.project.normalizedUrl,
          goal: request.goal ?? null,
          market: request.market ?? null,
          language: request.language ?? null,
          preferredChannels: request.preferred_channels ?? null,
          availableFormats: request.available_formats ?? null,
          requestPayloadHash: digestNextMoveRequest(request),
          submittedAt: input.now,
        })
        .returning();
      if (!createdRequest) throw new Error("The scheduled monitoring scan could not be created");
      await tx
        .update(founderUsageEvents)
        .set({ scanRequestId: createdRequest.id })
        .where(eq(founderUsageEvents.id, admission.event.id));

      const [run] = await tx
        .insert(monitoringRuns)
        .values({
          monitoringSubscriptionId: candidate.monitoring.id,
          projectId: candidate.project.id,
          scanRequestId: createdRequest.id,
          scheduledFor,
          idempotencyKey,
          state: "PROCESSING",
          attempt: 1,
          maxAttempts: input.maxAttempts,
          retryBaseSeconds: input.retryBaseSeconds,
          leaseOwner,
          leaseExpiresAt,
          claimedAt: input.now,
        })
        .returning();
      if (!run) throw new Error("The scheduled monitoring run could not be created");
      await tx
        .update(monitoringSubscriptions)
        .set({
          nextDueAt: nextMonitoringDueAt(candidate.monitoring.nextDueAt, input.now),
          lastClaimedAt: input.now,
          updatedAt: input.now,
        })
        .where(eq(monitoringSubscriptions.id, candidate.monitoring.id));
      return {
        status: "CLAIMED" as const,
        claim: asClaim(run, createdRequest.publicId),
      };
    });
  }

  async finish(input: {
    runId: string;
    leaseOwner: string;
    state: "REVIEW_REQUIRED" | "COMPLETED";
    now: Date;
  }) {
    const [updated] = await this.db
      .update(monitoringRuns)
      .set({
        state: input.state,
        leaseOwner: null,
        leaseExpiresAt: null,
        completedAt: input.now,
        failureCode: null,
        failureDisposition: null,
        nextRetryAt: null,
        quarantinedAt: null,
        deadLetteredAt: null,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(monitoringRuns.id, input.runId),
          eq(monitoringRuns.state, "PROCESSING"),
          eq(monitoringRuns.leaseOwner, input.leaseOwner),
        ),
      )
      .returning({ id: monitoringRuns.id });
    return Boolean(updated);
  }

  async fail(input: {
    runId: string;
    leaseOwner: string;
    failureCode: string;
    disposition: MonitoringFailureDisposition;
    now: Date;
  }) {
    return this.db.transaction(async (rawTx) => {
      const tx = rawTx as unknown as TrendsFastDatabase;
      const [candidate] = await tx
        .select({
          projectId: monitoringRuns.projectId,
          monitoringSubscriptionId: monitoringRuns.monitoringSubscriptionId,
        })
        .from(monitoringRuns)
        .where(
          and(
            eq(monitoringRuns.id, input.runId),
            eq(monitoringRuns.state, "PROCESSING"),
            eq(monitoringRuns.leaseOwner, input.leaseOwner),
          ),
        )
        .limit(1);
      if (!candidate) return { current: false as const };
      await lockProjectEntitlementScope(tx, candidate.projectId);
      const [lockedSubscription] = await tx
        .select({ id: monitoringSubscriptions.id })
        .from(monitoringSubscriptions)
        .where(eq(monitoringSubscriptions.id, candidate.monitoringSubscriptionId))
        .limit(1)
        .for("update");
      if (!lockedSubscription) return { current: false as const };
      const [current] = await tx
        .select()
        .from(monitoringRuns)
        .where(
          and(
            eq(monitoringRuns.id, input.runId),
            eq(monitoringRuns.state, "PROCESSING"),
            eq(monitoringRuns.leaseOwner, input.leaseOwner),
          ),
        )
        .limit(1)
        .for("update");
      if (!current) return { current: false as const };
      const updated = await transitionMonitoringFailure(tx, {
        run: current,
        requestedDisposition: input.disposition,
        failureCode: input.failureCode,
        now: input.now,
      });
      return { current: true as const, state: updated.state };
    });
  }

  async markDelivered(scanRequestId: string, now = new Date()) {
    const [updated] = await this.db
      .update(monitoringRuns)
      .set({ state: "COMPLETED", completedAt: now, updatedAt: now })
      .where(
        and(
          eq(monitoringRuns.scanRequestId, scanRequestId),
          eq(monitoringRuns.state, "REVIEW_REQUIRED"),
        ),
      )
      .returning({ id: monitoringRuns.id });
    return Boolean(updated);
  }
}
