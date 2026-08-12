import { describe, expect, it, vi } from "vitest";
import Stripe from "stripe";
import {
  billingAvailability,
  checkoutClaimCookie,
  checkoutClaimExpiresAt,
  checkoutClaimHash,
  checkoutSessionExpiresAt,
  clearCheckoutClaimCookie,
  createCheckoutClaim,
  createStripeBilling,
  projectEntitlement,
  readCheckoutClaimCookie,
  STRIPE_API_VERSION,
  stripeIntegrationIdentifier,
  verifyCheckoutClaim,
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
    expect(
      billingAvailability({ ...input, mode: "test", providerCredentialMode: "fixture" }),
    ).toEqual({
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
        providerCredentialMode: "fixture",
      }),
    ).toEqual({ enabled: true, checkoutAvailable: true, reason: null });
  });

  it("never permits sandbox Checkout on a production deployment", () => {
    expect(
      billingAvailability({
        billingEnabled: true,
        paidMonitoringEnabled: true,
        mode: "test",
        providerCredentialMode: "fixture",
        deploymentEnvironment: "production",
      }),
    ).toEqual({
      enabled: true,
      checkoutAvailable: false,
      reason: "PRODUCTION_LIVE_MODE_REQUIRED",
    });
    expect(
      billingAvailability({
        billingEnabled: true,
        paidMonitoringEnabled: true,
        mode: "test",
        providerCredentialMode: "fixture",
        deploymentEnvironment: "preview",
      }),
    ).toEqual({ enabled: true, checkoutAvailable: true, reason: null });
  });

  it("never permits live Checkout outside the production deployment", () => {
    expect(
      billingAvailability({
        billingEnabled: true,
        paidMonitoringEnabled: true,
        mode: "live",
        providerCredentialMode: "managed",
        liveEnablementApproved: true,
        deploymentEnvironment: "preview",
      }),
    ).toEqual({
      enabled: true,
      checkoutAvailable: false,
      reason: "LIVE_PRODUCTION_DEPLOYMENT_REQUIRED",
    });
  });

  it("keeps live checkout closed pending an explicit commercial review", () => {
    expect(
      billingAvailability({
        billingEnabled: true,
        paidMonitoringEnabled: true,
        mode: "live",
        providerCredentialMode: "managed",
      }),
    ).toEqual({
      enabled: true,
      checkoutAvailable: false,
      reason: "LIVE_ENABLEMENT_REVIEW_REQUIRED",
    });
    expect(
      billingAvailability({
        billingEnabled: true,
        paidMonitoringEnabled: true,
        mode: "live",
        providerCredentialMode: "managed",
        liveEnablementApproved: true,
      }),
    ).toEqual({ enabled: true, checkoutAvailable: true, reason: null });
  });

  it("never permits sandbox Checkout to mint paid-provider keys", () => {
    expect(
      billingAvailability({
        billingEnabled: true,
        paidMonitoringEnabled: true,
        mode: "test",
        providerCredentialMode: "managed",
        deploymentEnvironment: "preview",
      }),
    ).toEqual({
      enabled: true,
      checkoutAvailable: false,
      reason: "SANDBOX_FIXTURE_MODE_REQUIRED",
    });
    expect(
      billingAvailability({
        billingEnabled: true,
        paidMonitoringEnabled: true,
        mode: "live",
        providerCredentialMode: "fixture",
        liveEnablementApproved: true,
        deploymentEnvironment: "production",
      }),
    ).toEqual({
      enabled: true,
      checkoutAvailable: false,
      reason: "LIVE_PROVIDER_MODE_REQUIRED",
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
  it("uses the SDK-paired Dahlia API and an eight-letter integration suffix", () => {
    expect(STRIPE_API_VERSION).toBe("2026-07-29.dahlia");
    expect(stripeIntegrationIdentifier("0198a5d3-d718-7000-8000-000000000001")).toMatch(
      /^trendsfast_founder_[a-z]{8}$/,
    );
    expect(stripeIntegrationIdentifier("0198a5d3-d718-7000-8000-000000000001")).toBe(
      stripeIntegrationIdentifier("0198a5d3-d718-7000-8000-000000000001"),
    );
  });

  it("creates, verifies, scopes, reads, and clears a secret Checkout claim", () => {
    const claim = createCheckoutClaim();
    expect(claim.rawClaim).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(claim.claimHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(checkoutClaimHash(claim.rawClaim)).toBe(claim.claimHash);
    expect(verifyCheckoutClaim(claim.rawClaim, claim.claimHash)).toBe(true);
    expect(verifyCheckoutClaim(`${claim.rawClaim}x`, claim.claimHash)).toBe(false);
    const cookie = checkoutClaimCookie(claim.rawClaim, new Date("2026-08-12T12:00:00Z"));
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Secure");
    expect(readCheckoutClaimCookie(cookie)).toBe(claim.rawClaim);
    expect(clearCheckoutClaimCookie()).toContain("Max-Age=0");
  });
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
      providerCredentialMode: "fixture",
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
      providerCredentialMode: "fixture",
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
      providerCredentialMode: "fixture",
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
      actorId: "delivery:private_capability_should_not_leave_origin",
      customerEmail: "founder@example.com",
      expiresAt: new Date("2026-08-11T12:00:00Z"),
      reservationId: "reservation-123",
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "subscription",
        integration_identifier: expect.stringMatching(/^trendsfast_founder_[a-z]{8}$/),
        client_reference_id: "2a7f6ec1-11dd-4b80-b22b-6d1489a20cb9",
        metadata: {
          project_id: "2a7f6ec1-11dd-4b80-b22b-6d1489a20cb9",
          checkout_reservation_id: "reservation-123",
          scope: "delivered_result",
        },
        subscription_data: {
          metadata: {
            plan: "founder",
            project_id: "2a7f6ec1-11dd-4b80-b22b-6d1489a20cb9",
            checkout_reservation_id: "reservation-123",
          },
        },
        success_url: "https://trendsfast.example/billing/success?session_id={CHECKOUT_SESSION_ID}",
        cancel_url: "https://trendsfast.example/billing/canceled",
        expires_at: 1_786_449_600,
        allow_promotion_codes: false,
      }),
      { idempotencyKey: expect.stringMatching(/^tf_checkout_[a-f0-9]{48}$/) },
    );
    expect(JSON.stringify(create.mock.calls)).not.toContain(
      "private_capability_should_not_leave_origin",
    );
    expect(JSON.stringify(create.mock.calls)).not.toContain("tf_checkout_claim");
  });

  it("omits manual payment methods and tax until registrations are approved", async () => {
    const create = vi
      .fn()
      .mockResolvedValue({ id: "cs_test_dynamic", url: "https://checkout.stripe.com/dynamic" });
    const billing = createStripeBilling({
      billingEnabled: true,
      paidMonitoringEnabled: true,
      mode: "test",
      providerCredentialMode: "fixture",
      secretKey: "rk_test_example",
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
      actorId: "delivery:test",
      reservationId: "0198a5d3-d718-7000-8000-000000000001",
      expiresAt: new Date("2026-08-12T12:00:00Z"),
    });
    const params = create.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(params).not.toHaveProperty("payment_method_types");
    expect(params).not.toHaveProperty("automatic_tax");
  });

  it("reuses a server-derived Checkout idempotency key for the durable reservation", async () => {
    const create = vi
      .fn()
      .mockResolvedValue({ id: "cs_test_same", url: "https://checkout.stripe.com/x" });
    const billing = createStripeBilling({
      billingEnabled: true,
      paidMonitoringEnabled: true,
      mode: "test",
      providerCredentialMode: "fixture",
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
      providerCredentialMode: "fixture",
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
      providerCredentialMode: "fixture",
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
    expect(checkoutClaimExpiresAt(new Date("2026-08-11T11:00:00Z"))).toEqual(
      new Date("2026-08-11T11:30:00Z"),
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
      providerCredentialMode: "fixture",
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
        providerCredentialMode: "fixture",
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
        providerCredentialMode: "fixture",
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
        providerCredentialMode: "fixture",
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
