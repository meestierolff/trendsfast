import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("../../lib/server-database", () => ({
  getRepositories: vi.fn(() => {
    throw new Error("The database must not be reached for an oversized request");
  }),
}));

import { POST } from "../../app/api/scan-requests/route";

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
  return new Request("http://localhost:3000/api/scan-requests", {
    method: "POST",
    headers: {
      origin: "http://localhost:3000",
      "content-type": "application/json",
      ...(contentLength === undefined ? {} : { "content-length": contentLength }),
    },
    body,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}

describe("public scan route request bounds", () => {
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
