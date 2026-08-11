import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import {
  createDatabaseFromEnv,
  createRepositories,
  founderUsageEvents,
  nextMoves,
  projectContextVersions,
  projects,
  scanRequests,
  scanRuns,
} from "../src/index";
import { FIXTURE_PROJECT_CONTEXT } from "../src/seed";

const databaseDescribe = process.env.RUN_DATABASE_INTEGRATION === "1" ? describe : describe.skip;
const payloadHash = `sha256:${"e".repeat(64)}`;

databaseDescribe("Founder delivery limits", () => {
  const client = createDatabaseFromEnv();
  const repositories = createRepositories(client.db);
  const projectIds: string[] = [];

  afterAll(async () => {
    for (const projectId of projectIds) {
      await client.db.delete(scanRequests).where(eq(scanRequests.projectId, projectId));
      await client.db.delete(projects).where(eq(projects.id, projectId));
    }
    await client.close();
  });

  async function createApprovedMove(projectId: string, label: string) {
    const [context] = await client.db
      .insert(projectContextVersions)
      .values({
        projectId,
        version: Number(label.replace(/\D/g, "")) || 1,
        isCurrent: label.endsWith("1"),
        inferredName: "Delivery integration",
        category: "test",
        audience: "founders",
        problem: "delivery limits",
        language: "en",
        credibleTopics: ["billing"],
        assumptions: ["integration test"],
        context: { ...FIXTURE_PROJECT_CONTEXT, url: `https://${label}.example` },
      })
      .returning();
    const [request] = await client.db
      .insert(scanRequests)
      .values({
        publicId: `scan_delivery_${label}_${randomUUID()}`,
        projectId,
        origin: "OPS",
        state: "REVIEW_REQUIRED",
        submittedUrl: `https://${label}.example`,
        normalizedUrl: `https://${label}.example/`,
      })
      .returning();
    if (!context || !request) throw new Error("delivery fixture setup failed");
    const [run] = await client.db
      .insert(scanRuns)
      .values({
        scanRequestId: request.id,
        projectContextVersionId: context.id,
        state: "REVIEW_REQUIRED",
        reviewRequiredAt: new Date(),
      })
      .returning();
    if (!run) throw new Error("delivery run setup failed");
    const [move] = await client.db
      .insert(nextMoves)
      .values({
        publicId: `move_delivery_${label}_${randomUUID()}`,
        scanRequestId: request.id,
        scanRunId: run.id,
        projectContextVersionId: context.id,
        state: "APPROVED",
        action: "WAIT",
        channel: "none",
        topic: "Hold",
        angle: "Evidence is not yet strong enough.",
        format: "none",
        hook: "Wait for stronger evidence.",
        outline: ["Observe"],
        cta: "Reassess tomorrow.",
        priority: 1,
        confidence: "0.50000",
        whyNow: "The decision is bounded.",
        signalClass: "INSUFFICIENT_SIGNAL",
        independentSourceCount: 0,
        saturation: "unknown",
        founderReviewed: true,
        promptVersion: "integration",
        scoreVersion: "integration",
        validUntil: new Date(Date.now() + 86_400_000),
        approvedAt: new Date(),
      })
      .returning();
    if (!move) throw new Error("delivery move setup failed");
    return { request, move };
  }

  it("keeps free founder-reviewed delivery unchanged", async () => {
    const projectHost = `free-delivery-${randomUUID()}.example`;
    const [project] = await client.db
      .insert(projects)
      .values({
        publicId: `project_free_delivery_${randomUUID()}`,
        url: `https://${projectHost}`,
        normalizedUrl: `https://${projectHost}/`,
      })
      .returning();
    if (!project) throw new Error("free project setup failed");
    projectIds.push(project.id);
    const { request, move } = await createApprovedMove(project.id, "free1");
    await expect(
      repositories.delivery.deliver({
        nextMoveId: move.id,
        reviewerId: "founder:integration",
        expiresAt: new Date(Date.now() + 86_400_000),
      }),
    ).resolves.toMatchObject({ created: true });
    const usage = await client.db
      .select()
      .from(founderUsageEvents)
      .where(eq(founderUsageEvents.scanRequestId, request.id));
    expect(usage).toEqual([]);
  });

  it("records one paid delivery and rejects a second delivery that UTC day", async () => {
    const projectHost = `paid-delivery-${randomUUID()}.example`;
    const [project] = await client.db
      .insert(projects)
      .values({
        publicId: `project_paid_delivery_${randomUUID()}`,
        url: `https://${projectHost}`,
        normalizedUrl: `https://${projectHost}/`,
      })
      .returning();
    if (!project) throw new Error("paid project setup failed");
    projectIds.push(project.id);
    const subscriptionId = `sub_delivery_${randomUUID()}`;
    const customerId = `cus_delivery_${randomUUID()}`;
    const checkout = await repositories.billing.recordCheckout({
      projectId: project.id,
      stripeCheckoutSessionId: `cs_test_delivery_${randomUUID()}`,
      initiatedBy: "founder:integration",
    });
    await repositories.billing.projectWebhook({
      event: {
        eventId: `evt_delivery_subscription_${randomUUID()}`,
        type: "customer.subscription.created",
        createdAt: new Date(),
        livemode: false,
        kind: "subscription",
        subscriptionId,
        checkoutReservationId: checkout.id,
        customerId,
        projectId: project.id,
        priceId: "price_founder",
        status: "active",
        cancelAtPeriodEnd: false,
        currentPeriodStart: new Date("2026-01-01T00:00:00Z"),
        currentPeriodEnd: new Date("2027-01-01T00:00:00Z"),
        rank: 20,
      },
      payloadHash,
      expectedLivemode: false,
      expectedPriceId: "price_founder",
    });
    await repositories.billing.projectWebhook({
      event: {
        eventId: `evt_delivery_invoice_${randomUUID()}`,
        type: "invoice.paid",
        createdAt: new Date(Date.now() + 1_000),
        livemode: false,
        kind: "invoice",
        invoiceId: `in_delivery_${randomUUID()}`,
        subscriptionId,
        customerId,
        paymentState: "paid",
        periodStart: new Date("2026-01-01T00:00:00Z"),
        periodEnd: new Date("2027-01-01T00:00:00Z"),
        rank: 20,
      },
      payloadHash,
      expectedLivemode: false,
      expectedPriceId: "price_founder",
    });
    const first = await createApprovedMove(project.id, "paid1");
    const second = await createApprovedMove(project.id, "paid2");
    for (const [index, request] of [first.request, second.request].entries()) {
      await expect(
        repositories.founderUsage.admit({
          projectId: project.id,
          scanRequestId: request.id,
          kind: "ON_DEMAND_RUN_ACCEPTED",
          idempotencyKey: `delivery-acceptance:${request.id}:${index}`,
          occurredAt: new Date(),
        }),
      ).resolves.toMatchObject({ status: "ACCEPTED" });
    }
    await expect(
      repositories.delivery.deliver({
        nextMoveId: first.move.id,
        reviewerId: "founder:integration",
        expiresAt: new Date(Date.now() + 86_400_000),
      }),
    ).resolves.toMatchObject({ created: true });
    await expect(
      repositories.delivery.deliver({
        nextMoveId: second.move.id,
        reviewerId: "founder:integration",
        expiresAt: new Date(Date.now() + 86_400_000),
      }),
    ).rejects.toThrow(/daily delivery limit/i);
    const deliveredUsage = await client.db
      .select()
      .from(founderUsageEvents)
      .where(
        and(
          eq(founderUsageEvents.projectId, project.id),
          eq(founderUsageEvents.kind, "NEXT_MOVE_DELIVERED"),
        ),
      );
    expect(deliveredUsage).toHaveLength(1);
  });
});
