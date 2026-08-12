export type MonitoringSubscriptionState = "ACTIVE" | "PAUSED" | "CANCELED";
export type MonitoringClaimDecision =
  "CLAIM" | "RECLAIM" | "ALREADY_CLAIMED" | "NOT_DUE" | "PAUSE" | "INACTIVE";

export function decideMonitoringClaim(input: {
  status: MonitoringSubscriptionState;
  entitlementActive: boolean;
  nextDueAt: Date;
  now: Date;
  openRunLeaseExpiresAt: Date | null;
}): MonitoringClaimDecision {
  if (input.status === "CANCELED") return "INACTIVE";
  if (!input.entitlementActive) return "PAUSE";
  if (input.status !== "ACTIVE") return "INACTIVE";
  if (input.openRunLeaseExpiresAt) {
    return input.openRunLeaseExpiresAt > input.now ? "ALREADY_CLAIMED" : "RECLAIM";
  }
  return input.nextDueAt > input.now ? "NOT_DUE" : "CLAIM";
}

export function nextMonitoringDueAt(previousDueAt: Date, claimedAt: Date): Date {
  const base = previousDueAt > claimedAt ? previousDueAt : claimedAt;
  return new Date(base.getTime() + 86_400_000);
}

export function isCurrentMonitoringFence(expectedLeaseOwner: string, actualLeaseOwner: string) {
  return expectedLeaseOwner.length > 0 && expectedLeaseOwner === actualLeaseOwner;
}
