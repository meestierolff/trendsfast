import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  createCheckout: vi.fn(),
  createPortal: vi.fn(),
  getProject: vi.fn(),
  entitlementForProject: vi.fn(),
  customerForProject: vi.fn(),
  recordCheckout: vi.fn(),
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
  }),
}));
vi.mock("../../lib/server-database", () => ({
  getRepositories: () => ({
    scanData: { getProject: mocks.getProject },
    billing: {
      entitlementForProject: mocks.entitlementForProject,
      customerForProject: mocks.customerForProject,
      recordCheckout: mocks.recordCheckout,
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
    mocks.entitlementForProject.mockResolvedValue(null);
    mocks.customerForProject.mockResolvedValue(null);
    mocks.recordCheckout.mockResolvedValue({ id: "binding_1" });
    mocks.createCheckout.mockResolvedValue({
      id: "cs_test_1",
      url: "https://checkout.stripe.com/c/pay",
    });
    mocks.createPortal.mockResolvedValue({ url: "https://billing.stripe.com/p/session" });
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

  it("persists the project binding before returning a test Checkout URL", async () => {
    const response = await checkout(request("/api/ops/billing/checkout"));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      ok: true,
      url: "https://checkout.stripe.com/c/pay",
    });
    expect(mocks.createCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ projectId, actorId: expect.stringMatching(/^founder:/) }),
    );
    expect(mocks.recordCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ projectId, stripeCheckoutSessionId: "cs_test_1" }),
    );
  });

  it("can safely retry when Stripe succeeded before the durable binding write", async () => {
    mocks.recordCheckout
      .mockRejectedValueOnce(new Error("temporary database error"))
      .mockResolvedValueOnce({ id: "binding_1" });
    expect(await checkout(request("/api/ops/billing/checkout"))).toMatchObject({ status: 502 });
    expect(await checkout(request("/api/ops/billing/checkout"))).toMatchObject({ status: 201 });
    expect(mocks.createCheckout).toHaveBeenCalledTimes(2);
    expect(mocks.recordCheckout).toHaveBeenLastCalledWith(
      expect.objectContaining({ stripeCheckoutSessionId: "cs_test_1" }),
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
