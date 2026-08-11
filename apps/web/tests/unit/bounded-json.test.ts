import { describe, expect, it } from "vitest";

import { readBoundedFormBody, readBoundedJsonBody } from "../../lib/bounded-json";

function streamedRequest(
  chunks: string[],
  contentLength?: string,
  contentType = "application/json",
): Request {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Request("http://localhost/test", {
    method: "POST",
    headers: {
      "content-type": contentType,
      ...(contentLength === undefined ? {} : { "content-length": contentLength }),
    },
    body,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}

describe("bounded JSON request parsing", () => {
  it("parses valid JSON split across stream chunks", async () => {
    await expect(
      readBoundedJsonBody(streamedRequest(['{"product_', 'url":"https://x.dev"}']), 64),
    ).resolves.toEqual({ ok: true, value: { product_url: "https://x.dev" } });
  });

  it("rejects an oversized chunked body without Content-Length", async () => {
    const result = await readBoundedJsonBody(
      streamedRequest(['{"value":"', "x".repeat(100), '"}']),
      64,
    );
    expect(result).toEqual({ ok: false, reason: "payload_too_large" });
  });

  it("uses actual bytes when Content-Length understates the body", async () => {
    const result = await readBoundedJsonBody(
      streamedRequest(['{"value":"', "x".repeat(100), '"}'], "1"),
      64,
    );
    expect(result).toEqual({ ok: false, reason: "payload_too_large" });
  });

  it("rejects an oversized declared body before reading it", async () => {
    const result = await readBoundedJsonBody(streamedRequest(['{"ok":true}'], "9999"), 64);
    expect(result).toEqual({ ok: false, reason: "payload_too_large" });
  });

  it("does not mistake leading zeroes in Content-Length for a large body", async () => {
    const result = await readBoundedJsonBody(streamedRequest(['{"ok":true}'], "0000000000011"), 64);
    expect(result).toEqual({ ok: true, value: { ok: true } });
  });

  it("keeps malformed JSON distinct from oversized input", async () => {
    const result = await readBoundedJsonBody(streamedRequest(["{broken"]), 64);
    expect(result).toEqual({ ok: false, reason: "invalid_json" });
  });

  it.each([
    { label: "missing", contentLength: undefined },
    { label: "understated", contentLength: "1" },
  ])(
    "bounds actual URL-encoded form bytes with $label Content-Length",
    async ({ contentLength }) => {
      const result = await readBoundedFormBody(
        streamedRequest(
          ["consent=true&padding=", "x".repeat(100)],
          contentLength,
          "application/x-www-form-urlencoded",
        ),
        64,
      );
      expect(result).toEqual({ ok: false, reason: "payload_too_large" });
    },
  );

  it("parses a bounded URL-encoded form after stream counting", async () => {
    await expect(
      readBoundedFormBody(
        streamedRequest(
          ["consent=true&kind=USEFUL"],
          undefined,
          "application/x-www-form-urlencoded",
        ),
        64,
      ),
    ).resolves.toEqual({ ok: true, value: { consent: "true", kind: "USEFUL" } });
  });

  it("parses multipart data only after the complete body is byte-bounded", async () => {
    const boundary = "bounded-test-boundary";
    const payload = [
      `--${boundary}\r\n`,
      'Content-Disposition: form-data; name="_method"\r\n\r\n',
      "delete\r\n",
      `--${boundary}--\r\n`,
    ];
    await expect(
      readBoundedFormBody(
        streamedRequest(payload, "1", `multipart/form-data; boundary=${boundary}`),
        512,
      ),
    ).resolves.toEqual({ ok: true, value: { _method: "delete" } });
  });
});
