import { describe, expect, it } from "vitest";
import {
  decideFounderUsageAdmission,
  founderUsageWindow,
  paidDeliveryPolicy,
} from "../src/repositories/founder-usage-model";

const activeEntitlement = {
  active: true,
  periodStart: new Date("2026-08-01T00:00:00.000Z"),
  periodEnd: new Date("2026-09-01T00:00:00.000Z"),
};

describe("Founder usage policy", () => {
  it("uses UTC days and webhook billing periods", () => {
    expect(
      founderUsageWindow(
        "SCHEDULED_RUN_ACCEPTED",
        activeEntitlement,
        new Date("2026-08-11T23:59:00Z"),
      ),
    ).toEqual({
      start: new Date("2026-08-11T00:00:00.000Z"),
      end: new Date("2026-08-12T00:00:00.000Z"),
      limit: 1,
    });
    expect(
      founderUsageWindow(
        "ON_DEMAND_RUN_ACCEPTED",
        activeEntitlement,
        new Date("2026-08-11T23:59:00Z"),
      ),
    ).toEqual({
      start: activeEntitlement.periodStart,
      end: activeEntitlement.periodEnd,
      limit: 10,
    });
  });

  it("consumes on-demand usage on acceptance regardless of a later WAIT or failure", () => {
    expect(
      decideFounderUsageAdmission({
        kind: "ON_DEMAND_RUN_ACCEPTED",
        entitlement: activeEntitlement,
        acceptedCount: 9,
      }),
    ).toEqual({ accepted: true, remainingAfterAcceptance: 0 });
    expect(
      decideFounderUsageAdmission({
        kind: "ON_DEMAND_RUN_ACCEPTED",
        entitlement: activeEntitlement,
        acceptedCount: 10,
      }),
    ).toEqual({ accepted: false, reason: "ON_DEMAND_MONTHLY_LIMIT" });
  });

  it("counts a scheduled WAIT as the one daily scheduled acceptance", () => {
    expect(
      decideFounderUsageAdmission({
        kind: "SCHEDULED_RUN_ACCEPTED",
        entitlement: activeEntitlement,
        acceptedCount: 1,
      }),
    ).toEqual({ accepted: false, reason: "SCHEDULED_DAILY_LIMIT" });
  });

  it("requires current webhook entitlement for every paid admission", () => {
    expect(
      decideFounderUsageAdmission({
        kind: "ON_DEMAND_RUN_ACCEPTED",
        entitlement: { ...activeEntitlement, active: false },
        acceptedCount: 0,
      }),
    ).toEqual({ accepted: false, reason: "ENTITLEMENT_INACTIVE" });
  });

  it("enforces paid delivery only when the scan has a paid acceptance ledger entry", () => {
    expect(paidDeliveryPolicy({ hasPaidAcceptance: false, entitlementActive: false })).toBe(
      "FREE_FLOW",
    );
    expect(paidDeliveryPolicy({ hasPaidAcceptance: true, entitlementActive: false })).toBe(
      "ENTITLEMENT_REQUIRED",
    );
    expect(paidDeliveryPolicy({ hasPaidAcceptance: true, entitlementActive: true })).toBe(
      "RECORD_AND_ENFORCE",
    );
  });
});
