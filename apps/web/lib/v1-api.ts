import { Hono } from "hono";
import {
  ApiErrorSchema,
  NextMoveRequestSchema,
  NextMoveStatusResponseSchema,
  type NextMoveStatusResponse,
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
  authAttemptLimiter?: InProcessInvalidApiKeyLimiter;
  admitAuthenticationAttempt?(request: Request): Promise<boolean>;
  authenticate(
    rawKey: string,
    metadata?: { requestId: string; request: Request },
  ): Promise<ApiPrincipal | null>;
  createOrReuse(input: {
    principal: ApiPrincipal;
    idempotencyKey: string;
    request: z.infer<typeof NextMoveRequestSchema>;
  }): Promise<NextMoveStatusResponse>;
  getStatus(input: { principal: ApiPrincipal; id: string }): Promise<NextMoveStatusResponse | null>;
};

export class ApiServiceError extends Error {
  constructor(
    readonly code: "RATE_LIMITED" | "COST_LIMITED" | "USAGE_LIMITED" | "FORBIDDEN" | "CONFLICT",
    message: string,
    readonly status: 403 | 409 | 429 = code === "FORBIDDEN" ? 403 : code === "CONFLICT" ? 409 : 429,
  ) {
    super(message);
  }
}

function error(code: string, message: string, status: number) {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
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
          NextMoveRequest: z.toJSONSchema(NextMoveRequestSchema),
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
                "application/json": { schema: { $ref: "#/components/schemas/NextMoveRequest" } },
              },
            },
            responses: {
              "200": {
                description: "A fresh founder-reviewed result is ready",
                content: {
                  "application/json": { schema: { $ref: "#/components/schemas/NextMoveStatus" } },
                },
              },
              "202": {
                description: "Bounded work is queued, running, or awaiting review",
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
                content: {
                  "application/json": { schema: { $ref: "#/components/schemas/NextMoveStatus" } },
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
    if (
      dependencies.admitAuthenticationAttempt &&
      !(await dependencies.admitAuthenticationAttempt(context.req.raw))
    ) {
      reservation.release();
      context.header("Retry-After", "60");
      return context.json(
        {
          error: {
            code: "RATE_LIMITED",
            message: "Too many authentication attempts. Try again later.",
          },
        },
        429,
      );
    }
    let principal: ApiPrincipal | null;
    try {
      principal = await dependencies.authenticate(rawKey, {
        requestId,
        request: context.req.raw,
      });
    } catch (caught) {
      reservation.release();
      throw caught;
    }
    if (!principal) {
      reservation.markInvalid();
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
      return response;
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
    return context.json(result, 200);
  });

  app.notFound(() => error("NOT_FOUND", "No API route exists at this path.", 404));
  app.onError((caught) =>
    caught instanceof ApiServiceError
      ? error(caught.code, caught.message, caught.status)
      : error("INTERNAL_ERROR", "The request could not be completed.", 500),
  );
  return app;
}
