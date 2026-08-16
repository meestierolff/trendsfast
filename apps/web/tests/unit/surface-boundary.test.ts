import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import robots from "../../app/robots";
import sitemap from "../../app/sitemap";
import { config, proxy } from "../../proxy";

afterEach(() => vi.unstubAllEnvs());

describe("public and founder operations deployment surfaces", () => {
  it.each([
    "/ops",
    "/ops/scans/example",
    "/api/ops/session",
    "/api/ops/private/action",
    "/api/cron/retention",
  ])("returns the same early 404 for %s on the public surface", async (path) => {
    vi.stubEnv("TRENDSFAST_SURFACE", "public");
    const response = await proxy(new NextRequest(`https://trendsfast.example${path}`));

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Not Found");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("x-robots-tag")).toContain("noindex");
  });

  it("matches every suffix so static-looking ops paths cannot bypass Proxy", async () => {
    expect(config.matcher).toEqual(["/:path*"]);
    vi.stubEnv("TRENDSFAST_SURFACE", "public");
    expect(
      (await proxy(new NextRequest("https://trendsfast.example/ops/private.png"))).status,
    ).toBe(404);
    expect(
      (await proxy(new NextRequest("https://trendsfast.example/api/ops/export.svg"))).status,
    ).toBe(404);
  });

  it("treats a missing or invalid surface value as public", async () => {
    vi.stubEnv("TRENDSFAST_SURFACE", "not-a-surface");
    expect((await proxy(new NextRequest("https://trendsfast.example/ops"))).status).toBe(404);
  });

  it("leaves founder controls routable and marks every ops response noindex", async () => {
    vi.stubEnv("TRENDSFAST_SURFACE", "ops");
    const response = await proxy(new NextRequest("https://ops.trendsfast.example/ops"));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow, noarchive");
    expect(response.headers.get("referrer-policy")).toBe("strict-origin");
  });

  it.each(["/login", "/dashboard", "/dashboard/agents", "/scan/private-capability"])(
    "preserves only the tuple origin for native mutation document %s",
    async (path) => {
      vi.stubEnv("TRENDSFAST_SURFACE", "public");
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");

      const response = await proxy(new NextRequest(`https://trendsfast.example${path}`));

      expect(response.headers.get("referrer-policy")).toBe("strict-origin");
    },
  );

  it("keeps private mutation and hidden responses on no-referrer", async () => {
    vi.stubEnv("TRENDSFAST_SURFACE", "public");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");

    const mutation = await proxy(
      new NextRequest("https://trendsfast.example/auth/magic-link", { method: "POST" }),
    );
    const hidden = await proxy(new NextRequest("https://trendsfast.example/api/ops/session"));

    expect(mutation.headers.get("referrer-policy")).toBe("no-referrer");
    expect(hidden.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it.each(["/auth/confirm", "/api/scan-requests", "/v1/next-move"])(
    "keeps response-only path %s on no-referrer",
    async (path) => {
      vi.stubEnv("TRENDSFAST_SURFACE", "public");
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");

      const response = await proxy(new NextRequest(`https://trendsfast.example${path}`));

      expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    },
  );

  it("uses strict-origin only for document reads", async () => {
    vi.stubEnv("TRENDSFAST_SURFACE", "public");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");

    const head = await proxy(
      new NextRequest("https://trendsfast.example/login", { method: "HEAD" }),
    );
    const post = await proxy(
      new NextRequest("https://trendsfast.example/login", { method: "POST" }),
    );

    expect(head.headers.get("referrer-policy")).toBe("strict-origin");
    expect(post.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it.each([
    "/",
    "/pricing",
    "/scan/private-capability",
    "/api/scans/private-capability/status",
    "/v1/next-move",
    "/api/billing/webhook",
    "/api/cron/monitoring",
  ])("returns the same early 404 for public-plane path %s on the ops surface", async (path) => {
    vi.stubEnv("TRENDSFAST_SURFACE", "ops");
    const response = await proxy(new NextRequest(`https://ops.trendsfast.example${path}`));

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Not Found");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("x-robots-tag")).toContain("noindex");
  });

  it.each([
    "/api/ops/session",
    "/api/cron/retention",
    "/_next/static/chunk.js",
    "/robots.txt",
    "/icon",
  ])("allows required ops/framework path %s on the ops surface", async (path) => {
    vi.stubEnv("TRENDSFAST_SURFACE", "ops");
    expect((await proxy(new NextRequest(`https://ops.trendsfast.example${path}`))).status).toBe(
      200,
    );
  });

  it("publishes no sitemap and disallows indexing on the ops surface", async () => {
    vi.stubEnv("TRENDSFAST_SURFACE", "ops");

    expect(
      (await proxy(new NextRequest("https://ops.trendsfast.example/sitemap.xml"))).status,
    ).toBe(404);
    expect(sitemap()).toEqual([]);
    expect(robots().rules).toEqual({ userAgent: "*", disallow: "/" });
  });
});
