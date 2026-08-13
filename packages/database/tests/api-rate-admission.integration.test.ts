import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { apiKeyAuthEvents, apiKeys, createDatabaseFromEnv, createRepositories } from "../src/index";

const databaseDescribe = process.env.RUN_DATABASE_INTEGRATION === "1" ? describe : describe.skip;

databaseDescribe("atomic API create/status rate admission", () => {
  const client = createDatabaseFromEnv();
  const repositories = createRepositories(client.db);
  let apiKeyId: string | undefined;

  afterAll(async () => {
    if (apiKeyId) {
      await client.db.delete(apiKeyAuthEvents).where(eq(apiKeyAuthEvents.apiKeyId, apiKeyId));
      await client.db.delete(apiKeys).where(eq(apiKeys.id, apiKeyId));
    }
    await client.close();
  });

  it("admits only the configured create count while status has its own counter", async () => {
    const issued = await repositories.apiKeys.issue({
      name: `rate-admission-${randomUUID()}`,
      environment: "test",
      rateLimitPerHour: 37,
      providerCostLimitUsd: 0,
    });
    apiKeyId = issued.record.id;
    const occurredAt = new Date();
    const createIds = Array.from({ length: 40 }, () => randomUUID());
    const statusIds = Array.from({ length: 40 }, () => randomUUID());
    await client.db.insert(apiKeyAuthEvents).values([
      ...createIds.map((requestId) => ({
        apiKeyId,
        outcome: "SUCCESS" as const,
        requestKind: "CREATE" as const,
        requestId,
        occurredAt,
      })),
      ...statusIds.map((requestId) => ({
        apiKeyId,
        outcome: "SUCCESS" as const,
        requestKind: "STATUS" as const,
        requestId,
        occurredAt,
      })),
    ]);
    const since = new Date(occurredAt.getTime() - 1_000);
    const [creates, statuses] = await Promise.all([
      Promise.all(
        createIds.map((requestId) =>
          repositories.apiKeys.admitAuthenticatedRequest({
            apiKeyId: apiKeyId!,
            requestId,
            requestKind: "CREATE",
            since,
            maximum: 37,
          }),
        ),
      ),
      Promise.all(
        statusIds.map((requestId) =>
          repositories.apiKeys.admitAuthenticatedRequest({
            apiKeyId: apiKeyId!,
            requestId,
            requestKind: "STATUS",
            since,
            maximum: 317,
          }),
        ),
      ),
    ]);
    expect(creates.filter(Boolean)).toHaveLength(37);
    expect(statuses.filter(Boolean)).toHaveLength(40);
    await expect(repositories.apiKeys.usageSince({ apiKeyId, since })).resolves.toMatchObject({
      createRequests: 37,
      statusRequests: 40,
    });
  });
});
