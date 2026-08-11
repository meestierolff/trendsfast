import { loadEnv } from "@trendsfast/config";

import { configuredStripeBilling } from "../../../../../lib/billing-service";
import { readBoundedJsonBody } from "../../../../../lib/bounded-json";
import { getRepositories } from "../../../../../lib/server-database";
import { derivePrivacyHash } from "../../../../../lib/first-party-analytics";
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
  const entitlement = await repositories.billing.entitlementForProject(project.id);
  if (entitlement?.active) {
    return json({ error: "This project already has an active Founder entitlement." }, 409);
  }

  try {
    const customer = await repositories.billing.customerForProject(project.id);
    const checkout = await stripeBilling.createCheckout({
      projectId: project.id,
      actorId: authorization.reviewerId,
      ...(customer ? { customerId: customer.stripeCustomerId } : {}),
    });
    if (!checkout.id || !checkout.url) throw new Error("Stripe Checkout did not return a URL");
    await repositories.billing.recordCheckout({
      projectId: project.id,
      stripeCheckoutSessionId: checkout.id,
      initiatedBy: authorization.reviewerId,
    });
    const secret = env.SESSION_SECRET ?? "";
    if (secret.length >= 32) {
      await repositories.analytics
        .appendOnce({
          name: "checkout_started",
          dedupeKey: derivePrivacyHash(
            secret,
            "analytics-dedupe:v1",
            `checkout_started:${checkout.id}`,
          ),
          properties: { plan: "founder_cloud", mode: env.STRIPE_MODE },
        })
        .catch(() => undefined);
    }
    return json({ ok: true, url: checkout.url }, 201);
  } catch {
    return json({ error: "The project-bound checkout session could not be created." }, 502);
  }
}
