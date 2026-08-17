import "server-only";

import { redirect } from "next/navigation";
import { cache } from "react";

import {
  VersionedNextMoveSchema,
  ProjectContextSchema,
  evaluateNextMoveFreshness,
} from "@trendsfast/schemas";
import { assertActionDetailsBoundToStoredEvidence, storedSignal } from "@trendsfast/orchestration";

import { getVerifiedAuthSubject, safeDashboardDestination } from "./auth-session";
import { getMemberRepositories, getPublicRepositories } from "./server-database";

const getCachedVerifiedAuthSubject = cache(getVerifiedAuthSubject);

export async function requireDashboardSubject(destination = "/dashboard"): Promise<string> {
  const authUserId = await getCachedVerifiedAuthSubject();
  if (!authUserId) redirect(`/login?next=${safeDashboardDestination(destination)}`);
  return authUserId;
}

export async function listDashboardProjects(authUserId: string) {
  return getMemberRepositories().members.listOwnedProjects(authUserId);
}

export async function resolveDashboardProject(input: {
  authUserId: string;
  requestedProjectId?: string | null;
}) {
  const projects = await listDashboardProjects(input.authUserId);
  const requested = input.requestedProjectId
    ? projects.find((record) => record.project.id === input.requestedProjectId)
    : undefined;
  return { projects, selected: requested ?? projects[0] ?? null };
}

export async function getDashboardProject(input: { authUserId: string; projectId: string }) {
  const dashboard = await getMemberRepositories().members.getProjectDashboard(input);
  if (!dashboard?.latest) return dashboard ? { ...dashboard, signals: [] } : null;
  const signalRows = await getPublicRepositories().scanData.listPublicSignalsForRun(
    dashboard.latest.move.scanRunId,
  );
  return { ...dashboard, signals: signalRows.map(storedSignal) };
}

export async function getDashboardHistory(input: { authUserId: string; projectId: string }) {
  return getMemberRepositories().members.listProjectHistory(input);
}

export function parseDashboardMove(
  dashboard: NonNullable<Awaited<ReturnType<typeof getDashboardProject>>>,
  now = new Date(),
) {
  if (!dashboard.latest) return null;
  const { move, request } = dashboard.latest;
  const contract = VersionedNextMoveSchema.safeParse({
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
  if (!contract.success) return null;
  try {
    assertActionDetailsBoundToStoredEvidence({
      details: contract.data.details,
      evidenceSignalIds: dashboard.evidence
        .filter((receipt) => receipt.bindingRole === "DECISION_SUPPORT")
        .map((receipt) => receipt.signalId),
      storedSignals: dashboard.signals,
    });
  } catch {
    return null;
  }
  return {
    move,
    request,
    versionedMove: contract.data,
    contractVersion: contract.data.contractVersion,
    generationLevel: contract.data.generationLevel,
    details: contract.data.details,
    trendWindow: contract.data.trendWindow,
    breakoutPotential: contract.data.breakoutPotential,
    ...(contract.data.draftContent === undefined
      ? {}
      : { draftContent: contract.data.draftContent }),
    freshness: evaluateNextMoveFreshness({
      validUntil: move.validUntil,
      proposalStale: move.proposalStale,
      now,
    }),
    evidence: dashboard.evidence,
  };
}

export function parseDashboardContext(
  dashboard: NonNullable<Awaited<ReturnType<typeof getDashboardProject>>>,
) {
  if (!dashboard.context) return null;
  const context = ProjectContextSchema.safeParse(dashboard.context.context);
  return context.success
    ? {
        record: dashboard.context,
        context: context.data,
      }
    : null;
}
