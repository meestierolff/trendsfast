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

databaseDescribe("pre-context privacy deletion", () => {
  const client = createDatabaseFromEnv();
  const repositories = createRepositories(client.db);
  const url = `https://pre-context-delete-${randomUUID()}.example`;
  let requestId: string | undefined;

  afterAll(async () => {
    if (requestId) await client.db.delete(scanRequests).where(eq(scanRequests.id, requestId));
    await client.close();
  });

  it("deletes an exact URL submission and its analytics before a project was inferred", async () => {
    const created = await repositories.scans.createRequest({
      request: { product_url: url },
      origin: "PUBLIC_FORM",
    });
    requestId = created.request.id;
    expect(created.request.projectId).toBeNull();
    await client.db.insert(analyticsEvents).values({
      name: "free_scan_submitted",
      scanRequestId: created.request.id,
      properties: { reused: false },
    });

    await expect(
      repositories.privacy.deleteProjectData({ normalizedUrl: url }),
    ).resolves.toMatchObject({
      found: true,
      projectId: null,
      deletedScanRequests: 1,
      deletedAnalyticsEvents: 1,
    });
    expect(
      await client.db
        .select({ id: scanRequests.id })
        .from(scanRequests)
        .where(eq(scanRequests.id, created.request.id)),
    ).toEqual([]);
    requestId = undefined;
  });

  it("deletes an unattached pre-context submission when addressed by its later project ID", async () => {
    const projectUrl = `https://project-delete-${randomUUID()}.example`;
    const created = await repositories.scans.createRequest({
      request: { product_url: projectUrl },
      origin: "PUBLIC_FORM",
    });
    requestId = created.request.id;
    const [project] = await client.db
      .insert(projects)
      .values({
        publicId: `project_delete_${randomUUID()}`,
        url: projectUrl,
        normalizedUrl: created.request.normalizedUrl,
      })
      .returning();
    if (!project) throw new Error("privacy project setup failed");

    await expect(
      repositories.privacy.deleteProjectData({ projectId: project.id }),
    ).resolves.toMatchObject({
      found: true,
      projectId: project.id,
      deletedScanRequests: 1,
    });
    expect(
      await client.db
        .select({ id: scanRequests.id })
        .from(scanRequests)
        .where(eq(scanRequests.id, created.request.id)),
    ).toEqual([]);
    requestId = undefined;
  });

  it("rejects ambiguous runtime deletion targets", async () => {
    await expect(
      repositories.privacy.deleteProjectData({
        projectId: randomUUID(),
        normalizedUrl: url,
      } as never),
    ).rejects.toThrow(/one exact project ID or normalized URL/i);
  });
});
