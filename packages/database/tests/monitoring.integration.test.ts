import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import {
  createDatabaseFromEnv,
  createRepositories,
  founderUsageEvents,
  monitoringRuns,
  monitoringSubscriptions,
  projects,
  scanRequests,
} from "../src/index";

const databaseDescribe = process.env.RUN_DATABASE_INTEGRATION === "1" ? describe : describe.skip;
const payloadHash = `sha256:${"d".repeat(64)}`;

databaseDescribe("paid monitoring claims", () => {
  const client = createDatabaseFromEnv();
  const repositories = createRepositories(client.db);
  let projectId = "";
  const stripeSubscriptionId = `sub_monitoring_${randomUUID()}`;
  const stripeCustomerId = `cus_monitoring_${randomUUID()}`;

  afterAll(async () => {
    if (projectId) await client.db.delete(projects).where(eq(projects.id, projectId));
    await client.close();
  });

  it("creates one daily scan, prevents overlap, and fences a reclaimed worker", async () => {
    const [project] = await client.db
      .insert(projects)
      .values({
        publicId: `project_monitoring_${randomUUID()}`,
        url: "https://monitoring-integration.example",
        normalizedUrl: "https://monitoring-integration.example",
      })
      .returning();
    if (!project) throw new Error("project setup failed");
    projectId = project.id;

    await repositories.billing.projectWebhook({
      event: {
        eventId: `evt_monitoring_${randomUUID()}`,
        type: "customer.subscription.created",
        createdAt: new Date("2026-08-01T09:59:00Z"),
        livemode: false,
        kind: "subscription",
        subscriptionId: stripeSubscriptionId,
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
        eventId: `evt_monitoring_invoice_${randomUUID()}`,
        type: "invoice.paid",
        createdAt: new Date("2026-08-01T09:59:01Z"),
        livemode: false,
        kind: "invoice",
        invoiceId: `in_monitoring_${randomUUID()}`,
        subscriptionId: stripeSubscriptionId,
        customerId: stripeCustomerId,
        paymentState: "paid",
        rank: 20,
      },
      payloadHash,
      expectedLivemode: false,
      expectedPriceId: "price_founder",
    });
    await client.db
      .update(monitoringSubscriptions)
      .set({ nextDueAt: new Date("2026-08-01T10:00:00Z") })
      .where(eq(monitoringSubscriptions.projectId, projectId));

    const now = new Date("2026-08-01T10:00:01Z");
    const concurrent = await Promise.all([
      repositories.monitoring.claimDue({
        now,
        batchSize: 1,
        leaseSeconds: 300,
        leaseOwner: "worker-a",
      }),
      repositories.monitoring.claimDue({
        now,
        batchSize: 1,
        leaseSeconds: 300,
        leaseOwner: "worker-b",
      }),
    ]);
    const claims = concurrent.flat();
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({
      attempt: 1,
      projectId,
      scheduledFor: new Date("2026-08-01T10:00:00Z"),
    });

    const [request] = await client.db
      .select()
      .from(scanRequests)
      .where(eq(scanRequests.id, claims[0]!.scanRequestId));
    expect(request).toMatchObject({ origin: "MONITORING", state: "QUEUED", projectId });
    const accepted = await client.db
      .select()
      .from(founderUsageEvents)
      .where(
        and(
          eq(founderUsageEvents.projectId, projectId),
          eq(founderUsageEvents.kind, "SCHEDULED_RUN_ACCEPTED"),
        ),
      );
    expect(accepted).toHaveLength(1);

    expect(
      await repositories.monitoring.claimDue({
        now: new Date("2026-08-01T10:01:00Z"),
        batchSize: 1,
        leaseSeconds: 300,
        leaseOwner: "worker-c",
      }),
    ).toEqual([]);

    const reclaimed = await repositories.monitoring.claimDue({
      now: new Date("2026-08-01T10:05:02Z"),
      batchSize: 1,
      leaseSeconds: 300,
      leaseOwner: "worker-d",
    });
    expect(reclaimed).toHaveLength(1);
    expect(reclaimed[0]).toMatchObject({
      id: claims[0]!.id,
      scanRequestId: claims[0]!.scanRequestId,
      attempt: 2,
    });
    expect(reclaimed[0]!.leaseOwner).not.toBe(claims[0]!.leaseOwner);

    expect(
      await repositories.monitoring.finish({
        runId: claims[0]!.id,
        leaseOwner: claims[0]!.leaseOwner,
        state: "REVIEW_REQUIRED",
        now: new Date("2026-08-01T10:05:03Z"),
      }),
    ).toBe(false);
    expect(
      await repositories.monitoring.finish({
        runId: reclaimed[0]!.id,
        leaseOwner: reclaimed[0]!.leaseOwner,
        state: "REVIEW_REQUIRED",
        now: new Date("2026-08-01T10:05:03Z"),
      }),
    ).toBe(true);

    const [stored] = await client.db
      .select()
      .from(monitoringRuns)
      .where(eq(monitoringRuns.id, claims[0]!.id));
    expect(stored).toMatchObject({ state: "REVIEW_REQUIRED", attempt: 2, leaseOwner: null });
  });

  it("pauses and fences open work on payment failure, then cancels on deletion", async () => {
    await client.db
      .update(monitoringSubscriptions)
      .set({ state: "ACTIVE", nextDueAt: new Date("2026-08-02T10:00:00Z") })
      .where(eq(monitoringSubscriptions.projectId, projectId));
    const [claim] = await repositories.monitoring.claimDue({
      now: new Date("2026-08-02T10:00:01Z"),
      batchSize: 1,
      leaseSeconds: 300,
      leaseOwner: "worker-before-revocation",
    });
    expect(claim).toMatchObject({ projectId });

    await repositories.billing.projectWebhook({
      event: {
        eventId: `evt_monitoring_failed_${randomUUID()}`,
        type: "invoice.payment_failed",
        createdAt: new Date("2026-08-02T10:00:02Z"),
        livemode: false,
        kind: "invoice",
        invoiceId: `in_monitoring_failed_${randomUUID()}`,
        subscriptionId: stripeSubscriptionId,
        customerId: stripeCustomerId,
        paymentState: "failed",
        rank: 100,
      },
      payloadHash,
      expectedLivemode: false,
      expectedPriceId: "price_founder",
    });
    const [paused] = await client.db
      .select()
      .from(monitoringSubscriptions)
      .where(eq(monitoringSubscriptions.projectId, projectId));
    expect(paused?.state).toBe("PAUSED");
    const [failedRun] = await client.db
      .select()
      .from(monitoringRuns)
      .where(eq(monitoringRuns.id, claim!.id));
    expect(failedRun).toMatchObject({
      state: "FAILED",
      leaseOwner: null,
      failureCode: "ENTITLEMENT_INACTIVE",
    });
    expect(
      await repositories.monitoring.finish({
        runId: claim!.id,
        leaseOwner: claim!.leaseOwner,
        state: "REVIEW_REQUIRED",
        now: new Date("2026-08-02T10:00:03Z"),
      }),
    ).toBe(false);

    await repositories.billing.projectWebhook({
      event: {
        eventId: `evt_monitoring_deleted_${randomUUID()}`,
        type: "customer.subscription.deleted",
        createdAt: new Date("2026-08-02T10:00:04Z"),
        livemode: false,
        kind: "subscription",
        subscriptionId: stripeSubscriptionId,
        customerId: stripeCustomerId,
        projectId,
        priceId: "price_founder",
        status: "canceled",
        cancelAtPeriodEnd: false,
        currentPeriodStart: new Date("2026-08-01T00:00:00Z"),
        currentPeriodEnd: new Date("2026-09-01T00:00:00Z"),
        rank: 100,
      },
      payloadHash,
      expectedLivemode: false,
      expectedPriceId: "price_founder",
    });
    const [canceled] = await client.db
      .select()
      .from(monitoringSubscriptions)
      .where(eq(monitoringSubscriptions.projectId, projectId));
    expect(canceled?.state).toBe("CANCELED");
  });
});
