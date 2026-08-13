import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OperationsAlertClaim } from "@trendsfast/database";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  claimDueAlerts: vi.fn(),
  completeAlert: vi.fn(),
  failAlert: vi.fn(),
  env: {
    OPS_ALERT_WEBHOOK_URL: "https://alerts.example.test/trendsfast",
    OPS_ALERT_WEBHOOK_SECRET: "alert-signing-secret-that-is-at-least-32-characters",
  },
}));

vi.mock("@trendsfast/config", () => ({ loadEnv: () => mocks.env }));
vi.mock("../../lib/server-database", () => ({
  getWorkerRepositories: () => ({
    operations: {
      claimDueAlerts: mocks.claimDueAlerts,
      completeAlert: mocks.completeAlert,
      failAlert: mocks.failAlert,
    },
  }),
}));

import {
  dispatchOperationsAlerts,
  operationsAlertBody,
  operationsAlertSignature,
} from "../../lib/ops-alert-service";

const claim = {
  id: "11111111-1111-4111-8111-111111111111",
  eventType: "MONITORING_FAILURE",
  severity: "critical",
  dedupeHash: `sha256:${"a".repeat(64)}`,
  payload: {
    code: "PROVIDER_OUTCOME_UNKNOWN",
    count: 1,
    privateUrl: "https://private.example/customer",
    customerEmail: "founder@example.test",
  },
  state: "SENDING",
  attempt: 1,
  maxAttempts: 3,
  nextAttemptAt: new Date("2026-08-12T00:00:00Z"),
  leaseOwner: "alert:lease",
  leaseExpiresAt: new Date("2026-08-12T00:00:30Z"),
  lastFailureCode: null,
  occurredAt: new Date("2026-08-12T00:00:00Z"),
  deliveredAt: null,
  createdAt: new Date("2026-08-12T00:00:00Z"),
  updatedAt: new Date("2026-08-12T00:00:00Z"),
} as unknown as OperationsAlertClaim;

describe("signed operations alert delivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.claimDueAlerts.mockResolvedValue({ claims: [claim], deadLetter: 0 });
    mocks.completeAlert.mockResolvedValue(true);
    mocks.failAlert.mockResolvedValue({ current: true, deadLetter: false });
  });

  it("serializes only the allowlisted aggregate payload", () => {
    const body = operationsAlertBody(claim);
    expect(JSON.parse(body)).toEqual({
      version: 1,
      eventType: "MONITORING_FAILURE",
      severity: "critical",
      occurredAt: "2026-08-12T00:00:00.000Z",
      payload: { code: "PROVIDER_OUTCOME_UNKNOWN", count: 1 },
    });
    expect(body).not.toMatch(/private|founder@|token|secret|https?:/i);
  });

  it("drops an unrecognized code even when a malformed database row reaches dispatch", () => {
    const body = operationsAlertBody({
      ...claim,
      payload: {
        code: "PRIVATE_URL_HTTPS_FOUNDERS_EXAMPLE" as never,
        count: 1,
      },
    });

    expect(JSON.parse(body).payload).toEqual({ count: 1 });
    expect(body).not.toMatch(/PRIVATE_URL|FOUNDERS|HTTPS/);
  });

  it("signs the exact body and marks only a successful fenced delivery", async () => {
    const sent = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const now = new Date("2026-08-12T00:00:10Z");

    const summary = await dispatchOperationsAlerts({ fetch: sent, now: () => now });

    expect(summary).toEqual({
      enabled: true,
      claimed: 1,
      delivered: 1,
      failed: 0,
      deadLetter: 0,
      stale: 0,
    });
    const [, init] = sent.mock.calls[0]!;
    const body = String(init.body);
    const timestamp = "1786492810";
    expect(init.headers["x-trendsfast-alert-timestamp"]).toBe(timestamp);
    expect(init.headers["x-trendsfast-alert-signature"]).toBe(
      operationsAlertSignature({
        body,
        timestamp,
        secret: mocks.env.OPS_ALERT_WEBHOOK_SECRET,
      }),
    );
    expect(init.redirect).toBe("error");
    expect(mocks.completeAlert).toHaveBeenCalledWith(
      expect.objectContaining({ id: claim.id, leaseOwner: claim.leaseOwner }),
    );
    expect(mocks.failAlert).not.toHaveBeenCalled();
  });

  it("stores only a bounded failure class when delivery fails", async () => {
    const sent = vi.fn().mockRejectedValue(new Error("secret upstream response body"));

    const summary = await dispatchOperationsAlerts({ fetch: sent });

    expect(summary.failed).toBe(1);
    expect(mocks.failAlert).toHaveBeenCalledWith(
      expect.objectContaining({ failureCode: "ALERT_NETWORK_FAILURE" }),
    );
    expect(summary).toMatchObject({ failed: 1, deadLetter: 0 });
  });

  it("surfaces an exhausted delivery as dead-lettered", async () => {
    mocks.failAlert.mockResolvedValueOnce({ current: true, deadLetter: true });
    const sent = vi.fn().mockResolvedValue(new Response(null, { status: 503 }));

    const summary = await dispatchOperationsAlerts({ fetch: sent });

    expect(summary).toMatchObject({ failed: 0, deadLetter: 1, stale: 0 });
  });

  it("surfaces a stale exhausted lease that dead-letters before network delivery", async () => {
    mocks.claimDueAlerts.mockResolvedValueOnce({ claims: [], deadLetter: 1 });
    const sent = vi.fn();

    const summary = await dispatchOperationsAlerts({ fetch: sent });

    expect(summary).toMatchObject({ claimed: 0, failed: 0, deadLetter: 1, stale: 0 });
    expect(sent).not.toHaveBeenCalled();
  });
});
