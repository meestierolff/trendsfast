import { randomUUID } from "node:crypto";

import { and, eq, isNull } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import {
  createDatabaseFromEnv,
  createRepositories,
  founderEntitlementGrantEvents,
  founderEntitlementGrants,
  founderUsageEvents,
  scanRequests,
} from "../src/index";

const databaseDescribe = process.env.RUN_DATABASE_INTEGRATION === "1" ? describe : describe.skip;

databaseDescribe("founder design-partner grants", () => {
  const client = createDatabaseFromEnv();
  const repositories = createRepositories(client.db, {
    apiKeyPepper: "founder-grant-integration-pepper",
  });
  const projectUrl = `https://design-partner-${randomUUID()}.example`;
  let projectId: string | undefined;

  afterAll(async () => {
    if (projectId) {
      await client.db
        .delete(founderEntitlementGrantEvents)
        .where(eq(founderEntitlementGrantEvents.projectId, projectId));
      await client.db.delete(founderUsageEvents).where(eq(founderUsageEvents.projectId, projectId));
      await client.db
        .delete(founderEntitlementGrants)
        .where(eq(founderEntitlementGrants.projectId, projectId));
      await repositories.privacy.deleteProjectData({ normalizedUrl: projectUrl });
    }
    await client.close();
  });

  it("atomically closes an expired grant, reissues once, audits, and enforces usage", async () => {
    const project = await repositories.scanData.upsertProject({ url: projectUrl });
    projectId = project.id;
    const now = new Date();
    const historicalNow = new Date(now.getTime() - 3 * 86_400_000);
    await repositories.founderGrants.issueDesignPartnerGrant({
      projectId: project.id,
      issuedBy: "founder:integration",
      now: historicalNow,
      expiresAt: new Date(historicalNow.getTime() + 86_400_000),
    });

    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        repositories.founderGrants.issueDesignPartnerGrant({
          projectId: project.id,
          issuedBy: "founder:integration",
          now,
          expiresAt: new Date(now.getTime() + 29 * 86_400_000),
        }),
      ),
    );
    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(new Set(results.map((result) => result.grant.id))).toHaveLength(1);

    const open = await client.db
      .select()
      .from(founderEntitlementGrants)
      .where(
        and(
          eq(founderEntitlementGrants.projectId, project.id),
          isNull(founderEntitlementGrants.revokedAt),
        ),
      );
    expect(open).toHaveLength(1);
    expect(
      await client.db
        .select()
        .from(founderEntitlementGrantEvents)
        .where(eq(founderEntitlementGrantEvents.projectId, project.id)),
    ).toHaveLength(3);

    const issued = await repositories.apiKeys.issue({
      projectId: project.id,
      name: "Design partner live key",
      environment: "live",
      scopes: ["next_move:read", "next_move:write"],
      rateLimitPerHour: 37,
      providerCostLimitUsd: 7.25,
      expiresAt: new Date(now.getTime() + 28 * 86_400_000),
      actorId: "founder:integration",
    });
    const accepted = await repositories.scans.admitApiRequest({
      apiKeyId: issued.record.id,
      projectId: project.id,
      idempotencyKey: randomUUID(),
      request: { product_url: projectUrl },
      costReservationUsd: 0.317,
      since: new Date(now.getTime() - 3_600_000),
      now,
    });
    expect(accepted).toMatchObject({ status: "CREATED" });
    if (accepted.status !== "CREATED") throw new Error("Founder grant request was not admitted");
    await expect(
      repositories.scans.admitApiRequest({
        apiKeyId: issued.record.id,
        projectId: project.id,
        idempotencyKey: randomUUID(),
        request: { product_url: projectUrl },
        costReservationUsd: 0.317,
        since: new Date(now.getTime() - 3_600_000),
        now: new Date(now.getTime() + 500),
      }),
    ).resolves.toMatchObject({ status: "PROJECT_BUSY", request: { id: accepted.request.id } });
    const [usage] = await client.db
      .select()
      .from(founderUsageEvents)
      .where(eq(founderUsageEvents.projectId, project.id));
    expect(usage).toMatchObject({ subscriptionId: null, founderGrantId: open[0]?.id });

    await client.db
      .update(scanRequests)
      .set({ state: "FAILED", completedAt: new Date(now.getTime() + 750) })
      .where(eq(scanRequests.id, accepted.request.id));

    await repositories.founderGrants.revoke({
      grantId: open[0]!.id,
      revokedBy: "founder:integration",
      now: new Date(now.getTime() + 1_000),
    });
    await expect(
      repositories.scans.admitApiRequest({
        apiKeyId: issued.record.id,
        projectId: project.id,
        idempotencyKey: randomUUID(),
        request: { product_url: projectUrl },
        costReservationUsd: 0.317,
        since: new Date(now.getTime() - 3_600_000),
        now: new Date(now.getTime() + 2_000),
      }),
    ).resolves.toEqual({ status: "USAGE_LIMITED", reason: "ENTITLEMENT_INACTIVE" });
  });
});
