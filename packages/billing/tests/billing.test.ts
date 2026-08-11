import { describe, expect, it, vi } from "vitest";
import Stripe from "stripe";
import {
  billingAvailability,
  checkoutSessionExpiresAt,
  createStripeBilling,
  projectEntitlement,
} from "../src/index";

describe("billing launch gate", () => {
  it.each([
    {
      billingEnabled: false,
      paidMonitoringEnabled: false,
      reason: "BILLING_DISABLED",
    },
    {
      billingEnabled: true,
      paidMonitoringEnabled: false,
      reason: "MONITORING_DISABLED",
    },
  ])("keeps checkout closed when either launch gate is off", (input) => {
    expect(billingAvailability({ ...input, mode: "test" })).toEqual({
      enabled: false,
      checkoutAvailable: false,
      reason: input.reason,
    });
  });

  it("allows founder-ops test checkout only when both gates are on", () => {
    expect(
      billingAvailability({
        billingEnabled: true,
        paidMonitoringEnabled: true,
        mode: "test",
      }),
    ).toEqual({ enabled: true, checkoutAvailable: true, reason: null });
  });

  it("keeps live checkout closed pending an explicit commercial review", () => {
    expect(
      billingAvailability({
        billingEnabled: true,
        paidMonitoringEnabled: true,
        mode: "live",
      }),
    ).toEqual({
      enabled: true,
      checkoutAvailable: false,
      reason: "LIVE_ENABLEMENT_REVIEW_REQUIRED",
    });
  });

  it("projects Founder access only from paid webhook state", () => {
    const currentPeriod = {
      subscriptionPeriodStart: new Date("2026-08-01T00:00:00Z"),
      subscriptionPeriodEnd: new Date("2026-09-01T00:00:00Z"),
      paymentPeriodStart: new Date("2026-08-01T00:00:00Z"),
      paymentPeriodEnd: new Date("2026-09-01T00:00:00Z"),
    };
    expect(
      projectEntitlement({
        subscriptionStatus: "active",
        paymentState: "paid",
        ...currentPeriod,
      }),
    ).toBe("founder_cloud");
    expect(
      projectEntitlement({
        subscriptionStatus: "trialing",
        paymentState: "unknown",
        ...currentPeriod,
      }),
    ).toBeNull();
    expect(
      projectEntitlement({
        subscriptionStatus: "active",
        paymentState: "unknown",
        ...currentPeriod,
      }),
    ).toBeNull();
    expect(
      projectEntitlement({
        subscriptionStatus: "active",
        paymentState: "failed",
        ...currentPeriod,
      }),
    ).toBeNull();
    expect(
      projectEntitlement({
        subscriptionStatus: "past_due",
        paymentState: "paid",
        ...currentPeriod,
      }),
    ).toBeNull();
    expect(
      projectEntitlement({
        subscriptionStatus: "canceled",
        paymentState: "paid",
        ...currentPeriod,
      }),
    ).toBeNull();
    expect(
      projectEntitlement({
        subscriptionStatus: "active",
        paymentState: "paid",
        ...currentPeriod,
        paymentPeriodStart: new Date("2026-07-01T00:00:00Z"),
        paymentPeriodEnd: new Date("2026-08-01T00:00:00Z"),
      }),
    ).toBeNull();
    expect(
      projectEntitlement({
        subscriptionStatus: "active",
        paymentState: "paid",
        ...currentPeriod,
        paymentPeriodStart: null,
        paymentPeriodEnd: null,
      }),
    ).toBeNull();
  });
});

describe("project-bound Stripe sessions", () => {
  it("verifies real Stripe SDK signatures over the exact raw body without network access", () => {
    const webhookSecret = "whsec_local_signature_test";
    const payload = JSON.stringify({
      id: "evt_signature_test",
      type: "invoice.paid",
      created: Math.floor(Date.now() / 1_000),
      livemode: false,
      data: { object: { id: "in_signature_test" } },
    });
    const signature = Stripe.webhooks.generateTestHeaderString({
      payload,
      secret: webhookSecret,
    });
    const billing = createStripeBilling({
      billingEnabled: true,
      paidMonitoringEnabled: true,
      mode: "test",
      secretKey: "sk_test_signature_only",
      webhookSecret,
      founderCloudPriceId: "price_founder",
      appUrl: "https://trendsfast.example",
    });

    expect(billing.parseWebhook(payload, signature)).toMatchObject({ id: "evt_signature_test" });
    expect(() => billing.parseWebhook(`${payload} `, signature)).toThrow();
    const wrongSecretBilling = createStripeBilling({
      billingEnabled: true,
      paidMonitoringEnabled: true,
      mode: "test",
      secretKey: "sk_test_signature_only",
      webhookSecret: "whsec_wrong_local_secret",
      founderCloudPriceId: "price_founder",
      appUrl: "https://trendsfast.example",
    });
    expect(() => wrongSecretBilling.parseWebhook(payload, signature)).toThrow();
  });

  it("binds checkout to one existing project and never grants access from the return URL", async () => {
    const create = vi
      .fn()
      .mockResolvedValue({ id: "cs_test_123", url: "https://checkout.stripe.com/x" });
    const billing = createStripeBilling({
      billingEnabled: true,
      paidMonitoringEnabled: true,
      mode: "test",
      secretKey: "sk_test_example",
      webhookSecret: "whsec_example",
      founderCloudPriceId: "price_founder",
      appUrl: "https://trendsfast.example",
      stripe: {
        checkout: { sessions: { create, retrieve: vi.fn(), list: vi.fn() } },
        billingPortal: { sessions: { create: vi.fn() } },
        webhooks: { constructEvent: vi.fn() },
      },
    });

    await billing.createCheckout({
      projectId: "2a7f6ec1-11dd-4b80-b22b-6d1489a20cb9",
      actorId: "founder:session",
      customerEmail: "founder@example.com",
      expiresAt: new Date("2026-08-11T12:00:00Z"),
      reservationId: "reservation-123",
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "subscription",
        client_reference_id: "2a7f6ec1-11dd-4b80-b22b-6d1489a20cb9",
        metadata: {
          project_id: "2a7f6ec1-11dd-4b80-b22b-6d1489a20cb9",
          checkout_reservation_id: "reservation-123",
          scope: "founder_ops",
        },
        subscription_data: {
          metadata: {
            plan: "founder",
            project_id: "2a7f6ec1-11dd-4b80-b22b-6d1489a20cb9",
            checkout_reservation_id: "reservation-123",
          },
        },
        success_url: "https://trendsfast.example/ops/billing?checkout=returned",
        expires_at: 1_786_449_600,
      }),
      { idempotencyKey: expect.stringMatching(/^tf_checkout_[a-f0-9]{48}$/) },
    );
  });

  it("reuses a server-derived Checkout idempotency key for the durable reservation", async () => {
    const create = vi
      .fn()
      .mockResolvedValue({ id: "cs_test_same", url: "https://checkout.stripe.com/x" });
    const billing = createStripeBilling({
      billingEnabled: true,
      paidMonitoringEnabled: true,
      mode: "test",
      secretKey: "sk_test_example",
      webhookSecret: "whsec_example",
      founderCloudPriceId: "price_founder",
      appUrl: "https://trendsfast.example",
      stripe: {
        checkout: { sessions: { create, retrieve: vi.fn(), list: vi.fn() } },
        billingPortal: { sessions: { create: vi.fn() } },
        webhooks: { constructEvent: vi.fn() },
      },
    });
    const checkout = {
      projectId: "2a7f6ec1-11dd-4b80-b22b-6d1489a20cb9",
      actorId: "founder:session",
      expiresAt: new Date("2026-08-12T01:00:00Z"),
      reservationId: "reservation-stable",
    };
    await billing.createCheckout(checkout);
    await billing.createCheckout(checkout);
    expect(create.mock.calls[0]?.[1]).toEqual(create.mock.calls[1]?.[1]);
  });

  it("reads back the current Stripe Checkout state for reconciliation", async () => {
    const retrieve = vi.fn().mockResolvedValue({
      id: "cs_test_readback",
      status: "expired",
      url: null,
    });
    const billing = createStripeBilling({
      billingEnabled: true,
      paidMonitoringEnabled: true,
      mode: "test",
      secretKey: "sk_test_example",
      webhookSecret: "whsec_example",
      founderCloudPriceId: "price_founder",
      appUrl: "https://trendsfast.example",
      stripe: {
        checkout: { sessions: { create: vi.fn(), retrieve, list: vi.fn() } },
        billingPortal: { sessions: { create: vi.fn() } },
        webhooks: { constructEvent: vi.fn() },
      },
    });
    await expect(billing.retrieveCheckout("cs_test_readback")).resolves.toMatchObject({
      id: "cs_test_readback",
      status: "expired",
    });
  });

  it("reconciles an unknown-effect Checkout attempt by durable reservation metadata", async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce({
        data: [
          {
            id: "cs_test_other",
            status: "open",
            metadata: { checkout_reservation_id: "other-reservation" },
          },
        ],
        has_more: true,
      })
      .mockResolvedValueOnce({
        data: [
          {
            id: "cs_test_recovered",
            status: "open",
            metadata: { checkout_reservation_id: "reservation-recovered" },
          },
        ],
        has_more: false,
      });
    const billing = createStripeBilling({
      billingEnabled: true,
      paidMonitoringEnabled: true,
      mode: "test",
      secretKey: "sk_test_example",
      webhookSecret: "whsec_example",
      founderCloudPriceId: "price_founder",
      appUrl: "https://trendsfast.example",
      stripe: {
        checkout: { sessions: { create: vi.fn(), retrieve: vi.fn(), list } },
        billingPortal: { sessions: { create: vi.fn() } },
        webhooks: { constructEvent: vi.fn() },
      },
    });
    const createdAt = new Date("2026-08-11T10:00:00Z");

    await expect(
      billing.findCheckoutForReservation({
        reservationId: "reservation-recovered",
        createdAt,
      }),
    ).resolves.toMatchObject({ id: "cs_test_recovered" });
    expect(list).toHaveBeenNthCalledWith(1, {
      created: { gte: Math.floor((createdAt.getTime() - 60_000) / 1_000) },
      limit: 100,
    });
    expect(list).toHaveBeenNthCalledWith(2, {
      created: { gte: Math.floor((createdAt.getTime() - 60_000) / 1_000) },
      limit: 100,
      starting_after: "cs_test_other",
    });
  });

  it("aligns Checkout expiration to a retry-safe hour after Stripe's minimum window", () => {
    expect(checkoutSessionExpiresAt(new Date("2026-08-11T10:00:00Z"))).toEqual(
      new Date("2026-08-11T11:00:00Z"),
    );
    expect(checkoutSessionExpiresAt(new Date("2026-08-11T10:50:00Z"))).toEqual(
      new Date("2026-08-11T12:00:00Z"),
    );
    expect(() => checkoutSessionExpiresAt(new Date(Number.NaN))).toThrow(
      "STRIPE_CHECKOUT_TIME_INVALID",
    );
  });

  it("uses a bounded server-derived hourly key for Customer Portal", async () => {
    const create = vi
      .fn()
      .mockResolvedValue({ id: "bps_test", url: "https://billing.stripe.com/p/session" });
    const billing = createStripeBilling({
      billingEnabled: true,
      paidMonitoringEnabled: true,
      mode: "test",
      secretKey: "rk_test_example",
      webhookSecret: "whsec_example",
      founderCloudPriceId: "price_founder",
      appUrl: "http://127.0.0.1:3000",
      stripe: {
        checkout: { sessions: { create: vi.fn(), retrieve: vi.fn(), list: vi.fn() } },
        billingPortal: { sessions: { create } },
        webhooks: { constructEvent: vi.fn() },
      },
    });
    await billing.createPortal("cus_test_1", {
      idempotencyWindow: new Date("2026-08-11T10:59:59Z"),
    });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ customer: "cus_test_1" }), {
      idempotencyKey: expect.stringMatching(/^tf_portal_[a-f0-9]{48}$/),
    });
  });

  it("rejects wrong-mode Stripe keys and non-HTTP localhost URLs before any mutation", () => {
    const create = vi.fn();
    const stripe = {
      checkout: { sessions: { create, retrieve: vi.fn(), list: vi.fn() } },
      billingPortal: { sessions: { create: vi.fn() } },
      webhooks: { constructEvent: vi.fn() },
    };
    expect(() =>
      createStripeBilling({
        billingEnabled: true,
        paidMonitoringEnabled: true,
        mode: "test",
        secretKey: "sk_live_wrong",
        webhookSecret: "whsec_example",
        founderCloudPriceId: "price_founder",
        appUrl: "https://trendsfast.example",
        stripe,
      }),
    ).toThrow("STRIPE_SECRET_MODE_MISMATCH");
    expect(() =>
      createStripeBilling({
        billingEnabled: true,
        paidMonitoringEnabled: true,
        mode: "test",
        secretKey: "sk_test_example",
        webhookSecret: "whsec_example",
        founderCloudPriceId: "price_founder",
        appUrl: "ftp://localhost",
        stripe,
      }),
    ).toThrow("BILLING_APP_URL_MUST_BE_HTTPS");
    expect(() =>
      createStripeBilling({
        billingEnabled: true,
        paidMonitoringEnabled: true,
        mode: "test",
        secretKey: "sk_test_example",
        webhookSecret: "whsec_example",
        founderCloudPriceId: "price_founder",
        appUrl: "https://user:password@trendsfast.example",
        stripe,
      }),
    ).toThrow("BILLING_APP_URL_CREDENTIALS_NOT_ALLOWED");
    expect(create).not.toHaveBeenCalled();
  });
});
