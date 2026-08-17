import "server-only";

import { getRepositories } from "./server-database";
import {
  projectPublicSourceStatuses,
  type PublicSourceStatusView,
} from "./source-projection-model";
import { deploymentProvenance } from "./deployment-provenance";

export type PublicSourceProjectionState =
  "identity_unavailable" | "lookup_failed" | "lookup_succeeded_empty" | "available";

export type PublicSourceProjection = {
  sources: PublicSourceStatusView[];
  state: PublicSourceProjectionState;
};

/**
 * Returns friendly public labels plus an expandable exact technical record.
 * Database failure deliberately falls back to non-upgraded catalog truth.
 */
export async function loadPublicSourceProjection(): Promise<PublicSourceProjection> {
  const deployment = deploymentProvenance();
  if (
    deployment.deploymentEnvironment !== "production" ||
    !deployment.releaseSha ||
    !deployment.deploymentHost ||
    !deployment.deploymentId
  ) {
    return {
      sources: projectPublicSourceStatuses([], deployment),
      state: "identity_unavailable",
    };
  }
  try {
    const records = await getRepositories().providerVerifications.latestPublicProductionBySource({
      releaseSha: deployment.releaseSha,
      deploymentHost: deployment.deploymentHost,
      deploymentId: deployment.deploymentId,
    });
    return {
      sources: projectPublicSourceStatuses(records, deployment),
      state: records.length === 0 ? "lookup_succeeded_empty" : "available",
    };
  } catch {
    return {
      sources: projectPublicSourceStatuses([], deployment),
      state: "lookup_failed",
    };
  }
}

export async function listPublicSourceStatuses(): Promise<PublicSourceStatusView[]> {
  return (await loadPublicSourceProjection()).sources;
}
