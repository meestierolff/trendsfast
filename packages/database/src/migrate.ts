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

const CI_INTEGRATION_DATABASE_HOST = "127.0.0.1" as const;
const CI_INTEGRATION_DATABASE_PORT = "5432" as const;
const CI_INTEGRATION_DATABASE_NAME = "trendsfast" as const;
const CI_INTEGRATION_DATABASE_USERS = new Set([
  "trendsfast",
  "trendsfast_managed_operator",
  DATABASE_ROLES.migrator,
]);
const CI_INTEGRATION_AMBIGUOUS_DATABASE_VALUES = [
  "AUTH_DATABASE_URL",
  "BILLING_DATABASE_URL",
  "DATABASE_SSL_CA",
  "MEMBER_DATABASE_URL",
  "OPS_DATABASE_URL",
  "RETENTION_DATABASE_URL",
  "ROLE_ADMIN_DATABASE_URL",
  "WORKER_DATABASE_URL",
] as const;
const CI_INTEGRATION_URL_SHAPE =
  /^postgresql:\/\/[a-z_]+:[^\s@/?#]+@127\.0\.0\.1:5432\/trendsfast$/u;

type CiIntegrationMigrationTarget = {
  readonly mode: "ci-integration";
  readonly connectionString: string;
  readonly expectedDatabase: typeof CI_INTEGRATION_DATABASE_NAME;
  readonly expectedRole: string;
  readonly sslCa: undefined;
};

export type MigrationTarget =
  ({ readonly mode: "production" } & ProductionDatabaseTarget) | CiIntegrationMigrationTarget;

type ProductionMigrationEnvironmentLoader = () => Readonly<Record<string, string>>;

function fail(message: string): never {
  throw new Error(message);
}

function ciIntegrationConnection(input: {
  readonly name: "DATABASE_URL" | "DIRECT_DATABASE_URL";
  readonly value: string | undefined;
}): { readonly connectionString: string; readonly username: string } {
  const { name, value } = input;
  if (!value || value !== value.trim() || !CI_INTEGRATION_URL_SHAPE.test(value)) {
    fail(`${name} must be an exact local CI PostgreSQL URL`);
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return fail(`${name} must be an exact local CI PostgreSQL URL`);
  }
  if (
    url.protocol !== "postgresql:" ||
    url.hostname !== CI_INTEGRATION_DATABASE_HOST ||
    url.port !== CI_INTEGRATION_DATABASE_PORT ||
    url.pathname !== `/${CI_INTEGRATION_DATABASE_NAME}` ||
    url.search ||
    url.hash ||
    !url.username ||
    !url.password ||
    !/^[a-z_]+$/u.test(url.username) ||
    !CI_INTEGRATION_DATABASE_USERS.has(url.username)
  ) {
    fail(`${name} must be an exact local CI PostgreSQL URL`);
  }

  return { connectionString: value, username: url.username };
}

function ciIntegrationMigrationTarget(
  environment: Readonly<Record<string, string | undefined>>,
): CiIntegrationMigrationTarget {
  if (environment.CI !== "true" || environment.RUN_DATABASE_INTEGRATION !== "1") {
    fail("Local database migrations require the exact CI integration gates");
  }
  if (CI_INTEGRATION_AMBIGUOUS_DATABASE_VALUES.some((name) => environment[name] !== undefined)) {
    fail("Local CI database migrations must not carry production database target values");
  }

  const runtime = ciIntegrationConnection({
    name: "DATABASE_URL",
    value: environment.DATABASE_URL,
  });
  const direct = ciIntegrationConnection({
    name: "DIRECT_DATABASE_URL",
    value: environment.DIRECT_DATABASE_URL,
  });
  const runtimeUrl = new URL(runtime.connectionString);
  const directUrl = new URL(direct.connectionString);
  if (
    runtimeUrl.hostname !== directUrl.hostname ||
    runtimeUrl.port !== directUrl.port ||
    runtimeUrl.pathname !== directUrl.pathname
  ) {
    fail("The local CI database URLs must identify one exact database target");
  }
  if (
    direct.username !== runtime.username &&
    !(
      runtime.username === "trendsfast_managed_operator" &&
      direct.username === DATABASE_ROLES.migrator
    )
  ) {
    fail("The local CI database identities do not match an approved migration transition");
  }

  return {
    mode: "ci-integration",
    connectionString: direct.connectionString,
    expectedDatabase: CI_INTEGRATION_DATABASE_NAME,
    expectedRole: direct.username,
    sslCa: undefined,
  };
}

export function resolveMigrationEnvironment(
  ambient: Readonly<Record<string, string | undefined>> = process.env,
  loadProduction: ProductionMigrationEnvironmentLoader = () =>
    loadPinnedProductionDatabaseEnvironment("migrate"),
): Readonly<Record<string, string | undefined>> {
  const hasCiSignal = ambient.CI !== undefined || ambient.RUN_DATABASE_INTEGRATION !== undefined;
  if (hasCiSignal) {
    const target = ciIntegrationMigrationTarget(ambient);
    return Object.freeze({
      CI: "true",
      RUN_DATABASE_INTEGRATION: "1",
      DATABASE_URL: ambient.DATABASE_URL,
      DIRECT_DATABASE_URL: target.connectionString,
    });
  }
  return loadProduction();
}

async function migrateDatabase(
  db: TrendsFastDatabase,
  migrationsFolder = DEFAULT_MIGRATIONS_FOLDER,
) {
  await migrate(db, { migrationsFolder });
}

export function migrationTarget(
  environment: Readonly<Record<string, string | undefined>>,
): MigrationTarget {
  if (environment.CI !== undefined || environment.RUN_DATABASE_INTEGRATION !== undefined) {
    return ciIntegrationMigrationTarget(environment);
  }
  const connectionString = environment.DIRECT_DATABASE_URL;
  if (!connectionString?.trim()) {
    throw new Error(
      "DIRECT_DATABASE_URL is required for controlled database migrations; the pooled runtime URL is not accepted",
    );
  }
  return {
    mode: "production",
    ...assertProductionDatabaseTarget({
      connectionString,
      endpoint: "direct-or-session",
      expectedRole: DATABASE_ROLES.migrator,
      sslCa: environment.DATABASE_SSL_CA,
    }),
  };
}

export function migrationConnectionString(
  environment: Readonly<Record<string, string | undefined>>,
): string {
  return migrationTarget(environment).connectionString;
}

export function assertLiveMigrationIdentity(
  record: { readonly current_database?: unknown; readonly current_user?: unknown } | undefined,
  target: MigrationTarget,
): void {
  if (target.mode === "production") {
    assertLiveProductionDatabaseIdentity(record, target.expectedRole);
    return;
  }
  if (
    record?.current_database !== target.expectedDatabase ||
    record.current_user !== target.expectedRole
  ) {
    fail("The live PostgreSQL identity does not match the local CI migration target");
  }
}

async function main() {
  const environment = resolveMigrationEnvironment();
  const target = migrationTarget(environment);
  const client = createDatabaseClient({
    connectionString: target.connectionString,
    ...(target.sslCa ? { sslCa: target.sslCa } : {}),
    applicationName: "trendsfast_migrate",
  });
  try {
    const identity = await client.pool.query<{ current_database: string; current_user: string }>(
      "select current_user, current_database() as current_database",
    );
    assertLiveMigrationIdentity(identity.rows[0], target);
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
