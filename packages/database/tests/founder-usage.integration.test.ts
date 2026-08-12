import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { createDatabaseFromEnv, createRepositories, projects } from "../src/index";

const databaseDescribe = process.env.RUN_DATABASE_INTEGRATION === "1" ? describe : describe.skip;
const payloadHash = `sha256:${"c".repeat(64)}`;

databaseDescribe("durable Founder usage admission", () => {
  const client = createDatabaseFromEnv();
  const repositories = createRepositories(client.db);
  let projectId = "";

  afterAll(async () => {
    if (projectId) await client.db.delete(projects).where(eq(projects.id, projectId));
    await client.close();
  });

  it("serializes monthly and daily limits and reuses idempotent acceptance", async () => {
    const [project] = await client.db
      .insert(projects)
      .values({
        publicId: `project_usage_${randomUUID()}`,
        url: "https://founder-usage.example",
        normalizedUrl: "https://founder-usage.example",
      })
      .returning();
    if (!project) throw new Error("project setup failed");
    projectId = project.id;

    await expect(
      repositories.founderUsage.admit({
        projectId,
        kind: "ON_DEMAND_RUN_ACCEPTED",
        idempotencyKey: `usage:inactive:${projectId}`,
        occurredAt: new Date("2026-08-11T12:00:00Z"),
      }),
    ).resolves.toEqual({ status: "LIMITED", reason: "ENTITLEMENT_INACTIVE" });

    const stripeSubscriptionId = `sub_usage_${randomUUID()}`;
    const stripeCustomerId = `cus_usage_${randomUUID()}`;
    const checkout = await repositories.billing.recordCheckout({
      projectId,
      stripeCheckoutSessionId: `cs_test_usage_${randomUUID()}`,
      initiatedBy: "founder:integration",
    });
    await repositories.billing.projectWebhook({
      event: {
        eventId: `evt_usage_subscription_${randomUUID()}`,
        type: "customer.subscription.created",
        createdAt: new Date("2026-08-01T00:00:01Z"),
        livemode: false,
        kind: "subscription",
        subscriptionId: stripeSubscriptionId,
        checkoutReservationId: checkout.id,
        customerId: stripeCustomerId,
        projectId,
        priceId: "price_founder",
        status: "active",
        cancelAtPeriodEnd: false,
        currentPeriodStart: new Date("2026-08-01T00:00:00Z"),
        currentPeriodEnd: new Date("2026-09-01T00:00:00Z"),
        rank: 20,
      },
      payloadHash,
      expectedLivemode: false,
      expectedPriceId: "price_founder",
    });
    await repositories.billing.projectWebhook({
      event: {
        eventId: `evt_usage_invoice_${randomUUID()}`,
        type: "invoice.paid",
        createdAt: new Date("2026-08-01T00:00:02Z"),
        livemode: false,
        kind: "invoice",
        invoiceId: `in_usage_${randomUUID()}`,
        subscriptionId: stripeSubscriptionId,
        customerId: stripeCustomerId,
        paymentState: "paid",
        periodStart: new Date("2026-08-01T00:00:00Z"),
        periodEnd: new Date("2026-09-01T00:00:00Z"),
        rank: 20,
      },
      payloadHash,
      expectedLivemode: false,
      expectedPriceId: "price_founder",
    });

    const admissions = await Promise.all(
      Array.from({ length: 11 }, (_, index) =>
        repositories.founderUsage.admit({
          projectId,
          kind: "ON_DEMAND_RUN_ACCEPTED",
          idempotencyKey: `usage:on-demand:${projectId}:${index}`,
          occurredAt: new Date("2026-08-11T12:00:00Z"),
        }),
      ),
    );
    expect(admissions.filter((result) => result.status === "ACCEPTED")).toHaveLength(10);
    expect(admissions.filter((result) => result.status === "LIMITED")).toHaveLength(1);

    expect(
      await repositories.founderUsage.admit({
        projectId,
        kind: "ON_DEMAND_RUN_ACCEPTED",
        idempotencyKey: `usage:on-demand:${projectId}:0`,
        occurredAt: new Date("2026-08-11T12:00:00Z"),
      }),
    ).toMatchObject({ status: "REUSED" });

    expect(
      await repositories.founderUsage.admit({
        projectId,
        kind: "SCHEDULED_RUN_ACCEPTED",
        idempotencyKey: `usage:scheduled:${projectId}:one`,
        occurredAt: new Date("2026-08-11T12:00:00Z"),
      }),
    ).toMatchObject({ status: "ACCEPTED" });
    expect(
      await repositories.founderUsage.admit({
        projectId,
        kind: "SCHEDULED_RUN_ACCEPTED",
        idempotencyKey: `usage:scheduled:${projectId}:two`,
        occurredAt: new Date("2026-08-11T23:00:00Z"),
      }),
    ).toEqual({ status: "LIMITED", reason: "SCHEDULED_DAILY_LIMIT" });
    expect(
      await repositories.founderUsage.admit({
        projectId,
        kind: "SCHEDULED_RUN_ACCEPTED",
        idempotencyKey: `usage:scheduled:${projectId}:next-day`,
        occurredAt: new Date("2026-08-12T00:00:00Z"),
      }),
    ).toMatchObject({ status: "ACCEPTED" });
  });
});
