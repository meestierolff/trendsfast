import {
  getRedirectUrl,
  unstable_getResponseFromNextConfig,
} from "next/experimental/testing/server";
import { describe, expect, it } from "vitest";

import { canonicalHostRedirects, nextConfig } from "../../next.config";

describe("canonical host redirect", () => {
  it("declares one exact, permanent, direct www-to-apex route", () => {
    expect(canonicalHostRedirects).toEqual([
      {
        source: "/:path*",
        has: [{ type: "host", value: "www\\.trendsfast\\.com" }],
        destination: "https://trendsfast.com/:path*",
        permanent: true,
      },
    ]);
  });

  it("emits one 308 while preserving a nested path and the original query", async () => {
    const response = await unstable_getResponseFromNextConfig({
      url: "https://www.trendsfast.com/scan/example%20product?ref=dogfood&next=%2Fdashboard%3Ftab%3Dtoday",
      nextConfig,
    });

    expect(response.status).toBe(308);
    expect(getRedirectUrl(response)).toBe(
      "https://trendsfast.com/scan/example%20product?ref=dogfood&next=%2Fdashboard%3Ftab%3Dtoday",
    );
  });

  it.each([
    "https://trendsfast.com/scan/example?ref=dogfood",
    "https://trendsfast.vercel.app/scan/example?ref=dogfood",
    "https://trendsfast-ops.vercel.app/scan/example?ref=dogfood",
    "https://wwwXtrendsfastYcom/scan/example?ref=dogfood",
  ])("does not redirect the apex, generated aliases, ops, or lookalike hosts: %s", async (url) => {
    const response = await unstable_getResponseFromNextConfig({ url, nextConfig });

    expect(response.status).toBe(200);
    expect(getRedirectUrl(response)).toBeNull();
  });
});
