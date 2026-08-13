import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

afterEach(() => vi.unstubAllEnvs());

import { claimedProjectDestination, safeDashboardDestination } from "../../lib/auth-session";
import {
  PROJECT_CLAIM_COOKIE,
  PROJECT_CLAIM_TTL_SECONDS,
  issueProjectClaimSecret,
  projectClaimCookieOptions,
  projectClaimHash,
} from "../../lib/project-claim-cookie";
import {
  hasValidMagicAuthFlow,
  issueMagicAuthFlow,
  magicAuthFlowCookieOptions,
  MAGIC_AUTH_FLOW_TTL_SECONDS,
} from "../../lib/magic-auth-flow";
import {
  SupabaseAuthConfigurationError,
  readSupabasePublicConfig,
  requireSupabasePublicConfig,
} from "../../lib/supabase/config";

describe("Supabase Auth configuration", () => {
  it("accepts only a complete publishable HTTPS project configuration", () => {
    expect(
      readSupabasePublicConfig({
        NEXT_PUBLIC_SUPABASE_URL: "https://project-ref.supabase.co/",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_value_long_enough",
      }),
    ).toEqual({
      url: "https://project-ref.supabase.co",
      publishableKey: "sb_publishable_test_value_long_enough",
    });
    expect(
      readSupabasePublicConfig({
        NEXT_PUBLIC_SUPABASE_URL: "http://project-ref.supabase.co",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_value_long_enough",
      }),
    ).toBeNull();
    expect(readSupabasePublicConfig({})).toBeNull();
    expect(() => requireSupabasePublicConfig({})).toThrow(SupabaseAuthConfigurationError);
  });

  it("permits explicit loopback HTTP for local Supabase only", () => {
    expect(
      readSupabasePublicConfig({
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "local_publishable_key_long_enough",
      })?.url,
    ).toBe("http://127.0.0.1:54321");
  });
});

describe("single-use project claim material", () => {
  it("issues high-entropy opaque material and exposes only its deterministic hash", () => {
    const first = issueProjectClaimSecret();
    const second = issueProjectClaimSecret();
    expect(first.rawClaim).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first.claimHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(projectClaimHash(first.rawClaim)).toBe(first.claimHash);
    expect(second.rawClaim).not.toBe(first.rawClaim);
    expect(first.claimHash).not.toContain(first.rawClaim);
    expect(projectClaimHash("private-delivery-token")).toBeNull();
  });

  it("uses a short HttpOnly SameSite claim cookie", () => {
    expect(PROJECT_CLAIM_COOKIE).toBe("tf_project_claim");
    expect(PROJECT_CLAIM_TTL_SECONDS).toBe(900);
    expect(projectClaimCookieOptions(true)).toEqual({
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
      maxAge: 900,
    });
    vi.stubEnv("APP_URL", "https://preview.trendsfast.example");
    expect(projectClaimCookieOptions(false).secure).toBe(true);
  });
});

describe("browser-bound magic-link flow", () => {
  it("keeps the random secret in an HttpOnly cookie and verifies only its correlation hash", () => {
    const flow = issueMagicAuthFlow();
    expect(flow.secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(flow.correlation).toMatch(/^[0-9a-f]{64}$/);
    expect(flow.cookieName).toBe(`tf_magic_flow_${flow.correlation}`);
    expect(MAGIC_AUTH_FLOW_TTL_SECONDS).toBe(900);
    expect(
      hasValidMagicAuthFlow(
        new Request("https://trendsfast.example/auth/confirm", {
          headers: { cookie: `${flow.cookieName}=${flow.secret}` },
        }),
        flow.correlation,
      ),
    ).toBe(true);
    expect(
      hasValidMagicAuthFlow(
        new Request("https://trendsfast.example/auth/confirm"),
        flow.correlation,
      ),
    ).toBe(false);
    expect(magicAuthFlowCookieOptions(true)).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/auth/confirm",
      maxAge: 900,
    });
  });
});

describe("post-auth redirect allow list", () => {
  it("allows only fixed dashboard routes", () => {
    expect(safeDashboardDestination("/dashboard/today")).toBe("/dashboard/today");
    expect(safeDashboardDestination("https://attacker.example/steal")).toBe("/dashboard");
    expect(safeDashboardDestination("//attacker.example")).toBe("/dashboard");
    expect(safeDashboardDestination("/dashboard/today?project=other")).toBe("/dashboard");
    expect(
      claimedProjectDestination("/dashboard/agents", "11111111-1111-4111-8111-111111111111"),
    ).toBe("/dashboard/agents?project=11111111-1111-4111-8111-111111111111");
  });
});
