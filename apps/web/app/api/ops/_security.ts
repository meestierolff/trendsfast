import { deploymentSurface } from "@trendsfast/config";

import { verifyCsrfToken, verifyOpsSession } from "../../../lib/ops-session";

export type OpsActionAuthorization =
  | { ok: true; reviewerId: string; sessionToken: string }
  | { ok: false; status: 401 | 403 | 503; error: string };

export type OpsReadAuthorization =
  { ok: true; reviewerId: string } | { ok: false; status: 401 | 403 | 503; error: string };

function cookieValue(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [cookieName, ...valueParts] = part.trim().split("=");
    if (cookieName !== name) continue;
    try {
      return decodeURIComponent(valueParts.join("="));
    } catch {
      return null;
    }
  }
  return null;
}

export function isOpsSameOrigin(request: Request, expectedUrl?: string): boolean {
  if (deploymentSurface() !== "ops") return false;

  const origin = request.headers.get("origin");
  if (!origin) return false;
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin") return false;

  try {
    const expectedOrigin = new URL(expectedUrl ?? process.env.APP_URL ?? request.url).origin;
    return new URL(origin).origin === expectedOrigin;
  } catch {
    return false;
  }
}

export function authorizeOpsActionRequest(
  request: Request,
  options: { secret?: string; expectedUrl?: string; now?: Date } = {},
): OpsActionAuthorization {
  if (deploymentSurface() !== "ops") {
    return { ok: false, status: 403, error: "Operations access is unavailable." };
  }
  if (!isOpsSameOrigin(request, options.expectedUrl)) {
    return { ok: false, status: 403, error: "Cross-site operations actions are not accepted." };
  }

  const secret = options.secret ?? process.env.SESSION_SECRET ?? "";
  if (secret.length < 32) {
    return { ok: false, status: 503, error: "Operations access is not configured." };
  }

  const sessionToken = cookieValue(request.headers.get("cookie"), "tf_ops_session");
  const session = verifyOpsSession(sessionToken ?? undefined, {
    secret,
    ...(options.now ? { now: options.now } : {}),
  });
  if (!session || !sessionToken) {
    return { ok: false, status: 401, error: "A valid operations session is required." };
  }

  if (!verifyCsrfToken(sessionToken, request.headers.get("x-csrf-token") ?? undefined, secret)) {
    return { ok: false, status: 403, error: "The operations action token is invalid." };
  }

  return {
    ok: true,
    reviewerId: `founder:${session.nonce.slice(0, 12)}`,
    sessionToken,
  };
}

/** Safe GET authorization: signed founder session, with cross-site fetches denied. */
export function authorizeOpsReadRequest(
  request: Request,
  options: { secret?: string; now?: Date } = {},
): OpsReadAuthorization {
  if (deploymentSurface() !== "ops") {
    return { ok: false, status: 403, error: "Operations access is unavailable." };
  }
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    return { ok: false, status: 403, error: "Cross-site operations reads are not accepted." };
  }
  const secret = options.secret ?? process.env.SESSION_SECRET ?? "";
  if (secret.length < 32) {
    return { ok: false, status: 503, error: "Operations access is not configured." };
  }
  const session = verifyOpsSession(
    cookieValue(request.headers.get("cookie"), "tf_ops_session") ?? undefined,
    { secret, ...(options.now ? { now: options.now } : {}) },
  );
  if (!session) {
    return { ok: false, status: 401, error: "A valid operations session is required." };
  }
  return { ok: true, reviewerId: `founder:${session.nonce.slice(0, 12)}` };
}
