import { loadEnv } from "@trendsfast/config";

import { readBoundedJsonBody } from "../../../lib/bounded-json";
import {
  analyticsSessionCookie,
  analyticsSessionForRequest,
  publicRequestFingerprint,
  strictSameOrigin,
} from "../../../lib/first-party-analytics";
import {
  acceptFounderLaunchInterest,
  FOUNDER_LAUNCH_BODY_MAX_BYTES,
  parseFounderLaunchInterestBody,
} from "../../../lib/founder-launch-interest";
import { getRepositories } from "../../../lib/server-database";

export const runtime = "nodejs";

const responseHeaders = {
  "cache-control": "no-store, max-age=0",
  pragma: "no-cache",
  "x-content-type-options": "nosniff",
};

function json(body: Record<string, unknown>, status: number, cookie?: string): Response {
  const headers = new Headers(responseHeaders);
  if (cookie) headers.set("set-cookie", cookie);
  return Response.json(body, { status, headers });
}

export async function POST(request: Request) {
  const env = loadEnv();
  if (!strictSameOrigin(request, env.APP_URL)) {
    return json({ error: "Cross-site launch-interest requests are not accepted." }, 403);
  }
  const mediaType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType !== "application/json") {
    return json({ error: "A JSON request body is required." }, 415);
  }
  const bounded = await readBoundedJsonBody(request, FOUNDER_LAUNCH_BODY_MAX_BYTES);
  if (!bounded.ok) {
    return json(
      {
        error:
          bounded.reason === "payload_too_large"
            ? "The launch-interest request is too large."
            : "The launch-interest request is not valid JSON.",
      },
      bounded.reason === "payload_too_large" ? 413 : 400,
    );
  }
  const body = parseFounderLaunchInterestBody(bounded.value);
  if (!body) {
    return json({ error: "A valid email and explicit consent are required." }, 400);
  }
  const secret = env.SESSION_SECRET ?? "";
  if (secret.length < 32) {
    return json({ error: "The paid launch list is temporarily unavailable." }, 503);
  }

  const repositories = getRepositories();
  const now = new Date();
  const admitted = await repositories.authAdmission
    .admit({
      namespace: "founder-launch-interest-v1",
      fingerprintHash: publicRequestFingerprint(request.headers, secret),
      now,
      windowMs: 60 * 60 * 1_000,
      maxAttemptsPerFingerprint: 5,
      maxAttemptsGlobal: 1_000,
      maxFingerprintBuckets: 10_000,
    })
    .catch(() => false);
  if (!admitted) {
    return json({ error: "The launch-interest request limit has been reached." }, 429);
  }

  const session = analyticsSessionForRequest(request, secret);
  const cookie = session.rawSessionToSet
    ? analyticsSessionCookie(session.rawSessionToSet, env.APP_URL.startsWith("https://"))
    : undefined;
  try {
    const result = await acceptFounderLaunchInterest(
      {
        email: body.email,
        source: body.source,
        anonymousSessionHash: session.anonymousSessionHash,
      },
      {
        secret,
        interests: repositories.founderLaunchInterests,
        now,
      },
    );
    return json(result, 200, cookie);
  } catch {
    return json({ error: "The paid launch list could not be updated." }, 503);
  }
}
