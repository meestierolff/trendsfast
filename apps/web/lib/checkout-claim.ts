import "server-only";

import { checkoutClaimHash, readCheckoutClaimCookie } from "@trendsfast/billing";

export function checkoutClaimIdentity(request: Request): {
  claimHash: string;
  stripeCheckoutSessionId: string;
} | null {
  const rawClaim = readCheckoutClaimCookie(request.headers.get("cookie"));
  const claimHash = rawClaim ? checkoutClaimHash(rawClaim) : null;
  let sessionId: string | null = null;
  try {
    sessionId = new URL(request.url).searchParams.get("session_id");
  } catch {
    return null;
  }
  if (!claimHash || !sessionId || !/^cs_(?:test_|live_)?[A-Za-z0-9_]{8,255}$/.test(sessionId)) {
    return null;
  }
  return { claimHash, stripeCheckoutSessionId: sessionId };
}
