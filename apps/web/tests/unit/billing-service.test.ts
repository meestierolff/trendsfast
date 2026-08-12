import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  env: {
    APP_URL: "https://trendsfast.example",
    BILLING_ENABLED: true,
    PAID_MONITORING_ENABLED: true,
    STRIPE_MODE: "test" as "test" | "live",
    PROVIDER_CREDENTIAL_MODE: "fixture" as "fixture" | "managed" | "byok",
  },
  deploymentEnvironment: "preview" as "local" | "preview" | "production",
  parseWebhook: vi.fn(),
  projectWebhook: vi.fn(),
}));

vi.mock("@trendsfast/config", () => ({ loadEnv: () => mocks.env }));
vi.mock("../../lib/deployment-provenance", () => ({
  deploymentProvenance: () => ({ deploymentEnvironment: mocks.deploymentEnvironment }),
}));
vi.mock("@trendsfast/billing", () => ({
  createStripeBilling: () => ({
    availability: { checkoutAvailable: true, reason: null },
    parseWebhook: mocks.parseWebhook,
  }),
  normalizeStripeEvent: vi.fn(),
}));
vi.mock("../../lib/server-database", () => ({
  getRepositories: () => ({ billing: { projectWebhook: mocks.projectWebhook } }),
}));

import { projectStripeWebhook, StripeWebhookVerificationError } from "../../lib/billing-service";

describe("Stripe webhook deployment boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.env.STRIPE_MODE = "test";
    mocks.env.PROVIDER_CREDENTIAL_MODE = "fixture";
    mocks.deploymentEnvironment = "preview";
  });

  it("rejects sandbox webhook projection when a hosted runtime can reach paid providers", async () => {
    mocks.deploymentEnvironment = "production";
    mocks.env.PROVIDER_CREDENTIAL_MODE = "managed";

    await expect(
      projectStripeWebhook({ rawBody: new Uint8Array(), signature: "signed" }),
    ).rejects.toBeInstanceOf(StripeWebhookVerificationError);
    expect(mocks.parseWebhook).not.toHaveBeenCalled();
    expect(mocks.projectWebhook).not.toHaveBeenCalled();
  });
});
