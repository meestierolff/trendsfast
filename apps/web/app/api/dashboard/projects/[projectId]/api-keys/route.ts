import { API_KEY_SCOPES } from "@trendsfast/database";
import {
  loadEnv,
  resolveApiProviderCostLimitUsdPerHour,
  resolveApiRateLimit,
} from "@trendsfast/config";
import { z } from "zod";

import { getVerifiedAuthSubject } from "@/lib/auth-session";
import { readBoundedJsonBody } from "@/lib/bounded-json";
import { acceptsPrivateMutation, PRIVATE_RESPONSE_HEADERS } from "@/lib/private-scan-api";
import { getMemberRepositories } from "@/lib/server-database";

export const runtime = "nodejs";

const BodySchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    scopes: z.array(z.enum(API_KEY_SCOPES)).min(1).max(API_KEY_SCOPES.length),
  })
  .strict();

function json(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: PRIVATE_RESPONSE_HEADERS });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  if (!acceptsPrivateMutation(request)) return json({ error: "Request rejected." }, 403);
  const authUserId = await getVerifiedAuthSubject();
  if (!authUserId) return json({ error: "Sign in is required." }, 401);
  const { projectId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(projectId)) return json({ error: "Project not found." }, 404);
  const bounded = await readBoundedJsonBody(request, 4_096);
  if (!bounded.ok) {
    return json(
      { error: bounded.reason === "payload_too_large" ? "Request too large." : "Invalid JSON." },
      bounded.reason === "payload_too_large" ? 413 : 400,
    );
  }
  const body = BodySchema.safeParse(bounded.value);
  if (!body.success) return json({ error: "API key name or scopes are invalid." }, 400);
  try {
    const env = loadEnv();
    const issued = await getMemberRepositories().members.issueProjectApiKey({
      authUserId,
      projectId,
      ...body.data,
      policy: {
        rateLimitPerHour: resolveApiRateLimit(env, "API_CREATE_RATE_LIMIT_PER_HOUR"),
        providerCostLimitUsd: resolveApiProviderCostLimitUsdPerHour(env),
      },
    });
    return json(
      { ok: true, key: issued.record, rawKey: issued.rawKey, secretShownOnce: true },
      201,
    );
  } catch {
    return json(
      { error: "API keys require an active Founder entitlement or founder-granted access." },
      403,
    );
  }
}
