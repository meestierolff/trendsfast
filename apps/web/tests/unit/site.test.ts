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

  it("refuses to publish localhost canonicals from a hosted build", () => {
    expect(() => siteOrigin({ VERCEL_ENV: "production" })).toThrow(/APP_URL is required/);
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
