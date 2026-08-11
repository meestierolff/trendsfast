import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool, type PoolConfig } from "pg";

import { loadEnv, type Environment } from "@trendsfast/config";

import { databaseSchema } from "./schema";

export type TrendsFastDatabase = NodePgDatabase<typeof databaseSchema>;

export type DatabaseClient = {
  db: TrendsFastDatabase;
  pool: Pool;
  close: () => Promise<void>;
};

export type CreateDatabaseClientOptions = {
  connectionString: string;
  maxConnections?: number;
  idleTimeoutMs?: number;
  connectionTimeoutMs?: number;
  applicationName?: string;
};

export function createDatabaseClient(options: CreateDatabaseClientOptions): DatabaseClient {
  const poolConfig: PoolConfig = {
    connectionString: options.connectionString,
    max: options.maxConnections ?? 5,
    idleTimeoutMillis: options.idleTimeoutMs ?? 20_000,
    connectionTimeoutMillis: options.connectionTimeoutMs ?? 10_000,
    application_name: options.applicationName ?? "trendsfast",
    allowExitOnIdle: true,
  };
  const pool = new Pool(poolConfig);
  const db = drizzle(pool, { schema: databaseSchema });

  return {
    db,
    pool,
    close: () => pool.end(),
  };
}

export function createDatabaseFromEnv(env: Environment = loadEnv()): DatabaseClient {
  return createDatabaseClient({ connectionString: env.DATABASE_URL });
}
