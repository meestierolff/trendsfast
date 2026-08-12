import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";

import { checkoutClaimHash, CHECKOUT_CLAIM_COOKIE } from "@trendsfast/billing";
import { loadEnv } from "@trendsfast/config";

import { BillingSuccessClient } from "../../../components/billing-success-client";
import { configuredStripeBilling } from "../../../lib/billing-service";
import { getRepositories } from "../../../lib/server-database";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Activate Founder monitoring",
  robots: "noindex, nofollow, noarchive",
  referrer: "no-referrer",
};

export default async function BillingSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string | string[] }>;
}) {
  const { session_id: value } = await searchParams;
  if (!configuredStripeBilling().availability.checkoutAvailable) notFound();
  const portalLoginUrl = loadEnv().STRIPE_PORTAL_LOGIN_URL;
  const sessionId = typeof value === "string" ? value : null;
  if (!sessionId || !/^cs_(?:test_|live_)?[A-Za-z0-9_]{8,255}$/.test(sessionId)) {
    notFound();
  }
  const rawClaim = (await cookies()).get(CHECKOUT_CLAIM_COOKIE)?.value;
  const claimHash = rawClaim ? checkoutClaimHash(rawClaim) : null;
  if (!claimHash) {
    return (
      <main className="section-pad legal-page">
        <p className="eyebrow">Founder monitoring</p>
        <h1>This activation link is no longer available.</h1>
        <p>
          The one-time claim cookie is missing or was cleared after use. This page does not infer
          payment. If an API key was revealed and lost, rotate it from authenticated founder
          operations; raw keys cannot be recovered.
        </p>
        {portalLoginUrl ? (
          <p>
            <a href={portalLoginUrl} rel="noreferrer noopener">
              Manage billing securely in Stripe
            </a>
          </p>
        ) : null}
      </main>
    );
  }
  const claim = await getRepositories().billing.checkoutClaimStatus({
    claimHash,
    stripeCheckoutSessionId: sessionId,
  });
  if (!claim) notFound();
  const initialState =
    claim.claimConsumedAt || claim.issuedApiKeyId
      ? "KEY_ALREADY_ISSUED"
      : claim.entitlementActive
        ? "READY_TO_ISSUE"
        : "WAITING_FOR_WEBHOOK";

  return (
    <main className="section-pad legal-page">
      <p className="eyebrow">Founder monitoring</p>
      <h1>Confirming your subscription.</h1>
      <p>
        This return page never grants access. TrendsFast waits for the signed subscription and
        current-period invoice webhooks to agree before monitoring or an API key becomes active.
      </p>
      <BillingSuccessClient sessionId={sessionId} initialState={initialState} />
      {portalLoginUrl ? (
        <p>
          <a href={portalLoginUrl} rel="noreferrer noopener">
            Manage billing securely in Stripe
          </a>
        </p>
      ) : null}
    </main>
  );
}
