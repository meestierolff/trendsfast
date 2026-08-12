import {
  checkoutClaimExpiresAt,
  checkoutClaimHash,
  checkoutClaimCookie,
  checkoutSessionExpiresAt,
  createCheckoutClaim,
  readCheckoutClaimCookie,
} from "@trendsfast/billing";
import { loadEnv } from "@trendsfast/config";
import { BillingCheckoutConflictError } from "@trendsfast/database";

import { configuredStripeBilling } from "../../../../../../lib/billing-service";
import { strictSameOrigin } from "../../../../../../lib/first-party-analytics";
import { resolveReadyScanIdentity } from "../../../../../../lib/scan-view-service";
import { getRepositories } from "../../../../../../lib/server-database";

export const runtime = "nodejs";

const responseHeaders = {
  "cache-control": "no-store, max-age=0",
  pragma: "no-cache",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
};

function json(body: Record<string, unknown>, status = 200, cookie?: string) {
  const headers = new Headers(responseHeaders);
  if (cookie) headers.set("set-cookie", cookie);
  return Response.json(body, { status, headers });
}

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  const env = loadEnv();
  if (!strictSameOrigin(request, env.APP_URL)) {
    return json({ error: "Checkout requires a same-origin request." }, 403);
  }
  const stripeBilling = configuredStripeBilling(env);
  if (!stripeBilling.availability.checkoutAvailable) {
    return json({ error: "Founder monitoring checkout is not enabled." }, 503);
  }
  const { token } = await context.params;
  const identity = await resolveReadyScanIdentity(token);
  if (!identity || identity.deliveryExpiresAt <= new Date()) {
    return json({ error: "The private delivery capability is invalid or expired." }, 404);
  }

  const repositories = getRepositories();
  const existingRawClaim = readCheckoutClaimCookie(request.headers.get("cookie"));
  const existingClaimHash = existingRawClaim ? checkoutClaimHash(existingRawClaim) : null;
  let claim =
    existingRawClaim && existingClaimHash
      ? { rawClaim: existingRawClaim, claimHash: existingClaimHash }
      : createCheckoutClaim();
  const initiatedBy = `delivery:${identity.deliveryTokenId}`;
  let claimStored = false;
  let storedClaimExpiresAt: Date | null = null;
  const responseClaimCookie = () =>
    claimStored && storedClaimExpiresAt
      ? checkoutClaimCookie(claim.rawClaim, storedClaimExpiresAt)
      : undefined;

  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const requestedAt = new Date();
      const expiresAt = checkoutSessionExpiresAt(requestedAt);
      const claimExpiresAt = checkoutClaimExpiresAt(expiresAt);

      let created = false;
      let reservation;
      if (identity.deliveryExpiresAt < claimExpiresAt) {
        reservation = await repositories.billing.checkoutForDeliveryClaimRecovery({
          projectId: identity.projectId,
          initiatedBy,
        });
        if (
          !reservation ||
          (existingRawClaim && reservation.checkoutClaimHash !== claim.claimHash)
        ) {
          return json(
            {
              error:
                "This private result expires before a safe Checkout claim can complete. Request a fresh delivery link before paying.",
            },
            409,
          );
        }
        claimStored = Boolean(existingRawClaim);
      } else {
        try {
          const reserved = await repositories.billing.reserveProjectCheckout({
            projectId: identity.projectId,
            initiatedBy,
            now: requestedAt,
            expiresAt,
            checkoutClaimHash: claim.claimHash,
            checkoutClaimExpiresAt: claimExpiresAt,
          });
          created = reserved.created;
          reservation = reserved.reservation;
          claimStored = true;
        } catch (error) {
          if (
            existingRawClaim ||
            !(error instanceof BillingCheckoutConflictError) ||
            error.code !== "CHECKOUT_ALREADY_OPEN"
          ) {
            throw error;
          }
          reservation = await repositories.billing.checkoutForDeliveryClaimRecovery({
            projectId: identity.projectId,
            initiatedBy,
          });
          if (!reservation) throw error;
          claimStored = false;
        }
      }

      if (
        !reservation.expiresAt ||
        !reservation.checkoutClaimHash ||
        !reservation.checkoutClaimExpiresAt
      ) {
        throw new Error("The delivery-bound Checkout claim reservation is incomplete");
      }
      storedClaimExpiresAt = reservation.checkoutClaimExpiresAt;

      let stripeCheckoutSessionId = reservation.stripeCheckoutSessionId;
      if (!stripeCheckoutSessionId) {
        const reconciled = created
          ? null
          : await stripeBilling.findCheckoutForReservation({
              reservationId: reservation.id,
              createdAt: reservation.createdAt,
            });
        if (!reconciled && reservation.expiresAt <= requestedAt) {
          await repositories.billing.expireUnboundProjectCheckout({
            reservationId: reservation.id,
            occurredAt: requestedAt,
          });
          claim = createCheckoutClaim();
          claimStored = false;
          storedClaimExpiresAt = null;
          continue;
        }
        const session =
          reconciled ??
          (await stripeBilling.createCheckout({
            projectId: identity.projectId,
            actorId: initiatedBy,
            reservationId: reservation.id,
            expiresAt: reservation.expiresAt,
            ...(reservation.requestedStripeCustomerId
              ? { customerId: reservation.requestedStripeCustomerId }
              : {}),
          }));
        if (!session.id) throw new Error("Stripe Checkout did not return a session ID");
        stripeCheckoutSessionId = session.id;
        await repositories.billing.bindProjectCheckout({
          reservationId: reservation.id,
          stripeCheckoutSessionId,
          livemode: env.STRIPE_MODE === "live",
          occurredAt: new Date(),
        });
      }

      const checkout = await stripeBilling.retrieveCheckout(stripeCheckoutSessionId);
      if (checkout.status === "complete") {
        return json(
          { error: "This Checkout is awaiting webhook confirmation." },
          409,
          responseClaimCookie(),
        );
      }
      if (checkout.status === "expired") {
        await repositories.billing.expireProjectCheckout({
          reservationId: reservation.id,
          stripeCheckoutSessionId: checkout.id,
          occurredAt: new Date(),
        });
        claim = createCheckoutClaim();
        claimStored = false;
        storedClaimExpiresAt = null;
        continue;
      }
      if (!claimStored) {
        const rotated = await repositories.billing.rotateProjectCheckoutClaim({
          reservationId: reservation.id,
          projectId: identity.projectId,
          initiatedBy,
          stripeCheckoutSessionId: checkout.id,
          expectedCheckoutClaimHash: reservation.checkoutClaimHash,
          checkoutClaimHash: claim.claimHash,
          occurredAt: new Date(),
        });
        claimStored = true;
        storedClaimExpiresAt = rotated.checkoutClaimExpiresAt;
      }
      if (!storedClaimExpiresAt) {
        throw new Error("The delivery-bound Checkout claim expiration is missing");
      }
      if (!checkout.url) throw new Error("Stripe Checkout did not return a URL");
      return json({ ok: true, url: checkout.url }, 201, responseClaimCookie());
    }
    return json(
      { error: "This Checkout session expired. Please try again." },
      409,
      responseClaimCookie(),
    );
  } catch (error) {
    if (error instanceof BillingCheckoutConflictError) {
      return json(
        { error: "This product already has an open Checkout or subscription." },
        409,
        responseClaimCookie(),
      );
    }
    return json(
      { error: "The project-bound Checkout session could not be created. Retry safely." },
      502,
      responseClaimCookie(),
    );
  }
}
