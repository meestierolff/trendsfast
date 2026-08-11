import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { migrate } from "drizzle-orm/node-postgres/migrator";

import type { TrendsFastDatabase } from "./client";
import { createDatabaseFromEnv } from "./client";
import { loadCliEnvironment } from "./load-cli-env";

export const DEFAULT_MIGRATIONS_FOLDER = fileURLToPath(new URL("../migrations", import.meta.url));

export async function migrateDatabase(
  db: TrendsFastDatabase,
  migrationsFolder = DEFAULT_MIGRATIONS_FOLDER,
) {
  await migrate(db, { migrationsFolder });
}

async function main() {
  loadCliEnvironment();
  const client = createDatabaseFromEnv();
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
