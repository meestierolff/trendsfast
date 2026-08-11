import { loadEnv } from "@trendsfast/config";

import { readBoundedBodyBytes } from "../../../../../../lib/bounded-json";
import {
  analyticsSessionCookie,
  analyticsSessionForRequest,
  strictSameOrigin,
} from "../../../../../../lib/first-party-analytics";
import { recordEvidenceOpenedByToken } from "../../../../../../lib/scan-view-service";

export const runtime = "nodejs";

const privateHeaders = {
  "cache-control": "private, no-store, max-age=0",
  pragma: "no-cache",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
};

function empty(status: number, cookie?: string): Response {
  const headers = new Headers(privateHeaders);
  if (cookie) headers.set("set-cookie", cookie);
  return new Response(null, { status, headers });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string; receiptId: string }> },
) {
  const env = loadEnv();
  if (!strictSameOrigin(request, env.APP_URL)) return empty(403);
  const body = await readBoundedBodyBytes(request, 1);
  if (!body.ok || body.value.byteLength !== 0) return empty(413);

  const secret = env.SESSION_SECRET ?? "";
  const session = secret.length >= 32 ? analyticsSessionForRequest(request, secret) : null;
  const { token, receiptId } = await params;
  const found = await recordEvidenceOpenedByToken(
    token,
    receiptId,
    session ? { anonymousSessionHash: session.anonymousSessionHash, secret } : null,
  );
  if (!found) return empty(404);
  const cookie = session?.rawSessionToSet
    ? analyticsSessionCookie(session.rawSessionToSet, env.APP_URL.startsWith("https://"))
    : undefined;
  return empty(204, cookie);
}
