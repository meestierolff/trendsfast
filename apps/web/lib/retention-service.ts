import "server-only";

import { loadEnv } from "@trendsfast/config";

import { getRetentionRepositories } from "./server-database";

export type RetentionRunSummary = {
  cutoff: string;
  deletedScanRequests: number;
  deletedDeliveryTokens: number;
  deletedAnalyticsEvents: number;
  deletedFounderLaunchInterests: number;
  remainingExpiredFounderLaunchInterests: number;
  deletedOrphanProjects: number;
};

/** Founder-operations retention entrypoint. Returns counts only, never rows. */
export async function runRetentionPurge(): Promise<RetentionRunSummary> {
  const env = loadEnv();
  if (!env.MANAGED_POLICY_REVISION) {
    throw new Error("Managed retention policy is not configured");
  }
  const repositories = getRetentionRepositories();
  const result = await repositories.privacy.purgeManaged(env.MANAGED_POLICY_REVISION);
  return {
    cutoff: result.cutoff.toISOString(),
    deletedScanRequests: result.deletedScanRequests,
    deletedDeliveryTokens: result.deletedDeliveryTokens,
    deletedAnalyticsEvents: result.deletedAnalyticsEvents,
    deletedFounderLaunchInterests: result.deletedFounderLaunchInterests,
    remainingExpiredFounderLaunchInterests: result.remainingExpiredFounderLaunchInterests,
    deletedOrphanProjects: result.deletedOrphanProjects,
  };
}
