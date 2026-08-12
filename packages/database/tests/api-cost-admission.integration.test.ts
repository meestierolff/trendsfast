import { randomUUID } from "node:crypto";

import { eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { apiKeys, createDatabaseFromEnv, createRepositories, scanRequests } from "../src/index";

const databaseDescribe = process.env.RUN_DATABASE_INTEGRATION === "1" ? describe : describe.skip;

databaseDescribe("atomic API-key hourly cost admission", () => {
  const client = createDatabaseFromEnv();
  const repositories = createRepositories(client.db);
  const apiKeyIds: string[] = [];

  async function issueKey(providerCostLimitUsd: number) {
    const issued = await repositories.apiKeys.issue({
      name: `cost-admission-${randomUUID()}`,
      environment: "test",
      rateLimitPerHour: 100,
      providerCostLimitUsd,
    });
    apiKeyIds.push(issued.record.id);
    return issued.record;
  }

  function window() {
    const now = new Date();
    return { now, since: new Date(now.getTime() - 3_600_000) };
  }

  afterAll(async () => {
    for (const apiKeyId of apiKeyIds) {
      await client.db.delete(scanRequests).where(eq(scanRequests.apiKeyId, apiKeyId));
      await client.db.delete(apiKeys).where(eq(apiKeys.id, apiKeyId));
    }
    await client.close();
  });

  it("holds parallel unique idempotency keys at the exact hourly cap", async () => {
    const apiKey = await issueKey(0.5);
    const admissionWindow = window();
    const outcomes = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        repositories.scans.admitApiRequest({
          apiKeyId: apiKey.id,
          idempotencyKey: randomUUID(),
          request: { product_url: `https://parallel-cost-${index}-${randomUUID()}.example` },
          costReservationUsd: 0.25,
          ...admissionWindow,
        }),
      ),
    );

    expect(outcomes.filter((outcome) => outcome.status === "CREATED")).toHaveLength(2);
    expect(outcomes.filter((outcome) => outcome.status === "COST_LIMITED")).toHaveLength(6);
    const requests = await client.db
      .select({ reservationUsd: scanRequests.apiCostReservationUsd })
      .from(scanRequests)
      .where(eq(scanRequests.apiKeyId, apiKey.id));
    expect(requests).toHaveLength(2);
    expect(requests.reduce((total, request) => total + Number(request.reservationUsd), 0)).toBe(
      0.5,
    );
  });

  it("reserves only once for simultaneous same-payload idempotency replays", async () => {
    const apiKey = await issueKey(0.25);
    const admissionWindow = window();
    const idempotencyKey = randomUUID();
    const request = { product_url: `https://parallel-replay-${randomUUID()}.example` };
    const outcomes = await Promise.all(
      Array.from({ length: 8 }, () =>
        repositories.scans.admitApiRequest({
          apiKeyId: apiKey.id,
          idempotencyKey,
          request,
          costReservationUsd: 0.25,
          ...admissionWindow,
        }),
      ),
    );

    expect(outcomes.filter((outcome) => outcome.status === "CREATED")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "REUSED")).toHaveLength(7);
    const requests = await client.db
      .select({ reservationUsd: scanRequests.apiCostReservationUsd })
      .from(scanRequests)
      .where(eq(scanRequests.apiKeyId, apiKey.id));
    expect(requests).toEqual([{ reservationUsd: "0.250000" }]);
  });

  it("persists one reservation when different payloads race on one idempotency key", async () => {
    const apiKey = await issueKey(0.5);
    const admissionWindow = window();
    const idempotencyKey = randomUUID();
    const outcomes = await Promise.all([
      repositories.scans.admitApiRequest({
        apiKeyId: apiKey.id,
        idempotencyKey,
        request: { product_url: `https://conflict-a-${randomUUID()}.example` },
        costReservationUsd: 0.25,
        ...admissionWindow,
      }),
      repositories.scans.admitApiRequest({
        apiKeyId: apiKey.id,
        idempotencyKey,
        request: { product_url: `https://conflict-b-${randomUUID()}.example` },
        costReservationUsd: 0.25,
        ...admissionWindow,
      }),
    ]);

    expect(outcomes.map((outcome) => outcome.status).sort()).toEqual([
      "CREATED",
      "IDEMPOTENCY_CONFLICT",
    ]);
    const requests = await client.db
      .select({ reservationUsd: scanRequests.apiCostReservationUsd })
      .from(scanRequests)
      .where(eq(scanRequests.apiKeyId, apiKey.id));
    expect(requests).toEqual([{ reservationUsd: "0.250000" }]);
  });

  it("does not let a reservation mask higher settled run cost", async () => {
    const apiKey = await issueKey(0.5);
    const admissionWindow = window();
    const first = await repositories.scans.admitApiRequest({
      apiKeyId: apiKey.id,
      idempotencyKey: randomUUID(),
      request: { product_url: `https://settled-cost-${randomUUID()}.example` },
      costReservationUsd: 0.1,
      ...admissionWindow,
    });
    if (first.status !== "CREATED") throw new Error("Initial cost reservation was not admitted");
    const run = await repositories.scans.createRun({ scanRequestId: first.request.id });
    await repositories.scanData.updateRunSummary(run.id, {
      estimatedCostUsd: 0.1,
      actualCostUsd: 0.3,
    });

    const next = await repositories.scans.admitApiRequest({
      apiKeyId: apiKey.id,
      idempotencyKey: randomUUID(),
      request: { product_url: `https://settled-cost-next-${randomUUID()}.example` },
      costReservationUsd: 0.25,
      ...admissionWindow,
    });

    expect(next).toMatchObject({
      status: "COST_LIMITED",
      committedCostUsd: 0.3,
      projectedCostUsd: 0.55,
      maximumCostUsd: 0.5,
    });
  });

  it("rejects a key revoked after authentication and at the exact expiry boundary", async () => {
    const revokedMaterial = await repositories.apiKeys.issue({
      name: `revoked-admission-${randomUUID()}`,
      environment: "test",
      rateLimitPerHour: 100,
      providerCostLimitUsd: 1,
    });
    apiKeyIds.push(revokedMaterial.record.id);
    await expect(
      repositories.apiKeys.authenticate({ rawKey: revokedMaterial.rawKey }),
    ).resolves.toMatchObject({ ok: true });
    await repositories.apiKeys.revoke(revokedMaterial.record.id, "integration:revoke-race");

    const revoked = await repositories.scans.admitApiRequest({
      apiKeyId: revokedMaterial.record.id,
      idempotencyKey: randomUUID(),
      request: { product_url: `https://revoked-${randomUUID()}.example` },
      costReservationUsd: 0.25,
      ...window(),
    });
    expect(revoked).toEqual({ status: "KEY_INACTIVE" });

    const boundary = new Date(Date.now() + 60_000);
    const expiringMaterial = await repositories.apiKeys.issue({
      name: `expired-admission-${randomUUID()}`,
      environment: "test",
      rateLimitPerHour: 100,
      providerCostLimitUsd: 1,
      expiresAt: boundary,
    });
    apiKeyIds.push(expiringMaterial.record.id);
    const expired = await repositories.scans.admitApiRequest({
      apiKeyId: expiringMaterial.record.id,
      idempotencyKey: randomUUID(),
      request: { product_url: `https://expired-${randomUUID()}.example` },
      costReservationUsd: 0.25,
      since: new Date(boundary.getTime() - 3_600_000),
      now: boundary,
    });
    expect(expired).toEqual({ status: "KEY_INACTIVE" });

    const requests = await client.db
      .select()
      .from(scanRequests)
      .where(
        inArray(scanRequests.apiKeyId, [revokedMaterial.record.id, expiringMaterial.record.id]),
      );
    expect(requests).toHaveLength(0);
  });
});
