import "server-only";

import { getRepositories } from "./server-database";
import {
  projectPublicSourceStatuses,
  type PublicSourceStatusView,
} from "./source-projection-model";

/**
 * Returns friendly public labels plus an expandable exact technical record.
 * Database failure deliberately falls back to non-upgraded catalog truth.
 */
export async function listPublicSourceStatuses(): Promise<PublicSourceStatusView[]> {
  try {
    const records = await getRepositories().providerVerifications.latestProductionBySource();
    return projectPublicSourceStatuses(
      records.map((record) => ({
        ...record,
        deploymentEnvironment:
          record.deploymentEnvironment === "production"
            ? ("production" as const)
            : record.deploymentEnvironment === "preview"
              ? ("preview" as const)
              : ("local" as const),
      })),
    );
  } catch {
    return projectPublicSourceStatuses();
  }
}
