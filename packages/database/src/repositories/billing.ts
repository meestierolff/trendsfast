import { and, eq, or } from "drizzle-orm";

import type { TrendsFastDatabase } from "../client";
import {
  billingCheckoutSessions,
  billingPaymentStates,
  billingWebhookEvents,
  monitoringRuns,
  monitoringSubscriptions,
  projectEntitlements,
  projects,
  stripeCustomers,
  subscriptions,
} from "../schema";

export type BillingSubscriptionStatus =
  | "incomplete"
  | "incomplete_expired"
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "unpaid"
  | "paused";

type BillingEventBase = {
  eventId: string;
  type: string;
  createdAt: Date;
  livemode: boolean;
};

export type BillingProjectionEvent =
  | (BillingEventBase & {
      kind: "checkout";
      checkoutSessionId: string;
      projectId: string | null;
      customerId: string | null;
      subscriptionId: string | null;
      grantsEntitlement: false;
    })
  | (BillingEventBase & {
      kind: "subscription";
      subscriptionId: string;
      customerId: string;
      projectId: string | null;
      priceId: string | null;
      status: BillingSubscriptionStatus;
      cancelAtPeriodEnd: boolean;
      currentPeriodStart: Date | null;
      currentPeriodEnd: Date | null;
      rank: number;
    })
  | (BillingEventBase & {
      kind: "invoice";
      invoiceId: string;
      subscriptionId: string | null;
      customerId: string | null;
      paymentState: "paid" | "failed";
      rank: number;
    });

export type BillingProjectionResult =
  | { status: "DUPLICATE" }
  | { status: "IGNORED"; reason: string }
  | { status: "STALE" }
  | {
      status: "APPLIED";
      entitlementActive: boolean | null;
      entitlementActivated: boolean;
    };

export class WebhookPayloadConflictError extends Error {
  constructor(eventId: string) {
    super(`Stripe event ${eventId} was replayed with a different payload hash`);
    this.name = "WebhookPayloadConflictError";
  }
}

function subscriptionStatus(value: BillingSubscriptionStatus) {
  return value.toUpperCase() as
    | "INCOMPLETE"
    | "INCOMPLETE_EXPIRED"
    | "TRIALING"
    | "ACTIVE"
    | "PAST_DUE"
    | "CANCELED"
    | "UNPAID"
    | "PAUSED";
}

function shouldApply(
  current: { eventId: string | null; createdAt: Date | null; rank: number },
  incoming: { eventId: string; createdAt: Date; rank: number },
) {
  if (!current.createdAt) return true;
  const delta = incoming.createdAt.getTime() - current.createdAt.getTime();
  if (delta !== 0) return delta > 0;
  if (incoming.eventId === current.eventId) return false;
  if (incoming.rank !== current.rank) return incoming.rank > current.rank;
  return incoming.eventId.localeCompare(current.eventId ?? "") > 0;
}

async function lockWebhookReceipt(
  tx: TrendsFastDatabase,
  input: { event: BillingProjectionEvent; payloadHash: string },
): Promise<"NEW" | "DUPLICATE"> {
  const [inserted] = await tx
    .insert(billingWebhookEvents)
    .values({
      stripeEventId: input.event.eventId,
      eventType: input.event.type,
      payloadHash: input.payloadHash,
      stripeCreatedAt: input.event.createdAt,
      livemode: input.event.livemode,
      state: "RECEIVED",
    })
    .onConflictDoNothing()
    .returning();
  if (inserted) return "NEW";
  const [existing] = await tx
    .select()
    .from(billingWebhookEvents)
    .where(eq(billingWebhookEvents.stripeEventId, input.event.eventId))
    .limit(1)
    .for("update");
  if (!existing) throw new Error("The Stripe webhook receipt could not be resolved");
  if (existing.payloadHash !== input.payloadHash) {
    throw new WebhookPayloadConflictError(input.event.eventId);
  }
  return "DUPLICATE";
}

async function finishReceipt(
  tx: TrendsFastDatabase,
  eventId: string,
  state: "PROCESSED" | "IGNORED",
  failureCode: string | null = null,
) {
  await tx
    .update(billingWebhookEvents)
    .set({ state, failureCode, processedAt: new Date() })
    .where(eq(billingWebhookEvents.stripeEventId, eventId));
}

async function ensureProject(tx: TrendsFastDatabase, projectId: string) {
  const [project] = await tx
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1)
    .for("update");
  if (!project || project.status !== "ACTIVE") {
    throw new Error("Stripe billing requires an existing active project");
  }
  return project;
}

async function ensureCustomer(
  tx: TrendsFastDatabase,
  input: { projectId: string; stripeCustomerId: string },
) {
  const [byExternal] = await tx
    .select()
    .from(stripeCustomers)
    .where(eq(stripeCustomers.stripeCustomerId, input.stripeCustomerId))
    .limit(1)
    .for("update");
  const [byProject] = await tx
    .select()
    .from(stripeCustomers)
    .where(eq(stripeCustomers.projectId, input.projectId))
    .limit(1)
    .for("update");
  if (byExternal?.projectId && byExternal.projectId !== input.projectId) {
    throw new Error("A Stripe customer cannot own multiple Founder projects");
  }
  if (byProject && byProject.stripeCustomerId !== input.stripeCustomerId) {
    throw new Error("A Founder project is already bound to a different Stripe customer");
  }
  if (byExternal) {
    if (!byExternal.projectId) {
      const [updated] = await tx
        .update(stripeCustomers)
        .set({ projectId: input.projectId, updatedAt: new Date() })
        .where(eq(stripeCustomers.id, byExternal.id))
        .returning();
      if (!updated) throw new Error("The Stripe customer project binding could not be updated");
      return updated;
    }
    return byExternal;
  }
  const [created] = await tx
    .insert(stripeCustomers)
    .values({ projectId: input.projectId, stripeCustomerId: input.stripeCustomerId })
    .returning();
  if (!created) throw new Error("The Stripe customer binding could not be created");
  return created;
}

function entitlementActive(input: {
  status: string;
  paymentState: string | null;
  priceId: string;
  expectedPriceId: string;
}) {
  return (
    input.priceId === input.expectedPriceId &&
    input.status === "ACTIVE" &&
    input.paymentState === "PAID"
  );
}

async function syncEntitlement(
  tx: TrendsFastDatabase,
  input: {
    subscription: typeof subscriptions.$inferSelect;
    paymentState: "UNKNOWN" | "PAID" | "FAILED" | null;
    sourceEvent: BillingProjectionEvent;
    expectedPriceId: string;
  },
) {
  if (!input.subscription.projectId) return null;
  const active = entitlementActive({
    status: input.subscription.status,
    paymentState: input.paymentState,
    priceId: input.subscription.stripePriceId,
    expectedPriceId: input.expectedPriceId,
  });
  const now = new Date();
  const [previousEntitlement] = await tx
    .select({ active: projectEntitlements.active })
    .from(projectEntitlements)
    .where(eq(projectEntitlements.projectId, input.subscription.projectId))
    .limit(1)
    .for("update");
  const [entitlement] = await tx
    .insert(projectEntitlements)
    .values({
      projectId: input.subscription.projectId,
      subscriptionId: input.subscription.id,
      active,
      periodStart: input.subscription.currentPeriodStart,
      periodEnd: input.subscription.currentPeriodEnd,
      sourceStripeEventId: input.sourceEvent.eventId,
      sourceStripeEventCreatedAt: input.sourceEvent.createdAt,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: projectEntitlements.projectId,
      set: {
        subscriptionId: input.subscription.id,
        active,
        periodStart: input.subscription.currentPeriodStart,
        periodEnd: input.subscription.currentPeriodEnd,
        sourceStripeEventId: input.sourceEvent.eventId,
        sourceStripeEventCreatedAt: input.sourceEvent.createdAt,
        updatedAt: now,
      },
    })
    .returning();
  if (!entitlement) throw new Error("The webhook entitlement projection could not be stored");

  const [monitoring] = await tx
    .select()
    .from(monitoringSubscriptions)
    .where(eq(monitoringSubscriptions.projectId, entitlement.projectId))
    .limit(1)
    .for("update");
  const terminal = ["CANCELED", "INCOMPLETE_EXPIRED"].includes(input.subscription.status);
  const monitoringState = active ? "ACTIVE" : terminal ? "CANCELED" : "PAUSED";
  if (monitoring) {
    await tx
      .update(monitoringSubscriptions)
      .set({
        subscriptionId: input.subscription.id,
        state: monitoringState,
        ...(active && monitoring.nextDueAt < now ? { nextDueAt: now } : {}),
        updatedAt: now,
      })
      .where(eq(monitoringSubscriptions.id, monitoring.id));
    if (!active) {
      await tx
        .update(monitoringRuns)
        .set({
          state: "FAILED",
          leaseOwner: null,
          leaseExpiresAt: null,
          completedAt: now,
          failureCode: "ENTITLEMENT_INACTIVE",
          updatedAt: now,
        })
        .where(
          and(
            eq(monitoringRuns.monitoringSubscriptionId, monitoring.id),
            eq(monitoringRuns.state, "PROCESSING"),
          ),
        );
    }
  } else {
    await tx.insert(monitoringSubscriptions).values({
      projectId: entitlement.projectId,
      subscriptionId: input.subscription.id,
      state: monitoringState,
      nextDueAt: now,
    });
  }
  return { active, activated: active && previousEntitlement?.active !== true };
}

async function resolveSubscriptionProject(
  tx: TrendsFastDatabase,
  event: Extract<BillingProjectionEvent, { kind: "subscription" }>,
) {
  const [existingSubscription] = await tx
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.stripeSubscriptionId, event.subscriptionId))
    .limit(1)
    .for("update");
  const [customer] = await tx
    .select()
    .from(stripeCustomers)
    .where(eq(stripeCustomers.stripeCustomerId, event.customerId))
    .limit(1)
    .for("update");
  const [checkout] = await tx
    .select()
    .from(billingCheckoutSessions)
    .where(
      or(
        eq(billingCheckoutSessions.stripeSubscriptionId, event.subscriptionId),
        eq(billingCheckoutSessions.stripeCustomerId, event.customerId),
      ),
    )
    .limit(1)
    .for("update");
  const candidates = new Set(
    [
      event.projectId,
      existingSubscription?.projectId,
      customer?.projectId,
      checkout?.projectId,
    ].filter((value): value is string => Boolean(value)),
  );
  if (candidates.size > 1) throw new Error("Stripe webhook project bindings conflicted");
  return {
    projectId: [...candidates][0] ?? null,
    existingSubscription: existingSubscription ?? null,
  };
}

export class BillingRepository {
  constructor(private readonly db: TrendsFastDatabase) {}

  async recordCheckout(input: {
    projectId: string;
    stripeCheckoutSessionId: string;
    initiatedBy: string;
  }) {
    return this.db.transaction(async (tx) => {
      await ensureProject(tx as unknown as TrendsFastDatabase, input.projectId);
      const [created] = await tx
        .insert(billingCheckoutSessions)
        .values(input)
        .onConflictDoNothing()
        .returning();
      if (created) return created;
      const [existing] = await tx
        .select()
        .from(billingCheckoutSessions)
        .where(eq(billingCheckoutSessions.stripeCheckoutSessionId, input.stripeCheckoutSessionId))
        .limit(1);
      if (!existing || existing.projectId !== input.projectId) {
        throw new Error("The Stripe Checkout session is bound to a different project");
      }
      return existing;
    });
  }

  async customerForProject(projectId: string) {
    const [customer] = await this.db
      .select()
      .from(stripeCustomers)
      .where(eq(stripeCustomers.projectId, projectId))
      .limit(1);
    return customer ?? null;
  }

  async entitlementForProject(projectId: string) {
    const [entitlement] = await this.db
      .select()
      .from(projectEntitlements)
      .where(eq(projectEntitlements.projectId, projectId))
      .limit(1);
    return entitlement ?? null;
  }

  async projectWebhook(input: {
    event: BillingProjectionEvent;
    payloadHash: string;
    expectedLivemode: boolean;
    expectedPriceId: string;
  }): Promise<BillingProjectionResult> {
    if (input.event.livemode !== input.expectedLivemode) {
      throw new Error("Stripe webhook mode does not match the configured billing mode");
    }
    return this.db.transaction(async (rawTx) => {
      const tx = rawTx as unknown as TrendsFastDatabase;
      if ((await lockWebhookReceipt(tx, input)) === "DUPLICATE") {
        return { status: "DUPLICATE" as const };
      }

      if (input.event.kind === "checkout") {
        const [stored] = await tx
          .select()
          .from(billingCheckoutSessions)
          .where(eq(billingCheckoutSessions.stripeCheckoutSessionId, input.event.checkoutSessionId))
          .limit(1)
          .for("update");
        const projectId = stored?.projectId ?? input.event.projectId;
        if (!projectId) {
          await finishReceipt(tx, input.event.eventId, "IGNORED", "CHECKOUT_PROJECT_UNRESOLVED");
          return { status: "IGNORED" as const, reason: "CHECKOUT_PROJECT_UNRESOLVED" };
        }
        if (stored && input.event.projectId && stored.projectId !== input.event.projectId) {
          throw new Error("Stripe Checkout project metadata does not match its durable binding");
        }
        await ensureProject(tx, projectId);
        const checkout =
          stored ??
          (
            await tx
              .insert(billingCheckoutSessions)
              .values({
                projectId,
                stripeCheckoutSessionId: input.event.checkoutSessionId,
                initiatedBy: "stripe:webhook",
              })
              .returning()
          )[0];
        if (!checkout) throw new Error("The Stripe Checkout binding could not be repaired");
        await tx
          .update(billingCheckoutSessions)
          .set({
            state: "COMPLETED",
            stripeCustomerId: input.event.customerId,
            stripeSubscriptionId: input.event.subscriptionId,
            completedAt: input.event.createdAt,
            updatedAt: new Date(),
          })
          .where(eq(billingCheckoutSessions.id, checkout.id));
        if (input.event.customerId) {
          await ensureCustomer(tx, { projectId, stripeCustomerId: input.event.customerId });
        }
        await finishReceipt(tx, input.event.eventId, "PROCESSED");
        return {
          status: "APPLIED" as const,
          entitlementActive: null,
          entitlementActivated: false,
        };
      }

      if (input.event.kind === "subscription") {
        const resolved = await resolveSubscriptionProject(tx, input.event);
        if (!resolved.projectId) {
          await finishReceipt(
            tx,
            input.event.eventId,
            "IGNORED",
            "SUBSCRIPTION_PROJECT_UNRESOLVED",
          );
          return { status: "IGNORED" as const, reason: "SUBSCRIPTION_PROJECT_UNRESOLVED" };
        }
        await ensureProject(tx, resolved.projectId);
        const customer = await ensureCustomer(tx, {
          projectId: resolved.projectId,
          stripeCustomerId: input.event.customerId,
        });
        const existing = resolved.existingSubscription;
        if (
          existing &&
          !shouldApply(
            {
              eventId: existing.lastStripeEventId,
              createdAt: existing.lastSubscriptionEventCreatedAt,
              rank: existing.lastSubscriptionEventRank,
            },
            {
              eventId: input.event.eventId,
              createdAt: input.event.createdAt,
              rank: input.event.rank,
            },
          )
        ) {
          await finishReceipt(tx, input.event.eventId, "IGNORED", "STALE_EVENT");
          return { status: "STALE" as const };
        }
        const priceId = input.event.priceId ?? existing?.stripePriceId;
        if (!priceId) {
          await finishReceipt(tx, input.event.eventId, "IGNORED", "SUBSCRIPTION_PRICE_UNRESOLVED");
          return { status: "IGNORED" as const, reason: "SUBSCRIPTION_PRICE_UNRESOLVED" };
        }
        const status = subscriptionStatus(input.event.status);
        const now = new Date();
        const [subscription] = existing
          ? await tx
              .update(subscriptions)
              .set({
                projectId: resolved.projectId,
                stripeCustomerId: customer.id,
                stripePriceId: priceId,
                status,
                cancelAtPeriodEnd: input.event.cancelAtPeriodEnd,
                currentPeriodStart: input.event.currentPeriodStart,
                currentPeriodEnd: input.event.currentPeriodEnd,
                canceledAt: status === "CANCELED" ? input.event.createdAt : null,
                lastStripeEventId: input.event.eventId,
                lastSubscriptionEventCreatedAt: input.event.createdAt,
                lastSubscriptionEventRank: input.event.rank,
                updatedAt: now,
              })
              .where(eq(subscriptions.id, existing.id))
              .returning()
          : await tx
              .insert(subscriptions)
              .values({
                projectId: resolved.projectId,
                stripeCustomerId: customer.id,
                stripeSubscriptionId: input.event.subscriptionId,
                stripePriceId: priceId,
                status,
                cancelAtPeriodEnd: input.event.cancelAtPeriodEnd,
                currentPeriodStart: input.event.currentPeriodStart,
                currentPeriodEnd: input.event.currentPeriodEnd,
                canceledAt: status === "CANCELED" ? input.event.createdAt : null,
                lastStripeEventId: input.event.eventId,
                lastSubscriptionEventCreatedAt: input.event.createdAt,
                lastSubscriptionEventRank: input.event.rank,
              })
              .returning();
        if (!subscription)
          throw new Error("The Stripe subscription projection could not be stored");
        const [payment] = await tx
          .select()
          .from(billingPaymentStates)
          .where(eq(billingPaymentStates.stripeSubscriptionId, subscription.stripeSubscriptionId))
          .limit(1);
        const entitlement = await syncEntitlement(tx, {
          subscription,
          paymentState: payment?.state ?? null,
          sourceEvent: input.event,
          expectedPriceId: input.expectedPriceId,
        });
        await finishReceipt(tx, input.event.eventId, "PROCESSED");
        return {
          status: "APPLIED" as const,
          entitlementActive: entitlement?.active ?? null,
          entitlementActivated: entitlement?.activated ?? false,
        };
      }

      if (!input.event.subscriptionId) {
        await finishReceipt(tx, input.event.eventId, "IGNORED", "INVOICE_SUBSCRIPTION_UNRESOLVED");
        return { status: "IGNORED" as const, reason: "INVOICE_SUBSCRIPTION_UNRESOLVED" };
      }
      const [existingPayment] = await tx
        .select()
        .from(billingPaymentStates)
        .where(eq(billingPaymentStates.stripeSubscriptionId, input.event.subscriptionId))
        .limit(1)
        .for("update");
      if (
        existingPayment &&
        !shouldApply(
          {
            eventId: existingPayment.lastStripeEventId,
            createdAt: existingPayment.lastStripeEventCreatedAt,
            rank: existingPayment.lastStripeEventRank,
          },
          {
            eventId: input.event.eventId,
            createdAt: input.event.createdAt,
            rank: input.event.rank,
          },
        )
      ) {
        await finishReceipt(tx, input.event.eventId, "IGNORED", "STALE_EVENT");
        return { status: "STALE" as const };
      }
      const paymentState = input.event.paymentState === "paid" ? "PAID" : "FAILED";
      await tx
        .insert(billingPaymentStates)
        .values({
          stripeSubscriptionId: input.event.subscriptionId,
          stripeCustomerId: input.event.customerId,
          state: paymentState,
          lastInvoiceId: input.event.invoiceId,
          lastStripeEventId: input.event.eventId,
          lastStripeEventCreatedAt: input.event.createdAt,
          lastStripeEventRank: input.event.rank,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: billingPaymentStates.stripeSubscriptionId,
          set: {
            stripeCustomerId: input.event.customerId,
            state: paymentState,
            lastInvoiceId: input.event.invoiceId,
            lastStripeEventId: input.event.eventId,
            lastStripeEventCreatedAt: input.event.createdAt,
            lastStripeEventRank: input.event.rank,
            updatedAt: new Date(),
          },
        });
      const [subscription] = await tx
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.stripeSubscriptionId, input.event.subscriptionId))
        .limit(1)
        .for("update");
      const entitlement = subscription
        ? await syncEntitlement(tx, {
            subscription,
            paymentState,
            sourceEvent: input.event,
            expectedPriceId: input.expectedPriceId,
          })
        : null;
      await finishReceipt(tx, input.event.eventId, "PROCESSED");
      return {
        status: "APPLIED" as const,
        entitlementActive: entitlement?.active ?? null,
        entitlementActivated: entitlement?.activated ?? false,
      };
    });
  }
}
