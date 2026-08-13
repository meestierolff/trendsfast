import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";

import {
  NEXT_MOVE_CONTRACT_VERSION,
  NextMoveSchema,
  ProjectContextSchema,
  VersionedNextMoveSchema,
  assertActionDetailsBoundToStoredEvidence,
  convertVersionedNextMoveToWait,
  reconcileVersionedNextMove,
  type NextMove,
  type ProjectContext,
  type ReviewAction,
  type SignalClass,
  type VersionedNextMove,
} from "@trendsfast/schemas";
import { redactRecord, redactSecrets } from "@trendsfast/core";

import type { TrendsFastDatabase } from "../client";
import {
  evidenceReceipts,
  nextMoves,
  nextMoveRevisions,
  opportunities,
  projectContextVersions,
  projects,
  reviewEvents,
  scanRequests,
  scanRuns,
  signals,
  sourceRuns,
  deliveryTokens,
} from "../schema";
import { requireDecisionEvidenceQuality } from "./review-evidence";

type EditableMoveFields = {
  topic: string;
  angle: string;
  channel: string;
  format: string;
  hook: string;
  outline: string[];
  cta: string;
  whyNow: string;
  limitations: string[];
  validUntil: Date;
  confidenceRationale: string;
};

type RecomputedDraft = {
  move: NextMove;
  versionedMove?: VersionedNextMove;
  whyNow: string;
  signalClass: SignalClass;
  independentSourceCount: number;
  saturation: "low" | "low_to_medium" | "medium" | "high" | "unknown";
  limitations: string[];
  evidenceSignalIds: string[];
  promptVersion: string;
  scoreVersion: string;
  confidenceRationale?: string;
};

function requiredReviewer(value: string): string {
  const reviewer = value.trim();
  if (!reviewer || reviewer.length > 160) {
    throw new Error("Founder review requires a non-empty reviewer identity");
  }
  return reviewer;
}

function requiredReason(value: string): string {
  const reason = redactSecrets(value).trim().slice(0, 4_000);
  if (reason.length < 10) throw new Error("Founder review changes require a meaningful reason");
  return reason;
}

function boundedText(value: string, maximum: number, label: string): string {
  const normalized = redactSecrets(value).trim();
  if (!normalized || normalized.length > maximum) {
    throw new Error(`${label} is outside the review bounds`);
  }
  return normalized;
}

function boundedList(
  values: readonly string[],
  options: { label: string; maximumItems: number; maximumLength: number; minimumItems?: number },
): string[] {
  if (values.length < (options.minimumItems ?? 0) || values.length > options.maximumItems) {
    throw new Error(`${options.label} is outside the review bounds`);
  }
  return values.map((value) => boundedText(value, options.maximumLength, options.label));
}

function moveSnapshot(move: typeof nextMoves.$inferSelect): Record<string, unknown> {
  return {
    action: move.action,
    channel: move.channel,
    topic: move.topic,
    angle: move.angle,
    format: move.format,
    hook: move.hook,
    outline: move.outline,
    cta: move.cta,
    priority: move.priority,
    confidence: Number(move.confidence),
    confidenceRationale: move.confidenceRationale,
    whyNow: move.whyNow,
    signalClass: move.signalClass,
    independentSourceCount: move.independentSourceCount,
    saturation: move.saturation,
    limitations: move.limitations,
    projectContextVersionId: move.projectContextVersionId,
    opportunityId: move.opportunityId,
    state: move.state,
    founderReviewed: move.founderReviewed,
    autoPublish: move.autoPublish,
    promptVersion: move.promptVersion,
    scoreVersion: move.scoreVersion,
    validUntil: move.validUntil.toISOString(),
    reviewVersion: move.reviewVersion,
    proposalStale: move.proposalStale,
    decisionContractVersion: move.decisionContractVersion,
    generationLevel: move.generationLevel,
    actionDetails: move.actionDetails,
    trendWindow: move.trendWindow,
    breakoutPotential: move.breakoutPotential,
    draftContent: move.draftContent,
  };
}

function versionedMoveFromRecord(move: typeof nextMoves.$inferSelect): VersionedNextMove | null {
  if (
    move.decisionContractVersion === null ||
    move.actionDetails === null ||
    move.trendWindow === null ||
    move.breakoutPotential === null
  ) {
    return null;
  }
  return VersionedNextMoveSchema.parse({
    contractVersion: move.decisionContractVersion,
    generationLevel: move.generationLevel,
    action: move.action,
    channel: move.channel,
    topic: move.topic,
    angle: move.angle,
    format: move.format,
    hook: move.hook,
    outline: move.outline,
    cta: move.cta,
    priority: move.priority,
    confidence: Number(move.confidence),
    validUntil: move.validUntil.toISOString(),
    trendWindow: move.trendWindow,
    breakoutPotential: move.breakoutPotential,
    details: move.actionDetails,
    ...(move.draftContent === null ? {} : { draftContent: move.draftContent }),
  });
}

function versionedPersistence(move: VersionedNextMove) {
  const parsed = VersionedNextMoveSchema.parse(move);
  return {
    decisionContractVersion: NEXT_MOVE_CONTRACT_VERSION,
    generationLevel: parsed.generationLevel,
    actionDetails: parsed.details,
    trendWindow: parsed.trendWindow,
    breakoutPotential: parsed.breakoutPotential,
    draftContent: parsed.draftContent ?? null,
    validUntil: new Date(parsed.validUntil),
  };
}

function evidenceBindingSignal(signal: typeof signals.$inferSelect) {
  return {
    id: signal.id,
    source: signal.source,
    url: signal.canonicalUrl,
    ...(signal.title === null ? {} : { title: signal.title }),
    ...(signal.textExcerpt === null ? {} : { textExcerpt: signal.textExcerpt }),
    ...(signal.author === null ? {} : { author: signal.author }),
    ...(signal.publishedAt === null ? {} : { publishedAt: signal.publishedAt.toISOString() }),
    observedAt: signal.observedAt.toISOString(),
  };
}

function assertVersionedCoreMatchesDraft(versioned: VersionedNextMove, draft: NextMove): void {
  const versionedCore = {
    action: versioned.action,
    channel: versioned.channel,
    topic: versioned.topic,
    angle: versioned.angle,
    format: versioned.format,
    hook: versioned.hook,
    outline: versioned.outline,
    cta: versioned.cta,
    priority: versioned.priority,
    confidence: versioned.confidence,
    validUntil: versioned.validUntil,
  };
  if (!sameJson(versionedCore, draft)) {
    throw new Error("The recomputed versioned contract does not match its core decision fields");
  }
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function projectReviewLockKey(projectId: string): string {
  return `trendsfast:project-review:${projectId}`;
}

function assertContextWhitelist(before: ProjectContext, after: ProjectContext): void {
  const immutable = [
    ["url", before.url, after.url],
    ["category", before.category, after.category],
    ["alternatives", before.alternatives, after.alternatives],
    ["competitors", before.competitors, after.competitors],
    ["markets", before.markets, after.markets],
    ["language", before.language, after.language],
  ] as const;
  const changed = immutable.find(([, prior, next]) => !sameJson(prior, next));
  if (changed) throw new Error(`Context correction cannot edit immutable field ${changed[0]}`);
}

function requireRenewedEvidenceReview(
  reviewVersion: number,
  receipts: readonly {
    bindingRole: "DECISION_SUPPORT" | "SUPPLEMENTAL";
    availability: "AVAILABLE" | "SOURCE_NO_LONGER_AVAILABLE" | "REJECTED";
    verified: boolean;
    reviewedBy: string | null;
    verifiedAt: Date | null;
  }[],
): void {
  if (reviewVersion <= 1) return;
  const support = receipts.filter((receipt) => receipt.bindingRole === "DECISION_SUPPORT");
  if (
    support.some(
      (receipt) =>
        receipt.availability !== "AVAILABLE" ||
        !receipt.verified ||
        !receipt.reviewedBy?.trim() ||
        !receipt.verifiedAt,
    )
  ) {
    throw new Error("Recomputed evidence requires renewed founder review before approval");
  }
}

export class ReviewVersionConflictError extends Error {
  constructor() {
    super("The Next Move changed after this review form was loaded");
    this.name = "ReviewVersionConflictError";
  }
}

type AppendReviewEventInput = {
  scanRequestId: string;
  scanRunId?: string;
  nextMoveId?: string;
  action: ReviewAction;
  reviewerId: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  note?: string;
};

export class ReviewRepository {
  constructor(private readonly db: TrendsFastDatabase) {}

  async listQueue(
    input: {
      states?: Array<"QUEUED" | "RUNNING" | "REVIEW_REQUIRED" | "READY" | "FAILED">;
      limit?: number;
      offset?: number;
    } = {},
  ) {
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
    const filters = input.states?.length ? inArray(scanRequests.state, input.states) : undefined;
    const rows = await this.db
      .select({ request: scanRequests, projectName: projects.name })
      .from(scanRequests)
      .leftJoin(projects, eq(scanRequests.projectId, projects.id))
      .where(filters)
      .orderBy(desc(scanRequests.submittedAt))
      .limit(limit)
      .offset(Math.max(input.offset ?? 0, 0));

    return Promise.all(
      rows.map(async ({ request, projectName }) => {
        const [run] = await this.db
          .select()
          .from(scanRuns)
          .where(eq(scanRuns.scanRequestId, request.id))
          .orderBy(desc(scanRuns.attempt))
          .limit(1);
        const [move] = await this.db
          .select({
            id: nextMoves.id,
            publicId: nextMoves.publicId,
            state: nextMoves.state,
            action: nextMoves.action,
            signalClass: nextMoves.signalClass,
            founderReviewed: nextMoves.founderReviewed,
          })
          .from(nextMoves)
          .where(eq(nextMoves.scanRequestId, request.id))
          .orderBy(desc(nextMoves.createdAt))
          .limit(1);
        const [providerFailure] = run
          ? await this.db
              .select({
                source: sourceRuns.source,
                provider: sourceRuns.provider,
                state: sourceRuns.state,
                failureCode: sourceRuns.failureCode,
              })
              .from(sourceRuns)
              .where(
                and(
                  eq(sourceRuns.scanRunId, run.id),
                  inArray(sourceRuns.state, ["FAILED", "DEGRADED"]),
                ),
              )
              .limit(1)
          : [];
        const [delivery] = move
          ? await this.db
              .select({ status: deliveryTokens.status })
              .from(deliveryTokens)
              .where(eq(deliveryTokens.nextMoveId, move.id))
              .orderBy(desc(deliveryTokens.createdAt))
              .limit(1)
          : [];

        return {
          request,
          inferredProduct: projectName,
          run: run ?? null,
          nextMove: move ?? null,
          providerFailure: providerFailure ?? null,
          deliveryState: delivery?.status ?? null,
        };
      }),
    );
  }

  async appendEvent(input: AppendReviewEventInput) {
    const reviewerId = requiredReviewer(input.reviewerId);
    const [event] = await this.db
      .insert(reviewEvents)
      .values({
        scanRequestId: input.scanRequestId,
        scanRunId: input.scanRunId ?? null,
        nextMoveId: input.nextMoveId ?? null,
        action: input.action,
        reviewerId,
        before: input.before ? redactRecord(input.before) : null,
        after: input.after ? redactRecord(input.after) : null,
        note: input.note ? redactSecrets(input.note).slice(0, 4_000) : null,
      })
      .returning();
    if (!event) throw new Error("Could not append review event");
    return event;
  }

  async listEvents(scanRequestId: string) {
    return this.db
      .select()
      .from(reviewEvents)
      .where(eq(reviewEvents.scanRequestId, scanRequestId))
      .orderBy(asc(reviewEvents.createdAt));
  }

  async listRevisions(nextMoveId: string) {
    return this.db
      .select()
      .from(nextMoveRevisions)
      .where(eq(nextMoveRevisions.nextMoveId, nextMoveId))
      .orderBy(asc(nextMoveRevisions.version));
  }

  async listEvidenceHistory(nextMoveId: string) {
    return this.db
      .select()
      .from(evidenceReceipts)
      .where(eq(evidenceReceipts.nextMoveId, nextMoveId))
      .orderBy(asc(evidenceReceipts.moveVersion), asc(evidenceReceipts.createdAt));
  }

  async listContextVersions(projectId: string) {
    return this.db
      .select()
      .from(projectContextVersions)
      .where(eq(projectContextVersions.projectId, projectId))
      .orderBy(asc(projectContextVersions.version));
  }

  async editAndApprove(input: {
    nextMoveId: string;
    reviewerId: string;
    expectedVersion: number;
    reason: string;
    edits: EditableMoveFields;
  }) {
    const reviewerId = requiredReviewer(input.reviewerId);
    const reason = requiredReason(input.reason);
    if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) {
      throw new Error("Edit-and-approve requires a valid expected move version");
    }
    if (Number.isNaN(input.edits.validUntil.getTime()) || input.edits.validUntil <= new Date()) {
      throw new Error("An edited Next Move requires a future validity window");
    }

    return this.db.transaction(async (tx) => {
      const [identity] = await tx
        .select({
          id: nextMoves.id,
          scanRequestId: nextMoves.scanRequestId,
          scanRunId: nextMoves.scanRunId,
        })
        .from(nextMoves)
        .where(eq(nextMoves.id, input.nextMoveId))
        .limit(1);
      if (!identity) throw new Error("Next Move was not found");
      await tx.execute(
        sql`SELECT id FROM scan_requests WHERE id = ${identity.scanRequestId} FOR UPDATE`,
      );
      await tx.execute(sql`SELECT id FROM scan_runs WHERE id = ${identity.scanRunId} FOR UPDATE`);
      await tx.execute(sql`SELECT id FROM next_moves WHERE id = ${identity.id} FOR UPDATE`);
      const [locked] = await tx
        .select({
          move: nextMoves,
          requestState: scanRequests.state,
          runState: scanRuns.state,
          contextVersion: projectContextVersions,
        })
        .from(nextMoves)
        .innerJoin(scanRequests, eq(scanRequests.id, nextMoves.scanRequestId))
        .innerJoin(scanRuns, eq(scanRuns.id, nextMoves.scanRunId))
        .innerJoin(
          projectContextVersions,
          eq(projectContextVersions.id, nextMoves.projectContextVersionId),
        )
        .where(eq(nextMoves.id, identity.id))
        .limit(1);
      if (!locked) throw new Error("Next Move was not found");
      const move = locked.move;
      if (move.reviewVersion !== input.expectedVersion) throw new ReviewVersionConflictError();
      if (
        locked.requestState !== "REVIEW_REQUIRED" ||
        locked.runState !== "REVIEW_REQUIRED" ||
        move.state !== "DRAFT" ||
        move.proposalStale ||
        move.autoPublish
      ) {
        throw new Error("Only a current founder review draft can be edited and approved");
      }
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${projectReviewLockKey(locked.contextVersion.projectId)}, 0))`,
      );
      await tx.execute(
        sql`SELECT id FROM projects WHERE id = ${locked.contextVersion.projectId} FOR UPDATE`,
      );
      await tx.execute(
        sql`SELECT id FROM project_context_versions WHERE project_id = ${locked.contextVersion.projectId} FOR UPDATE`,
      );
      const [currentContextVersion] = await tx
        .select()
        .from(projectContextVersions)
        .where(
          and(
            eq(projectContextVersions.id, move.projectContextVersionId),
            eq(projectContextVersions.projectId, locked.contextVersion.projectId),
            eq(projectContextVersions.isCurrent, true),
          ),
        )
        .limit(1);
      if (!currentContextVersion) throw new ReviewVersionConflictError();

      const parsedMove = NextMoveSchema.parse({
        action: move.action,
        channel: input.edits.channel,
        topic: input.edits.topic,
        angle: input.edits.angle,
        format: input.edits.format,
        hook: input.edits.hook,
        outline: input.edits.outline,
        cta: input.edits.cta,
        priority: move.priority,
        confidence: Number(move.confidence),
        validUntil: input.edits.validUntil.toISOString(),
      });
      const context = ProjectContextSchema.parse(currentContextVersion.context);
      if (!context.suitableChannels.includes(parsedMove.channel)) {
        throw new Error("The edited channel does not fit the current founder-reviewed context");
      }
      if (!context.availableFormats.includes(parsedMove.format)) {
        throw new Error("The edited format does not fit the current founder-reviewed context");
      }
      const currentVersionedMove = versionedMoveFromRecord(move);
      if (!currentVersionedMove) {
        throw new Error("The review draft is missing its versioned decision contract");
      }
      const reconciledVersionedMove = reconcileVersionedNextMove({
        move: currentVersionedMove,
        prose: {
          channel: parsedMove.channel,
          topic: parsedMove.topic,
          angle: parsedMove.angle,
          format: parsedMove.format,
          hook: parsedMove.hook,
          outline: parsedMove.outline,
          cta: parsedMove.cta,
        },
        validUntil: parsedMove.validUntil,
      });
      const whyNow = boundedText(input.edits.whyNow, 4_000, "Why-now summary");
      const limitations = boundedList(input.edits.limitations, {
        label: "Limitations",
        maximumItems: 50,
        maximumLength: 1_000,
      });
      const confidenceRationale = boundedText(
        input.edits.confidenceRationale,
        4_000,
        "Confidence rationale",
      );
      const before = moveSnapshot(move);
      const editableBefore = {
        topic: move.topic,
        angle: move.angle,
        channel: move.channel,
        format: move.format,
        hook: move.hook,
        outline: move.outline,
        cta: move.cta,
        whyNow: move.whyNow,
        limitations: move.limitations,
        validUntil: move.validUntil.toISOString(),
        confidenceRationale: move.confidenceRationale ?? "",
      };
      const editableAfter = {
        topic: parsedMove.topic,
        angle: parsedMove.angle,
        channel: parsedMove.channel,
        format: parsedMove.format,
        hook: parsedMove.hook,
        outline: parsedMove.outline,
        cta: parsedMove.cta,
        whyNow,
        limitations,
        validUntil: parsedMove.validUntil,
        confidenceRationale,
      };
      if (sameJson(editableBefore, editableAfter)) {
        throw new Error("Edit-and-approve requires at least one changed editable field");
      }

      const receipts = await tx
        .select()
        .from(evidenceReceipts)
        .where(
          and(
            eq(evidenceReceipts.nextMoveId, move.id),
            eq(evidenceReceipts.moveVersion, move.reviewVersion),
          ),
        );
      if (
        reconciledVersionedMove.details.action === "REPLY" ||
        reconciledVersionedMove.details.action === "REMIX"
      ) {
        const supportSignalIds = [
          ...new Set(
            receipts
              .filter((receipt) => receipt.bindingRole === "DECISION_SUPPORT")
              .map((receipt) => receipt.signalId),
          ),
        ];
        const supportSignals = supportSignalIds.length
          ? await tx
              .select({ signal: signals })
              .from(signals)
              .innerJoin(sourceRuns, eq(sourceRuns.id, signals.sourceRunId))
              .where(
                and(
                  eq(sourceRuns.scanRunId, move.scanRunId),
                  inArray(signals.id, supportSignalIds),
                ),
              )
          : [];
        if (supportSignals.length !== supportSignalIds.length) {
          throw new Error("Every action target must remain bound to its stored scan evidence");
        }
        assertActionDetailsBoundToStoredEvidence({
          details: reconciledVersionedMove.details,
          evidenceSignalIds: supportSignalIds,
          storedSignals: supportSignals.map(({ signal }) => evidenceBindingSignal(signal)),
        });
      }
      requireRenewedEvidenceReview(move.reviewVersion, receipts);
      const quality = requireDecisionEvidenceQuality({
        action: move.action,
        signalClass: move.signalClass,
        receipts,
      });
      if (move.action !== "WAIT") {
        const [opportunity] = move.opportunityId
          ? await tx
              .select({ passesQualityFloor: opportunities.passesQualityFloor })
              .from(opportunities)
              .where(eq(opportunities.id, move.opportunityId))
              .limit(1)
          : [];
        if (!opportunity?.passesQualityFloor) {
          throw new Error("The deterministic opportunity no longer passes the quality floor");
        }
      }

      const now = new Date();
      const nextVersion = move.reviewVersion + 1;
      const [updated] = await tx
        .update(nextMoves)
        .set({
          topic: parsedMove.topic,
          angle: parsedMove.angle,
          channel: parsedMove.channel,
          format: parsedMove.format,
          hook: parsedMove.hook,
          outline: parsedMove.outline,
          cta: parsedMove.cta,
          whyNow,
          limitations,
          ...versionedPersistence(reconciledVersionedMove),
          confidenceRationale,
          ...(move.action === "WAIT"
            ? {}
            : { independentSourceCount: quality.independentSourceCount }),
          reviewVersion: nextVersion,
          proposalStale: false,
          state: "APPROVED",
          founderReviewed: true,
          approvedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(nextMoves.id, move.id),
            eq(nextMoves.reviewVersion, input.expectedVersion),
            eq(nextMoves.state, "DRAFT"),
          ),
        )
        .returning();
      if (!updated) throw new ReviewVersionConflictError();

      if (receipts.length) {
        await tx.insert(evidenceReceipts).values(
          receipts.map((receipt) => ({
            nextMoveId: move.id,
            moveVersion: nextVersion,
            signalId: receipt.signalId,
            source: receipt.source,
            provider: receipt.provider,
            canonicalUrl: receipt.canonicalUrl,
            title: receipt.title,
            publishedAt: receipt.publishedAt,
            observedAt: receipt.observedAt,
            reason: receipt.reason,
            bindingRole: receipt.bindingRole,
            verified: receipt.verified,
            availability: receipt.availability,
            reviewedBy: receipt.reviewedBy,
            verifiedAt: receipt.verifiedAt,
          })),
        );
      }
      const after = moveSnapshot(updated);
      const retainedEvidenceIds = receipts.map((receipt) => receipt.signalId);
      await tx.insert(nextMoveRevisions).values({
        nextMoveId: move.id,
        contextVersionId: move.projectContextVersionId,
        version: nextVersion,
        changeKind: "EDIT_AND_APPROVE",
        reviewerId,
        reason,
        before: redactRecord(before),
        after: redactRecord(after),
        promptVersion: move.promptVersion,
        scoreVersion: move.scoreVersion,
        retainedEvidenceIds,
      });
      await tx.insert(reviewEvents).values({
        scanRequestId: move.scanRequestId,
        scanRunId: move.scanRunId,
        nextMoveId: move.id,
        action: "EDITED_AND_APPROVED",
        reviewerId,
        before: redactRecord(before),
        after: redactRecord(after),
        note: reason,
      });
      return updated;
    });
  }

  async recomputeFromStoredEvidence(input: {
    nextMoveId: string;
    reviewerId: string;
    expectedVersion: number;
    reason: string;
    draft: RecomputedDraft;
    contextCorrection?: ProjectContext;
  }) {
    const reviewerId = requiredReviewer(input.reviewerId);
    const reason = requiredReason(input.reason);
    if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) {
      throw new Error("Stored-evidence recompute requires a valid expected move version");
    }
    const draftMove = NextMoveSchema.parse(input.draft.move);
    if (new Date(draftMove.validUntil) <= new Date()) {
      throw new Error("A recomputed Next Move requires a future validity window");
    }
    const whyNow = boundedText(input.draft.whyNow, 4_000, "Why-now summary");
    const limitations = boundedList(input.draft.limitations, {
      label: "Limitations",
      maximumItems: 50,
      maximumLength: 1_000,
    });
    const promptVersion = boundedText(input.draft.promptVersion, 100, "Prompt version");
    const scoreVersion = boundedText(input.draft.scoreVersion, 100, "Score version");
    const confidenceRationale = input.draft.confidenceRationale
      ? boundedText(input.draft.confidenceRationale, 4_000, "Confidence rationale")
      : null;
    const evidenceSignalIds = [...new Set(input.draft.evidenceSignalIds)];
    if (evidenceSignalIds.length !== input.draft.evidenceSignalIds.length) {
      throw new Error("Recomputed evidence identity cannot contain duplicate signals");
    }
    if (evidenceSignalIds.length > 50) {
      throw new Error("Recomputed evidence exceeds the bounded receipt limit");
    }

    return this.db.transaction(async (tx) => {
      const [identity] = await tx
        .select({
          id: nextMoves.id,
          scanRequestId: nextMoves.scanRequestId,
          scanRunId: nextMoves.scanRunId,
        })
        .from(nextMoves)
        .where(eq(nextMoves.id, input.nextMoveId))
        .limit(1);
      if (!identity) throw new Error("Next Move was not found");
      await tx.execute(
        sql`SELECT id FROM scan_requests WHERE id = ${identity.scanRequestId} FOR UPDATE`,
      );
      await tx.execute(sql`SELECT id FROM scan_runs WHERE id = ${identity.scanRunId} FOR UPDATE`);
      await tx.execute(sql`SELECT id FROM next_moves WHERE id = ${identity.id} FOR UPDATE`);
      const [locked] = await tx
        .select({
          move: nextMoves,
          requestState: scanRequests.state,
          runState: scanRuns.state,
          contextVersion: projectContextVersions,
          project: projects,
        })
        .from(nextMoves)
        .innerJoin(scanRequests, eq(scanRequests.id, nextMoves.scanRequestId))
        .innerJoin(scanRuns, eq(scanRuns.id, nextMoves.scanRunId))
        .innerJoin(
          projectContextVersions,
          eq(projectContextVersions.id, nextMoves.projectContextVersionId),
        )
        .innerJoin(projects, eq(projects.id, projectContextVersions.projectId))
        .where(eq(nextMoves.id, identity.id))
        .limit(1);
      if (!locked) throw new Error("Next Move context was not found");
      const move = locked.move;
      if (move.reviewVersion !== input.expectedVersion) throw new ReviewVersionConflictError();
      if (
        locked.requestState !== "REVIEW_REQUIRED" ||
        locked.runState !== "REVIEW_REQUIRED" ||
        move.state !== "DRAFT" ||
        move.proposalStale ||
        move.autoPublish
      ) {
        throw new Error("Only a current founder review draft can be recomputed");
      }
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${projectReviewLockKey(locked.project.id)}, 0))`,
      );
      await tx.execute(sql`SELECT id FROM projects WHERE id = ${locked.project.id} FOR UPDATE`);
      await tx.execute(
        sql`SELECT id FROM project_context_versions WHERE project_id = ${locked.project.id} FOR UPDATE`,
      );
      const [refreshedBaseContext] = await tx
        .select()
        .from(projectContextVersions)
        .where(
          and(
            eq(projectContextVersions.id, locked.contextVersion.id),
            eq(projectContextVersions.projectId, locked.project.id),
          ),
        )
        .limit(1);
      const [currentContext] = await tx
        .select({ id: projectContextVersions.id })
        .from(projectContextVersions)
        .where(
          and(
            eq(projectContextVersions.projectId, locked.project.id),
            eq(projectContextVersions.isCurrent, true),
          ),
        )
        .limit(1);
      if (
        !refreshedBaseContext ||
        !refreshedBaseContext.isCurrent ||
        currentContext?.id !== refreshedBaseContext.id
      ) {
        throw new ReviewVersionConflictError();
      }

      const evidenceDispositions = evidenceSignalIds.length
        ? await tx
            .select({
              signalId: evidenceReceipts.signalId,
              moveVersion: evidenceReceipts.moveVersion,
              availability: evidenceReceipts.availability,
            })
            .from(evidenceReceipts)
            .where(
              and(
                eq(evidenceReceipts.nextMoveId, move.id),
                inArray(evidenceReceipts.signalId, evidenceSignalIds),
              ),
            )
        : [];
      const latestDispositionBySignal = new Map<string, (typeof evidenceDispositions)[number]>();
      for (const disposition of evidenceDispositions) {
        const latest = latestDispositionBySignal.get(disposition.signalId);
        if (!latest || disposition.moveVersion > latest.moveVersion) {
          latestDispositionBySignal.set(disposition.signalId, disposition);
        }
      }
      if (
        [...latestDispositionBySignal.values()].some(
          (disposition) => disposition.availability === "REJECTED",
        )
      ) {
        throw new Error("Rejected evidence cannot re-enter a stored-evidence recompute");
      }

      const signalRows = evidenceSignalIds.length
        ? await tx
            .select({ signal: signals })
            .from(signals)
            .innerJoin(sourceRuns, eq(sourceRuns.id, signals.sourceRunId))
            .where(
              and(eq(sourceRuns.scanRunId, move.scanRunId), inArray(signals.id, evidenceSignalIds)),
            )
        : [];
      if (signalRows.length !== evidenceSignalIds.length) {
        throw new Error("Every recomputed evidence signal must belong to the same stored scan run");
      }
      const signalById = new Map(signalRows.map(({ signal }) => [signal.id, signal]));
      const orderedSignals = evidenceSignalIds.map((id) => signalById.get(id)!);
      const quality = requireDecisionEvidenceQuality({
        action: draftMove.action,
        signalClass: input.draft.signalClass,
        receipts: orderedSignals.map((signal) => ({
          bindingRole: "DECISION_SUPPORT" as const,
          availability: "AVAILABLE" as const,
          verified: true,
          source: signal.source,
          canonicalUrl: signal.canonicalUrl,
        })),
      });
      if (
        draftMove.action !== "WAIT" &&
        quality.independentSourceCount !== input.draft.independentSourceCount
      ) {
        throw new Error("Recomputed source independence does not match the stored evidence");
      }

      const beforeContext = ProjectContextSchema.parse(refreshedBaseContext.context);
      const recomputeContext = input.contextCorrection
        ? ProjectContextSchema.parse(input.contextCorrection)
        : beforeContext;
      if (!recomputeContext.suitableChannels.includes(draftMove.channel)) {
        throw new Error("The recomputed channel does not fit the founder-reviewed context");
      }
      if (!recomputeContext.availableFormats.includes(draftMove.format)) {
        throw new Error("The recomputed format does not fit the founder-reviewed context");
      }
      const currentVersionedMove = versionedMoveFromRecord(move);
      let recomputedVersionedMove = input.draft.versionedMove
        ? VersionedNextMoveSchema.parse(input.draft.versionedMove)
        : null;
      if (recomputedVersionedMove) {
        assertVersionedCoreMatchesDraft(recomputedVersionedMove, draftMove);
      } else if (currentVersionedMove) {
        if (currentVersionedMove.action !== draftMove.action) {
          throw new Error(
            "An action-changing recompute requires a complete versioned decision contract",
          );
        }
        recomputedVersionedMove = reconcileVersionedNextMove({
          move: currentVersionedMove,
          prose: {
            channel: draftMove.channel,
            topic: draftMove.topic,
            angle: draftMove.angle,
            format: draftMove.format,
            hook: draftMove.hook,
            outline: draftMove.outline,
            cta: draftMove.cta,
          },
          validUntil: draftMove.validUntil,
        });
      }
      if (recomputedVersionedMove) {
        assertActionDetailsBoundToStoredEvidence({
          details: recomputedVersionedMove.details,
          evidenceSignalIds,
          storedSignals: orderedSignals.map(evidenceBindingSignal),
        });
      }
      let nextContextVersion = locked.contextVersion;
      if (input.contextCorrection) {
        const corrected = recomputeContext;
        assertContextWhitelist(beforeContext, corrected);
        const existing = await tx
          .select({ version: projectContextVersions.version })
          .from(projectContextVersions)
          .where(eq(projectContextVersions.projectId, locked.project.id));
        const version = existing.reduce((latest, row) => Math.max(latest, row.version), 0) + 1;
        await tx
          .update(projectContextVersions)
          .set({ isCurrent: false })
          .where(eq(projectContextVersions.projectId, locked.project.id));
        const [createdContext] = await tx
          .insert(projectContextVersions)
          .values({
            projectId: locked.project.id,
            version,
            isCurrent: true,
            inferredName: corrected.name,
            category: corrected.category,
            audience: corrected.audience,
            problem: corrected.problem,
            language: corrected.language,
            credibleTopics: corrected.credibleTopics,
            assumptions: corrected.assumptions,
            context: corrected,
            entityType: refreshedBaseContext.entityType,
            contextProvenance: refreshedBaseContext.contextProvenance,
            voiceProfile: refreshedBaseContext.voiceProfile,
            contentCapabilities: refreshedBaseContext.contentCapabilities,
            sourceContentHash: refreshedBaseContext.sourceContentHash,
            promptVersion: "founder-context-correction-v1",
            model: null,
            createdBy: reviewerId,
          })
          .returning();
        if (!createdContext) throw new Error("Could not create the corrected context version");
        nextContextVersion = createdContext;
        await tx
          .update(projects)
          .set({ name: corrected.name, updatedAt: new Date() })
          .where(eq(projects.id, locked.project.id));
      }

      const before = moveSnapshot(move);
      const staleVersion = input.contextCorrection ? move.reviewVersion + 1 : null;
      const nextVersion = move.reviewVersion + (input.contextCorrection ? 2 : 1);
      if (staleVersion) {
        const [staled] = await tx
          .update(nextMoves)
          .set({
            reviewVersion: staleVersion,
            proposalStale: true,
            founderReviewed: false,
            approvedAt: null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(nextMoves.id, move.id),
              eq(nextMoves.reviewVersion, input.expectedVersion),
              eq(nextMoves.state, "DRAFT"),
              eq(nextMoves.proposalStale, false),
            ),
          )
          .returning({ id: nextMoves.id });
        if (!staled) throw new ReviewVersionConflictError();
        const staleAfter = {
          ...before,
          reviewVersion: staleVersion,
          proposalStale: true,
          staleReason: "Founder context correction requires stored-evidence recompute.",
        };
        await tx.insert(nextMoveRevisions).values({
          nextMoveId: move.id,
          contextVersionId: move.projectContextVersionId,
          version: staleVersion,
          changeKind: "CONTEXT_CORRECTION",
          reviewerId,
          reason,
          before: redactRecord(before),
          after: redactRecord(staleAfter),
          promptVersion: move.promptVersion,
          scoreVersion: move.scoreVersion,
          retainedEvidenceIds: [],
        });
      }

      const independentSourceCount =
        draftMove.action === "WAIT" ? 0 : quality.independentSourceCount;
      const [opportunity] = await tx
        .insert(opportunities)
        .values({
          scanRunId: move.scanRunId,
          moveVersion: nextVersion,
          rank: 1,
          actionCandidate: draftMove.action,
          channel: draftMove.channel,
          format: draftMove.format,
          totalScore: (draftMove.priority / 100).toFixed(6),
          scoreComponents: {
            priority: draftMove.priority / 100,
            confidence: draftMove.confidence,
          },
          passesQualityFloor: draftMove.action !== "WAIT",
          rejectionReason:
            draftMove.action === "WAIT"
              ? (confidenceRationale ?? "No stored-evidence candidate passed the quality floor.")
              : null,
          validUntil: new Date(draftMove.validUntil),
          scoreVersion,
        })
        .returning();
      if (!opportunity) throw new Error("Could not persist the recomputed opportunity");

      const now = new Date();
      const [updated] = await tx
        .update(nextMoves)
        .set({
          projectContextVersionId: nextContextVersion.id,
          opportunityId: opportunity.id,
          state: "DRAFT",
          action: draftMove.action,
          channel: draftMove.channel,
          topic: draftMove.topic,
          angle: draftMove.angle,
          format: draftMove.format,
          hook: draftMove.hook,
          outline: draftMove.outline,
          cta: draftMove.cta,
          priority: draftMove.priority,
          confidence: draftMove.confidence.toFixed(5),
          confidenceRationale,
          whyNow,
          signalClass: input.draft.signalClass,
          independentSourceCount,
          saturation: input.draft.saturation,
          limitations,
          founderReviewed: false,
          proposalStale: false,
          promptVersion,
          scoreVersion,
          ...(recomputedVersionedMove
            ? versionedPersistence(recomputedVersionedMove)
            : { validUntil: new Date(draftMove.validUntil) }),
          reviewVersion: nextVersion,
          approvedAt: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(nextMoves.id, move.id),
            eq(nextMoves.reviewVersion, staleVersion ?? input.expectedVersion),
            eq(nextMoves.state, "DRAFT"),
          ),
        )
        .returning();
      if (!updated) throw new ReviewVersionConflictError();

      if (orderedSignals.length) {
        await tx.insert(evidenceReceipts).values(
          orderedSignals.map((signal) => ({
            nextMoveId: move.id,
            moveVersion: nextVersion,
            signalId: signal.id,
            source: signal.source,
            provider: signal.provider,
            canonicalUrl: signal.canonicalUrl,
            title: signal.title,
            publishedAt: signal.publishedAt,
            observedAt: signal.observedAt,
            reason: whyNow,
            bindingRole: "DECISION_SUPPORT" as const,
            verified: false,
            availability: "AVAILABLE" as const,
            reviewedBy: null,
            verifiedAt: null,
          })),
        );
      }

      const after = moveSnapshot(updated);
      await tx.insert(nextMoveRevisions).values({
        nextMoveId: move.id,
        contextVersionId: nextContextVersion.id,
        version: nextVersion,
        changeKind: "STORED_EVIDENCE_RECOMPUTE",
        reviewerId,
        reason,
        before: redactRecord(
          staleVersion ? { ...before, reviewVersion: staleVersion, proposalStale: true } : before,
        ),
        after: redactRecord(after),
        promptVersion,
        scoreVersion,
        retainedEvidenceIds: evidenceSignalIds,
      });
      if (input.contextCorrection) {
        await tx.insert(reviewEvents).values({
          scanRequestId: move.scanRequestId,
          scanRunId: move.scanRunId,
          nextMoveId: move.id,
          action: "CONTEXT_EDITED",
          reviewerId,
          before: redactRecord({
            version: locked.contextVersion.version,
            context: beforeContext,
            proposalVersion: move.reviewVersion,
          }),
          after: redactRecord({
            version: nextContextVersion.version,
            context: nextContextVersion.context,
            staleProposalVersion: staleVersion,
            recomputedProposalVersion: nextVersion,
          }),
          note: reason,
        });
      }
      await tx.insert(reviewEvents).values({
        scanRequestId: move.scanRequestId,
        scanRunId: move.scanRunId,
        nextMoveId: move.id,
        action: "RECOMPUTED_FROM_STORED_EVIDENCE",
        reviewerId,
        before: redactRecord(before),
        after: redactRecord(after),
        note: `${reason} No provider call or model synthesis was performed.`,
      });
      return {
        move: updated,
        contextVersion: nextContextVersion,
        providerCallsMade: 0 as const,
        modelSynthesisPerformed: false as const,
      };
    });
  }

  async approve(input: {
    nextMoveId: string;
    reviewerId: string;
    expectedVersion: number;
    note?: string;
  }) {
    const reviewerId = requiredReviewer(input.reviewerId);
    if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) {
      throw new Error("Approval requires a valid expected move version");
    }
    return this.db.transaction(async (tx) => {
      const [identity] = await tx
        .select()
        .from(nextMoves)
        .where(eq(nextMoves.id, input.nextMoveId))
        .limit(1);
      if (!identity) throw new Error("Next Move was not found");
      await tx.execute(
        sql`SELECT id FROM scan_requests WHERE id = ${identity.scanRequestId} FOR UPDATE`,
      );
      await tx.execute(sql`SELECT id FROM scan_runs WHERE id = ${identity.scanRunId} FOR UPDATE`);
      await tx.execute(sql`SELECT id FROM next_moves WHERE id = ${identity.id} FOR UPDATE`);
      const [locked] = await tx
        .select({
          move: nextMoves,
          requestState: scanRequests.state,
          runState: scanRuns.state,
          contextVersion: projectContextVersions,
        })
        .from(nextMoves)
        .innerJoin(scanRequests, eq(scanRequests.id, nextMoves.scanRequestId))
        .innerJoin(scanRuns, eq(scanRuns.id, nextMoves.scanRunId))
        .innerJoin(
          projectContextVersions,
          eq(projectContextVersions.id, nextMoves.projectContextVersionId),
        )
        .where(eq(nextMoves.id, identity.id))
        .limit(1);
      if (!locked) throw new Error("Next Move was not found");
      const move = locked.move;
      if (move.reviewVersion !== input.expectedVersion) throw new ReviewVersionConflictError();
      if (locked.requestState !== "REVIEW_REQUIRED" || locked.runState !== "REVIEW_REQUIRED") {
        throw new Error("Next Move is no longer in founder review");
      }
      if (move.state !== "DRAFT" || move.proposalStale || move.autoPublish) {
        throw new Error(`Next Move cannot be approved from ${move.state}`);
      }
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${projectReviewLockKey(locked.contextVersion.projectId)}, 0))`,
      );
      await tx.execute(
        sql`SELECT id FROM projects WHERE id = ${locked.contextVersion.projectId} FOR UPDATE`,
      );
      await tx.execute(
        sql`SELECT id FROM project_context_versions WHERE project_id = ${locked.contextVersion.projectId} FOR UPDATE`,
      );
      const [currentContextVersion] = await tx
        .select({ id: projectContextVersions.id })
        .from(projectContextVersions)
        .where(
          and(
            eq(projectContextVersions.id, move.projectContextVersionId),
            eq(projectContextVersions.projectId, locked.contextVersion.projectId),
            eq(projectContextVersions.isCurrent, true),
          ),
        )
        .limit(1);
      if (!currentContextVersion) throw new ReviewVersionConflictError();
      const receipts = await tx
        .select({
          bindingRole: evidenceReceipts.bindingRole,
          availability: evidenceReceipts.availability,
          verified: evidenceReceipts.verified,
          source: evidenceReceipts.source,
          canonicalUrl: evidenceReceipts.canonicalUrl,
          reviewedBy: evidenceReceipts.reviewedBy,
          verifiedAt: evidenceReceipts.verifiedAt,
        })
        .from(evidenceReceipts)
        .where(
          and(
            eq(evidenceReceipts.nextMoveId, move.id),
            eq(evidenceReceipts.moveVersion, move.reviewVersion),
          ),
        );
      requireRenewedEvidenceReview(move.reviewVersion, receipts);
      const evidenceQuality = requireDecisionEvidenceQuality({
        action: move.action,
        signalClass: move.signalClass,
        receipts,
      });

      const now = new Date();
      const [approved] = await tx
        .update(nextMoves)
        .set({
          state: "APPROVED",
          founderReviewed: true,
          ...(move.action === "WAIT"
            ? {}
            : { independentSourceCount: evidenceQuality.independentSourceCount }),
          approvedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(nextMoves.id, move.id),
            eq(nextMoves.reviewVersion, input.expectedVersion),
            eq(nextMoves.state, "DRAFT"),
          ),
        )
        .returning();
      if (!approved) throw new ReviewVersionConflictError();

      await tx.insert(reviewEvents).values({
        scanRequestId: move.scanRequestId,
        scanRunId: move.scanRunId,
        nextMoveId: move.id,
        action: "APPROVED",
        reviewerId,
        before: { state: move.state, founderReviewed: move.founderReviewed },
        after: { state: approved.state, founderReviewed: true },
        note: input.note ? redactSecrets(input.note).slice(0, 4_000) : null,
      });
      return approved;
    });
  }

  async convertToWait(input: {
    nextMoveId: string;
    reviewerId: string;
    expectedVersion: number;
    reason: string;
    validUntil: Date;
  }) {
    const reviewerId = requiredReviewer(input.reviewerId);
    const reason = requiredReason(input.reason);
    return this.db.transaction(async (tx) => {
      const [identity] = await tx
        .select()
        .from(nextMoves)
        .where(eq(nextMoves.id, input.nextMoveId))
        .limit(1);
      if (!identity) throw new Error("Next Move was not found");
      await tx.execute(
        sql`SELECT id FROM scan_requests WHERE id = ${identity.scanRequestId} FOR UPDATE`,
      );
      await tx.execute(sql`SELECT id FROM scan_runs WHERE id = ${identity.scanRunId} FOR UPDATE`);
      await tx.execute(sql`SELECT id FROM next_moves WHERE id = ${identity.id} FOR UPDATE`);
      const [locked] = await tx
        .select({
          move: nextMoves,
          requestState: scanRequests.state,
          runState: scanRuns.state,
          contextVersion: projectContextVersions,
        })
        .from(nextMoves)
        .innerJoin(scanRequests, eq(scanRequests.id, nextMoves.scanRequestId))
        .innerJoin(scanRuns, eq(scanRuns.id, nextMoves.scanRunId))
        .innerJoin(
          projectContextVersions,
          eq(projectContextVersions.id, nextMoves.projectContextVersionId),
        )
        .where(eq(nextMoves.id, identity.id))
        .limit(1);
      if (!locked) throw new Error("Next Move was not found");
      const move = locked.move;
      if (move.reviewVersion !== input.expectedVersion) throw new ReviewVersionConflictError();
      if (
        locked.requestState !== "REVIEW_REQUIRED" ||
        locked.runState !== "REVIEW_REQUIRED" ||
        move.state !== "DRAFT" ||
        move.proposalStale ||
        move.autoPublish
      ) {
        throw new Error("Only a founder review draft can be converted to WAIT");
      }
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${projectReviewLockKey(locked.contextVersion.projectId)}, 0))`,
      );
      await tx.execute(
        sql`SELECT id FROM projects WHERE id = ${locked.contextVersion.projectId} FOR UPDATE`,
      );
      await tx.execute(
        sql`SELECT id FROM project_context_versions WHERE project_id = ${locked.contextVersion.projectId} FOR UPDATE`,
      );
      const [currentContextVersion] = await tx
        .select({ id: projectContextVersions.id })
        .from(projectContextVersions)
        .where(
          and(
            eq(projectContextVersions.id, move.projectContextVersionId),
            eq(projectContextVersions.projectId, locked.contextVersion.projectId),
            eq(projectContextVersions.isCurrent, true),
          ),
        )
        .limit(1);
      if (!currentContextVersion) throw new ReviewVersionConflictError();
      const now = new Date();
      if (Number.isNaN(input.validUntil.getTime()) || input.validUntil <= now) {
        throw new Error("A converted WAIT decision requires a future validity window");
      }
      const currentVersionedMove = versionedMoveFromRecord(move);
      if (!currentVersionedMove) {
        throw new Error("The review draft is missing its versioned decision contract");
      }
      const convertedVersionedMove = convertVersionedNextMoveToWait({
        move: currentVersionedMove,
        reason,
        validUntil: input.validUntil,
      });
      const before = moveSnapshot(move);
      const nextVersion = move.reviewVersion + 1;
      const [updated] = await tx
        .update(nextMoves)
        .set({
          action: convertedVersionedMove.action,
          channel: convertedVersionedMove.channel,
          topic: convertedVersionedMove.topic,
          angle: convertedVersionedMove.angle,
          format: convertedVersionedMove.format,
          hook: convertedVersionedMove.hook,
          outline: convertedVersionedMove.outline,
          cta: convertedVersionedMove.cta,
          priority: convertedVersionedMove.priority,
          confidence: convertedVersionedMove.confidence.toFixed(5),
          whyNow: reason,
          signalClass: "INSUFFICIENT_SIGNAL",
          independentSourceCount: 0,
          saturation: "unknown",
          limitations: [reason],
          ...versionedPersistence(convertedVersionedMove),
          reviewVersion: nextVersion,
          proposalStale: false,
          state: "APPROVED",
          founderReviewed: true,
          approvedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(nextMoves.id, move.id),
            eq(nextMoves.reviewVersion, input.expectedVersion),
            eq(nextMoves.state, "DRAFT"),
          ),
        )
        .returning();
      if (!updated) throw new ReviewVersionConflictError();
      const after = moveSnapshot(updated);
      await tx.insert(nextMoveRevisions).values({
        nextMoveId: move.id,
        contextVersionId: move.projectContextVersionId,
        version: nextVersion,
        changeKind: "CONVERT_TO_WAIT",
        reviewerId,
        reason,
        before: redactRecord(before),
        after: redactRecord(after),
        promptVersion: move.promptVersion,
        scoreVersion: move.scoreVersion,
        retainedEvidenceIds: [],
      });
      await tx.insert(reviewEvents).values({
        scanRequestId: move.scanRequestId,
        scanRunId: move.scanRunId,
        nextMoveId: move.id,
        action: "CONVERTED_TO_WAIT",
        reviewerId,
        before: redactRecord(before),
        after: redactRecord(after),
        note: reason,
      });
      return updated;
    });
  }

  async rejectEvidence(input: {
    evidenceReceiptId: string;
    reviewerId: string;
    expectedVersion: number;
    reason: string;
  }) {
    const reviewerId = requiredReviewer(input.reviewerId);
    const reason = requiredReason(input.reason);
    return this.db.transaction(async (tx) => {
      const [identity] = await tx
        .select({
          receiptId: evidenceReceipts.id,
          nextMoveId: nextMoves.id,
          scanRequestId: nextMoves.scanRequestId,
          scanRunId: nextMoves.scanRunId,
        })
        .from(evidenceReceipts)
        .innerJoin(nextMoves, eq(nextMoves.id, evidenceReceipts.nextMoveId))
        .where(eq(evidenceReceipts.id, input.evidenceReceiptId))
        .limit(1);
      if (!identity) throw new Error("Evidence receipt was not found");
      await tx.execute(
        sql`SELECT id FROM scan_requests WHERE id = ${identity.scanRequestId} FOR UPDATE`,
      );
      await tx.execute(sql`SELECT id FROM scan_runs WHERE id = ${identity.scanRunId} FOR UPDATE`);
      await tx.execute(sql`SELECT id FROM next_moves WHERE id = ${identity.nextMoveId} FOR UPDATE`);
      await tx.execute(
        sql`SELECT id FROM evidence_receipts WHERE id = ${identity.receiptId} FOR UPDATE`,
      );
      const [locked] = await tx
        .select({
          receipt: evidenceReceipts,
          move: nextMoves,
          requestState: scanRequests.state,
          runState: scanRuns.state,
        })
        .from(evidenceReceipts)
        .innerJoin(nextMoves, eq(nextMoves.id, evidenceReceipts.nextMoveId))
        .innerJoin(scanRequests, eq(scanRequests.id, nextMoves.scanRequestId))
        .innerJoin(scanRuns, eq(scanRuns.id, nextMoves.scanRunId))
        .where(eq(evidenceReceipts.id, identity.receiptId))
        .limit(1);
      if (!locked) throw new Error("Evidence receipt was not found");
      const { receipt, move } = locked;
      if (move.reviewVersion !== input.expectedVersion) throw new ReviewVersionConflictError();
      if (
        locked.requestState !== "REVIEW_REQUIRED" ||
        locked.runState !== "REVIEW_REQUIRED" ||
        move.state !== "DRAFT" ||
        receipt.moveVersion !== move.reviewVersion
      ) {
        throw new Error("Evidence can only be rejected from a founder review draft");
      }
      const [updated] = await tx
        .update(evidenceReceipts)
        .set({ availability: "REJECTED", verified: false, verifiedAt: null })
        .where(and(eq(evidenceReceipts.id, receipt.id), eq(evidenceReceipts.nextMoveId, move.id)))
        .returning();
      if (!updated) throw new Error("Could not reject evidence");
      await tx.insert(reviewEvents).values({
        scanRequestId: move.scanRequestId,
        scanRunId: move.scanRunId,
        nextMoveId: move.id,
        action: "EVIDENCE_REJECTED",
        reviewerId,
        before: { evidenceReceiptId: receipt.id, availability: receipt.availability },
        after: { evidenceReceiptId: receipt.id, availability: "REJECTED" },
        note: reason,
      });
      return updated;
    });
  }

  async markFailed(input: {
    scanRequestId: string;
    scanRunId: string;
    reviewerId: string;
    failureCode: string;
    failureMessage: string;
  }) {
    return this.db.transaction(async (tx) => {
      const now = new Date();
      const [request] = await tx
        .update(scanRequests)
        .set({
          state: "FAILED",
          failureCode: input.failureCode,
          failureMessage: redactSecrets(input.failureMessage).slice(0, 500),
          completedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(scanRequests.id, input.scanRequestId),
            inArray(scanRequests.state, ["QUEUED", "RUNNING", "REVIEW_REQUIRED"]),
          ),
        )
        .returning({ id: scanRequests.id });
      if (!request) throw new Error("A delivered or missing scan cannot be marked failed");
      const [run] = await tx
        .update(scanRuns)
        .set({
          state: "FAILED",
          failureCode: input.failureCode,
          failureMessage: redactSecrets(input.failureMessage).slice(0, 500),
          completedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(scanRuns.id, input.scanRunId),
            eq(scanRuns.scanRequestId, input.scanRequestId),
            inArray(scanRuns.state, ["QUEUED", "RUNNING", "REVIEW_REQUIRED"]),
          ),
        )
        .returning({ id: scanRuns.id });
      if (!run) throw new Error("A delivered or missing scan run cannot be marked failed");
      await tx
        .update(nextMoves)
        .set({ state: "REJECTED", updatedAt: now })
        .where(
          and(
            eq(nextMoves.scanRequestId, input.scanRequestId),
            eq(nextMoves.scanRunId, input.scanRunId),
            inArray(nextMoves.state, ["DRAFT", "APPROVED"]),
          ),
        );
      const [event] = await tx
        .insert(reviewEvents)
        .values({
          scanRequestId: input.scanRequestId,
          scanRunId: input.scanRunId,
          action: "MARKED_FAILED",
          reviewerId: input.reviewerId,
          note: redactSecrets(input.failureMessage).slice(0, 4_000),
        })
        .returning();
      return event;
    });
  }
}
