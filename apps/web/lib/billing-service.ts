import "server-only";

import { createHash } from "node:crypto";

import { createStripeBilling, normalizeStripeEvent } from "@trendsfast/billing";
import { loadEnv, type Environment } from "@trendsfast/config";

import { getRepositories } from "./server-database";
import { derivePrivacyHash } from "./first-party-analytics";

export class StripeWebhookVerificationError extends Error {
  constructor() {
    super("The Stripe webhook signature could not be verified");
    this.name = "StripeWebhookVerificationError";
  }
}

export function configuredStripeBilling(env: Environment = loadEnv()) {
  return createStripeBilling({
    billingEnabled: env.BILLING_ENABLED,
    paidMonitoringEnabled: env.PAID_MONITORING_ENABLED,
    mode: env.STRIPE_MODE,
    ...(env.STRIPE_SECRET_KEY ? { secretKey: env.STRIPE_SECRET_KEY } : {}),
    ...(env.STRIPE_WEBHOOK_SECRET ? { webhookSecret: env.STRIPE_WEBHOOK_SECRET } : {}),
    ...(env.STRIPE_FOUNDER_CLOUD_PRICE_ID
      ? { founderCloudPriceId: env.STRIPE_FOUNDER_CLOUD_PRICE_ID }
      : {}),
    appUrl: env.APP_URL,
  });
}

export async function projectStripeWebhook(input: { rawBody: Uint8Array; signature: string }) {
  const env = loadEnv();
  const billing = configuredStripeBilling(env);
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
  const result = await repositories.billing.projectWebhook({
    event,
    payloadHash,
    expectedLivemode: env.STRIPE_MODE === "live",
    expectedPriceId: env.STRIPE_FOUNDER_CLOUD_PRICE_ID ?? "",
  });
  const subscriptionId =
    event.kind === "subscription"
      ? event.subscriptionId
      : event.kind === "invoice"
        ? event.subscriptionId
        : null;
  const secret = env.SESSION_SECRET ?? "";
  if (
    result.status === "APPLIED" &&
    result.entitlementActivated &&
    subscriptionId &&
    secret.length >= 32
  ) {
    await repositories.analytics
      .appendOnce({
        name: "subscription_started",
        dedupeKey: derivePrivacyHash(
          secret,
          "analytics-dedupe:v1",
          `subscription_started:${subscriptionId}`,
        ),
        properties: { plan: "founder_cloud", mode: env.STRIPE_MODE },
      })
      .catch(() => undefined);
  }
  return result;
}
