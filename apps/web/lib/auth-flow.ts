import "server-only";

import { NextResponse } from "next/server";

import { consumePendingProjectClaim } from "./member-auth-service";
import {
  claimedProjectDestination,
  getVerifiedAuthIdentity,
  safeDashboardDestination,
} from "./auth-session";
import { siteOrigin } from "./site";

export const AUTH_RESPONSE_HEADERS = {
  "cache-control": "private, no-store, max-age=0",
  pragma: "no-cache",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-robots-tag": "noindex, nofollow, noarchive",
} as const;

export function authRedirect(path: string): NextResponse {
  const response = NextResponse.redirect(new URL(path, `${siteOrigin()}/`), 303);
  for (const [name, value] of Object.entries(AUTH_RESPONSE_HEADERS)) {
    response.headers.set(name, value);
  }
  return response;
}

export async function finishVerifiedAuth(next?: string | null): Promise<NextResponse> {
  const identity = await getVerifiedAuthIdentity();
  if (!identity) return authRedirect("/login?error=verification_failed");
  try {
    const claim = await consumePendingProjectClaim(identity);
    if (claim.status === "OWNERSHIP_CONFLICT") {
      return authRedirect("/login?error=project_already_owned");
    }
    if (claim.status === "CLAIMED" || claim.status === "ALREADY_OWNER") {
      return authRedirect(claimedProjectDestination(next ?? "/dashboard", claim.projectId));
    }
    if (
      claim.status === "EXPIRED" ||
      claim.status === "INVALIDATED" ||
      claim.status === "REPLAYED" ||
      claim.status === "NOT_FOUND" ||
      claim.status === "MALFORMED"
    ) {
      return authRedirect("/login?error=claim_invalid");
    }
    return authRedirect(safeDashboardDestination(next));
  } catch {
    // Keep the cookie when persistence is temporarily unavailable so a valid
    // claim can be retried within its short lifetime.
    return authRedirect("/login?error=claim_unavailable");
  }
}
