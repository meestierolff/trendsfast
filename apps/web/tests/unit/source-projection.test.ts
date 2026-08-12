import { describe, expect, it } from "vitest";

import {
  projectPublicSourceStatuses,
  type SourceVerificationView,
} from "../../lib/source-projection-model";

function record(
  deploymentEnvironment: SourceVerificationView["deploymentEnvironment"],
): SourceVerificationView {
  return {
    source: "website",
    provider: "Direct fetch",
    state: "VERIFIED",
    credentialMode: "managed",
    deploymentEnvironment,
    releaseSha: "9afad5e123456789",
    deploymentHost: "trendsfast.example",
    deploymentId: "deployment_123",
    healthStatus: "HEALTHY",
    readbackVerified: true,
    canonicalUrls: ["https://private-founder.example"],
    latencyMs: 50,
    estimatedCostUsd: "0.000000",
    actualCostUsd: "0.000000",
    quotaUsed: "0.0000",
    limitations: [],
    failureCode: null,
    failureMessage: null,
    checkedAt: new Date("2026-08-11T12:00:00.000Z"),
    completedAt: new Date("2026-08-11T12:00:00.000Z"),
  };
}

const currentProduction = {
  deploymentEnvironment: "production" as const,
  releaseSha: "9afad5e123456789",
  deploymentHost: "trendsfast.example",
  deploymentId: "deployment_123",
};

const nonProduction = {
  deploymentEnvironment: "local" as const,
  releaseSha: null,
  deploymentHost: null,
  deploymentId: null,
};

describe("public source projection", () => {
  it.each(["local", "preview"] as const)(
    "does not upgrade a %s read-back to Connected",
    (environment) => {
      const website = projectPublicSourceStatuses([record(environment)], nonProduction).find(
        (source) => source.slug === "website",
      );
      expect(website).toMatchObject({
        publicLabel: "Coming soon",
        productionVerified: false,
        technicalState: "UNVERIFIED",
      });
    },
  );

  it("upgrades only an identified production read-back", () => {
    const website = projectPublicSourceStatuses([record("production")], currentProduction).find(
      (source) => source.slug === "website",
    );
    expect(website).toMatchObject({
      publicLabel: "Connected",
      productionVerified: true,
      lastVerifiedAt: "2026-08-11T12:00:00.000Z",
    });
  });

  it("never presents a degraded production read-back as Connected", () => {
    const degraded = {
      ...record("production"),
      healthStatus: "DEGRADED",
    };
    const website = projectPublicSourceStatuses([degraded], currentProduction).find(
      (source) => source.slug === "website",
    );
    expect(website).toMatchObject({
      publicLabel: "Limited",
      productionVerified: false,
      technicalState: "DEGRADED",
    });
  });

  it("never projects a private canonical target or raw failure message", () => {
    const serialized = JSON.stringify(
      projectPublicSourceStatuses([record("production")], currentProduction),
    );
    expect(serialized).not.toContain("private-founder.example");
    expect(serialized).not.toContain("failureMessage");
    expect(serialized).toContain('"canonicalUrlCount":1');
  });

  it("does not let a newer preview read-back mask prior production truth", () => {
    const production = record("production");
    const preview = {
      ...record("preview"),
      checkedAt: new Date("2026-08-11T13:00:00.000Z"),
      completedAt: new Date("2026-08-11T13:00:00.000Z"),
    };
    const website = projectPublicSourceStatuses([production, preview], currentProduction).find(
      (source) => source.slug === "website",
    );
    expect(website).toMatchObject({
      publicLabel: "Connected",
      productionVerified: true,
      lastVerifiedAt: "2026-08-11T12:00:00.000Z",
    });
  });

  it("projects manual capability as at most Limited from production provenance", () => {
    const manual = {
      ...record("production"),
      source: "manual",
      provider: "MANUAL_FOUNDER_EVIDENCE",
      state: "DEGRADED" as const,
      readbackVerified: false,
    };
    const source = projectPublicSourceStatuses([manual], currentProduction).find(
      (item) => item.slug === "manual",
    );
    expect(source).toMatchObject({
      publicLabel: "Limited",
      productionVerified: false,
      lastVerifiedAt: "2026-08-11T12:00:00.000Z",
    });
  });

  it("projects a failed production check as unavailable without leaking its message", () => {
    const failed = {
      ...record("production"),
      state: "FAILED" as const,
      readbackVerified: false,
      canonicalUrls: [],
      failureCode: "PROVIDER_HEALTH_FAILED",
      failureMessage: "Bearer secret-that-must-not-be-public",
    };
    const website = projectPublicSourceStatuses([failed], currentProduction).find(
      (source) => source.slug === "website",
    );
    expect(website).toMatchObject({
      publicLabel: "Unavailable",
      productionVerified: false,
      lastVerifiedAt: "2026-08-11T12:00:00.000Z",
    });
    expect(JSON.stringify(website)).not.toContain("secret-that-must-not-be-public");
  });

  it("does not carry Connected truth across a different release or deployment", () => {
    const priorRelease = record("production");
    const nextDeployment = {
      ...currentProduction,
      releaseSha: "newrelease1234567",
      deploymentId: "deployment_456",
    };
    const website = projectPublicSourceStatuses([priorRelease], nextDeployment).find(
      (source) => source.slug === "website",
    );
    expect(website).toMatchObject({
      publicLabel: "Coming soon",
      productionVerified: false,
      technicalState: "UNVERIFIED",
      readBackEvidence: null,
    });
  });
});
