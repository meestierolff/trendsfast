import { and, count, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";

import type { TrendsFastDatabase } from "../client";
import { founderUsageEvents, projectEntitlements, scanRequests, subscriptions } from "../schema";
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
  await db.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${input.projectId}, 0))`);

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
    .select({ entitlement: projectEntitlements, subscription: subscriptions })
    .from(projectEntitlements)
    .innerJoin(subscriptions, eq(projectEntitlements.subscriptionId, subscriptions.id))
    .where(eq(projectEntitlements.projectId, input.projectId))
    .limit(1)
    .for("update");
  const periodStart = row?.entitlement.periodStart ?? new Date(Number.NaN);
  const periodEnd = row?.entitlement.periodEnd ?? new Date(Number.NaN);
  if (!row || !row.entitlement.active) {
    return { status: "LIMITED", reason: "ENTITLEMENT_INACTIVE" };
  }
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
      subscriptionId: row.subscription.id,
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
    const active = Boolean(
      entitlement?.active &&
      entitlement.periodStart &&
      entitlement.periodEnd &&
      now >= entitlement.periodStart &&
      now < entitlement.periodEnd,
    );
    return {
      policy: paidDeliveryPolicy({ hasPaidAcceptance: true, entitlementActive: active }),
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
