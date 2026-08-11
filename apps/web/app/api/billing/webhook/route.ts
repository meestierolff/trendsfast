import { WebhookPayloadConflictError } from "@trendsfast/database";

import {
  projectStripeWebhook,
  StripeWebhookVerificationError,
} from "../../../../lib/billing-service";
import { readBoundedBodyBytes } from "../../../../lib/bounded-json";

export const runtime = "nodejs";

const WEBHOOK_BODY_LIMIT_BYTES = 1_048_576;
const headers = {
  "cache-control": "no-store, max-age=0",
  pragma: "no-cache",
  "x-content-type-options": "nosniff",
};

function json(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers });
}

export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature")?.trim();
  if (!signature || signature.length > 2_048) {
    return json({ error: "A valid Stripe signature header is required." }, 400);
  }
  const body = await readBoundedBodyBytes(request, WEBHOOK_BODY_LIMIT_BYTES);
  if (!body.ok) {
    return json(
      {
        error:
          body.reason === "payload_too_large"
            ? "The Stripe webhook body is too large."
            : "The Stripe webhook body could not be read.",
      },
      body.reason === "payload_too_large" ? 413 : 400,
    );
  }
  try {
    const result = await projectStripeWebhook({ rawBody: body.value, signature });
    return json({ received: true, disposition: result.status.toLowerCase() });
  } catch (error) {
    if (error instanceof WebhookPayloadConflictError) {
      return json({ error: "A Stripe event ID was replayed with conflicting content." }, 409);
    }
    if (error instanceof StripeWebhookVerificationError) {
      return json({ error: "The Stripe webhook could not be verified." }, 400);
    }
    // A transient projection failure must stay non-2xx so Stripe retries it.
    return json({ error: "The Stripe webhook projection is temporarily unavailable." }, 500);
  }
}
