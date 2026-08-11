import { NextResponse } from "next/server";

import { FeedbackKindSchema } from "@trendsfast/schemas";

import {
  acceptsPrivateMutation,
  PRIVATE_RESPONSE_HEADERS,
  privateVisitorFingerprint,
  readSmallBody,
} from "../../../../../lib/private-scan-api";
import { getRepositories } from "../../../../../lib/server-database";
import { resolveReadyScanIdentity } from "../../../../../lib/scan-view-service";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  if (!acceptsPrivateMutation(request)) {
    return NextResponse.json(
      { error: "Cross-site feedback is not accepted." },
      { status: 403, headers: PRIVATE_RESPONSE_HEADERS },
    );
  }
  const parsedBody = await readSmallBody(request);
  if (!parsedBody.ok && parsedBody.reason === "payload_too_large") {
    return NextResponse.json(
      { error: "The feedback body is too large." },
      { status: 413, headers: PRIVATE_RESPONSE_HEADERS },
    );
  }
  const kind = FeedbackKindSchema.safeParse(parsedBody.ok ? parsedBody.value.kind : undefined);
  if (!kind.success) {
    return NextResponse.json(
      { error: "Choose a valid feedback option." },
      { status: 400, headers: PRIVATE_RESPONSE_HEADERS },
    );
  }
  const { token } = await params;
  const identity = await resolveReadyScanIdentity(token);
  if (!identity) {
    return NextResponse.json(
      { error: "The private result is not available." },
      { status: 404, headers: PRIVATE_RESPONSE_HEADERS },
    );
  }
  const repositories = getRepositories();
  const visitorFingerprintHash = privateVisitorFingerprint(request);
  await repositories.feedback.record({
    nextMoveId: identity.nextMoveId,
    deliveryTokenId: identity.deliveryTokenId,
    kind: kind.data,
    ...(visitorFingerprintHash === undefined ? {} : { visitorFingerprintHash }),
  });
  await repositories.analytics
    .append({
      name:
        kind.data === "USED_OR_PUBLISHED"
          ? "move_marked_used"
          : kind.data === "REQUEST_ANOTHER_SCAN"
            ? "second_scan_requested"
            : "scan_feedback_submitted",
      scanRequestId: identity.scanRequestId,
      nextMoveId: identity.nextMoveId,
      properties: { kind: kind.data },
    })
    .catch(() => undefined);
  return NextResponse.json({ recorded: true }, { status: 201, headers: PRIVATE_RESPONSE_HEADERS });
}
