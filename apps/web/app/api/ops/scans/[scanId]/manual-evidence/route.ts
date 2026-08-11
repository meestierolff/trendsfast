import { z } from "zod";

import { ManualEvidenceStateError } from "@trendsfast/database";

import { authorizeOpsActionRequest } from "../../../_security";
import { readBoundedJsonBody } from "../../../../../../lib/bounded-json";
import { addManualFounderEvidence } from "../../../../../../lib/manual-evidence-service";
import { ManualEvidenceBodySchema } from "./_validation";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 8 * 1_024;
const ScanIdSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9_.-]+$/);

const headers = {
  "cache-control": "no-store, max-age=0",
  pragma: "no-cache",
  "x-content-type-options": "nosniff",
};

function json(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers });
}

export async function POST(request: Request, { params }: { params: Promise<{ scanId: string }> }) {
  const authorization = authorizeOpsActionRequest(request);
  if (!authorization.ok) return json({ error: authorization.error }, authorization.status);
  if (!(request.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) {
    return json({ error: "Manual evidence requires a JSON request body." }, 415);
  }
  const parsedScanId = ScanIdSchema.safeParse((await params).scanId);
  if (!parsedScanId.success) return json({ error: "The scan identifier is invalid." }, 400);
  const bounded = await readBoundedJsonBody(request, MAX_BODY_BYTES);
  if (!bounded.ok && bounded.reason === "payload_too_large") {
    return json({ error: "The manual evidence body is too large." }, 413);
  }
  if (!bounded.ok) return json({ error: "The manual evidence body is not valid JSON." }, 400);
  const body = ManualEvidenceBodySchema.safeParse(bounded.value);
  if (!body.success) return json({ error: "The manual evidence fields are invalid." }, 400);
  const visibleEngagement = body.data.visibleEngagement
    ? Object.fromEntries(
        Object.entries(body.data.visibleEngagement).filter(
          (entry): entry is [string, number] => entry[1] !== undefined,
        ),
      )
    : undefined;

  try {
    const stored = await addManualFounderEvidence({
      scanPublicId: parsedScanId.data,
      evidence: {
        url: body.data.url,
        sourceLabel: body.data.sourceLabel,
        title: body.data.title,
        reason: body.data.reason,
        ...(body.data.excerpt === undefined ? {} : { excerpt: body.data.excerpt }),
        ...(body.data.publishedAt === undefined ? {} : { publishedAt: body.data.publishedAt }),
        ...(visibleEngagement === undefined ? {} : { visibleEngagement }),
      },
      reviewerId: authorization.reviewerId,
    });
    return json(
      {
        ok: true,
        signalId: stored.signal.id,
        receiptId: stored.receipt.id,
        provider: stored.signal.provider,
        bindingRole: stored.receipt.bindingRole,
        verified: stored.receipt.verified,
      },
      201,
    );
  } catch (error) {
    if (error instanceof ManualEvidenceStateError) {
      return json({ error: "The scan is no longer a draft awaiting review." }, 409);
    }
    return json({ error: "The manual evidence could not be validated and stored." }, 400);
  }
}
