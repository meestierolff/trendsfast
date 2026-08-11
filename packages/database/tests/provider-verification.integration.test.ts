import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import {
  createDatabaseFromEnv,
  createRepositories,
  providerVerificationRecords,
} from "../src/index";

const databaseDescribe = process.env.RUN_DATABASE_INTEGRATION === "1" ? describe : describe.skip;

databaseDescribe("durable provider verification truth", () => {
  const client = createDatabaseFromEnv();
  const repositories = createRepositories(client.db);
  const actorId = `integration-provider-verification:${randomUUID()}`;

  afterAll(async () => {
    await client.db
      .delete(providerVerificationRecords)
      .where(eq(providerVerificationRecords.initiatedBy, actorId));
    await client.close();
  });

  it("keeps preview truth separate and strips secrets from stored canonical URLs", async () => {
    await expect(
      repositories.providerVerifications.begin({
        source: "github",
        provider: "GitHub",
        credentialMode: "managed",
        deploymentEnvironment: "production",
        initiatedBy: actorId,
      }),
    ).rejects.toThrow();

    const productionStarted = await repositories.providerVerifications.begin({
      source: "github",
      provider: "GitHub",
      credentialMode: "managed",
      deploymentEnvironment: "production",
      releaseSha: "9afad5e123456789",
      deploymentHost: "trendsfast.example",
      deploymentId: "production_123",
      initiatedBy: actorId,
      startedAt: new Date("2026-08-11T12:00:00.000Z"),
    });
    const production = await repositories.providerVerifications.complete({
      id: productionStarted.id,
      state: "VERIFIED",
      healthStatus: "HEALTHY",
      readbackVerified: true,
      canonicalUrls: [
        "https://github.com/openai/openai-node?utm_source=ops&access_token=tf_live_prefix.raw-secret#private",
      ],
      checkedAt: new Date("2026-08-11T12:00:01.000Z"),
      completedAt: new Date("2026-08-11T12:00:01.000Z"),
    });
    expect(production.canonicalUrls).toEqual([
      "https://github.com/openai/openai-node?utm_source=ops",
    ]);

    const previewStarted = await repositories.providerVerifications.begin({
      source: "github",
      provider: "GitHub",
      credentialMode: "managed",
      deploymentEnvironment: "preview",
      releaseSha: "preview5e123456789",
      deploymentHost: "preview.trendsfast.example",
      deploymentId: "preview_456",
      initiatedBy: actorId,
      startedAt: new Date("2026-08-11T13:00:00.000Z"),
    });
    const preview = await repositories.providerVerifications.complete({
      id: previewStarted.id,
      state: "VERIFIED",
      healthStatus: "HEALTHY",
      readbackVerified: true,
      canonicalUrls: ["https://github.com/openai/openai-node"],
      checkedAt: new Date("2026-08-11T13:00:01.000Z"),
      completedAt: new Date("2026-08-11T13:00:01.000Z"),
    });

    const latestAny = await repositories.providerVerifications.latestBySource();
    const latestProduction = await repositories.providerVerifications.latestProductionBySource();
    expect(latestAny.find((record) => record.source === "github")?.id).toBe(preview.id);
    expect(latestProduction.find((record) => record.source === "github")?.id).toBe(production.id);
    expect(JSON.stringify([production, preview])).not.toContain("raw-secret");
  });
});
