import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import {
  analyticsEvents,
  createDatabaseFromEnv,
  createRepositories,
  deliveryTokens,
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
  const moveIds: string[] = [];

  afterAll(async () => {
    for (const moveId of moveIds) {
      await client.db.delete(analyticsEvents).where(eq(analyticsEvents.nextMoveId, moveId));
    }
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
    moveIds.push(move.id);
    return { request, run, move };
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
    await expect(
      repositories.delivery.deliver({
        nextMoveId: move.id,
        reviewerId: "founder:integration",
        expiresAt: new Date(Date.now() + 86_400_000),
      }),
    ).resolves.toMatchObject({ created: false });
    const usage = await client.db
      .select()
      .from(founderUsageEvents)
      .where(eq(founderUsageEvents.scanRequestId, request.id));
    expect(usage).toEqual([]);
    const deliveryEvents = await client.db
      .select()
      .from(analyticsEvents)
      .where(eq(analyticsEvents.nextMoveId, move.id));
    expect(deliveryEvents).toHaveLength(1);
    expect(deliveryEvents[0]).toMatchObject({
      name: "scan_delivered",
      scanRequestId: request.id,
      properties: { created: true },
    });
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

  it("serializes delivery against a concurrent failure without resurrecting stale state", async () => {
    const projectHost = `delivery-race-${randomUUID()}.example`;
    const [project] = await client.db
      .insert(projects)
      .values({
        publicId: `project_delivery_race_${randomUUID()}`,
        url: `https://${projectHost}`,
        normalizedUrl: `https://${projectHost}/`,
      })
      .returning();
    if (!project) throw new Error("delivery race project setup failed");
    projectIds.push(project.id);
    const { request, run, move } = await createApprovedMove(project.id, "race1");

    const outcomes = await Promise.allSettled([
      repositories.delivery.deliver({
        nextMoveId: move.id,
        reviewerId: "founder:delivery-race",
        expiresAt: new Date(Date.now() + 86_400_000),
      }),
      repositories.reviews.markFailed({
        scanRequestId: request.id,
        scanRunId: run.id,
        reviewerId: "founder:failure-race",
        failureCode: "MANUAL_RACE_TEST",
        failureMessage: "The failure path won the serialized state transition.",
      }),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);

    const [storedRequest] = await client.db
      .select()
      .from(scanRequests)
      .where(eq(scanRequests.id, request.id));
    const [storedRun] = await client.db.select().from(scanRuns).where(eq(scanRuns.id, run.id));
    const [storedMove] = await client.db.select().from(nextMoves).where(eq(nextMoves.id, move.id));
    const tokens = await client.db
      .select()
      .from(deliveryTokens)
      .where(eq(deliveryTokens.nextMoveId, move.id));
    if (storedRequest?.state === "READY") {
      expect(storedRun?.state).toBe("READY");
      expect(storedMove?.state).toBe("READY");
      expect(tokens).toHaveLength(1);
    } else {
      expect(storedRequest?.state).toBe("FAILED");
      expect(storedRun?.state).toBe("FAILED");
      expect(storedMove?.state).toBe("REJECTED");
      expect(tokens).toHaveLength(0);
    }
  });

  it("rejects a failure transition whose request and run belong to different scans", async () => {
    const projectHost = `failure-identity-${randomUUID()}.example`;
    const [project] = await client.db
      .insert(projects)
      .values({
        publicId: `project_failure_identity_${randomUUID()}`,
        url: `https://${projectHost}`,
        normalizedUrl: `https://${projectHost}/`,
      })
      .returning();
    if (!project) throw new Error("failure identity project setup failed");
    projectIds.push(project.id);
    const first = await createApprovedMove(project.id, "identity2");
    const second = await createApprovedMove(project.id, "identity3");

    await expect(
      repositories.reviews.markFailed({
        scanRequestId: first.request.id,
        scanRunId: second.run.id,
        reviewerId: "founder:identity-test",
        failureCode: "MISMATCHED_SCAN_IDENTITY",
        failureMessage: "A mismatched request and run must not transition.",
      }),
    ).rejects.toThrow(/run cannot be marked failed/i);

    const [storedFirstRequest] = await client.db
      .select({ state: scanRequests.state })
      .from(scanRequests)
      .where(eq(scanRequests.id, first.request.id));
    const [storedSecondRun] = await client.db
      .select({ state: scanRuns.state })
      .from(scanRuns)
      .where(eq(scanRuns.id, second.run.id));
    expect(storedFirstRequest?.state).toBe("REVIEW_REQUIRED");
    expect(storedSecondRun?.state).toBe("REVIEW_REQUIRED");
  });
});
