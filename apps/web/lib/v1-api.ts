import { Hono } from "hono";
import {
  ApiErrorSchema,
  NextMoveRequestSchema,
  NextMoveStatusResponseSchema,
  ProjectNextMoveRequestSchema,
  type NextMoveRequest,
  type NextMoveStatusResponse,
  type ProjectNextMoveRequest,
} from "@trendsfast/schemas";
import { z } from "zod";

import {
  apiAuthRequestFingerprint,
  apiKeyEnvironmentMatchesProviderMode,
  getApiAuthLimiter,
  parseStrictBearerApiKey,
  type InProcessInvalidApiKeyLimiter,
} from "./api-auth-guard";
import { readBoundedJsonBody, type BoundedJsonBodyResult } from "./bounded-json";

const API_JSON_BODY_LIMIT_BYTES = 32_768;

const OPENAPI_READY_EXAMPLE = {
  id: "scan_example",
  status: "READY",
  contract_version: "next-move-v1",
  generation_level: "brief",
  project: {
    name: "Example",
    url: "https://example.com",
    audience: "technical founders",
    problem: "Distribution research takes too long.",
    credible_topics: ["evidence-led distribution"],
    assumptions: ["Example only"],
  },
  next_move: {
    action: "WAIT",
    channel: "none",
    topic: "No opportunity clears the quality floor",
    angle: "Wait for an independent current source.",
    format: "none",
    hook: "Do not force a move from thin evidence.",
    outline: ["Keep the strongest query", "Recheck after corroboration"],
    cta: "Run a new scan when the watch condition changes.",
    priority: 0,
    confidence: 0.74,
    valid_until: "2026-08-14T10:00:00.000Z",
  },
  action_details: {
    action: "WAIT",
    considered_opportunity: "A thin single-source distribution topic",
    failure_reasons: ["DEPENDENT_EVIDENCE", "WEAK_EVIDENCE"],
    do_not_act_on: ["Do not describe the topic as a corroborated trend yet."],
    watch_conditions: ["Wait for an independent current source."],
    recheck_at: "2026-08-13T22:00:00.000Z",
  },
  trend_window: {
    state: "UNKNOWN",
    basis: "UNKNOWN",
    last_confirmed_at: "2026-08-13T09:00:00.000Z",
    valid_until: "2026-08-14T10:00:00.000Z",
    recheck_at: "2026-08-13T22:00:00.000Z",
    confidence: 0.35,
    explanation: "The stored evidence does not support a remaining-duration estimate.",
  },
  breakout_potential: {
    level: "unknown",
    basis: "INSUFFICIENT_DATA",
    factors: {
      audience_relevance: 0,
      timing: 0,
      novelty: 0,
      product_credibility: 0,
      format_fit: 0,
      saturation_risk: 0,
    },
    explanation: "Insufficient data for a categorical label; this is not a probability.",
  },
  freshness: {
    state: "CURRENT",
    evaluated_at: "2026-08-13T10:00:00.000Z",
    requires_new_scan: false,
  },
  why_now: {
    summary: "One source is relevant but not independently corroborated.",
    signal_class: "INSUFFICIENT_SIGNAL",
    independent_source_count: 1,
    saturation: "unknown",
  },
  evidence: [
    {
      source: "hacker_news",
      url: "https://news.ycombinator.com/item?id=44123123",
      title: "A current founder distribution discussion",
      published_at: "2026-08-13T09:00:00.000Z",
      observed_at: "2026-08-13T09:00:00.000Z",
      reason: "One relevant stored conversation is present, but no independent source confirms it.",
      provider: "hn_algolia",
      role: "DECISION_SUPPORT",
      verified: true,
      availability: "AVAILABLE",
    },
  ],
  limitations: ["One-source evidence cannot support a trend claim."],
  founder_reviewed: true,
  auto_publish: false,
} as const;

const OPENAPI_PROJECT_READY_EXAMPLE = {
  ...OPENAPI_READY_EXAMPLE,
  generation_level: "draft",
} as const;

export type ApiPrincipal = {
  apiKeyId: string;
  environment: "test" | "live";
  scopes: string[];
  projectId?: string;
  visiblePrefix?: string;
  rateLimitPerHour?: number;
  providerCostLimitUsd?: number;
  requestId?: string;
  requesterFingerprintHash?: string;
};

export type V1ApiDependencies = {
  providerCredentialMode: "fixture" | "managed" | "byok";
  liveApiCreationEnabled: boolean;
  authAttemptLimiter?: InProcessInvalidApiKeyLimiter;
  admitAuthenticationAttempt?(request: Request): Promise<boolean | "AUTH_FAILURE_LIMITED">;
  authenticate(
    rawKey: string,
    metadata?: {
      requestId: string;
      request: Request;
      requestKind: "CREATE" | "STATUS" | "OTHER";
    },
  ): Promise<ApiPrincipal | null>;
  recordAuthenticationFailure?(request: Request): Promise<boolean>;
  createOrReuse(input: {
    principal: ApiPrincipal;
    idempotencyKey: string;
    request: NextMoveRequest;
    projectContextVersionId?: string;
  }): Promise<NextMoveStatusResponse>;
  createOrReuseForProject(input: {
    principal: ApiPrincipal;
    projectId: string;
    idempotencyKey: string;
    request: ProjectNextMoveRequest;
  }): Promise<NextMoveStatusResponse>;
  getStatus(input: { principal: ApiPrincipal; id: string }): Promise<NextMoveStatusResponse | null>;
};

export class ApiServiceError extends Error {
  constructor(
    readonly code:
      | "RATE_LIMITED"
      | "COST_LIMITED"
      | "USAGE_LIMITED"
      | "FORBIDDEN"
      | "CONFLICT"
      | "INVALID_REQUEST"
      | "UNAVAILABLE",
    message: string,
    readonly status: 403 | 409 | 422 | 429 | 503 = code === "FORBIDDEN"
      ? 403
      : code === "CONFLICT"
        ? 409
        : code === "INVALID_REQUEST"
          ? 422
          : code === "UNAVAILABLE"
            ? 503
            : 429,
  ) {
    super(message);
  }
}

function isCreateRequest(method: string, path: string): boolean {
  return (
    method === "POST" &&
    (path === "/v1/next-move" || /^\/v1\/projects\/[^/]+\/next-move$/.test(path))
  );
}

function error(code: string, message: string, status: number) {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      ...(status === 429 ? { "retry-after": "3600" } : {}),
    },
  });
}

function applyPollingRetryAfter(response: Response, result: NextMoveStatusResponse): Response {
  if ("poll_after_seconds" in result) {
    response.headers.set("Retry-After", String(result.poll_after_seconds));
  }
  return response;
}

export function createV1Api(dependencies: V1ApiDependencies) {
  const app = new Hono<{
    Variables: { principal: ApiPrincipal; parsedJsonBody: BoundedJsonBodyResult };
  }>();

  app.get("/v1/openapi.json", (context) => {
    context.header("Cache-Control", "public, max-age=300");
    const apiErrorResponse = (description: string) => ({
      description,
      content: {
        "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
      },
    });
    const pollingResponseHeaders = {
      "Retry-After": {
        description:
          "Seconds to wait before polling again. Present only for QUEUED, RUNNING, and REVIEW_REQUIRED responses and equal to poll_after_seconds in the response body.",
        schema: { type: "integer", const: 30, example: 30 },
      },
    };
    return context.json({
      openapi: "3.1.0",
      info: {
        title: "TrendsFast Next Move API",
        version: "0.1.0-alpha.0",
        description:
          "Create a bounded distribution scan and retrieve exactly one founder-reviewed PUBLISH, REPLY, REMIX, or WAIT decision.",
      },
      servers: [{ url: "/" }],
      components: {
        securitySchemes: {
          bearerApiKey: { type: "http", scheme: "bearer", bearerFormat: "TrendsFast API key" },
        },
        schemas: {
          NextMoveRequest: z.toJSONSchema(NextMoveRequestSchema, { io: "input" }),
          ProjectNextMoveRequest: z.toJSONSchema(ProjectNextMoveRequestSchema, { io: "input" }),
          NextMoveStatus: z.toJSONSchema(NextMoveStatusResponseSchema),
          ApiError: z.toJSONSchema(ApiErrorSchema),
        },
      },
      paths: {
        "/v1/next-move": {
          post: {
            summary: "Create or reuse a bounded Next Move scan",
            security: [{ bearerApiKey: [] }],
            parameters: [
              {
                name: "Idempotency-Key",
                in: "header",
                required: true,
                schema: { type: "string", format: "uuid" },
              },
            ],
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/NextMoveRequest" },
                  example: {
                    product_url: "https://example.com",
                    objective: "Grow among technical founders",
                    preferred_channels: ["x", "linkedin"],
                    content_capabilities: ["founder_text", "screen_recording"],
                    generation_level: "brief",
                  },
                },
              },
            },
            responses: {
              "200": {
                description: "A fresh founder-reviewed result is ready",
                content: {
                  "application/json": {
                    schema: { $ref: "#/components/schemas/NextMoveStatus" },
                    example: OPENAPI_READY_EXAMPLE,
                  },
                },
              },
              "202": {
                description: "Bounded work is queued, running, or awaiting review",
                headers: pollingResponseHeaders,
                content: {
                  "application/json": { schema: { $ref: "#/components/schemas/NextMoveStatus" } },
                },
              },
              "400": apiErrorResponse("The Idempotency-Key header is missing or invalid"),
              "401": apiErrorResponse("The bearer API key is missing, invalid, or revoked"),
              "403": apiErrorResponse("The key lacks write scope or cannot access the project"),
              "409": apiErrorResponse(
                "The idempotency key was already used for a different request",
              ),
              "413": apiErrorResponse("The request body exceeds the bounded API limit"),
              "422": apiErrorResponse(
                "The JSON body does not match the Next Move request contract",
              ),
              "429": apiErrorResponse(
                "The key's request, provider-cost, or Founder usage limit was reached",
              ),
              "500": apiErrorResponse("The request failed without exposing internal details"),
              "503": apiErrorResponse("Provider work or its private operating policy is disabled"),
            },
          },
        },
        "/v1/projects/{project_id}/next-move": {
          post: {
            summary: "Create or reuse a Next Move scan for a claimed project",
            description:
              "The live API key must be restricted to this project and include next_move:write plus next_move:read. TrendsFast loads the saved project URL, confirmed context, and capability ceiling server-side and produces draft-level output.",
            security: [{ bearerApiKey: [] }],
            parameters: [
              {
                name: "project_id",
                in: "path",
                required: true,
                schema: { type: "string", format: "uuid" },
              },
              {
                name: "Idempotency-Key",
                in: "header",
                required: true,
                schema: { type: "string", format: "uuid" },
              },
            ],
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ProjectNextMoveRequest" },
                  example: {
                    objective: "Grow among technical founders",
                    preferred_channels: ["x", "linkedin"],
                    content_capabilities: ["founder_text", "screen_recording"],
                    generation_level: "draft",
                  },
                },
              },
            },
            responses: {
              "200": {
                description: "A fresh founder-reviewed result is ready",
                content: {
                  "application/json": {
                    schema: { $ref: "#/components/schemas/NextMoveStatus" },
                    example: OPENAPI_PROJECT_READY_EXAMPLE,
                  },
                },
              },
              "202": {
                description: "Bounded work is queued, running, or awaiting review",
                headers: pollingResponseHeaders,
                content: {
                  "application/json": { schema: { $ref: "#/components/schemas/NextMoveStatus" } },
                },
              },
              "400": apiErrorResponse("The project ID or Idempotency-Key is invalid"),
              "401": apiErrorResponse("The bearer API key is missing, invalid, or revoked"),
              "403": apiErrorResponse(
                "The key lacks write scope or is not restricted to this claimed project",
              ),
              "409": apiErrorResponse(
                "The idempotency key was reused for different input or the saved profile is unavailable",
              ),
              "413": apiErrorResponse("The request body exceeds the bounded API limit"),
              "422": apiErrorResponse(
                "The JSON body is invalid or requests a capability not enabled in the saved project profile",
              ),
              "429": apiErrorResponse(
                "The key's request, provider-cost, or Founder usage limit was reached",
              ),
              "500": apiErrorResponse("The request failed without exposing internal details"),
              "503": apiErrorResponse("Provider work or its private operating policy is disabled"),
            },
          },
        },
        "/v1/next-moves/{id}": {
          get: {
            summary: "Get the private state or founder-reviewed result",
            security: [{ bearerApiKey: [] }],
            parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
            responses: {
              "200": {
                description: "Current state",
                headers: pollingResponseHeaders,
                content: {
                  "application/json": {
                    schema: { $ref: "#/components/schemas/NextMoveStatus" },
                    example: OPENAPI_READY_EXAMPLE,
                  },
                },
              },
              "404": {
                description: "The ID is not visible to this key",
                content: {
                  "application/json": { schema: { $ref: "#/components/schemas/ApiError" } },
                },
              },
              "401": apiErrorResponse("The bearer API key is missing, invalid, or revoked"),
              "403": apiErrorResponse("The key lacks read scope"),
              "429": apiErrorResponse("The authentication or API-key request limit was reached"),
              "500": apiErrorResponse("The request failed without exposing internal details"),
            },
          },
        },
      },
    });
  });

  app.use("/v1/*", async (context, next) => {
    context.header("Cache-Control", "no-store");
    context.header("X-Content-Type-Options", "nosniff");
    const requestId = crypto.randomUUID();
    context.header("X-Request-Id", requestId);
    if (
      isCreateRequest(context.req.method, context.req.path) &&
      !dependencies.liveApiCreationEnabled
    ) {
      return context.json(
        {
          error: {
            code: "UNAVAILABLE",
            message: "New API research is temporarily unavailable.",
          },
        },
        503,
      );
    }
    if (context.req.method === "POST") {
      const parsedJsonBody = await readBoundedJsonBody(context.req.raw, API_JSON_BODY_LIMIT_BYTES);
      if (!parsedJsonBody.ok && parsedJsonBody.reason === "payload_too_large") {
        return context.json(
          { error: { code: "PAYLOAD_TOO_LARGE", message: "The request body is too large." } },
          413,
        );
      }
      context.set("parsedJsonBody", parsedJsonBody);
    }
    const rawKey = parseStrictBearerApiKey(context.req.header("authorization"));
    if (!rawKey)
      return context.json(
        { error: { code: "UNAUTHORIZED", message: "A bearer API key is required." } },
        401,
      );
    const reservation = (dependencies.authAttemptLimiter ?? getApiAuthLimiter()).reserve(
      apiAuthRequestFingerprint(context.req.raw),
    );
    if (!reservation) {
      context.header("Retry-After", "60");
      return context.json(
        {
          error: {
            code: "RATE_LIMITED",
            message: "Too many invalid API key attempts. Try again later.",
          },
        },
        429,
      );
    }
    const durableAdmission = dependencies.admitAuthenticationAttempt
      ? await dependencies.admitAuthenticationAttempt(context.req.raw)
      : true;
    if (durableAdmission !== true) {
      reservation.release();
      const authFailureLimited = durableAdmission === "AUTH_FAILURE_LIMITED";
      context.header("Retry-After", authFailureLimited ? "3600" : "60");
      return context.json(
        {
          error: {
            code: "RATE_LIMITED",
            message: authFailureLimited
              ? "Too many failed authentication attempts. Try again later."
              : "Too many authentication attempts. Try again later.",
          },
        },
        429,
      );
    }
    let principal: ApiPrincipal | null;
    try {
      const requestKind = isCreateRequest(context.req.method, context.req.path)
        ? "CREATE"
        : context.req.method === "GET" && context.req.path.startsWith("/v1/next-moves/")
          ? "STATUS"
          : "OTHER";
      principal = await dependencies.authenticate(rawKey, {
        requestId,
        request: context.req.raw,
        requestKind,
      });
    } catch (caught) {
      reservation.release();
      throw caught;
    }
    if (!principal) {
      reservation.markInvalid();
      if (
        dependencies.recordAuthenticationFailure &&
        !(await dependencies.recordAuthenticationFailure(context.req.raw))
      ) {
        context.header("Retry-After", "3600");
        return context.json(
          {
            error: {
              code: "RATE_LIMITED",
              message: "Too many failed authentication attempts. Try again later.",
            },
          },
          429,
        );
      }
      return context.json(
        { error: { code: "UNAUTHORIZED", message: "The API key is invalid or revoked." } },
        401,
      );
    }
    if (
      !apiKeyEnvironmentMatchesProviderMode(
        principal.environment,
        dependencies.providerCredentialMode,
      )
    ) {
      reservation.markInvalid();
      return context.json(
        {
          error: {
            code: "FORBIDDEN",
            message: "This API key cannot be used with the active processing policy.",
          },
        },
        403,
      );
    }
    reservation.release();
    context.set("principal", principal);
    await next();
  });

  app.post("/v1/next-move", async (context) => {
    const principal = context.get("principal");
    if (!principal.scopes.includes("next_move:write"))
      return error("FORBIDDEN", "The API key does not have write scope.", 403);
    const idempotencyKey = context.req.header("idempotency-key");
    if (!idempotencyKey)
      return error("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key is required.", 400);
    if (!z.string().uuid().safeParse(idempotencyKey).success)
      return error("INVALID_IDEMPOTENCY_KEY", "Idempotency-Key must be a UUID.", 400);
    const raw = context.get("parsedJsonBody");
    const parsed = NextMoveRequestSchema.safeParse(raw.ok ? raw.value : undefined);
    if (!parsed.success)
      return error(
        "INVALID_REQUEST",
        "The request body does not match the Next Move contract.",
        422,
      );
    try {
      const result = await dependencies.createOrReuse({
        principal,
        idempotencyKey,
        request: parsed.data,
      });
      const status = result.status === "READY" ? 200 : result.status === "FAILED" ? 200 : 202;
      const response = context.json(result, status);
      if ("status_url" in result) response.headers.set("Location", result.status_url);
      return applyPollingRetryAfter(response, result);
    } catch (caught) {
      if (caught instanceof ApiServiceError)
        return error(caught.code, caught.message, caught.status);
      throw caught;
    }
  });

  app.post("/v1/projects/:projectId/next-move", async (context) => {
    const principal = context.get("principal");
    if (!principal.scopes.includes("next_move:write"))
      return error("FORBIDDEN", "The API key does not have write scope.", 403);
    if (!principal.scopes.includes("next_move:read"))
      return error(
        "FORBIDDEN",
        "The project workflow requires both next_move:write and next_move:read scopes.",
        403,
      );
    const projectId = context.req.param("projectId");
    if (!z.string().uuid().safeParse(projectId).success)
      return error("INVALID_PROJECT_ID", "The project ID must be a UUID.", 400);
    if (!principal.projectId || principal.projectId !== projectId) {
      return error("FORBIDDEN", "The API key is not restricted to this claimed project.", 403);
    }
    const idempotencyKey = context.req.header("idempotency-key");
    if (!idempotencyKey)
      return error("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key is required.", 400);
    if (!z.string().uuid().safeParse(idempotencyKey).success)
      return error("INVALID_IDEMPOTENCY_KEY", "Idempotency-Key must be a UUID.", 400);
    const raw = context.get("parsedJsonBody");
    const parsed = ProjectNextMoveRequestSchema.safeParse(raw.ok ? raw.value : undefined);
    if (!parsed.success) {
      return error(
        "INVALID_REQUEST",
        "The request body does not match the claimed-project Next Move contract.",
        422,
      );
    }
    try {
      const result = await dependencies.createOrReuseForProject({
        principal,
        projectId,
        idempotencyKey,
        request: parsed.data,
      });
      const status = result.status === "READY" || result.status === "FAILED" ? 200 : 202;
      const response = context.json(result, status);
      if ("status_url" in result) response.headers.set("Location", result.status_url);
      return applyPollingRetryAfter(response, result);
    } catch (caught) {
      if (caught instanceof ApiServiceError)
        return error(caught.code, caught.message, caught.status);
      throw caught;
    }
  });

  app.get("/v1/next-moves/:id", async (context) => {
    const principal = context.get("principal");
    if (!principal.scopes.includes("next_move:read"))
      return error("FORBIDDEN", "The API key does not have read scope.", 403);
    const result = await dependencies.getStatus({ principal, id: context.req.param("id") });
    if (!result) return error("NOT_FOUND", "No Next Move was found for this key.", 404);
    return applyPollingRetryAfter(context.json(result, 200), result);
  });

  app.notFound(() => error("NOT_FOUND", "No API route exists at this path.", 404));
  app.onError((caught) =>
    caught instanceof ApiServiceError
      ? error(caught.code, caught.message, caught.status)
      : error("INTERNAL_ERROR", "The request could not be completed.", 500),
  );
  return app;
}
