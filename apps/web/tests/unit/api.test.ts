import { describe, expect, it, vi } from "vitest";
import { NextMoveReadyResponseSchema } from "@trendsfast/schemas";
import { InProcessInvalidApiKeyLimiter } from "../../lib/api-auth-guard";
import { ApiServiceError, createV1Api, type V1ApiDependencies } from "../../lib/v1-api";

const TEST_KEY = "tf_test_prefix12.abcdefghijklmnopqrstuvwxyz123456";
const LIVE_KEY = "tf_live_prefix12.abcdefghijklmnopqrstuvwxyz123456";

function dependencies(overrides: Partial<V1ApiDependencies> = {}): V1ApiDependencies {
  return {
    providerCredentialMode: "fixture",
    liveApiCreationEnabled: true,
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
    createOrReuseForProject: vi.fn(async () => ({
      id: "move_project",
      status: "QUEUED" as const,
      status_url: "/v1/next-moves/move_project",
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
              "202": {
                headers: {
                  "Retry-After": { schema: { type: "integer", const: 30, example: 30 } },
                },
              },
              "400": {},
              "401": {},
              "403": {},
              "409": {},
              "413": {},
              "422": {},
              "429": {},
              "500": {},
              "503": {},
            },
          },
        },
        "/v1/projects/{project_id}/next-move": {
          post: {
            responses: {
              "200": {},
              "202": {
                headers: {
                  "Retry-After": { schema: { type: "integer", const: 30, example: 30 } },
                },
              },
              "400": {},
              "401": {},
              "403": {},
              "409": {},
              "413": {},
              "422": {},
              "429": {},
              "500": {},
              "503": {},
            },
          },
        },
        "/v1/next-moves/{id}": {
          get: {
            responses: {
              "200": {
                headers: {
                  "Retry-After": { schema: { type: "integer", const: 30, example: 30 } },
                },
              },
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

  it("keeps the documented ready example aligned with the runtime v1 schema", async () => {
    const response = await createV1Api(dependencies()).request("/v1/openapi.json");
    const document = (await response.json()) as {
      paths?: {
        "/v1/next-move"?: {
          post?: {
            responses?: {
              "200"?: { content?: { "application/json"?: { example?: unknown } } };
            };
          };
        };
        "/v1/projects/{project_id}/next-move"?: {
          post?: {
            requestBody?: {
              content?: { "application/json"?: { example?: { generation_level?: string } } };
            };
            responses?: {
              "200"?: {
                content?: { "application/json"?: { example?: unknown } };
              };
            };
          };
        };
      };
      components?: {
        schemas?: Record<string, { required?: string[] }>;
      };
    };
    const example =
      document.paths?.["/v1/next-move"]?.post?.responses?.["200"]?.content?.["application/json"]
        ?.example;

    expect(NextMoveReadyResponseSchema.parse(example)).toMatchObject({
      contract_version: "next-move-v1",
      generation_level: "brief",
      action_details: { action: "WAIT" },
      freshness: { state: "CURRENT", requires_new_scan: false },
      auto_publish: false,
    });
    expect(document.components?.schemas).toHaveProperty("ProjectNextMoveRequest");
    expect(document.components?.schemas?.NextMoveRequest?.required).toEqual(["product_url"]);
    expect(document.components?.schemas?.ProjectNextMoveRequest?.required).toBeUndefined();
    expect(
      document.paths?.["/v1/projects/{project_id}/next-move"]?.post?.requestBody?.content?.[
        "application/json"
      ]?.example?.generation_level,
    ).toBe("draft");
    const projectReadyExample =
      document.paths?.["/v1/projects/{project_id}/next-move"]?.post?.responses?.["200"]?.content?.[
        "application/json"
      ]?.example;
    expect(NextMoveReadyResponseSchema.parse(projectReadyExample)).toMatchObject({
      contract_version: "next-move-v1",
      generation_level: "draft",
      action_details: { action: "WAIT" },
      auto_publish: false,
    });
    const documentedExample = example as {
      why_now?: { independent_source_count?: number };
      evidence?: unknown[];
    };
    expect(documentedExample.why_now?.independent_source_count).toBe(1);
    expect(documentedExample.evidence?.length).toBe(1);
  });

  it("requires a bearer key", async () => {
    const response = await createV1Api(dependencies()).request("/v1/next-move", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({ product_url: "https://example.com" }),
    });
    expect(response.status).toBe(401);
  });

  it("rejects disabled creation before authentication or service work", async () => {
    const authenticate = vi.fn(async () => null);
    const admitAuthenticationAttempt = vi.fn(async () => true);
    const createOrReuse = vi.fn();
    const response = await createV1Api(
      dependencies({
        liveApiCreationEnabled: false,
        authenticate,
        admitAuthenticationAttempt,
        createOrReuse,
      }),
    ).request("/v1/next-move", {
      method: "POST",
      headers: {
        authorization: `Bearer ${TEST_KEY}`,
        "content-type": "application/json",
        "idempotency-key": crypto.randomUUID(),
      },
      body: JSON.stringify({ product_url: "https://example.com" }),
    });

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      error: {
        code: "UNAVAILABLE",
        message: "New API research is temporarily unavailable.",
      },
    });
    expect(admitAuthenticationAttempt).not.toHaveBeenCalled();
    expect(authenticate).not.toHaveBeenCalled();
    expect(createOrReuse).not.toHaveBeenCalled();
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
    expect(response.headers.get("retry-after")).toBe("30");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      id: "move_test",
      status: "QUEUED",
      status_url: "/v1/next-moves/move_test",
      poll_after_seconds: 30,
    });
  });

  it("admits the preferred claimed-project route only for its project-restricted key", async () => {
    const projectId = "21437295-6781-41a0-a42b-e6db11c553b2";
    const createOrReuseForProject = vi.fn(async () => ({
      id: "move_project",
      status: "QUEUED" as const,
      status_url: "/v1/next-moves/move_project",
      poll_after_seconds: 30 as const,
    }));
    const app = createV1Api(
      dependencies({
        authenticate: vi.fn(async () => ({
          apiKeyId: "key_project",
          projectId,
          environment: "test" as const,
          scopes: ["next_move:write", "next_move:read"],
        })),
        createOrReuseForProject,
      }),
    );
    const idempotencyKey = "57254b33-891c-48d8-9cc8-6453ca41df1a";
    const response = await app.request(`/v1/projects/${projectId}/next-move`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${TEST_KEY}`,
        "idempotency-key": idempotencyKey,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        objective: "Grow among technical founders",
        content_capabilities: ["founder_text"],
      }),
    });

    expect(response.status).toBe(202);
    expect(response.headers.get("location")).toBe("/v1/next-moves/move_project");
    expect(response.headers.get("retry-after")).toBe("30");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      id: "move_project",
      status: "QUEUED",
      status_url: "/v1/next-moves/move_project",
      poll_after_seconds: 30,
    });
    expect(createOrReuseForProject).toHaveBeenCalledWith({
      principal: expect.objectContaining({ projectId }),
      projectId,
      idempotencyKey,
      request: {
        objective: "Grow among technical founders",
        content_capabilities: ["founder_text"],
        generation_level: "draft",
      },
    });

    const brief = await app.request(`/v1/projects/${projectId}/next-move`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${TEST_KEY}`,
        "idempotency-key": crypto.randomUUID(),
        "content-type": "application/json",
      },
      body: JSON.stringify({ generation_level: "brief" }),
    });
    expect(brief.status).toBe(422);
    expect(createOrReuseForProject).toHaveBeenCalledTimes(1);

    const wrongProject = await app.request(
      "/v1/projects/3dfa8d10-f3ed-427a-993c-280243a329e6/next-move",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${TEST_KEY}`,
          "idempotency-key": crypto.randomUUID(),
          "content-type": "application/json",
        },
        body: "{}",
      },
    );
    expect(wrongProject.status).toBe(403);
    expect(createOrReuseForProject).toHaveBeenCalledTimes(1);
  });

  it("requires read plus write scope on the dashboard-compatible project workflow", async () => {
    const projectId = "21437295-6781-41a0-a42b-e6db11c553b2";
    const createOrReuseForProject = vi.fn();
    const response = await createV1Api(
      dependencies({
        authenticate: vi.fn(async () => ({
          apiKeyId: "key_project",
          projectId,
          environment: "test" as const,
          scopes: ["next_move:write"],
        })),
        createOrReuseForProject,
      }),
    ).request(`/v1/projects/${projectId}/next-move`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${TEST_KEY}`,
        "idempotency-key": crypto.randomUUID(),
        "content-type": "application/json",
      },
      body: "{}",
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: {
        code: "FORBIDDEN",
        message: "The project workflow requires both next_move:write and next_move:read scopes.",
      },
    });
    expect(createOrReuseForProject).not.toHaveBeenCalled();
  });

  it("keeps the LIVE_API creation gate in front of the preferred project route", async () => {
    const projectId = "21437295-6781-41a0-a42b-e6db11c553b2";
    const authenticate = vi.fn();
    const createOrReuseForProject = vi.fn();
    const response = await createV1Api(
      dependencies({
        liveApiCreationEnabled: false,
        authenticate,
        createOrReuseForProject,
      }),
    ).request(`/v1/projects/${projectId}/next-move`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${TEST_KEY}`,
        "idempotency-key": crypto.randomUUID(),
        "content-type": "application/json",
      },
      body: "{}",
    });

    expect(response.status).toBe(503);
    expect(authenticate).not.toHaveBeenCalled();
    expect(createOrReuseForProject).not.toHaveBeenCalled();
  });

  it("returns terminal READY as 200 without polling headers on the preferred project route", async () => {
    const projectId = "21437295-6781-41a0-a42b-e6db11c553b2";
    const openApiResponse = await createV1Api(dependencies()).request("/v1/openapi.json");
    const document = (await openApiResponse.json()) as {
      paths?: {
        "/v1/next-move"?: {
          post?: {
            responses?: {
              "200"?: { content?: { "application/json"?: { example?: unknown } } };
            };
          };
        };
      };
    };
    const example =
      document.paths?.["/v1/next-move"]?.post?.responses?.["200"]?.content?.["application/json"]
        ?.example;
    const ready = NextMoveReadyResponseSchema.parse({
      ...(typeof example === "object" && example !== null ? example : {}),
      generation_level: "draft",
    });
    const response = await createV1Api(
      dependencies({
        authenticate: vi.fn(async () => ({
          apiKeyId: "key_project",
          projectId,
          environment: "test" as const,
          scopes: ["next_move:write", "next_move:read"],
        })),
        createOrReuseForProject: vi.fn(async () => ready),
      }),
    ).request(`/v1/projects/${projectId}/next-move`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${TEST_KEY}`,
        "idempotency-key": crypto.randomUUID(),
        "content-type": "application/json",
      },
      body: JSON.stringify({ generation_level: "draft" }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("retry-after")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual(ready);
  });

  it("returns 401 for an invalid bearer key on the preferred claimed-project route", async () => {
    const projectId = "21437295-6781-41a0-a42b-e6db11c553b2";
    const createOrReuseForProject = vi.fn();
    const response = await createV1Api(dependencies({ createOrReuseForProject })).request(
      `/v1/projects/${projectId}/next-move`,
      {
        method: "POST",
        headers: {
          authorization: "Bearer tf_test_unknown1.abcdefghijklmnopqrstuvwxyz123456",
          "idempotency-key": crypto.randomUUID(),
          "content-type": "application/json",
          "x-forwarded-for": "203.0.113.101",
        },
        body: JSON.stringify({ generation_level: "draft" }),
      },
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: { code: "UNAUTHORIZED", message: "The API key is invalid or revoked." },
    });
    expect(createOrReuseForProject).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "incompatible idempotency replay",
      code: "CONFLICT" as const,
      message: "The Idempotency-Key was already used for a different request.",
      status: 409,
      address: "203.0.113.102",
    },
    {
      label: "request rate admission",
      code: "RATE_LIMITED" as const,
      message: "The API key hourly request limit was reached.",
      status: 429,
      address: "203.0.113.103",
    },
    {
      label: "provider-cost admission",
      code: "COST_LIMITED" as const,
      message: "The API key provider-cost limit would be exceeded.",
      status: 429,
      address: "203.0.113.104",
    },
    {
      label: "Founder usage admission",
      code: "USAGE_LIMITED" as const,
      message: "The Founder plan request limit was reached.",
      status: 429,
      address: "203.0.113.105",
    },
    {
      label: "disabled provider work",
      code: "UNAVAILABLE" as const,
      message: "Provider-backed scan creation is disabled by deployment policy.",
      status: 503,
      address: "203.0.113.106",
    },
  ])("maps $label safely on the preferred project route", async (testCase) => {
    const projectId = "21437295-6781-41a0-a42b-e6db11c553b2";
    const createOrReuseForProject = vi.fn(async () => {
      throw new ApiServiceError(testCase.code, testCase.message);
    });
    const response = await createV1Api(
      dependencies({
        providerCredentialMode: "managed",
        authenticate: vi.fn(async () => ({
          apiKeyId: "key_project",
          projectId,
          environment: "live" as const,
          scopes: ["next_move:write", "next_move:read"],
        })),
        createOrReuseForProject,
      }),
    ).request(`/v1/projects/${projectId}/next-move`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${LIVE_KEY}`,
        "idempotency-key": crypto.randomUUID(),
        "content-type": "application/json",
        "x-forwarded-for": testCase.address,
      },
      body: JSON.stringify({ generation_level: "draft" }),
    });

    expect(response.status).toBe(testCase.status);
    expect(response.headers.get("retry-after")).toBe(testCase.status === 429 ? "3600" : null);
    const body = await response.json();
    expect(body).toEqual({ error: { code: testCase.code, message: testCase.message } });
    expect(JSON.stringify(body)).not.toMatch(
      /91\.333|7\.25|costReservation|actualCost|stack|postgres|database/i,
    );
  });

  it.each(["QUEUED", "RUNNING", "REVIEW_REQUIRED"] as const)(
    "adds body-derived Retry-After to a %s status response",
    async (status) => {
      const result = {
        id: "move_status",
        status,
        status_url: "/v1/next-moves/move_status",
        poll_after_seconds: 30 as const,
      };
      const response = await createV1Api(
        dependencies({ getStatus: vi.fn(async () => result) }),
      ).request("/v1/next-moves/move_status", {
        headers: { authorization: `Bearer ${TEST_KEY}` },
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("retry-after")).toBe(String(result.poll_after_seconds));
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual(result);
    },
  );

  it("omits polling Retry-After from terminal READY and FAILED status responses", async () => {
    const openApiResponse = await createV1Api(dependencies()).request("/v1/openapi.json");
    const document = (await openApiResponse.json()) as {
      paths?: {
        "/v1/next-move"?: {
          post?: {
            responses?: {
              "200"?: { content?: { "application/json"?: { example?: unknown } } };
            };
          };
        };
      };
    };
    const ready = NextMoveReadyResponseSchema.parse(
      document.paths?.["/v1/next-move"]?.post?.responses?.["200"]?.content?.["application/json"]
        ?.example,
    );
    const failed = {
      id: "move_failed",
      status: "FAILED" as const,
      error: { code: "SCAN_FAILED", message: "The scan failed.", retryable: true },
    };

    for (const result of [ready, failed]) {
      const response = await createV1Api(
        dependencies({ getStatus: vi.fn(async () => result) }),
      ).request(`/v1/next-moves/${result.id}`, {
        headers: { authorization: `Bearer ${TEST_KEY}` },
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("retry-after")).toBeNull();
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual(result);
    }
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
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      error: { code: "RATE_LIMITED", message: "Create limit reached." },
    });
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
