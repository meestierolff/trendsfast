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

export function billingAvailability(input: { enabled: boolean; mode: StripeMode }) {
  if (!input.enabled) {
    return {
      enabled: false as const,
      checkoutAvailable: false as const,
      reason: "BILLING_DISABLED" as const,
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

export function projectEntitlement(status: SubscriptionProjectionStatus): "founder_cloud" | null {
  return status === "active" || status === "trialing" ? "founder_cloud" : null;
}

export type BillingProjectionStore = {
  hasWebhookEvent(eventId: string): Promise<boolean>;
  projectWebhookEvent(input: {
    eventId: string;
    type: string;
    customerId?: string;
    subscriptionId?: string;
    status?: SubscriptionProjectionStatus;
    payloadHash: string;
  }): Promise<void>;
};

export function createStripeBilling(input: {
  enabled: boolean;
  mode: StripeMode;
  secretKey?: string;
  webhookSecret?: string;
  founderCloudPriceId?: string;
  appUrl: string;
  store: BillingProjectionStore;
}) {
  const availability = billingAvailability({ enabled: input.enabled, mode: input.mode });
  const stripe = input.secretKey ? new Stripe(input.secretKey) : null;

  return {
    availability,
    async createCheckout(customerEmail?: string) {
      if (!availability.checkoutAvailable || !stripe || !input.founderCloudPriceId) {
        throw new Error(availability.reason ?? "STRIPE_NOT_CONFIGURED");
      }
      return stripe.checkout.sessions.create({
        mode: "subscription",
        line_items: [{ price: input.founderCloudPriceId, quantity: 1 }],
        ...(customerEmail ? { customer_email: customerEmail } : {}),
        success_url: `${input.appUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${input.appUrl}/billing/cancel`,
        allow_promotion_codes: false,
      });
    },
    async createPortal(customerId: string) {
      if (!availability.checkoutAvailable || !stripe)
        throw new Error(availability.reason ?? "STRIPE_NOT_CONFIGURED");
      return stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: input.appUrl,
      });
    },
    parseWebhook(rawBody: string | Buffer, signature: string) {
      if (!stripe || !input.webhookSecret) throw new Error("STRIPE_WEBHOOK_NOT_CONFIGURED");
      return stripe.webhooks.constructEvent(rawBody, signature, input.webhookSecret);
    },
  };
}
