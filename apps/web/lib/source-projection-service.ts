import "server-only";

import { getRepositories } from "./server-database";
import {
  projectPublicSourceStatuses,
  type PublicSourceStatusView,
} from "./source-projection-model";
import { deploymentProvenance } from "./deployment-provenance";

/**
 * Returns friendly public labels plus an expandable exact technical record.
 * Database failure deliberately falls back to non-upgraded catalog truth.
 */
export async function listPublicSourceStatuses(): Promise<PublicSourceStatusView[]> {
  const deployment = deploymentProvenance();
  if (
    deployment.deploymentEnvironment !== "production" ||
    !deployment.releaseSha ||
    !deployment.deploymentHost ||
    !deployment.deploymentId
  ) {
    return projectPublicSourceStatuses([], deployment);
  }
  try {
    const records = await getRepositories().providerVerifications.latestPublicProductionBySource({
      releaseSha: deployment.releaseSha,
      deploymentHost: deployment.deploymentHost,
      deploymentId: deployment.deploymentId,
    });
    return projectPublicSourceStatuses(records, deployment);
  } catch {
    return projectPublicSourceStatuses([], deployment);
  }
}
