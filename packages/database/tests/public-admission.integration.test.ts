import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import {
  analyticsEvents,
  createDatabaseFromEnv,
  createRepositories,
  projects,
  scanRequests,
} from "../src/index";

const databaseDescribe = process.env.RUN_DATABASE_INTEGRATION === "1" ? describe : describe.skip;

databaseDescribe("atomic public scan admission", () => {
  const client = createDatabaseFromEnv();
  const repositories = createRepositories(client.db);
  const fingerprint = `admission-${randomUUID()}`;
  const now = new Date();
  const since = new Date(now.getTime() - 86_400_000);
  const globalSince = new Date(now.getTime() - 86_400_000);
  const globalPolicy = {
    globalSince,
    globalDailyLimit: 10_000,
    globalDailyBudgetUsd: 10_000,
    costReservationUsd: 0,
  } as const;
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
          dailyLimit: 31,
          ...globalPolicy,
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

  it("never shares a private scan capability across sessions on the same network", async () => {
    const sharedFingerprint = `${fingerprint}-shared-network`;
    const firstSession = randomUUID().replaceAll("-", "").repeat(2);
    const secondSession = randomUUID().replaceAll("-", "").repeat(2);
    const sharedUrl = `https://shared-network-${randomUUID()}.example/`;
    try {
      const created = await repositories.scans.admitPublicRequest({
        submittedUrl: sharedUrl,
        normalizedUrl: sharedUrl,
        requesterFingerprintHash: sharedFingerprint,
        anonymousSessionHash: firstSession,
        since,
        dailyLimit: 31,
        ...globalPolicy,
        now,
      });
      expect(created.status).toBe("CREATED");

      const rejected = await repositories.scans.admitPublicRequest({
        submittedUrl: sharedUrl,
        normalizedUrl: sharedUrl,
        requesterFingerprintHash: sharedFingerprint,
        anonymousSessionHash: secondSession,
        since,
        dailyLimit: 31,
        ...globalPolicy,
        now: new Date(now.getTime() + 1_000),
      });
      expect(rejected).toEqual({ status: "PROJECT_ALREADY_EXISTS" });
      expect("publicToken" in rejected).toBe(false);
    } finally {
      await client.db
        .delete(scanRequests)
        .where(eq(scanRequests.requesterFingerprintHash, sharedFingerprint));
    }
  });

  it("rejects a new anonymous scan for an existing project without reserving work", async () => {
    const existingFingerprint = `${fingerprint}-existing-project`;
    const existingUrl = `https://existing-project-${randomUUID()}.example/`;
    const [project] = await client.db
      .insert(projects)
      .values({
        publicId: `project_${randomUUID()}`,
        url: existingUrl,
        normalizedUrl: existingUrl,
      })
      .returning();
    if (!project) throw new Error("existing project fixture was not created");
    try {
      const rejected = await repositories.scans.admitPublicRequest({
        submittedUrl: existingUrl,
        normalizedUrl: existingUrl,
        requesterFingerprintHash: existingFingerprint,
        since,
        dailyLimit: 31,
        ...globalPolicy,
        now,
      });
      expect(rejected).toEqual({ status: "PROJECT_ALREADY_EXISTS" });
      expect(
        await client.db
          .select()
          .from(scanRequests)
          .where(eq(scanRequests.requesterFingerprintHash, existingFingerprint)),
      ).toEqual([]);
    } finally {
      await client.db.delete(projects).where(eq(projects.id, project.id));
    }
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
            ...globalPolicy,
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
            ...globalPolicy,
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

  it("atomically holds unique submissions to the global count across fingerprints", async () => {
    const globalNow = new Date("2098-01-02T12:00:00.000Z");
    const globalStart = new Date("2098-01-02T00:00:00.000Z");
    const prefix = `global-count-${randomUUID()}`;
    try {
      const results = await Promise.all(
        Array.from({ length: 12 }, (_, index) => {
          const url = `https://${prefix}-${index}.example/`;
          return repositories.scans.admitPublicRequest({
            submittedUrl: url,
            normalizedUrl: url,
            requesterFingerprintHash: `${prefix}-${index}`,
            since: globalStart,
            dailyLimit: 3,
            globalSince: globalStart,
            globalDailyLimit: 4,
            globalDailyBudgetUsd: 811.333,
            costReservationUsd: 17.111,
            now: globalNow,
          });
        }),
      );
      expect(results.filter((result) => result.status === "CREATED")).toHaveLength(4);
      expect(results.filter((result) => result.status === "GLOBAL_CAPACITY_REACHED")).toHaveLength(
        8,
      );
    } finally {
      await client.db.delete(scanRequests).where(eq(scanRequests.submittedAt, globalNow));
    }
  });

  it("reserves global cost once while duplicate replays reuse admitted work", async () => {
    const budgetNow = new Date("2098-01-03T12:00:00.000Z");
    const budgetStart = new Date("2098-01-03T00:00:00.000Z");
    const prefix = `global-budget-${randomUUID()}`;
    try {
      const unique = await Promise.all(
        Array.from({ length: 8 }, (_, index) => {
          const url = `https://${prefix}-${index}.example/`;
          const anonymousSessionHash = randomUUID().replaceAll("-", "").repeat(2);
          return repositories.scans
            .admitPublicRequest({
              submittedUrl: url,
              normalizedUrl: url,
              requesterFingerprintHash: `${prefix}-${index}`,
              anonymousSessionHash,
              since: budgetStart,
              dailyLimit: 11,
              globalSince: budgetStart,
              globalDailyLimit: 23,
              globalDailyBudgetUsd: 7,
              costReservationUsd: 3,
              now: budgetNow,
            })
            .then((result) => ({ anonymousSessionHash, index, result }));
        }),
      );
      expect(unique.filter(({ result }) => result.status === "CREATED")).toHaveLength(2);
      expect(unique.filter(({ result }) => result.status === "GLOBAL_BUDGET_REACHED")).toHaveLength(
        6,
      );

      const admitted = unique.find(({ result }) => result.status === "CREATED")!;
      const admittedIndex = admitted.index;
      const duplicateUrl = `https://${prefix}-${admittedIndex}.example/`;
      const replay = await repositories.scans.admitPublicRequest({
        submittedUrl: duplicateUrl,
        normalizedUrl: duplicateUrl,
        requesterFingerprintHash: `${prefix}-${admittedIndex}`,
        anonymousSessionHash: admitted.anonymousSessionHash,
        since: budgetStart,
        dailyLimit: 11,
        globalSince: budgetStart,
        globalDailyLimit: 3,
        globalDailyBudgetUsd: 6,
        costReservationUsd: 3,
        now: new Date(budgetNow.getTime() + 1_000),
      });
      expect(replay.status).toBe("REUSED");
    } finally {
      await client.db.delete(scanRequests).where(eq(scanRequests.submittedAt, budgetNow));
      await client.db
        .delete(scanRequests)
        .where(eq(scanRequests.submittedAt, new Date(budgetNow.getTime() + 1_000)));
    }
  });
});
