import { loadEnv, resolveProviderCosts } from "@trendsfast/config";
import { ContentCapabilityNameSchema, GenerationLevelSchema } from "@trendsfast/schemas";
import { after } from "next/server";
import { z } from "zod";

import { getVerifiedAuthSubject } from "@/lib/auth-session";
import { readBoundedJsonBody } from "@/lib/bounded-json";
import { acceptsPrivateMutation, PRIVATE_RESPONSE_HEADERS } from "@/lib/private-scan-api";
import { runPersistedScan } from "@/lib/scan-processing";
import { getMemberRepositories } from "@/lib/server-database";

export const runtime = "nodejs";
export const maxDuration = 300;

const BodySchema = z
  .object({
    idempotencyKey: z.string().uuid(),
    // Keep the dashboard request identical to the claimed-project API contract.
    objective: z.string().trim().min(1).max(100).optional(),
    preferredChannels: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
    contentCapabilities: z.array(ContentCapabilityNameSchema).max(7).optional(),
    generationLevel: GenerationLevelSchema.default("brief"),
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
  const bounded = await readBoundedJsonBody(request, 8_192);
  if (!bounded.ok) {
    return json(
      { error: bounded.reason === "payload_too_large" ? "Request too large." : "Invalid JSON." },
      bounded.reason === "payload_too_large" ? 413 : 400,
    );
  }
  const body = BodySchema.safeParse(bounded.value);
  if (!body.success) return json({ error: "Refresh request is invalid." }, 400);

  let costReservationUsd: number;
  try {
    const env = loadEnv();
    if (env.PROVIDER_CREDENTIAL_MODE !== "fixture" && !env.PROVIDER_CALLS_ENABLED) {
      return json({ error: "Provider-backed project refreshes are disabled." }, 503);
    }
    costReservationUsd = resolveProviderCosts(env).maximumProviderCostUsdPerScan;
  } catch {
    return json({ error: "The managed provider policy is unavailable." }, 503);
  }

  try {
    const result = await getMemberRepositories().members.requestProjectRefresh({
      authUserId,
      projectId,
      idempotencyKey: body.data.idempotencyKey,
      ...(body.data.objective ? { objective: body.data.objective } : {}),
      ...(body.data.preferredChannels ? { preferredChannels: body.data.preferredChannels } : {}),
      ...(body.data.contentCapabilities?.length
        ? { contentCapabilities: body.data.contentCapabilities }
        : {}),
      generationLevel: body.data.generationLevel,
      costReservationUsd,
    });
    if (result.status === "USAGE_LIMITED") {
      return json(
        {
          error:
            result.reason === "ON_DEMAND_MONTHLY_LIMIT"
              ? "This project's ten on-demand refreshes have been used for the current period."
              : "An active Founder entitlement or founder grant is required.",
        },
        403,
      );
    }
    if (result.status === "IDEMPOTENCY_CONFLICT") {
      return json({ error: "That refresh request ID was already used for another request." }, 409);
    }
    if (result.status === "CREATED") {
      after(async () => {
        await runPersistedScan(result.publicId).catch(() => undefined);
      });
    }
    return json(
      {
        ok: true,
        status: result.status,
        statusUrl: `/scan/requested/${encodeURIComponent(result.publicId)}`,
      },
      result.status === "CREATED" ? 202 : 200,
    );
  } catch {
    return json({ error: "The project refresh could not be requested." }, 403);
  }
}
