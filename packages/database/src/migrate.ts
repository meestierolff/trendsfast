import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { migrate } from "drizzle-orm/node-postgres/migrator";

import type { TrendsFastDatabase } from "./client";
import { createDatabaseClient } from "./client";
import { loadPinnedProductionDatabaseEnvironment } from "./production-cli-environment";
import {
  assertLiveProductionDatabaseIdentity,
  assertProductionDatabaseTarget,
  type ProductionDatabaseTarget,
} from "./production-target";
import { DATABASE_ROLES } from "./runtime-roles";

export const DEFAULT_MIGRATIONS_FOLDER = fileURLToPath(new URL("../migrations", import.meta.url));

async function migrateDatabase(
  db: TrendsFastDatabase,
  migrationsFolder = DEFAULT_MIGRATIONS_FOLDER,
) {
  await migrate(db, { migrationsFolder });
}

export function migrationTarget(
  environment: Readonly<Record<string, string | undefined>>,
): ProductionDatabaseTarget {
  const connectionString = environment.DIRECT_DATABASE_URL;
  if (!connectionString?.trim()) {
    throw new Error(
      "DIRECT_DATABASE_URL is required for controlled database migrations; the pooled runtime URL is not accepted",
    );
  }
  return assertProductionDatabaseTarget({
    connectionString,
    endpoint: "direct-or-session",
    expectedRole: DATABASE_ROLES.migrator,
    sslCa: environment.DATABASE_SSL_CA,
  });
}

export function migrationConnectionString(
  environment: Readonly<Record<string, string | undefined>>,
): string {
  return migrationTarget(environment).connectionString;
}

async function main() {
  const environment = loadPinnedProductionDatabaseEnvironment("migrate");
  const target = migrationTarget(environment);
  const client = createDatabaseClient({
    connectionString: target.connectionString,
    sslCa: target.sslCa,
    applicationName: "trendsfast_migrate",
  });
  try {
    const identity = await client.pool.query<{ current_database: string; current_user: string }>(
      "select current_user, current_database() as current_database",
    );
    assertLiveProductionDatabaseIdentity(identity.rows[0], target.expectedRole);
    await migrateDatabase(client.db);
    console.info("TrendsFast database migrations applied.");
  } finally {
    await client.close();
  }
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(resolve(entrypoint)).href) {
  try {
    await main();
  } catch {
    console.error(JSON.stringify({ ok: false, error: "DATABASE_MIGRATION_FAILED" }));
    process.exitCode = 1;
  }
}
