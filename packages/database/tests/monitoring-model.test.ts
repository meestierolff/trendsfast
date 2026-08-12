import { describe, expect, it } from "vitest";
import {
  decideMonitoringClaim,
  isCurrentMonitoringFence,
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
});
