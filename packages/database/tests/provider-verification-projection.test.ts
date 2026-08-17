import { describe, expect, it, vi } from "vitest";

import { ProviderVerificationRepository } from "../src/repositories/provider-verification";

const identity = {
  releaseSha: "a".repeat(40),
  deploymentHost: "public-deployment.example",
  deploymentId: "dpl_public_projection_test",
};

const rawRow = {
  source: "website",
  provider: "Product website",
  state: "VERIFIED",
  credential_mode: "managed",
  deployment_environment: "production",
  health_status: "HEALTHY",
  readback_verified: true,
  canonical_url_count: 1,
  latency_ms: null,
  checked_at: "2026-08-17 19:30:00+00",
  completed_at: "2026-08-17 19:30:01.125+00",
} as const;

function repositoryWithRows(rows: readonly Record<string, unknown>[]) {
  const execute = vi.fn().mockResolvedValue({ rows });
  return {
    execute,
    repository: new ProviderVerificationRepository({ execute } as never),
  };
}

describe("public provider verification projection timestamps", () => {
  it("keeps an empty raw result empty", async () => {
    const { execute, repository } = repositoryWithRows([]);

    await expect(repository.latestPublicProductionBySource(identity)).resolves.toEqual([]);
    expect(execute).toHaveBeenCalledOnce();
  });

  it("parses PostgreSQL TIMESTAMPTZ strings into valid Date values", async () => {
    const { execute, repository } = repositoryWithRows([rawRow]);

    const records = await repository.latestPublicProductionBySource(identity);

    expect(execute).toHaveBeenCalledOnce();
    expect(records).toEqual([
      {
        source: "website",
        provider: "Product website",
        state: "VERIFIED",
        credentialMode: "managed",
        deploymentEnvironment: "production",
        healthStatus: "HEALTHY",
        readbackVerified: true,
        canonicalUrlCount: 1,
        latencyMs: null,
        checkedAt: new Date("2026-08-17T19:30:00.000Z"),
        completedAt: new Date("2026-08-17T19:30:01.125Z"),
      },
    ]);
  });

  it("preserves nullable timestamps", async () => {
    const { repository } = repositoryWithRows([
      { ...rawRow, checked_at: null, completed_at: null },
    ]);

    const [record] = await repository.latestPublicProductionBySource(identity);

    expect(record?.checkedAt).toBeNull();
    expect(record?.completedAt).toBeNull();
  });

  it.each(["checked_at", "completed_at"] as const)(
    "fails closed for an invalid non-null %s value",
    async (field) => {
      const { repository } = repositoryWithRows([{ ...rawRow, [field]: "not-a-timestamp" }]);

      await expect(repository.latestPublicProductionBySource(identity)).rejects.toThrow(
        `Public provider verification ${field} timestamp is invalid`,
      );
    },
  );
});
