import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { billingAvailability } from "@trendsfast/billing";
import { loadEnv } from "@trendsfast/config";
import { getReadyResultByToken } from "@/lib/scan-view-service";
import { deploymentProvenance } from "@/lib/deployment-provenance";
import { ScanResultView } from "../../../components/scan-result-view";

import "../scan.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Private Next Move",
  description: "A private, founder-reviewed TrendsFast Next Move with evidence receipts.",
  robots: "noindex, nofollow, noarchive",
  referrer: "no-referrer",
};

export default async function ScanResultPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const result = await getReadyResultByToken(token);

  if (!result) notFound();

  const env = loadEnv();
  const checkout = billingAvailability({
    billingEnabled: env.BILLING_ENABLED && env.BILLING_CHECKOUT_ENABLED,
    paidMonitoringEnabled: env.PAID_MONITORING_ENABLED,
    mode: env.STRIPE_MODE,
    providerCredentialMode: env.PROVIDER_CREDENTIAL_MODE,
    sandboxKeyRotated: env.STRIPE_SANDBOX_KEY_ROTATED === "YES",
    deploymentEnvironment: deploymentProvenance().deploymentEnvironment,
    liveEnablementApproved:
      env.I_UNDERSTAND_LIVE_STRIPE === "YES" && env.STRIPE_LIVE_ENABLEMENT_APPROVED === "YES",
  });

  return (
    <ScanResultView
      token={token}
      result={result}
      monitoringCheckoutAvailable={checkout.checkoutAvailable}
    />
  );
}
