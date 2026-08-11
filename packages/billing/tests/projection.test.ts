import { describe, expect, it } from "vitest";
import {
  DuplicateWebhookPayloadError,
  normalizeStripeEvent,
  resolveWebhookReceipt,
  shouldApplyProjection,
} from "../src/projection";

const projectId = "2a7f6ec1-11dd-4b80-b22b-6d1489a20cb9";

function event(type: string, object: Record<string, unknown>, created = 1_786_490_000) {
  return {
    id: `evt_${type.replaceAll(".", "_")}_${created}`,
    type,
    created,
    livemode: false,
    data: { object },
  };
}

describe("Stripe webhook normalization", () => {
  it.each([
    "checkout.session.completed",
    "customer.subscription.created",
    "customer.subscription.updated",
    "customer.subscription.deleted",
    "invoice.paid",
    "invoice.payment_failed",
  ])("supports %s", (type) => {
    const object = type.startsWith("checkout")
      ? { id: "cs_test", metadata: { project_id: projectId } }
      : type.startsWith("customer.subscription")
        ? {
            id: "sub_123",
            customer: "cus_123",
            status: type.endsWith("deleted") ? "canceled" : "active",
            metadata: { project_id: projectId },
            items: { data: [{ price: { id: "price_founder" } }] },
          }
        : {
            id: "in_123",
            customer: "cus_123",
            parent: { subscription_details: { subscription: "sub_123" } },
          };
    expect(normalizeStripeEvent(event(type, object))).toMatchObject({ type });
  });

  it("accepts checkout completion without customer or subscription and never calls it entitlement", () => {
    expect(
      normalizeStripeEvent(
        event("checkout.session.completed", {
          id: "cs_test",
          client_reference_id: projectId,
          customer: null,
          subscription: null,
        }),
      ),
    ).toMatchObject({
      kind: "checkout",
      projectId,
      customerId: null,
      subscriptionId: null,
      grantsEntitlement: false,
    });
  });

  it("ignores unsupported events without treating them as errors", () => {
    expect(normalizeStripeEvent(event("customer.created", { id: "cus_123" }))).toBeNull();
  });
});

describe("webhook replay and ordering", () => {
  it("treats the same event and payload as an idempotent duplicate", () => {
    expect(resolveWebhookReceipt("sha256:a", "sha256:a", "evt_same")).toBe("DUPLICATE");
  });

  it("fails visibly when a duplicate event ID carries a different payload", () => {
    expect(() => resolveWebhookReceipt("sha256:a", "sha256:b", "evt_same")).toThrow(
      DuplicateWebhookPayloadError,
    );
  });

  it("never lets an older subscription event downgrade a newer projection", () => {
    expect(
      shouldApplyProjection(
        { eventId: "evt_new", createdAt: new Date("2026-08-11T12:00:10Z"), rank: 20 },
        { eventId: "evt_old", createdAt: new Date("2026-08-11T12:00:09Z"), rank: 100 },
      ),
    ).toBe(false);
  });

  it("fails closed on equal-second conflicts", () => {
    const at = new Date("2026-08-11T12:00:10Z");
    expect(
      shouldApplyProjection(
        { eventId: "evt_active", createdAt: at, rank: 20 },
        { eventId: "evt_canceled", createdAt: at, rank: 100 },
      ),
    ).toBe(true);
    expect(
      shouldApplyProjection(
        { eventId: "evt_canceled", createdAt: at, rank: 100 },
        { eventId: "evt_active", createdAt: at, rank: 20 },
      ),
    ).toBe(false);
  });
});
