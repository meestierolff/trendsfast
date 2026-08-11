import { afterAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

import {
  createDatabaseFromEnv,
  createRepositories,
  ProcessingFenceError,
  scanRequests,
  scanRuns,
} from "../src/index";

const databaseDescribe = process.env.RUN_DATABASE_INTEGRATION === "1" ? describe : describe.skip;

databaseDescribe("processing claim fencing", () => {
  const client = createDatabaseFromEnv();
  const repositories = createRepositories(client.db);
  const requestIds: string[] = [];

  async function request() {
    const created = await repositories.scans.createRequest({
      request: { product_url: `https://fence-${process.pid}-${requestIds.length}.example` },
      origin: "FIXTURE",
    });
    requestIds.push(created.request.id);
    return created.request;
  }

  afterAll(async () => {
    for (const requestId of requestIds) {
      await client.db.delete(scanRequests).where(eq(scanRequests.id, requestId));
    }
    await client.close();
  });

  it("rotates ownership on a queued handoff and rejects every stale writer", async () => {
    const scanRequest = await request();
    const first = await repositories.scans.claimForProcessing(
      scanRequest.publicId,
      new Date(Date.now() + 30_000),
    );
    if (!first.claimed || !first.run?.processingFence) throw new Error("First claim failed");

    await client.db
      .update(scanRequests)
      .set({ state: "QUEUED" })
      .where(eq(scanRequests.id, scanRequest.id));
    await client.db.update(scanRuns).set({ state: "QUEUED" }).where(eq(scanRuns.id, first.run.id));

    const second = await repositories.scans.claimForProcessing(
      scanRequest.publicId,
      new Date(Date.now() + 30_000),
    );
    if (!second.claimed || !second.run?.processingFence) throw new Error("Second claim failed");
    expect(second.run.id).toBe(first.run.id);
    expect(second.run.processingFence).not.toBe(first.run.processingFence);

    const staleEffect = vi.fn();
    const staleAttempts = await Promise.allSettled(
      Array.from({ length: 4 }, () =>
        repositories.scans.withProcessingFence(
          {
            requestId: scanRequest.id,
            scanRunId: first.run!.id,
            processingFence: first.run!.processingFence!,
          },
          async () => staleEffect(),
        ),
      ),
    );
    expect(staleAttempts.every((attempt) => attempt.status === "rejected")).toBe(true);
    expect(
      staleAttempts.every(
        (attempt) =>
          attempt.status === "rejected" && attempt.reason instanceof ProcessingFenceError,
      ),
    ).toBe(true);
    expect(staleEffect).not.toHaveBeenCalled();

    await repositories.scans.withProcessingFence(
      {
        requestId: scanRequest.id,
        scanRunId: second.run.id,
        processingFence: second.run.processingFence,
      },
      async (database) => {
        await database
          .update(scanRuns)
          .set({ scoreVersion: "fenced-writer" })
          .where(eq(scanRuns.id, second.run!.id));
      },
    );
    expect((await repositories.scans.getLatestRun(scanRequest.id))?.scoreVersion).toBe(
      "fenced-writer",
    );
  });

  it("recovers an expired crash only to a fenced terminal failure", async () => {
    const scanRequest = await request();
    const first = await repositories.scans.claimForProcessing(
      scanRequest.publicId,
      new Date(Date.now() + 30_000),
    );
    if (!first.claimed || !first.run?.processingFence) throw new Error("First claim failed");

    await client.db
      .update(scanRuns)
      .set({ hardDeadlineAt: new Date(Date.now() - 1_000) })
      .where(eq(scanRuns.id, first.run.id));
    const recovered = await repositories.scans.claimForProcessing(
      scanRequest.publicId,
      new Date(Date.now() + 30_000),
    );
    if (!recovered.claimed || !recovered.run?.processingFence) {
      throw new Error("Recovery claim failed");
    }
    expect(recovered.run.processingFence).not.toBe(first.run.processingFence);

    await expect(
      repositories.scans.requireReview({
        requestId: scanRequest.id,
        scanRunId: first.run.id,
        processingFence: first.run.processingFence,
        signalClass: "INSUFFICIENT_SIGNAL",
      }),
    ).rejects.toBeInstanceOf(ProcessingFenceError);
    await expect(
      repositories.scans.failProcessing({
        requestId: scanRequest.id,
        scanRunId: first.run.id,
        processingFence: first.run.processingFence,
        code: "STALE_WORKER",
        message: "must not win",
      }),
    ).rejects.toBeInstanceOf(ProcessingFenceError);

    await repositories.scans.failProcessing({
      requestId: scanRequest.id,
      scanRunId: recovered.run.id,
      processingFence: recovered.run.processingFence,
      code: "PROVIDER_OUTCOME_UNKNOWN",
      message: "External outcome could not be durably confirmed; manual retry is required.",
    });
    const failed = await repositories.scans.getLatestRun(scanRequest.id);
    expect(failed).toMatchObject({
      state: "FAILED",
      failureCode: "PROVIDER_OUTCOME_UNKNOWN",
      processingFence: null,
    });
  });
});
