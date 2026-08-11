import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  createCheckout: vi.fn(),
  reserveProjectCheckout: vi.fn(),
  bindProjectCheckout: vi.fn(),
  expireProjectCheckout: vi.fn(),
  expireUnboundProjectCheckout: vi.fn(),
  createPortal: vi.fn(),
  retrieveCheckout: vi.fn(),
  findCheckoutForReservation: vi.fn(),
  getProject: vi.fn(),
  customerForProject: vi.fn(),
}));

vi.mock("@trendsfast/config", () => ({
  loadEnv: () => ({
    APP_URL: "https://trendsfast.example",
    BILLING_ENABLED: true,
    PAID_MONITORING_ENABLED: true,
    STRIPE_MODE: "test",
  }),
}));
vi.mock("../../lib/billing-service", () => ({
  configuredStripeBilling: () => ({
    availability: { enabled: true, checkoutAvailable: true, reason: null },
    createCheckout: mocks.createCheckout,
    createPortal: mocks.createPortal,
    retrieveCheckout: mocks.retrieveCheckout,
    findCheckoutForReservation: mocks.findCheckoutForReservation,
  }),
}));
vi.mock("../../lib/server-database", () => ({
  getRepositories: () => ({
    scanData: { getProject: mocks.getProject },
    billing: {
      customerForProject: mocks.customerForProject,
      reserveProjectCheckout: mocks.reserveProjectCheckout,
      bindProjectCheckout: mocks.bindProjectCheckout,
      expireProjectCheckout: mocks.expireProjectCheckout,
      expireUnboundProjectCheckout: mocks.expireUnboundProjectCheckout,
    },
  }),
}));

import { BillingCheckoutConflictError } from "@trendsfast/database";
import { createCsrfToken, issueOpsSession } from "../../lib/ops-session";
import { POST as checkout } from "../../app/api/ops/billing/checkout/route";
import { POST as portal } from "../../app/api/ops/billing/portal/route";

const origin = "https://trendsfast.example";
const secret = "ops-billing-session-secret-at-least-32-characters";
const projectId = "2a7f6ec1-11dd-4b80-b22b-6d1489a20cb9";
const previousSessionSecret = process.env.SESSION_SECRET;
const previousAppUrl = process.env.APP_URL;
process.env.SESSION_SECRET = secret;
process.env.APP_URL = origin;

function request(path: string, overrides: { cookie?: string; csrf?: string } = {}) {
  const session = issueOpsSession({ secret });
  return new Request(`${origin}${path}`, {
    method: "POST",
    headers: {
      origin,
      "sec-fetch-site": "same-origin",
      "content-type": "application/json",
      ...(overrides.cookie === "missing"
        ? {}
        : { cookie: `tf_ops_session=${overrides.cookie ?? session}` }),
      "x-csrf-token": overrides.csrf ?? createCsrfToken(session, secret),
    },
    body: JSON.stringify({ projectId }),
  });
}

describe("founder-ops billing routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getProject.mockResolvedValue({ id: projectId, status: "ACTIVE" });
    mocks.customerForProject.mockResolvedValue(null);
    mocks.createCheckout.mockResolvedValue({
      id: "cs_test_1",
    });
    mocks.reserveProjectCheckout.mockResolvedValue({
      created: true,
      reservation: {
        id: "reservation_1",
        projectId,
        stripeCheckoutSessionId: null,
        requestedStripeCustomerId: null,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 60 * 60 * 1_000),
      },
    });
    mocks.bindProjectCheckout.mockResolvedValue({ id: "reservation_1" });
    mocks.createPortal.mockResolvedValue({ url: "https://billing.stripe.com/p/session" });
    mocks.retrieveCheckout.mockResolvedValue({
      id: "cs_test_1",
      status: "open",
      url: "https://checkout.stripe.com/c/pay",
    });
    mocks.findCheckoutForReservation.mockResolvedValue(null);
  });

  afterAll(() => {
    if (previousSessionSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previousSessionSecret;
    if (previousAppUrl === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = previousAppUrl;
  });

  it("requires a signed founder session and session-bound CSRF token", async () => {
    expect(
      await checkout(request("/api/ops/billing/checkout", { cookie: "missing" })),
    ).toMatchObject({
      status: 401,
    });
    expect(await checkout(request("/api/ops/billing/checkout", { csrf: "wrong" }))).toMatchObject({
      status: 403,
    });
    expect(mocks.createCheckout).not.toHaveBeenCalled();
  });

  it("creates and binds Checkout inside the project-scoped database admission", async () => {
    const response = await checkout(request("/api/ops/billing/checkout"));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      ok: true,
      url: "https://checkout.stripe.com/c/pay",
    });
    expect(mocks.createCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ projectId, actorId: expect.stringMatching(/^founder:/) }),
    );
    expect(mocks.reserveProjectCheckout).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId,
        initiatedBy: expect.stringMatching(/^founder:/),
      }),
    );
    expect(mocks.createCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ projectId, reservationId: "reservation_1" }),
    );
    expect(mocks.bindProjectCheckout).toHaveBeenCalledWith(
      expect.objectContaining({
        reservationId: "reservation_1",
        stripeCheckoutSessionId: "cs_test_1",
      }),
    );
  });

  it("returns conflict without calling Stripe for an open Checkout or nonterminal subscription", async () => {
    mocks.reserveProjectCheckout.mockRejectedValueOnce(
      new BillingCheckoutConflictError("CHECKOUT_ALREADY_OPEN"),
    );
    const response = await checkout(request("/api/ops/billing/checkout"));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "This project already has an open Checkout or Founder subscription.",
    });
    expect(mocks.createCheckout).not.toHaveBeenCalled();
  });

  it("reuses a bound reservation without opening another Stripe session", async () => {
    mocks.reserveProjectCheckout.mockResolvedValueOnce({
      created: false,
      reservation: {
        id: "reservation_existing",
        projectId,
        stripeCheckoutSessionId: "cs_test_existing",
        requestedStripeCustomerId: null,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 60 * 60 * 1_000),
      },
    });
    mocks.retrieveCheckout.mockResolvedValueOnce({
      id: "cs_test_existing",
      status: "open",
      url: "https://checkout.stripe.com/c/existing",
    });
    const response = await checkout(request("/api/ops/billing/checkout"));
    expect(response.status).toBe(201);
    expect(mocks.createCheckout).not.toHaveBeenCalled();
    expect(mocks.bindProjectCheckout).not.toHaveBeenCalled();
  });

  it("reconciles a read-back expired session before reserving one replacement", async () => {
    mocks.reserveProjectCheckout
      .mockResolvedValueOnce({
        created: false,
        reservation: {
          id: "reservation_expired",
          projectId,
          stripeCheckoutSessionId: "cs_test_expired",
          requestedStripeCustomerId: null,
          createdAt: new Date(Date.now() - 2 * 60 * 60 * 1_000),
          expiresAt: new Date(Date.now() - 60_000),
        },
      })
      .mockResolvedValueOnce({
        created: true,
        reservation: {
          id: "reservation_replacement",
          projectId,
          stripeCheckoutSessionId: null,
          requestedStripeCustomerId: null,
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 60 * 60 * 1_000),
        },
      });
    mocks.createCheckout.mockResolvedValueOnce({ id: "cs_test_replacement" });
    mocks.retrieveCheckout
      .mockResolvedValueOnce({ id: "cs_test_expired", status: "expired", url: null })
      .mockResolvedValueOnce({
        id: "cs_test_replacement",
        status: "open",
        url: "https://checkout.stripe.com/c/replacement",
      });
    const response = await checkout(request("/api/ops/billing/checkout"));
    expect(response.status).toBe(201);
    expect(mocks.expireProjectCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ reservationId: "reservation_expired" }),
    );
    expect(mocks.createCheckout).toHaveBeenCalledTimes(1);
  });

  it("expires an unbound attempt only after Stripe reservation search finds nothing", async () => {
    mocks.reserveProjectCheckout
      .mockResolvedValueOnce({
        created: false,
        reservation: {
          id: "reservation_unbound_expired",
          projectId,
          stripeCheckoutSessionId: null,
          requestedStripeCustomerId: null,
          createdAt: new Date(Date.now() - 2 * 60 * 60 * 1_000),
          expiresAt: new Date(Date.now() - 60_000),
        },
      })
      .mockResolvedValueOnce({
        created: true,
        reservation: {
          id: "reservation_after_unbound",
          projectId,
          stripeCheckoutSessionId: null,
          requestedStripeCustomerId: null,
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 60 * 60 * 1_000),
        },
      });
    mocks.createCheckout.mockResolvedValueOnce({ id: "cs_test_after_unbound" });
    mocks.retrieveCheckout.mockResolvedValueOnce({
      id: "cs_test_after_unbound",
      status: "open",
      url: "https://checkout.stripe.com/c/after-unbound",
    });
    const response = await checkout(request("/api/ops/billing/checkout"));
    expect(response.status).toBe(201);
    expect(mocks.findCheckoutForReservation).toHaveBeenCalledWith(
      expect.objectContaining({ reservationId: "reservation_unbound_expired" }),
    );
    expect(mocks.expireUnboundProjectCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ reservationId: "reservation_unbound_expired" }),
    );
    expect(mocks.createCheckout).toHaveBeenCalledTimes(1);
  });

  it("binds and reuses the remote session found for an expired unbound attempt", async () => {
    mocks.reserveProjectCheckout.mockResolvedValueOnce({
      created: false,
      reservation: {
        id: "reservation_unknown_effect",
        projectId,
        stripeCheckoutSessionId: null,
        requestedStripeCustomerId: null,
        createdAt: new Date(Date.now() - 2 * 60 * 60 * 1_000),
        expiresAt: new Date(Date.now() - 60_000),
      },
    });
    mocks.findCheckoutForReservation.mockResolvedValueOnce({
      id: "cs_test_unknown_effect",
      status: "open",
      url: "https://checkout.stripe.com/c/unknown-effect",
    });
    mocks.retrieveCheckout.mockResolvedValueOnce({
      id: "cs_test_unknown_effect",
      status: "open",
      url: "https://checkout.stripe.com/c/unknown-effect",
    });

    const response = await checkout(request("/api/ops/billing/checkout"));

    expect(response.status).toBe(201);
    expect(mocks.createCheckout).not.toHaveBeenCalled();
    expect(mocks.expireUnboundProjectCheckout).not.toHaveBeenCalled();
    expect(mocks.bindProjectCheckout).toHaveBeenCalledWith(
      expect.objectContaining({
        reservationId: "reservation_unknown_effect",
        stripeCheckoutSessionId: "cs_test_unknown_effect",
      }),
    );
  });

  it("opens Customer Portal only for the customer bound to the authorized project", async () => {
    mocks.customerForProject.mockResolvedValue({ stripeCustomerId: "cus_test_1" });
    const response = await portal(request("/api/ops/billing/portal"));
    expect(response.status).toBe(200);
    expect(mocks.createPortal).toHaveBeenCalledWith("cus_test_1");
    expect(await response.json()).toEqual({
      ok: true,
      url: "https://billing.stripe.com/p/session",
    });
  });
});
