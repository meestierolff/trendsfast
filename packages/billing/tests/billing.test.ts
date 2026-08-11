import { describe, expect, it } from "vitest";
import { billingAvailability, projectEntitlement } from "../src/index";

describe("billing launch gate", () => {
  it("has no checkout when disabled", () => {
    expect(billingAvailability({ enabled: false, mode: "test" })).toEqual({
      enabled: false,
      checkoutAvailable: false,
      reason: "BILLING_DISABLED",
    });
  });

  it("projects founder cloud only from an active or trialing subscription", () => {
    expect(projectEntitlement("active")).toBe("founder_cloud");
    expect(projectEntitlement("trialing")).toBe("founder_cloud");
    expect(projectEntitlement("past_due")).toBeNull();
    expect(projectEntitlement("canceled")).toBeNull();
  });
});
