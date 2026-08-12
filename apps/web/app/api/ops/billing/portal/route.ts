import { loadEnv } from "@trendsfast/config";

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
    return json({ error: "Customer Portal requires a JSON request body." }, 415);
  }
  const bounded = await readBoundedJsonBody(request, 8 * 1_024);
  if (!bounded.ok) {
    return json(
      {
        error:
          bounded.reason === "payload_too_large"
            ? "The portal request body is too large."
            : "The portal request body is not valid JSON.",
      },
      bounded.reason === "payload_too_large" ? 413 : 400,
    );
  }
  const body = ProjectBillingBodySchema.safeParse(bounded.value);
  if (!body.success) return json({ error: "A project ID is required." }, 400);

  const env = loadEnv();
  const stripeBilling = configuredStripeBilling(env);
  if (!stripeBilling.availability.checkoutAvailable) {
    return json({ error: "Founder billing management is not enabled for this environment." }, 503);
  }
  const repositories = getRepositories();
  const project = await repositories.scanData.getProject(body.data.projectId);
  if (!project || project.status !== "ACTIVE") {
    return json({ error: "An active project is required." }, 404);
  }
  const customer = await repositories.billing.customerForProject(project.id);
  if (!customer) return json({ error: "No Stripe customer is bound to this project." }, 404);

  try {
    const session = await stripeBilling.createPortal(customer.stripeCustomerId);
    if (!session.url) throw new Error("Stripe Customer Portal did not return a URL");
    return json({ ok: true, url: session.url });
  } catch {
    return json({ error: "The Customer Portal session could not be created." }, 502);
  }
}
