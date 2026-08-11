import { randomUUID } from "node:crypto";

import { eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import {
  analyticsEvents,
  createDatabaseFromEnv,
  createRepositories,
  founderLaunchInterestEvents,
  founderLaunchInterests,
  projects,
  scanRequests,
} from "../src/index";

const databaseDescribe = process.env.RUN_DATABASE_INTEGRATION === "1" ? describe : describe.skip;

databaseDescribe("launch analytics and consented interest durability", () => {
  const client = createDatabaseFromEnv();
  const repositories = createRepositories(client.db);
  const interestIds: string[] = [];
  const dedupeKeys: string[] = [];
  const projectIds: string[] = [];

  afterAll(async () => {
    if (interestIds.length > 0) {
      await client.db
        .delete(founderLaunchInterestEvents)
        .where(inArray(founderLaunchInterestEvents.interestReference, interestIds));
      await client.db
        .delete(founderLaunchInterests)
        .where(inArray(founderLaunchInterests.id, interestIds));
    }
    if (dedupeKeys.length > 0) {
      await client.db.delete(analyticsEvents).where(inArray(analyticsEvents.dedupeKey, dedupeKeys));
    }
    if (projectIds.length > 0) {
      await client.db.delete(projects).where(inArray(projects.id, projectIds));
    }
    await client.close();
  });

  it("appends a dedupe-keyed event exactly once", async () => {
    const dedupeKey = randomUUID().replaceAll("-", "").repeat(2);
    dedupeKeys.push(dedupeKey);
    const input = {
      name: "landing_viewed" as const,
      anonymousSessionHash: "a".repeat(64),
      dedupeKey,
      properties: {
        placement: "homepage",
        email: "must-not-persist@example.com",
        note: "free text must not persist",
      },
    };

    expect((await repositories.analytics.appendOnce(input)).created).toBe(true);
    expect((await repositories.analytics.appendOnce(input)).created).toBe(false);
    const [persisted] = await client.db
      .select()
      .from(analyticsEvents)
      .where(eq(analyticsEvents.dedupeKey, dedupeKey));
    expect(persisted?.properties).toEqual({ placement: "homepage" });
  });

  it("deduplicates consent, exposes email only through the repository list, and audits deletion without it", async () => {
    const now = new Date("2026-08-11T12:00:00.000Z");
    const email = `launch-${randomUUID()}@example.com`;
    const emailHash = randomUUID().replaceAll("-", "").repeat(2);
    const created = await repositories.founderLaunchInterests.create({
      normalizedEmail: email,
      emailHash,
      consentVersion: "founder-launch-v1",
      consentedAt: now,
      source: "pricing",
      expiresAt: new Date("2027-02-07T12:00:00.000Z"),
    });
    interestIds.push(created.id);
    const duplicate = await repositories.founderLaunchInterests.create({
      normalizedEmail: email,
      emailHash,
      consentVersion: "founder-launch-v1",
      consentedAt: new Date("2026-08-12T12:00:00.000Z"),
      source: "homepage",
      expiresAt: new Date("2027-02-08T12:00:00.000Z"),
    });
    expect(duplicate).toEqual({ id: created.id, created: false });
    const listed = await repositories.founderLaunchInterests.list({
      now: new Date("2026-08-13T12:00:00.000Z"),
    });
    expect(listed.find((interest) => interest.id === created.id)).toEqual(
      expect.objectContaining({ id: created.id, email, source: "homepage" }),
    );

    expect(
      await repositories.founderLaunchInterests.hardDelete({
        id: created.id,
        actorId: "founder:integration",
        occurredAt: new Date("2026-08-13T12:00:00.000Z"),
      }),
    ).toEqual({ deleted: true });
    const audit = await repositories.founderLaunchInterests.listEvents({ limit: 20 });
    const ownAudit = audit.filter((event) => event.interestReference === created.id);
    expect(ownAudit.map((event) => event.action)).toEqual(
      expect.arrayContaining(["JOINED", "RECONSENTED", "DELETED"]),
    );
    expect(JSON.stringify(ownAudit)).not.toContain(email);
    expect(JSON.stringify(ownAudit)).not.toContain(emailHash);
  });

  it("purges expired contact PII while retaining a non-PII audit", async () => {
    const id = randomUUID();
    const email = `expired-${id}@example.com`;
    const created = await repositories.founderLaunchInterests.create({
      normalizedEmail: email,
      emailHash: randomUUID().replaceAll("-", "").repeat(2),
      consentVersion: "founder-launch-v1",
      consentedAt: new Date("2026-01-01T00:00:00.000Z"),
      source: "pricing",
      expiresAt: new Date("2026-06-30T00:00:00.000Z"),
    });
    interestIds.push(created.id);

    const purged = await repositories.founderLaunchInterests.purgeExpired({
      now: new Date("2026-08-11T12:00:00.000Z"),
    });
    expect(purged.deleted).toBeGreaterThanOrEqual(1);
    const retained = await repositories.founderLaunchInterests.listEvents({ limit: 50 });
    const audit = retained.filter((event) => event.interestReference === created.id);
    expect(audit.map((event) => event.action)).toContain("PURGED");
    expect(JSON.stringify(audit)).not.toContain(email);
  });

  it("aggregates old-ledger and expired-scan analytics in the purge result", async () => {
    const suffix = randomUUID();
    const [project] = await client.db
      .insert(projects)
      .values({
        publicId: `privacy-${suffix}`,
        url: `https://privacy-${suffix}.example`,
        normalizedUrl: `https://privacy-${suffix}.example`,
      })
      .returning({ id: projects.id });
    if (!project) throw new Error("privacy aggregation project setup failed");
    projectIds.push(project.id);

    const [request] = await client.db
      .insert(scanRequests)
      .values({
        publicId: `privacy-scan-${suffix}`,
        projectId: project.id,
        origin: "PUBLIC_FORM",
        state: "READY",
        submittedUrl: `https://privacy-${suffix}.example`,
        normalizedUrl: `https://privacy-${suffix}.example`,
        submittedAt: new Date("2026-05-31T00:00:00.000Z"),
        completedAt: new Date("2026-06-01T00:00:00.000Z"),
      })
      .returning({ id: scanRequests.id });
    if (!request) throw new Error("privacy aggregation scan setup failed");

    await Promise.all([
      repositories.analytics.append({
        name: "landing_viewed",
        properties: { placement: "homepage" },
        occurredAt: new Date("2026-06-02T00:00:00.000Z"),
      }),
      repositories.analytics.append({
        name: "docs_viewed",
        properties: { placement: "docs" },
        occurredAt: new Date("2026-06-03T00:00:00.000Z"),
      }),
      repositories.analytics.append({
        name: "scan_status_viewed",
        scanRequestId: request.id,
        properties: { state: "READY" },
        occurredAt: new Date("2026-08-11T11:00:00.000Z"),
      }),
    ]);

    const purged = await repositories.privacy.purgeExpired(
      new Date("2026-08-11T12:00:00.000Z"),
      30,
    );
    expect(purged.deletedAnalyticsEvents).toBeGreaterThanOrEqual(3);
    expect(purged.deletedScanRequests).toBeGreaterThanOrEqual(1);
  });
});
