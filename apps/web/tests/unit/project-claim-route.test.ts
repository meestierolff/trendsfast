import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  acceptsPrivateMutation: vi.fn(),
  resolveReadyScanIdentity: vi.fn(),
  createProjectClaimForDelivery: vi.fn(),
  consumeProjectClaimHash: vi.fn(),
  getVerifiedAuthIdentity: vi.fn(),
}));

vi.mock("@/lib/private-scan-api", () => ({
  acceptsPrivateMutation: mocks.acceptsPrivateMutation,
}));
vi.mock("@/lib/scan-view-service", () => ({
  resolveReadyScanIdentity: mocks.resolveReadyScanIdentity,
}));
vi.mock("@/lib/member-auth-service", () => ({
  createProjectClaimForDelivery: mocks.createProjectClaimForDelivery,
  consumeProjectClaimHash: mocks.consumeProjectClaimHash,
}));
vi.mock("@/lib/auth-session", () => ({
  getVerifiedAuthIdentity: mocks.getVerifiedAuthIdentity,
  safeDashboardDestination: (value: string) => value,
  claimedProjectDestination: (destination: string, projectId: string) =>
    `${destination}?project=${projectId}`,
}));
vi.mock("@/lib/site", () => ({ siteOrigin: () => "https://trendsfast.example" }));

import { POST } from "../../app/api/project-claims/route";

function claimRequest(deliveryToken = "private-result-capability") {
  return new Request("https://trendsfast.example/api/project-claims", {
    method: "POST",
    headers: {
      origin: "https://trendsfast.example",
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ deliveryToken, intent: "save" }),
  });
}

describe("private result project claim route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.acceptsPrivateMutation.mockReturnValue(true);
    mocks.resolveReadyScanIdentity.mockResolvedValue({
      scanRequestId: "11111111-1111-4111-8111-111111111111",
      nextMoveId: "22222222-2222-4222-8222-222222222222",
      deliveryTokenId: "33333333-3333-4333-8333-333333333333",
      projectId: "44444444-4444-4444-8444-444444444444",
      deliveryExpiresAt: new Date(Date.now() + 60 * 60_000),
    });
    mocks.createProjectClaimForDelivery.mockResolvedValue({
      id: "55555555-5555-4555-8555-555555555555",
      expiresAt: new Date(Date.now() + 15 * 60_000),
    });
    mocks.getVerifiedAuthIdentity.mockResolvedValue(null);
  });

  it("stores only a hash and sets a short HttpOnly claim cookie", async () => {
    const response = await POST(claimRequest());
    expect(response.status).toBe(303);
    const persisted = mocks.createProjectClaimForDelivery.mock.calls[0]?.[0];
    expect(persisted).toMatchObject({
      deliveryTokenId: "33333333-3333-4333-8333-333333333333",
      projectId: "44444444-4444-4444-8444-444444444444",
    });
    expect(persisted.claimHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(JSON.stringify(persisted)).not.toContain("private-result-capability");
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("tf_project_claim=");
    expect(cookie.toLowerCase()).toContain("httponly");
    expect(cookie.toLowerCase()).toContain("samesite=lax");
    expect(cookie).not.toContain("private-result-capability");
    expect(response.headers.get("location")).not.toContain("private-result-capability");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("consumes immediately for a verified session and handles owner conflict", async () => {
    mocks.getVerifiedAuthIdentity.mockResolvedValue({
      authUserId: "66666666-6666-4666-8666-666666666666",
      email: "founder@example.com",
    });
    mocks.consumeProjectClaimHash.mockResolvedValue({ status: "OWNERSHIP_CONFLICT" });
    const response = await POST(claimRequest());
    expect(response.headers.get("location")).toContain("project_already_owned");
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("tf_project_claim=");
    expect(cookie).toMatch(/Max-Age=0/i);
  });

  it("opens the exact project after an immediate authenticated claim", async () => {
    mocks.getVerifiedAuthIdentity.mockResolvedValue({
      authUserId: "66666666-6666-4666-8666-666666666666",
      email: "founder@example.com",
    });
    mocks.consumeProjectClaimHash.mockResolvedValue({
      status: "CLAIMED",
      projectId: "44444444-4444-4444-8444-444444444444",
    });
    const response = await POST(claimRequest());
    expect(response.headers.get("location")).toContain(
      "/dashboard/today?project=44444444-4444-4444-8444-444444444444",
    );
    expect(response.headers.get("set-cookie")).toMatch(/tf_project_claim=.*Max-Age=0/i);
  });

  it("fails closed instead of re-issuing an already invalid authenticated claim", async () => {
    mocks.getVerifiedAuthIdentity.mockResolvedValue({
      authUserId: "66666666-6666-4666-8666-666666666666",
      email: "founder@example.com",
    });
    mocks.consumeProjectClaimHash.mockResolvedValue({ status: "REPLAYED" });
    const response = await POST(claimRequest());
    expect(response.headers.get("location")).toContain("claim_invalid");
    expect(response.headers.get("set-cookie")).toMatch(/tf_project_claim=.*Max-Age=0/i);
  });

  it("rejects invalid or expired deliveries without creating claim state", async () => {
    mocks.resolveReadyScanIdentity.mockResolvedValue(null);
    const response = await POST(claimRequest());
    expect(response.headers.get("location")).toContain("claim_invalid");
    expect(mocks.createProjectClaimForDelivery).not.toHaveBeenCalled();
  });

  it("rejects cross-site creation before resolving the private delivery", async () => {
    mocks.acceptsPrivateMutation.mockReturnValue(false);
    const response = await POST(claimRequest());
    expect(response.headers.get("location")).toContain("request_rejected");
    expect(mocks.resolveReadyScanIdentity).not.toHaveBeenCalled();
  });
});
