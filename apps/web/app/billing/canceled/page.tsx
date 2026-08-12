import type { Metadata } from "next";

import { BillingCanceledReturn } from "../../../components/billing-canceled-return";

export const metadata: Metadata = {
  title: "Checkout canceled",
  robots: "noindex, nofollow, noarchive",
  referrer: "no-referrer",
};

export default function BillingCanceledPage() {
  return (
    <main className="section-pad legal-page">
      <p className="eyebrow">Checkout canceled</p>
      <h1>No subscription was activated.</h1>
      <p>
        TrendsFast does not infer payment from redirects. Return to the private result already in
        this browser’s history if you want to review it or try again.
      </p>
      <BillingCanceledReturn />
    </main>
  );
}
