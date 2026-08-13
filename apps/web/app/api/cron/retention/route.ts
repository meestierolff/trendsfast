import { timingSafeEqual } from "node:crypto";

import { deploymentSurface, loadEnv } from "@trendsfast/config";

import { runRetentionPurge } from "../../../../lib/retention-service";

export const runtime = "nodejs";
export const maxDuration = 300;

const headers = {
  "cache-control": "private, no-store, max-age=0",
  pragma: "no-cache",
  "x-content-type-options": "nosniff",
  "x-robots-tag": "noindex, nofollow, noarchive",
};

function json(body: Record<string, unknown>, status: number) {
  return Response.json(body, { status, headers });
}

function safeSecretMatch(presented: string | null, expected: string) {
  if (!presented?.startsWith("Bearer ")) return false;
  const token = Buffer.from(presented.slice("Bearer ".length), "utf8");
  const secret = Buffer.from(expected, "utf8");
  return token.length === secret.length && timingSafeEqual(token, secret);
}

export async function GET(request: Request) {
  // Hide the route before config parsing or database access on the public plane.
  if (deploymentSurface() !== "ops") return json({ error: "Not Found" }, 404);

  const env = loadEnv();
  if (!env.CRON_SECRET || env.CRON_SECRET.length < 32) {
    return json({ error: "Retention cron is not configured." }, 503);
  }
  if (!safeSecretMatch(request.headers.get("authorization"), env.CRON_SECRET)) {
    return json({ error: "Retention cron authorization failed." }, 401);
  }

  try {
    const retention = await runRetentionPurge();
    const ok = retention.remainingExpiredFounderLaunchInterests === 0;
    return json({ ok, retention }, ok ? 200 : 500);
  } catch {
    return json({ ok: false, error: "RETENTION_PURGE_FAILED" }, 500);
  }
}
