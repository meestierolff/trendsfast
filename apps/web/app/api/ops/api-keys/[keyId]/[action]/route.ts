import { readBoundedJsonBody } from "../../../../../../lib/bounded-json";
import { getOpsRepositories } from "../../../../../../lib/server-database";
import { authorizeOpsActionRequest } from "../../../_security";
import {
  ApiKeyIdSchema,
  ApiKeyReplacementBodySchema,
  parseBoundedFutureExpiry,
} from "../../_validation";

export const runtime = "nodejs";

const actions = new Set(["revoke", "rotate", "reissue"]);
const headers = {
  "cache-control": "no-store, max-age=0",
  pragma: "no-cache",
  "x-content-type-options": "nosniff",
};
function json(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ keyId: string; action: string }> },
) {
  const authorization = authorizeOpsActionRequest(request);
  if (!authorization.ok) return json({ error: authorization.error }, authorization.status);
  if (!(request.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) {
    return json({ error: "API key lifecycle actions require JSON." }, 415);
  }
  const route = await params;
  const keyId = ApiKeyIdSchema.safeParse(route.keyId);
  if (!keyId.success || !actions.has(route.action)) {
    return json({ error: "The API key lifecycle action is invalid." }, 404);
  }
  const bounded = await readBoundedJsonBody(request, 4 * 1_024);
  if (!bounded.ok && bounded.reason === "payload_too_large") {
    return json({ error: "The API key lifecycle body is too large." }, 413);
  }
  if (!bounded.ok) return json({ error: "The request body is not valid JSON." }, 400);

  const repositories = getOpsRepositories();
  try {
    if (route.action === "revoke") {
      if (
        typeof bounded.value !== "object" ||
        bounded.value === null ||
        Array.isArray(bounded.value) ||
        Object.keys(bounded.value).length !== 0
      ) {
        return json({ error: "Revocation does not accept additional fields." }, 400);
      }
      const record = await repositories.apiKeys.revoke(keyId.data, authorization.reviewerId);
      if (!record) return json({ error: "Only an active API key can be revoked." }, 409);
      return json({ ok: true, key: record });
    }

    const body = ApiKeyReplacementBodySchema.safeParse(bounded.value);
    if (!body.success) return json({ error: "The replacement controls are invalid." }, 400);
    const expiresAt = body.data.expiresAt
      ? parseBoundedFutureExpiry(body.data.expiresAt)
      : undefined;
    if (body.data.expiresAt && !expiresAt) {
      return json({ error: "Replacement expiry must be within the next 366 days." }, 400);
    }
    const replacementInput = {
      apiKeyId: keyId.data,
      actorId: authorization.reviewerId,
      ...(body.data.name ? { name: body.data.name } : {}),
      ...(expiresAt ? { expiresAt } : {}),
    };
    const replaced =
      route.action === "rotate"
        ? await repositories.apiKeys.rotate(replacementInput)
        : await repositories.apiKeys.reissue(replacementInput);
    return json(
      {
        ok: true,
        key: replaced.record,
        rawKey: replaced.rawKey,
        secretShownOnce: true,
        replacedKeyId: replaced.replaced.id,
      },
      201,
    );
  } catch {
    return json(
      {
        error:
          route.action === "rotate"
            ? "Only an active, unexpired project key can be rotated."
            : "Only a revoked or expired project key can be reissued.",
      },
      409,
    );
  }
}
