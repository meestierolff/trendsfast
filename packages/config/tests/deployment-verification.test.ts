import { describe, expect, it } from "vitest";

import { isSameOriginDashboardRedirect } from "../../../scripts/deployment-verification";

describe("deployment authentication redirect verification", () => {
  const origin = new URL("https://trendsfast.example/");

  it("accepts only the exact same-origin dashboard login redirect", () => {
    expect(isSameOriginDashboardRedirect(origin, "/login?next=/dashboard")).toBe(true);
    expect(
      isSameOriginDashboardRedirect(origin, "https://trendsfast.example/login?next=%2Fdashboard"),
    ).toBe(true);
    expect(
      isSameOriginDashboardRedirect(origin, "https://attacker.example/login?next=/dashboard"),
    ).toBe(false);
    expect(isSameOriginDashboardRedirect(origin, "//attacker.example/login?next=/dashboard")).toBe(
      false,
    );
    expect(isSameOriginDashboardRedirect(origin, "/login?next=https://attacker.example")).toBe(
      false,
    );
  });
});
