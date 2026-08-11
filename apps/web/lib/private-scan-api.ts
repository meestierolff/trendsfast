import "server-only";

import { loadEnv } from "@trendsfast/config";

import { readBoundedFormBody, readBoundedJsonBody } from "./bounded-json";
import { anonymizeAddress, clientAddress } from "./request-security";
import { isSameOrigin } from "./public-scan-service";

export const PRIVATE_RESPONSE_HEADERS = {
  "cache-control": "private, no-store, max-age=0",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
} as const;

export function acceptsPrivateMutation(request: Request): boolean {
  return isSameOrigin(request, loadEnv().APP_URL);
}

export type SmallPrivateBodyResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; reason: "invalid_body" | "payload_too_large" };

export async function readSmallBody(request: Request): Promise<SmallPrivateBodyResult> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.includes("application/json")) {
    const parsed = await readBoundedJsonBody(request, 8_192);
    if (!parsed.ok) {
      return {
        ok: false,
        reason: parsed.reason === "payload_too_large" ? "payload_too_large" : "invalid_body",
      };
    }
    const value = parsed.value;
    return value && typeof value === "object" && !Array.isArray(value)
      ? { ok: true, value: value as Record<string, unknown> }
      : { ok: false, reason: "invalid_body" };
  }
  if (
    contentType.includes("application/x-www-form-urlencoded") ||
    contentType.includes("multipart/form-data")
  ) {
    const parsed = await readBoundedFormBody(request, 8_192);
    if (!parsed.ok) {
      return {
        ok: false,
        reason: parsed.reason === "payload_too_large" ? "payload_too_large" : "invalid_body",
      };
    }
    return { ok: true, value: parsed.value };
  }
  return { ok: false, reason: "invalid_body" };
}

export function privateVisitorFingerprint(request: Request): string | undefined {
  const env = loadEnv();
  const pepper = env.API_KEY_PEPPER ?? env.SESSION_SECRET;
  if (!pepper || pepper.length < 32) return undefined;
  return anonymizeAddress(clientAddress(request.headers), pepper);
}
