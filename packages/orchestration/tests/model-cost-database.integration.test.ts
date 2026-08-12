import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabaseFromEnv, createRepositories } from "@trendsfast/database";

import { createDatabaseProcessingStore } from "../src/database-store";
import type { ProcessingClaimIdentity } from "../src/state-machine";

const databaseDescribe = process.env.RUN_DATABASE_INTEGRATION === "1" ? describe : describe.skip;

databaseDescribe("fenced model and provider cost persistence", () => {
  const client = createDatabaseFromEnv();
  const repositories = createRepositories(client.db);
  const store = createDatabaseProcessingStore(repositories);
  const url = `https://orchestration-model-cost-${randomUUID()}.example`;
  let claim: ProcessingClaimIdentity | undefined;

  beforeAll(async () => {
    const created = await repositories.scans.createRequest({
      request: { product_url: url },
      origin: "FIXTURE",
    });
    const snapshot = await store.load(created.request.publicId);
    if (!snapshot) throw new Error("Could not load the cost integration scan");
    const claimed = await store.claim(snapshot, new Date(Date.now() + 60_000));
    claim = {
      requestId: claimed.requestId,
      runId: claimed.runId,
      processingFence: claimed.processingFence,
    };
  });

  afterAll(async () => {
    await repositories.privacy.deleteProjectData({ normalizedUrl: new URL(url).toString() });
    await client.close();
  });

  it("persists one idempotent reservation through the processing fence", async () => {
    if (!claim) throw new Error("The cost integration scan was not claimed");
    const reservation = {
      ledgerKey: "model:context:attempt:1",
      provider: "openai",
      model: "priced-model",
      operation: "context" as const,
      attempt: 1,
      inputBytes: 1_000,
      inputTokenUpperBound: 1_256,
      outputTokenUpperBound: 2_048,
      inputUsdPerMillionTokens: 1,
      outputUsdPerMillionTokens: 2,
      estimatedCostUsd: 0.004,
    };

    await expect(store.reserveModelCost(claim, reservation, 0.01)).resolves.toMatchObject({
      created: true,
      projectedCostUsd: 0.004,
    });
    await expect(store.reserveModelCost(claim, reservation, 0.01)).resolves.toMatchObject({
      created: false,
      projectedCostUsd: 0.004,
    });
    await expect(repositories.costs.totalsForScan(claim.runId)).resolves.toMatchObject({
      estimatedCostUsd: 0.004,
      actualCostUsd: 0,
    });
    await expect(repositories.costs.committedCostForScan(claim.runId)).resolves.toBe(0.004);

    const settlement = {
      ledgerKey: reservation.ledgerKey,
      provider: reservation.provider,
      model: reservation.model,
      operation: reservation.operation,
      attempt: reservation.attempt,
      inputTokens: 1_000,
      outputTokens: 500,
      actualCostUsd: 0.002,
      finishedAt: new Date().toISOString(),
    };
    const settled = await store.settleModelCost(claim, settlement);
    expect(settled).toMatchObject({ committedCostUsd: 0.004 });
    await expect(store.settleModelCost(claim, settlement)).resolves.toMatchObject({
      committedCostUsd: 0.004,
    });
    await expect(
      store.settleModelCost(claim, {
        ...settlement,
        inputTokens: 999,
        outputTokens: 501,
      }),
    ).rejects.toThrow(/cannot be rewritten/i);
    await expect(repositories.costs.totalsForScan(claim.runId)).resolves.toMatchObject({
      estimatedCostUsd: 0.004,
      actualCostUsd: 0.002,
      quotaUnits: 1_500,
    });
  });

  it("reserves and settles the exact provider attempt through the processing fence", async () => {
    if (!claim) throw new Error("The cost integration scan was not claimed");
    await store.beginProvider("hacker_news", claim, 1);
    const reservation = {
      provider: "hacker_news" as const,
      attempt: 1,
      estimatedCostUsd: 0.006,
      calls: 1,
      quotaUnits: 1,
    };
    await expect(store.reserveProviderAttempt(claim, reservation, 0.02)).resolves.toMatchObject({
      created: true,
      projectedCostUsd: 0.01,
    });
    await expect(store.reserveProviderAttempt(claim, reservation, 0.02)).resolves.toMatchObject({
      created: false,
      projectedCostUsd: 0.01,
    });
    await expect(
      store.settleProviderAttempt(claim, {
        ...reservation,
        actualCostUsd: 0.002,
        actualQuotaUnits: 1,
        status: "SUCCESS",
        finishedAt: new Date().toISOString(),
      }),
    ).resolves.toMatchObject({ committedCostUsd: 0.01 });
    await expect(repositories.costs.totalsForScan(claim.runId)).resolves.toMatchObject({
      estimatedCostUsd: 0.01,
      actualCostUsd: 0.004,
      quotaUnits: 1_501,
    });
  });
});
