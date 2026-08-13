import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { siteOrigin } from "./site";

export const MAGIC_AUTH_FLOW_PARAM = "tf_auth_flow";
export const SUPABASE_PKCE_FLOW_PARAM = "sb_flow_id";
export const MAGIC_AUTH_FLOW_TTL_SECONDS = 15 * 60;

const CORRELATION = /^[0-9a-f]{64}$/;
const SECRET = /^[A-Za-z0-9_-]{43}$/;
const SUPABASE_FLOW_ID = /^[A-Za-z0-9_-]{8,64}$/;

function digest(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

export function magicAuthFlowCookieName(correlation: string): string | null {
  return CORRELATION.test(correlation) ? `tf_magic_flow_${correlation}` : null;
}

export function issueMagicAuthFlow(): { secret: string; correlation: string; cookieName: string } {
  const secret = randomBytes(32).toString("base64url");
  const correlation = digest(secret);
  return { secret, correlation, cookieName: magicAuthFlowCookieName(correlation)! };
}

export function magicAuthFlowCookieOptions(production = process.env.NODE_ENV === "production") {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: production || siteOrigin().startsWith("https://"),
    path: "/auth/confirm",
    maxAge: MAGIC_AUTH_FLOW_TTL_SECONDS,
  };
}

function requestCookie(request: Request, name: string): string | null {
  for (const pair of (request.headers.get("cookie") ?? "").split(";")) {
    const separator = pair.indexOf("=");
    if (separator < 1 || pair.slice(0, separator).trim() !== name) continue;
    return pair.slice(separator + 1).trim();
  }
  return null;
}

export function hasValidMagicAuthFlow(request: Request, correlation: string): boolean {
  const name = magicAuthFlowCookieName(correlation);
  if (!name) return false;
  const secret = requestCookie(request, name);
  if (!secret || !SECRET.test(secret)) return false;
  const actual = Buffer.from(digest(secret), "hex");
  const expected = Buffer.from(correlation, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function validSupabasePkceFlowId(value: string | null): value is string {
  return typeof value === "string" && SUPABASE_FLOW_ID.test(value);
}

export function clearMagicAuthFlowCookie(
  response: {
    cookies: {
      set: (
        name: string,
        value: string,
        options: ReturnType<typeof magicAuthFlowCookieOptions>,
      ) => unknown;
    };
  },
  correlation: string,
): void {
  const name = magicAuthFlowCookieName(correlation);
  if (!name) return;
  response.cookies.set(name, "", { ...magicAuthFlowCookieOptions(), maxAge: 0 });
}
