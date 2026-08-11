import { randomUUID } from "node:crypto";

import { and, asc, eq, lte, or, sql } from "drizzle-orm";

import { createPublicScanToken, digestNextMoveRequest, redactSecrets } from "@trendsfast/core";
import type { NextMoveRequest } from "@trendsfast/schemas";

import type { TrendsFastDatabase } from "../client";
import {
  founderUsageEvents,
  monitoringRuns,
  monitoringSubscriptions,
  projectEntitlements,
  projects,
  scanRequests,
  subscriptions,
} from "../schema";
import { admitFounderUsage } from "./founder-usage";
import { decideMonitoringClaim, nextMonitoringDueAt } from "./monitoring-model";

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
    entitlement: typeof projectEntitlements.$inferSelect;
    subscription: typeof subscriptions.$inferSelect;
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

export class MonitoringRepository {
  constructor(private readonly db: TrendsFastDatabase) {}

  async claimDue(input: {
    now: Date;
    batchSize: number;
    leaseSeconds: number;
    leaseOwner: string;
  }): Promise<MonitoringClaim[]> {
    assertClaimBounds(input);
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

  private async claimOne(input: {
    now: Date;
    leaseSeconds: number;
    leaseOwner: string;
  }): Promise<{ status: "EMPTY" | "SKIPPED" } | { status: "CLAIMED"; claim: MonitoringClaim }> {
    return this.db.transaction(async (rawTx) => {
      const tx = rawTx as unknown as TrendsFastDatabase;
      const [candidate] = await tx
        .select({
          monitoring: monitoringSubscriptions,
          entitlement: projectEntitlements,
          subscription: subscriptions,
          project: projects,
        })
        .from(monitoringSubscriptions)
        .innerJoin(
          projectEntitlements,
          eq(monitoringSubscriptions.projectId, projectEntitlements.projectId),
        )
        .innerJoin(subscriptions, eq(monitoringSubscriptions.subscriptionId, subscriptions.id))
        .innerJoin(projects, eq(monitoringSubscriptions.projectId, projects.id))
        .where(
          and(
            eq(monitoringSubscriptions.state, "ACTIVE"),
            or(
              and(
                lte(monitoringSubscriptions.nextDueAt, input.now),
                sql`NOT EXISTS (
                  SELECT 1 FROM ${monitoringRuns}
                  WHERE ${monitoringRuns.monitoringSubscriptionId} = ${monitoringSubscriptions.id}
                    AND ${monitoringRuns.state} = 'PROCESSING'
                    AND ${monitoringRuns.leaseExpiresAt} > ${input.now}
                )`,
              ),
              sql`EXISTS (
                SELECT 1 FROM ${monitoringRuns}
                WHERE ${monitoringRuns.monitoringSubscriptionId} = ${monitoringSubscriptions.id}
                  AND ${monitoringRuns.state} = 'PROCESSING'
                  AND ${monitoringRuns.leaseExpiresAt} <= ${input.now}
              )`,
            ),
          ),
        )
        .orderBy(asc(monitoringSubscriptions.nextDueAt))
        .limit(1)
        .for("update", { of: monitoringSubscriptions, skipLocked: true });
      if (!candidate) return { status: "EMPTY" as const };

      const [openRun] = await tx
        .select()
        .from(monitoringRuns)
        .where(
          and(
            eq(monitoringRuns.monitoringSubscriptionId, candidate.monitoring.id),
            eq(monitoringRuns.state, "PROCESSING"),
          ),
        )
        .limit(1)
        .for("update");
      const entitlementActive = validEntitlement(candidate, input.now);
      const decision = decideMonitoringClaim({
        status: candidate.monitoring.state,
        entitlementActive,
        nextDueAt: candidate.monitoring.nextDueAt,
        now: input.now,
        openRunLeaseExpiresAt: openRun?.leaseExpiresAt ?? null,
      });

      if (decision === "PAUSE") {
        const terminal = ["CANCELED", "INCOMPLETE_EXPIRED"].includes(candidate.subscription.status);
        await tx
          .update(monitoringSubscriptions)
          .set({ state: terminal ? "CANCELED" : "PAUSED", updatedAt: input.now })
          .where(eq(monitoringSubscriptions.id, candidate.monitoring.id));
        if (openRun) {
          await tx
            .update(monitoringRuns)
            .set({
              state: "FAILED",
              leaseOwner: null,
              leaseExpiresAt: null,
              completedAt: input.now,
              failureCode: "ENTITLEMENT_INACTIVE",
              updatedAt: input.now,
            })
            .where(eq(monitoringRuns.id, openRun.id));
        }
        return { status: "SKIPPED" as const };
      }
      if (decision !== "CLAIM" && decision !== "RECLAIM") {
        return { status: "SKIPPED" as const };
      }

      const leaseOwner = boundedLeaseOwner(input.leaseOwner);
      const leaseExpiresAt = new Date(input.now.getTime() + input.leaseSeconds * 1_000);
      if (decision === "RECLAIM") {
        if (!openRun?.scanRequestId) {
          throw new Error("An expired monitoring run cannot be reclaimed without its scan request");
        }
        const [request] = await tx
          .select({ publicId: scanRequests.publicId })
          .from(scanRequests)
          .where(eq(scanRequests.id, openRun.scanRequestId))
          .limit(1);
        if (!request) throw new Error("The reclaimed monitoring scan request was not found");
        const [reclaimed] = await tx
          .update(monitoringRuns)
          .set({
            attempt: openRun.attempt + 1,
            leaseOwner,
            leaseExpiresAt,
            claimedAt: input.now,
            failureCode: null,
            updatedAt: input.now,
          })
          .where(
            and(
              eq(monitoringRuns.id, openRun.id),
              eq(monitoringRuns.state, "PROCESSING"),
              lte(monitoringRuns.leaseExpiresAt, input.now),
            ),
          )
          .returning();
        if (!reclaimed) return { status: "SKIPPED" as const };
        return {
          status: "CLAIMED" as const,
          claim: asClaim(reclaimed, request.publicId),
        };
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

  async fail(input: { runId: string; leaseOwner: string; failureCode: string; now: Date }) {
    const failureCode = redactSecrets(input.failureCode).slice(0, 100) || "MONITORING_FAILED";
    const [updated] = await this.db
      .update(monitoringRuns)
      .set({
        state: "FAILED",
        leaseOwner: null,
        leaseExpiresAt: null,
        completedAt: input.now,
        failureCode,
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
