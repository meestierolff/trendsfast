import "server-only";

import { deliveryTokens, evidenceReceipts, nextMoves, projects } from "@trendsfast/database";
import {
  ActionDetailsSchema,
  BreakoutPotentialSchema,
  GenerationLevelSchema,
  NEXT_MOVE_CONTRACT_VERSION,
  ProjectContextSchema,
  TrendWindowSchema,
  VersionedNextMoveSchema,
  evaluateNextMoveFreshness,
  type ProjectContext,
  type Signal,
} from "@trendsfast/schemas";
import { assertActionDetailsBoundToStoredEvidence, storedSignal } from "@trendsfast/orchestration";

import type { ReadyScanResultView } from "../components/scan-result-view";
import type { ScanStatusView } from "../components/scan-status-poller";
import { analyticsDedupeKey } from "./first-party-analytics";
import { getRepositories } from "./server-database";

type ReadyRecord = {
  token: typeof deliveryTokens.$inferSelect;
  move: typeof nextMoves.$inferSelect;
  context: ProjectContext;
  project: typeof projects.$inferSelect;
  evidence: Array<typeof evidenceReceipts.$inferSelect>;
  signals: Signal[];
};

export type ScanStatusLookup = ScanStatusView | { found: false };
export type CapabilityAnalyticsContext = {
  anonymousSessionHash: string;
  secret: string;
  now?: Date;
};

function plausibleBearer(value: string): boolean {
  return value.length >= 8 && value.length <= 200 && /^[A-Za-z0-9_.-]+$/.test(value);
}

function deliveryAvailable(delivery: typeof deliveryTokens.$inferSelect | null): boolean {
  return Boolean(
    delivery &&
    (delivery.status === "ACTIVE" || delivery.status === "DELIVERED") &&
    delivery.expiresAt > new Date(),
  );
}

function publicFailure(code: string | null): { code: string; message: string } | null {
  if (!code) return null;
  const messages: Record<string, string> = {
    SCAN_DEADLINE_EXCEEDED:
      "The scan reached its bounded processing deadline before a trustworthy move was ready.",
    SCAN_PROCESSING_FAILED:
      "The scan stopped before a trustworthy recommendation could be produced.",
  };
  return {
    code,
    message:
      messages[code] ?? "The scan stopped before a trustworthy recommendation could be produced.",
  };
}

function readyView(record: ReadyRecord): ReadyScanResultView | null {
  if (
    record.move.state !== "READY" ||
    !record.move.founderReviewed ||
    record.move.autoPublish ||
    record.move.proposalStale ||
    !deliveryAvailable(record.token)
  ) {
    return null;
  }
  if (
    record.move.decisionContractVersion !== NEXT_MOVE_CONTRACT_VERSION ||
    record.move.actionDetails === null ||
    record.move.trendWindow === null ||
    record.move.breakoutPotential === null
  ) {
    return null;
  }
  const contract = VersionedNextMoveSchema.safeParse({
    contractVersion: record.move.decisionContractVersion,
    generationLevel: GenerationLevelSchema.safeParse(record.move.generationLevel).data,
    action: record.move.action,
    channel: record.move.channel,
    topic: record.move.topic,
    angle: record.move.angle,
    format: record.move.format,
    hook: record.move.hook,
    outline: record.move.outline,
    cta: record.move.cta,
    priority: record.move.priority,
    confidence: Number(record.move.confidence),
    validUntil: record.move.validUntil.toISOString(),
    trendWindow: TrendWindowSchema.safeParse(record.move.trendWindow).data,
    breakoutPotential: BreakoutPotentialSchema.safeParse(record.move.breakoutPotential).data,
    details: ActionDetailsSchema.safeParse(record.move.actionDetails).data,
    ...(record.move.draftContent === null ? {} : { draftContent: record.move.draftContent }),
  });
  if (!contract.success) return null;
  try {
    assertActionDetailsBoundToStoredEvidence({
      details: contract.data.details,
      evidenceSignalIds: record.evidence
        .filter((receipt) => receipt.bindingRole === "DECISION_SUPPORT")
        .map((receipt) => receipt.signalId),
      storedSignals: record.signals,
    });
  } catch {
    return null;
  }
  const freshness = evaluateNextMoveFreshness({
    validUntil: contract.data.validUntil,
    proposalStale: record.move.proposalStale,
  });
  if (freshness.state !== "CURRENT") return null;
  return {
    tokenId: record.token.id,
    nextMoveId: record.move.publicId,
    contractVersion: contract.data.contractVersion,
    generationLevel: contract.data.generationLevel,
    product: {
      name: record.context.name,
      url: record.project.url,
      audience: record.context.audience,
      problem: record.context.problem,
      credibleTopics: record.context.credibleTopics,
      assumptions: record.context.assumptions,
    },
    move: {
      action: contract.data.action,
      channel: contract.data.channel,
      topic: contract.data.topic,
      angle: contract.data.angle,
      format: contract.data.format,
      hook: contract.data.hook,
      outline: contract.data.outline,
      cta: contract.data.cta,
      priority: contract.data.priority,
      confidence: contract.data.confidence,
      validUntil: contract.data.validUntil,
    },
    actionDetails: contract.data.details,
    trendWindow: contract.data.trendWindow,
    breakoutPotential: contract.data.breakoutPotential,
    ...(contract.data.draftContent === undefined
      ? {}
      : { draftContent: contract.data.draftContent }),
    freshness,
    whyNow: {
      summary: record.move.whyNow,
      signalClass: record.move.signalClass,
      independentSourceCount: record.move.independentSourceCount,
      saturation: record.move.saturation,
    },
    evidence: record.evidence.map((receipt) => ({
      id: receipt.id,
      source: receipt.source,
      url: receipt.canonicalUrl,
      ...(receipt.title === null ? {} : { title: receipt.title }),
      ...(receipt.publishedAt === null ? {} : { publishedAt: receipt.publishedAt }),
      observedAt: receipt.observedAt,
      reason: receipt.reason,
      provider: receipt.provider,
      role: receipt.bindingRole,
      verified: receipt.verified,
      availability: receipt.availability,
    })),
    limitations: record.move.limitations,
    founderReviewed: true,
    autoPublish: false,
  };
}

async function readyRecordByToken(
  token: string,
  markViewed: boolean,
): Promise<{
  record: ReadyRecord;
  scanRequestId: string;
} | null> {
  if (!plausibleBearer(token)) return null;
  const repositories = getRepositories();
  const publicScan = await repositories.scans.getPublicStatusByPublicId(token);
  if (
    publicScan?.move &&
    publicScan.context &&
    publicScan.project &&
    publicScan.delivery &&
    publicScan.request.state === "READY"
  ) {
    const context = ProjectContextSchema.safeParse(publicScan.context);
    if (!context.success) return null;
    const signalRows = await repositories.scanData.listPublicSignalsForRun(
      publicScan.move.scanRunId,
    );
    return {
      scanRequestId: publicScan.request.id,
      record: {
        token: publicScan.delivery,
        move: publicScan.move,
        context: context.data,
        project: publicScan.project,
        evidence: publicScan.evidence,
        signals: signalRows.map(storedSignal),
      },
    };
  }

  const delivered = await repositories.delivery.getResultByToken(token, markViewed);
  if (!delivered) return null;
  const context = ProjectContextSchema.safeParse(delivered.context);
  if (!context.success) return null;
  const signalRows = await repositories.scanData.listPublicSignalsForRun(delivered.move.scanRunId);
  return {
    scanRequestId: delivered.move.scanRequestId,
    record: {
      token: delivered.token,
      move: delivered.move,
      context: context.data,
      project: delivered.project,
      evidence: delivered.evidence,
      signals: signalRows.map(storedSignal),
    },
  };
}

export async function getScanStatusByToken(
  token: string,
  analyticsContext?: CapabilityAnalyticsContext | null,
): Promise<ScanStatusLookup> {
  if (!plausibleBearer(token)) return { found: false };
  const repositories = getRepositories();
  const status = await repositories.scans.getPublicStatusByPublicId(token);
  if (!status) return { found: false };

  const sourceRuns = status.run
    ? await repositories.scanData.listPublicSourceStatesForRun(status.run.id)
    : [];
  const persistedStates = new Map(
    sourceRuns.map((sourceRun) => [sourceRun.source, sourceRun.state]),
  );
  const plannedSources = status.run?.queryPlan
    ? status.run.queryPlan.providers.map((group) => group.source)
    : [];
  const sourcePlan = [...new Set([...plannedSources, ...persistedStates.keys()])].map((name) => ({
    name,
    status: persistedStates.get(name) ?? "PENDING",
  }));
  const context = ProjectContextSchema.safeParse(status.context);
  const strictContract = status.move
    ? VersionedNextMoveSchema.safeParse({
        contractVersion: status.move.decisionContractVersion,
        generationLevel: status.move.generationLevel,
        action: status.move.action,
        channel: status.move.channel,
        topic: status.move.topic,
        angle: status.move.angle,
        format: status.move.format,
        hook: status.move.hook,
        outline: status.move.outline,
        cta: status.move.cta,
        priority: status.move.priority,
        confidence: Number(status.move.confidence),
        validUntil: status.move.validUntil.toISOString(),
        trendWindow: status.move.trendWindow,
        breakoutPotential: status.move.breakoutPotential,
        details: status.move.actionDetails,
        ...(status.move.draftContent === null ? {} : { draftContent: status.move.draftContent }),
      })
    : null;
  let contractIsEvidenceBound = false;
  if (status.move && strictContract?.success) {
    const signalRows = await repositories.scanData.listPublicSignalsForRun(status.move.scanRunId);
    try {
      assertActionDetailsBoundToStoredEvidence({
        details: strictContract.data.details,
        evidenceSignalIds: status.evidence
          .filter((receipt) => receipt.bindingRole === "DECISION_SUPPORT")
          .map((receipt) => receipt.signalId),
        storedSignals: signalRows.map(storedSignal),
      });
      contractIsEvidenceBound = true;
    } catch {
      contractIsEvidenceBound = false;
    }
  }
  const contractIsCurrent =
    status.request.state === "READY" &&
    status.move?.state === "READY" &&
    status.move.founderReviewed &&
    status.move.autoPublish === false &&
    !status.move.proposalStale &&
    strictContract?.success === true &&
    contractIsEvidenceBound &&
    evaluateNextMoveFreshness({ validUntil: strictContract.data.validUntil }).state === "CURRENT";
  const canOpenResult = contractIsCurrent && deliveryAvailable(status.delivery);

  if (analyticsContext) {
    const occurredAt = analyticsContext.now ?? new Date();
    await repositories.analytics
      .appendOnce({
        name: "scan_status_viewed",
        anonymousSessionHash: analyticsContext.anonymousSessionHash,
        scanRequestId: status.request.id,
        ...(status.move ? { nextMoveId: status.move.id } : {}),
        dedupeKey: analyticsDedupeKey({
          secret: analyticsContext.secret,
          sessionHash: analyticsContext.anonymousSessionHash,
          event: "scan_status_viewed",
          entityScope: `scan:${status.request.id}`,
          now: occurredAt,
          windowMs: 24 * 60 * 60 * 1_000,
        }),
        properties: { state: status.request.state },
        occurredAt,
      })
      .catch(() => undefined);
  }

  return {
    found: true,
    state: status.request.state,
    submittedUrl: status.request.submittedUrl,
    ...(context.success ? { inferredProduct: context.data.name } : {}),
    submittedAt: status.request.submittedAt,
    sourcePlan,
    founderReview: true,
    ...(status.request.state === "READY" && !canOpenResult ? { requiresNewScan: true } : {}),
    ...(canOpenResult ? { resultToken: token } : {}),
    ...(status.request.state === "FAILED"
      ? { failure: publicFailure(status.request.failureCode) }
      : {}),
  };
}

export async function getReadyResultByToken(token: string): Promise<ReadyScanResultView | null> {
  const resolved = await readyRecordByToken(token, true);
  if (!resolved) return null;
  const result = readyView(resolved.record);
  if (!result) return null;
  return result;
}

export async function recordEvidenceOpenedByToken(
  token: string,
  evidenceReceiptId: string,
  analyticsContext: CapabilityAnalyticsContext | null,
): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(evidenceReceiptId)) return false;
  const resolved = await readyRecordByToken(token, false);
  if (!resolved || !readyView(resolved.record)) return false;
  const receipt = resolved.record.evidence.find(
    (candidate) =>
      candidate.id === evidenceReceiptId && candidate.nextMoveId === resolved.record.move.id,
  );
  if (!receipt) return false;
  if (!analyticsContext) return true;

  const occurredAt = analyticsContext.now ?? new Date();
  const repositories = getRepositories();
  await repositories.analytics
    .appendOnce({
      name: "evidence_opened",
      anonymousSessionHash: analyticsContext.anonymousSessionHash,
      scanRequestId: resolved.scanRequestId,
      nextMoveId: resolved.record.move.id,
      dedupeKey: analyticsDedupeKey({
        secret: analyticsContext.secret,
        sessionHash: analyticsContext.anonymousSessionHash,
        event: "evidence_opened",
        entityScope: `evidence:${receipt.id}`,
        now: occurredAt,
        windowMs: 24 * 60 * 60 * 1_000,
      }),
      properties: { source: receipt.source },
      occurredAt,
    })
    .catch(() => undefined);
  return true;
}

export async function resolveReadyScanIdentity(token: string): Promise<{
  scanRequestId: string;
  nextMoveId: string;
  deliveryTokenId: string;
  projectId: string;
  deliveryExpiresAt: Date;
} | null> {
  const resolved = await readyRecordByToken(token, false);
  if (!resolved || !readyView(resolved.record)) return null;
  return {
    scanRequestId: resolved.scanRequestId,
    nextMoveId: resolved.record.move.id,
    deliveryTokenId: resolved.record.token.id,
    projectId: resolved.record.project.id,
    deliveryExpiresAt: resolved.record.token.expiresAt,
  };
}
