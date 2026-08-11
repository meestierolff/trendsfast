import { timingSafeEqual } from "node:crypto";

import { loadEnv } from "@trendsfast/config";

import { runMonitoringBatch } from "../../../../lib/monitoring-service";

export const runtime = "nodejs";
export const maxDuration = 300;

const headers = {
  "cache-control": "no-store, max-age=0",
  pragma: "no-cache",
  "x-content-type-options": "nosniff",
};
function json(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers });
}

function safeSecretMatch(presented: string | null, expected: string) {
  if (!presented?.startsWith("Bearer ")) return false;
  const token = Buffer.from(presented.slice("Bearer ".length), "utf8");
  const secret = Buffer.from(expected, "utf8");
  return token.length === secret.length && timingSafeEqual(token, secret);
}

export async function GET(request: Request) {
  const env = loadEnv();
  if (!env.CRON_SECRET || env.CRON_SECRET.length < 32) {
    return json({ error: "Monitoring cron is not configured." }, 503);
  }
  if (!safeSecretMatch(request.headers.get("authorization"), env.CRON_SECRET)) {
    return json({ error: "Monitoring cron authorization failed." }, 401);
  }
  if (!env.BILLING_ENABLED || !env.PAID_MONITORING_ENABLED) {
    return json({ error: "Paid monitoring is not enabled." }, 503);
  }
  try {
    return json({ ok: true, ...(await runMonitoringBatch()) });
  } catch {
    return json({ error: "The monitoring batch could not be completed." }, 500);
  }
}
