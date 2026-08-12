import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({ projectStripeWebhook: vi.fn() }));
vi.mock("../../lib/billing-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/billing-service")>();
  return { ...actual, projectStripeWebhook: mocks.projectStripeWebhook };
});

import { WebhookPayloadConflictError } from "@trendsfast/database";
import { StripeWebhookVerificationError } from "../../lib/billing-service";
import { POST } from "../../app/api/billing/webhook/route";

function request(body: BodyInit = "{}", signature = "t=1,v1=signature") {
  return new Request("https://trendsfast.example/api/billing/webhook", {
    method: "POST",
    headers: { "stripe-signature": signature },
    body,
  });
}

describe("Stripe webhook route", () => {
  beforeEach(() => vi.clearAllMocks());

  it("passes the exact raw bytes to the signature/projection service", async () => {
    mocks.projectStripeWebhook.mockResolvedValueOnce({ status: "APPLIED" });
    const raw = '{"id":"evt_raw","spacing": true}\n';
    const response = await POST(request(raw));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, disposition: "applied" });
    expect(mocks.projectStripeWebhook).toHaveBeenCalledWith({
      rawBody: new TextEncoder().encode(raw),
      signature: "t=1,v1=signature",
    });
  });

  it("rejects missing signatures and actual oversized chunked bodies before projection", async () => {
    expect(await POST(request("{}", ""))).toMatchObject({ status: 400 });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(1_048_577));
        controller.close();
      },
    });
    const oversized = new Request("https://trendsfast.example/api/billing/webhook", {
      method: "POST",
      headers: { "stripe-signature": "t=1,v1=signature", "content-length": "1" },
      body: stream,
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    expect(await POST(oversized)).toMatchObject({ status: 413 });
    expect(mocks.projectStripeWebhook).not.toHaveBeenCalled();
  });

  it("fails visibly on event-ID payload conflicts", async () => {
    mocks.projectStripeWebhook.mockRejectedValueOnce(new WebhookPayloadConflictError("evt_1"));
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "A Stripe event ID was replayed with conflicting content.",
    });
  });

  it("separates signature failures from retryable projection failures", async () => {
    mocks.projectStripeWebhook.mockRejectedValueOnce(new StripeWebhookVerificationError());
    expect(await POST(request())).toMatchObject({ status: 400 });
    mocks.projectStripeWebhook.mockRejectedValueOnce(new Error("database unavailable"));
    expect(await POST(request())).toMatchObject({ status: 500 });
  });
});
