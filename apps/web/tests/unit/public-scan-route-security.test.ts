import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("../../lib/server-database", () => ({
  getRepositories: vi.fn(() => {
    throw new Error("The database must not be reached for an oversized request");
  }),
}));

import { POST } from "../../app/api/scan-requests/route";

const origin = process.env.APP_URL ?? "http://localhost:3000";

function oversizedPublicRequest(contentLength?: string): Request {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode('{"product_url":"https://example.com","padding":"'));
      controller.enqueue(encoder.encode("x".repeat(9_000)));
      controller.enqueue(encoder.encode('"}'));
      controller.close();
    },
  });
  return new Request(`${origin}/api/scan-requests`, {
    method: "POST",
    headers: {
      origin,
      "content-type": "application/json",
      ...(contentLength === undefined ? {} : { "content-length": contentLength }),
    },
    body,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}

describe("public scan route request bounds", () => {
  beforeEach(() => vi.stubEnv("PUBLIC_SCANS_ENABLED", "true"));
  afterEach(() => vi.unstubAllEnvs());

  it("stops disabled public scans before reaching the database", async () => {
    vi.stubEnv("PUBLIC_SCANS_ENABLED", "false");
    const response = await POST(
      new Request(`${origin}/api/scan-requests`, {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({ product_url: "https://example.com" }),
      }),
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      error: "Public scans are temporarily unavailable.",
    });
  });

  it.each([
    { label: "chunked/missing", contentLength: undefined },
    { label: "understated", contentLength: "1" },
  ])(
    "returns 413 for an actual oversized body with $label Content-Length",
    async ({ contentLength }) => {
      const response = await POST(oversizedPublicRequest(contentLength));
      expect(response.status).toBe(413);
      expect(await response.json()).toEqual({ error: "The request body is too large." });
    },
  );
});
