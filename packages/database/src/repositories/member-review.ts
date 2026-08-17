import { and, eq, inArray, sql } from "drizzle-orm";

import type { TrendsFastDatabase } from "../client";
import {
  evidenceReceipts,
  nextMoves,
  outcomes,
  projectContextVersions,
  projectMemberships,
  reviewEvents,
  scanRequests,
  scanRuns,
  userProfiles,
} from "../schema";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requiredUuid(value: string, label: string): string {
  const normalized = value.trim();
  if (!UUID.test(normalized)) throw new Error(`${label} is invalid`);
  return normalized;
}

function reviewLockKey(projectId: string): string {
  return `trendsfast:member-review:${projectId}`;
}

const FOUNDER_SKIPPED_FAILURE_CODE = "FOUNDER_SKIPPED";

export class MemberReviewAuthorizationError extends Error {
  constructor() {
    super("The reviewed Next Move was not found for this project owner");
    this.name = "MemberReviewAuthorizationError";
  }
}

export class MemberReviewConflictError extends Error {
  constructor(message = "The reviewed Next Move changed before the decision was saved") {
    super(message);
    this.name = "MemberReviewConflictError";
  }
}

export class MemberReviewEvidenceError extends Error {
  constructor(message = "The evidence attestation does not match the current decision support") {
    super(message);
    this.name = "MemberReviewEvidenceError";
  }
}

type OwnerReviewPhase = "DRAFT" | "APPROVED" | "READY";

/**
 * The authenticated-member review boundary. It deliberately performs only
 * owner authorization and exact evidence attestation. APPROVE continues through
 * the shared approval/delivery repositories; SKIP is an owner-bound, locked,
 * idempotent terminal transition that never creates a delivery token.
 */
export class MemberReviewRepository {
  constructor(private readonly db: TrendsFastDatabase) {}

  async attestCurrentEvidence(input: {
    authUserId: string;
    projectId: string;
    nextMoveId: string;
    expectedVersion: number;
    evidenceReceiptIds: readonly string[];
  }): Promise<{
    phase: OwnerReviewPhase;
    reviewerId: string;
    scanRequestId: string;
    scanRunId: string;
    reviewVersion: number;
    evidenceReceiptIds: string[];
  }> {
    const authUserId = requiredUuid(input.authUserId, "Verified auth user ID");
    const projectId = requiredUuid(input.projectId, "Project ID");
    const nextMoveId = requiredUuid(input.nextMoveId, "Next Move ID");
    if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) {
      throw new MemberReviewConflictError("The submitted review version is invalid");
    }
    const submittedIds = input.evidenceReceiptIds.map((id) =>
      requiredUuid(id, "Evidence receipt ID"),
    );
    if (new Set(submittedIds).size !== submittedIds.length) {
      throw new MemberReviewEvidenceError("Evidence receipt IDs must be unique");
    }

    return this.db.transaction(async (tx) => {
      const [authorization] = await tx
        .select({
          userProfileId: userProfiles.id,
          projectId: scanRequests.projectId,
        })
        .from(nextMoves)
        .innerJoin(scanRequests, eq(scanRequests.id, nextMoves.scanRequestId))
        .innerJoin(projectMemberships, eq(projectMemberships.projectId, scanRequests.projectId))
        .innerJoin(userProfiles, eq(userProfiles.id, projectMemberships.userProfileId))
        .where(
          and(
            eq(nextMoves.id, nextMoveId),
            eq(scanRequests.projectId, projectId),
            eq(projectMemberships.role, "OWNER"),
            eq(userProfiles.authUserId, authUserId),
          ),
        )
        .limit(1);
      if (!authorization || authorization.projectId !== projectId) {
        throw new MemberReviewAuthorizationError();
      }

      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${reviewLockKey(projectId)}, 0))`,
      );
      await tx.execute(sql`SELECT id FROM projects WHERE id = ${projectId} FOR UPDATE`);
      await tx.execute(
        sql`SELECT id FROM scan_requests WHERE id = (SELECT scan_request_id FROM next_moves WHERE id = ${nextMoveId}) FOR UPDATE`,
      );
      await tx.execute(
        sql`SELECT id FROM scan_runs WHERE id = (SELECT scan_run_id FROM next_moves WHERE id = ${nextMoveId}) FOR UPDATE`,
      );
      await tx.execute(sql`SELECT id FROM next_moves WHERE id = ${nextMoveId} FOR UPDATE`);
      const [identity] = await tx
        .select({
          scanRequestId: scanRequests.id,
          scanRunId: scanRuns.id,
          requestState: scanRequests.state,
          runState: scanRuns.state,
          moveState: nextMoves.state,
          reviewVersion: nextMoves.reviewVersion,
          proposalStale: nextMoves.proposalStale,
          founderReviewed: nextMoves.founderReviewed,
          autoPublish: nextMoves.autoPublish,
          validUntil: nextMoves.validUntil,
          contextProjectId: projectContextVersions.projectId,
          contextIsCurrent: projectContextVersions.isCurrent,
        })
        .from(nextMoves)
        .innerJoin(scanRequests, eq(scanRequests.id, nextMoves.scanRequestId))
        .innerJoin(scanRuns, eq(scanRuns.id, nextMoves.scanRunId))
        .innerJoin(
          projectContextVersions,
          eq(projectContextVersions.id, nextMoves.projectContextVersionId),
        )
        .where(and(eq(nextMoves.id, nextMoveId), eq(scanRequests.projectId, projectId)))
        .limit(1);
      if (!identity || identity.contextProjectId !== projectId) {
        throw new MemberReviewAuthorizationError();
      }
      if (
        identity.reviewVersion !== input.expectedVersion ||
        identity.proposalStale ||
        identity.autoPublish ||
        !identity.contextIsCurrent
      ) {
        throw new MemberReviewConflictError();
      }

      let phase: OwnerReviewPhase;
      if (
        identity.moveState === "DRAFT" &&
        !identity.founderReviewed &&
        identity.requestState === "REVIEW_REQUIRED" &&
        identity.runState === "REVIEW_REQUIRED"
      ) {
        phase = "DRAFT";
      } else if (
        identity.moveState === "APPROVED" &&
        identity.founderReviewed &&
        identity.requestState === "REVIEW_REQUIRED" &&
        identity.runState === "REVIEW_REQUIRED"
      ) {
        phase = "APPROVED";
      } else if (
        identity.moveState === "READY" &&
        identity.founderReviewed &&
        identity.requestState === "READY" &&
        identity.runState === "READY"
      ) {
        phase = "READY";
      } else {
        throw new MemberReviewConflictError("The Next Move is not in an owner-review state");
      }

      const receipts = await tx
        .select({
          id: evidenceReceipts.id,
          availability: evidenceReceipts.availability,
          verified: evidenceReceipts.verified,
          verifiedAt: evidenceReceipts.verifiedAt,
          reviewedBy: evidenceReceipts.reviewedBy,
        })
        .from(evidenceReceipts)
        .where(
          and(
            eq(evidenceReceipts.nextMoveId, nextMoveId),
            eq(evidenceReceipts.moveVersion, identity.reviewVersion),
            eq(evidenceReceipts.bindingRole, "DECISION_SUPPORT"),
          ),
        )
        .for("update");
      const attestedAt = new Date();
      if (identity.validUntil <= attestedAt) {
        throw new MemberReviewConflictError("The proposal expired before owner review");
      }
      const currentIds = receipts.map((receipt) => receipt.id).sort();
      const exactSubmittedIds = [...submittedIds].sort();
      if (
        currentIds.length !== exactSubmittedIds.length ||
        currentIds.some((id, index) => id !== exactSubmittedIds[index])
      ) {
        throw new MemberReviewEvidenceError();
      }
      if (receipts.some((receipt) => receipt.availability !== "AVAILABLE")) {
        throw new MemberReviewEvidenceError(
          "Rejected or unavailable evidence cannot be attested for approval",
        );
      }

      const reviewerId = `member:${authorization.userProfileId}`;
      if (phase === "DRAFT") {
        const changed = receipts.filter(
          (receipt) =>
            !receipt.verified || !receipt.verifiedAt || receipt.reviewedBy !== reviewerId,
        );
        if (changed.length > 0) {
          const verifiedAt = attestedAt;
          const verified = await tx
            .update(evidenceReceipts)
            .set({ verified: true, verifiedAt, reviewedBy: reviewerId })
            .where(
              and(
                eq(evidenceReceipts.nextMoveId, nextMoveId),
                eq(evidenceReceipts.moveVersion, identity.reviewVersion),
                inArray(
                  evidenceReceipts.id,
                  changed.map((receipt) => receipt.id),
                ),
                eq(evidenceReceipts.availability, "AVAILABLE"),
              ),
            )
            .returning({ id: evidenceReceipts.id });
          if (verified.length !== changed.length) {
            throw new MemberReviewConflictError(
              "The evidence set changed while the owner attestation was being saved",
            );
          }
          await tx.insert(reviewEvents).values(
            changed.map((receipt) => ({
              scanRequestId: identity.scanRequestId,
              scanRunId: identity.scanRunId,
              nextMoveId,
              action: "EVIDENCE_VERIFIED" as const,
              reviewerId,
              before: {
                evidenceReceiptId: receipt.id,
                reviewVersion: identity.reviewVersion,
                verified: receipt.verified,
                reviewedBy: receipt.reviewedBy,
                verifiedAt: receipt.verifiedAt?.toISOString() ?? null,
                availability: receipt.availability,
              },
              after: {
                evidenceReceiptId: receipt.id,
                reviewVersion: identity.reviewVersion,
                verified: true,
                reviewedBy: reviewerId,
                verifiedAt: verifiedAt.toISOString(),
                availability: "AVAILABLE",
              },
              note: "Project owner attested the exact current decision-support receipt set.",
            })),
          );
        }
      } else if (
        receipts.some(
          (receipt) => !receipt.verified || !receipt.verifiedAt || !receipt.reviewedBy?.trim(),
        )
      ) {
        throw new MemberReviewConflictError(
          "The approved proposal no longer has a complete evidence attestation",
        );
      }

      return {
        phase,
        reviewerId,
        scanRequestId: identity.scanRequestId,
        scanRunId: identity.scanRunId,
        reviewVersion: identity.reviewVersion,
        evidenceReceiptIds: currentIds,
      };
    });
  }

  async skipCurrentProposalOnce(input: {
    authUserId: string;
    projectId: string;
    nextMoveId: string;
    expectedVersion: number;
    evidenceReceiptIds: readonly string[];
    now?: Date;
  }) {
    const authUserId = requiredUuid(input.authUserId, "Verified auth user ID");
    const projectId = requiredUuid(input.projectId, "Project ID");
    const nextMoveId = requiredUuid(input.nextMoveId, "Next Move ID");
    if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) {
      throw new MemberReviewConflictError("The submitted review version is invalid");
    }
    const submittedIds = input.evidenceReceiptIds.map((id) =>
      requiredUuid(id, "Evidence receipt ID"),
    );
    if (new Set(submittedIds).size !== submittedIds.length) {
      throw new MemberReviewEvidenceError("Evidence receipt IDs must be unique");
    }
    if (input.now && Number.isNaN(input.now.getTime())) {
      throw new MemberReviewConflictError("Review time is invalid");
    }

    return this.db.transaction(async (tx) => {
      const [authorization] = await tx
        .select({ userProfileId: userProfiles.id })
        .from(nextMoves)
        .innerJoin(scanRequests, eq(scanRequests.id, nextMoves.scanRequestId))
        .innerJoin(projectMemberships, eq(projectMemberships.projectId, scanRequests.projectId))
        .innerJoin(userProfiles, eq(userProfiles.id, projectMemberships.userProfileId))
        .where(
          and(
            eq(nextMoves.id, nextMoveId),
            eq(scanRequests.projectId, projectId),
            eq(userProfiles.authUserId, authUserId),
            eq(projectMemberships.role, "OWNER"),
          ),
        )
        .limit(1);
      if (!authorization) throw new MemberReviewAuthorizationError();
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${reviewLockKey(projectId)}, 0))`,
      );
      await tx.execute(sql`SELECT id FROM projects WHERE id = ${projectId} FOR UPDATE`);
      await tx.execute(
        sql`SELECT id FROM scan_requests WHERE id = (SELECT scan_request_id FROM next_moves WHERE id = ${nextMoveId}) FOR UPDATE`,
      );
      await tx.execute(
        sql`SELECT id FROM scan_runs WHERE id = (SELECT scan_run_id FROM next_moves WHERE id = ${nextMoveId}) FOR UPDATE`,
      );
      await tx.execute(sql`SELECT id FROM next_moves WHERE id = ${nextMoveId} FOR UPDATE`);
      const [identity] = await tx
        .select({
          scanRequestId: scanRequests.id,
          scanRunId: scanRuns.id,
          moveState: nextMoves.state,
          reviewVersion: nextMoves.reviewVersion,
          founderReviewed: nextMoves.founderReviewed,
          autoPublish: nextMoves.autoPublish,
          proposalStale: nextMoves.proposalStale,
          validUntil: nextMoves.validUntil,
          requestState: scanRequests.state,
          requestFailureCode: scanRequests.failureCode,
          runState: scanRuns.state,
          runFailureCode: scanRuns.failureCode,
          contextProjectId: projectContextVersions.projectId,
          contextIsCurrent: projectContextVersions.isCurrent,
          membershipRole: projectMemberships.role,
        })
        .from(nextMoves)
        .innerJoin(scanRequests, eq(scanRequests.id, nextMoves.scanRequestId))
        .innerJoin(scanRuns, eq(scanRuns.id, nextMoves.scanRunId))
        .innerJoin(
          projectContextVersions,
          eq(projectContextVersions.id, nextMoves.projectContextVersionId),
        )
        .innerJoin(projectMemberships, eq(projectMemberships.projectId, scanRequests.projectId))
        .innerJoin(userProfiles, eq(userProfiles.id, projectMemberships.userProfileId))
        .where(
          and(
            eq(nextMoves.id, nextMoveId),
            eq(scanRequests.projectId, projectId),
            eq(userProfiles.authUserId, authUserId),
            eq(projectMemberships.role, "OWNER"),
          ),
        )
        .limit(1);
      if (!identity || identity.membershipRole !== "OWNER") {
        throw new MemberReviewAuthorizationError();
      }
      if (identity.contextProjectId !== projectId) {
        throw new MemberReviewAuthorizationError();
      }
      if (identity.reviewVersion !== input.expectedVersion) {
        throw new MemberReviewConflictError();
      }

      const receipts = await tx
        .select({
          id: evidenceReceipts.id,
          availability: evidenceReceipts.availability,
          verified: evidenceReceipts.verified,
          verifiedAt: evidenceReceipts.verifiedAt,
          reviewedBy: evidenceReceipts.reviewedBy,
        })
        .from(evidenceReceipts)
        .where(
          and(
            eq(evidenceReceipts.nextMoveId, nextMoveId),
            eq(evidenceReceipts.moveVersion, identity.reviewVersion),
            eq(evidenceReceipts.bindingRole, "DECISION_SUPPORT"),
          ),
        )
        .for("update");
      const reviewedAt = input.now ?? new Date();
      const currentIds = receipts.map((receipt) => receipt.id).sort();
      const exactSubmittedIds = [...submittedIds].sort();
      if (
        currentIds.length !== exactSubmittedIds.length ||
        currentIds.some((id, index) => id !== exactSubmittedIds[index])
      ) {
        throw new MemberReviewEvidenceError();
      }

      const [existing] = await tx
        .select()
        .from(outcomes)
        .where(and(eq(outcomes.nextMoveId, nextMoveId), eq(outcomes.kind, "SKIPPED")))
        .limit(1);
      const alreadySkipped =
        identity.moveState === "REJECTED" &&
        identity.requestState === "FAILED" &&
        identity.runState === "FAILED" &&
        identity.requestFailureCode === FOUNDER_SKIPPED_FAILURE_CODE &&
        identity.runFailureCode === FOUNDER_SKIPPED_FAILURE_CODE;
      if (alreadySkipped) {
        if (!existing || !identity.founderReviewed || identity.autoPublish) {
          throw new MemberReviewConflictError(
            "The skipped proposal has an inconsistent audit state",
          );
        }
        return {
          outcome: existing,
          created: false as const,
          reviewerId: `member:${authorization.userProfileId}`,
          reviewVersion: identity.reviewVersion,
        };
      }
      if (
        existing ||
        identity.moveState !== "DRAFT" ||
        identity.requestState !== "REVIEW_REQUIRED" ||
        identity.runState !== "REVIEW_REQUIRED" ||
        identity.contextProjectId !== projectId ||
        !identity.contextIsCurrent ||
        identity.founderReviewed ||
        identity.autoPublish ||
        identity.proposalStale ||
        identity.validUntil <= reviewedAt
      ) {
        throw new MemberReviewConflictError("Only the current review draft can be skipped");
      }
      if (receipts.some((receipt) => receipt.availability !== "AVAILABLE")) {
        throw new MemberReviewEvidenceError(
          "Rejected or unavailable evidence cannot be attested before skipping",
        );
      }

      const reviewerId = `member:${authorization.userProfileId}`;
      const changed = receipts.filter(
        (receipt) => !receipt.verified || !receipt.verifiedAt || receipt.reviewedBy !== reviewerId,
      );
      if (changed.length > 0) {
        const verified = await tx
          .update(evidenceReceipts)
          .set({ verified: true, verifiedAt: reviewedAt, reviewedBy: reviewerId })
          .where(
            and(
              eq(evidenceReceipts.nextMoveId, nextMoveId),
              eq(evidenceReceipts.moveVersion, identity.reviewVersion),
              inArray(
                evidenceReceipts.id,
                changed.map((receipt) => receipt.id),
              ),
              eq(evidenceReceipts.availability, "AVAILABLE"),
            ),
          )
          .returning({ id: evidenceReceipts.id });
        if (verified.length !== changed.length) {
          throw new MemberReviewConflictError(
            "The evidence set changed while the owner attestation was being saved",
          );
        }
        await tx.insert(reviewEvents).values(
          changed.map((receipt) => ({
            scanRequestId: identity.scanRequestId,
            scanRunId: identity.scanRunId,
            nextMoveId,
            action: "EVIDENCE_VERIFIED" as const,
            reviewerId,
            before: {
              evidenceReceiptId: receipt.id,
              reviewVersion: identity.reviewVersion,
              verified: receipt.verified,
              reviewedBy: receipt.reviewedBy,
              verifiedAt: receipt.verifiedAt?.toISOString() ?? null,
              availability: receipt.availability,
            },
            after: {
              evidenceReceiptId: receipt.id,
              reviewVersion: identity.reviewVersion,
              verified: true,
              reviewedBy: reviewerId,
              verifiedAt: reviewedAt.toISOString(),
              availability: "AVAILABLE",
            },
            note: "Project owner attested the exact current decision-support receipt set.",
          })),
        );
      }

      const failureMessage = "The authenticated project owner reviewed and skipped this proposal.";
      const [rejectedMove] = await tx
        .update(nextMoves)
        .set({ state: "REJECTED", founderReviewed: true, updatedAt: reviewedAt })
        .where(
          and(
            eq(nextMoves.id, nextMoveId),
            eq(nextMoves.reviewVersion, input.expectedVersion),
            eq(nextMoves.state, "DRAFT"),
            eq(nextMoves.proposalStale, false),
          ),
        )
        .returning({ id: nextMoves.id });
      const [failedRequest] = await tx
        .update(scanRequests)
        .set({
          state: "FAILED",
          failureCode: FOUNDER_SKIPPED_FAILURE_CODE,
          failureMessage,
          completedAt: reviewedAt,
          updatedAt: reviewedAt,
        })
        .where(
          and(
            eq(scanRequests.id, identity.scanRequestId),
            eq(scanRequests.state, "REVIEW_REQUIRED"),
          ),
        )
        .returning({ id: scanRequests.id });
      const [failedRun] = await tx
        .update(scanRuns)
        .set({
          state: "FAILED",
          failureCode: FOUNDER_SKIPPED_FAILURE_CODE,
          failureMessage,
          completedAt: reviewedAt,
          updatedAt: reviewedAt,
        })
        .where(and(eq(scanRuns.id, identity.scanRunId), eq(scanRuns.state, "REVIEW_REQUIRED")))
        .returning({ id: scanRuns.id });
      if (!rejectedMove || !failedRequest || !failedRun) {
        throw new MemberReviewConflictError("The proposal changed before it could be skipped");
      }

      const [created] = await tx
        .insert(outcomes)
        .values({
          nextMoveId,
          kind: "SKIPPED",
          notes: "The authenticated project owner reviewed and skipped this proposal.",
        })
        .returning();
      if (!created) throw new Error("Could not persist the reviewed skip outcome");
      await tx.insert(reviewEvents).values({
        scanRequestId: identity.scanRequestId,
        scanRunId: identity.scanRunId,
        nextMoveId,
        action: "MARKED_FAILED",
        reviewerId,
        before: {
          moveState: "DRAFT",
          requestState: "REVIEW_REQUIRED",
          runState: "REVIEW_REQUIRED",
          reviewVersion: identity.reviewVersion,
        },
        after: {
          moveState: "REJECTED",
          requestState: "FAILED",
          runState: "FAILED",
          failureCode: FOUNDER_SKIPPED_FAILURE_CODE,
          outcome: "SKIPPED",
          founderReviewed: true,
          autoPublish: false,
        },
        note: "Project owner chose SKIP after reviewing the exact evidence and limitations.",
      });
      return {
        outcome: created,
        created: true as const,
        reviewerId,
        reviewVersion: identity.reviewVersion,
      };
    });
  }
}
