import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: vi.fn() }));

const mocks = vi.hoisted(() => ({
  getStatus: vi.fn(),
  approve: vi.fn(),
  editAndApprove: vi.fn(),
  bindEvidence: vi.fn(),
  deliver: vi.fn(),
}));

vi.mock("../../lib/server-database", () => ({
  getOpsRepositories: () => ({
    scans: { getStatusByPublicId: mocks.getStatus },
    reviews: { approve: mocks.approve, editAndApprove: mocks.editAndApprove },
    scanData: { bindEvidence: mocks.bindEvidence },
    delivery: { deliver: mocks.deliver },
  }),
}));

import { ReviewVersionConflictError } from "@trendsfast/database";

import { POST } from "../../app/api/ops/scans/[scanId]/actions/[action]/route";
import { createCsrfToken, issueOpsSession } from "../../lib/ops-session";

const origin = "https://ops.trendsfast.example";
const publicOrigin = "https://trendsfast.example";
const secret = "ops-edit-route-test-secret-that-is-at-least-32-characters";

describe("ops edit-and-approve route", () => {
  beforeEach(() => {
    vi.stubEnv("APP_URL", origin);
    vi.stubEnv("PUBLIC_APP_URL", publicOrigin);
    vi.stubEnv("TRENDSFAST_SURFACE", "ops");
    vi.stubEnv("SESSION_SECRET", secret);
    mocks.getStatus.mockReset();
    mocks.approve.mockReset();
    mocks.editAndApprove.mockReset();
    mocks.bindEvidence.mockReset();
    mocks.deliver.mockReset();
    mocks.getStatus.mockResolvedValue({
      request: { state: "REVIEW_REQUIRED" },
      run: { id: "run_1", state: "REVIEW_REQUIRED" },
      move: {
        id: "00000000-0000-4000-8000-000000000001",
        state: "DRAFT",
        proposalStale: false,
        autoPublish: false,
      },
      evidence: [],
    });
  });

  it("rejects stale evidence verification instead of rebinding it to a newer draft", async () => {
    const receiptId = "00000000-0000-4000-8000-000000000041";
    const signalId = "00000000-0000-4000-8000-000000000042";
    mocks.getStatus.mockResolvedValueOnce({
      request: { state: "REVIEW_REQUIRED" },
      run: { id: "run_1", state: "REVIEW_REQUIRED" },
      move: {
        id: "00000000-0000-4000-8000-000000000001",
        reviewVersion: 4,
        state: "DRAFT",
        proposalStale: false,
        autoPublish: false,
      },
      evidence: [
        {
          id: receiptId,
          nextMoveId: "00000000-0000-4000-8000-000000000001",
          signalId,
          reason: "The current persisted receipt requires renewed founder review.",
        },
      ],
    });
    mocks.bindEvidence.mockRejectedValueOnce(new ReviewVersionConflictError());
    const session = issueOpsSession({ secret });
    const request = new Request(`${origin}/api/ops/scans/scan_1/actions/verify-evidence`, {
      method: "POST",
      headers: {
        origin,
        "content-type": "application/json",
        cookie: `tf_ops_session=${session}`,
        "x-csrf-token": createCsrfToken(session, secret),
      },
      body: JSON.stringify({ evidenceReceiptId: receiptId, expectedVersion: 3 }),
    });

    const response = await POST(request, {
      params: Promise.resolve({ scanId: "scan_1", action: "verify-evidence" }),
    });

    expect(response.status).toBe(409);
    expect(mocks.bindEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        evidenceReceiptId: receiptId,
        signalId,
        expectedVersion: 3,
        verified: true,
      }),
    );
  });

  it("maps a repository optimistic-version conflict to HTTP 409", async () => {
    mocks.editAndApprove.mockRejectedValue(new ReviewVersionConflictError());
    const session = issueOpsSession({ secret });
    const request = new Request(`${origin}/api/ops/scans/scan_1/actions/edit-and-approve`, {
      method: "POST",
      headers: {
        origin,
        "content-type": "application/json",
        cookie: `tf_ops_session=${session}`,
        "x-csrf-token": createCsrfToken(session, secret),
      },
      body: JSON.stringify({
        expectedVersion: 3,
        reason: "Tighten the copy after reviewing the current stored evidence.",
        topic: "An evidence-backed founder distribution topic",
        angle: "Translate the evidence into a concrete founder lesson.",
        channel: "hacker_news",
        format: "founder_text",
        hook: "The evidence changes which distribution move is worth making.",
        outline: ["State the tension", "Show the receipts"],
        cta: "Ask one founder to compare this with their workflow.",
        whyNow: "The verified evidence is recent enough to act on now.",
        limitations: ["Bounded to the stored evidence window."],
        validUntil: "2026-08-14T10:00:00.000Z",
        confidenceRationale: "The score passed and evidence identity is unchanged.",
      }),
    });

    const response = await POST(request, {
      params: Promise.resolve({ scanId: "scan_1", action: "edit-and-approve" }),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringMatching(/changed.*reload/i),
    });
    expect(mocks.editAndApprove).toHaveBeenCalledWith(
      expect.objectContaining({ expectedVersion: 3 }),
    );
  });

  it("passes the loaded version to approval and maps a stale tab to HTTP 409", async () => {
    mocks.approve.mockRejectedValue(new ReviewVersionConflictError());
    const session = issueOpsSession({ secret });
    const request = new Request(`${origin}/api/ops/scans/scan_1/actions/approve`, {
      method: "POST",
      headers: {
        origin,
        "content-type": "application/json",
        cookie: `tf_ops_session=${session}`,
        "x-csrf-token": createCsrfToken(session, secret),
      },
      body: JSON.stringify({ expectedVersion: 3, note: "Founder verified this exact draft." }),
    });

    const response = await POST(request, {
      params: Promise.resolve({ scanId: "scan_1", action: "approve" }),
    });

    expect(response.status).toBe(409);
    expect(mocks.approve).toHaveBeenCalledWith(
      expect.objectContaining({ expectedVersion: 3, note: "Founder verified this exact draft." }),
    );
  });

  it("returns private delivery links on the public origin from the isolated ops surface", async () => {
    mocks.getStatus.mockResolvedValueOnce({
      request: { state: "REVIEW_REQUIRED" },
      run: { id: "run_1", state: "REVIEW_REQUIRED" },
      move: {
        id: "00000000-0000-4000-8000-000000000001",
        state: "APPROVED",
        proposalStale: false,
        founderReviewed: true,
        autoPublish: false,
      },
      evidence: [],
    });
    mocks.deliver.mockResolvedValueOnce({
      created: true,
      rawToken: "scan_private.delivery-capability",
      tokenPrefix: "scan_private",
      expiresAt: new Date("2026-09-12T10:00:00.000Z"),
    });
    const session = issueOpsSession({ secret });
    const request = new Request(`${origin}/api/ops/scans/scan_1/actions/deliver`, {
      method: "POST",
      headers: {
        origin,
        "content-type": "application/json",
        cookie: `tf_ops_session=${session}`,
        "x-csrf-token": createCsrfToken(session, secret),
      },
      body: JSON.stringify({ expiresInDays: 30 }),
    });

    const response = await POST(request, {
      params: Promise.resolve({ scanId: "scan_1", action: "deliver" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      deliveryUrl: `${publicOrigin}/scan/scan_private.delivery-capability`,
    });
    expect(mocks.deliver).toHaveBeenCalledWith(
      expect.objectContaining({
        nextMoveId: "00000000-0000-4000-8000-000000000001",
      }),
    );
  });
});
