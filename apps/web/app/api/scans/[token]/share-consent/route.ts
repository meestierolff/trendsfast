import { NextResponse } from "next/server";

import {
  acceptsPrivateMutation,
  PRIVATE_RESPONSE_HEADERS,
  readSmallBody,
} from "../../../../../lib/private-scan-api";
import { getRepositories } from "../../../../../lib/server-database";
import { resolveReadyScanIdentity } from "../../../../../lib/scan-view-service";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  if (!acceptsPrivateMutation(request)) {
    return NextResponse.json(
      { error: "Cross-site consent is not accepted." },
      { status: 403, headers: PRIVATE_RESPONSE_HEADERS },
    );
  }
  const parsedBody = await readSmallBody(request);
  if (!parsedBody.ok && parsedBody.reason === "payload_too_large") {
    return NextResponse.json(
      { error: "The consent body is too large." },
      { status: 413, headers: PRIVATE_RESPONSE_HEADERS },
    );
  }
  const consent =
    parsedBody.ok && (parsedBody.value.consent === true || parsedBody.value.consent === "true");
  if (!consent) {
    return NextResponse.json(
      { error: "Explicit public-share consent is required." },
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
  const updated = await getRepositories().delivery.setPublicShareConsent(
    identity.deliveryTokenId,
    true,
  );
  if (!updated) {
    return NextResponse.json(
      { error: "Consent could not be recorded." },
      { status: 409, headers: PRIVATE_RESPONSE_HEADERS },
    );
  }
  return NextResponse.json({ consent: true }, { status: 200, headers: PRIVATE_RESPONSE_HEADERS });
}
