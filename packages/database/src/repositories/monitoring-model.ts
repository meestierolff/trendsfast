export type MonitoringSubscriptionState = "ACTIVE" | "PAUSED" | "CANCELED";
export type MonitoringClaimDecision =
  "CLAIM" | "RECLAIM" | "ALREADY_CLAIMED" | "NOT_DUE" | "PAUSE" | "INACTIVE";
export type MonitoringFailureDisposition = "KNOWN_RETRYABLE" | "KNOWN_TERMINAL" | "OUTCOME_UNKNOWN";
export type MonitoringFailureState = "RETRY_WAIT" | "QUARANTINED" | "FAILED" | "DEAD_LETTER";

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

export function monitoringRetryDelaySeconds(attempt: number, retryBaseSeconds: number): number {
  if (!Number.isSafeInteger(attempt) || attempt < 1 || attempt > 10) {
    throw new Error("Monitoring retry attempt must be between 1 and 10");
  }
  if (
    !Number.isSafeInteger(retryBaseSeconds) ||
    retryBaseSeconds < 30 ||
    retryBaseSeconds > 86_400
  ) {
    throw new Error("Monitoring retry base must be between 30 and 86400 seconds");
  }
  return Math.min(86_400, retryBaseSeconds * 2 ** Math.max(0, attempt - 1));
}

export function decideMonitoringFailure(input: {
  requestedDisposition: MonitoringFailureDisposition;
  hasUnknownExternalOutcome: boolean;
  attempt: number;
  maxAttempts: number;
}): { state: MonitoringFailureState; disposition: MonitoringFailureDisposition } {
  if (
    !Number.isSafeInteger(input.attempt) ||
    !Number.isSafeInteger(input.maxAttempts) ||
    input.attempt < 1 ||
    input.maxAttempts < 1 ||
    input.attempt > input.maxAttempts ||
    input.maxAttempts > 10
  ) {
    throw new Error("Monitoring failure policy requires a valid capped attempt range");
  }
  if (input.requestedDisposition === "OUTCOME_UNKNOWN" || input.hasUnknownExternalOutcome) {
    return { state: "QUARANTINED", disposition: "OUTCOME_UNKNOWN" };
  }
  if (input.requestedDisposition === "KNOWN_TERMINAL") {
    return { state: "FAILED", disposition: "KNOWN_TERMINAL" };
  }
  return input.attempt >= input.maxAttempts
    ? { state: "DEAD_LETTER", disposition: "KNOWN_RETRYABLE" }
    : { state: "RETRY_WAIT", disposition: "KNOWN_RETRYABLE" };
}
