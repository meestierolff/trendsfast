import type { Metadata } from "next";

import { loadEnv } from "@trendsfast/config";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Manage Founder billing",
  robots: "noindex, nofollow, noarchive",
  referrer: "no-referrer",
};

export default function BillingManagePage() {
  const portalLoginUrl = loadEnv().STRIPE_PORTAL_LOGIN_URL;
  return (
    <main className="section-pad legal-page">
      <p className="eyebrow">Founder billing</p>
      <h1>Manage your subscription in Stripe.</h1>
      {portalLoginUrl ? (
        <>
          <p>
            Stripe verifies the billing identity by e-mail and provides payment-method updates,
            invoice history, subscription status, and cancellation in its hosted Customer Portal.
          </p>
          <p>
            <a href={portalLoginUrl} rel="noreferrer noopener">
              Continue to Stripe Customer Portal
            </a>
          </p>
        </>
      ) : (
        <p>
          The hosted Customer Portal is not enabled. No customer identifier can be submitted here.
        </p>
      )}
    </main>
  );
}
