import type { PaymentProjectionState, SubscriptionProjectionStatus } from "./index";

export const SUPPORTED_BILLING_EVENT_TYPES = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
] as const;

export type SupportedBillingEventType = (typeof SUPPORTED_BILLING_EVENT_TYPES)[number];

type WebhookBase = {
  eventId: string;
  type: SupportedBillingEventType;
  createdAt: Date;
  livemode: boolean;
};

export type NormalizedBillingWebhook =
  | (WebhookBase & {
      kind: "checkout";
      checkoutSessionId: string;
      projectId: string | null;
      customerId: string | null;
      subscriptionId: string | null;
      grantsEntitlement: false;
    })
  | (WebhookBase & {
      kind: "subscription";
      subscriptionId: string;
      customerId: string;
      projectId: string | null;
      priceId: string | null;
      status: SubscriptionProjectionStatus;
      cancelAtPeriodEnd: boolean;
      currentPeriodStart: Date | null;
      currentPeriodEnd: Date | null;
      rank: number;
    })
  | (WebhookBase & {
      kind: "invoice";
      invoiceId: string;
      subscriptionId: string | null;
      customerId: string | null;
      paymentState: Exclude<PaymentProjectionState, "unknown">;
      rank: number;
    });

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function stringId(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) return value;
  const id = record(value).id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

function timestamp(value: unknown): Date | null {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return null;
  const date = new Date(value * 1_000);
  return Number.isNaN(date.getTime()) ? null : date;
}

function metadataProjectId(object: UnknownRecord): string | null {
  const metadata = record(object.metadata);
  const projectId = metadata.project_id;
  if (typeof projectId === "string" && projectId.length > 0) return projectId;
  const reference = object.client_reference_id;
  return typeof reference === "string" && reference.length > 0 ? reference : null;
}

const subscriptionStatuses = new Set<SubscriptionProjectionStatus>([
  "incomplete",
  "incomplete_expired",
  "trialing",
  "active",
  "past_due",
  "canceled",
  "unpaid",
  "paused",
]);

export function subscriptionStateRank(status: SubscriptionProjectionStatus): number {
  switch (status) {
    case "canceled":
    case "incomplete_expired":
      return 100;
    case "unpaid":
    case "paused":
      return 90;
    case "past_due":
    case "incomplete":
      return 80;
    case "active":
    case "trialing":
      return 20;
  }
}

function subscriptionPeriod(
  object: UnknownRecord,
  field: "current_period_start" | "current_period_end",
) {
  const direct = timestamp(object[field]);
  if (direct) return direct;
  const items = record(object.items).data;
  if (!Array.isArray(items)) return null;
  return timestamp(record(items[0])[field]);
}

function subscriptionPriceId(object: UnknownRecord): string | null {
  const items = record(object.items).data;
  if (!Array.isArray(items)) return null;
  return stringId(record(record(items[0]).price).id);
}

function invoiceSubscriptionId(object: UnknownRecord): string | null {
  const direct = stringId(object.subscription);
  if (direct) return direct;
  return stringId(record(record(object.parent).subscription_details).subscription);
}

export function normalizeStripeEvent(eventValue: unknown): NormalizedBillingWebhook | null {
  const event = record(eventValue);
  const eventId = stringId(event.id);
  const type = event.type;
  const createdAt = timestamp(event.created);
  const object = record(record(event.data).object);
  if (
    !eventId ||
    !createdAt ||
    typeof type !== "string" ||
    !SUPPORTED_BILLING_EVENT_TYPES.includes(type as SupportedBillingEventType)
  ) {
    return null;
  }
  const base = {
    eventId,
    type: type as SupportedBillingEventType,
    createdAt,
    livemode: event.livemode === true,
  };

  if (type === "checkout.session.completed") {
    const checkoutSessionId = stringId(object.id);
    if (!checkoutSessionId) return null;
    return {
      ...base,
      type,
      kind: "checkout",
      checkoutSessionId,
      projectId: metadataProjectId(object),
      customerId: stringId(object.customer),
      subscriptionId: stringId(object.subscription),
      grantsEntitlement: false,
    };
  }

  if (type.startsWith("customer.subscription.")) {
    const subscriptionId = stringId(object.id);
    const customerId = stringId(object.customer);
    const rawStatus = type === "customer.subscription.deleted" ? "canceled" : object.status;
    if (
      !subscriptionId ||
      !customerId ||
      typeof rawStatus !== "string" ||
      !subscriptionStatuses.has(rawStatus as SubscriptionProjectionStatus)
    ) {
      return null;
    }
    const status = rawStatus as SubscriptionProjectionStatus;
    return {
      ...base,
      type: type as Extract<SupportedBillingEventType, `customer.subscription.${string}`>,
      kind: "subscription",
      subscriptionId,
      customerId,
      projectId: metadataProjectId(object),
      priceId: subscriptionPriceId(object),
      status,
      cancelAtPeriodEnd: object.cancel_at_period_end === true,
      currentPeriodStart: subscriptionPeriod(object, "current_period_start"),
      currentPeriodEnd: subscriptionPeriod(object, "current_period_end"),
      rank: subscriptionStateRank(status),
    };
  }

  const invoiceId = stringId(object.id);
  if (!invoiceId) return null;
  const paymentState = type === "invoice.paid" ? "paid" : "failed";
  return {
    ...base,
    type: type as "invoice.paid" | "invoice.payment_failed",
    kind: "invoice",
    invoiceId,
    subscriptionId: invoiceSubscriptionId(object),
    customerId: stringId(object.customer),
    paymentState,
    rank: paymentState === "failed" ? 100 : 20,
  };
}

export class DuplicateWebhookPayloadError extends Error {
  constructor(eventId: string) {
    super(`Stripe event ${eventId} was replayed with a different payload hash`);
    this.name = "DuplicateWebhookPayloadError";
  }
}

export function resolveWebhookReceipt(
  existingPayloadHash: string | null,
  incomingPayloadHash: string,
  eventId: string,
): "NEW" | "DUPLICATE" {
  if (existingPayloadHash === null) return "NEW";
  if (existingPayloadHash === incomingPayloadHash) return "DUPLICATE";
  throw new DuplicateWebhookPayloadError(eventId);
}

export type ProjectionOrder = {
  eventId: string;
  createdAt: Date;
  rank: number;
};

export function shouldApplyProjection(current: ProjectionOrder | null, incoming: ProjectionOrder) {
  if (!current) return true;
  const delta = incoming.createdAt.getTime() - current.createdAt.getTime();
  if (delta !== 0) return delta > 0;
  if (incoming.eventId === current.eventId) return false;
  if (incoming.rank !== current.rank) return incoming.rank > current.rank;
  return incoming.eventId.localeCompare(current.eventId) > 0;
}
