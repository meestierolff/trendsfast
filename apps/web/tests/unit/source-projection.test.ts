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
    healthStatus: "HEALTHY",
    readbackVerified: true,
    canonicalUrlCount: 1,
    latencyMs: 50,
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
    expect(serialized).not.toContain("releaseSha");
    expect(serialized).not.toContain("estimatedCostUsd");
    expect(serialized).not.toContain("actualCostUsd");
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
      canonicalUrlCount: 0,
    };
    const website = projectPublicSourceStatuses([failed], currentProduction).find(
      (source) => source.slug === "website",
    );
    expect(website).toMatchObject({
      publicLabel: "Unavailable",
      productionVerified: false,
      lastVerifiedAt: "2026-08-11T12:00:00.000Z",
    });
    expect(JSON.stringify(website)).not.toContain("failureMessage");
  });

  it("does not project truth when the public deployment identity is incomplete", () => {
    const incompleteDeployment = {
      ...currentProduction,
      deploymentId: null,
    };
    const website = projectPublicSourceStatuses([record("production")], incompleteDeployment).find(
      (source) => source.slug === "website",
    );
    expect(website).toMatchObject({
      publicLabel: "Coming soon",
      productionVerified: false,
      technicalState: "UNVERIFIED",
      readBackEvidence: null,
    });
  });

  it("never upgrades a legal-review source from a technical verification row", () => {
    const reddit = projectPublicSourceStatuses(
      [{ ...record("production"), source: "reddit", provider: "Technical probe" }],
      currentProduction,
    ).find((source) => source.slug === "reddit");
    expect(reddit).toMatchObject({
      publicLabel: "Permission required",
      productionVerified: false,
      technicalState: "LEGAL_REVIEW",
      readBackEvidence: null,
    });
  });
});
