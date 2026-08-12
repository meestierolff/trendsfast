import { loadEnv } from "@trendsfast/config";

import { readBoundedJsonBody } from "../../../../lib/bounded-json";
import {
  ANALYTICS_BROWSER_BODY_MAX_BYTES,
  analyticsSessionCookie,
  parsePublicAnalyticsBody,
  recordPublicBrowserAnalytics,
  strictSameOrigin,
} from "../../../../lib/first-party-analytics";
import { getRepositories } from "../../../../lib/server-database";

export const runtime = "nodejs";

const responseHeaders = {
  "cache-control": "no-store, max-age=0",
  pragma: "no-cache",
  "x-content-type-options": "nosniff",
};

function empty(status: number, cookie?: string): Response {
  const headers = new Headers(responseHeaders);
  if (cookie) headers.set("set-cookie", cookie);
  return new Response(null, { status, headers });
}

export async function POST(request: Request) {
  const env = loadEnv();
  if (!strictSameOrigin(request, env.APP_URL)) return empty(403);
  const mediaType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType !== "application/json") {
    return empty(415);
  }
  const bounded = await readBoundedJsonBody(request, ANALYTICS_BROWSER_BODY_MAX_BYTES);
  if (!bounded.ok) return empty(bounded.reason === "payload_too_large" ? 413 : 400);
  const body = parsePublicAnalyticsBody(bounded.value);
  if (!body) return empty(400);

  const secret = env.SESSION_SECRET ?? "";
  if (secret.length < 32) return empty(204);
  try {
    const repositories = getRepositories();
    const result = await recordPublicBrowserAnalytics(request, body, {
      secret,
      admission: repositories.authAdmission,
      analytics: repositories.analytics,
    });
    const cookie = result.rawSessionToSet
      ? analyticsSessionCookie(result.rawSessionToSet, env.APP_URL.startsWith("https://"))
      : undefined;
    return empty(204, cookie);
  } catch {
    // Browser instrumentation is intentionally best effort and never blocks core flows.
    return empty(204);
  }
}
