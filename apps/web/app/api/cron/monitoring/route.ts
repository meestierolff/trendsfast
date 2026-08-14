import { timingSafeEqual } from "node:crypto";

import { loadEnv, paidMonitoringRuntimeEnabled } from "@trendsfast/config";

import { runMonitoringBatch } from "../../../../lib/monitoring-service";
import { dispatchOperationsAlerts } from "../../../../lib/ops-alert-service";
import { runDailyOperationsReconciliation } from "../../../../lib/operations-reconciliation-service";

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
  const monitoringEnabled = paidMonitoringRuntimeEnabled(env);
  let routeFailed = false;
  let monitoring: Record<string, unknown> = { enabled: false };
  if (monitoringEnabled) {
    try {
      monitoring = { enabled: true, ...(await runMonitoringBatch()) };
    } catch {
      routeFailed = true;
      monitoring = { enabled: true, error: "MONITORING_BATCH_FAILED" };
    }
  }

  // Reliability draining is independent from the paid-work kill switch and
  // from a failed monitoring batch. Stripe projection failures and existing
  // alert retries must still progress while monitoring is paused or broken.
  let reconciliation: Record<string, unknown>;
  try {
    reconciliation = await runDailyOperationsReconciliation();
  } catch {
    routeFailed = true;
    reconciliation = { ran: false, alertsQueued: 0, failed: true };
  }
  if (reconciliation.failed === true) {
    routeFailed = true;
  }
  let alerts: Record<string, unknown>;
  try {
    alerts = await dispatchOperationsAlerts();
    if (
      (typeof alerts.failed === "number" && alerts.failed > 0) ||
      (typeof alerts.deadLetter === "number" && alerts.deadLetter > 0) ||
      (typeof alerts.stale === "number" && alerts.stale > 0)
    ) {
      routeFailed = true;
    }
  } catch {
    routeFailed = true;
    alerts = { enabled: Boolean(env.OPS_ALERT_WEBHOOK_URL), failed: 1 };
  }
  return json({ ok: !routeFailed, monitoring, reconciliation, alerts }, routeFailed ? 500 : 200);
}
