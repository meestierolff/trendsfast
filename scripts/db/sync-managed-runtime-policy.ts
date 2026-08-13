import { lstat } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  createDatabaseClient,
  loadCliEnvironment,
  parseCliEnvironmentFile,
  secureDatabasePoolConfig,
  type PoolClient,
} from "@trendsfast/database";

const REVISION_PATTERN = /^[A-Za-z0-9_-]{32,200}$/;
const POSITIVE_DECIMAL_PATTERN = /^(?:0|[1-9][0-9]{0,5})(?:\.[0-9]{1,6})?$/;
const MAX_POSTGRES_INTEGER = 2_147_483_647;
const MAX_POLICY_FILE_BYTES = 64 * 1_024;

export const MANAGED_POLICY_VARIABLES = Object.freeze([
  "MANAGED_POLICY_REVISION",
  "PUBLIC_SCAN_DAILY_LIMIT",
  "PUBLIC_SCAN_GLOBAL_DAILY_LIMIT",
  "PUBLIC_SCAN_GLOBAL_DAILY_BUDGET_USD",
  "API_CREATE_RATE_LIMIT_PER_HOUR",
  "API_STATUS_RATE_LIMIT_PER_HOUR",
  "API_AUTH_FAILURE_LIMIT_PER_HOUR",
  "MAX_PROVIDER_COST_USD_PER_SCAN",
  "API_PROVIDER_COST_LIMIT_USD_PER_HOUR",
  "SCAN_RETENTION_DAYS",
] as const);

type ManagedPolicyVariable = (typeof MANAGED_POLICY_VARIABLES)[number];

export type ManagedRuntimePolicyInput = {
  revision: string;
  publicScanDailyLimit: number;
  publicScanGlobalDailyLimit: number;
  publicScanGlobalDailyBudgetUsd: string;
  apiCreateRateLimitPerHour: number;
  apiStatusRateLimitPerHour: number;
  apiAuthFailureLimitPerHour: number;
  maxProviderCostUsdPerScan: string;
  apiProviderCostLimitUsdPerHour: string;
  scanRetentionDays: number;
};

function requiredValue(
  environment: Readonly<Record<string, string | undefined>>,
  variable: ManagedPolicyVariable | "DIRECT_DATABASE_URL" | "DATABASE_SSL_CA",
): string {
  const value = environment[variable]?.trim();
  if (!value) throw new Error(`${variable} is required`);
  return value;
}

function positiveInteger(
  environment: Readonly<Record<string, string | undefined>>,
  variable: ManagedPolicyVariable,
  maximum = MAX_POSTGRES_INTEGER,
): number {
  const value = requiredValue(environment, variable);
  if (!/^[1-9][0-9]*$/.test(value)) {
    throw new Error(`${variable} must be a positive integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) {
    throw new Error(`${variable} is outside its allowed range`);
  }
  return parsed;
}

function positiveDatabaseDecimal(
  environment: Readonly<Record<string, string | undefined>>,
  variable: ManagedPolicyVariable,
): string {
  const value = requiredValue(environment, variable);
  if (!POSITIVE_DECIMAL_PATTERN.test(value) || Number(value) <= 0) {
    throw new Error(`${variable} must be a positive numeric(12,6) value`);
  }
  return value;
}

export function parseManagedRuntimePolicy(
  environment: Readonly<Record<string, string | undefined>>,
): ManagedRuntimePolicyInput {
  const revision = requiredValue(environment, "MANAGED_POLICY_REVISION");
  if (!REVISION_PATTERN.test(revision)) {
    throw new Error("MANAGED_POLICY_REVISION must be 32-200 characters from [A-Za-z0-9_-]");
  }

  return {
    revision,
    publicScanDailyLimit: positiveInteger(environment, "PUBLIC_SCAN_DAILY_LIMIT"),
    publicScanGlobalDailyLimit: positiveInteger(environment, "PUBLIC_SCAN_GLOBAL_DAILY_LIMIT"),
    publicScanGlobalDailyBudgetUsd: positiveDatabaseDecimal(
      environment,
      "PUBLIC_SCAN_GLOBAL_DAILY_BUDGET_USD",
    ),
    apiCreateRateLimitPerHour: positiveInteger(environment, "API_CREATE_RATE_LIMIT_PER_HOUR"),
    apiStatusRateLimitPerHour: positiveInteger(environment, "API_STATUS_RATE_LIMIT_PER_HOUR"),
    apiAuthFailureLimitPerHour: positiveInteger(environment, "API_AUTH_FAILURE_LIMIT_PER_HOUR"),
    maxProviderCostUsdPerScan: positiveDatabaseDecimal(
      environment,
      "MAX_PROVIDER_COST_USD_PER_SCAN",
    ),
    apiProviderCostLimitUsdPerHour: positiveDatabaseDecimal(
      environment,
      "API_PROVIDER_COST_LIMIT_USD_PER_HOUR",
    ),
    scanRetentionDays: positiveInteger(environment, "SCAN_RETENTION_DAYS", 365),
  };
}

export async function validatedManagedPolicyFilePath(
  environment: Readonly<Record<string, string | undefined>>,
  cwd = process.cwd(),
): Promise<string | null> {
  const configuredPath = environment.MANAGED_POLICY_FILE?.trim();
  if (!configuredPath) return null;

  const absolutePath = resolve(cwd, configuredPath);
  const metadata = await lstat(absolutePath);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error("MANAGED_POLICY_FILE must be a regular file");
  }
  if ((metadata.mode & 0o777) !== 0o600) {
    throw new Error("MANAGED_POLICY_FILE must have mode 0600");
  }
  if (metadata.size > MAX_POLICY_FILE_BYTES) {
    throw new Error("MANAGED_POLICY_FILE exceeds the bounded file size");
  }
  return absolutePath;
}

export function managedPolicyDatabaseConnection(
  environment: Readonly<Record<string, string | undefined>>,
): { connectionString: string; sslCa: string } {
  const connectionString = requiredValue(environment, "DIRECT_DATABASE_URL");
  const sslCa = requiredValue(environment, "DATABASE_SSL_CA");
  const secure = secureDatabasePoolConfig({ connectionString, sslCa });
  if (secure.ssl === false) {
    throw new Error("Managed policy synchronization requires verified TLS");
  }
  return { connectionString, sslCa };
}

/** An explicitly selected 0600 file is the complete authority for policy values. */
export async function resolveManagedRuntimePolicy(
  environment: Readonly<Record<string, string | undefined>>,
  cwd = process.cwd(),
): Promise<ManagedRuntimePolicyInput> {
  const policyPath = await validatedManagedPolicyFilePath(environment, cwd);
  if (!policyPath) return parseManagedRuntimePolicy(environment);

  const parsed = parseCliEnvironmentFile(policyPath);
  const fileEnvironment = Object.fromEntries(
    MANAGED_POLICY_VARIABLES.map((variable) => [variable, parsed[variable]]),
  );
  return parseManagedRuntimePolicy(fileEnvironment);
}

export const MANAGED_RUNTIME_POLICY_UPSERT_SQL = `INSERT INTO public.managed_runtime_policy (
  id,
  revision,
  public_scan_daily_limit,
  public_scan_global_daily_limit,
  public_scan_global_daily_budget_usd,
  api_create_rate_limit_per_hour,
  api_status_rate_limit_per_hour,
  api_auth_failure_limit_per_hour,
  max_provider_cost_usd_per_scan,
  api_provider_cost_limit_usd_per_hour,
  scan_retention_days,
  policy_version,
  updated_at
) VALUES (
  true, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 1,
  pg_catalog.statement_timestamp()
)
ON CONFLICT (id) DO UPDATE SET
  revision = EXCLUDED.revision,
  public_scan_daily_limit = EXCLUDED.public_scan_daily_limit,
  public_scan_global_daily_limit = EXCLUDED.public_scan_global_daily_limit,
  public_scan_global_daily_budget_usd = EXCLUDED.public_scan_global_daily_budget_usd,
  api_create_rate_limit_per_hour = EXCLUDED.api_create_rate_limit_per_hour,
  api_status_rate_limit_per_hour = EXCLUDED.api_status_rate_limit_per_hour,
  api_auth_failure_limit_per_hour = EXCLUDED.api_auth_failure_limit_per_hour,
  max_provider_cost_usd_per_scan = EXCLUDED.max_provider_cost_usd_per_scan,
  api_provider_cost_limit_usd_per_hour = EXCLUDED.api_provider_cost_limit_usd_per_hour,
  scan_retention_days = EXCLUDED.scan_retention_days,
  policy_version = CASE
    WHEN public.managed_runtime_policy.revision = EXCLUDED.revision
      THEN public.managed_runtime_policy.policy_version
    ELSE public.managed_runtime_policy.policy_version + 1
  END,
  updated_at = CASE
    WHEN public.managed_runtime_policy.revision = EXCLUDED.revision
      THEN public.managed_runtime_policy.updated_at
    ELSE pg_catalog.statement_timestamp()
  END
WHERE public.managed_runtime_policy.revision <> EXCLUDED.revision
   OR (
     public.managed_runtime_policy.revision = EXCLUDED.revision
     AND public.managed_runtime_policy.public_scan_daily_limit IS NOT DISTINCT FROM EXCLUDED.public_scan_daily_limit
     AND public.managed_runtime_policy.public_scan_global_daily_limit IS NOT DISTINCT FROM EXCLUDED.public_scan_global_daily_limit
     AND public.managed_runtime_policy.public_scan_global_daily_budget_usd IS NOT DISTINCT FROM EXCLUDED.public_scan_global_daily_budget_usd
     AND public.managed_runtime_policy.api_create_rate_limit_per_hour IS NOT DISTINCT FROM EXCLUDED.api_create_rate_limit_per_hour
     AND public.managed_runtime_policy.api_status_rate_limit_per_hour IS NOT DISTINCT FROM EXCLUDED.api_status_rate_limit_per_hour
     AND public.managed_runtime_policy.api_auth_failure_limit_per_hour IS NOT DISTINCT FROM EXCLUDED.api_auth_failure_limit_per_hour
     AND public.managed_runtime_policy.max_provider_cost_usd_per_scan IS NOT DISTINCT FROM EXCLUDED.max_provider_cost_usd_per_scan
     AND public.managed_runtime_policy.api_provider_cost_limit_usd_per_hour IS NOT DISTINCT FROM EXCLUDED.api_provider_cost_limit_usd_per_hour
     AND public.managed_runtime_policy.scan_retention_days IS NOT DISTINCT FROM EXCLUDED.scan_retention_days
   )
RETURNING policy_version`;

export function managedRuntimePolicyParameters(policy: ManagedRuntimePolicyInput): unknown[] {
  return [
    policy.revision,
    policy.publicScanDailyLimit,
    policy.publicScanGlobalDailyLimit,
    policy.publicScanGlobalDailyBudgetUsd,
    policy.apiCreateRateLimitPerHour,
    policy.apiStatusRateLimitPerHour,
    policy.apiAuthFailureLimitPerHour,
    policy.maxProviderCostUsdPerScan,
    policy.apiProviderCostLimitUsdPerHour,
    policy.scanRetentionDays,
  ];
}

async function main(): Promise<void> {
  loadCliEnvironment();
  const policy = await resolveManagedRuntimePolicy(process.env);
  const connection = managedPolicyDatabaseConnection(process.env);
  const database = createDatabaseClient({
    ...connection,
    maxConnections: 1,
    applicationName: "trendsfast-managed-policy-sync",
  });
  let client: PoolClient | undefined;
  let transactionOpen = false;
  try {
    const connectedClient = await database.pool.connect();
    client = connectedClient;
    const tls = await connectedClient.query<{ ssl: boolean }>(
      `select coalesce(
         (select ssl from pg_catalog.pg_stat_ssl where pid = pg_catalog.pg_backend_pid()),
         false
       ) as ssl`,
    );
    if (!tls.rows[0]?.ssl) {
      throw new Error("Managed policy synchronization requires verified TLS");
    }

    await connectedClient.query("BEGIN");
    transactionOpen = true;
    await connectedClient.query("SET LOCAL lock_timeout = '5s'");
    await connectedClient.query("SET LOCAL statement_timeout = '30s'");
    const synchronized = await connectedClient.query(
      MANAGED_RUNTIME_POLICY_UPSERT_SQL,
      managedRuntimePolicyParameters(policy),
    );
    if (synchronized.rowCount !== 1) {
      throw new Error("Managed policy revision is already bound to different values");
    }
    await connectedClient.query("COMMIT");
    transactionOpen = false;
  } catch (error) {
    if (transactionOpen && client) await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client?.release();
    await database.close();
  }
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(resolve(entrypoint)).href) {
  try {
    await main();
  } catch {
    console.error("Managed runtime policy synchronization failed.");
    process.exitCode = 1;
  }
}
