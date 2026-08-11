import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import {
  createDatabaseFromEnv,
  createRepositories,
  scanRequests,
  ScanCostLimitError,
} from "../src/index";

const databaseDescribe = process.env.RUN_DATABASE_INTEGRATION === "1" ? describe : describe.skip;

databaseDescribe("atomic model cost reservations", () => {
  const client = createDatabaseFromEnv();
  const repositories = createRepositories(client.db);
  const requestIds: string[] = [];

  async function createRun() {
    const url = `https://model-cost-${randomUUID()}.example`;
    const created = await repositories.scans.createRequest({
      request: { product_url: url },
      origin: "FIXTURE",
    });
    requestIds.push(created.request.id);
    const claimed = await repositories.scans.claimForProcessing(
      created.request.publicId,
      new Date(Date.now() + 60_000),
    );
    if (!claimed.claimed || !claimed.run) throw new Error("Could not create a cost test run");
    return claimed.run.id;
  }

  afterAll(async () => {
    for (const requestId of requestIds) {
      await client.db.delete(scanRequests).where(eq(scanRequests.id, requestId));
    }
    await client.close();
  });

  it("is idempotent, serializes parallel reservations, and never invents actual cost", async () => {
    const runId = await createRun();
    const metadata = {
      accounting: "conservative_pre_call_reservation",
      usage_status: "unknown_not_settled",
      model: "priced-model",
    };
    const first = await repositories.costs.reserveEstimatedCost({
      scanRunId: runId,
      ledgerKey: "model:context:attempt:1",
      provider: "openai",
      operation: "model:context:attempt:1",
      estimatedCostUsd: 0.004,
      maximumCostUsd: 0.01,
      unitMetadata: metadata,
    });
    expect(first).toMatchObject({ created: true, projectedCostUsd: 0.004 });
    expect(first.entry.actualCostUsd).toBe("0.000000");
    expect(first.entry.unitMetadata).toMatchObject(metadata);

    const duplicate = await repositories.costs.reserveEstimatedCost({
      scanRunId: runId,
      ledgerKey: "model:context:attempt:1",
      provider: "openai",
      operation: "model:context:attempt:1",
      estimatedCostUsd: 0.004,
      maximumCostUsd: 0.01,
      unitMetadata: metadata,
    });
    expect(duplicate.created).toBe(false);

    const parallel = await Promise.allSettled(
      [2, 3].map((attempt) =>
        repositories.costs.reserveEstimatedCost({
          scanRunId: runId,
          ledgerKey: `model:synthesis:attempt:${attempt}`,
          provider: "openai",
          operation: `model:synthesis:attempt:${attempt}`,
          estimatedCostUsd: 0.006,
          maximumCostUsd: 0.01,
          unitMetadata: metadata,
        }),
      ),
    );
    expect(parallel.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = parallel.find((result) => result.status === "rejected");
    expect(rejected).toMatchObject({ status: "rejected" });
    if (rejected?.status === "rejected") {
      expect(rejected.reason).toBeInstanceOf(ScanCostLimitError);
    }

    await expect(repositories.costs.totalsForScan(runId)).resolves.toMatchObject({
      estimatedCostUsd: 0.01,
      actualCostUsd: 0,
    });
  });

  it("does not let provider actuals mask an unsettled model reservation", async () => {
    const runId = await createRun();
    await repositories.costs.record({
      scanRunId: runId,
      ledgerKey: "provider:actual-over-estimate",
      provider: "test-provider",
      operation: "collect",
      estimatedCostUsd: 0.001,
      actualCostUsd: 0.004,
    });
    await repositories.costs.reserveEstimatedCost({
      scanRunId: runId,
      ledgerKey: "model:context:attempt:1",
      provider: "openai",
      operation: "model:context:attempt:1",
      estimatedCostUsd: 0.004,
      maximumCostUsd: 0.008,
      unitMetadata: {
        accounting: "conservative_pre_call_reservation",
        usage_status: "unknown_not_settled",
      },
    });

    await expect(
      repositories.costs.reserveEstimatedCost({
        scanRunId: runId,
        ledgerKey: "model:synthesis:attempt:1",
        provider: "openai",
        operation: "model:synthesis:attempt:1",
        estimatedCostUsd: 0.001,
        maximumCostUsd: 0.008,
        unitMetadata: {
          accounting: "conservative_pre_call_reservation",
          usage_status: "unknown_not_settled",
        },
      }),
    ).rejects.toBeInstanceOf(ScanCostLimitError);

    await expect(repositories.costs.totalsForScan(runId)).resolves.toMatchObject({
      estimatedCostUsd: 0.005,
      actualCostUsd: 0.004,
    });
    await expect(repositories.costs.committedCostForScan(runId)).resolves.toBe(0.008);
  });
});
