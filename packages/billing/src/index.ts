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
  subscriptionPeriodStart: Date | null;
  subscriptionPeriodEnd: Date | null;
  paymentPeriodStart: Date | null;
  paymentPeriodEnd: Date | null;
}): "founder_cloud" | null {
  const subscriptionStart = input.subscriptionPeriodStart?.getTime();
  const subscriptionEnd = input.subscriptionPeriodEnd?.getTime();
  const paymentStart = input.paymentPeriodStart?.getTime();
  const paymentEnd = input.paymentPeriodEnd?.getTime();
  const currentPeriodPaid =
    subscriptionStart !== undefined &&
    subscriptionEnd !== undefined &&
    paymentStart !== undefined &&
    paymentEnd !== undefined &&
    Number.isFinite(subscriptionStart) &&
    Number.isFinite(subscriptionEnd) &&
    subscriptionStart < subscriptionEnd &&
    subscriptionStart === paymentStart &&
    subscriptionEnd === paymentEnd;
  return input.paymentState === "paid" && input.subscriptionStatus === "active" && currentPeriodPaid
    ? "founder_cloud"
    : null;
}

type CheckoutCreate = (
  input: Stripe.Checkout.SessionCreateParams,
  options?: Stripe.RequestOptions,
) => Promise<{
  id: string;
  url?: string | null;
  status?: "open" | "complete" | "expired" | null;
}>;

type CheckoutRetrieve = (id: string) => Promise<{
  id: string;
  url?: string | null;
  status: "open" | "complete" | "expired" | null;
  metadata?: Record<string, string> | null;
}>;

type CheckoutList = (input: {
  created: { gte: number };
  limit: number;
  starting_after?: string;
}) => Promise<{
  data: Array<{
    id: string;
    url?: string | null;
    status: "open" | "complete" | "expired" | null;
    metadata?: Record<string, string> | null;
  }>;
  has_more: boolean;
}>;

type PortalCreate = (
  input: Stripe.BillingPortal.SessionCreateParams,
  options?: Stripe.RequestOptions,
) => Promise<{
  id?: string;
  url?: string;
}>;

export type StripeBillingClient = {
  checkout: {
    sessions: { create: CheckoutCreate; retrieve: CheckoutRetrieve; list: CheckoutList };
  };
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
  const window = iso.slice(0, 13);
  const digest = createHash("sha256")
    .update(`${input.kind}\0${input.subject}\0${input.plan ?? ""}\0${window}`)
    .digest("hex")
    .slice(0, 48);
  return `tf_${input.kind}_${digest}`;
}

export function checkoutSessionExpiresAt(now: Date): Date {
  if (Number.isNaN(now.getTime())) throw new Error("STRIPE_CHECKOUT_TIME_INVALID");
  const minimum = new Date(now.getTime() + 31 * 60 * 1_000);
  minimum.setUTCMinutes(0, 0, 0);
  if (minimum <= now || minimum.getTime() < now.getTime() + 31 * 60 * 1_000) {
    minimum.setUTCHours(minimum.getUTCHours() + 1);
  }
  return minimum;
}

export function stripeCheckoutIdempotencyKey(input: {
  reservationId: string;
  projectId: string;
  plan: string;
}) {
  if (!input.reservationId || !input.projectId || !input.plan) {
    throw new Error("STRIPE_CHECKOUT_RESERVATION_INVALID");
  }
  const digest = createHash("sha256")
    .update(`checkout\0${input.reservationId}\0${input.projectId}\0${input.plan}`)
    .digest("hex")
    .slice(0, 48);
  return `tf_checkout_${digest}`;
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
      expiresAt: Date;
      reservationId: string;
    }) {
      if (!availability.checkoutAvailable || !stripe || !input.founderCloudPriceId) {
        throw new Error(availability.reason ?? "STRIPE_NOT_CONFIGURED");
      }
      if (!checkout.projectId || !checkout.actorId)
        throw new Error("PROJECT_BOUND_OPS_AUTH_REQUIRED");
      if (Number.isNaN(checkout.expiresAt.getTime())) {
        throw new Error("STRIPE_CHECKOUT_EXPIRATION_INVALID");
      }
      return stripe.checkout.sessions.create(
        {
          mode: "subscription",
          line_items: [{ price: input.founderCloudPriceId, quantity: 1 }],
          client_reference_id: checkout.projectId,
          metadata: {
            project_id: checkout.projectId,
            checkout_reservation_id: checkout.reservationId,
            scope: "founder_ops",
          },
          subscription_data: {
            metadata: {
              plan: "founder",
              project_id: checkout.projectId,
              checkout_reservation_id: checkout.reservationId,
            },
          },
          ...(checkout.customerId
            ? { customer: checkout.customerId }
            : checkout.customerEmail
              ? { customer_email: checkout.customerEmail }
              : {}),
          success_url: `${appUrl}/ops/billing?checkout=returned`,
          cancel_url: `${appUrl}/ops/billing?checkout=canceled`,
          expires_at: Math.floor(checkout.expiresAt.getTime() / 1_000),
          allow_promotion_codes: false,
        },
        {
          idempotencyKey: stripeCheckoutIdempotencyKey({
            reservationId: checkout.reservationId,
            projectId: checkout.projectId,
            plan: input.founderCloudPriceId,
          }),
        },
      );
    },
    async retrieveCheckout(checkoutSessionId: string) {
      if (!availability.checkoutAvailable || !stripe) {
        throw new Error(availability.reason ?? "STRIPE_NOT_CONFIGURED");
      }
      if (!checkoutSessionId) throw new Error("STRIPE_CHECKOUT_SESSION_REQUIRED");
      const session = await stripe.checkout.sessions.retrieve(checkoutSessionId);
      if (
        !session.id ||
        !session.status ||
        !["open", "complete", "expired"].includes(session.status)
      ) {
        throw new Error("STRIPE_CHECKOUT_STATUS_UNRESOLVED");
      }
      return session;
    },
    async findCheckoutForReservation(input: { reservationId: string; createdAt: Date }) {
      if (!availability.checkoutAvailable || !stripe) {
        throw new Error(availability.reason ?? "STRIPE_NOT_CONFIGURED");
      }
      if (!input.reservationId || Number.isNaN(input.createdAt.getTime())) {
        throw new Error("STRIPE_CHECKOUT_RESERVATION_INVALID");
      }
      let startingAfter: string | undefined;
      for (let page = 0; page < 5; page += 1) {
        const response = await stripe.checkout.sessions.list({
          created: { gte: Math.floor((input.createdAt.getTime() - 60_000) / 1_000) },
          limit: 100,
          ...(startingAfter ? { starting_after: startingAfter } : {}),
        });
        const found = response.data.find(
          (session) =>
            session.metadata?.checkout_reservation_id === input.reservationId &&
            session.id.length > 0,
        );
        if (found) return found;
        if (!response.has_more) return null;
        startingAfter = response.data.at(-1)?.id;
        if (!startingAfter) throw new Error("STRIPE_CHECKOUT_RECONCILIATION_INCOMPLETE");
      }
      throw new Error("STRIPE_CHECKOUT_RECONCILIATION_LIMIT_REACHED");
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
