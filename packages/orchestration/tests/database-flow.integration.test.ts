import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabaseFromEnv, createRepositories } from "@trendsfast/database";
import {
  buildQueryPlan,
  createFixtureProviderRegistry,
  createProviderContext,
  projectContextToProductQueryContext,
} from "@trendsfast/providers";

import { createDatabaseProcessingStore } from "../src/database-store";
import { decideDeterministically } from "../src/decision";
import { inferFixtureProjectContext } from "../src/context";
import { createProviderRunner } from "../src/provider-runner";
import { processScan } from "../src/state-machine";

const databaseDescribe = process.env.RUN_DATABASE_INTEGRATION === "1" ? describe : describe.skip;

databaseDescribe("persisted fixture scan", () => {
  const client = createDatabaseFromEnv();
  const repositories = createRepositories(client.db);
  const url = `https://integration-${process.pid}.example`;
  let publicId = "";

  beforeAll(async () => {
    const created = await repositories.scans.createRequest({
      request: { product_url: url },
      origin: "FIXTURE",
    });
    publicId = created.request.publicId;
  });

  afterAll(async () => {
    await repositories.privacy.deleteProjectData({ normalizedUrl: url });
    await client.close();
  });

  it("persists, reviews, delivers, and safely retries one bounded decision", async () => {
    const dependencies = {
      store: createDatabaseProcessingStore(repositories),
      inferContext: inferFixtureProjectContext,
      planQueries: (
        context: Parameters<typeof projectContextToProductQueryContext>[0],
        options: Parameters<typeof buildQueryPlan>[1],
      ) => buildQueryPlan(projectContextToProductQueryContext(context), options),
      providers: createProviderRunner({
        registry: createFixtureProviderRegistry(),
        context: createProviderContext({ credentialMode: "fixture" }),
      }),
      decide: decideDeterministically,
      maxCostUsd: 0.25,
      maxDurationMs: 30_000,
    };

    const processed = await processScan(publicId, dependencies);
    expect(processed.state).toBe("REVIEW_REQUIRED");
    expect(processed.costUsd).toBe(0);

    const pending = await repositories.scans.getStatusByPublicId(publicId);
    expect(pending?.request.state).toBe("REVIEW_REQUIRED");
    expect(pending?.move?.founderReviewed).toBe(false);
    expect(pending?.move?.autoPublish).toBe(false);
    expect(pending?.evidence.length).toBeGreaterThan(0);
    if (!pending?.move) throw new Error("The persisted draft is missing");

    if (pending.move.action !== "WAIT") {
      const receipt = pending.evidence[0];
      if (!receipt) throw new Error("An actionable move requires persisted evidence");
      await repositories.scanData.bindEvidence({
        nextMoveId: pending.move.id,
        signalId: receipt.signalId,
        reason: receipt.reason,
        reviewerId: "integration-founder",
        verified: true,
      });
    }
    await repositories.reviews.approve({
      nextMoveId: pending.move.id,
      reviewerId: "integration-founder",
    });
    const delivery = await repositories.delivery.deliver({
      nextMoveId: pending.move.id,
      reviewerId: "integration-founder",
      expiresAt: new Date(Date.now() + 7 * 86_400_000),
    });
    expect(delivery.created).toBe(true);
    if (!delivery.created) throw new Error("The integration delivery was not issued");

    const result = await repositories.delivery.getResultByToken(delivery.rawToken, false);
    expect(result?.move.state).toBe("READY");
    expect(result?.move.founderReviewed).toBe(true);
    expect(result?.move.autoPublish).toBe(false);

    const retried = await processScan(publicId, dependencies);
    expect(retried.state).toBe("READY");
    expect(retried.costUsd).toBe(0);
    expect((await repositories.costs.totalsForScan(processed.runId!)).actualCostUsd).toBe(0);
  });
});
