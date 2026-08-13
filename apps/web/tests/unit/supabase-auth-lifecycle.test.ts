import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  createSupabaseServerClient: vi.fn(),
  signOut: vi.fn(),
  acceptsPrivateMutation: vi.fn(),
  authRedirect: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({ createServerClient: mocks.createServerClient }));
vi.mock("@/lib/supabase/config", () => ({
  readSupabasePublicConfig: () => ({
    url: "https://project-ref.supabase.co",
    publishableKey: "sb_publishable_test_value_long_enough",
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: mocks.createSupabaseServerClient,
}));
vi.mock("@/lib/private-scan-api", () => ({
  acceptsPrivateMutation: mocks.acceptsPrivateMutation,
}));
vi.mock("@/lib/auth-flow", () => ({ authRedirect: mocks.authRedirect }));

import { POST as logout } from "../../app/auth/logout/route";
import { refreshSupabaseAuthSession } from "../../lib/supabase/proxy";

describe("Supabase session lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.acceptsPrivateMutation.mockReturnValue(true);
    mocks.authRedirect.mockImplementation(
      (path: string) => new Response(null, { status: 303, headers: { location: path } }),
    );
    mocks.createSupabaseServerClient.mockResolvedValue({ auth: { signOut: mocks.signOut } });
    mocks.signOut.mockResolvedValue({ error: null });
  });

  it("copies Supabase's refreshed cookies onto the outgoing proxy response", async () => {
    mocks.createServerClient.mockImplementation(
      (
        _url: string,
        _key: string,
        options: {
          cookies: {
            setAll: (
              values: Array<{
                name: string;
                value: string;
                options: { httpOnly: boolean; sameSite: "lax" };
              }>,
            ) => void;
          };
        },
      ) => ({
        auth: {
          getClaims: vi.fn(async () => {
            options.cookies.setAll([
              {
                name: "sb-project-auth-token",
                value: "refreshed-cookie",
                options: { httpOnly: true, sameSite: "lax" },
              },
            ]);
            return { data: { claims: { sub: "11111111-1111-4111-8111-111111111111" } } };
          }),
        },
      }),
    );

    const response = await refreshSupabaseAuthSession(
      new NextRequest("https://trendsfast.example/dashboard", {
        headers: { cookie: "sb-project-auth-token=old-cookie" },
      }),
    );
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("sb-project-auth-token=refreshed-cookie");
    expect(cookie.toLowerCase()).toContain("httponly");
    expect(cookie.toLowerCase()).toContain("samesite=lax");
    expect(mocks.createServerClient.mock.calls[0]?.[2]?.auth).toMatchObject({
      flowType: "pkce",
      experimental: { appendPkceFlowIdToRedirects: true },
    });
  });

  it("uses local-only Supabase sign-out after a same-origin mutation", async () => {
    const response = await logout(
      new Request("https://trendsfast.example/auth/logout", {
        method: "POST",
        headers: { origin: "https://trendsfast.example" },
      }),
    );
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/login?signed_out=1");
  });

  it("rejects cross-site sign-out without touching the Auth session", async () => {
    mocks.acceptsPrivateMutation.mockReturnValue(false);
    const response = await logout(
      new Request("https://trendsfast.example/auth/logout", { method: "POST" }),
    );
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe("/login?error=request_rejected");
  });
});
