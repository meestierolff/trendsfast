import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import {
  createDatabaseFromEnv,
  createRepositories,
  ProviderVerificationAttemptConflictError,
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

  it("atomically elects one effect owner and durably denies an over-budget attempt", async () => {
    const attemptId = randomUUID();
    const shared = {
      attemptId,
      requestHash: "a".repeat(64),
      source: "tavily" as const,
      provider: "Tavily",
      credentialMode: "managed" as const,
      deploymentEnvironment: "preview" as const,
      releaseSha: "verification-concurrency",
      deploymentHost: "preview.trendsfast.example",
      deploymentId: "preview_verification_concurrency",
      initiatedBy: actorId,
      estimatedCostReservationUsd: 0.2,
      maximumCostUsd: 1,
      startedAt: new Date("2026-08-11T14:00:00.000Z"),
    };
    const results = await Promise.all(
      Array.from({ length: 8 }, () => repositories.providerVerifications.admitAttempt(shared)),
    );
    expect(results.filter((result) => result.created && result.admitted)).toHaveLength(1);
    expect(results.filter((result) => !result.created && !result.admitted)).toHaveLength(7);
    expect(new Set(results.map((result) => result.record.id))).toEqual(new Set([attemptId]));

    const unknown = await repositories.providerVerifications.complete({
      id: attemptId,
      state: "FAILED",
      healthStatus: "FAILED",
      readbackVerified: false,
      failureCode: "VERIFICATION_RUN_FAILED",
      failureMessage: "The provider outcome could not be confirmed.",
      limitations: ["The conservative reservation remains unsettled."],
    });
    expect(unknown).toMatchObject({
      estimatedCostUsd: "0.200000",
      actualCostUsd: null,
      limitations: ["The conservative reservation remains unsettled."],
    });

    await expect(
      repositories.providerVerifications.admitAttempt({
        ...shared,
        requestHash: "b".repeat(64),
      }),
    ).rejects.toBeInstanceOf(ProviderVerificationAttemptConflictError);

    const deniedId = randomUUID();
    const denied = await repositories.providerVerifications.admitAttempt({
      ...shared,
      attemptId: deniedId,
      requestHash: "c".repeat(64),
      estimatedCostReservationUsd: 1.01,
      maximumCostUsd: 1,
    });
    expect(denied).toMatchObject({
      created: true,
      admitted: false,
      record: {
        id: deniedId,
        state: "FAILED",
        failureCode: "VERIFICATION_COST_LIMIT",
        estimatedCostUsd: "0.000000",
      },
    });
    const deniedReplay = await repositories.providerVerifications.admitAttempt({
      ...shared,
      attemptId: deniedId,
      requestHash: "c".repeat(64),
      estimatedCostReservationUsd: 1.01,
      maximumCostUsd: 1,
    });
    expect(deniedReplay).toMatchObject({ created: false, admitted: false });
  });
});
