import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  bindProjectCheckout: vi.fn(),
  checkoutClaimStatus: vi.fn(),
  checkoutForDeliveryClaimRecovery: vi.fn(),
  consumeCheckoutClaim: vi.fn(),
  createCheckout: vi.fn(),
  expireProjectCheckout: vi.fn(),
  expireUnboundProjectCheckout: vi.fn(),
  findCheckoutForReservation: vi.fn(),
  reserveProjectCheckout: vi.fn(),
  resolveReadyScanIdentity: vi.fn(),
  retrieveCheckout: vi.fn(),
  rotateProjectCheckoutClaim: vi.fn(),
  checkoutAvailable: true,
  billingCheckoutEnabled: true,
}));

vi.mock("@trendsfast/config", () => ({
  loadEnv: () => ({
    APP_URL: "https://trendsfast.example",
    BILLING_ENABLED: true,
    BILLING_CHECKOUT_ENABLED: mocks.billingCheckoutEnabled,
    PAID_MONITORING_ENABLED: true,
    STRIPE_MODE: "test",
    STRIPE_SANDBOX_KEY_ROTATED: "YES",
    API_CREATE_RATE_LIMIT_PER_HOUR: 31,
  }),
  resolveApiProviderCostLimitUsdPerHour: () => 0,
  resolveApiRateLimit: () => 31,
}));
vi.mock("../../lib/billing-service", () => ({
  configuredStripeBilling: () => ({
    availability: {
      enabled: true,
      checkoutAvailable: mocks.checkoutAvailable,
      reason: mocks.checkoutAvailable ? null : "PRODUCTION_LIVE_MODE_REQUIRED",
    },
    createCheckout: mocks.createCheckout,
    findCheckoutForReservation: mocks.findCheckoutForReservation,
    retrieveCheckout: mocks.retrieveCheckout,
  }),
}));
vi.mock("../../lib/scan-view-service", () => ({
  resolveReadyScanIdentity: mocks.resolveReadyScanIdentity,
}));
vi.mock("../../lib/server-database", () => ({
  getBillingRepositories: () => ({
    billing: {
      bindProjectCheckout: mocks.bindProjectCheckout,
      checkoutClaimStatus: mocks.checkoutClaimStatus,
      checkoutForDeliveryClaimRecovery: mocks.checkoutForDeliveryClaimRecovery,
      consumeCheckoutClaim: mocks.consumeCheckoutClaim,
      expireProjectCheckout: mocks.expireProjectCheckout,
      expireUnboundProjectCheckout: mocks.expireUnboundProjectCheckout,
      reserveProjectCheckout: mocks.reserveProjectCheckout,
      rotateProjectCheckoutClaim: mocks.rotateProjectCheckoutClaim,
    },
  }),
}));

import { createCheckoutClaim } from "@trendsfast/billing";
import { BillingCheckoutConflictError } from "@trendsfast/database";
import { GET as claimStatus, POST as consumeClaim } from "../../app/api/billing/claim/route";
import { POST as deliveredCheckout } from "../../app/api/scans/[token]/billing/checkout/route";

const origin = "https://trendsfast.example";
const privateResultToken = "private_result_capability_123456789";
const projectId = "2a7f6ec1-11dd-4b80-b22b-6d1489a20cb9";
const deliveryTokenId = "68f230b4-2437-4374-85a3-849ff13e06d2";
const sessionId = "cs_test_checkoutclaim123";

function checkoutRequest(cookie?: string) {
  return new Request(`${origin}/api/scans/${privateResultToken}/billing/checkout`, {
    method: "POST",
    headers: {
      origin,
      "sec-fetch-site": "same-origin",
      ...(cookie ? { cookie } : {}),
    },
  });
}

function claimRequest(method: "GET" | "POST", rawClaim: string) {
  return new Request(`${origin}/api/billing/claim?session_id=${sessionId}`, {
    method,
    headers: {
      origin,
      "sec-fetch-site": "same-origin",
      cookie: `tf_checkout_claim=${rawClaim}`,
    },
  });
}

function reservation(
  created: boolean,
  claim: {
    checkoutClaimHash: string;
    checkoutClaimExpiresAt: Date;
    expiresAt: Date;
  } = {
    checkoutClaimHash: `sha256:${"a".repeat(64)}`,
    checkoutClaimExpiresAt: new Date(Date.now() + 90 * 60 * 1_000),
    expiresAt: new Date(Date.now() + 60 * 60 * 1_000),
  },
) {
  return {
    created,
    reservation: {
      id: "4a97f6b1-9dcb-4f7e-9a91-9df5f2c066f2",
      projectId,
      stripeCheckoutSessionId: null,
      requestedStripeCustomerId: null,
      createdAt: new Date("2026-08-12T08:00:00.000Z"),
      ...claim,
    },
  };
}

describe("delivered-result billing routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkoutAvailable = true;
    mocks.billingCheckoutEnabled = true;
    mocks.resolveReadyScanIdentity.mockResolvedValue({
      scanRequestId: "5ba369db-80df-4473-9ba1-f55bfb713a66",
      nextMoveId: "1cb9c6e8-dcb2-41ab-8923-a07128624069",
      deliveryTokenId,
      projectId,
      deliveryExpiresAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1_000),
    });
    mocks.reserveProjectCheckout.mockImplementation(async (input) =>
      reservation(true, {
        checkoutClaimHash: input.checkoutClaimHash,
        checkoutClaimExpiresAt: input.checkoutClaimExpiresAt,
        expiresAt: input.expiresAt,
      }),
    );
    mocks.createCheckout.mockResolvedValue({ id: sessionId });
    mocks.bindProjectCheckout.mockResolvedValue({ id: "bound" });
    mocks.checkoutForDeliveryClaimRecovery.mockResolvedValue(null);
    mocks.findCheckoutForReservation.mockResolvedValue(null);
    mocks.retrieveCheckout.mockResolvedValue({
      id: sessionId,
      status: "open",
      url: "https://checkout.stripe.com/c/pay",
    });
  });

  it("recovers a Stripe-create/local-bind failure with one session and the same claim", async () => {
    mocks.bindProjectCheckout.mockRejectedValueOnce(new Error("injected bind failure"));

    const failed = await deliveredCheckout(checkoutRequest(), {
      params: Promise.resolve({ token: privateResultToken }),
    });
    expect(failed.status).toBe(502);
    const setCookie = failed.headers.get("set-cookie");
    expect(setCookie).toMatch(/^tf_checkout_claim=[A-Za-z0-9_-]{43}; Path=\//);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Secure");

    const firstReservationInput = mocks.reserveProjectCheckout.mock.calls[0]?.[0];
    mocks.reserveProjectCheckout.mockResolvedValueOnce(
      reservation(false, {
        checkoutClaimHash: firstReservationInput.checkoutClaimHash,
        checkoutClaimExpiresAt: firstReservationInput.checkoutClaimExpiresAt,
        expiresAt: firstReservationInput.expiresAt,
      }),
    );
    mocks.findCheckoutForReservation.mockResolvedValueOnce({
      id: sessionId,
      status: "open",
      url: "https://checkout.stripe.com/c/pay",
    });
    const retried = await deliveredCheckout(checkoutRequest(setCookie?.split(";", 1)[0]), {
      params: Promise.resolve({ token: privateResultToken }),
    });

    expect(retried.status).toBe(201);
    expect(mocks.createCheckout).toHaveBeenCalledTimes(1);
    expect(mocks.findCheckoutForReservation).toHaveBeenCalledTimes(1);
    expect(mocks.bindProjectCheckout).toHaveBeenCalledTimes(2);
    const reservationInputs = mocks.reserveProjectCheckout.mock.calls.map(([input]) => input);
    expect(reservationInputs[0].checkoutClaimHash).toBe(reservationInputs[1].checkoutClaimHash);
    const rawClaim = setCookie?.match(/^tf_checkout_claim=([A-Za-z0-9_-]{43})/)?.[1];
    expect(rawClaim).toBeTruthy();
    expect(JSON.stringify(mocks.createCheckout.mock.calls)).not.toContain(rawClaim);
    expect(JSON.stringify(mocks.createCheckout.mock.calls)).not.toContain(privateResultToken);
    expect(await retried.json()).toEqual({
      ok: true,
      url: "https://checkout.stripe.com/c/pay",
    });
  });

  it("recovers a lost start response without a cookie only after reusing its open session", async () => {
    const lost = await deliveredCheckout(checkoutRequest(), {
      params: Promise.resolve({ token: privateResultToken }),
    });
    expect(lost.status).toBe(201);
    const lostCookie = lost.headers.get("set-cookie");
    const firstReservationInput = mocks.reserveProjectCheckout.mock.calls[0]?.[0];
    const recoveryReservation = {
      ...reservation(false, {
        checkoutClaimHash: firstReservationInput.checkoutClaimHash,
        checkoutClaimExpiresAt: firstReservationInput.checkoutClaimExpiresAt,
        expiresAt: firstReservationInput.expiresAt,
      }).reservation,
      stripeCheckoutSessionId: sessionId,
    };
    mocks.reserveProjectCheckout.mockRejectedValueOnce(
      new BillingCheckoutConflictError("CHECKOUT_ALREADY_OPEN"),
    );
    mocks.checkoutForDeliveryClaimRecovery.mockResolvedValueOnce(recoveryReservation);
    mocks.rotateProjectCheckoutClaim.mockImplementationOnce(async (input) => ({
      ...recoveryReservation,
      checkoutClaimHash: input.checkoutClaimHash,
    }));

    const recovered = await deliveredCheckout(checkoutRequest(), {
      params: Promise.resolve({ token: privateResultToken }),
    });

    expect(recovered.status).toBe(201);
    const recoveredCookie = recovered.headers.get("set-cookie");
    expect(recoveredCookie).toMatch(/^tf_checkout_claim=[A-Za-z0-9_-]{43}; Path=\//);
    expect(recoveredCookie).not.toBe(lostCookie);
    expect(mocks.checkoutForDeliveryClaimRecovery).toHaveBeenCalledWith({
      projectId,
      initiatedBy: `delivery:${deliveryTokenId}`,
    });
    expect(mocks.rotateProjectCheckoutClaim).toHaveBeenCalledWith(
      expect.objectContaining({
        reservationId: recoveryReservation.id,
        projectId,
        initiatedBy: `delivery:${deliveryTokenId}`,
        stripeCheckoutSessionId: sessionId,
        expectedCheckoutClaimHash: firstReservationInput.checkoutClaimHash,
        checkoutClaimHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      }),
    );
    expect(mocks.rotateProjectCheckoutClaim.mock.calls[0]?.[0].checkoutClaimHash).not.toBe(
      firstReservationInput.checkoutClaimHash,
    );
    expect(mocks.retrieveCheckout.mock.invocationCallOrder.at(-1)).toBeLessThan(
      mocks.rotateProjectCheckoutClaim.mock.invocationCallOrder[0] ?? 0,
    );
    expect(mocks.createCheckout).toHaveBeenCalledTimes(1);
    expect(mocks.findCheckoutForReservation).not.toHaveBeenCalled();
    const recoveredRawClaim = recoveredCookie?.match(/^tf_checkout_claim=([A-Za-z0-9_-]{43})/)?.[1];
    expect(recoveredRawClaim).toBeTruthy();
    expect(JSON.stringify(mocks.createCheckout.mock.calls)).not.toContain(recoveredRawClaim);
    expect(JSON.stringify(mocks.rotateProjectCheckoutClaim.mock.calls)).not.toContain(
      recoveredRawClaim,
    );
  });

  it("does not create a Checkout for an invalid private delivery capability", async () => {
    mocks.resolveReadyScanIdentity.mockResolvedValueOnce(null);
    const response = await deliveredCheckout(checkoutRequest(), {
      params: Promise.resolve({ token: privateResultToken }),
    });
    expect(response.status).toBe(404);
    expect(mocks.reserveProjectCheckout).not.toHaveBeenCalled();
    expect(mocks.createCheckout).not.toHaveBeenCalled();
  });

  it("blocks Checkout and claim issuance when the deployment cannot use its Stripe mode", async () => {
    mocks.checkoutAvailable = false;
    const checkout = await deliveredCheckout(checkoutRequest(), {
      params: Promise.resolve({ token: privateResultToken }),
    });
    expect(checkout.status).toBe(503);
    expect(mocks.resolveReadyScanIdentity).not.toHaveBeenCalled();
    expect(mocks.reserveProjectCheckout).not.toHaveBeenCalled();

    const { rawClaim } = createCheckoutClaim();
    expect((await claimStatus(claimRequest("GET", rawClaim))).status).toBe(503);
    expect((await consumeClaim(claimRequest("POST", rawClaim))).status).toBe(503);
    expect(mocks.checkoutClaimStatus).not.toHaveBeenCalled();
    expect(mocks.consumeCheckoutClaim).not.toHaveBeenCalled();
  });

  it("stops Checkout and claim activation at the independent kill switch before billing work", async () => {
    mocks.billingCheckoutEnabled = false;

    const checkout = await deliveredCheckout(checkoutRequest(), {
      params: Promise.resolve({ token: privateResultToken }),
    });

    expect(checkout.status).toBe(503);
    expect(mocks.resolveReadyScanIdentity).not.toHaveBeenCalled();
    expect(mocks.reserveProjectCheckout).not.toHaveBeenCalled();
    expect(mocks.createCheckout).not.toHaveBeenCalled();

    const { rawClaim } = createCheckoutClaim();
    expect((await claimStatus(claimRequest("GET", rawClaim))).status).toBe(503);
    expect((await consumeClaim(claimRequest("POST", rawClaim))).status).toBe(503);
    expect(mocks.checkoutClaimStatus).not.toHaveBeenCalled();
    expect(mocks.consumeCheckoutClaim).not.toHaveBeenCalled();
  });

  it("does not create a chargeable session when the delivery expires before its claim window", async () => {
    mocks.resolveReadyScanIdentity.mockResolvedValueOnce({
      scanRequestId: "5ba369db-80df-4473-9ba1-f55bfb713a66",
      nextMoveId: "1cb9c6e8-dcb2-41ab-8923-a07128624069",
      deliveryTokenId,
      projectId,
      deliveryExpiresAt: new Date(Date.now() + 10 * 60 * 1_000),
    });
    const response = await deliveredCheckout(checkoutRequest(), {
      params: Promise.resolve({ token: privateResultToken }),
    });
    expect(response.status).toBe(409);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(mocks.reserveProjectCheckout).not.toHaveBeenCalled();
    expect(mocks.createCheckout).not.toHaveBeenCalled();
  });

  it("keeps a 30-minute claim grace after the chargeable Session closes", async () => {
    const before = Date.now();
    const response = await deliveredCheckout(checkoutRequest(), {
      params: Promise.resolve({ token: privateResultToken }),
    });
    expect(response.status).toBe(201);
    const input = mocks.reserveProjectCheckout.mock.calls[0]?.[0];
    expect(input.checkoutClaimExpiresAt.getTime() - input.expiresAt.getTime()).toBe(
      30 * 60 * 1_000,
    );
    expect(input.checkoutClaimExpiresAt.getTime()).toBeGreaterThan(before + 60 * 60 * 1_000);
    expect(response.headers.get("set-cookie")).toContain(
      `Expires=${input.checkoutClaimExpiresAt.toUTCString()}`,
    );
  });

  it("keeps the claim while waiting, then clears it after the one-time issuance", async () => {
    const { rawClaim } = createCheckoutClaim();
    mocks.checkoutClaimStatus
      .mockResolvedValueOnce({
        claimConsumedAt: null,
        issuedApiKeyId: null,
        entitlementActive: false,
      })
      .mockResolvedValueOnce({
        claimConsumedAt: new Date(),
        issuedApiKeyId: "3aaf989e-c320-4f6e-9403-aa1baace8b94",
        entitlementActive: true,
      });

    const waiting = await claimStatus(claimRequest("GET", rawClaim));
    expect(waiting.status).toBe(202);
    expect(waiting.headers.get("set-cookie")).toBeNull();
    expect(await waiting.json()).toEqual({
      state: "WAITING_FOR_WEBHOOK",
      pollAfterSeconds: 3,
    });

    const consumed = await claimStatus(claimRequest("GET", rawClaim));
    expect(consumed.status).toBe(200);
    expect(consumed.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(consumed.headers.get("set-cookie")).toContain("Path=/");

    mocks.consumeCheckoutClaim.mockResolvedValueOnce({
      status: "ISSUED",
      rawKey: "tf_test_secret_shown_once",
      visiblePrefix: "tf_test_abcd",
      expiresAt: new Date("2026-09-12T00:00:00.000Z"),
    });
    const issued = await consumeClaim(claimRequest("POST", rawClaim));
    expect(issued.status).toBe(201);
    expect(issued.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(await issued.json()).toMatchObject({
      state: "KEY_ISSUED",
      rawKey: "tf_test_secret_shown_once",
      secretShownOnce: true,
    });
    expect(mocks.consumeCheckoutClaim).toHaveBeenCalledWith(
      expect.objectContaining({
        environment: "test",
        rateLimitPerHour: 31,
        providerCostLimitUsd: 0,
      }),
    );
  });

  it("never replays raw key material for an already-consumed claim", async () => {
    const { rawClaim } = createCheckoutClaim();
    mocks.consumeCheckoutClaim.mockResolvedValueOnce({
      status: "ALREADY_CONSUMED",
      visiblePrefix: "tf_live_abcd",
    });
    const response = await consumeClaim(claimRequest("POST", rawClaim));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ state: "KEY_ALREADY_ISSUED", visiblePrefix: "tf_live_abcd" });
    expect(body).not.toHaveProperty("rawKey");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});
