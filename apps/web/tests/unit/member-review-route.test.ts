import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  MemberReviewAuthorizationError,
  MemberReviewEvidenceError,
  ReviewVersionConflictError,
} from "@trendsfast/database";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  acceptsPrivateMutation: vi.fn(),
  getVerifiedAuthSubject: vi.fn(),
  submitMemberReview: vi.fn(),
}));

vi.mock("@/lib/private-scan-api", () => ({
  acceptsPrivateMutation: mocks.acceptsPrivateMutation,
  PRIVATE_RESPONSE_HEADERS: { "cache-control": "private, no-store" },
}));
vi.mock("@/lib/auth-session", () => ({
  getVerifiedAuthSubject: mocks.getVerifiedAuthSubject,
}));
vi.mock("@/lib/member-review-service", () => ({
  submitMemberReview: mocks.submitMemberReview,
}));

import { POST } from "../../app/api/dashboard/projects/[projectId]/review/route";

const projectId = "11111111-1111-4111-8111-111111111111";
const nextMoveId = "22222222-2222-4222-8222-222222222222";
const authUserId = "33333333-3333-4333-8333-333333333333";
const evidenceReceiptId = "44444444-4444-4444-8444-444444444444";

function request(body: unknown) {
  return new Request(`https://trendsfast.example/api/dashboard/projects/${projectId}/review`, {
    method: "POST",
    headers: { origin: "https://trendsfast.example", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function submit(body: unknown, requestedProjectId = projectId) {
  return POST(request(body), { params: Promise.resolve({ projectId: requestedProjectId }) });
}

const validBody = {
  nextMoveId,
  expectedVersion: 3,
  decision: "APPROVE",
  evidenceReceiptIds: [evidenceReceiptId],
  evidenceAttested: true,
} as const;

describe("authenticated owner review route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.acceptsPrivateMutation.mockReturnValue(true);
    mocks.getVerifiedAuthSubject.mockResolvedValue(authUserId);
    mocks.submitMemberReview.mockResolvedValue({
      state: "READY",
      decision: "APPROVE",
      reviewVersion: 3,
      deliveryCreated: true,
      skipped: false,
      skipCreated: false,
    });
  });

  it("requires same-origin mutation admission and a verified auth subject", async () => {
    mocks.acceptsPrivateMutation.mockReturnValue(false);
    await expect(submit(validBody)).resolves.toMatchObject({ status: 403 });
    expect(mocks.submitMemberReview).not.toHaveBeenCalled();

    mocks.acceptsPrivateMutation.mockReturnValue(true);
    mocks.getVerifiedAuthSubject.mockResolvedValue(null);
    await expect(submit(validBody)).resolves.toMatchObject({ status: 401 });
    expect(mocks.submitMemberReview).not.toHaveBeenCalled();
  });

  it("requires an explicit exact-evidence attestation", async () => {
    const response = await submit({ ...validBody, evidenceAttested: false });
    expect(response.status).toBe(400);
    expect(mocks.submitMemberReview).not.toHaveBeenCalled();
  });

  it("passes only the verified subject, path project, version, and exact receipt set", async () => {
    mocks.submitMemberReview.mockResolvedValueOnce({
      state: "SKIPPED",
      decision: "SKIP",
      reviewVersion: 3,
      deliveryCreated: false,
      skipped: true,
      skipCreated: true,
    });
    const response = await submit({ ...validBody, decision: "SKIP" });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      state: "SKIPPED",
      decision: "SKIP",
      deliveryCreated: false,
      skipped: true,
    });
    expect(mocks.submitMemberReview).toHaveBeenCalledWith({
      authUserId,
      projectId,
      nextMoveId,
      expectedVersion: 3,
      decision: "SKIP",
      evidenceReceiptIds: [evidenceReceiptId],
      evidenceAttested: true,
    });
  });

  it("hides owner IDOR failures and exposes stale/evidence conflicts without detail", async () => {
    mocks.submitMemberReview.mockRejectedValueOnce(new MemberReviewAuthorizationError());
    const forbidden = await submit(validBody);
    expect(forbidden.status).toBe(404);
    expect(await forbidden.json()).toEqual({ error: "Next Move not found." });

    mocks.submitMemberReview.mockRejectedValueOnce(new ReviewVersionConflictError());
    expect(await submit(validBody)).toMatchObject({ status: 409 });

    mocks.submitMemberReview.mockRejectedValueOnce(new MemberReviewEvidenceError());
    const evidence = await submit(validBody);
    expect(evidence.status).toBe(409);
    expect(await evidence.json()).toEqual({
      error: "Evidence changed. Review the current receipts and try again.",
    });
  });

  it("bounds and strictly validates the mutation body", async () => {
    const extra = await submit({ ...validBody, reviewerId: "ops:forged" });
    expect(extra.status).toBe(400);

    const invalidProject = await submit(validBody, "not-a-project");
    expect(invalidProject.status).toBe(404);
    expect(mocks.submitMemberReview).not.toHaveBeenCalled();

    const wrongType = new Request(
      `https://trendsfast.example/api/dashboard/projects/${projectId}/review`,
      {
        method: "POST",
        headers: { origin: "https://trendsfast.example", "content-type": "text/plain" },
        body: JSON.stringify(validBody),
      },
    );
    await expect(
      POST(wrongType, { params: Promise.resolve({ projectId }) }),
    ).resolves.toMatchObject({ status: 415 });
  });
});
