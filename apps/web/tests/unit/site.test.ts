import { describe, expect, it } from "vitest";

import { absoluteUrl, siteOrigin } from "../../lib/site";

describe("public site origin", () => {
  it("keeps the local development fallback outside a hosted build", () => {
    expect(siteOrigin({})).toBe("http://localhost:3000");
  });

  it("normalizes a configured origin", () => {
    expect(siteOrigin({ APP_URL: "https://trendsfast.example/" })).toBe(
      "https://trendsfast.example",
    );
  });

  it("uses Vercel's project production hostname for hosted preview canonicals", () => {
    expect(
      siteOrigin({
        VERCEL: "1",
        VERCEL_ENV: "preview",
        VERCEL_PROJECT_PRODUCTION_URL: "TrendsFast.Vercel.App",
      }),
    ).toBe("https://trendsfast.vercel.app");
  });

  it("keeps APP_URL authoritative in a hosted build", () => {
    expect(
      siteOrigin({
        APP_URL: "https://trendsfast.com",
        VERCEL: "1",
        VERCEL_ENV: "production",
        VERCEL_PROJECT_PRODUCTION_URL: "different.vercel.app",
      }),
    ).toBe("https://trendsfast.com");
  });

  it("fails closed without both Vercel system markers and a project hostname", () => {
    expect(() => siteOrigin({ VERCEL_ENV: "production" })).toThrow(/APP_URL is required/);
    expect(() =>
      siteOrigin({
        VERCEL_ENV: "preview",
        VERCEL_PROJECT_PRODUCTION_URL: "trendsfast.vercel.app",
      }),
    ).toThrow(/APP_URL is required/);
    expect(() => siteOrigin({ VERCEL: "1", VERCEL_ENV: "preview" })).toThrow(/APP_URL is required/);
  });

  it("rejects non-hostname Vercel project production values", () => {
    for (const value of [
      "https://trendsfast.vercel.app",
      "trendsfast.vercel.app:443",
      "trendsfast.vercel.app/preview",
      "user@trendsfast.vercel.app",
      "localhost",
      "127.0.0.1",
      "-invalid.vercel.app",
      "invalid..vercel.app",
    ]) {
      expect(() =>
        siteOrigin({
          VERCEL: "1",
          VERCEL_ENV: "preview",
          VERCEL_PROJECT_PRODUCTION_URL: value,
        }),
      ).toThrow(/VERCEL_PROJECT_PRODUCTION_URL/);
    }
  });

  it("refuses insecure configured origins from a hosted build", () => {
    expect(() =>
      siteOrigin({ APP_URL: "http://trendsfast.example", VERCEL_ENV: "preview" }),
    ).toThrow(/HTTPS/);
  });

  it("rejects credentials, paths, queries, and non-HTTP schemes", () => {
    for (const value of [
      "https://user:secret@trendsfast.example",
      "https://trendsfast.example/app",
      "https://trendsfast.example?preview=1",
      "javascript:alert(1)",
    ]) {
      expect(() => siteOrigin({ APP_URL: value })).toThrow(/APP_URL/);
    }
  });

  it("builds absolute URLs from the configured origin", () => {
    const originalAppUrl = process.env.APP_URL;
    process.env.APP_URL = "https://trendsfast.example";
    try {
      expect(absoluteUrl("/agents")).toBe("https://trendsfast.example/agents");
    } finally {
      if (originalAppUrl === undefined) delete process.env.APP_URL;
      else process.env.APP_URL = originalAppUrl;
    }
  });
});
