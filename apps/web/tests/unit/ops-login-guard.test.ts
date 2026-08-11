import { describe, expect, it } from "vitest";

import { authenticateOpsLoginRequest, InProcessOpsLoginLimiter } from "../../lib/ops-login-guard";

const expectedToken = "ops-token-that-is-at-least-thirty-two-characters";
const sessionSecret = "ops-session-secret-at-least-thirty-two-characters";

function loginRequest(body: string): Request {
  return new Request("http://localhost:3000/api/ops/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

function limiter(maxPerFingerprint = 2, maxGlobal = 10) {
  return new InProcessOpsLoginLimiter({
    maxInvalidAttemptsPerFingerprint: maxPerFingerprint,
    maxInvalidAttemptsGlobal: maxGlobal,
    windowMs: 60_000,
    maxFingerprints: 10,
  });
}

describe("operations login guard", () => {
  it("returns one generic error for malformed, missing, and incorrect credentials", async () => {
    for (const body of ["{broken", "{}", JSON.stringify({ token: "incorrect" })]) {
      const result = await authenticateOpsLoginRequest(loginRequest(body), {
        limiter: limiter(),
        fingerprint: body,
        expectedToken,
        sessionSecret,
        now: 1_000,
      });
      expect(result).toEqual({ ok: false, status: 401, error: "Operations login failed." });
    }
  });

  it("blocks completed invalid attempts and releases successful comparisons", async () => {
    const attemptLimiter = limiter(2);
    const options = {
      limiter: attemptLimiter,
      fingerprint: "same-client",
      expectedToken,
      sessionSecret,
      now: 1_000,
    };
    await expect(
      authenticateOpsLoginRequest(loginRequest('{"token":"wrong-1"}'), options),
    ).resolves.toMatchObject({ ok: false, status: 401 });
    await expect(
      authenticateOpsLoginRequest(loginRequest('{"token":"wrong-2"}'), options),
    ).resolves.toMatchObject({ ok: false, status: 401 });
    await expect(
      authenticateOpsLoginRequest(loginRequest('{"token":"wrong-3"}'), options),
    ).resolves.toMatchObject({ ok: false, status: 429 });

    const successLimiter = limiter(1);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = await authenticateOpsLoginRequest(
        loginRequest(JSON.stringify({ token: expectedToken })),
        {
          ...options,
          limiter: successLimiter,
          fingerprint: "successful-client",
        },
      );
      expect(result.ok).toBe(true);
    }
  });

  it("counts an in-flight streamed login before credential comparison completes", async () => {
    const attemptLimiter = limiter(1);
    const encoder = new TextEncoder();
    let finishBody: (() => void) | undefined;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        finishBody = () => {
          controller.enqueue(encoder.encode('{"token":"incorrect"}'));
          controller.close();
        };
      },
    });
    const firstRequest = new Request("http://localhost:3000/api/ops/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    const options = {
      limiter: attemptLimiter,
      fingerprint: "same-client",
      expectedToken,
      sessionSecret,
      now: 1_000,
    };
    const first = authenticateOpsLoginRequest(firstRequest, options);
    await expect(
      authenticateOpsLoginRequest(loginRequest('{"token":"also-incorrect"}'), options),
    ).resolves.toMatchObject({ ok: false, status: 429 });
    finishBody?.();
    await expect(first).resolves.toMatchObject({ ok: false, status: 401 });
  });

  it("enforces a process-wide bound across changing fingerprints", () => {
    const attemptLimiter = limiter(2, 2);
    attemptLimiter.reserve("first", 1_000)?.markInvalid(1_000);
    attemptLimiter.reserve("second", 1_000)?.markInvalid(1_000);
    expect(attemptLimiter.reserve("third", 1_000)).toBeNull();
  });
});
