import { NextResponse } from "next/server";

import { AUTH_RESPONSE_HEADERS } from "@/lib/auth-flow";
import {
  claimedProjectDestination,
  getVerifiedAuthIdentity,
  safeDashboardDestination,
} from "@/lib/auth-session";
import { readBoundedFormBody } from "@/lib/bounded-json";
import { consumeProjectClaimHash, createProjectClaimForDelivery } from "@/lib/member-auth-service";
import { acceptsPrivateMutation } from "@/lib/private-scan-api";
import {
  clearProjectClaimCookie,
  PROJECT_CLAIM_COOKIE,
  PROJECT_CLAIM_TTL_SECONDS,
  issueProjectClaimSecret,
  projectClaimCookieOptions,
} from "@/lib/project-claim-cookie";
import { resolveReadyScanIdentity } from "@/lib/scan-view-service";
import { siteOrigin } from "@/lib/site";

export const runtime = "nodejs";

const destinations = {
  save: "/dashboard/today",
  monitor: "/dashboard/billing",
  agent: "/dashboard/agents",
} as const;

function privateRedirect(path: string) {
  const response = NextResponse.redirect(new URL(path, `${siteOrigin()}/`), 303);
  for (const [name, value] of Object.entries(AUTH_RESPONSE_HEADERS)) {
    response.headers.set(name, value);
  }
  return response;
}

function consumedClaimRedirect(path: string) {
  const response = privateRedirect(path);
  clearProjectClaimCookie(response);
  return response;
}

export async function POST(request: Request) {
  if (!acceptsPrivateMutation(request)) return privateRedirect("/login?error=request_rejected");
  const body = await readBoundedFormBody(request, 4_096);
  const deliveryToken =
    body.ok && typeof body.value.deliveryToken === "string" ? body.value.deliveryToken : "";
  const intent = body.ok && typeof body.value.intent === "string" ? body.value.intent : "save";
  if (!/^[A-Za-z0-9_.-]{8,200}$/.test(deliveryToken)) {
    return privateRedirect("/login?error=claim_invalid");
  }
  const destination = safeDashboardDestination(
    destinations[intent as keyof typeof destinations] ?? destinations.save,
  );

  const identity = await resolveReadyScanIdentity(deliveryToken);
  if (!identity) return privateRedirect("/login?error=claim_invalid");
  const now = new Date();
  const expiresAt = new Date(
    Math.min(
      identity.deliveryExpiresAt.getTime(),
      now.getTime() + PROJECT_CLAIM_TTL_SECONDS * 1_000,
    ),
  );
  if (expiresAt <= now) return privateRedirect("/login?error=claim_invalid");
  const secret = issueProjectClaimSecret();

  try {
    await createProjectClaimForDelivery({
      deliveryTokenId: identity.deliveryTokenId,
      projectId: identity.projectId,
      claimHash: secret.claimHash,
      expiresAt,
      now,
    });
  } catch {
    return privateRedirect("/login?error=claim_unavailable");
  }

  const authIdentity = await getVerifiedAuthIdentity().catch(() => null);
  if (authIdentity) {
    try {
      const consumed = await consumeProjectClaimHash(secret.claimHash, authIdentity);
      if (consumed.status === "CLAIMED" || consumed.status === "ALREADY_OWNER") {
        return consumedClaimRedirect(claimedProjectDestination(destination, consumed.projectId));
      }
      if (consumed.status === "OWNERSHIP_CONFLICT") {
        return consumedClaimRedirect("/login?error=project_already_owned");
      }
      return consumedClaimRedirect("/login?error=claim_invalid");
    } catch {
      // Fall through to the short-lived cookie so the valid claim can be
      // retried after session refresh or a transient persistence failure.
    }
  }

  const response = privateRedirect(`/login?next=${encodeURIComponent(destination)}`);
  response.cookies.set(PROJECT_CLAIM_COOKIE, secret.rawClaim, {
    ...projectClaimCookieOptions(),
    expires: expiresAt,
    maxAge: Math.max(1, Math.floor((expiresAt.getTime() - now.getTime()) / 1_000)),
  });
  return response;
}
