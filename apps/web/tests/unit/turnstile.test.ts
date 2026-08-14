import { describe, expect, it, vi } from "vitest";

import { createTurnstileVerifier, PUBLIC_SCAN_TURNSTILE_ACTION } from "../../lib/turnstile";

const NOW = Date.parse("2026-08-13T12:00:00.000Z");

function siteverifyResponse(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    success: true,
    challenge_ts: "2026-08-13T11:59:00.000Z",
    hostname: "trendsfast.com",
    action: PUBLIC_SCAN_TURNSTILE_ACTION,
    ...overrides,
  };
}

function fetcherFor(...results: Array<Record<string, unknown>>): typeof fetch {
  const mocked = vi.fn(async () => {
    const result = results.shift();
    if (!result) throw new Error("Unexpected Siteverify request");
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  return mocked as unknown as typeof fetch;
}

describe("Turnstile server verification", () => {
  it.each(["trendsfast.vercel.app", "trendsfast.com", "www.trendsfast.com"])(
    "accepts a fresh public-scan token issued for %s",
    async (hostname) => {
      const fetcher = fetcherFor(siteverifyResponse({ hostname }));
      const verifier = createTurnstileVerifier("server-secret", fetcher, () => NOW);

      await expect(verifier.verify(`valid-${hostname}`, "203.0.113.10")).resolves.toBe(true);
      expect(fetcher).toHaveBeenCalledOnce();

      const [, init] = vi.mocked(fetcher).mock.calls[0] ?? [];
      const body = init?.body as URLSearchParams;
      expect(body.get("secret")).toBe("server-secret");
      expect(body.get("response")).toBe(`valid-${hostname}`);
      expect(body.get("remoteip")).toBeNull();
    },
  );

  it("rejects a missing token without contacting Siteverify", async () => {
    const fetcher = fetcherFor(siteverifyResponse());
    const verifier = createTurnstileVerifier("server-secret", fetcher, () => NOW);

    await expect(verifier.verify(undefined, "203.0.113.10")).resolves.toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects a forged token denied by Siteverify", async () => {
    const verifier = createTurnstileVerifier(
      "server-secret",
      fetcherFor({ success: false, "error-codes": ["invalid-input-response"] }),
      () => NOW,
    );

    await expect(verifier.verify("forged-token", "203.0.113.10")).resolves.toBe(false);
  });

  it("rejects a replayed token without sending the capability a second time", async () => {
    const fetcher = fetcherFor(siteverifyResponse());
    const verifier = createTurnstileVerifier("server-secret", fetcher, () => NOW);

    await expect(verifier.verify("one-time-token", "203.0.113.10")).resolves.toBe(true);
    await expect(verifier.verify("one-time-token", "203.0.113.10")).resolves.toBe(false);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("rejects an expired challenge at the 300-second boundary", async () => {
    const verifier = createTurnstileVerifier(
      "server-secret",
      fetcherFor(siteverifyResponse({ challenge_ts: "2026-08-13T11:55:00.000Z" })),
      () => NOW,
    );

    await expect(verifier.verify("expired-token", "203.0.113.10")).resolves.toBe(false);
  });

  it("rejects a successful response for a different hostname", async () => {
    const verifier = createTurnstileVerifier(
      "server-secret",
      fetcherFor(siteverifyResponse({ hostname: "attacker.example" })),
      () => NOW,
    );

    await expect(verifier.verify("wrong-host-token", "203.0.113.10")).resolves.toBe(false);
  });

  it("rejects a successful response for a different widget action", async () => {
    const verifier = createTurnstileVerifier(
      "server-secret",
      fetcherFor(siteverifyResponse({ action: "login" })),
      () => NOW,
    );

    await expect(verifier.verify("wrong-action-token", "203.0.113.10")).resolves.toBe(false);
  });

  it("fails closed on invalid metadata or a Siteverify transport failure", async () => {
    const invalidVerifier = createTurnstileVerifier(
      "server-secret",
      fetcherFor(siteverifyResponse({ challenge_ts: "not-a-date" })),
      () => NOW,
    );
    const failedFetcher = vi.fn(async () => {
      throw new Error("network unavailable");
    }) as unknown as typeof fetch;
    const failedVerifier = createTurnstileVerifier("server-secret", failedFetcher, () => NOW);

    await expect(invalidVerifier.verify("invalid-metadata", "203.0.113.10")).resolves.toBe(false);
    await expect(failedVerifier.verify("transport-failed", "203.0.113.10")).resolves.toBe(false);
  });
});
