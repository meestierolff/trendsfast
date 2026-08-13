import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

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

export const STRIPE_API_VERSION = "2026-07-29.dahlia" as const;
export const CHECKOUT_CLAIM_COOKIE = "tf_checkout_claim";
export const CHECKOUT_CLAIM_GRACE_MS = 30 * 60 * 1_000;

export function checkoutClaimExpiresAt(checkoutExpiresAt: Date): Date {
  if (Number.isNaN(checkoutExpiresAt.getTime())) throw new Error("STRIPE_CHECKOUT_TIME_INVALID");
  return new Date(checkoutExpiresAt.getTime() + CHECKOUT_CLAIM_GRACE_MS);
}

export function createCheckoutClaim(): { rawClaim: string; claimHash: string } {
  const rawClaim = randomBytes(32).toString("base64url");
  return {
    rawClaim,
    claimHash: `sha256:${createHash("sha256").update(rawClaim, "utf8").digest("hex")}`,
  };
}

export function checkoutClaimHash(rawClaim: string): string | null {
  if (!/^[A-Za-z0-9_-]{43}$/.test(rawClaim)) return null;
  return `sha256:${createHash("sha256").update(rawClaim, "utf8").digest("hex")}`;
}

export function verifyCheckoutClaim(rawClaim: string, encodedHash: string): boolean {
  const candidate = checkoutClaimHash(rawClaim);
  if (!candidate) return false;
  const candidateBytes = Buffer.from(candidate, "utf8");
  const expectedBytes = Buffer.from(encodedHash, "utf8");
  return (
    candidateBytes.length === expectedBytes.length && timingSafeEqual(candidateBytes, expectedBytes)
  );
}

export function checkoutClaimCookie(rawClaim: string, expiresAt: Date): string {
  if (!checkoutClaimHash(rawClaim) || Number.isNaN(expiresAt.getTime())) {
    throw new Error("STRIPE_CHECKOUT_CLAIM_INVALID");
  }
  return [
    `${CHECKOUT_CLAIM_COOKIE}=${encodeURIComponent(rawClaim)}`,
    "Path=/",
    `Expires=${expiresAt.toUTCString()}`,
    "HttpOnly",
    "SameSite=Lax",
    "Secure",
    "Priority=High",
  ].join("; ");
}

export function clearCheckoutClaimCookie(): string {
  return [
    `${CHECKOUT_CLAIM_COOKIE}=`,
    "Path=/",
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    "HttpOnly",
    "SameSite=Lax",
    "Secure",
    "Priority=High",
  ].join("; ");
}

export function readCheckoutClaimCookie(header: string | null): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [name, ...encoded] = part.trim().split("=");
    if (name !== CHECKOUT_CLAIM_COOKIE) continue;
    try {
      const value = decodeURIComponent(encoded.join("="));
      return checkoutClaimHash(value) ? value : null;
    } catch {
      return null;
    }
  }
  return null;
}

export function billingAvailability(input: {
  billingEnabled: boolean;
  paidMonitoringEnabled: boolean;
  mode: StripeMode;
  providerCredentialMode: "fixture" | "managed" | "byok";
  sandboxKeyRotated?: boolean;
  liveEnablementApproved?: boolean;
  deploymentEnvironment?: "local" | "preview" | "production";
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
  if (input.mode === "test" && !input.sandboxKeyRotated) {
    return {
      enabled: true as const,
      checkoutAvailable: false as const,
      reason: "SANDBOX_KEY_ROTATION_REQUIRED" as const,
    };
  }
  if (input.mode === "test" && input.providerCredentialMode !== "fixture") {
    return {
      enabled: true as const,
      checkoutAvailable: false as const,
      reason: "SANDBOX_FIXTURE_MODE_REQUIRED" as const,
    };
  }
  if (input.mode === "live" && input.providerCredentialMode === "fixture") {
    return {
      enabled: true as const,
      checkoutAvailable: false as const,
      reason: "LIVE_PROVIDER_MODE_REQUIRED" as const,
    };
  }
  if (input.deploymentEnvironment === "production" && input.mode !== "live") {
    return {
      enabled: true as const,
      checkoutAvailable: false as const,
      reason: "PRODUCTION_LIVE_MODE_REQUIRED" as const,
    };
  }
  if (
    input.deploymentEnvironment !== undefined &&
    input.deploymentEnvironment !== "production" &&
    input.mode === "live"
  ) {
    return {
      enabled: true as const,
      checkoutAvailable: false as const,
      reason: "LIVE_PRODUCTION_DEPLOYMENT_REQUIRED" as const,
    };
  }
  if (input.mode === "live" && !input.liveEnablementApproved) {
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

/** Stable across retries, but sourced from the random reservation UUID. */
export function stripeIntegrationIdentifier(reservationId: string): string {
  if (!reservationId) throw new Error("STRIPE_CHECKOUT_RESERVATION_INVALID");
  const alphabet = "abcdefghijklmnopqrstuvwxyz";
  const bytes = createHash("sha256").update(`integration\0${reservationId}`).digest();
  const suffix = [...bytes.subarray(0, 8)]
    .map((value) => alphabet[value % alphabet.length])
    .join("");
  return `trendsfast_founder_${suffix}`;
}

export function createStripeBilling(input: {
  billingEnabled: boolean;
  paidMonitoringEnabled: boolean;
  mode: StripeMode;
  providerCredentialMode: "fixture" | "managed" | "byok";
  sandboxKeyRotated?: boolean;
  secretKey?: string;
  webhookSecret?: string;
  founderCloudPriceId?: string;
  appUrl: string;
  liveEnablementApproved?: boolean;
  deploymentEnvironment?: "local" | "preview" | "production";
  stripe?: StripeBillingClient;
}) {
  const availability = billingAvailability({
    billingEnabled: input.billingEnabled,
    paidMonitoringEnabled: input.paidMonitoringEnabled,
    mode: input.mode,
    providerCredentialMode: input.providerCredentialMode,
    ...(input.sandboxKeyRotated === undefined
      ? {}
      : { sandboxKeyRotated: input.sandboxKeyRotated }),
    ...(input.deploymentEnvironment ? { deploymentEnvironment: input.deploymentEnvironment } : {}),
    ...(input.liveEnablementApproved === undefined
      ? {}
      : { liveEnablementApproved: input.liveEnablementApproved }),
  });
  if (input.secretKey && !stripeSecretMatchesMode(input.secretKey, input.mode)) {
    throw new Error("STRIPE_SECRET_MODE_MISMATCH");
  }
  const stripe =
    input.stripe ??
    (input.secretKey
      ? (new Stripe(input.secretKey, { apiVersion: STRIPE_API_VERSION }) as StripeBillingClient)
      : null);
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
          integration_identifier: stripeIntegrationIdentifier(checkout.reservationId),
          line_items: [{ price: input.founderCloudPriceId, quantity: 1 }],
          client_reference_id: checkout.projectId,
          metadata: {
            project_id: checkout.projectId,
            checkout_reservation_id: checkout.reservationId,
            scope: "delivered_result",
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
          success_url: `${appUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${appUrl}/billing/canceled`,
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
