import { createHash, randomUUID } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import {
  BillingCheckoutConflictError,
  analyticsEvents,
  billingCheckoutSessions,
  billingWebhookEvents,
  createDatabaseFromEnv,
  createRepositories,
  monitoringSubscriptions,
  projectEntitlements,
  projects,
  subscriptions,
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
const billingDedupe = (name: string, id: string) =>
  createHash("sha256").update(`trendsfast:billing:v1\0${name}\0${id}`).digest("hex");

databaseDescribe("Stripe webhook-authoritative billing projection", () => {
  const client = createDatabaseFromEnv();
  const repositories = createRepositories(client.db);
  const projectPublicId = `project_billing_${randomUUID()}`;
  let projectId = "";
  let secondProjectId = "";
  let checkoutProjectId = "";
  let atomicProjectId = "";
  let subscriptionAtomicProjectId = "";
  let fieldPoorCompletedProjectId = "";

  afterAll(async () => {
    if (fieldPoorCompletedProjectId)
      await client.db.delete(projects).where(eq(projects.id, fieldPoorCompletedProjectId));
    if (subscriptionAtomicProjectId)
      await client.db.delete(projects).where(eq(projects.id, subscriptionAtomicProjectId));
    if (atomicProjectId) await client.db.delete(projects).where(eq(projects.id, atomicProjectId));
    if (checkoutProjectId)
      await client.db.delete(projects).where(eq(projects.id, checkoutProjectId));
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

    const checkoutBinding = await repositories.billing.recordCheckout({
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
      checkoutReservationId: checkoutBinding.id,
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
          checkoutReservationId: checkoutBinding.id,
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
      periodStart: new Date("2026-08-01T00:00:00Z"),
      periodEnd: new Date("2026-09-01T00:00:00Z"),
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

    // Rolling the active subscription into September must revoke access until
    // a PAID invoice explicitly covers that exact service period.
    expect(
      await repositories.billing.projectWebhook({
        event: {
          ...subscriptionCreated,
          eventId: eventId("subscription_period_rolled"),
          type: "customer.subscription.updated",
          createdAt: new Date("2026-08-11T10:00:07Z"),
          currentPeriodStart: new Date("2026-09-01T00:00:00Z"),
          currentPeriodEnd: new Date("2026-10-01T00:00:00Z"),
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
          eventId: eventId("invoice_paid_current_period"),
          type: "invoice.paid",
          invoiceId: `in_current_${suffix}`,
          paymentState: "paid",
          periodStart: new Date("2026-09-01T00:00:00Z"),
          periodEnd: new Date("2026-10-01T00:00:00Z"),
          rank: 20,
          createdAt: new Date("2026-08-11T10:00:08Z"),
        },
        payloadHash: hashA,
        expectedLivemode: false,
        expectedPriceId: "price_founder",
      }),
    ).toMatchObject({ status: "APPLIED", entitlementActive: true });

    // A later-delivered PAID webhook for the prior period remains non-authoritative.
    expect(
      await repositories.billing.projectWebhook({
        event: {
          ...invoiceBase,
          eventId: eventId("invoice_paid_prior_period_late"),
          type: "invoice.paid",
          invoiceId: `in_prior_late_${suffix}`,
          paymentState: "paid",
          rank: 20,
          createdAt: new Date("2026-08-11T10:00:09Z"),
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
          eventId: eventId("invoice_paid_current_period_replayed"),
          type: "invoice.paid",
          invoiceId: `in_current_replayed_${suffix}`,
          paymentState: "paid",
          periodStart: new Date("2026-09-01T00:00:00Z"),
          periodEnd: new Date("2026-10-01T00:00:00Z"),
          rank: 20,
          createdAt: new Date("2026-08-11T10:00:10Z"),
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
    const subscriptionAnalytics = await client.db
      .select()
      .from(analyticsEvents)
      .where(
        eq(analyticsEvents.dedupeKey, billingDedupe("subscription_started", stripeSubscriptionId)),
      );
    expect(subscriptionAnalytics).toHaveLength(1);
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
          checkoutReservationId: null,
          projectId: null,
          customerId: null,
          subscriptionId: null,
          grantsEntitlement: false,
        },
        payloadHash: hashA,
        expectedLivemode: false,
        expectedPriceId: "price_founder",
      }),
    ).toEqual({ status: "IGNORED", reason: "CHECKOUT_NOT_AUTHORIZED" });
    const [receipt] = await client.db
      .select()
      .from(billingWebhookEvents)
      .where(eq(billingWebhookEvents.stripeEventId, eventId("checkout_unbound")));
    expect(receipt?.state).toBe("IGNORED");
  });

  it("does not authorize Checkout from signed project metadata without an ops reservation", async () => {
    expect(
      await repositories.billing.projectWebhook({
        event: {
          eventId: eventId("checkout_metadata_only"),
          type: "checkout.session.completed",
          createdAt: new Date("2026-08-11T10:01:01Z"),
          livemode: false,
          kind: "checkout",
          checkoutSessionId: `cs_test_metadata_only_${suffix}`,
          checkoutReservationId: randomUUID(),
          projectId,
          customerId: `cus_metadata_only_${suffix}`,
          subscriptionId: `sub_metadata_only_${suffix}`,
          grantsEntitlement: false,
        },
        payloadHash: hashA,
        expectedLivemode: false,
        expectedPriceId: "price_founder",
      }),
    ).toEqual({ status: "IGNORED", reason: "CHECKOUT_NOT_AUTHORIZED" });
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
    const checkout = await repositories.billing.recordCheckout({
      projectId: project.id,
      stripeCheckoutSessionId: `cs_test_second_${suffix}`,
      initiatedBy: "founder:integration",
    });
    await expect(
      repositories.billing.projectWebhook({
        event: {
          eventId: eventId("second_project"),
          type: "customer.subscription.created",
          createdAt: new Date("2026-08-11T11:00:00Z"),
          livemode: false,
          kind: "subscription",
          subscriptionId: `sub_second_${suffix}`,
          checkoutReservationId: checkout.id,
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
    ).rejects.toThrow();
  });

  it("durably ignores a metadata-only second subscription without retry-looping", async () => {
    expect(
      await repositories.billing.projectWebhook({
        event: {
          eventId: eventId("duplicate_nonterminal_subscription"),
          type: "customer.subscription.created",
          createdAt: new Date("2026-08-11T12:00:00Z"),
          livemode: false,
          kind: "subscription",
          subscriptionId: `sub_duplicate_${suffix}`,
          checkoutReservationId: null,
          customerId: stripeCustomerId,
          projectId,
          priceId: "price_founder",
          status: "active",
          cancelAtPeriodEnd: false,
          currentPeriodStart: new Date("2026-09-01T00:00:00Z"),
          currentPeriodEnd: new Date("2026-10-01T00:00:00Z"),
          rank: 20,
        },
        payloadHash: hashA,
        expectedLivemode: false,
        expectedPriceId: "price_founder",
      }),
    ).toEqual({ status: "IGNORED", reason: "SUBSCRIPTION_NOT_AUTHORIZED" });
    const storedSubscriptions = await client.db
      .select({ stripeSubscriptionId: subscriptions.stripeSubscriptionId })
      .from(subscriptions)
      .where(eq(subscriptions.projectId, projectId));
    expect(storedSubscriptions).toEqual([{ stripeSubscriptionId }]);
    const [receipt] = await client.db
      .select()
      .from(billingWebhookEvents)
      .where(eq(billingWebhookEvents.stripeEventId, eventId("duplicate_nonterminal_subscription")));
    expect(receipt).toMatchObject({
      state: "IGNORED",
      failureCode: "SUBSCRIPTION_NOT_AUTHORIZED",
    });
  });

  it("reserves one Checkout attempt, binds replays once, and reconciles expiration", async () => {
    const host = `billing-checkout-${randomUUID()}.example`;
    const [project] = await client.db
      .insert(projects)
      .values({
        publicId: `project_billing_checkout_${randomUUID()}`,
        url: `https://${host}`,
        normalizedUrl: `https://${host}/`,
      })
      .returning();
    if (!project) throw new Error("checkout project setup failed");
    checkoutProjectId = project.id;

    const reservations = await Promise.all([
      repositories.billing.reserveProjectCheckout({
        projectId: project.id,
        initiatedBy: "founder:first",
        now: new Date("2026-08-11T10:00:00Z"),
        expiresAt: new Date("2026-08-11T11:00:00Z"),
      }),
      repositories.billing.reserveProjectCheckout({
        projectId: project.id,
        initiatedBy: "founder:second",
        now: new Date("2026-08-11T10:00:01Z"),
        expiresAt: new Date("2026-08-11T11:00:00Z"),
      }),
    ]);
    expect(reservations.filter((result) => result.created)).toHaveLength(1);
    expect(new Set(reservations.map((result) => result.reservation.id))).toHaveLength(1);
    const reservation = reservations[0]!.reservation;
    expect(reservation.stripeCheckoutSessionId).toBeNull();

    await Promise.all([
      repositories.billing.bindProjectCheckout({
        reservationId: reservation.id,
        stripeCheckoutSessionId: `cs_test_serialized_${suffix}`,
        livemode: false,
        occurredAt: new Date("2026-08-11T10:00:02Z"),
      }),
      repositories.billing.bindProjectCheckout({
        reservationId: reservation.id,
        stripeCheckoutSessionId: `cs_test_serialized_${suffix}`,
        livemode: false,
        occurredAt: new Date("2026-08-11T10:00:02Z"),
      }),
    ]);
    const checkoutAnalytics = await client.db
      .select()
      .from(analyticsEvents)
      .where(
        eq(
          analyticsEvents.dedupeKey,
          billingDedupe("checkout_started", `cs_test_serialized_${suffix}`),
        ),
      );
    expect(checkoutAnalytics).toHaveLength(1);

    await expect(
      repositories.billing.recordCheckout({
        projectId: project.id,
        stripeCheckoutSessionId: `cs_test_serialized_${suffix}`,
        initiatedBy: "founder:replay",
      }),
    ).resolves.toMatchObject({ stripeCheckoutSessionId: `cs_test_serialized_${suffix}` });
    await expect(
      repositories.billing.recordCheckout({
        projectId: project.id,
        stripeCheckoutSessionId: `cs_test_second_open_${suffix}`,
        initiatedBy: "founder:replay",
      }),
    ).rejects.toBeInstanceOf(BillingCheckoutConflictError);

    await repositories.billing.expireProjectCheckout({
      reservationId: reservation.id,
      stripeCheckoutSessionId: `cs_test_serialized_${suffix}`,
      occurredAt: new Date("2026-08-11T11:00:01Z"),
    });
    const replacement = await repositories.billing.reserveProjectCheckout({
      projectId: project.id,
      initiatedBy: "founder:after-expiry",
      now: new Date("2026-08-11T11:00:01Z"),
      expiresAt: new Date("2026-08-11T12:00:00Z"),
    });
    expect(replacement).toMatchObject({ created: true });
    await repositories.billing.bindProjectCheckout({
      reservationId: replacement.reservation.id,
      stripeCheckoutSessionId: `cs_test_after_expiry_${suffix}`,
      livemode: false,
      occurredAt: new Date("2026-08-11T11:00:02Z"),
    });
    const checkoutStates = await client.db
      .select({
        sessionId: billingCheckoutSessions.stripeCheckoutSessionId,
        state: billingCheckoutSessions.state,
      })
      .from(billingCheckoutSessions)
      .where(eq(billingCheckoutSessions.projectId, project.id));
    expect(checkoutStates).toEqual(
      expect.arrayContaining([
        { sessionId: `cs_test_serialized_${suffix}`, state: "EXPIRED" },
        { sessionId: `cs_test_after_expiry_${suffix}`, state: "OPEN" },
      ]),
    );
    await repositories.billing.projectWebhook({
      event: {
        eventId: eventId("checkout_completed_subscription_pending"),
        type: "checkout.session.completed",
        createdAt: new Date("2026-08-11T11:00:03Z"),
        livemode: false,
        kind: "checkout",
        checkoutSessionId: `cs_test_after_expiry_${suffix}`,
        checkoutReservationId: replacement.reservation.id,
        projectId: project.id,
        customerId: `cus_checkout_pending_${suffix}`,
        subscriptionId: `sub_checkout_pending_${suffix}`,
        grantsEntitlement: false,
      },
      payloadHash: hashA,
      expectedLivemode: false,
      expectedPriceId: "price_founder",
    });
    await expect(
      repositories.billing.reserveProjectCheckout({
        projectId: project.id,
        initiatedBy: "founder:completed-webhook-pending",
        now: new Date("2026-08-11T12:00:01Z"),
        expiresAt: new Date("2026-08-11T13:00:00Z"),
      }),
    ).rejects.toMatchObject({
      code: "CHECKOUT_COMPLETED_PENDING",
    });
  });

  it("rejects Checkout before reserving an attempt when a nonterminal subscription exists", async () => {
    await expect(
      repositories.billing.reserveProjectCheckout({
        projectId,
        initiatedBy: "founder:duplicate-subscription",
        now: new Date("2026-08-11T12:00:00Z"),
        expiresAt: new Date("2026-08-11T13:00:00Z"),
      }),
    ).rejects.toMatchObject({
      code: "SUBSCRIPTION_ALREADY_NONTERMINAL",
    });
  });

  it("keeps a field-poor completed Checkout pending until its subscription is projected", async () => {
    const host = `billing-completed-field-poor-${randomUUID()}.example`;
    const [project] = await client.db
      .insert(projects)
      .values({
        publicId: `project_billing_completed_field_poor_${randomUUID()}`,
        url: `https://${host}`,
        normalizedUrl: `https://${host}/`,
      })
      .returning();
    if (!project) throw new Error("field-poor completed project setup failed");
    fieldPoorCompletedProjectId = project.id;
    const checkoutSessionId = `cs_test_completed_field_poor_${suffix}`;
    const checkoutBinding = await repositories.billing.recordCheckout({
      projectId: project.id,
      stripeCheckoutSessionId: checkoutSessionId,
      initiatedBy: "founder:integration",
    });
    await repositories.billing.projectWebhook({
      event: {
        eventId: eventId("checkout_completed_field_poor"),
        type: "checkout.session.completed",
        createdAt: new Date("2026-08-11T12:15:00Z"),
        livemode: false,
        kind: "checkout",
        checkoutSessionId,
        checkoutReservationId: checkoutBinding.id,
        projectId: project.id,
        customerId: null,
        subscriptionId: null,
        grantsEntitlement: false,
      },
      payloadHash: hashA,
      expectedLivemode: false,
      expectedPriceId: "price_founder",
    });

    await expect(
      repositories.billing.reserveProjectCheckout({
        projectId: project.id,
        initiatedBy: "founder:completed-field-poor",
        now: new Date("2026-08-11T12:16:00Z"),
        expiresAt: new Date("2026-08-11T13:16:00Z"),
      }),
    ).rejects.toMatchObject({ code: "CHECKOUT_COMPLETED_PENDING" });
  });

  it("rolls back entitlement and receipt when subscription analytics fails, then replays once", async () => {
    const host = `billing-subscription-atomic-${randomUUID()}.example`;
    const [project] = await client.db
      .insert(projects)
      .values({
        publicId: `project_billing_subscription_atomic_${randomUUID()}`,
        url: `https://${host}`,
        normalizedUrl: `https://${host}/`,
      })
      .returning();
    if (!project) throw new Error("atomic subscription project setup failed");
    subscriptionAtomicProjectId = project.id;
    const subscriptionId = `sub_atomic_${suffix}`;
    const customerId = `cus_atomic_${suffix}`;
    const checkout = await repositories.billing.recordCheckout({
      projectId: project.id,
      stripeCheckoutSessionId: `cs_test_subscription_atomic_${suffix}`,
      initiatedBy: "founder:atomic",
    });
    await repositories.billing.projectWebhook({
      event: {
        eventId: eventId("subscription_atomic_created"),
        type: "customer.subscription.created",
        createdAt: new Date("2026-08-11T12:30:00Z"),
        livemode: false,
        kind: "subscription",
        subscriptionId,
        checkoutReservationId: checkout.id,
        customerId,
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
    });
    const paidEvent = {
      eventId: eventId("subscription_atomic_paid"),
      type: "invoice.paid" as const,
      createdAt: new Date("2026-08-11T12:30:01Z"),
      livemode: false,
      kind: "invoice" as const,
      invoiceId: `in_atomic_${suffix}`,
      subscriptionId,
      customerId,
      paymentState: "paid" as const,
      periodStart: new Date("2026-08-01T00:00:00Z"),
      periodEnd: new Date("2026-09-01T00:00:00Z"),
      rank: 20,
    };
    const dedupeKey = billingDedupe("subscription_started", subscriptionId);
    const triggerSuffix = suffix.replaceAll("-", "_");
    await client.pool.query(`
      CREATE OR REPLACE FUNCTION billing_subscription_analytics_failure_${triggerSuffix}()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.dedupe_key = '${dedupeKey}' THEN
          RAISE EXCEPTION 'forced subscription analytics failure';
        END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER billing_subscription_analytics_failure_${triggerSuffix}
      BEFORE INSERT ON analytics_events
      FOR EACH ROW EXECUTE FUNCTION billing_subscription_analytics_failure_${triggerSuffix}();
    `);
    try {
      await expect(
        repositories.billing.projectWebhook({
          event: paidEvent,
          payloadHash: hashA,
          expectedLivemode: false,
          expectedPriceId: "price_founder",
        }),
      ).rejects.toThrow(/analytics_events/i);
      const [afterFailure] = await client.db
        .select()
        .from(projectEntitlements)
        .where(eq(projectEntitlements.projectId, project.id));
      expect(afterFailure?.active).toBe(false);
      const failedReceipt = await client.db
        .select()
        .from(billingWebhookEvents)
        .where(eq(billingWebhookEvents.stripeEventId, paidEvent.eventId));
      expect(failedReceipt).toHaveLength(0);
    } finally {
      await client.pool.query(`
        DROP TRIGGER IF EXISTS billing_subscription_analytics_failure_${triggerSuffix} ON analytics_events;
        DROP FUNCTION IF EXISTS billing_subscription_analytics_failure_${triggerSuffix}();
      `);
    }
    await expect(
      repositories.billing.projectWebhook({
        event: paidEvent,
        payloadHash: hashA,
        expectedLivemode: false,
        expectedPriceId: "price_founder",
      }),
    ).resolves.toMatchObject({ status: "APPLIED", entitlementActive: true });
    const events = await client.db
      .select()
      .from(analyticsEvents)
      .where(eq(analyticsEvents.dedupeKey, dedupeKey));
    expect(events).toHaveLength(1);
  });

  it("expires an old unbound attempt and rolls back an atomic binding failure before replay", async () => {
    const host = `billing-atomic-${randomUUID()}.example`;
    const [project] = await client.db
      .insert(projects)
      .values({
        publicId: `project_billing_atomic_${randomUUID()}`,
        url: `https://${host}`,
        normalizedUrl: `https://${host}/`,
      })
      .returning();
    if (!project) throw new Error("atomic checkout project setup failed");
    atomicProjectId = project.id;
    const abandoned = await repositories.billing.reserveProjectCheckout({
      projectId: project.id,
      initiatedBy: "founder:atomic",
      now: new Date("2026-08-11T13:00:00Z"),
      expiresAt: new Date("2026-08-11T14:00:00Z"),
    });
    await expect(
      repositories.billing.expireUnboundProjectCheckout({
        reservationId: abandoned.reservation.id,
        occurredAt: new Date("2026-08-11T13:59:59Z"),
      }),
    ).rejects.toThrow(/could not be expired/i);
    await repositories.billing.expireUnboundProjectCheckout({
      reservationId: abandoned.reservation.id,
      occurredAt: new Date("2026-08-11T14:00:01Z"),
    });
    const reserved = await repositories.billing.reserveProjectCheckout({
      projectId: project.id,
      initiatedBy: "founder:atomic-retry",
      now: new Date("2026-08-11T14:00:01Z"),
      expiresAt: new Date("2026-08-11T15:00:00Z"),
    });
    expect(reserved).toMatchObject({ created: true });
    const sessionId = `cs_test_atomic_${suffix}`;
    const dedupeKey = billingDedupe("checkout_started", sessionId);
    await client.pool.query(`
      CREATE OR REPLACE FUNCTION billing_analytics_failure_${suffix.replaceAll("-", "_")}()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.dedupe_key = '${dedupeKey}' THEN
          RAISE EXCEPTION 'forced billing analytics failure';
        END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER billing_analytics_failure_${suffix.replaceAll("-", "_")}
      BEFORE INSERT ON analytics_events
      FOR EACH ROW EXECUTE FUNCTION billing_analytics_failure_${suffix.replaceAll("-", "_")}();
    `);
    try {
      await expect(
        repositories.billing.bindProjectCheckout({
          reservationId: reserved.reservation.id,
          stripeCheckoutSessionId: sessionId,
          livemode: false,
          occurredAt: new Date("2026-08-11T14:00:02Z"),
        }),
      ).rejects.toThrow(/analytics_events/);
      const [afterFailure] = await client.db
        .select()
        .from(billingCheckoutSessions)
        .where(eq(billingCheckoutSessions.id, reserved.reservation.id));
      expect(afterFailure?.stripeCheckoutSessionId).toBeNull();
    } finally {
      await client.pool.query(`
        DROP TRIGGER IF EXISTS billing_analytics_failure_${suffix.replaceAll("-", "_")} ON analytics_events;
        DROP FUNCTION IF EXISTS billing_analytics_failure_${suffix.replaceAll("-", "_")}();
      `);
    }
    await expect(
      repositories.billing.bindProjectCheckout({
        reservationId: reserved.reservation.id,
        stripeCheckoutSessionId: sessionId,
        livemode: false,
        occurredAt: new Date("2026-08-11T14:00:03Z"),
      }),
    ).resolves.toMatchObject({ stripeCheckoutSessionId: sessionId });
    const event = await client.db
      .select()
      .from(analyticsEvents)
      .where(eq(analyticsEvents.dedupeKey, dedupeKey));
    expect(event).toHaveLength(1);
    await client.db.delete(projects).where(eq(projects.id, project.id));
    atomicProjectId = "";
  });
});
