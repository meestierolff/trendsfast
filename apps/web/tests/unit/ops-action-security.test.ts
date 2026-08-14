import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createCsrfToken, issueOpsSession } from "../../lib/ops-session";
import { authorizeOpsActionRequest, authorizeOpsReadRequest } from "../../app/api/ops/_security";
import { parseOpsAction } from "../../app/api/ops/_validation";

const secret = "ops-action-test-secret-that-is-at-least-32-characters";
const origin = "https://trendsfast.example";

beforeEach(() => vi.stubEnv("TRENDSFAST_SURFACE", "ops"));
afterEach(() => vi.unstubAllEnvs());

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
  it("fails closed outside the exact ops deployment surface", () => {
    vi.stubEnv("TRENDSFAST_SURFACE", "public");
    const { request } = authorizedRequest();

    expect(
      authorizeOpsActionRequest(request, {
        secret,
        expectedUrl: origin,
        now: new Date("2026-08-11T10:05:00Z"),
      }),
    ).toEqual({ ok: false, status: 403, error: "Operations access is unavailable." });
  });

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

describe("ops review bundle authorization", () => {
  it("requires a signed founder session and rejects cross-site reads", () => {
    const session = issueOpsSession({ secret, now: new Date("2026-08-11T10:00:00Z") });
    const authorized = new Request(`${origin}/api/ops/scans/scan_1/review-bundle.json`, {
      headers: { cookie: `tf_ops_session=${session}`, "sec-fetch-site": "same-origin" },
    });
    expect(
      authorizeOpsReadRequest(authorized, {
        secret,
        now: new Date("2026-08-11T10:05:00Z"),
      }),
    ).toMatchObject({ ok: true });
    const crossSite = new Request(`${origin}/api/ops/scans/scan_1/review-bundle.json`, {
      headers: { cookie: `tf_ops_session=${session}`, "sec-fetch-site": "cross-site" },
    });
    expect(
      authorizeOpsReadRequest(crossSite, {
        secret,
        now: new Date("2026-08-11T10:05:00Z"),
      }),
    ).toMatchObject({ ok: false, status: 403 });
  });
});

describe("ops action validation", () => {
  const editableMove = {
    expectedVersion: 3,
    reason: "Tighten the recommendation after checking every stored receipt.",
    topic: "A sharper founder distribution topic",
    angle: "Translate the stored evidence into a concrete founder lesson.",
    channel: "hacker_news",
    format: "founder_text",
    hook: "The evidence changes which distribution move is worth making.",
    outline: ["State the tension", "Show the receipts", "Offer the useful next step"],
    cta: "Ask one technical founder to compare this with their workflow.",
    whyNow: "The verified evidence is recent enough to act on now.",
    limitations: ["The recommendation is bounded to the stored evidence window."],
    validUntil: "2026-08-14T10:00:00.000Z",
    confidenceRationale: "The deterministic score passed and the receipts remain unchanged.",
  };

  it("accepts only bounded delivery expiry options", () => {
    expect(parseOpsAction("deliver", { expiresInDays: 30 })).toMatchObject({ success: true });
    expect(parseOpsAction("deliver", { expiresInDays: 365 })).toMatchObject({ success: false });
  });

  it("requires the optimistic review version for approval", () => {
    expect(
      parseOpsAction("approve", { expectedVersion: 3, note: "Founder verified." }),
    ).toMatchObject({ success: true, action: "approve" });
    expect(parseOpsAction("approve", {})).toMatchObject({ success: false });
    expect(parseOpsAction("approve", { expectedVersion: 0 })).toMatchObject({ success: false });
  });

  it("requires an evidence id and a meaningful rejection reason", () => {
    const evidenceReceiptId = "00000000-0000-4000-8000-000000000041";
    expect(
      parseOpsAction("reject-evidence", {
        evidenceReceiptId,
        expectedVersion: 2,
        reason: "The original source no longer supports the recommendation.",
      }),
    ).toMatchObject({ success: true });
    expect(
      parseOpsAction("reject-evidence", {
        evidenceReceiptId,
        expectedVersion: 2,
        reason: "no",
      }),
    ).toMatchObject({ success: false });
    expect(parseOpsAction("verify-evidence", { evidenceReceiptId })).toMatchObject({
      success: false,
    });
    expect(
      parseOpsAction("verify-evidence", { evidenceReceiptId, expectedVersion: 2 }),
    ).toMatchObject({ success: true });
    expect(
      parseOpsAction("convert-to-wait", {
        expectedVersion: 2,
        reason: "The evidence no longer clears the current quality floor.",
        validForHours: 72,
      }),
    ).toMatchObject({ success: true });
  });

  it("accepts only the editable Next Move whitelist with an optimistic version", () => {
    expect(parseOpsAction("edit-and-approve", editableMove)).toMatchObject({
      success: true,
      action: "edit-and-approve",
    });
    expect(
      parseOpsAction("edit-and-approve", {
        ...editableMove,
        action: "WAIT",
      }),
    ).toMatchObject({ success: false });
    expect(
      parseOpsAction("edit-and-approve", {
        ...editableMove,
        evidenceUrls: ["https://attacker.example/fabricated"],
      }),
    ).toMatchObject({ success: false });
    expect(
      parseOpsAction("edit-and-approve", { ...editableMove, expectedVersion: 0 }),
    ).toMatchObject({ success: false });
  });

  it("accepts bounded context corrections and rejects immutable context fields", () => {
    const correction = {
      expectedVersion: 2,
      reason: "The initial inference described the wrong buyer and product outcome.",
      productName: "TrendsFast",
      audience: "Technical founders of small AI and developer-tool companies.",
      problem: "They ship faster than they can identify credible distribution opportunities.",
      desiredOutcome: "Choose one evidence-backed distribution move without hours of research.",
      credibleClaims: ["Returns one founder-reviewed Next Move."],
      credibleTopics: ["distribution research", "evidence provenance"],
      suitableChannels: ["hacker_news", "x"],
      availableFormats: ["founder_text", "technical_teardown"],
      assumptions: ["The founder can substantiate every product claim."],
    };
    expect(parseOpsAction("correct-context", correction)).toMatchObject({
      success: true,
      action: "correct-context",
    });
    expect(
      parseOpsAction("correct-context", {
        ...correction,
        url: "https://attacker.example/rebind-project",
      }),
    ).toMatchObject({ success: false });
    expect(
      parseOpsAction("recompute-stored", {
        expectedVersion: 2,
        reason: "Re-evaluate the current context against only the already stored evidence.",
      }),
    ).toMatchObject({ success: true, action: "recompute-stored" });
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
