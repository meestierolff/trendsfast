import { clearCheckoutClaimCookie } from "@trendsfast/billing";
import { loadEnv, resolveApiProviderCostLimitUsdPerHour } from "@trendsfast/config";

import { checkoutClaimIdentity } from "../../../../lib/checkout-claim";
import { configuredStripeBilling } from "../../../../lib/billing-service";
import { strictSameOrigin } from "../../../../lib/first-party-analytics";
import { getRepositories } from "../../../../lib/server-database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const responseHeaders = {
  "cache-control": "no-store, max-age=0",
  pragma: "no-cache",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
};

function json(body: Record<string, unknown>, status = 200, clearClaim = false) {
  const headers = new Headers(responseHeaders);
  if (clearClaim) headers.set("set-cookie", clearCheckoutClaimCookie());
  return Response.json(body, { status, headers });
}

export async function GET(request: Request) {
  if (!configuredStripeBilling().availability.checkoutAvailable) {
    return json({ error: "CHECKOUT_NOT_AVAILABLE" }, 503);
  }
  const identity = checkoutClaimIdentity(request);
  if (!identity) return json({ error: "CHECKOUT_CLAIM_INVALID" }, 404);
  const claim = await getRepositories().billing.checkoutClaimStatus(identity);
  if (!claim) return json({ error: "CHECKOUT_CLAIM_INVALID" }, 404);
  if (claim.claimConsumedAt || claim.issuedApiKeyId) {
    return json({ state: "KEY_ALREADY_ISSUED" }, 200, true);
  }
  if (!claim.entitlementActive) {
    return json({ state: "WAITING_FOR_WEBHOOK", pollAfterSeconds: 3 }, 202);
  }
  return json({ state: "READY_TO_ISSUE" });
}

export async function POST(request: Request) {
  const env = loadEnv();
  if (!configuredStripeBilling(env).availability.checkoutAvailable) {
    return json({ error: "CHECKOUT_NOT_AVAILABLE" }, 503);
  }
  if (!strictSameOrigin(request, env.APP_URL)) {
    return json({ error: "Checkout claim issuance requires a same-origin request." }, 403);
  }
  const identity = checkoutClaimIdentity(request);
  if (!identity) return json({ error: "CHECKOUT_CLAIM_INVALID" }, 404);
  const result = await getRepositories().billing.consumeCheckoutClaim({
    ...identity,
    environment: env.STRIPE_MODE === "live" ? "live" : "test",
    now: new Date(),
    rateLimitPerHour: env.API_CREATE_RATE_LIMIT_PER_HOUR,
    providerCostLimitUsd: resolveApiProviderCostLimitUsdPerHour(env),
  });
  switch (result.status) {
    case "INVALID":
      return json({ error: "CHECKOUT_CLAIM_INVALID" }, 404);
    case "WAITING":
      return json({ state: "WAITING_FOR_WEBHOOK", pollAfterSeconds: 3 }, 202);
    case "ALREADY_CONSUMED":
      return json(
        {
          state: "KEY_ALREADY_ISSUED",
          visiblePrefix: result.visiblePrefix,
          guidance: "The raw key cannot be recovered. Rotate it from authenticated operations.",
        },
        200,
        true,
      );
    case "ISSUED":
      return json(
        {
          state: "KEY_ISSUED",
          rawKey: result.rawKey,
          visiblePrefix: result.visiblePrefix,
          expiresAt: result.expiresAt?.toISOString() ?? null,
          secretShownOnce: true,
          guidance:
            "Copy this key now. TrendsFast stores only its secure hash and cannot recover it.",
        },
        201,
        true,
      );
  }
}
