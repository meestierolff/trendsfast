import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  deploymentProvenance: vi.fn(),
  latestPublicProductionBySource: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("../../lib/deployment-provenance", () => ({
  deploymentProvenance: mocks.deploymentProvenance,
}));

vi.mock("../../lib/server-database", () => ({
  getRepositories: () => ({
    providerVerifications: {
      latestPublicProductionBySource: mocks.latestPublicProductionBySource,
    },
  }),
}));

import {
  listPublicSourceStatuses,
  loadPublicSourceProjection,
} from "../../lib/source-projection-service";

const deployment = {
  deploymentEnvironment: "production" as const,
  releaseSha: "9afad5e123456789",
  deploymentHost: "trendsfast.example",
  deploymentId: "dpl_Production123",
};

const verifiedWebsite = {
  source: "website",
  provider: "Product website",
  state: "VERIFIED" as const,
  credentialMode: "managed",
  deploymentEnvironment: "production" as const,
  healthStatus: "HEALTHY",
  readbackVerified: true,
  canonicalUrlCount: 1,
  latencyMs: null,
  checkedAt: new Date("2026-08-17T12:00:00.000Z"),
  completedAt: new Date("2026-08-17T12:00:01.000Z"),
};

describe("public source projection lookup state", () => {
  beforeEach(() => {
    mocks.deploymentProvenance.mockReset();
    mocks.latestPublicProductionBySource.mockReset();
    mocks.deploymentProvenance.mockReturnValue(deployment);
  });

  it("does not query when exact deployment identity is unavailable", async () => {
    mocks.deploymentProvenance.mockReturnValue({ ...deployment, deploymentId: null });

    const projection = await loadPublicSourceProjection();

    expect(projection.state).toBe("identity_unavailable");
    expect(projection.sources.every((source) => source.readBackEvidence === null)).toBe(true);
    expect(mocks.latestPublicProductionBySource).not.toHaveBeenCalled();
  });

  it("distinguishes a failed lookup from a successful empty lookup", async () => {
    mocks.latestPublicProductionBySource.mockRejectedValueOnce(new Error("private detail"));
    await expect(loadPublicSourceProjection()).resolves.toMatchObject({ state: "lookup_failed" });

    mocks.latestPublicProductionBySource.mockResolvedValueOnce([]);
    await expect(loadPublicSourceProjection()).resolves.toMatchObject({
      state: "lookup_succeeded_empty",
    });
  });

  it("returns available only after exact rows are projected", async () => {
    mocks.latestPublicProductionBySource.mockResolvedValue([verifiedWebsite]);

    const projection = await loadPublicSourceProjection();

    expect(projection.state).toBe("available");
    expect(projection.sources.find((source) => source.slug === "website")).toMatchObject({
      publicLabel: "Connected",
      productionVerified: true,
      readBackEvidence: { canonicalUrlCount: 1 },
    });
    expect(mocks.latestPublicProductionBySource).toHaveBeenCalledWith({
      releaseSha: deployment.releaseSha,
      deploymentHost: deployment.deploymentHost,
      deploymentId: deployment.deploymentId,
    });
    await expect(listPublicSourceStatuses()).resolves.toEqual(projection.sources);
  });
});
