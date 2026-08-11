import { randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import {
  billingWebhookEvents,
  createDatabaseFromEnv,
  createRepositories,
  monitoringSubscriptions,
  projectEntitlements,
  projects,
} from "../src/index";

const databaseDescribe = process.env.RUN_DATABASE_INTEGRATION === "1" ? describe : describe.skip;
const hashA = `sha256:${"a".repeat(64)}`;
const hashB = `sha256:${"b".repeat(64)}`;
const suffix = randomUUID();
const stripeSubscriptionId = `sub_ordering_${suffix}`;
const stripeCustomerId = `cus_ordering_${suffix}`;
const checkoutSessionId = `cs_test_ordering_${suffix}`;
const unboundCheckoutSessionId = `cs_test_unbound_${suffix}`;
const eventId = (name: string) => `evt_${name}_${suffix}`;

databaseDescribe("Stripe webhook-authoritative billing projection", () => {
  const client = createDatabaseFromEnv();
  const repositories = createRepositories(client.db);
  const projectPublicId = `project_billing_${randomUUID()}`;
  let projectId = "";
  let secondProjectId = "";

  afterAll(async () => {
    if (secondProjectId) await client.db.delete(projects).where(eq(projects.id, secondProjectId));
    if (projectId) await client.db.delete(projects).where(eq(projects.id, projectId));
    await client.close();
  });

  it("is idempotent, order-safe, checkout-independent, and fail-closed on payment", async () => {
    const [project] = await client.db
      .insert(projects)
      .values({
        publicId: projectPublicId,
        name: "Billing integration",
        url: "https://billing-integration.example",
        normalizedUrl: "https://billing-integration.example",
      })
      .returning();
    if (!project) throw new Error("project setup failed");
    projectId = project.id;

    await repositories.billing.recordCheckout({
      projectId,
      stripeCheckoutSessionId: checkoutSessionId,
      initiatedBy: "founder:integration",
    });

    const subscriptionCreated = {
      eventId: eventId("subscription_created"),
      type: "customer.subscription.created" as const,
      createdAt: new Date("2026-08-11T10:00:02Z"),
      livemode: false,
      kind: "subscription" as const,
      subscriptionId: stripeSubscriptionId,
      customerId: stripeCustomerId,
      projectId,
      priceId: "price_founder",
      status: "active" as const,
      cancelAtPeriodEnd: false,
      currentPeriodStart: new Date("2026-08-01T00:00:00Z"),
      currentPeriodEnd: new Date("2026-09-01T00:00:00Z"),
      rank: 20,
    };
    expect(
      await repositories.billing.projectWebhook({
        event: subscriptionCreated,
        payloadHash: hashA,
        expectedLivemode: false,
        expectedPriceId: "price_founder",
      }),
    ).toMatchObject({ status: "APPLIED", entitlementActive: false });

    // Checkout can arrive later and omit both optional Stripe links. It must
    // complete the binding record without being an access authority.
    expect(
      await repositories.billing.projectWebhook({
        event: {
          eventId: eventId("checkout_completed"),
          type: "checkout.session.completed",
          createdAt: new Date("2026-08-11T10:00:01Z"),
          livemode: false,
          kind: "checkout",
          checkoutSessionId,
          projectId,
          customerId: null,
          subscriptionId: null,
          grantsEntitlement: false,
        },
        payloadHash: hashA,
        expectedLivemode: false,
        expectedPriceId: "price_founder",
      }),
    ).toMatchObject({ status: "APPLIED", entitlementActive: null });

    // A stale past-due snapshot cannot replace the newer active projection.
    expect(
      await repositories.billing.projectWebhook({
        event: {
          ...subscriptionCreated,
          eventId: eventId("subscription_stale"),
          type: "customer.subscription.updated",
          createdAt: new Date("2026-08-11T10:00:00Z"),
          status: "past_due",
          rank: 80,
        },
        payloadHash: hashA,
        expectedLivemode: false,
        expectedPriceId: "price_founder",
      }),
    ).toMatchObject({ status: "STALE" });

    expect(
      await repositories.billing.projectWebhook({
        event: subscriptionCreated,
        payloadHash: hashA,
        expectedLivemode: false,
        expectedPriceId: "price_founder",
      }),
    ).toEqual({ status: "DUPLICATE" });
    await expect(
      repositories.billing.projectWebhook({
        event: subscriptionCreated,
        payloadHash: hashB,
        expectedLivemode: false,
        expectedPriceId: "price_founder",
      }),
    ).rejects.toThrow(/different payload hash/i);

    const invoiceBase = {
      type: "invoice.payment_failed" as const,
      livemode: false,
      kind: "invoice" as const,
      invoiceId: `in_ordering_${suffix}`,
      subscriptionId: stripeSubscriptionId,
      customerId: stripeCustomerId,
      paymentState: "failed" as const,
      rank: 100,
    };
    expect(
      await repositories.billing.projectWebhook({
        event: {
          ...invoiceBase,
          eventId: eventId("invoice_paid_initial"),
          type: "invoice.paid",
          paymentState: "paid",
          rank: 20,
          createdAt: new Date("2026-08-11T10:00:03Z"),
        },
        payloadHash: hashA,
        expectedLivemode: false,
        expectedPriceId: "price_founder",
      }),
    ).toMatchObject({ status: "APPLIED", entitlementActive: true });
    expect(
      await repositories.billing.projectWebhook({
        event: {
          ...invoiceBase,
          eventId: eventId("invoice_failed"),
          createdAt: new Date("2026-08-11T10:00:05Z"),
        },
        payloadHash: hashA,
        expectedLivemode: false,
        expectedPriceId: "price_founder",
      }),
    ).toMatchObject({ status: "APPLIED", entitlementActive: false });

    expect(
      await repositories.billing.projectWebhook({
        event: {
          ...invoiceBase,
          eventId: eventId("invoice_paid_stale"),
          type: "invoice.paid",
          paymentState: "paid",
          rank: 20,
          createdAt: new Date("2026-08-11T10:00:04Z"),
        },
        payloadHash: hashA,
        expectedLivemode: false,
        expectedPriceId: "price_founder",
      }),
    ).toMatchObject({ status: "STALE" });

    expect(
      await repositories.billing.projectWebhook({
        event: {
          ...invoiceBase,
          eventId: eventId("invoice_paid_new"),
          type: "invoice.paid",
          paymentState: "paid",
          rank: 20,
          createdAt: new Date("2026-08-11T10:00:06Z"),
        },
        payloadHash: hashA,
        expectedLivemode: false,
        expectedPriceId: "price_founder",
      }),
    ).toMatchObject({ status: "APPLIED", entitlementActive: true });

    const [entitlement] = await client.db
      .select()
      .from(projectEntitlements)
      .where(eq(projectEntitlements.projectId, projectId));
    expect(entitlement?.active).toBe(true);
    const [monitoring] = await client.db
      .select()
      .from(monitoringSubscriptions)
      .where(eq(monitoringSubscriptions.projectId, projectId));
    expect(monitoring?.state).toBe("ACTIVE");
  });

  it("records a field-poor checkout event as ignored without granting access", async () => {
    expect(
      await repositories.billing.projectWebhook({
        event: {
          eventId: eventId("checkout_unbound"),
          type: "checkout.session.completed",
          createdAt: new Date("2026-08-11T10:01:00Z"),
          livemode: false,
          kind: "checkout",
          checkoutSessionId: unboundCheckoutSessionId,
          projectId: null,
          customerId: null,
          subscriptionId: null,
          grantsEntitlement: false,
        },
        payloadHash: hashA,
        expectedLivemode: false,
        expectedPriceId: "price_founder",
      }),
    ).toEqual({ status: "IGNORED", reason: "CHECKOUT_PROJECT_UNRESOLVED" });
    const [receipt] = await client.db
      .select()
      .from(billingWebhookEvents)
      .where(eq(billingWebhookEvents.stripeEventId, eventId("checkout_unbound")));
    expect(receipt?.state).toBe("IGNORED");
  });

  it("does not let one Stripe customer own a second Founder project", async () => {
    const host = `billing-second-${randomUUID()}.example`;
    const [project] = await client.db
      .insert(projects)
      .values({
        publicId: `project_billing_second_${randomUUID()}`,
        url: `https://${host}`,
        normalizedUrl: `https://${host}/`,
      })
      .returning();
    if (!project) throw new Error("second project setup failed");
    secondProjectId = project.id;
    await expect(
      repositories.billing.projectWebhook({
        event: {
          eventId: eventId("second_project"),
          type: "customer.subscription.created",
          createdAt: new Date("2026-08-11T11:00:00Z"),
          livemode: false,
          kind: "subscription",
          subscriptionId: `sub_second_${suffix}`,
          customerId: stripeCustomerId,
          projectId: project.id,
          priceId: "price_founder",
          status: "active",
          cancelAtPeriodEnd: false,
          currentPeriodStart: new Date("2026-08-01T00:00:00Z"),
          currentPeriodEnd: new Date("2026-09-01T00:00:00Z"),
          rank: 20,
        },
        payloadHash: hashA,
        expectedLivemode: false,
        expectedPriceId: "price_founder",
      }),
    ).rejects.toThrow(/cannot own multiple Founder projects/i);
  });
});
