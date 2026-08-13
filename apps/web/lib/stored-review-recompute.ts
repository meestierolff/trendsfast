import "server-only";

import { type createRepositories } from "@trendsfast/database";
import {
  decideDeterministically,
  measurementFragment,
  storedSignal,
} from "@trendsfast/orchestration";
import {
  ProjectContextSchema,
  contentCapabilitiesFromNames,
  type ProjectContext,
} from "@trendsfast/schemas";

type Repositories = ReturnType<typeof createRepositories>;

export type FounderContextCorrection = {
  productName: string;
  audience: string;
  problem: string;
  desiredOutcome: string;
  credibleClaims: string[];
  credibleTopics: string[];
  suitableChannels: string[];
  availableFormats: string[];
  assumptions: string[];
};

function correctedContext(
  current: ProjectContext,
  correction: FounderContextCorrection,
): ProjectContext {
  return ProjectContextSchema.parse({
    ...current,
    name: correction.productName,
    audience: correction.audience,
    problem: correction.problem,
    desiredOutcome: correction.desiredOutcome,
    credibleClaims: correction.credibleClaims,
    credibleTopics: correction.credibleTopics,
    suitableChannels: correction.suitableChannels,
    availableFormats: correction.availableFormats,
    assumptions: correction.assumptions,
  });
}

/**
 * Re-runs only the deterministic ranking and quality-floor layers over rows
 * already committed to this exact scan run. This function has no provider or
 * model client and therefore cannot perform external I/O or spend.
 */
export async function recomputeStoredReview(
  repositories: Repositories,
  input: {
    scanPublicId: string;
    nextMoveId: string;
    reviewerId: string;
    expectedVersion: number;
    reason: string;
    contextCorrection?: FounderContextCorrection;
    now?: Date;
  },
) {
  const detail = await repositories.scans.getStatusByPublicId(input.scanPublicId);
  if (!detail?.run || !detail.move || !detail.context) {
    throw new Error("A persisted review draft and context are required for recompute");
  }
  if (detail.move.id !== input.nextMoveId || detail.request.state !== "REVIEW_REQUIRED") {
    throw new Error("The requested move is no longer the current review draft");
  }

  const context = input.contextCorrection
    ? correctedContext(detail.context, input.contextCorrection)
    : ProjectContextSchema.parse(detail.context);
  const [signalRows, snapshotRows, sourceRuns, evidenceHistory, projectProfile] = await Promise.all(
    [
      repositories.scanData.listSignalsForRun(detail.run.id),
      repositories.scanData.listHistoricalMetricSnapshotsForRun(detail.run.id),
      repositories.scanData.listSourceRuns(detail.run.id),
      repositories.reviews.listEvidenceHistory(detail.move.id),
      detail.project
        ? repositories.scanData.getCurrentProjectProfile(detail.project.id)
        : Promise.resolve(null),
    ],
  );
  const latestEvidenceBySignal = new Map<string, (typeof evidenceHistory)[number]>();
  for (const receipt of evidenceHistory) {
    const latest = latestEvidenceBySignal.get(receipt.signalId);
    if (!latest || receipt.moveVersion > latest.moveVersion) {
      latestEvidenceBySignal.set(receipt.signalId, receipt);
    }
  }
  const rejectedSignalIds = new Set(
    [...latestEvidenceBySignal.values()]
      .filter((receipt) => receipt.availability === "REJECTED")
      .map((receipt) => receipt.signalId),
  );
  const eligibleSignalRows = signalRows.filter(({ signal }) => !rejectedSignalIds.has(signal.id));
  const draft = await decideDeterministically({
    context,
    signals: eligibleSignalRows.map(storedSignal),
    snapshots: snapshotRows
      .filter((snapshot) => !rejectedSignalIds.has(snapshot.signalId))
      .map((snapshot) => ({
        signalId: snapshot.signalId,
        observedAt: snapshot.observedAt.toISOString(),
        metrics: snapshot.metrics,
      })),
    measurements: sourceRuns.flatMap((run) => measurementFragment(run.providerPayloadFragment)),
    coverage: Object.fromEntries(sourceRuns.map((run) => [run.source, run.state])),
    ...(detail.request.goal === null ? {} : { objective: detail.request.goal }),
    generationLevel: detail.request.generationLevel,
    ...(detail.request.requestedContentCapabilities !== null
      ? {
          contentCapabilities: contentCapabilitiesFromNames(
            detail.request.requestedContentCapabilities,
          ),
        }
      : projectProfile
        ? { contentCapabilities: projectProfile.contextVersion.contentCapabilities }
        : {}),
    ...(projectProfile ? { voiceProfile: projectProfile.contextVersion.voiceProfile } : {}),
    now: input.now ?? new Date(),
  });
  return repositories.reviews.recomputeFromStoredEvidence({
    nextMoveId: input.nextMoveId,
    reviewerId: input.reviewerId,
    expectedVersion: input.expectedVersion,
    reason: input.reason,
    draft: {
      ...draft,
      limitations: [
        ...new Set([
          ...draft.limitations,
          "Recomputed solely from stored evidence; no new provider readback was performed.",
        ]),
      ],
    },
    ...(input.contextCorrection ? { contextCorrection: context } : {}),
  });
}
