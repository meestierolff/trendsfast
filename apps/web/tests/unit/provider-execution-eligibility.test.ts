import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({ latestPublicProductionBySource: vi.fn() }));

vi.mock("../../lib/deployment-provenance", () => ({
  deploymentProvenance: () => ({
    deploymentEnvironment: "production",
    releaseSha: "9afad5e123456789",
    deploymentHost: "trendsfast-current.vercel.app",
    deploymentId: "dpl_Current123",
  }),
}));
vi.mock("../../lib/server-database", () => ({
  getPublicRepositories: () => ({
    providerVerifications: {
      latestPublicProductionBySource: mocks.latestPublicProductionBySource,
    },
  }),
}));

import type { Environment } from "@trendsfast/config";
import { createLiveProviderRegistry, createProviderContext } from "@trendsfast/providers";

import {
  loadProviderExecutionEligibility,
  projectProviderExecutionEligibility,
} from "../../lib/provider-execution-eligibility";

const registry = createLiveProviderRegistry();
const deployment = {
  deploymentEnvironment: "production" as const,
  releaseSha: "9afad5e123456789",
  deploymentHost: "trendsfast-current.vercel.app",
  deploymentId: "dpl_Current123",
};
const credentialEnvironment = {
  DATAFORSEO_LOGIN: "configured-login",
  DATAFORSEO_PASSWORD: "configured-password",
  XAI_API_KEY: "configured-x-key",
  XAI_MODEL: "configured-x-model",
  TAVILY_API_KEY: "configured-tavily-key",
  YOUTUBE_API_KEY: "configured-youtube-key",
};

function verified(source: Exclude<keyof typeof providers, "manual">) {
  return {
    source,
    provider: providers[source],
    state: "VERIFIED",
    credentialMode: "managed",
    deploymentEnvironment: "production",
    healthStatus: "HEALTHY",
    readbackVerified: true,
    canonicalUrlCount: 1,
  };
}

const providers = {
  website: "Product website",
  google_trends: "Google Trends",
  hacker_news: "Hacker News",
  github: "GitHub",
  x: "X",
  tavily: "Open web/news",
  youtube: "YouTube",
  manual: "Manual founder evidence",
} as const;

describe("exact-deployment provider execution eligibility", () => {
  beforeEach(() => mocks.latestPublicProductionBySource.mockReset());

  it("allows only configured exact healthy read-backs and keeps manual explicit", () => {
    const eligibility = projectProviderExecutionEligibility({
      credentialMode: "managed",
      credentialEnvironment,
      registry,
      deployment,
      lookupState: "available",
      records: [verified("website"), verified("google_trends"), verified("github")],
    });

    expect(eligibility.get("website")).toEqual({ eligible: true });
    expect(eligibility.get("google_trends")).toEqual({ eligible: true });
    expect(eligibility.get("github")).toEqual({ eligible: true });
    expect(eligibility.get("hacker_news")).toMatchObject({
      eligible: false,
      code: "PROVIDER_NOT_PRODUCTION_VERIFIED",
    });
    expect(eligibility.get("manual")).toMatchObject({
      eligible: false,
      code: "PROVIDER_MANUAL_INPUT_REQUIRED",
    });
  });

  it("fails closed for missing credentials before an otherwise verified record", () => {
    const eligibility = projectProviderExecutionEligibility({
      credentialMode: "managed",
      credentialEnvironment: { ...credentialEnvironment, DATAFORSEO_PASSWORD: "" },
      registry,
      deployment,
      lookupState: "available",
      records: [verified("google_trends")],
    });

    expect(eligibility.get("google_trends")).toMatchObject({
      eligible: false,
      code: "PROVIDER_UNCONFIGURED",
    });
    expect(JSON.stringify(eligibility.get("google_trends"))).not.toContain("configured-login");
  });

  it.each([
    ["DEGRADED", "HEALTHY", true, 1],
    ["VERIFIED", "DEGRADED", true, 1],
    ["VERIFIED", "HEALTHY", false, 1],
    ["VERIFIED", "HEALTHY", true, 0],
  ] as const)(
    "blocks non-exact verification truth (%s/%s/readback=%s/urls=%s)",
    (state, healthStatus, readbackVerified, canonicalUrlCount) => {
      const eligibility = projectProviderExecutionEligibility({
        credentialMode: "managed",
        credentialEnvironment,
        registry,
        deployment,
        lookupState: "available",
        records: [
          {
            ...verified("github"),
            state,
            healthStatus,
            readbackVerified,
            canonicalUrlCount,
          },
        ],
      });
      expect(eligibility.get("github")).toMatchObject({
        eligible: false,
        code: "PROVIDER_NOT_PRODUCTION_VERIFIED",
      });
    },
  );

  it("blocks credential-mode and provider-identity mismatches", () => {
    const eligibility = projectProviderExecutionEligibility({
      credentialMode: "managed",
      credentialEnvironment,
      registry,
      deployment,
      lookupState: "available",
      records: [
        { ...verified("github"), credentialMode: "byok" },
        { ...verified("website"), provider: "Unexpected provider" },
      ],
    });

    expect(eligibility.get("github")).toMatchObject({
      eligible: false,
      code: "PROVIDER_NOT_PRODUCTION_VERIFIED",
    });
    expect(eligibility.get("website")).toMatchObject({
      eligible: false,
      code: "PROVIDER_NOT_PRODUCTION_VERIFIED",
    });
  });

  it("distinguishes unavailable deployment identity and projection failure", () => {
    const identityUnavailable = projectProviderExecutionEligibility({
      credentialMode: "managed",
      credentialEnvironment,
      registry,
      deployment: { ...deployment, deploymentId: null },
      lookupState: "identity_unavailable",
      records: [],
    });
    const lookupFailed = projectProviderExecutionEligibility({
      credentialMode: "managed",
      credentialEnvironment,
      registry,
      deployment,
      lookupState: "lookup_failed",
      records: [],
    });

    expect(identityUnavailable.get("website")).toMatchObject({
      eligible: false,
      code: "PROVIDER_DEPLOYMENT_IDENTITY_UNAVAILABLE",
    });
    expect(lookupFailed.get("website")).toMatchObject({
      eligible: false,
      code: "PROVIDER_VERIFICATION_UNAVAILABLE",
    });
  });

  it("preserves deterministic fixture execution without a production lookup", () => {
    const eligibility = projectProviderExecutionEligibility({
      credentialMode: "fixture",
      credentialEnvironment: {},
      registry,
      deployment: {
        deploymentEnvironment: "local",
        releaseSha: null,
        deploymentHost: null,
        deploymentId: null,
      },
      lookupState: "identity_unavailable",
      records: [],
    });

    expect([...eligibility.values()].every((entry) => entry.eligible)).toBe(true);
  });

  it("queries the exact public projection and fails closed when that read is unavailable", async () => {
    const websiteRegistry = new Map([["website" as const, registry.get("website")!]]);
    const context = createProviderContext({
      credentialMode: "managed",
      env: credentialEnvironment,
    });
    const env = { PROVIDER_CREDENTIAL_MODE: "managed" } as Environment;
    mocks.latestPublicProductionBySource.mockResolvedValueOnce([verified("website")]);

    await expect(
      loadProviderExecutionEligibility({ env, context, registry: websiteRegistry }),
    ).resolves.toEqual(new Map([["website", { eligible: true }]]));
    expect(mocks.latestPublicProductionBySource).toHaveBeenCalledWith({
      releaseSha: deployment.releaseSha,
      deploymentHost: deployment.deploymentHost,
      deploymentId: deployment.deploymentId,
    });

    mocks.latestPublicProductionBySource.mockRejectedValueOnce(new Error("projection unavailable"));
    const denied = await loadProviderExecutionEligibility({
      env,
      context,
      registry: websiteRegistry,
    });
    expect(denied.get("website")).toMatchObject({
      eligible: false,
      code: "PROVIDER_VERIFICATION_UNAVAILABLE",
    });
  });
});
