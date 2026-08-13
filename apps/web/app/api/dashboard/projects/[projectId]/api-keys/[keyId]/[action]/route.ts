import { getVerifiedAuthSubject } from "@/lib/auth-session";
import {
  loadEnv,
  resolveApiProviderCostLimitUsdPerHour,
  resolveApiRateLimit,
} from "@trendsfast/config";
import { readBoundedJsonBody } from "@/lib/bounded-json";
import { acceptsPrivateMutation, PRIVATE_RESPONSE_HEADERS } from "@/lib/private-scan-api";
import { getMemberRepositories } from "@/lib/server-database";

export const runtime = "nodejs";

function json(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: PRIVATE_RESPONSE_HEADERS });
}

export async function POST(
  request: Request,
  {
    params,
  }: {
    params: Promise<{ projectId: string; keyId: string; action: string }>;
  },
) {
  if (!acceptsPrivateMutation(request)) return json({ error: "Request rejected." }, 403);
  const authUserId = await getVerifiedAuthSubject();
  if (!authUserId) return json({ error: "Sign in is required." }, 401);
  const { projectId, keyId, action } = await params;
  if (
    !/^[0-9a-f-]{36}$/i.test(projectId) ||
    !/^[0-9a-f-]{36}$/i.test(keyId) ||
    !["revoke", "reissue"].includes(action)
  ) {
    return json({ error: "API key action not found." }, 404);
  }
  const bounded = await readBoundedJsonBody(request, 2_048);
  if (!bounded.ok) {
    return json(
      { error: bounded.reason === "payload_too_large" ? "Request too large." : "Invalid JSON." },
      bounded.reason === "payload_too_large" ? 413 : 400,
    );
  }
  try {
    const repositories = getMemberRepositories();
    if (action === "revoke") {
      const revoked = await repositories.members.revokeProjectApiKey({
        authUserId,
        projectId,
        apiKeyId: keyId,
      });
      if (!revoked) return json({ error: "The key is already inactive." }, 409);
      return json({ ok: true, key: revoked });
    }
    const replaced = await repositories.members.reissueProjectApiKey({
      authUserId,
      projectId,
      apiKeyId: keyId,
      policy: {
        rateLimitPerHour: resolveApiRateLimit(loadEnv(), "API_CREATE_RATE_LIMIT_PER_HOUR"),
        providerCostLimitUsd: resolveApiProviderCostLimitUsdPerHour(loadEnv()),
      },
    });
    return json({
      ok: true,
      key: replaced.record,
      replacedKey: { id: keyId, status: "REVOKED" },
      rawKey: replaced.rawKey,
      secretShownOnce: true,
    });
  } catch {
    return json({ error: "The project API key action could not be completed." }, 403);
  }
}
