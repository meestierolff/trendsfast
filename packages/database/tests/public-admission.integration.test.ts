import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import {
  analyticsEvents,
  createDatabaseFromEnv,
  createRepositories,
  scanRequests,
} from "../src/index";

const databaseDescribe = process.env.RUN_DATABASE_INTEGRATION === "1" ? describe : describe.skip;

databaseDescribe("atomic public scan admission", () => {
  const client = createDatabaseFromEnv();
  const repositories = createRepositories(client.db);
  const fingerprint = `admission-${randomUUID()}`;
  const now = new Date();
  const since = new Date(now.getTime() - 86_400_000);
  const sessionHash = randomUUID().replaceAll("-", "").repeat(2);
  const limitSessionHash = randomUUID().replaceAll("-", "").repeat(2);

  afterAll(async () => {
    await client.db
      .delete(analyticsEvents)
      .where(eq(analyticsEvents.anonymousSessionHash, sessionHash));
    await client.db
      .delete(analyticsEvents)
      .where(eq(analyticsEvents.anonymousSessionHash, limitSessionHash));
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
          anonymousSessionHash: sessionHash,
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
    const events = await client.db
      .select()
      .from(analyticsEvents)
      .where(eq(analyticsEvents.anonymousSessionHash, sessionHash));
    expect(events).toHaveLength(8);
    expect(events.filter((event) => event.properties?.reused === false)).toHaveLength(1);
    expect(events.filter((event) => event.properties?.reused === true)).toHaveLength(7);
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
            anonymousSessionHash: limitSessionHash,
            since,
            dailyLimit: 2,
            now,
          });
        }),
      );

      expect(requests.filter((result) => result.status === "CREATED")).toHaveLength(2);
      expect(requests.filter((result) => result.status === "RATE_LIMITED")).toHaveLength(6);
      expect(
        await client.db
          .select()
          .from(analyticsEvents)
          .where(eq(analyticsEvents.anonymousSessionHash, limitSessionHash)),
      ).toHaveLength(2);
    } finally {
      await client.db
        .delete(scanRequests)
        .where(eq(scanRequests.requesterFingerprintHash, secondFingerprint));
    }
  });

  it("counts duplicate replays against the same durable daily cap", async () => {
    const replayFingerprint = `${fingerprint}-replay-limit`;
    const replaySessionHash = randomUUID().replaceAll("-", "").repeat(2);
    try {
      const requests = await Promise.all(
        Array.from({ length: 8 }, () =>
          repositories.scans.admitPublicRequest({
            submittedUrl: "https://bounded-replay.example/",
            normalizedUrl: "https://bounded-replay.example/",
            requesterFingerprintHash: replayFingerprint,
            anonymousSessionHash: replaySessionHash,
            since,
            dailyLimit: 2,
            now,
          }),
        ),
      );

      expect(requests.filter((result) => result.status === "CREATED")).toHaveLength(1);
      expect(requests.filter((result) => result.status === "REUSED")).toHaveLength(1);
      expect(requests.filter((result) => result.status === "RATE_LIMITED")).toHaveLength(6);
      expect(
        await client.db
          .select()
          .from(analyticsEvents)
          .where(eq(analyticsEvents.anonymousSessionHash, replaySessionHash)),
      ).toHaveLength(2);
    } finally {
      await client.db
        .delete(scanRequests)
        .where(eq(scanRequests.requesterFingerprintHash, replayFingerprint));
    }
  });
});
