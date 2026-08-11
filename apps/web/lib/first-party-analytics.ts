import { createHmac, randomBytes } from "node:crypto";

import type { LaunchAnalyticsEventName } from "@trendsfast/schemas";
import { z } from "zod";

import { clientAddress } from "./request-security";

export const ANALYTICS_SESSION_COOKIE = "tf_analytics_session";
export const ANALYTICS_SESSION_MAX_AGE_SECONDS = 30 * 60;
export const ANALYTICS_BROWSER_BODY_MAX_BYTES = 512;

const PublicAnalyticsBodySchema = z.discriminatedUnion("event", [
  z.object({ event: z.literal("landing_viewed"), placement: z.literal("homepage") }).strict(),
  z
    .object({
      event: z.literal("hero_cta_clicked"),
      placement: z.enum(["homepage_hero", "homepage_repeat", "homepage_final", "agents"]),
    })
    .strict(),
  z.object({ event: z.literal("demo_viewed"), placement: z.literal("homepage_demo") }).strict(),
  z.object({ event: z.literal("agents_page_viewed"), placement: z.literal("agents") }).strict(),
  z.object({ event: z.literal("docs_viewed"), placement: z.literal("docs") }).strict(),
  z.object({ event: z.literal("pricing_viewed"), placement: z.literal("pricing") }).strict(),
]);

export type PublicAnalyticsBody = z.infer<typeof PublicAnalyticsBodySchema>;

export function parsePublicAnalyticsBody(value: unknown): PublicAnalyticsBody | null {
  const parsed = PublicAnalyticsBodySchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function strictSameOrigin(request: Request, expectedUrl: string): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin") return false;
  try {
    return new URL(origin).origin === new URL(expectedUrl).origin;
  } catch {
    return false;
  }
}

function contextKey(secret: string, context: string): Buffer {
  if (secret.length < 32) throw new Error("Privacy hashing is not configured");
  if (!/^[a-z0-9:-]{1,80}$/i.test(context)) throw new Error("Privacy hash context is invalid");
  return createHmac("sha256", secret).update(`trendsfast:${context}`).digest();
}

/** Context-separated stable HMAC. Callers must supply only server-observed or normalized input. */
export function derivePrivacyHash(secret: string, context: string, value: string): string {
  return createHmac("sha256", contextKey(secret, context)).update(value).digest("hex");
}

export function publicRequestFingerprint(headers: Headers, secret: string): string {
  const userAgent = (headers.get("user-agent") ?? "unknown").slice(0, 512);
  return derivePrivacyHash(
    secret,
    "public-request-admission:v1",
    `${clientAddress(headers)}\u0000${userAgent}`,
  );
}

function cookieValue(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [candidate, ...value] = part.trim().split("=");
    if (candidate !== name) continue;
    try {
      return decodeURIComponent(value.join("="));
    } catch {
      return null;
    }
  }
  return null;
}

function validSessionId(value: string | null | undefined): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{32,96}$/.test(value);
}

export type AnalyticsSessionIdentity = {
  anonymousSessionHash: string;
  rawSessionToSet?: string;
};

/**
 * Browser-beacon identity. The random value is HttpOnly and only its HMAC enters
 * the ledger; a new cookie is returned to the route when none is valid.
 */
export function analyticsSessionForRequest(
  request: Request,
  secret: string,
): AnalyticsSessionIdentity {
  const existing = cookieValue(request.headers.get("cookie"), ANALYTICS_SESSION_COOKIE);
  const rawSession = validSessionId(existing) ? existing : randomBytes(24).toString("base64url");
  return {
    anonymousSessionHash: derivePrivacyHash(secret, "analytics-session:v1", rawSession),
    ...(validSessionId(existing) ? {} : { rawSessionToSet: rawSession }),
  };
}

/**
 * Server-rendered capability pages cannot set cookies. When a first visit has no
 * analytics cookie, derive a daily HMAC session from server-observed request
 * metadata; no raw address, user agent, or capability token is persisted.
 */
export function analyticsSessionForServerPage(input: {
  headers: Headers;
  cookieSession?: string;
  secret: string;
  now?: Date;
}): AnalyticsSessionIdentity {
  if (validSessionId(input.cookieSession)) {
    return {
      anonymousSessionHash: derivePrivacyHash(
        input.secret,
        "analytics-session:v1",
        input.cookieSession,
      ),
    };
  }
  const now = input.now ?? new Date();
  const day = Math.floor(now.getTime() / (24 * 60 * 60 * 1_000));
  const requestFingerprint = publicRequestFingerprint(input.headers, input.secret);
  return {
    anonymousSessionHash: derivePrivacyHash(
      input.secret,
      "analytics-fallback-session:v1",
      `${requestFingerprint}:${day}`,
    ),
  };
}

export function analyticsSessionCookie(rawSession: string, secure: boolean): string {
  if (!validSessionId(rawSession)) throw new Error("Analytics session value is invalid");
  return [
    `${ANALYTICS_SESSION_COOKIE}=${encodeURIComponent(rawSession)}`,
    "Path=/",
    `Max-Age=${ANALYTICS_SESSION_MAX_AGE_SECONDS}`,
    "HttpOnly",
    "SameSite=Lax",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

export function analyticsDedupeKey(input: {
  secret: string;
  sessionHash: string;
  event: LaunchAnalyticsEventName;
  entityScope: string;
  now?: Date;
  windowMs: number;
}): string {
  if (!/^[a-f0-9]{64}$/.test(input.sessionHash)) {
    throw new Error("Analytics session hash is invalid");
  }
  if (!Number.isSafeInteger(input.windowMs) || input.windowMs < 60_000) {
    throw new Error("Analytics dedupe window is invalid");
  }
  if (!/^[A-Za-z0-9:_-]{1,240}$/.test(input.entityScope)) {
    throw new Error("Analytics entity scope is invalid");
  }
  const now = input.now ?? new Date();
  if (Number.isNaN(now.getTime())) throw new Error("Analytics event time is invalid");
  const window = Math.floor(now.getTime() / input.windowMs);
  return derivePrivacyHash(
    input.secret,
    "analytics-dedupe:v1",
    `${input.sessionHash}\u0000${input.event}\u0000${input.entityScope}\u0000${window}`,
  );
}

export type PublicAnalyticsAdmission = {
  admit(input: {
    fingerprintHash: string;
    namespace: string;
    now: Date;
    windowMs: number;
    maxAttemptsPerFingerprint: number;
    maxAttemptsGlobal: number;
    maxFingerprintBuckets: number;
  }): Promise<boolean>;
};

export type PublicAnalyticsWriter = {
  appendOnce(input: {
    name: PublicAnalyticsBody["event"];
    anonymousSessionHash: string;
    dedupeKey: string;
    properties: { placement: PublicAnalyticsBody["placement"] };
    occurredAt: Date;
  }): Promise<unknown>;
};

export async function recordPublicBrowserAnalytics(
  request: Request,
  body: PublicAnalyticsBody,
  dependencies: {
    secret: string;
    admission: PublicAnalyticsAdmission;
    analytics: PublicAnalyticsWriter;
    now?: Date;
  },
): Promise<{ recorded: boolean; rawSessionToSet?: string }> {
  const now = dependencies.now ?? new Date();
  const session = analyticsSessionForRequest(request, dependencies.secret);
  const admitted = await dependencies.admission.admit({
    namespace: "public-analytics-v1",
    fingerprintHash: publicRequestFingerprint(request.headers, dependencies.secret),
    now,
    windowMs: 60_000,
    maxAttemptsPerFingerprint: 60,
    maxAttemptsGlobal: 3_000,
    maxFingerprintBuckets: 10_000,
  });
  if (!admitted) {
    return {
      recorded: false,
      ...(session.rawSessionToSet ? { rawSessionToSet: session.rawSessionToSet } : {}),
    };
  }

  const dedupeKey = analyticsDedupeKey({
    secret: dependencies.secret,
    sessionHash: session.anonymousSessionHash,
    event: body.event,
    entityScope: `placement:${body.placement}`,
    now,
    windowMs: ANALYTICS_SESSION_MAX_AGE_SECONDS * 1_000,
  });
  await dependencies.analytics.appendOnce({
    name: body.event,
    anonymousSessionHash: session.anonymousSessionHash,
    dedupeKey,
    properties: { placement: body.placement },
    occurredAt: now,
  });
  return {
    recorded: true,
    ...(session.rawSessionToSet ? { rawSessionToSet: session.rawSessionToSet } : {}),
  };
}
