import "server-only";

import { loadEnv } from "@trendsfast/config";
import { type createRepositories } from "@trendsfast/database";
import {
  decideDeterministically,
  measurementFragment,
  storedSignal,
} from "@trendsfast/orchestration";
import {
  ProjectContextSchema,
  contentCapabilitiesFromNames,
  reconcileVersionedNextMove,
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
  const includeHistoricalMetricSnapshots = loadEnv().PROVIDER_CREDENTIAL_MODE === "fixture";
  const [signalRows, snapshotRows, sourceRuns, evidenceHistory, projectProfile] = await Promise.all(
    [
      repositories.scanData.listSignalsForRun(detail.run.id),
      includeHistoricalMetricSnapshots
        ? repositories.scanData.listHistoricalMetricSnapshotsForRun(detail.run.id)
        : Promise.resolve([]),
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
  const succeededSourceRunIds = new Set(
    sourceRuns.filter((run) => run.state === "SUCCEEDED").map((run) => run.id),
  );
  const eligibleSignalRows = signalRows.filter(
    ({ signal, sourceRun }) =>
      sourceRun.state === "SUCCEEDED" &&
      succeededSourceRunIds.has(sourceRun.id) &&
      !rejectedSignalIds.has(signal.id),
  );
  const eligibleSignalIds = new Set(eligibleSignalRows.map(({ signal }) => signal.id));
  const eligibleSourceRuns = sourceRuns.filter((run) => run.state === "SUCCEEDED");
  const draft = await decideDeterministically({
    context,
    signals: eligibleSignalRows.map(storedSignal),
    snapshots: snapshotRows
      .filter(
        (snapshot) =>
          eligibleSignalIds.has(snapshot.signalId) && !rejectedSignalIds.has(snapshot.signalId),
      )
      .map((snapshot) => ({
        signalId: snapshot.signalId,
        observedAt: snapshot.observedAt.toISOString(),
        metrics: snapshot.metrics,
      })),
    measurements: eligibleSourceRuns.flatMap((run) =>
      measurementFragment(run.providerPayloadFragment),
    ),
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
  const currentValidity = new Date(detail.move.validUntil).toISOString();
  const boundedDraft =
    new Date(draft.move.validUntil).getTime() <= new Date(currentValidity).getTime()
      ? draft
      : {
          ...draft,
          move: { ...draft.move, validUntil: currentValidity },
          ...(draft.versionedMove
            ? {
                versionedMove: reconcileVersionedNextMove({
                  move: draft.versionedMove,
                  prose: {
                    channel: draft.versionedMove.channel,
                    topic: draft.versionedMove.topic,
                    angle: draft.versionedMove.angle,
                    format: draft.versionedMove.format,
                    hook: draft.versionedMove.hook,
                    outline: draft.versionedMove.outline,
                    cta: draft.versionedMove.cta,
                  },
                  validUntil: currentValidity,
                }),
              }
            : {}),
        };
  return repositories.reviews.recomputeFromStoredEvidence({
    nextMoveId: input.nextMoveId,
    reviewerId: input.reviewerId,
    expectedVersion: input.expectedVersion,
    reason: input.reason,
    draft: {
      ...boundedDraft,
      limitations: [
        ...new Set([
          ...boundedDraft.limitations,
          "Recomputed solely from stored evidence; no new provider readback was performed.",
        ]),
      ],
    },
    ...(input.contextCorrection ? { contextCorrection: context } : {}),
  });
}
