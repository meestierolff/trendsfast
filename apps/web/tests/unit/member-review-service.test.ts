import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/server-database", () => ({ getMemberRepositories: vi.fn() }));

import { submitMemberReview } from "../../lib/member-review-service";

const baseInput = {
  authUserId: "11111111-1111-4111-8111-111111111111",
  projectId: "22222222-2222-4222-8222-222222222222",
  nextMoveId: "33333333-3333-4333-8333-333333333333",
  expectedVersion: 2,
  decision: "APPROVE" as const,
  evidenceReceiptIds: ["44444444-4444-4444-8444-444444444444"],
  evidenceAttested: true as const,
};

function dependencies() {
  const attestCurrentEvidence = vi.fn();
  const skipCurrentProposalOnce = vi.fn();
  const approve = vi.fn();
  const deliver = vi.fn();
  return {
    mocks: { attestCurrentEvidence, skipCurrentProposalOnce, approve, deliver },
    repositories: {
      memberReviews: { attestCurrentEvidence, skipCurrentProposalOnce },
      reviews: { approve },
      delivery: { deliver },
    },
  };
}

function prepared(phase: "DRAFT" | "APPROVED" | "READY") {
  return {
    phase,
    reviewerId: "member:55555555-5555-4555-8555-555555555555",
    scanRequestId: "66666666-6666-4666-8666-666666666666",
    scanRunId: "77777777-7777-4777-8777-777777777777",
    reviewVersion: 2,
    evidenceReceiptIds: baseInput.evidenceReceiptIds,
  };
}

describe("member review approval and delivery reconciliation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("attests, approves, and delivers a DRAFT without returning the raw token", async () => {
    const fixture = dependencies();
    fixture.mocks.attestCurrentEvidence.mockResolvedValue(prepared("DRAFT"));
    fixture.mocks.approve.mockResolvedValue({ state: "APPROVED" });
    fixture.mocks.deliver.mockResolvedValue({
      created: true,
      rawToken: "tf_delivery_secret",
      tokenPrefix: "prefix",
      expiresAt: new Date("2026-09-16T10:00:00.000Z"),
    });

    const result = await submitMemberReview(baseInput, {
      repositories: fixture.repositories as never,
      now: new Date("2026-08-17T10:00:00.000Z"),
    });

    expect(fixture.mocks.approve).toHaveBeenCalledWith(
      expect.objectContaining({ expectedVersion: 2, nextMoveId: baseInput.nextMoveId }),
    );
    expect(fixture.mocks.deliver).toHaveBeenCalledWith(
      expect.objectContaining({
        nextMoveId: baseInput.nextMoveId,
        expiresAt: new Date("2026-09-16T10:00:00.000Z"),
      }),
    );
    expect(result).toMatchObject({ state: "READY", deliveryCreated: true, skipped: false });
    expect(result).not.toHaveProperty("rawToken");
  });

  it("retries delivery from APPROVED without approving a second time", async () => {
    const fixture = dependencies();
    fixture.mocks.attestCurrentEvidence.mockResolvedValueOnce(prepared("DRAFT"));
    fixture.mocks.approve.mockResolvedValue({ state: "APPROVED" });
    fixture.mocks.deliver.mockRejectedValueOnce(new Error("ambiguous delivery failure"));
    await expect(
      submitMemberReview(baseInput, { repositories: fixture.repositories as never }),
    ).rejects.toThrow("ambiguous delivery failure");

    fixture.mocks.attestCurrentEvidence.mockResolvedValueOnce(prepared("APPROVED"));
    fixture.mocks.deliver.mockResolvedValueOnce({
      created: false,
      rawToken: null,
      tokenPrefix: "prefix",
      expiresAt: new Date("2026-09-16T10:00:00.000Z"),
    });
    await expect(
      submitMemberReview(baseInput, { repositories: fixture.repositories as never }),
    ).resolves.toMatchObject({ state: "READY", deliveryCreated: false });
    expect(fixture.mocks.approve).toHaveBeenCalledTimes(1);
    expect(fixture.mocks.deliver).toHaveBeenCalledTimes(2);
  });

  it("records SKIP as a terminal no-delivery decision through the member boundary", async () => {
    const fixture = dependencies();
    fixture.mocks.skipCurrentProposalOnce.mockResolvedValue({
      outcome: { id: "88888888-8888-4888-8888-888888888888", kind: "SKIPPED" },
      created: false,
      reviewerId: "member:55555555-5555-4555-8555-555555555555",
      reviewVersion: 2,
    });
    const result = await submitMemberReview(
      { ...baseInput, decision: "SKIP" },
      {
        repositories: fixture.repositories as never,
        now: new Date("2026-08-17T10:00:00.000Z"),
      },
    );
    expect(fixture.mocks.attestCurrentEvidence).not.toHaveBeenCalled();
    expect(fixture.mocks.approve).not.toHaveBeenCalled();
    expect(fixture.mocks.deliver).not.toHaveBeenCalled();
    expect(fixture.mocks.skipCurrentProposalOnce).toHaveBeenCalledWith({
      authUserId: baseInput.authUserId,
      projectId: baseInput.projectId,
      nextMoveId: baseInput.nextMoveId,
      expectedVersion: baseInput.expectedVersion,
      evidenceReceiptIds: baseInput.evidenceReceiptIds,
      now: new Date("2026-08-17T10:00:00.000Z"),
    });
    expect(result).toMatchObject({
      state: "SKIPPED",
      deliveryCreated: false,
      skipped: true,
      skipCreated: false,
    });
  });
});
