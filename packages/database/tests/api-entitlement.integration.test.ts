import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import {
  apiKeys,
  createDatabaseFromEnv,
  createRepositories,
  projectEntitlements,
} from "../src/index";

const databaseDescribe = process.env.RUN_DATABASE_INTEGRATION === "1" ? describe : describe.skip;
const payloadHash = `sha256:${"f".repeat(64)}`;

databaseDescribe("paid API entitlement enforcement", () => {
  const client = createDatabaseFromEnv();
  const repositories = createRepositories(client.db, {
    apiKeyPepper: "paid-api-entitlement-integration-pepper",
  });
  const projectUrl = `https://paid-api-${randomUUID()}.example`;

  afterAll(async () => {
    await repositories.privacy.deleteProjectData({ normalizedUrl: projectUrl });
    await client.close();
  });

  it("rejects live issuance and on-demand admission without an active paid period", async () => {
    const now = new Date("2026-08-11T12:00:00.000Z");
    const project = await repositories.scanData.upsertProject({ url: projectUrl });
    const [existingLiveKey] = await client.db
      .insert(apiKeys)
      .values({
        projectId: project.id,
        name: "Pre-entitlement integration key",
        visiblePrefix: `ent${randomUUID().replaceAll("-", "")}`.slice(0, 12),
        secretHash: "integration-test-only",
        scopes: ["next_move:read", "next_move:write"],
        environment: "live",
        rateLimitPerHour: 20,
        providerCostLimitUsd: "5.0000",
        createdAt: now,
        expiresAt: new Date("2027-08-11T12:00:00.000Z"),
      })
      .returning();
    if (!existingLiveKey) throw new Error("Live API-key fixture setup failed");

    const admit = (label: string) =>
      repositories.scans.admitApiRequest({
        apiKeyId: existingLiveKey.id,
        projectId: project.id,
        idempotencyKey: randomUUID(),
        request: { product_url: `${projectUrl}/${label}` },
        costReservationUsd: 0.25,
        since: new Date(now.getTime() - 3_600_000),
        now,
      });
    const issue = () =>
      repositories.apiKeys.issue({
        projectId: project.id,
        name: "Founder agent",
        environment: "live",
        scopes: ["next_move:read", "next_move:write"],
        rateLimitPerHour: 20,
        providerCostLimitUsd: 5,
        expiresAt: new Date("2027-08-11T12:00:00.000Z"),
      });

    await expect(admit("missing-entitlement")).resolves.toEqual({
      status: "USAGE_LIMITED",
      reason: "ENTITLEMENT_INACTIVE",
    });
    await expect(issue()).rejects.toThrow(/paid project entitlement/i);

    const subscriptionId = `sub_api_${randomUUID()}`;
    const customerId = `cus_api_${randomUUID()}`;
    const checkout = await repositories.billing.recordCheckout({
      projectId: project.id,
      stripeCheckoutSessionId: `cs_test_api_${randomUUID()}`,
      initiatedBy: "founder:api-entitlement-integration",
    });
    await repositories.billing.projectWebhook({
      event: {
        eventId: `evt_api_subscription_${randomUUID()}`,
        type: "customer.subscription.created",
        createdAt: new Date("2026-08-01T00:00:01.000Z"),
        livemode: false,
        kind: "subscription",
        subscriptionId,
        checkoutReservationId: checkout.id,
        customerId,
        projectId: project.id,
        priceId: "price_founder",
        status: "active",
        cancelAtPeriodEnd: false,
        currentPeriodStart: new Date("2026-08-01T00:00:00.000Z"),
        currentPeriodEnd: new Date("2026-09-01T00:00:00.000Z"),
        rank: 20,
      },
      payloadHash,
      expectedLivemode: false,
      expectedPriceId: "price_founder",
    });
    await expect(admit("inactive-entitlement")).resolves.toEqual({
      status: "USAGE_LIMITED",
      reason: "ENTITLEMENT_INACTIVE",
    });
    await expect(issue()).rejects.toThrow(/paid project entitlement/i);

    await repositories.billing.projectWebhook({
      event: {
        eventId: `evt_api_invoice_${randomUUID()}`,
        type: "invoice.paid",
        createdAt: new Date("2026-08-01T00:00:02.000Z"),
        livemode: false,
        kind: "invoice",
        invoiceId: `in_api_${randomUUID()}`,
        subscriptionId,
        customerId,
        paymentState: "paid",
        periodStart: new Date("2026-08-01T00:00:00.000Z"),
        periodEnd: new Date("2026-09-01T00:00:00.000Z"),
        rank: 20,
      },
      payloadHash,
      expectedLivemode: false,
      expectedPriceId: "price_founder",
    });

    const issued = await issue();
    expect(issued).toMatchObject({
      record: { projectId: project.id, environment: "live" },
      rawKey: expect.stringMatching(/^tf_live_/),
    });
    await expect(admit("active-entitlement")).resolves.toMatchObject({ status: "CREATED" });

    await client.db
      .update(projectEntitlements)
      .set({ active: false })
      .where(eq(projectEntitlements.projectId, project.id));
    await expect(
      repositories.apiKeys.rotate({
        apiKeyId: issued.record.id,
        actorId: "founder:inactive-entitlement",
      }),
    ).rejects.toThrow(/paid project entitlement/i);
  });
});
