import "server-only";

import { getMemberRepositories } from "./server-database";

export type MemberReviewDecision = "APPROVE" | "SKIP";

type MemberReviewRepositories = Pick<
  ReturnType<typeof getMemberRepositories>,
  "memberReviews" | "reviews" | "delivery"
>;

export async function submitMemberReview(
  input: {
    authUserId: string;
    projectId: string;
    nextMoveId: string;
    expectedVersion: number;
    decision: MemberReviewDecision;
    evidenceReceiptIds: readonly string[];
    evidenceAttested: true;
  },
  dependencies: {
    repositories?: MemberReviewRepositories;
    now?: Date;
  } = {},
) {
  if (input.evidenceAttested !== true) {
    throw new Error("Exact evidence attestation is required");
  }
  const repositories = dependencies.repositories ?? getMemberRepositories();
  if (input.decision === "SKIP") {
    const skipped = await repositories.memberReviews.skipCurrentProposalOnce({
      authUserId: input.authUserId,
      projectId: input.projectId,
      nextMoveId: input.nextMoveId,
      expectedVersion: input.expectedVersion,
      evidenceReceiptIds: input.evidenceReceiptIds,
      ...(dependencies.now ? { now: dependencies.now } : {}),
    });
    return {
      state: "SKIPPED" as const,
      decision: "SKIP" as const,
      reviewVersion: skipped.reviewVersion,
      deliveryCreated: false,
      skipped: true,
      skipCreated: skipped.created,
    };
  }

  const prepared = await repositories.memberReviews.attestCurrentEvidence({
    authUserId: input.authUserId,
    projectId: input.projectId,
    nextMoveId: input.nextMoveId,
    expectedVersion: input.expectedVersion,
    evidenceReceiptIds: input.evidenceReceiptIds,
  });

  if (prepared.phase === "DRAFT") {
    await repositories.reviews.approve({
      nextMoveId: input.nextMoveId,
      reviewerId: prepared.reviewerId,
      expectedVersion: input.expectedVersion,
      note: "Authenticated project owner approved the exact attested proposal.",
      ownerAuthorization: {
        authUserId: input.authUserId,
        projectId: input.projectId,
      },
    });
  }

  let deliveryCreated = false;
  if (prepared.phase !== "READY") {
    const now = dependencies.now ?? new Date();
    if (Number.isNaN(now.getTime())) throw new Error("Member review time is invalid");
    const delivery = await repositories.delivery.deliver({
      nextMoveId: input.nextMoveId,
      reviewerId: prepared.reviewerId,
      expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1_000),
      ownerAuthorization: {
        authUserId: input.authUserId,
        projectId: input.projectId,
      },
    });
    deliveryCreated = delivery.created;
  }

  return {
    state: "READY" as const,
    decision: "APPROVE" as const,
    reviewVersion: prepared.reviewVersion,
    deliveryCreated,
    skipped: false,
    skipCreated: false,
  };
}
