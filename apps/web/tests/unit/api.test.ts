import { describe, expect, it, vi } from "vitest";
import { InProcessInvalidApiKeyLimiter } from "../../lib/api-auth-guard";
import { createV1Api, type V1ApiDependencies } from "../../lib/v1-api";

const TEST_KEY = "tf_test_prefix12.abcdefghijklmnopqrstuvwxyz123456";
const LIVE_KEY = "tf_live_prefix12.abcdefghijklmnopqrstuvwxyz123456";

function dependencies(overrides: Partial<V1ApiDependencies> = {}): V1ApiDependencies {
  return {
    providerCredentialMode: "fixture",
    authenticate: vi.fn(async (raw) =>
      raw === TEST_KEY
        ? {
            apiKeyId: "key_1",
            environment: "test" as const,
            scopes: ["next_move:write", "next_move:read"],
          }
        : raw === LIVE_KEY
          ? {
              apiKeyId: "key_live",
              environment: "live" as const,
              scopes: ["next_move:write", "next_move:read"],
            }
          : null,
    ),
    createOrReuse: vi.fn(async () => ({
      id: "move_test",
      status: "QUEUED" as const,
      status_url: "/v1/next-moves/move_test",
      poll_after_seconds: 30 as const,
    })),
    getStatus: vi.fn(async () => ({
      id: "move_test",
      status: "RUNNING" as const,
      status_url: "/v1/next-moves/move_test",
      poll_after_seconds: 30 as const,
    })),
    ...overrides,
  };
}

describe("v1 Next Move API", () => {
  it("publishes an unauthenticated OpenAPI contract without credentials", async () => {
    const response = await createV1Api(dependencies()).request("/v1/openapi.json");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      openapi: "3.1.0",
      paths: {
        "/v1/next-move": {
          post: {
            responses: {
              "200": {},
              "202": {},
              "400": {},
              "401": {},
              "403": {},
              "409": {},
              "413": {},
              "422": {},
              "429": {},
              "500": {},
            },
          },
        },
        "/v1/next-moves/{id}": {
          get: {
            responses: {
              "200": {},
              "401": {},
              "403": {},
              "404": {},
              "429": {},
              "500": {},
            },
          },
        },
      },
    });
  });

  it("requires a bearer key", async () => {
    const response = await createV1Api(dependencies()).request("/v1/next-move", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({ product_url: "https://example.com" }),
    });
    expect(response.status).toBe(401);
  });

  it("rejects malformed and oversized keys before expensive authentication", async () => {
    const authenticate = vi.fn(async () => null);
    const app = createV1Api(dependencies({ authenticate }));
    for (const authorization of [
      "Bearer not-a-trendsfast-key",
      `Bearer tf_test_prefix12.${"a".repeat(2_000)}`,
      "Bearer tf_test_short.too-short",
    ]) {
      const response = await app.request("/v1/next-moves/move_test", {
        headers: { authorization, "x-forwarded-for": "203.0.113.90" },
      });
      expect(response.status).toBe(401);
    }
    expect(authenticate).not.toHaveBeenCalled();
  });

  it("bounds valid-syntax invalid-key work per requester fingerprint", async () => {
    const authenticate = vi.fn(async () => null);
    const limiter = new InProcessInvalidApiKeyLimiter({
      maxInvalidAttempts: 2,
      windowMs: 60_000,
      maxFingerprints: 100,
    });
    const app = createV1Api(dependencies({ authenticate, authAttemptLimiter: limiter }));
    const request = (address: string) =>
      app.request("/v1/next-moves/move_test", {
        headers: {
          authorization: "Bearer tf_test_unknown1.abcdefghijklmnopqrstuvwxyz123456",
          "x-forwarded-for": address,
        },
      });

    expect((await request("203.0.113.91")).status).toBe(401);
    expect((await request("203.0.113.91")).status).toBe(401);
    expect((await request("203.0.113.91")).status).toBe(429);
    expect(authenticate).toHaveBeenCalledTimes(2);

    expect((await request("203.0.113.92")).status).toBe(401);
    expect(authenticate).toHaveBeenCalledTimes(3);
  });

  it("counts in-flight authentication reservations against the same bound", async () => {
    let releaseFirst: (() => void) | undefined;
    const authenticate = vi.fn(
      () =>
        new Promise<null>((resolve) => {
          releaseFirst = () => resolve(null);
        }),
    );
    const limiter = new InProcessInvalidApiKeyLimiter({
      maxInvalidAttempts: 1,
      windowMs: 60_000,
      maxFingerprints: 100,
    });
    const app = createV1Api(dependencies({ authenticate, authAttemptLimiter: limiter }));
    const init = {
      headers: {
        authorization: "Bearer tf_test_unknown1.abcdefghijklmnopqrstuvwxyz123456",
        "x-forwarded-for": "203.0.113.93",
      },
    };
    const first = app.request("/v1/next-moves/move_test", init);
    await vi.waitFor(() => expect(authenticate).toHaveBeenCalledTimes(1));
    const second = await app.request("/v1/next-moves/move_test", init);
    expect(second.status).toBe(429);
    expect(authenticate).toHaveBeenCalledTimes(1);
    releaseFirst?.();
    expect((await first).status).toBe(401);
  });

  it("applies durable admission before repository authentication", async () => {
    const authenticate = vi.fn(async () => null);
    const admitAuthenticationAttempt = vi.fn(async () => false);
    const response = await createV1Api(
      dependencies({ authenticate, admitAuthenticationAttempt }),
    ).request("/v1/next-moves/move_test", {
      headers: {
        authorization: "Bearer tf_test_unknown1.abcdefghijklmnopqrstuvwxyz123456",
        "x-forwarded-for": "203.0.113.98",
      },
    });

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(admitAuthenticationAttempt).toHaveBeenCalledTimes(1);
    expect(authenticate).not.toHaveBeenCalled();
  });

  it("returns Retry-After when the durable failed-authentication budget is exhausted", async () => {
    const response = await createV1Api(
      dependencies({
        authenticate: vi.fn(async () => null),
        recordAuthenticationFailure: vi.fn(async () => false),
      }),
    ).request("/v1/next-moves/move_test", {
      headers: {
        authorization: "Bearer tf_test_unknown1.abcdefghijklmnopqrstuvwxyz123456",
        "x-forwarded-for": "203.0.113.99",
      },
    });
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("3600");
  });

  it.each([
    { label: "missing", contentLength: undefined },
    { label: "understated", contentLength: "1" },
  ])(
    "returns 413 for an actual oversized body with $label Content-Length",
    async ({ contentLength }) => {
      const authenticate = vi.fn(async () => ({
        apiKeyId: "key_1",
        environment: "test" as const,
        scopes: ["next_move:write"],
      }));
      const app = createV1Api(dependencies({ authenticate }));
      const response = await app.request("/v1/next-move", {
        method: "POST",
        headers: {
          authorization: `Bearer ${TEST_KEY}`,
          "idempotency-key": crypto.randomUUID(),
          "content-type": "application/json",
          ...(contentLength === undefined ? {} : { "content-length": contentLength }),
        },
        body: JSON.stringify({ product_url: "https://example.com", goal: "x".repeat(40_000) }),
      });
      expect(response.status).toBe(413);
      expect(await response.json()).toMatchObject({ error: { code: "PAYLOAD_TOO_LARGE" } });
      expect(authenticate).not.toHaveBeenCalled();
    },
  );

  it.each([
    { key: TEST_KEY, mode: "managed" as const },
    { key: TEST_KEY, mode: "byok" as const },
    { key: LIVE_KEY, mode: "fixture" as const },
  ])("returns a safe 403 for a $key key in $mode mode", async ({ key, mode }) => {
    const createOrReuse = vi.fn();
    const response = await createV1Api(
      dependencies({ providerCredentialMode: mode, createOrReuse }),
    ).request("/v1/next-move", {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "idempotency-key": crypto.randomUUID(),
        "content-type": "application/json",
        "x-forwarded-for": `203.0.113.${mode === "fixture" ? 94 : mode === "managed" ? 95 : 96}`,
      },
      body: JSON.stringify({ product_url: "https://example.com" }),
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: {
        code: "FORBIDDEN",
        message: "This API key cannot be used with the active processing policy.",
      },
    });
    expect(createOrReuse).not.toHaveBeenCalled();
  });

  it("counts authenticated wrong-mode keys against the invalid-attempt bound", async () => {
    const limiter = new InProcessInvalidApiKeyLimiter({
      maxInvalidAttempts: 1,
      windowMs: 60_000,
      maxFingerprints: 100,
    });
    const app = createV1Api(
      dependencies({ providerCredentialMode: "managed", authAttemptLimiter: limiter }),
    );
    const init = {
      headers: {
        authorization: `Bearer ${TEST_KEY}`,
        "x-forwarded-for": "203.0.113.97",
      },
    };

    expect((await app.request("/v1/next-moves/move_test", init)).status).toBe(403);
    expect((await app.request("/v1/next-moves/move_test", init)).status).toBe(429);
  });

  it.each([
    { key: TEST_KEY, mode: "fixture" as const },
    { key: LIVE_KEY, mode: "managed" as const },
    { key: LIVE_KEY, mode: "byok" as const },
  ])("accepts a matching $key key in $mode mode", async ({ key, mode }) => {
    const response = await createV1Api(dependencies({ providerCredentialMode: mode })).request(
      "/v1/next-move",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${key}`,
          "idempotency-key": crypto.randomUUID(),
          "content-type": "application/json",
          "x-forwarded-for": `198.51.100.${mode === "fixture" ? 94 : mode === "managed" ? 95 : 96}`,
        },
        body: JSON.stringify({ product_url: "https://example.com" }),
      },
    );
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ poll_after_seconds: 30 });
  });

  it("requires a UUID idempotency key", async () => {
    const response = await createV1Api(dependencies()).request("/v1/next-move", {
      method: "POST",
      headers: {
        authorization: `Bearer ${TEST_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ product_url: "https://example.com" }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "IDEMPOTENCY_KEY_REQUIRED" } });
  });

  it("returns 202 and a stable status location for accepted bounded work", async () => {
    const response = await createV1Api(dependencies()).request("/v1/next-move", {
      method: "POST",
      headers: {
        authorization: `Bearer ${TEST_KEY}`,
        "idempotency-key": "4a2d1201-9666-4ef0-90a9-e5aa47786c8e",
        "content-type": "application/json",
      },
      body: JSON.stringify({ product_url: "https://example.com" }),
    });
    expect(response.status).toBe(202);
    expect(response.headers.get("location")).toBe("/v1/next-moves/move_test");
    expect(await response.json()).toMatchObject({ poll_after_seconds: 30 });
  });

  it("adds Retry-After to service-level 429 responses", async () => {
    const response = await createV1Api(
      dependencies({
        createOrReuse: vi.fn(async () => {
          const { ApiServiceError } = await import("../../lib/v1-api");
          throw new ApiServiceError("RATE_LIMITED", "Create limit reached.");
        }),
      }),
    ).request("/v1/next-move", {
      method: "POST",
      headers: {
        authorization: `Bearer ${TEST_KEY}`,
        "idempotency-key": crypto.randomUUID(),
        "content-type": "application/json",
      },
      body: JSON.stringify({ product_url: "https://example.com" }),
    });
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("3600");
  });

  it("does not accept unknown request fields", async () => {
    const response = await createV1Api(dependencies()).request("/v1/next-move", {
      method: "POST",
      headers: {
        authorization: `Bearer ${TEST_KEY}`,
        "idempotency-key": "4a2d1201-9666-4ef0-90a9-e5aa47786c8e",
        "content-type": "application/json",
      },
      body: JSON.stringify({ product_url: "https://example.com", surprise: true }),
    });
    expect(response.status).toBe(422);
  });
});
