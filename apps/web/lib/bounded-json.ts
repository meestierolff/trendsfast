export type BoundedJsonBodyResult =
  { ok: true; value: unknown } | { ok: false; reason: "invalid_json" | "payload_too_large" };

export type BoundedBodyBytesResult =
  { ok: true; value: Uint8Array } | { ok: false; reason: "body_unreadable" | "payload_too_large" };

export type BoundedFormBodyResult =
  | { ok: true; value: Record<string, FormDataEntryValue> }
  | { ok: false; reason: "invalid_form" | "payload_too_large" };

function declaredBodyExceedsLimit(request: Request, maxBytes: number): boolean {
  const header = request.headers.get("content-length")?.trim();
  if (!header || !/^\d+$/.test(header)) return false;

  const significantDigits = header.replace(/^0+/, "") || "0";
  // Avoid doing unbounded numeric work on an attacker-controlled header. Any
  // decimal byte count with this many significant digits is above these limits.
  if (significantDigits.length > 12) return true;
  return Number(significantDigits) > maxBytes;
}

/** Content-Length is an early rejection hint only; the stream is authoritative. */
export async function readBoundedBodyBytes(
  request: Request,
  maxBytes: number,
): Promise<BoundedBodyBytesResult> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new Error("maxBytes must be a positive safe integer");
  }
  if (declaredBodyExceedsLimit(request, maxBytes)) {
    return { ok: false, reason: "payload_too_large" };
  }
  if (!request.body) return { ok: true, value: new Uint8Array() };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytesRead = 0;

  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytesRead += chunk.value.byteLength;
      if (bytesRead > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, reason: "payload_too_large" };
      }
      chunks.push(chunk.value);
    }
    const value = new Uint8Array(bytesRead);
    let offset = 0;
    for (const chunk of chunks) {
      value.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { ok: true, value };
  } catch {
    return { ok: false, reason: "body_unreadable" };
  } finally {
    reader.releaseLock();
  }
}

/**
 * Read and parse JSON without ever buffering more than maxBytes from the
 * request stream.
 */
export async function readBoundedJsonBody(
  request: Request,
  maxBytes: number,
): Promise<BoundedJsonBodyResult> {
  const body = await readBoundedBodyBytes(request, maxBytes);
  if (!body.ok) {
    return {
      ok: false,
      reason: body.reason === "payload_too_large" ? "payload_too_large" : "invalid_json",
    };
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(body.value);
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, reason: "invalid_json" };
  }
}

/** Parse only a byte-bounded URL-encoded or multipart form body. */
export async function readBoundedFormBody(
  request: Request,
  maxBytes: number,
): Promise<BoundedFormBodyResult> {
  const body = await readBoundedBodyBytes(request, maxBytes);
  if (!body.ok) {
    return {
      ok: false,
      reason: body.reason === "payload_too_large" ? "payload_too_large" : "invalid_form",
    };
  }
  const contentType = request.headers.get("content-type") ?? "";
  try {
    if (contentType.toLowerCase().includes("application/x-www-form-urlencoded")) {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(body.value);
      return { ok: true, value: Object.fromEntries(new URLSearchParams(text)) };
    }
    if (contentType.toLowerCase().includes("multipart/form-data")) {
      const boundedBuffer = new ArrayBuffer(body.value.byteLength);
      new Uint8Array(boundedBuffer).set(body.value);
      const boundedRequest = new Request(request.url, {
        method: "POST",
        headers: { "content-type": contentType },
        body: boundedBuffer,
      });
      const form = await boundedRequest.formData();
      return { ok: true, value: Object.fromEntries(form.entries()) };
    }
  } catch {
    return { ok: false, reason: "invalid_form" };
  }
  return { ok: false, reason: "invalid_form" };
}
