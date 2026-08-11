import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { loadEnv } from "@trendsfast/config";

import { createDatabaseFromEnv } from "./client";
import { loadCliEnvironment } from "./load-cli-env";
import { createRepositories } from "./repositories/index";

export async function purgeRetainedData(now = new Date()) {
  const env = loadEnv();
  const client = createDatabaseFromEnv(env);
  try {
    return await createRepositories(client.db).privacy.purgeExpired(now, env.SCAN_RETENTION_DAYS);
  } finally {
    await client.close();
  }
}

async function main() {
  loadCliEnvironment();
  const result = await purgeRetainedData();
  console.info("TrendsFast retention purge completed.", {
    cutoff: result.cutoff.toISOString(),
    deletedScanRequests: result.deletedScanRequests,
    deletedDeliveryTokens: result.deletedDeliveryTokens,
    deletedAnalyticsEvents: result.deletedAnalyticsEvents,
    deletedOrphanProjects: result.deletedOrphanProjects,
  });
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(resolve(entrypoint)).href) {
  await main();
}
