import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import {
  apiKeyAuthEvents,
  apiKeyManagementEvents,
  createDatabaseFromEnv,
  createRepositories,
} from "../src/index";

const databaseDescribe = process.env.RUN_DATABASE_INTEGRATION === "1" ? describe : describe.skip;

databaseDescribe("project API-key management lifecycle", () => {
  const client = createDatabaseFromEnv();
  const pepper = "integration-api-key-pepper-that-is-long-enough";
  const repositories = createRepositories(client.db, { apiKeyPepper: pepper });
  const actorId = `integration-key-manager:${randomUUID()}`;
  const failureFingerprint = `failure-${randomUUID()}`;
  const projectUrl = `https://api-key-${randomUUID()}.example`;

  afterAll(async () => {
    await client.db
      .delete(apiKeyAuthEvents)
      .where(eq(apiKeyAuthEvents.requesterFingerprintHash, failureFingerprint));
    await client.db
      .delete(apiKeyManagementEvents)
      .where(eq(apiKeyManagementEvents.actorId, actorId));
    await repositories.privacy.deleteProjectData({ normalizedUrl: projectUrl });
    await client.close();
  });

  it("issues once, rotates atomically, revokes, reissues, and audits without secrets", async () => {
    const project = await repositories.scanData.upsertProject({ url: projectUrl });
    const issued = await repositories.apiKeys.issue({
      projectId: project.id,
      name: "Integration founder agent",
      environment: "test",
      scopes: ["next_move:read", "next_move:write"],
      rateLimitPerHour: 17,
      providerCostLimitUsd: 0.731,
      expiresAt: new Date(Date.now() + 24 * 60 * 60_000),
      actorId,
    });
    expect(issued.rawKey).toMatch(/^tf_test_/);
    expect(Object.keys(issued.record)).not.toContain("secretHash");

    const rotated = await repositories.apiKeys.rotate({
      apiKeyId: issued.record.id,
      actorId,
    });
    expect(rotated.rawKey).not.toBe(issued.rawKey);
    expect(rotated.record).toMatchObject({
      projectId: project.id,
      scopes: ["next_move:read", "next_move:write"],
      rateLimitPerHour: 17,
      providerCostLimitUsd: "0.7310",
    });
    await expect(
      repositories.apiKeys.authenticate({ rawKey: issued.rawKey }),
    ).resolves.toMatchObject({ ok: false, reason: "REVOKED" });
    await expect(
      repositories.apiKeys.authenticate({ rawKey: rotated.rawKey, requestKind: "CREATE" }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      repositories.apiKeys.authenticate({ rawKey: rotated.rawKey, requestKind: "STATUS" }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      repositories.apiKeys.authenticate({ rawKey: rotated.rawKey, requestKind: "STATUS" }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      repositories.apiKeys.usageSince({
        apiKeyId: rotated.record.id,
        since: new Date(Date.now() - 60_000),
      }),
    ).resolves.toMatchObject({ createRequests: 1, statusRequests: 2 });

    await expect(
      repositories.apiKeys.authenticate({
        rawKey: "tf_test_unknown1.abcdefghijklmnopqrstuvwxyz123456",
        requesterFingerprintHash: failureFingerprint,
        requestKind: "STATUS",
      }),
    ).resolves.toMatchObject({ ok: false, reason: "NOT_FOUND" });
    await expect(
      repositories.apiKeys.failedAuthenticationAttemptsSince({
        requesterFingerprintHash: failureFingerprint,
        since: new Date(Date.now() - 60_000),
      }),
    ).resolves.toBe(1);

    await expect(
      repositories.apiKeys.reissue({ apiKeyId: rotated.record.id, actorId }),
    ).rejects.toThrow("revoked or expired");
    await repositories.apiKeys.revoke(rotated.record.id, actorId);
    const reissued = await repositories.apiKeys.reissue({
      apiKeyId: rotated.record.id,
      actorId,
      expiresAt: new Date(Date.now() + 48 * 60 * 60_000),
    });
    expect(reissued.rawKey).toMatch(/^tf_test_/);

    const events = await repositories.apiKeys.listManagementEvents({ projectId: project.id });
    expect(events.map((event) => event.action)).toEqual(
      expect.arrayContaining(["ISSUED", "ROTATED", "REVOKED", "REISSUED"]),
    );
    const audit = JSON.stringify(events);
    expect(audit).not.toContain(issued.rawKey);
    expect(audit).not.toContain(rotated.rawKey);
    expect(audit).not.toContain(reissued.rawKey);
  });
});
