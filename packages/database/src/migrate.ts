import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { migrate } from "drizzle-orm/node-postgres/migrator";

import type { TrendsFastDatabase } from "./client";
import { createDatabaseClient } from "./client";
import { loadCliEnvironment } from "./load-cli-env";

export const DEFAULT_MIGRATIONS_FOLDER = fileURLToPath(new URL("../migrations", import.meta.url));

export async function migrateDatabase(
  db: TrendsFastDatabase,
  migrationsFolder = DEFAULT_MIGRATIONS_FOLDER,
) {
  await migrate(db, { migrationsFolder });
}

export function migrationConnectionString(
  environment: Readonly<Record<string, string | undefined>>,
): string {
  const value = environment.DIRECT_DATABASE_URL?.trim();
  if (!value) {
    throw new Error(
      "DIRECT_DATABASE_URL is required for controlled database migrations; the pooled runtime URL is not accepted",
    );
  }
  const parsed = new URL(value);
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error("The migration connection must use PostgreSQL");
  }
  return value;
}

async function main() {
  loadCliEnvironment();
  const client = createDatabaseClient({
    connectionString: migrationConnectionString(process.env),
    ...(process.env.DATABASE_SSL_CA?.trim() ? { sslCa: process.env.DATABASE_SSL_CA.trim() } : {}),
    applicationName: "trendsfast_migrate",
  });
  try {
    await migrateDatabase(client.db);
    console.info("TrendsFast database migrations applied.");
  } finally {
    await client.close();
  }
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(resolve(entrypoint)).href) {
  await main();
}
