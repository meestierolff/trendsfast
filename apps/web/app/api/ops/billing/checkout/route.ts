import { checkoutSessionExpiresAt } from "@trendsfast/billing";
import { loadEnv } from "@trendsfast/config";
import { BillingCheckoutConflictError } from "@trendsfast/database";

import { configuredStripeBilling } from "../../../../../lib/billing-service";
import { readBoundedJsonBody } from "../../../../../lib/bounded-json";
import { getRepositories } from "../../../../../lib/server-database";
import { authorizeOpsActionRequest } from "../../_security";
import { ProjectBillingBodySchema } from "../_validation";

export const runtime = "nodejs";

const headers = {
  "cache-control": "no-store, max-age=0",
  pragma: "no-cache",
  "x-content-type-options": "nosniff",
};
function json(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers });
}

export async function POST(request: Request) {
  const authorization = authorizeOpsActionRequest(request);
  if (!authorization.ok) return json({ error: authorization.error }, authorization.status);
  if (!(request.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) {
    return json({ error: "Checkout requires a JSON request body." }, 415);
  }
  const bounded = await readBoundedJsonBody(request, 8 * 1_024);
  if (!bounded.ok) {
    return json(
      {
        error:
          bounded.reason === "payload_too_large"
            ? "The checkout request body is too large."
            : "The checkout request body is not valid JSON.",
      },
      bounded.reason === "payload_too_large" ? 413 : 400,
    );
  }
  const body = ProjectBillingBodySchema.safeParse(bounded.value);
  if (!body.success) return json({ error: "An active project ID is required." }, 400);

  const env = loadEnv();
  const stripeBilling = configuredStripeBilling(env);
  if (!stripeBilling.availability.checkoutAvailable) {
    return json({ error: "Founder checkout is not enabled for this environment." }, 503);
  }
  const repositories = getRepositories();
  const project = await repositories.scanData.getProject(body.data.projectId);
  if (!project || project.status !== "ACTIVE") {
    return json({ error: "An active project is required." }, 404);
  }
  try {
    let checkoutUrl: string | null = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const requestedAt = new Date();
      const expiresAt = checkoutSessionExpiresAt(requestedAt);
      const { reservation } = await repositories.billing.reserveProjectCheckout({
        projectId: project.id,
        initiatedBy: authorization.reviewerId,
        now: requestedAt,
        expiresAt,
      });
      if (!reservation.expiresAt) throw new Error("Checkout reservation expiration is missing");

      let stripeCheckoutSessionId = reservation.stripeCheckoutSessionId;
      if (!stripeCheckoutSessionId && reservation.expiresAt <= requestedAt) {
        const reconciled = await stripeBilling.findCheckoutForReservation({
          reservationId: reservation.id,
          createdAt: reservation.createdAt,
        });
        if (!reconciled) {
          await repositories.billing.expireUnboundProjectCheckout({
            reservationId: reservation.id,
            occurredAt: requestedAt,
          });
          continue;
        }
        stripeCheckoutSessionId = reconciled.id;
        await repositories.billing.bindProjectCheckout({
          reservationId: reservation.id,
          stripeCheckoutSessionId,
          livemode: env.STRIPE_MODE === "live",
          occurredAt: new Date(),
        });
      }
      if (!stripeCheckoutSessionId) {
        const created = await stripeBilling.createCheckout({
          projectId: project.id,
          actorId: authorization.reviewerId,
          reservationId: reservation.id,
          expiresAt: reservation.expiresAt,
          ...(reservation.requestedStripeCustomerId
            ? { customerId: reservation.requestedStripeCustomerId }
            : {}),
        });
        if (!created.id) throw new Error("Stripe Checkout did not return a session ID");
        stripeCheckoutSessionId = created.id;
        await repositories.billing.bindProjectCheckout({
          reservationId: reservation.id,
          stripeCheckoutSessionId,
          livemode: env.STRIPE_MODE === "live",
          occurredAt: new Date(),
        });
      }

      const checkout = await stripeBilling.retrieveCheckout(stripeCheckoutSessionId);
      if (checkout.status === "expired") {
        await repositories.billing.expireProjectCheckout({
          reservationId: reservation.id,
          stripeCheckoutSessionId,
          occurredAt: new Date(),
        });
        continue;
      }
      if (checkout.status === "complete") {
        throw new BillingCheckoutConflictError("CHECKOUT_COMPLETED_PENDING");
      }
      if (!checkout.url) throw new Error("Stripe Checkout did not return a URL");
      checkoutUrl = checkout.url;
      break;
    }
    if (!checkoutUrl) throw new Error("Stripe Checkout could not be opened");
    return json({ ok: true, url: checkoutUrl }, 201);
  } catch (error) {
    if (error instanceof BillingCheckoutConflictError) {
      return json(
        { error: "This project already has an open Checkout or Founder subscription." },
        409,
      );
    }
    return json({ error: "The project-bound checkout session could not be created." }, 502);
  }
}
