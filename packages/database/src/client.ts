import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool, type PoolConfig } from "pg";

export type { Pool, PoolClient } from "pg";

import { loadEnv, type Environment } from "@trendsfast/config";

import { databaseSchema } from "./schema";

export type TrendsFastDatabase = NodePgDatabase<typeof databaseSchema>;

export type DatabaseClient = {
  db: TrendsFastDatabase;
  pool: Pool;
  close: () => Promise<void>;
};

export type DatabaseRuntimeRole =
  "public" | "member" | "ops" | "worker" | "billing" | "auth" | "retention";

export type CreateDatabaseClientOptions = {
  connectionString: string;
  /** PEM-encoded CA used to verify a hosted PostgreSQL server certificate. */
  sslCa?: string;
  maxConnections?: number;
  idleTimeoutMs?: number;
  connectionTimeoutMs?: number;
  applicationName?: string;
};

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function normalizedPem(value: string): string {
  const pem = value.includes("\\n") ? value.replaceAll("\\n", "\n") : value;
  if (!pem.includes("-----BEGIN CERTIFICATE-----") || !pem.includes("-----END CERTIFICATE-----")) {
    throw new Error("DATABASE_SSL_CA must contain a PEM-encoded certificate authority");
  }
  return pem;
}

/**
 * Node-postgres lets TLS query parameters replace an explicit `ssl` object.
 * Strip those parameters and supply one verified TLS policy ourselves so a
 * copied `sslmode=require` URL cannot silently disable certificate checks.
 */
export function secureDatabasePoolConfig(input: {
  connectionString: string;
  sslCa?: string;
}): Pick<PoolConfig, "connectionString" | "ssl"> {
  const parsed = new URL(input.connectionString);
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error("The database connection must use PostgreSQL");
  }
  for (const parameter of ["host", "port", "user", "password", "database"]) {
    if (parsed.searchParams.has(parameter)) {
      throw new Error(
        `The database connection must encode ${parameter} in its URL authority/path, not query parameters`,
      );
    }
  }
  const isLoopback = LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase());
  for (const parameter of [
    "ssl",
    "sslmode",
    "sslcert",
    "sslkey",
    "sslrootcert",
    "sslnegotiation",
  ]) {
    parsed.searchParams.delete(parameter);
  }
  if ([...parsed.searchParams.keys()].length > 0) {
    throw new Error(
      "The database connection must not contain unsupported PostgreSQL query parameters",
    );
  }
  if (isLoopback && !input.sslCa?.trim()) {
    return { connectionString: parsed.toString(), ssl: false };
  }
  if (!input.sslCa?.trim()) {
    throw new Error("DATABASE_SSL_CA is required for non-loopback PostgreSQL connections");
  }
  return {
    connectionString: parsed.toString(),
    ssl: {
      ca: normalizedPem(input.sslCa.trim()),
      rejectUnauthorized: true,
      minVersion: "TLSv1.2",
    },
  };
}

export function createDatabaseClient(options: CreateDatabaseClientOptions): DatabaseClient {
  const secureConnection = secureDatabasePoolConfig({
    connectionString: options.connectionString,
    ...(options.sslCa ? { sslCa: options.sslCa } : {}),
  });
  const poolConfig: PoolConfig = {
    ...secureConnection,
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
  return createDatabaseFromRoleEnv(env, "public");
}

export function databaseConnectionStringForRole(
  env: Environment,
  role: DatabaseRuntimeRole,
): string {
  const roleUrl =
    role === "public"
      ? env.DATABASE_URL
      : role === "member"
        ? env.MEMBER_DATABASE_URL
        : role === "ops"
          ? env.OPS_DATABASE_URL
          : role === "worker"
            ? env.WORKER_DATABASE_URL
            : role === "billing"
              ? env.BILLING_DATABASE_URL
              : role === "auth"
                ? env.AUTH_DATABASE_URL
                : env.RETENTION_DATABASE_URL;
  if (roleUrl) return roleUrl;
  const host = new URL(env.DATABASE_URL).hostname.toLowerCase();
  if (LOOPBACK_HOSTS.has(host)) return env.DATABASE_URL;
  throw new Error(`${role.toUpperCase()}_DATABASE_URL is required for hosted role isolation`);
}

export function createDatabaseFromRoleEnv(
  env: Environment = loadEnv(),
  role: DatabaseRuntimeRole = "public",
): DatabaseClient {
  return createDatabaseClient({
    connectionString: databaseConnectionStringForRole(env, role),
    ...(env.DATABASE_SSL_CA ? { sslCa: env.DATABASE_SSL_CA } : {}),
    applicationName: `trendsfast-${role}`,
  });
}
