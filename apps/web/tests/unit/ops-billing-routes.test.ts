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
  getOpsRepositories: () => ({
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

  it("keeps the legacy founder-ops Checkout path permanently closed", async () => {
    const response = await checkout(request("/api/ops/billing/checkout"));
    expect(response.status).toBe(410);
    expect(await response.json()).toEqual({
      error: "Checkout starts only from a private delivered Next Move.",
    });
    expect(mocks.createCheckout).not.toHaveBeenCalled();
    expect(mocks.reserveProjectCheckout).not.toHaveBeenCalled();
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
