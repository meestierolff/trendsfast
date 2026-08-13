import { describe, expect, it } from "vitest";
import {
  decideMonitoringClaim,
  decideMonitoringFailure,
  isCurrentMonitoringFence,
  monitoringRetryDelaySeconds,
  nextMonitoringDueAt,
} from "../src/repositories/monitoring-model";

const now = new Date("2026-08-11T12:00:00.000Z");

describe("monitoring claim policy", () => {
  it("claims only due, entitled, active subscriptions", () => {
    expect(
      decideMonitoringClaim({
        status: "ACTIVE",
        entitlementActive: true,
        nextDueAt: new Date("2026-08-11T11:59:00Z"),
        now,
        openRunLeaseExpiresAt: null,
      }),
    ).toBe("CLAIM");
    expect(
      decideMonitoringClaim({
        status: "ACTIVE",
        entitlementActive: true,
        nextDueAt: new Date("2026-08-11T12:01:00Z"),
        now,
        openRunLeaseExpiresAt: null,
      }),
    ).toBe("NOT_DUE");
  });

  it("pauses immediately when webhook entitlement is inactive", () => {
    expect(
      decideMonitoringClaim({
        status: "ACTIVE",
        entitlementActive: false,
        nextDueAt: new Date("2026-08-11T11:59:00Z"),
        now,
        openRunLeaseExpiresAt: null,
      }),
    ).toBe("PAUSE");
  });

  it("never overlaps a live lease and can reclaim an expired one", () => {
    expect(
      decideMonitoringClaim({
        status: "ACTIVE",
        entitlementActive: true,
        nextDueAt: new Date("2026-08-11T11:59:00Z"),
        now,
        openRunLeaseExpiresAt: new Date("2026-08-11T12:05:00Z"),
      }),
    ).toBe("ALREADY_CLAIMED");
    expect(
      decideMonitoringClaim({
        status: "ACTIVE",
        entitlementActive: true,
        nextDueAt: new Date("2026-08-12T12:00:00Z"),
        now,
        openRunLeaseExpiresAt: new Date("2026-08-11T11:55:00Z"),
      }),
    ).toBe("RECLAIM");
  });

  it("advances from the later of due time and claim time to avoid catch-up bursts", () => {
    expect(nextMonitoringDueAt(new Date("2026-08-09T12:00:00Z"), now)).toEqual(
      new Date("2026-08-12T12:00:00.000Z"),
    );
  });

  it("rejects stale completion after a newer lease owner rotates the fence", () => {
    expect(isCurrentMonitoringFence("lease-old", "lease-new")).toBe(false);
    expect(isCurrentMonitoringFence("lease-new", "lease-new")).toBe(true);
  });

  it("quarantines every unknown effect and never converts it into an automatic retry", () => {
    expect(
      decideMonitoringFailure({
        requestedDisposition: "KNOWN_RETRYABLE",
        hasUnknownExternalOutcome: true,
        attempt: 1,
        maxAttempts: 3,
      }),
    ).toEqual({ state: "QUARANTINED", disposition: "OUTCOME_UNKNOWN" });
    expect(
      decideMonitoringFailure({
        requestedDisposition: "OUTCOME_UNKNOWN",
        hasUnknownExternalOutcome: false,
        attempt: 1,
        maxAttempts: 3,
      }),
    ).toEqual({ state: "QUARANTINED", disposition: "OUTCOME_UNKNOWN" });
  });

  it("backs off only known failures and dead-letters at the stored cap", () => {
    expect(monitoringRetryDelaySeconds(1, 300)).toBe(300);
    expect(monitoringRetryDelaySeconds(3, 300)).toBe(1_200);
    expect(
      decideMonitoringFailure({
        requestedDisposition: "KNOWN_RETRYABLE",
        hasUnknownExternalOutcome: false,
        attempt: 2,
        maxAttempts: 3,
      }),
    ).toEqual({ state: "RETRY_WAIT", disposition: "KNOWN_RETRYABLE" });
    expect(
      decideMonitoringFailure({
        requestedDisposition: "KNOWN_RETRYABLE",
        hasUnknownExternalOutcome: false,
        attempt: 3,
        maxAttempts: 3,
      }),
    ).toEqual({ state: "DEAD_LETTER", disposition: "KNOWN_RETRYABLE" });
  });
});
