export const FOUNDER_PLAN_LIMITS = {
  activeProjects: 1,
  scheduledRunsPerDay: 1,
  onDemandRunsPerBillingPeriod: 10,
  deliveredMovesPerDay: 1,
  historyDays: 30,
} as const;

export type FounderUsageKind =
  "SCHEDULED_RUN_ACCEPTED" | "ON_DEMAND_RUN_ACCEPTED" | "NEXT_MOVE_DELIVERED";

export type FounderEntitlementWindow = {
  active: boolean;
  periodStart: Date;
  periodEnd: Date;
};

function utcDayWindow(now: Date) {
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0),
  );
  return { start, end: new Date(start.getTime() + 86_400_000) };
}

export function founderUsageWindow(
  kind: FounderUsageKind,
  entitlement: FounderEntitlementWindow,
  now: Date,
) {
  if (kind === "ON_DEMAND_RUN_ACCEPTED") {
    return {
      start: entitlement.periodStart,
      end: entitlement.periodEnd,
      limit: FOUNDER_PLAN_LIMITS.onDemandRunsPerBillingPeriod,
    };
  }
  return {
    ...utcDayWindow(now),
    limit:
      kind === "SCHEDULED_RUN_ACCEPTED"
        ? FOUNDER_PLAN_LIMITS.scheduledRunsPerDay
        : FOUNDER_PLAN_LIMITS.deliveredMovesPerDay,
  };
}

export type FounderUsageDenial =
  | "ENTITLEMENT_INACTIVE"
  | "ENTITLEMENT_PERIOD_INVALID"
  | "SCHEDULED_DAILY_LIMIT"
  | "ON_DEMAND_MONTHLY_LIMIT"
  | "DELIVERY_DAILY_LIMIT";

export function decideFounderUsageAdmission(input: {
  kind: FounderUsageKind;
  entitlement: FounderEntitlementWindow;
  acceptedCount: number;
}):
  | { accepted: true; remainingAfterAcceptance: number }
  | { accepted: false; reason: FounderUsageDenial } {
  if (!input.entitlement.active) return { accepted: false, reason: "ENTITLEMENT_INACTIVE" };
  if (
    Number.isNaN(input.entitlement.periodStart.getTime()) ||
    Number.isNaN(input.entitlement.periodEnd.getTime()) ||
    input.entitlement.periodStart >= input.entitlement.periodEnd
  ) {
    return { accepted: false, reason: "ENTITLEMENT_PERIOD_INVALID" };
  }
  const limit =
    input.kind === "ON_DEMAND_RUN_ACCEPTED" ? FOUNDER_PLAN_LIMITS.onDemandRunsPerBillingPeriod : 1;
  if (input.acceptedCount >= limit) {
    return {
      accepted: false,
      reason:
        input.kind === "SCHEDULED_RUN_ACCEPTED"
          ? "SCHEDULED_DAILY_LIMIT"
          : input.kind === "ON_DEMAND_RUN_ACCEPTED"
            ? "ON_DEMAND_MONTHLY_LIMIT"
            : "DELIVERY_DAILY_LIMIT",
    };
  }
  return { accepted: true, remainingAfterAcceptance: limit - input.acceptedCount - 1 };
}

export function paidDeliveryPolicy(input: {
  hasPaidAcceptance: boolean;
  entitlementActive: boolean;
}): "FREE_FLOW" | "ENTITLEMENT_REQUIRED" | "RECORD_AND_ENFORCE" {
  if (!input.hasPaidAcceptance) return "FREE_FLOW";
  return input.entitlementActive ? "RECORD_AND_ENFORCE" : "ENTITLEMENT_REQUIRED";
}
