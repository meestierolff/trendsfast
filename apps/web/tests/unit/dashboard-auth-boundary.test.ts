import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  getVerifiedAuthSubject: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/auth-session", () => ({
  getVerifiedAuthSubject: mocks.getVerifiedAuthSubject,
  safeDashboardDestination: (value: string | null | undefined) =>
    [
      "/dashboard",
      "/dashboard/today",
      "/dashboard/projects",
      "/dashboard/history",
      "/dashboard/agents",
      "/dashboard/billing",
    ].includes(value ?? "")
      ? value
      : "/dashboard",
}));
vi.mock("@/lib/server-database", () => ({
  getMemberRepositories: vi.fn(),
  getPublicRepositories: vi.fn(),
}));

import { requireDashboardSubject } from "../../lib/dashboard-service";

class ExpectedNextRedirect extends Error {}

describe("dashboard page authentication boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.redirect.mockImplementation((destination: string) => {
      throw new ExpectedNextRedirect(destination);
    });
  });

  it("uses Next's handled redirect for an unauthenticated dashboard render", async () => {
    mocks.getVerifiedAuthSubject.mockResolvedValue(null);

    await expect(requireDashboardSubject()).rejects.toThrow(ExpectedNextRedirect);
    expect(mocks.redirect).toHaveBeenCalledExactlyOnceWith("/login?next=/dashboard");
  });

  it("preserves an allowlisted dashboard destination without accepting an open redirect", async () => {
    mocks.getVerifiedAuthSubject.mockResolvedValue(null);

    await expect(requireDashboardSubject("/dashboard/agents")).rejects.toThrow(
      ExpectedNextRedirect,
    );
    expect(mocks.redirect).toHaveBeenLastCalledWith("/login?next=/dashboard/agents");

    await expect(requireDashboardSubject("https://attacker.example/steal")).rejects.toThrow(
      ExpectedNextRedirect,
    );
    expect(mocks.redirect).toHaveBeenLastCalledWith("/login?next=/dashboard");
  });

  it("returns the verified subject and does not redirect authenticated renders", async () => {
    const authUserId = "11111111-1111-4111-8111-111111111111";
    mocks.getVerifiedAuthSubject.mockResolvedValue(authUserId);

    await expect(requireDashboardSubject()).resolves.toBe(authUserId);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
