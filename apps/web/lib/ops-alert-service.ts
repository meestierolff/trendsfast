import "server-only";

import { createHmac, randomUUID } from "node:crypto";

import { loadEnv, type Environment } from "@trendsfast/config";
import {
  operationsAlertCodes,
  type OperationsAlertClaim,
  type OperationsAlertPayload,
} from "@trendsfast/database";

import { getWorkerRepositories } from "./server-database";

const ALERT_BATCH_SIZE = 2;
const ALERT_LEASE_SECONDS = 30;
const ALERT_RETRY_BASE_SECONDS = 30;
const ALERT_TIMEOUT_MS = 5_000;
const ALERT_CODES = new Set<string>(operationsAlertCodes);

export type OperationsAlertDispatchSummary = {
  enabled: boolean;
  claimed: number;
  delivered: number;
  failed: number;
  deadLetter: number;
  stale: number;
};

function wirePayload(payload: OperationsAlertPayload): OperationsAlertPayload {
  return {
    ...(typeof payload.code === "string" && ALERT_CODES.has(payload.code)
      ? { code: payload.code }
      : {}),
    ...(typeof payload.count === "number" ? { count: payload.count } : {}),
    ...(typeof payload.maxAgeSeconds === "number" ? { maxAgeSeconds: payload.maxAgeSeconds } : {}),
  };
}

export function operationsAlertBody(alert: OperationsAlertClaim): string {
  return JSON.stringify({
    version: 1,
    eventType: alert.eventType,
    severity: alert.severity,
    occurredAt: alert.occurredAt.toISOString(),
    payload: wirePayload(alert.payload),
  });
}

export function operationsAlertSignature(input: {
  body: string;
  timestamp: string;
  secret: string;
}): string {
  return `v1=${createHmac("sha256", input.secret)
    .update(`${input.timestamp}.${input.body}`)
    .digest("hex")}`;
}

export async function dispatchOperationsAlerts(
  options: {
    env?: Environment;
    fetch?: typeof fetch;
    now?: () => Date;
  } = {},
): Promise<OperationsAlertDispatchSummary> {
  const env = options.env ?? loadEnv();
  const summary: OperationsAlertDispatchSummary = {
    enabled: Boolean(env.OPS_ALERT_WEBHOOK_URL && env.OPS_ALERT_WEBHOOK_SECRET),
    claimed: 0,
    delivered: 0,
    failed: 0,
    deadLetter: 0,
    stale: 0,
  };
  if (!summary.enabled || !env.OPS_ALERT_WEBHOOK_URL || !env.OPS_ALERT_WEBHOOK_SECRET) {
    return summary;
  }
  const now = options.now ?? (() => new Date());
  const repositories = getWorkerRepositories();
  const claimed = await repositories.operations.claimDueAlerts({
    now: now(),
    batchSize: ALERT_BATCH_SIZE,
    leaseSeconds: ALERT_LEASE_SECONDS,
    leaseOwner: `alert-${randomUUID().slice(0, 12)}`,
  });
  const claims = claimed.claims;
  summary.claimed = claims.length;
  summary.deadLetter = claimed.deadLetter;
  const send = options.fetch ?? fetch;
  for (const alert of claims) {
    const body = operationsAlertBody(alert);
    const timestamp = String(Math.floor(now().getTime() / 1_000));
    let delivered = false;
    let failureCode = "ALERT_NETWORK_FAILURE";
    try {
      const response = await send(env.OPS_ALERT_WEBHOOK_URL, {
        method: "POST",
        redirect: "error",
        headers: {
          "content-type": "application/json",
          "idempotency-key": `trendsfast-alert-${alert.id}`,
          "x-trendsfast-alert-timestamp": timestamp,
          "x-trendsfast-alert-signature": operationsAlertSignature({
            body,
            timestamp,
            secret: env.OPS_ALERT_WEBHOOK_SECRET,
          }),
        },
        body,
        signal: AbortSignal.timeout(ALERT_TIMEOUT_MS),
      });
      delivered = response.ok;
      failureCode = response.ok ? "" : response.status >= 500 ? "ALERT_HTTP_5XX" : "ALERT_HTTP_4XX";
    } catch {
      failureCode = "ALERT_NETWORK_FAILURE";
    }
    if (delivered) {
      const current = await repositories.operations.completeAlert({
        id: alert.id,
        leaseOwner: alert.leaseOwner,
        now: now(),
      });
      if (current) summary.delivered++;
      else summary.stale++;
    } else {
      const current = await repositories.operations.failAlert({
        id: alert.id,
        leaseOwner: alert.leaseOwner,
        failureCode,
        retryBaseSeconds: ALERT_RETRY_BASE_SECONDS,
        now: now(),
      });
      if (!current.current) summary.stale++;
      else if (current.deadLetter) summary.deadLetter++;
      else summary.failed++;
    }
  }
  return summary;
}
