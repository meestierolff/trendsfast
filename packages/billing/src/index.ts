import { createHash } from "node:crypto";

import Stripe from "stripe";

export type StripeMode = "test" | "live";
export type SubscriptionProjectionStatus =
  | "incomplete"
  | "incomplete_expired"
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "unpaid"
  | "paused";
export type PaymentProjectionState = "unknown" | "paid" | "failed";

export function billingAvailability(input: {
  billingEnabled: boolean;
  paidMonitoringEnabled: boolean;
  mode: StripeMode;
}) {
  if (!input.billingEnabled) {
    return {
      enabled: false as const,
      checkoutAvailable: false as const,
      reason: "BILLING_DISABLED" as const,
    };
  }
  if (!input.paidMonitoringEnabled) {
    return {
      enabled: false as const,
      checkoutAvailable: false as const,
      reason: "MONITORING_DISABLED" as const,
    };
  }
  if (input.mode !== "test") {
    return {
      enabled: true as const,
      checkoutAvailable: false as const,
      reason: "LIVE_ENABLEMENT_REVIEW_REQUIRED" as const,
    };
  }
  return { enabled: true as const, checkoutAvailable: true as const, reason: null };
}

export function projectEntitlement(input: {
  subscriptionStatus: SubscriptionProjectionStatus;
  paymentState: PaymentProjectionState;
}): "founder_cloud" | null {
  return input.paymentState === "paid" && input.subscriptionStatus === "active"
    ? "founder_cloud"
    : null;
}

type CheckoutCreate = (
  input: Stripe.Checkout.SessionCreateParams,
  options?: Stripe.RequestOptions,
) => Promise<{
  id: string;
  url?: string | null;
}>;

type PortalCreate = (
  input: Stripe.BillingPortal.SessionCreateParams,
  options?: Stripe.RequestOptions,
) => Promise<{
  id?: string;
  url?: string;
}>;

export type StripeBillingClient = {
  checkout: { sessions: { create: CheckoutCreate } };
  billingPortal: { sessions: { create: PortalCreate } };
  webhooks: {
    constructEvent(rawBody: string | Buffer, signature: string, secret: string): unknown;
  };
};

function cleanAppUrl(value: string): string {
  const url = new URL(value);
  const localHttp =
    url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  if (url.protocol !== "https:" && !localHttp) {
    throw new Error("BILLING_APP_URL_MUST_BE_HTTPS");
  }
  if (url.username || url.password) throw new Error("BILLING_APP_URL_CREDENTIALS_NOT_ALLOWED");
  return url.origin;
}

function stripeSecretMatchesMode(secretKey: string, mode: StripeMode) {
  const prefixes = mode === "test" ? ["sk_test_", "rk_test_"] : ["sk_live_", "rk_live_"];
  return prefixes.some((prefix) => secretKey.startsWith(prefix));
}

export function stripeMutationIdempotencyKey(input: {
  kind: "checkout" | "portal";
  subject: string;
  plan?: string;
  now: Date;
}) {
  if (Number.isNaN(input.now.getTime())) throw new Error("STRIPE_IDEMPOTENCY_WINDOW_INVALID");
  const iso = input.now.toISOString();
  const window = input.kind === "checkout" ? iso.slice(0, 10) : iso.slice(0, 13);
  const digest = createHash("sha256")
    .update(`${input.kind}\0${input.subject}\0${input.plan ?? ""}\0${window}`)
    .digest("hex")
    .slice(0, 48);
  return `tf_${input.kind}_${digest}`;
}

export function createStripeBilling(input: {
  billingEnabled: boolean;
  paidMonitoringEnabled: boolean;
  mode: StripeMode;
  secretKey?: string;
  webhookSecret?: string;
  founderCloudPriceId?: string;
  appUrl: string;
  stripe?: StripeBillingClient;
}) {
  const availability = billingAvailability({
    billingEnabled: input.billingEnabled,
    paidMonitoringEnabled: input.paidMonitoringEnabled,
    mode: input.mode,
  });
  if (input.secretKey && !stripeSecretMatchesMode(input.secretKey, input.mode)) {
    throw new Error("STRIPE_SECRET_MODE_MISMATCH");
  }
  const stripe =
    input.stripe ?? (input.secretKey ? (new Stripe(input.secretKey) as StripeBillingClient) : null);
  const appUrl = cleanAppUrl(input.appUrl);

  return {
    availability,
    async createCheckout(checkout: {
      projectId: string;
      actorId: string;
      customerId?: string;
      customerEmail?: string;
      idempotencyWindow?: Date;
    }) {
      if (!availability.checkoutAvailable || !stripe || !input.founderCloudPriceId) {
        throw new Error(availability.reason ?? "STRIPE_NOT_CONFIGURED");
      }
      if (!checkout.projectId || !checkout.actorId)
        throw new Error("PROJECT_BOUND_OPS_AUTH_REQUIRED");
      return stripe.checkout.sessions.create(
        {
          mode: "subscription",
          line_items: [{ price: input.founderCloudPriceId, quantity: 1 }],
          client_reference_id: checkout.projectId,
          metadata: { project_id: checkout.projectId, scope: "founder_ops" },
          subscription_data: {
            metadata: { plan: "founder", project_id: checkout.projectId },
          },
          ...(checkout.customerId
            ? { customer: checkout.customerId }
            : checkout.customerEmail
              ? { customer_email: checkout.customerEmail }
              : {}),
          success_url: `${appUrl}/ops/billing?checkout=returned`,
          cancel_url: `${appUrl}/ops/billing?checkout=canceled`,
          allow_promotion_codes: false,
        },
        {
          idempotencyKey: stripeMutationIdempotencyKey({
            kind: "checkout",
            subject: checkout.projectId,
            plan: input.founderCloudPriceId,
            now: checkout.idempotencyWindow ?? new Date(),
          }),
        },
      );
    },
    async createPortal(customerId: string, options: { idempotencyWindow?: Date } = {}) {
      if (!availability.checkoutAvailable || !stripe) {
        throw new Error(availability.reason ?? "STRIPE_NOT_CONFIGURED");
      }
      if (!customerId) throw new Error("STRIPE_CUSTOMER_REQUIRED");
      return stripe.billingPortal.sessions.create(
        {
          customer: customerId,
          return_url: `${appUrl}/ops/billing`,
        },
        {
          idempotencyKey: stripeMutationIdempotencyKey({
            kind: "portal",
            subject: customerId,
            now: options.idempotencyWindow ?? new Date(),
          }),
        },
      );
    },
    parseWebhook(rawBody: string | Buffer, signature: string) {
      if (!stripe || !input.webhookSecret) throw new Error("STRIPE_WEBHOOK_NOT_CONFIGURED");
      return stripe.webhooks.constructEvent(rawBody, signature, input.webhookSecret);
    },
  };
}

export * from "./projection";
