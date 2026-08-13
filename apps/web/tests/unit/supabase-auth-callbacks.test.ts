import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn(),
  verifyOtp: vi.fn(),
  signInWithOtp: vi.fn(),
  signInWithOAuth: vi.fn(),
  finishVerifiedAuth: vi.fn(),
  authRedirect: vi.fn(),
  acceptsPrivateMutation: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => ({
    auth: {
      exchangeCodeForSession: mocks.exchangeCodeForSession,
      verifyOtp: mocks.verifyOtp,
      signInWithOtp: mocks.signInWithOtp,
      signInWithOAuth: mocks.signInWithOAuth,
    },
  })),
}));
vi.mock("@/lib/private-scan-api", () => ({
  acceptsPrivateMutation: mocks.acceptsPrivateMutation,
}));
vi.mock("@/lib/site", () => ({ siteOrigin: () => "https://trendsfast.example" }));
vi.mock("@/lib/supabase/config", () => ({
  requireSupabasePublicConfig: () => ({
    url: "https://project-ref.supabase.co",
    publishableKey: "sb_publishable_test_value_long_enough",
  }),
}));

vi.mock("@/lib/auth-flow", () => ({
  finishVerifiedAuth: mocks.finishVerifiedAuth,
  authRedirect: mocks.authRedirect,
}));

import { GET as googleCallback } from "../../app/auth/callback/route";
import { POST as startGoogle } from "../../app/auth/google/route";
import { GET as magicConfirm } from "../../app/auth/confirm/route";
import { POST as requestMagicLink } from "../../app/auth/magic-link/route";
import {
  issueMagicAuthFlow,
  MAGIC_AUTH_FLOW_PARAM,
  SUPABASE_PKCE_FLOW_PARAM,
} from "../../lib/magic-auth-flow";

function boundMagicRequest(next = "/dashboard") {
  const flow = issueMagicAuthFlow();
  const url = new URL("https://trendsfast.example/auth/confirm");
  url.searchParams.set("next", next);
  url.searchParams.set(MAGIC_AUTH_FLOW_PARAM, flow.correlation);
  url.searchParams.set(SUPABASE_PKCE_FLOW_PARAM, "flow_12345678");
  url.searchParams.set("token_hash", "server-template-hash");
  url.searchParams.set("type", "email");
  return {
    flow,
    url,
    request: new Request(url, { headers: { cookie: `${flow.cookieName}=${flow.secret}` } }),
  };
}

describe("Supabase PKCE callbacks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authRedirect.mockImplementation((path: string) =>
      NextResponse.redirect(new URL(path, "https://trendsfast.example"), 303),
    );
    mocks.finishVerifiedAuth.mockResolvedValue(NextResponse.json({ ok: true }));
    mocks.acceptsPrivateMutation.mockReturnValue(true);
  });

  it("exchanges only the verified Google callback code then finishes the pending claim", async () => {
    mocks.exchangeCodeForSession.mockResolvedValue({ error: null });
    const response = await googleCallback(
      new Request(
        "https://trendsfast.example/auth/callback?code=pkce-code&next=%2Fdashboard%2Ftoday&sb_flow_id=flow_12345678",
      ),
    );
    expect(response.status).toBe(200);
    expect(mocks.exchangeCodeForSession).toHaveBeenCalledWith("pkce-code", {
      flowId: "flow_12345678",
    });
    expect(mocks.finishVerifiedAuth).toHaveBeenCalledWith("/dashboard/today");
    expect(mocks.exchangeCodeForSession).not.toHaveBeenCalledWith(
      expect.stringContaining("delivery"),
    );
  });

  it("starts Google PKCE only through the configured Supabase Auth origin", async () => {
    mocks.signInWithOAuth.mockResolvedValue({
      data: {
        url: "https://project-ref.supabase.co/auth/v1/authorize?provider=google&state=opaque",
      },
      error: null,
    });
    const request = () =>
      new Request("https://trendsfast.example/auth/google", {
        method: "POST",
        headers: {
          origin: "https://trendsfast.example",
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ next: "/dashboard/today" }),
      });
    const response = await startGoogle(request());
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain(
      "https://project-ref.supabase.co/auth/v1/authorize",
    );
    expect(mocks.signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: {
        redirectTo: "https://trendsfast.example/auth/callback?next=%2Fdashboard%2Ftoday",
        skipBrowserRedirect: true,
      },
    });

    mocks.signInWithOAuth.mockResolvedValueOnce({
      data: { url: "https://attacker.example/oauth" },
      error: null,
    });
    await startGoogle(request());
    expect(mocks.authRedirect).toHaveBeenLastCalledWith("/login?error=google_unavailable");
  });

  it("fails closed when the Google PKCE code is missing or rejected", async () => {
    await googleCallback(new Request("https://trendsfast.example/auth/callback"));
    expect(mocks.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(mocks.authRedirect).toHaveBeenCalledWith("/login?error=verification_failed");

    mocks.exchangeCodeForSession.mockResolvedValueOnce({ error: new Error("invalid") });
    await googleCallback(
      new Request(
        "https://trendsfast.example/auth/callback?code=rejected-code&sb_flow_id=flow_12345678",
      ),
    );
    expect(mocks.finishVerifiedAuth).not.toHaveBeenCalled();
  });

  it("verifies a magic-link token hash with the email OTP type", async () => {
    mocks.verifyOtp.mockResolvedValue({ error: null });
    const bound = boundMagicRequest();
    const response = await magicConfirm(bound.request);
    expect(mocks.verifyOtp).toHaveBeenCalledWith({
      token_hash: "server-template-hash",
      type: "email",
    });
    expect(mocks.finishVerifiedAuth).toHaveBeenCalledWith("/dashboard");
    expect(response.headers.get("set-cookie")).toContain(`${bound.flow.cookieName}=`);
    expect(response.headers.get("set-cookie")).toMatch(/Max-Age=0/i);
  });

  it("preserves only an allow-listed dashboard destination through the magic-link redirect", async () => {
    mocks.signInWithOtp.mockResolvedValue({ error: null });
    const response = await requestMagicLink(
      new Request("https://trendsfast.example/auth/magic-link", {
        method: "POST",
        headers: {
          origin: "https://trendsfast.example",
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          email: "Founder@Example.com",
          next: "/dashboard/agents",
        }),
      }),
    );
    expect(response.headers.get("location")).toContain("sent=1");
    const call = mocks.signInWithOtp.mock.calls[0]?.[0];
    expect(call).toMatchObject({
      email: "founder@example.com",
      options: { shouldCreateUser: true },
    });
    const redirect = new URL(call.options.emailRedirectTo);
    expect(redirect.pathname).toBe("/auth/confirm");
    expect(redirect.searchParams.get("next")).toBe("/dashboard/agents");
    expect(redirect.searchParams.get(MAGIC_AUTH_FLOW_PARAM)).toMatch(/^[0-9a-f]{64}$/);
    const cookie = (response.headers.get("set-cookie") ?? "").split(";")[0]!;
    expect(call.options.emailRedirectTo).not.toContain(cookie.split("=")[1]);

    mocks.verifyOtp.mockResolvedValue({ error: null });
    redirect.searchParams.set(SUPABASE_PKCE_FLOW_PARAM, "flow_12345678");
    redirect.searchParams.set("token_hash", "server-template-hash");
    redirect.searchParams.set("type", "email");
    await magicConfirm(new Request(redirect, { headers: { cookie } }));
    expect(mocks.finishVerifiedAuth).toHaveBeenCalledWith("/dashboard/agents");
  });

  it("rejects a forwarded magic link in a browser that did not initiate its flow", async () => {
    const attackerFlow = boundMagicRequest("/dashboard/today");
    const response = await magicConfirm(new Request(attackerFlow.url));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain("verification_failed");
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
    expect(mocks.finishVerifiedAuth).not.toHaveBeenCalled();
  });

  it("rejects non-email and missing magic-link material before Supabase", async () => {
    await magicConfirm(
      new Request("https://trendsfast.example/auth/confirm?token_hash=value&type=recovery"),
    );
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
    expect(mocks.authRedirect).toHaveBeenCalledWith("/login?error=verification_failed");
  });
});
