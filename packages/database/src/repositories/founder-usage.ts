import { and, count, desc, eq, gt, gte, inArray, isNull, lt, lte, sql } from "drizzle-orm";

import type { TrendsFastDatabase } from "../client";
import {
  founderEntitlementGrants,
  founderUsageEvents,
  projectEntitlements,
  scanRequests,
  subscriptions,
} from "../schema";
import {
  decideFounderUsageAdmission,
  founderUsageWindow,
  paidDeliveryPolicy,
  type FounderUsageDenial,
  type FounderUsageKind,
} from "./founder-usage-model";

export type FounderUsageAdmission =
  | { status: "ACCEPTED"; event: typeof founderUsageEvents.$inferSelect; remaining: number }
  | { status: "REUSED"; event: typeof founderUsageEvents.$inferSelect }
  | { status: "LIMITED"; reason: FounderUsageDenial };

/**
 * Serializes every entitlement decision and entitlement/grant writer for one
 * project. Call this before taking row locks in any transaction that can
 * enable, disable, consume, or project Founder access.
 */
export async function lockProjectEntitlementScope(
  db: TrendsFastDatabase,
  projectId: string,
): Promise<void> {
  await db.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${projectId}, 0))`);
}

export async function admitFounderUsage(
  db: TrendsFastDatabase,
  input: {
    projectId: string;
    kind: FounderUsageKind;
    idempotencyKey: string;
    occurredAt: Date;
    scanRequestId?: string;
  },
): Promise<FounderUsageAdmission> {
  if (!input.idempotencyKey || input.idempotencyKey.length > 255) {
    throw new Error("Founder usage admission requires a bounded idempotency key");
  }
  if (Number.isNaN(input.occurredAt.getTime())) {
    throw new Error("Founder usage admission requires a valid occurrence time");
  }
  await lockProjectEntitlementScope(db, input.projectId);

  const [existing] = await db
    .select()
    .from(founderUsageEvents)
    .where(eq(founderUsageEvents.idempotencyKey, input.idempotencyKey))
    .limit(1);
  if (existing) {
    if (existing.projectId !== input.projectId || existing.kind !== input.kind) {
      throw new Error("Founder usage idempotency was reused for a different admission");
    }
    return { status: "REUSED", event: existing };
  }

  const [row] = await db
    .select({
      entitlement: {
        projectId: projectEntitlements.projectId,
        subscriptionId: projectEntitlements.subscriptionId,
        active: projectEntitlements.active,
        periodStart: projectEntitlements.periodStart,
        periodEnd: projectEntitlements.periodEnd,
      },
      subscriptionId: subscriptions.id,
    })
    .from(projectEntitlements)
    .innerJoin(subscriptions, eq(projectEntitlements.subscriptionId, subscriptions.id))
    .where(eq(projectEntitlements.projectId, input.projectId))
    .limit(1);
  const [grant] = await db
    .select({
      id: founderEntitlementGrants.id,
      projectId: founderEntitlementGrants.projectId,
      createdAt: founderEntitlementGrants.createdAt,
      expiresAt: founderEntitlementGrants.expiresAt,
      revokedAt: founderEntitlementGrants.revokedAt,
    })
    .from(founderEntitlementGrants)
    .where(
      and(
        eq(founderEntitlementGrants.projectId, input.projectId),
        isNull(founderEntitlementGrants.revokedAt),
        lte(founderEntitlementGrants.createdAt, input.occurredAt),
        gt(founderEntitlementGrants.expiresAt, input.occurredAt),
      ),
    )
    .limit(1);
  const paidStart = row?.entitlement.periodStart ?? null;
  const paidEnd = row?.entitlement.periodEnd ?? null;
  const paidPeriodValid = Boolean(paidStart && paidEnd && paidStart < paidEnd);
  const paidActive = Boolean(
    row?.entitlement.active &&
    paidStart &&
    paidEnd &&
    input.occurredAt >= paidStart &&
    input.occurredAt < paidEnd,
  );
  if (!paidActive && grant && input.kind === "SCHEDULED_RUN_ACCEPTED") {
    return { status: "LIMITED", reason: "ENTITLEMENT_INACTIVE" };
  }
  if (!paidActive && !grant) {
    if (row?.entitlement.active && !paidPeriodValid) {
      return { status: "LIMITED", reason: "ENTITLEMENT_PERIOD_INVALID" };
    }
    return { status: "LIMITED", reason: "ENTITLEMENT_INACTIVE" };
  }
  const periodStart = paidActive ? paidStart! : grant!.createdAt;
  const periodEnd = paidActive ? paidEnd! : grant!.expiresAt;
  if (
    Number.isNaN(periodStart.getTime()) ||
    Number.isNaN(periodEnd.getTime()) ||
    periodStart >= periodEnd
  ) {
    return { status: "LIMITED", reason: "ENTITLEMENT_PERIOD_INVALID" };
  }
  const effectiveActive = Boolean(input.occurredAt >= periodStart && input.occurredAt < periodEnd);
  const entitlement = { active: effectiveActive, periodStart, periodEnd };
  const window = founderUsageWindow(input.kind, entitlement, input.occurredAt);
  const [usage] = await db
    .select({ value: count() })
    .from(founderUsageEvents)
    .where(
      and(
        eq(founderUsageEvents.projectId, input.projectId),
        eq(founderUsageEvents.kind, input.kind),
        gte(founderUsageEvents.occurredAt, window.start),
        lt(founderUsageEvents.occurredAt, window.end),
      ),
    );
  const decision = decideFounderUsageAdmission({
    kind: input.kind,
    entitlement,
    acceptedCount: usage?.value ?? 0,
  });
  if (!decision.accepted) return { status: "LIMITED", reason: decision.reason };
  const [event] = await db
    .insert(founderUsageEvents)
    .values({
      projectId: input.projectId,
      subscriptionId: paidActive ? row!.subscriptionId : null,
      founderGrantId: paidActive ? null : grant!.id,
      scanRequestId: input.scanRequestId ?? null,
      kind: input.kind,
      idempotencyKey: input.idempotencyKey,
      periodStart: window.start,
      periodEnd: window.end,
      occurredAt: input.occurredAt,
    })
    .returning();
  if (!event) throw new Error("The Founder usage acceptance could not be persisted");
  return {
    status: "ACCEPTED",
    event,
    remaining: decision.remainingAfterAcceptance,
  };
}

export class FounderUsageRepository {
  constructor(private readonly db: TrendsFastDatabase) {}

  async admit(input: {
    projectId: string;
    kind: FounderUsageKind;
    idempotencyKey: string;
    occurredAt: Date;
    scanRequestId?: string;
  }) {
    return this.db.transaction((tx) =>
      admitFounderUsage(tx as unknown as TrendsFastDatabase, input),
    );
  }

  async paidDeliveryPolicy(scanRequestId: string, now = new Date()) {
    const [acceptance] = await this.db
      .select()
      .from(founderUsageEvents)
      .where(
        and(
          eq(founderUsageEvents.scanRequestId, scanRequestId),
          inArray(founderUsageEvents.kind, ["SCHEDULED_RUN_ACCEPTED", "ON_DEMAND_RUN_ACCEPTED"]),
        ),
      )
      .limit(1);
    if (!acceptance) return { policy: "FREE_FLOW" as const, acceptance: null };
    const [entitlement] = await this.db
      .select()
      .from(projectEntitlements)
      .where(eq(projectEntitlements.projectId, acceptance.projectId))
      .limit(1);
    const paidActive = Boolean(
      entitlement?.active &&
      entitlement.periodStart &&
      entitlement.periodEnd &&
      now >= entitlement.periodStart &&
      now < entitlement.periodEnd,
    );
    const [grant] = paidActive
      ? []
      : await this.db
          .select({ id: founderEntitlementGrants.id })
          .from(founderEntitlementGrants)
          .where(
            and(
              eq(founderEntitlementGrants.projectId, acceptance.projectId),
              isNull(founderEntitlementGrants.revokedAt),
              lte(founderEntitlementGrants.createdAt, now),
              gt(founderEntitlementGrants.expiresAt, now),
            ),
          )
          .limit(1);
    return {
      policy: paidDeliveryPolicy({
        hasPaidAcceptance: true,
        entitlementActive: paidActive || Boolean(grant),
      }),
      acceptance,
    };
  }

  async hasPaidAcceptance(scanRequestId: string) {
    const [event] = await this.db
      .select()
      .from(founderUsageEvents)
      .where(
        and(
          eq(founderUsageEvents.scanRequestId, scanRequestId),
          inArray(founderUsageEvents.kind, ["SCHEDULED_RUN_ACCEPTED", "ON_DEMAND_RUN_ACCEPTED"]),
        ),
      )
      .limit(1);
    return event ?? null;
  }

  async isProjectEntitled(projectId: string, now = new Date()) {
    const [entitlement] = await this.db
      .select({ projectId: projectEntitlements.projectId })
      .from(projectEntitlements)
      .where(
        and(
          eq(projectEntitlements.projectId, projectId),
          eq(projectEntitlements.active, true),
          gt(projectEntitlements.periodEnd, now),
          lte(projectEntitlements.periodStart, now),
        ),
      )
      .limit(1);
    if (entitlement) return true;
    const [grant] = await this.db
      .select({ projectId: founderEntitlementGrants.projectId })
      .from(founderEntitlementGrants)
      .where(
        and(
          eq(founderEntitlementGrants.projectId, projectId),
          isNull(founderEntitlementGrants.revokedAt),
          lte(founderEntitlementGrants.createdAt, now),
          gt(founderEntitlementGrants.expiresAt, now),
        ),
      )
      .limit(1);
    return Boolean(grant);
  }

  async listHistory(projectId: string, now = new Date(), limit = 100) {
    const boundedLimit = Math.max(1, Math.min(100, Math.floor(limit)));
    const cutoff = new Date(now.getTime() - 30 * 86_400_000);
    return this.db
      .select()
      .from(scanRequests)
      .where(and(eq(scanRequests.projectId, projectId), gte(scanRequests.createdAt, cutoff)))
      .orderBy(desc(scanRequests.createdAt))
      .limit(boundedLimit);
  }
}
