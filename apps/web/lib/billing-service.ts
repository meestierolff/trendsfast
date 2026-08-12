import "server-only";

import { createHash } from "node:crypto";

import { createStripeBilling, normalizeStripeEvent } from "@trendsfast/billing";
import { loadEnv, type Environment } from "@trendsfast/config";

import { getRepositories } from "./server-database";
import { deploymentProvenance } from "./deployment-provenance";

export class StripeWebhookVerificationError extends Error {
  constructor() {
    super("The Stripe webhook signature could not be verified");
    this.name = "StripeWebhookVerificationError";
  }
}

export function configuredStripeBilling(env: Environment = loadEnv()) {
  const deployment = deploymentProvenance();
  return createStripeBilling({
    billingEnabled: env.BILLING_ENABLED,
    paidMonitoringEnabled: env.PAID_MONITORING_ENABLED,
    mode: env.STRIPE_MODE,
    providerCredentialMode: env.PROVIDER_CREDENTIAL_MODE,
    ...(env.STRIPE_SECRET_KEY ? { secretKey: env.STRIPE_SECRET_KEY } : {}),
    ...(env.STRIPE_WEBHOOK_SECRET ? { webhookSecret: env.STRIPE_WEBHOOK_SECRET } : {}),
    ...(env.STRIPE_FOUNDER_CLOUD_PRICE_ID
      ? { founderCloudPriceId: env.STRIPE_FOUNDER_CLOUD_PRICE_ID }
      : {}),
    liveEnablementApproved:
      env.I_UNDERSTAND_LIVE_STRIPE === "YES" && env.STRIPE_LIVE_ENABLEMENT_APPROVED === "YES",
    deploymentEnvironment: deployment.deploymentEnvironment,
    appUrl: env.APP_URL,
  });
}

export async function projectStripeWebhook(input: { rawBody: Uint8Array; signature: string }) {
  const env = loadEnv();
  const deployment = deploymentProvenance();
  const billing = configuredStripeBilling(env);
  if (
    (deployment.deploymentEnvironment === "production" && env.STRIPE_MODE !== "live") ||
    (deployment.deploymentEnvironment !== "production" && env.STRIPE_MODE === "live") ||
    (env.STRIPE_MODE === "test" && env.PROVIDER_CREDENTIAL_MODE !== "fixture") ||
    (env.STRIPE_MODE === "live" && env.PROVIDER_CREDENTIAL_MODE === "fixture")
  ) {
    throw new StripeWebhookVerificationError();
  }
  const body = Buffer.from(input.rawBody);
  let stripeEvent: unknown;
  try {
    stripeEvent = billing.parseWebhook(body, input.signature);
  } catch {
    throw new StripeWebhookVerificationError();
  }
  const event = normalizeStripeEvent(stripeEvent);
  if (!event) return { status: "IGNORED" as const, reason: "UNSUPPORTED_OR_INVALID_EVENT" };
  const payloadHash = `sha256:${createHash("sha256").update(body).digest("hex")}`;
  const repositories = getRepositories();
  return repositories.billing.projectWebhook({
    event,
    payloadHash,
    expectedLivemode: env.STRIPE_MODE === "live",
    expectedPriceId: env.STRIPE_FOUNDER_CLOUD_PRICE_ID ?? "",
  });
}
