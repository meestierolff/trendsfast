import { z } from "zod";
import { ProviderVerificationAttemptConflictError } from "@trendsfast/database";

import { readBoundedJsonBody } from "../../../../../../lib/bounded-json";
import { runConfiguredProviderVerification } from "../../../../../../lib/provider-verification-service";
import { authorizeOpsActionRequest } from "../../../_security";
import { ProviderVerificationAttemptIdSchema, ProviderVerificationBodySchema } from "./_validation";

export const runtime = "nodejs";
export const maxDuration = 90;

const ProviderSchema = z.enum([
  "website",
  "google_trends",
  "hacker_news",
  "github",
  "x",
  "tavily",
  "youtube",
]);
const privateHeaders = {
  "cache-control": "no-store, max-age=0",
  pragma: "no-cache",
  "x-content-type-options": "nosniff",
};
function json(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: privateHeaders });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const authorization = authorizeOpsActionRequest(request);
  if (!authorization.ok) return json({ error: authorization.error }, authorization.status);
  if (!(request.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) {
    return json({ error: "Provider verification requires a JSON request body." }, 415);
  }
  const provider = ProviderSchema.safeParse((await params).provider);
  if (!provider.success) return json({ error: "The provider is not supported." }, 404);
  const bounded = await readBoundedJsonBody(request, 4 * 1_024);
  if (!bounded.ok && bounded.reason === "payload_too_large") {
    return json({ error: "The provider verification body is too large." }, 413);
  }
  if (!bounded.ok) return json({ error: "The request body is not valid JSON." }, 400);
  const body = ProviderVerificationBodySchema.safeParse(bounded.value);
  if (!body.success) return json({ error: "The verification inputs are invalid." }, 400);
  const attemptId = ProviderVerificationAttemptIdSchema.safeParse(
    request.headers.get("idempotency-key"),
  );
  if (!attemptId.success) {
    return json({ error: "Provider verification requires a UUID Idempotency-Key header." }, 400);
  }
  if (provider.data === "website" ? !body.data.productUrl : !body.data.query) {
    return json(
      {
        error:
          provider.data === "website"
            ? "Website verification requires a public product URL."
            : "Source verification requires a bounded query.",
      },
      400,
    );
  }

  try {
    const record = await runConfiguredProviderVerification({
      attemptId: attemptId.data,
      provider: provider.data,
      initiatedBy: authorization.reviewerId,
      ...(body.data.productUrl === undefined ? {} : { productUrl: body.data.productUrl }),
      ...(body.data.query === undefined ? {} : { query: body.data.query }),
      ...(body.data.market === undefined ? {} : { market: body.data.market }),
      ...(body.data.language === undefined ? {} : { language: body.data.language }),
    });
    if (record.failureCode === "VERIFICATION_COST_LIMIT") {
      return json(
        {
          error: "The bounded provider verification would exceed its cost ceiling.",
          id: record.id,
          state: record.state,
          reused: record.reused,
        },
        429,
      );
    }
    return json(
      {
        ok: record.state !== "FAILED",
        id: record.id,
        source: record.source,
        state: record.state,
        readbackVerified: record.readbackVerified,
        healthStatus: record.healthStatus,
        checkedAt: record.checkedAt?.toISOString() ?? null,
        reused: record.reused,
      },
      record.state === "RUNNING" ? 202 : record.state === "FAILED" ? 502 : 200,
    );
  } catch (error) {
    if (error instanceof ProviderVerificationAttemptConflictError) {
      return json(
        { error: "The Idempotency-Key was already used for different verification inputs." },
        409,
      );
    }
    return json({ error: "The bounded provider verification failed." }, 502);
  }
}
