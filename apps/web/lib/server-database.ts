import "server-only";

import {
  createDatabaseClient,
  createRepositories,
  type DatabaseClient,
} from "@trendsfast/database";
import { loadEnv } from "@trendsfast/config";

const databaseGlobal = globalThis as typeof globalThis & {
  trendsFastDatabase?: DatabaseClient;
};

export function getDatabaseClient(): DatabaseClient {
  if (!databaseGlobal.trendsFastDatabase) {
    const env = loadEnv();
    databaseGlobal.trendsFastDatabase = createDatabaseClient({
      connectionString: env.DATABASE_URL,
      maxConnections: process.env.NODE_ENV === "production" ? 3 : 5,
      applicationName: "trendsfast-web",
    });
  }
  return databaseGlobal.trendsFastDatabase;
}

export function getRepositories() {
  const env = loadEnv();
  return createRepositories(getDatabaseClient().db, {
    ...(env.API_KEY_PEPPER ? { apiKeyPepper: env.API_KEY_PEPPER } : {}),
  });
}
