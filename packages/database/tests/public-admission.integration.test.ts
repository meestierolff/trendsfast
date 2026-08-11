import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { createDatabaseFromEnv, createRepositories, scanRequests } from "../src/index";

const databaseDescribe = process.env.RUN_DATABASE_INTEGRATION === "1" ? describe : describe.skip;

databaseDescribe("atomic public scan admission", () => {
  const client = createDatabaseFromEnv();
  const repositories = createRepositories(client.db);
  const fingerprint = `admission-${randomUUID()}`;
  const now = new Date();
  const since = new Date(now.getTime() - 86_400_000);

  afterAll(async () => {
    await client.db
      .delete(scanRequests)
      .where(eq(scanRequests.requesterFingerprintHash, fingerprint));
    await client.close();
  });

  it("serializes parallel duplicates into one persisted request", async () => {
    const requests = await Promise.all(
      Array.from({ length: 8 }, () =>
        repositories.scans.admitPublicRequest({
          submittedUrl: "https://parallel-duplicate.example/",
          normalizedUrl: "https://parallel-duplicate.example/",
          requesterFingerprintHash: fingerprint,
          since,
          dailyLimit: 20,
          now,
        }),
      ),
    );

    expect(requests.filter((result) => result.status === "CREATED")).toHaveLength(1);
    expect(requests.filter((result) => result.status === "REUSED")).toHaveLength(7);
    expect(
      new Set(requests.flatMap((result) => ("publicToken" in result ? [result.publicToken] : []))),
    ).toHaveLength(1);
  });

  it("atomically holds parallel unique submissions to the daily cap", async () => {
    const secondFingerprint = `${fingerprint}-limit`;
    try {
      const requests = await Promise.all(
        Array.from({ length: 8 }, (_, index) => {
          const url = `https://parallel-${index}.example/`;
          return repositories.scans.admitPublicRequest({
            submittedUrl: url,
            normalizedUrl: url,
            requesterFingerprintHash: secondFingerprint,
            since,
            dailyLimit: 2,
            now,
          });
        }),
      );

      expect(requests.filter((result) => result.status === "CREATED")).toHaveLength(2);
      expect(requests.filter((result) => result.status === "RATE_LIMITED")).toHaveLength(6);
    } finally {
      await client.db
        .delete(scanRequests)
        .where(eq(scanRequests.requesterFingerprintHash, secondFingerprint));
    }
  });
});
