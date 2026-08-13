import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  getVerifiedAuthIdentity: vi.fn(),
  consumePendingProjectClaim: vi.fn(),
}));

vi.mock("@/lib/auth-session", () => ({
  getVerifiedAuthIdentity: mocks.getVerifiedAuthIdentity,
  safeDashboardDestination: (value: string | null | undefined) =>
    value === "/dashboard/today" ? value : "/dashboard",
  claimedProjectDestination: (destination: string, projectId: string) =>
    `${destination === "/dashboard" ? "/dashboard/today" : destination}?project=${projectId}`,
}));
vi.mock("@/lib/member-auth-service", () => ({
  consumePendingProjectClaim: mocks.consumePendingProjectClaim,
}));
vi.mock("@/lib/site", () => ({ siteOrigin: () => "https://trendsfast.example" }));

import { finishVerifiedAuth } from "../../lib/auth-flow";

describe("post-auth claim completion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getVerifiedAuthIdentity.mockResolvedValue({
      authUserId: "11111111-1111-4111-8111-111111111111",
      email: "founder@example.com",
    });
  });

  it("sends a verified user with no pending claim to the clean dashboard state", async () => {
    mocks.consumePendingProjectClaim.mockResolvedValue({ status: "NO_CLAIM" });
    const response = await finishVerifiedAuth("/dashboard/today");
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://trendsfast.example/dashboard/today");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("opens the exact project created by a consumed claim", async () => {
    mocks.consumePendingProjectClaim.mockResolvedValue({
      status: "CLAIMED",
      projectId: "22222222-2222-4222-8222-222222222222",
    });
    const response = await finishVerifiedAuth("/dashboard/today");
    expect(response.headers.get("location")).toBe(
      "https://trendsfast.example/dashboard/today?project=22222222-2222-4222-8222-222222222222",
    );
  });

  it.each(["EXPIRED", "INVALIDATED", "REPLAYED", "NOT_FOUND", "MALFORMED"])(
    "fails closed for a %s pending claim",
    async (status) => {
      mocks.consumePendingProjectClaim.mockResolvedValue({ status });
      const response = await finishVerifiedAuth("/dashboard/today");
      expect(response.headers.get("location")).toContain("/login?error=claim_invalid");
    },
  );
});
