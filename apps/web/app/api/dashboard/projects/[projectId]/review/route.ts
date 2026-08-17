import { z } from "zod";

import {
  FounderDeliveryAdmissionError,
  MemberReviewAuthorizationError,
  MemberReviewConflictError,
  MemberReviewEvidenceError,
  ReviewVersionConflictError,
} from "@trendsfast/database";

import { getVerifiedAuthSubject } from "@/lib/auth-session";
import { readBoundedJsonBody } from "@/lib/bounded-json";
import { submitMemberReview } from "@/lib/member-review-service";
import { acceptsPrivateMutation, PRIVATE_RESPONSE_HEADERS } from "@/lib/private-scan-api";

export const runtime = "nodejs";

const BodySchema = z
  .object({
    nextMoveId: z.string().uuid(),
    expectedVersion: z.number().int().positive(),
    decision: z.enum(["APPROVE", "SKIP"]),
    evidenceReceiptIds: z.array(z.string().uuid()).max(100),
    evidenceAttested: z.literal(true),
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
  if (!(request.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) {
    return json({ error: "Review submissions require JSON." }, 415);
  }

  const bounded = await readBoundedJsonBody(request, 16 * 1_024);
  if (!bounded.ok) {
    return json(
      {
        error: bounded.reason === "payload_too_large" ? "Review is too large." : "Invalid JSON.",
      },
      bounded.reason === "payload_too_large" ? 413 : 400,
    );
  }
  const body = BodySchema.safeParse(bounded.value);
  if (!body.success) return json({ error: "Review submission is invalid." }, 400);

  try {
    const result = await submitMemberReview({
      authUserId,
      projectId,
      ...body.data,
    });
    return json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof MemberReviewAuthorizationError) {
      return json({ error: "Next Move not found." }, 404);
    }
    if (error instanceof MemberReviewEvidenceError) {
      return json({ error: "Evidence changed. Review the current receipts and try again." }, 409);
    }
    if (error instanceof ReviewVersionConflictError || error instanceof MemberReviewConflictError) {
      return json({ error: "This proposal changed. Refresh before reviewing it." }, 409);
    }
    if (error instanceof FounderDeliveryAdmissionError) {
      return json({ error: "This proposal cannot be delivered under the current plan." }, 409);
    }
    return json({ error: "The reviewed proposal could not be completed." }, 409);
  }
}
