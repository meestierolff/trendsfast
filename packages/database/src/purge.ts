import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { loadEnv } from "@trendsfast/config";

import { createDatabaseFromRoleEnv } from "./client";
import { loadCliEnvironment } from "./load-cli-env";
import { createRepositories } from "./repositories/index";

export async function purgeRetainedData() {
  const env = loadEnv();
  if (!env.MANAGED_POLICY_REVISION) {
    throw new Error("Managed retention policy is not configured");
  }
  const client = createDatabaseFromRoleEnv(env, "retention");
  const repositories = createRepositories(client.db);
  try {
    return await repositories.privacy.purgeManaged(env.MANAGED_POLICY_REVISION);
  } finally {
    await client.close();
  }
}

async function main() {
  loadCliEnvironment();
  const result = await purgeRetainedData();
  const summary = {
    cutoff: result.cutoff.toISOString(),
    deletedScanRequests: result.deletedScanRequests,
    deletedDeliveryTokens: result.deletedDeliveryTokens,
    deletedAnalyticsEvents: result.deletedAnalyticsEvents,
    deletedFounderLaunchInterests: result.deletedFounderLaunchInterests,
    remainingExpiredFounderLaunchInterests: result.remainingExpiredFounderLaunchInterests,
    deletedOrphanProjects: result.deletedOrphanProjects,
  };
  if (result.remainingExpiredFounderLaunchInterests > 0) {
    console.error("TrendsFast retention purge stopped with an expired-interest backlog.", summary);
    process.exitCode = 1;
  } else {
    console.info("TrendsFast retention purge completed.", summary);
  }
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(resolve(entrypoint)).href) {
  await main();
}
