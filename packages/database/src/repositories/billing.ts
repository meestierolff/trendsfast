import { createHash } from "node:crypto";

import { and, eq, inArray, sql } from "drizzle-orm";

import { createApiKey, redactRecord } from "@trendsfast/core";

import type { TrendsFastDatabase } from "../client";
import {
  analyticsEvents,
  apiKeyManagementEvents,
  apiKeys,
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

const NONTERMINAL_SUBSCRIPTION_STATUSES = [
  "INCOMPLETE",
  "TRIALING",
  "ACTIVE",
  "PAST_DUE",
  "UNPAID",
  "PAUSED",
] as const;

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
      checkoutReservationId: string | null;
      projectId: string | null;
      customerId: string | null;
      subscriptionId: string | null;
      grantsEntitlement: false;
    })
  | (BillingEventBase & {
      kind: "subscription";
      subscriptionId: string;
      checkoutReservationId: string | null;
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
      periodStart: Date | null;
      periodEnd: Date | null;
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

export type BillingCheckoutConflictCode =
  "CHECKOUT_ALREADY_OPEN" | "CHECKOUT_COMPLETED_PENDING" | "SUBSCRIPTION_ALREADY_NONTERMINAL";

export class BillingCheckoutConflictError extends Error {
  constructor(readonly code: BillingCheckoutConflictCode) {
    const messages: Record<BillingCheckoutConflictCode, string> = {
      CHECKOUT_ALREADY_OPEN: "The project already has an open Stripe Checkout session",
      CHECKOUT_COMPLETED_PENDING:
        "The project has a completed Stripe Checkout awaiting subscription projection",
      SUBSCRIPTION_ALREADY_NONTERMINAL: "The project already has a nonterminal Stripe subscription",
    };
    super(messages[code]);
    this.name = "BillingCheckoutConflictError";
  }
}

export type BillingCheckoutClaimView = {
  reservationId: string;
  projectId: string;
  stripeCheckoutSessionId: string | null;
  state: "OPEN" | "COMPLETED" | "EXPIRED";
  claimExpiresAt: Date;
  claimConsumedAt: Date | null;
  issuedApiKeyId: string | null;
  entitlementActive: boolean;
  entitlementPeriodEnd: Date | null;
};

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

function billingAnalyticsDedupeKey(name: "checkout_started" | "subscription_started", id: string) {
  return createHash("sha256").update(`trendsfast:billing:v1\0${name}\0${id}`).digest("hex");
}

async function appendBillingAnalytics(
  tx: TrendsFastDatabase,
  input: {
    name: "checkout_started" | "subscription_started";
    externalId: string;
    livemode: boolean;
    occurredAt: Date;
  },
) {
  await tx
    .insert(analyticsEvents)
    .values({
      name: input.name,
      dedupeKey: billingAnalyticsDedupeKey(input.name, input.externalId),
      properties: { plan: "founder_cloud", mode: input.livemode ? "live" : "test" },
      occurredAt: input.occurredAt,
    })
    .onConflictDoNothing();
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

async function assertNoPaidEnrollment(tx: TrendsFastDatabase, projectId: string) {
  const [nonterminalSubscription] = await tx
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.projectId, projectId),
        inArray(subscriptions.status, [...NONTERMINAL_SUBSCRIPTION_STATUSES]),
      ),
    )
    .limit(1);
  if (nonterminalSubscription) {
    throw new BillingCheckoutConflictError("SUBSCRIPTION_ALREADY_NONTERMINAL");
  }

  const [completedPending] = await tx
    .select({ id: billingCheckoutSessions.id })
    .from(billingCheckoutSessions)
    .where(
      and(
        eq(billingCheckoutSessions.projectId, projectId),
        eq(billingCheckoutSessions.state, "COMPLETED"),
        sql`(
          ${billingCheckoutSessions.stripeSubscriptionId} IS NULL
          OR NOT EXISTS (
            SELECT 1 FROM ${subscriptions}
            WHERE ${subscriptions.stripeSubscriptionId} = ${billingCheckoutSessions.stripeSubscriptionId}
              AND (${subscriptions.status} = 'CANCELED' OR ${subscriptions.status} = 'INCOMPLETE_EXPIRED')
          )
        )`,
      ),
    )
    .limit(1);
  if (completedPending) {
    throw new BillingCheckoutConflictError("CHECKOUT_COMPLETED_PENDING");
  }
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
  subscriptionPeriodStart: Date | null;
  subscriptionPeriodEnd: Date | null;
  paymentPeriodStart: Date | null;
  paymentPeriodEnd: Date | null;
}) {
  const subscriptionStart = input.subscriptionPeriodStart?.getTime();
  const subscriptionEnd = input.subscriptionPeriodEnd?.getTime();
  const paymentStart = input.paymentPeriodStart?.getTime();
  const paymentEnd = input.paymentPeriodEnd?.getTime();
  const currentPeriodPaid =
    subscriptionStart !== undefined &&
    subscriptionEnd !== undefined &&
    paymentStart !== undefined &&
    paymentEnd !== undefined &&
    Number.isFinite(subscriptionStart) &&
    Number.isFinite(subscriptionEnd) &&
    subscriptionStart < subscriptionEnd &&
    subscriptionStart === paymentStart &&
    subscriptionEnd === paymentEnd;
  return (
    input.priceId === input.expectedPriceId &&
    input.status === "ACTIVE" &&
    input.paymentState === "PAID" &&
    currentPeriodPaid
  );
}

async function syncEntitlement(
  tx: TrendsFastDatabase,
  input: {
    subscription: typeof subscriptions.$inferSelect;
    payment: Pick<
      typeof billingPaymentStates.$inferSelect,
      "state" | "periodStart" | "periodEnd"
    > | null;
    sourceEvent: BillingProjectionEvent;
    expectedPriceId: string;
  },
) {
  if (!input.subscription.projectId) return null;
  const active = entitlementActive({
    status: input.subscription.status,
    paymentState: input.payment?.state ?? null,
    priceId: input.subscription.stripePriceId,
    expectedPriceId: input.expectedPriceId,
    subscriptionPeriodStart: input.subscription.currentPeriodStart,
    subscriptionPeriodEnd: input.subscription.currentPeriodEnd,
    paymentPeriodStart: input.payment?.periodStart ?? null,
    paymentPeriodEnd: input.payment?.periodEnd ?? null,
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

  const [checkoutIssuedKey] = await tx
    .select({
      checkoutId: billingCheckoutSessions.id,
      apiKeyId: billingCheckoutSessions.issuedApiKeyId,
      keyStatus: apiKeys.status,
      keyExpiresAt: apiKeys.expiresAt,
    })
    .from(billingCheckoutSessions)
    .innerJoin(apiKeys, eq(apiKeys.id, billingCheckoutSessions.issuedApiKeyId))
    .where(
      and(
        eq(billingCheckoutSessions.projectId, input.subscription.projectId),
        eq(billingCheckoutSessions.stripeSubscriptionId, input.subscription.stripeSubscriptionId),
      ),
    )
    .limit(1)
    .for("update");
  if (checkoutIssuedKey?.apiKeyId) {
    const terminal = ["CANCELED", "INCOMPLETE_EXPIRED"].includes(input.subscription.status);
    if (
      active &&
      checkoutIssuedKey.keyStatus === "ACTIVE" &&
      input.subscription.currentPeriodEnd &&
      (!checkoutIssuedKey.keyExpiresAt ||
        checkoutIssuedKey.keyExpiresAt < input.subscription.currentPeriodEnd)
    ) {
      const [extended] = await tx
        .update(apiKeys)
        .set({ expiresAt: input.subscription.currentPeriodEnd })
        .where(and(eq(apiKeys.id, checkoutIssuedKey.apiKeyId), eq(apiKeys.status, "ACTIVE")))
        .returning();
      if (extended) {
        await tx.insert(apiKeyManagementEvents).values({
          projectId: input.subscription.projectId,
          apiKeyId: extended.id,
          action: "RENEWED",
          actorId: "system:stripe-renewal",
          before: redactRecord({
            expiresAt: checkoutIssuedKey.keyExpiresAt?.toISOString() ?? null,
          }),
          after: redactRecord({ expiresAt: extended.expiresAt?.toISOString() ?? null }),
        });
      }
    } else if (terminal && checkoutIssuedKey.keyStatus === "ACTIVE") {
      const revokedAt = input.sourceEvent.createdAt;
      const [revoked] = await tx
        .update(apiKeys)
        .set({ status: "REVOKED", revokedAt })
        .where(and(eq(apiKeys.id, checkoutIssuedKey.apiKeyId), eq(apiKeys.status, "ACTIVE")))
        .returning();
      if (revoked) {
        await tx.insert(apiKeyManagementEvents).values({
          projectId: input.subscription.projectId,
          apiKeyId: revoked.id,
          action: "REVOKED",
          actorId: "system:stripe-entitlement-ended",
          before: redactRecord({ status: "ACTIVE", revokedAt: null }),
          after: redactRecord({ status: revoked.status, revokedAt: revokedAt.toISOString() }),
        });
      }
    }
  }

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
  const [checkoutBySubscription] = await tx
    .select()
    .from(billingCheckoutSessions)
    .where(
      and(
        inArray(billingCheckoutSessions.state, ["OPEN", "COMPLETED"]),
        eq(billingCheckoutSessions.stripeSubscriptionId, event.subscriptionId),
      ),
    )
    .limit(1)
    .for("update");
  const [checkoutByReservation] = event.checkoutReservationId
    ? await tx
        .select()
        .from(billingCheckoutSessions)
        .where(
          and(
            inArray(billingCheckoutSessions.state, ["OPEN", "COMPLETED"]),
            eq(billingCheckoutSessions.id, event.checkoutReservationId),
          ),
        )
        .limit(1)
        .for("update")
    : [];
  if (
    checkoutBySubscription &&
    checkoutByReservation &&
    checkoutBySubscription.id !== checkoutByReservation.id
  ) {
    throw new Error("Stripe webhook Checkout bindings conflicted");
  }
  const checkout = checkoutBySubscription ?? checkoutByReservation ?? null;
  const authorizedCandidates = new Set(
    [existingSubscription?.projectId, checkout?.projectId].filter((value): value is string =>
      Boolean(value),
    ),
  );
  if (authorizedCandidates.size > 1) throw new Error("Stripe webhook project bindings conflicted");
  const authorizedProjectId = [...authorizedCandidates][0] ?? null;
  const candidates = new Set(
    [authorizedProjectId, event.projectId, customer?.projectId].filter((value): value is string =>
      Boolean(value),
    ),
  );
  if (candidates.size > 1) throw new Error("Stripe webhook project bindings conflicted");
  return {
    projectId: authorizedProjectId,
    existingSubscription: existingSubscription ?? null,
    checkout: checkout ?? null,
  };
}

async function candidateSubscriptionProject(
  tx: TrendsFastDatabase,
  event: Extract<BillingProjectionEvent, { kind: "subscription" }>,
) {
  const [existingSubscription] = await tx
    .select({ projectId: subscriptions.projectId })
    .from(subscriptions)
    .where(eq(subscriptions.stripeSubscriptionId, event.subscriptionId))
    .limit(1);
  const [customer] = await tx
    .select({ projectId: stripeCustomers.projectId })
    .from(stripeCustomers)
    .where(eq(stripeCustomers.stripeCustomerId, event.customerId))
    .limit(1);
  const [checkoutBySubscription] = await tx
    .select({ id: billingCheckoutSessions.id, projectId: billingCheckoutSessions.projectId })
    .from(billingCheckoutSessions)
    .where(
      and(
        inArray(billingCheckoutSessions.state, ["OPEN", "COMPLETED"]),
        eq(billingCheckoutSessions.stripeSubscriptionId, event.subscriptionId),
      ),
    )
    .limit(1);
  const [checkoutByReservation] = event.checkoutReservationId
    ? await tx
        .select({ id: billingCheckoutSessions.id, projectId: billingCheckoutSessions.projectId })
        .from(billingCheckoutSessions)
        .where(
          and(
            inArray(billingCheckoutSessions.state, ["OPEN", "COMPLETED"]),
            eq(billingCheckoutSessions.id, event.checkoutReservationId),
          ),
        )
        .limit(1)
    : [];
  if (
    checkoutBySubscription &&
    checkoutByReservation &&
    checkoutBySubscription.id !== checkoutByReservation.id
  ) {
    throw new Error("Stripe webhook Checkout bindings conflicted");
  }
  const checkout = checkoutBySubscription ?? checkoutByReservation ?? null;
  const authorizedCandidates = new Set(
    [existingSubscription?.projectId, checkout?.projectId].filter((value): value is string =>
      Boolean(value),
    ),
  );
  if (authorizedCandidates.size > 1) throw new Error("Stripe webhook project bindings conflicted");
  const authorizedProjectId = [...authorizedCandidates][0] ?? null;
  const candidates = new Set(
    [authorizedProjectId, event.projectId, customer?.projectId].filter((value): value is string =>
      Boolean(value),
    ),
  );
  if (candidates.size > 1) throw new Error("Stripe webhook project bindings conflicted");
  return authorizedProjectId;
}

export class BillingRepository {
  constructor(
    private readonly db: TrendsFastDatabase,
    private readonly apiKeyPepper?: string,
  ) {}

  async recordCheckout(input: {
    projectId: string;
    stripeCheckoutSessionId: string;
    initiatedBy: string;
  }) {
    return this.db.transaction(async (rawTx) => {
      const tx = rawTx as unknown as TrendsFastDatabase;
      await ensureProject(tx, input.projectId);
      const [existing] = await tx
        .select()
        .from(billingCheckoutSessions)
        .where(eq(billingCheckoutSessions.stripeCheckoutSessionId, input.stripeCheckoutSessionId))
        .limit(1)
        .for("update");
      if (existing) {
        if (existing.projectId !== input.projectId) {
          throw new Error("The Stripe Checkout session is bound to a different project");
        }
        return existing;
      }
      await assertNoPaidEnrollment(tx, input.projectId);
      const [openCheckout] = await tx
        .select({ id: billingCheckoutSessions.id })
        .from(billingCheckoutSessions)
        .where(
          and(
            eq(billingCheckoutSessions.projectId, input.projectId),
            eq(billingCheckoutSessions.state, "OPEN"),
          ),
        )
        .limit(1);
      if (openCheckout) throw new BillingCheckoutConflictError("CHECKOUT_ALREADY_OPEN");
      const [created] = await tx
        .insert(billingCheckoutSessions)
        .values({
          ...input,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1_000),
        })
        .onConflictDoNothing()
        .returning();
      if (created) return created;
      const [conflict] = await tx
        .select()
        .from(billingCheckoutSessions)
        .where(eq(billingCheckoutSessions.stripeCheckoutSessionId, input.stripeCheckoutSessionId))
        .limit(1);
      if (!conflict) throw new BillingCheckoutConflictError("CHECKOUT_ALREADY_OPEN");
      if (conflict.projectId !== input.projectId) {
        throw new Error("The Stripe Checkout session is bound to a different project");
      }
      return conflict;
    });
  }

  async reserveProjectCheckout(input: {
    projectId: string;
    initiatedBy: string;
    now: Date;
    expiresAt: Date;
    checkoutClaimHash?: string;
    checkoutClaimExpiresAt?: Date;
  }) {
    return this.db.transaction(async (rawTx) => {
      const tx = rawTx as unknown as TrendsFastDatabase;
      const nowMs = input.now.getTime();
      const expirationMs = input.expiresAt.getTime();
      const expirationDelta = expirationMs - nowMs;
      if (
        !Number.isFinite(nowMs) ||
        !Number.isFinite(expirationMs) ||
        expirationDelta < 30 * 60 * 1_000 ||
        expirationDelta > 24 * 60 * 60 * 1_000
      ) {
        throw new Error("Stripe Checkout expiration must be 30 minutes to 24 hours in the future");
      }
      const claimConfigured = Boolean(input.checkoutClaimHash || input.checkoutClaimExpiresAt);
      if (
        claimConfigured &&
        (!/^sha256:[a-f0-9]{64}$/.test(input.checkoutClaimHash ?? "") ||
          !input.checkoutClaimExpiresAt ||
          input.checkoutClaimExpiresAt <= input.expiresAt ||
          input.checkoutClaimExpiresAt.getTime() - input.expiresAt.getTime() > 30 * 60 * 1_000 ||
          input.checkoutClaimExpiresAt.getTime() - input.now.getTime() > 24 * 60 * 60 * 1_000)
      ) {
        throw new Error("Stripe Checkout claim must have a bounded post-session grace window");
      }
      await ensureProject(tx, input.projectId);
      await assertNoPaidEnrollment(tx, input.projectId);
      const [existing] = await tx
        .select()
        .from(billingCheckoutSessions)
        .where(
          and(
            eq(billingCheckoutSessions.projectId, input.projectId),
            eq(billingCheckoutSessions.state, "OPEN"),
          ),
        )
        .limit(1)
        .for("update");
      if (existing) {
        if (input.checkoutClaimHash && existing.checkoutClaimHash !== input.checkoutClaimHash) {
          throw new BillingCheckoutConflictError("CHECKOUT_ALREADY_OPEN");
        }
        return { created: false as const, reservation: existing };
      }

      const [customer] = await tx
        .select({ stripeCustomerId: stripeCustomers.stripeCustomerId })
        .from(stripeCustomers)
        .where(eq(stripeCustomers.projectId, input.projectId))
        .limit(1);
      const [reservation] = await tx
        .insert(billingCheckoutSessions)
        .values({
          projectId: input.projectId,
          requestedStripeCustomerId: customer?.stripeCustomerId ?? null,
          initiatedBy: input.initiatedBy,
          expiresAt: input.expiresAt,
          checkoutClaimHash: input.checkoutClaimHash ?? null,
          checkoutClaimExpiresAt: input.checkoutClaimExpiresAt ?? null,
          createdAt: input.now,
          updatedAt: input.now,
        })
        .returning();
      if (!reservation) throw new Error("The Stripe Checkout reservation could not be created");
      return { created: true as const, reservation };
    });
  }

  /**
   * Finds only the open Checkout started by an exact private-delivery record.
   * The caller must reconcile the bound/idempotent Stripe reservation before
   * attempting a claim rotation.
   */
  async checkoutForDeliveryClaimRecovery(input: { projectId: string; initiatedBy: string }) {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        input.projectId,
      ) ||
      !/^delivery:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        input.initiatedBy,
      )
    ) {
      throw new Error("Checkout claim recovery requires an exact private delivery binding");
    }
    const [reservation] = await this.db
      .select()
      .from(billingCheckoutSessions)
      .where(
        and(
          eq(billingCheckoutSessions.projectId, input.projectId),
          eq(billingCheckoutSessions.initiatedBy, input.initiatedBy),
          eq(billingCheckoutSessions.state, "OPEN"),
          sql`${billingCheckoutSessions.checkoutClaimHash} IS NOT NULL`,
          sql`${billingCheckoutSessions.checkoutClaimExpiresAt} IS NOT NULL`,
          sql`${billingCheckoutSessions.checkoutClaimConsumedAt} IS NULL`,
          sql`${billingCheckoutSessions.issuedApiKeyId} IS NULL`,
        ),
      )
      .limit(1);
    return reservation ?? null;
  }

  /**
   * Atomically replaces a lost browser claim only for the same still-open,
   * delivery-bound, Stripe-bound Checkout. A concurrent recovery must retry
   * from authoritative state instead of adopting another request's raw claim.
   */
  async rotateProjectCheckoutClaim(input: {
    reservationId: string;
    projectId: string;
    initiatedBy: string;
    stripeCheckoutSessionId: string;
    expectedCheckoutClaimHash: string;
    checkoutClaimHash: string;
    occurredAt: Date;
  }) {
    const occurredAtMs = input.occurredAt.getTime();
    if (
      !Number.isFinite(occurredAtMs) ||
      !/^delivery:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        input.initiatedBy,
      ) ||
      !/^sha256:[a-f0-9]{64}$/.test(input.expectedCheckoutClaimHash) ||
      !/^sha256:[a-f0-9]{64}$/.test(input.checkoutClaimHash) ||
      input.expectedCheckoutClaimHash === input.checkoutClaimHash ||
      !input.stripeCheckoutSessionId
    ) {
      throw new Error("Checkout claim rotation input is invalid");
    }
    return this.db.transaction(async (rawTx) => {
      const tx = rawTx as unknown as TrendsFastDatabase;
      await ensureProject(tx, input.projectId);
      const [rotated] = await tx
        .update(billingCheckoutSessions)
        .set({ checkoutClaimHash: input.checkoutClaimHash, updatedAt: input.occurredAt })
        .where(
          and(
            eq(billingCheckoutSessions.id, input.reservationId),
            eq(billingCheckoutSessions.projectId, input.projectId),
            eq(billingCheckoutSessions.initiatedBy, input.initiatedBy),
            eq(billingCheckoutSessions.stripeCheckoutSessionId, input.stripeCheckoutSessionId),
            eq(billingCheckoutSessions.checkoutClaimHash, input.expectedCheckoutClaimHash),
            eq(billingCheckoutSessions.state, "OPEN"),
            sql`${billingCheckoutSessions.expiresAt} > ${input.occurredAt}`,
            sql`${billingCheckoutSessions.checkoutClaimExpiresAt} > ${input.occurredAt}`,
            sql`${billingCheckoutSessions.checkoutClaimConsumedAt} IS NULL`,
            sql`${billingCheckoutSessions.issuedApiKeyId} IS NULL`,
          ),
        )
        .returning();
      if (!rotated) throw new BillingCheckoutConflictError("CHECKOUT_ALREADY_OPEN");
      return rotated;
    });
  }

  async bindProjectCheckout(input: {
    reservationId: string;
    stripeCheckoutSessionId: string;
    livemode: boolean;
    occurredAt: Date;
  }) {
    return this.db.transaction(async (rawTx) => {
      const tx = rawTx as unknown as TrendsFastDatabase;
      const [candidate] = await tx
        .select()
        .from(billingCheckoutSessions)
        .where(eq(billingCheckoutSessions.id, input.reservationId))
        .limit(1);
      if (!candidate) throw new Error("The Stripe Checkout reservation was not found");
      await ensureProject(tx, candidate.projectId);
      const [reservation] = await tx
        .select()
        .from(billingCheckoutSessions)
        .where(eq(billingCheckoutSessions.id, input.reservationId))
        .limit(1)
        .for("update");
      if (!reservation || reservation.state !== "OPEN") {
        throw new BillingCheckoutConflictError("CHECKOUT_ALREADY_OPEN");
      }
      if (
        reservation.stripeCheckoutSessionId &&
        reservation.stripeCheckoutSessionId !== input.stripeCheckoutSessionId
      ) {
        throw new Error("The Checkout reservation is already bound to a different Stripe session");
      }
      const [bound] = await tx
        .update(billingCheckoutSessions)
        .set({
          stripeCheckoutSessionId: input.stripeCheckoutSessionId,
          updatedAt: input.occurredAt,
        })
        .where(eq(billingCheckoutSessions.id, reservation.id))
        .returning();
      if (!bound) throw new Error("The Stripe Checkout reservation could not be bound");
      await appendBillingAnalytics(tx, {
        name: "checkout_started",
        externalId: input.stripeCheckoutSessionId,
        livemode: input.livemode,
        occurredAt: input.occurredAt,
      });
      return bound;
    });
  }

  async expireProjectCheckout(input: {
    reservationId: string;
    stripeCheckoutSessionId: string;
    occurredAt: Date;
  }) {
    return this.db.transaction(async (rawTx) => {
      const tx = rawTx as unknown as TrendsFastDatabase;
      const [candidate] = await tx
        .select()
        .from(billingCheckoutSessions)
        .where(eq(billingCheckoutSessions.id, input.reservationId))
        .limit(1);
      if (!candidate) throw new Error("The Stripe Checkout reservation was not found");
      await ensureProject(tx, candidate.projectId);
      const [expired] = await tx
        .update(billingCheckoutSessions)
        .set({ state: "EXPIRED", updatedAt: input.occurredAt })
        .where(
          and(
            eq(billingCheckoutSessions.id, input.reservationId),
            eq(billingCheckoutSessions.state, "OPEN"),
            eq(billingCheckoutSessions.stripeCheckoutSessionId, input.stripeCheckoutSessionId),
          ),
        )
        .returning();
      if (!expired) throw new Error("The expired Stripe Checkout session could not be reconciled");
      return expired;
    });
  }

  /** Caller must first complete an authoritative Stripe reservation search. */
  async expireUnboundProjectCheckout(input: { reservationId: string; occurredAt: Date }) {
    return this.db.transaction(async (rawTx) => {
      const tx = rawTx as unknown as TrendsFastDatabase;
      const [candidate] = await tx
        .select()
        .from(billingCheckoutSessions)
        .where(eq(billingCheckoutSessions.id, input.reservationId))
        .limit(1);
      if (!candidate) throw new Error("The Stripe Checkout reservation was not found");
      await ensureProject(tx, candidate.projectId);
      const [expired] = await tx
        .update(billingCheckoutSessions)
        .set({ state: "EXPIRED", updatedAt: input.occurredAt })
        .where(
          and(
            eq(billingCheckoutSessions.id, input.reservationId),
            eq(billingCheckoutSessions.state, "OPEN"),
            sql`${billingCheckoutSessions.stripeCheckoutSessionId} IS NULL`,
            sql`${billingCheckoutSessions.expiresAt} <= ${input.occurredAt}`,
          ),
        )
        .returning();
      if (!expired) throw new Error("The unbound Checkout reservation could not be expired");
      return expired;
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

  async checkoutClaimStatus(input: {
    claimHash: string;
    stripeCheckoutSessionId: string;
    now?: Date;
  }): Promise<BillingCheckoutClaimView | null> {
    if (!/^sha256:[a-f0-9]{64}$/.test(input.claimHash) || !input.stripeCheckoutSessionId) {
      return null;
    }
    const now = input.now ?? new Date();
    const [claim] = await this.db
      .select({
        reservationId: billingCheckoutSessions.id,
        projectId: billingCheckoutSessions.projectId,
        stripeCheckoutSessionId: billingCheckoutSessions.stripeCheckoutSessionId,
        checkoutStripeSubscriptionId: billingCheckoutSessions.stripeSubscriptionId,
        state: billingCheckoutSessions.state,
        claimExpiresAt: billingCheckoutSessions.checkoutClaimExpiresAt,
        claimConsumedAt: billingCheckoutSessions.checkoutClaimConsumedAt,
        issuedApiKeyId: billingCheckoutSessions.issuedApiKeyId,
        entitlementActive: projectEntitlements.active,
        entitlementPeriodStart: projectEntitlements.periodStart,
        entitlementPeriodEnd: projectEntitlements.periodEnd,
        entitlementStripeSubscriptionId: subscriptions.stripeSubscriptionId,
      })
      .from(billingCheckoutSessions)
      .leftJoin(
        projectEntitlements,
        eq(projectEntitlements.projectId, billingCheckoutSessions.projectId),
      )
      .leftJoin(subscriptions, eq(subscriptions.id, projectEntitlements.subscriptionId))
      .where(
        and(
          eq(billingCheckoutSessions.checkoutClaimHash, input.claimHash),
          eq(billingCheckoutSessions.stripeCheckoutSessionId, input.stripeCheckoutSessionId),
        ),
      )
      .limit(1);
    if (!claim?.claimExpiresAt || claim.claimExpiresAt <= now) return null;
    return {
      reservationId: claim.reservationId,
      projectId: claim.projectId,
      stripeCheckoutSessionId: claim.stripeCheckoutSessionId,
      state: claim.state,
      claimExpiresAt: claim.claimExpiresAt,
      claimConsumedAt: claim.claimConsumedAt,
      issuedApiKeyId: claim.issuedApiKeyId,
      entitlementActive:
        claim.state === "COMPLETED" &&
        Boolean(
          claim.stripeCheckoutSessionId &&
          claim.checkoutStripeSubscriptionId &&
          claim.entitlementStripeSubscriptionId &&
          claim.stripeCheckoutSessionId === input.stripeCheckoutSessionId &&
          claim.entitlementStripeSubscriptionId === claim.checkoutStripeSubscriptionId,
        ) &&
        claim.entitlementActive === true &&
        Boolean(
          claim.entitlementPeriodStart &&
          claim.entitlementPeriodStart <= now &&
          claim.entitlementPeriodEnd &&
          claim.entitlementPeriodEnd > now,
        ),
      entitlementPeriodEnd: claim.entitlementPeriodEnd,
    };
  }

  /**
   * Atomically consumes a verified Checkout claim and issues its one live key.
   * The caller receives raw key material only when this transaction creates it.
   */
  async consumeCheckoutClaim(input: {
    claimHash: string;
    stripeCheckoutSessionId: string;
    environment: "test" | "live";
    now: Date;
    rateLimitPerHour: number;
    providerCostLimitUsd: number;
  }): Promise<
    | { status: "WAITING" }
    | { status: "ALREADY_CONSUMED"; visiblePrefix: string | null }
    | { status: "ISSUED"; rawKey: string; visiblePrefix: string; expiresAt: Date | null }
    | { status: "INVALID" }
  > {
    if (!/^sha256:[a-f0-9]{64}$/.test(input.claimHash) || !input.stripeCheckoutSessionId) {
      return { status: "INVALID" };
    }
    const expectedSessionPrefix = input.environment === "live" ? "cs_live_" : "cs_test_";
    if (!input.stripeCheckoutSessionId.startsWith(expectedSessionPrefix)) {
      return { status: "INVALID" };
    }
    return this.db.transaction(async (rawTx) => {
      const tx = rawTx as unknown as TrendsFastDatabase;
      const [claim] = await tx
        .select()
        .from(billingCheckoutSessions)
        .where(
          and(
            eq(billingCheckoutSessions.checkoutClaimHash, input.claimHash),
            eq(billingCheckoutSessions.stripeCheckoutSessionId, input.stripeCheckoutSessionId),
          ),
        )
        .limit(1)
        .for("update");
      if (!claim || !claim.checkoutClaimExpiresAt || claim.checkoutClaimExpiresAt <= input.now) {
        return { status: "INVALID" as const };
      }
      if (claim.checkoutClaimConsumedAt || claim.issuedApiKeyId) {
        const [issued] = claim.issuedApiKeyId
          ? await tx
              .select({ visiblePrefix: apiKeys.visiblePrefix })
              .from(apiKeys)
              .where(eq(apiKeys.id, claim.issuedApiKeyId))
              .limit(1)
          : [];
        return {
          status: "ALREADY_CONSUMED" as const,
          visiblePrefix: issued?.visiblePrefix ?? null,
        };
      }
      const [entitlement] = await tx
        .select({
          active: projectEntitlements.active,
          periodStart: projectEntitlements.periodStart,
          periodEnd: projectEntitlements.periodEnd,
          stripeSubscriptionId: subscriptions.stripeSubscriptionId,
        })
        .from(projectEntitlements)
        .innerJoin(subscriptions, eq(subscriptions.id, projectEntitlements.subscriptionId))
        .where(eq(projectEntitlements.projectId, claim.projectId))
        .limit(1)
        .for("update");
      if (
        claim.state !== "COMPLETED" ||
        !claim.stripeSubscriptionId ||
        entitlement?.stripeSubscriptionId !== claim.stripeSubscriptionId ||
        !entitlement?.active ||
        !entitlement.periodStart ||
        !entitlement.periodEnd ||
        entitlement.periodStart > input.now ||
        entitlement.periodEnd <= input.now
      ) {
        return { status: "WAITING" as const };
      }
      if (
        !Number.isSafeInteger(input.rateLimitPerHour) ||
        input.rateLimitPerHour < 1 ||
        input.rateLimitPerHour > 10_000 ||
        !Number.isFinite(input.providerCostLimitUsd) ||
        input.providerCostLimitUsd < 0 ||
        input.providerCostLimitUsd > 10_000
      ) {
        throw new Error("Checkout API-key limits are invalid");
      }
      const keyMaterial = await createApiKey(input.environment, this.apiKeyPepper);
      const [issued] = await tx
        .insert(apiKeys)
        .values({
          projectId: claim.projectId,
          name: "TrendsFast Founder",
          visiblePrefix: keyMaterial.prefix,
          secretHash: keyMaterial.secretHash,
          scopes: ["next_move:read", "next_move:write"],
          environment: input.environment,
          rateLimitPerHour: input.rateLimitPerHour,
          providerCostLimitUsd: String(input.providerCostLimitUsd),
          createdAt: input.now,
          expiresAt: entitlement.periodEnd,
        })
        .returning();
      if (!issued) throw new Error("Checkout API-key issuance failed");
      await tx.insert(apiKeyManagementEvents).values({
        projectId: claim.projectId,
        apiKeyId: issued.id,
        action: "ISSUED",
        actorId: `checkout:${claim.id}`,
        after: redactRecord({
          id: issued.id,
          projectId: issued.projectId,
          name: issued.name,
          visiblePrefix: issued.visiblePrefix,
          scopes: issued.scopes,
          environment: issued.environment,
          status: issued.status,
          rateLimitPerHour: issued.rateLimitPerHour,
          providerCostLimitUsd: issued.providerCostLimitUsd,
          expiresAt: issued.expiresAt?.toISOString() ?? null,
        }),
      });
      const [consumed] = await tx
        .update(billingCheckoutSessions)
        .set({
          checkoutClaimConsumedAt: input.now,
          issuedApiKeyId: issued.id,
          updatedAt: input.now,
        })
        .where(
          and(
            eq(billingCheckoutSessions.id, claim.id),
            sql`${billingCheckoutSessions.checkoutClaimConsumedAt} IS NULL`,
            sql`${billingCheckoutSessions.issuedApiKeyId} IS NULL`,
          ),
        )
        .returning({ id: billingCheckoutSessions.id });
      if (!consumed) throw new Error("Checkout claim consumption lost its atomic reservation");
      return {
        status: "ISSUED" as const,
        rawKey: keyMaterial.rawKey,
        visiblePrefix: issued.visiblePrefix,
        expiresAt: issued.expiresAt,
      };
    });
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
        const [candidateStored] = await tx
          .select()
          .from(billingCheckoutSessions)
          .where(
            and(
              inArray(billingCheckoutSessions.state, ["OPEN", "COMPLETED"]),
              input.event.checkoutReservationId
                ? eq(billingCheckoutSessions.id, input.event.checkoutReservationId)
                : eq(
                    billingCheckoutSessions.stripeCheckoutSessionId,
                    input.event.checkoutSessionId,
                  ),
            ),
          )
          .limit(1);
        if (!candidateStored) {
          await finishReceipt(tx, input.event.eventId, "IGNORED", "CHECKOUT_NOT_AUTHORIZED");
          return { status: "IGNORED" as const, reason: "CHECKOUT_NOT_AUTHORIZED" };
        }
        const projectId = candidateStored.projectId;
        if (input.event.projectId && candidateStored.projectId !== input.event.projectId) {
          throw new Error("Stripe Checkout project metadata does not match its durable binding");
        }
        await ensureProject(tx, projectId);
        const [stored] = await tx
          .select()
          .from(billingCheckoutSessions)
          .where(eq(billingCheckoutSessions.id, candidateStored.id))
          .limit(1)
          .for("update");
        if (!stored || stored.projectId !== projectId) {
          throw new Error("Stripe Checkout project binding changed during projection");
        }
        if (
          stored.stripeCheckoutSessionId &&
          stored.stripeCheckoutSessionId !== input.event.checkoutSessionId
        ) {
          throw new Error("Stripe Checkout session does not match its durable reservation");
        }
        if (
          input.event.customerId &&
          ((stored.requestedStripeCustomerId &&
            stored.requestedStripeCustomerId !== input.event.customerId) ||
            (stored.stripeCustomerId && stored.stripeCustomerId !== input.event.customerId))
        ) {
          throw new Error("Stripe customer does not match its durable Checkout reservation");
        }
        await tx
          .update(billingCheckoutSessions)
          .set({
            stripeCheckoutSessionId: input.event.checkoutSessionId,
            state: "COMPLETED",
            stripeCustomerId: input.event.customerId ?? stored.stripeCustomerId,
            stripeSubscriptionId: input.event.subscriptionId ?? stored.stripeSubscriptionId,
            completedAt: input.event.createdAt,
            updatedAt: new Date(),
          })
          .where(eq(billingCheckoutSessions.id, stored.id));
        if (input.event.customerId) {
          await ensureCustomer(tx, { projectId, stripeCustomerId: input.event.customerId });
        }
        await appendBillingAnalytics(tx, {
          name: "checkout_started",
          externalId: input.event.checkoutSessionId,
          livemode: input.event.livemode,
          occurredAt: input.event.createdAt,
        });
        await finishReceipt(tx, input.event.eventId, "PROCESSED");
        return {
          status: "APPLIED" as const,
          entitlementActive: null,
          entitlementActivated: false,
        };
      }

      if (input.event.kind === "subscription") {
        const candidateProjectId = await candidateSubscriptionProject(tx, input.event);
        if (!candidateProjectId) {
          await finishReceipt(tx, input.event.eventId, "IGNORED", "SUBSCRIPTION_NOT_AUTHORIZED");
          return { status: "IGNORED" as const, reason: "SUBSCRIPTION_NOT_AUTHORIZED" };
        }
        await ensureProject(tx, candidateProjectId);
        const resolved = await resolveSubscriptionProject(tx, input.event);
        if (resolved.projectId !== candidateProjectId) {
          throw new Error("Stripe webhook project binding changed during projection");
        }
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
        const [otherNonterminal] = await tx
          .select({ id: subscriptions.id })
          .from(subscriptions)
          .where(
            and(
              eq(subscriptions.projectId, resolved.projectId),
              inArray(subscriptions.status, [...NONTERMINAL_SUBSCRIPTION_STATUSES]),
              existing ? sql`${subscriptions.id} <> ${existing.id}` : undefined,
            ),
          )
          .limit(1)
          .for("update");
        if (otherNonterminal && status !== "CANCELED" && status !== "INCOMPLETE_EXPIRED") {
          await finishReceipt(tx, input.event.eventId, "IGNORED", "DUPLICATE_PROJECT_SUBSCRIPTION");
          return { status: "IGNORED" as const, reason: "DUPLICATE_PROJECT_SUBSCRIPTION" };
        }
        const customer = await ensureCustomer(tx, {
          projectId: resolved.projectId,
          stripeCustomerId: input.event.customerId,
        });
        if (resolved.checkout) {
          if (
            (resolved.checkout.requestedStripeCustomerId &&
              resolved.checkout.requestedStripeCustomerId !== input.event.customerId) ||
            (resolved.checkout.stripeCustomerId &&
              resolved.checkout.stripeCustomerId !== input.event.customerId)
          ) {
            throw new Error("Stripe customer does not match its durable Checkout reservation");
          }
          if (
            resolved.checkout.stripeSubscriptionId &&
            resolved.checkout.stripeSubscriptionId !== input.event.subscriptionId
          ) {
            throw new Error("Stripe subscription does not match its durable Checkout reservation");
          }
          await tx
            .update(billingCheckoutSessions)
            .set({
              stripeCustomerId: input.event.customerId,
              stripeSubscriptionId: input.event.subscriptionId,
              updatedAt: new Date(),
            })
            .where(eq(billingCheckoutSessions.id, resolved.checkout.id));
        }
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
          payment: payment ?? null,
          sourceEvent: input.event,
          expectedPriceId: input.expectedPriceId,
        });
        if (entitlement?.activated) {
          await appendBillingAnalytics(tx, {
            name: "subscription_started",
            externalId: subscription.stripeSubscriptionId,
            livemode: input.event.livemode,
            occurredAt: input.event.createdAt,
          });
        }
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
          periodStart: input.event.periodStart,
          periodEnd: input.event.periodEnd,
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
            periodStart: input.event.periodStart,
            periodEnd: input.event.periodEnd,
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
            payment: {
              state: paymentState,
              periodStart: input.event.periodStart,
              periodEnd: input.event.periodEnd,
            },
            sourceEvent: input.event,
            expectedPriceId: input.expectedPriceId,
          })
        : null;
      if (entitlement?.activated && subscription) {
        await appendBillingAnalytics(tx, {
          name: "subscription_started",
          externalId: subscription.stripeSubscriptionId,
          livemode: input.event.livemode,
          occurredAt: input.event.createdAt,
        });
      }
      await finishReceipt(tx, input.event.eventId, "PROCESSED");
      return {
        status: "APPLIED" as const,
        entitlementActive: entitlement?.active ?? null,
        entitlementActivated: entitlement?.activated ?? false,
      };
    });
  }
}
