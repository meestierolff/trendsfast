import { loadEnv } from "@trendsfast/config";

import { apiKeyEnvironmentMatchesProviderMode } from "../../../../lib/api-auth-guard";
import { readBoundedJsonBody } from "../../../../lib/bounded-json";
import { getRepositories } from "../../../../lib/server-database";
import { authorizeOpsActionRequest } from "../_security";
import { ApiKeyIssueBodySchema, parseBoundedFutureExpiry } from "./_validation";

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
    return json({ error: "API key issuance requires a JSON request body." }, 415);
  }
  const bounded = await readBoundedJsonBody(request, 8 * 1_024);
  if (!bounded.ok && bounded.reason === "payload_too_large") {
    return json({ error: "The API key request body is too large." }, 413);
  }
  if (!bounded.ok) return json({ error: "The API key request body is not valid JSON." }, 400);
  const body = ApiKeyIssueBodySchema.safeParse(bounded.value);
  if (!body.success) return json({ error: "The API key controls are invalid." }, 400);
  const now = new Date();
  const expiresAt = parseBoundedFutureExpiry(body.data.expiresAt, now);
  if (!expiresAt) {
    return json({ error: "Expiry must be between five minutes and 366 days from now." }, 400);
  }
  if (
    !apiKeyEnvironmentMatchesProviderMode(body.data.environment, loadEnv().PROVIDER_CREDENTIAL_MODE)
  ) {
    return json({ error: "The key environment does not match the active provider mode." }, 409);
  }

  const repositories = getRepositories();
  const project = await repositories.scanData.getProject(body.data.projectId);
  if (!project || project.status !== "ACTIVE") {
    return json({ error: "An active project is required." }, 404);
  }
  try {
    const issued = await repositories.apiKeys.issue({
      projectId: project.id,
      name: body.data.name,
      environment: body.data.environment,
      scopes: body.data.scopes,
      rateLimitPerHour: body.data.rateLimitPerHour,
      providerCostLimitUsd: body.data.providerCostLimitUsd,
      expiresAt,
      actorId: authorization.reviewerId,
    });
    await repositories.analytics
      .append({
        name: "api_key_issued",
        apiKeyId: issued.record.id,
        properties: { environment: issued.record.environment, projectScoped: true },
      })
      .catch(() => undefined);
    return json(
      {
        ok: true,
        key: issued.record,
        rawKey: issued.rawKey,
        secretShownOnce: true,
      },
      201,
    );
  } catch {
    return json({ error: "The project API key could not be issued." }, 409);
  }
}
