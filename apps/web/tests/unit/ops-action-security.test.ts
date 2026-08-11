import { describe, expect, it } from "vitest";

import { createCsrfToken, issueOpsSession } from "../../lib/ops-session";
import { authorizeOpsActionRequest } from "../../app/api/ops/_security";
import { parseOpsAction } from "../../app/api/ops/_validation";

const secret = "ops-action-test-secret-that-is-at-least-32-characters";
const origin = "https://trendsfast.example";

function authorizedRequest(overrides: { origin?: string; csrf?: string; cookie?: string } = {}) {
  const session = issueOpsSession({ secret, now: new Date("2026-08-11T10:00:00Z") });
  return {
    session,
    request: new Request(`${origin}/api/ops/scans/scan_1/actions/approve`, {
      method: "POST",
      headers: {
        origin: overrides.origin ?? origin,
        cookie: `tf_ops_session=${overrides.cookie ?? session}`,
        "x-csrf-token": overrides.csrf ?? createCsrfToken(session, secret),
      },
    }),
  };
}

describe("ops action request authorization", () => {
  it("requires same-origin, a signed session, and the session-bound CSRF token", () => {
    const { request } = authorizedRequest();
    const result = authorizeOpsActionRequest(request, {
      secret,
      expectedUrl: origin,
      now: new Date("2026-08-11T10:05:00Z"),
    });

    expect(result).toMatchObject({ ok: true });
    if (result.ok) expect(result.reviewerId).toMatch(/^founder:/);
  });

  it("rejects cross-site requests before any action is attempted", () => {
    const { request } = authorizedRequest({ origin: "https://attacker.example" });
    expect(
      authorizeOpsActionRequest(request, {
        secret,
        expectedUrl: origin,
        now: new Date("2026-08-11T10:05:00Z"),
      }),
    ).toMatchObject({ ok: false, status: 403 });
  });

  it("rejects a CSRF token bound to a different session", () => {
    const otherSession = issueOpsSession({ secret, now: new Date("2026-08-11T10:00:00Z") });
    const { request } = authorizedRequest({ csrf: createCsrfToken(otherSession, secret) });
    expect(
      authorizeOpsActionRequest(request, {
        secret,
        expectedUrl: origin,
        now: new Date("2026-08-11T10:05:00Z"),
      }),
    ).toMatchObject({ ok: false, status: 403 });
  });
});

describe("ops action validation", () => {
  it("accepts only bounded delivery expiry options", () => {
    expect(parseOpsAction("deliver", { expiresInDays: 30 })).toMatchObject({ success: true });
    expect(parseOpsAction("deliver", { expiresInDays: 365 })).toMatchObject({ success: false });
  });

  it("requires an evidence id and a meaningful rejection reason", () => {
    const evidenceReceiptId = "00000000-0000-4000-8000-000000000041";
    expect(
      parseOpsAction("reject-evidence", {
        evidenceReceiptId,
        reason: "The original source no longer supports the recommendation.",
      }),
    ).toMatchObject({ success: true });
    expect(parseOpsAction("reject-evidence", { evidenceReceiptId, reason: "no" })).toMatchObject({
      success: false,
    });
  });

  it("does not accept an unknown review action", () => {
    expect(parseOpsAction("publish", {})).toEqual({
      success: false,
      error: "Unknown operations action.",
    });
    expect(parseOpsAction("toString", {})).toEqual({
      success: false,
      error: "Unknown operations action.",
    });
  });
});
