import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  env: {
    APP_URL: "https://trendsfast.example",
    BILLING_ENABLED: true,
    PAID_MONITORING_ENABLED: true,
    STRIPE_MODE: "test" as "test" | "live",
    STRIPE_SANDBOX_KEY_ROTATED: "YES" as "YES" | undefined,
    I_UNDERSTAND_LIVE_STRIPE: undefined as "YES" | undefined,
    STRIPE_LIVE_ENABLEMENT_APPROVED: undefined as "YES" | undefined,
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
    availability: {
      enabled: mocks.env.BILLING_ENABLED && mocks.env.PAID_MONITORING_ENABLED,
      checkoutAvailable:
        mocks.env.BILLING_ENABLED &&
        mocks.env.PAID_MONITORING_ENABLED &&
        (mocks.env.STRIPE_MODE === "test"
          ? mocks.env.STRIPE_SANDBOX_KEY_ROTATED === "YES" &&
            mocks.env.PROVIDER_CREDENTIAL_MODE === "fixture" &&
            mocks.deploymentEnvironment !== "production"
          : mocks.env.I_UNDERSTAND_LIVE_STRIPE === "YES" &&
            mocks.env.STRIPE_LIVE_ENABLEMENT_APPROVED === "YES" &&
            mocks.env.PROVIDER_CREDENTIAL_MODE !== "fixture" &&
            mocks.deploymentEnvironment === "production"),
      reason: null,
    },
    parseWebhook: mocks.parseWebhook,
  }),
  normalizeStripeEvent: vi.fn(),
}));
vi.mock("../../lib/server-database", () => ({
  getBillingRepositories: () => ({ billing: { projectWebhook: mocks.projectWebhook } }),
}));

import {
  projectStripeWebhook,
  StripeWebhookUnavailableError,
  StripeWebhookVerificationError,
} from "../../lib/billing-service";

describe("Stripe webhook deployment boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.env.STRIPE_MODE = "test";
    mocks.env.STRIPE_SANDBOX_KEY_ROTATED = "YES";
    mocks.env.PROVIDER_CREDENTIAL_MODE = "fixture";
    mocks.env.BILLING_ENABLED = true;
    mocks.env.PAID_MONITORING_ENABLED = true;
    mocks.env.I_UNDERSTAND_LIVE_STRIPE = undefined;
    mocks.env.STRIPE_LIVE_ENABLEMENT_APPROVED = undefined;
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

  it("rejects every sandbox webhook projection before the compromised key is confirmed rotated", async () => {
    mocks.env.STRIPE_SANDBOX_KEY_ROTATED = undefined;

    await expect(
      projectStripeWebhook({ rawBody: new Uint8Array(), signature: "signed" }),
    ).rejects.toBeInstanceOf(StripeWebhookVerificationError);
    expect(mocks.parseWebhook).not.toHaveBeenCalled();
    expect(mocks.projectWebhook).not.toHaveBeenCalled();
  });

  it.each([
    ["BILLING_ENABLED", false],
    ["PAID_MONITORING_ENABLED", false],
  ] as const)("rejects projection when %s is disabled", async (field, value) => {
    mocks.env[field] = value;

    await expect(
      projectStripeWebhook({ rawBody: new Uint8Array(), signature: "signed" }),
    ).rejects.toBeInstanceOf(StripeWebhookUnavailableError);
    expect(mocks.parseWebhook).not.toHaveBeenCalled();
    expect(mocks.projectWebhook).not.toHaveBeenCalled();
  });

  it.each(["I_UNDERSTAND_LIVE_STRIPE", "STRIPE_LIVE_ENABLEMENT_APPROVED"] as const)(
    "rejects live projection when %s is missing",
    async (missingApproval) => {
      mocks.env.STRIPE_MODE = "live";
      mocks.env.PROVIDER_CREDENTIAL_MODE = "managed";
      mocks.env.I_UNDERSTAND_LIVE_STRIPE = "YES";
      mocks.env.STRIPE_LIVE_ENABLEMENT_APPROVED = "YES";
      mocks.env[missingApproval] = undefined;
      mocks.deploymentEnvironment = "production";

      await expect(
        projectStripeWebhook({ rawBody: new Uint8Array(), signature: "signed" }),
      ).rejects.toBeInstanceOf(StripeWebhookUnavailableError);
      expect(mocks.parseWebhook).not.toHaveBeenCalled();
      expect(mocks.projectWebhook).not.toHaveBeenCalled();
    },
  );
});
