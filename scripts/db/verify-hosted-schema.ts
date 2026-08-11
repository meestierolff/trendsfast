import { readdir } from "node:fs/promises";

import { createDatabaseClient } from "@trendsfast/database";

const EXPECTED_TABLES = [
  "analytics_events",
  "api_auth_admission_buckets",
  "api_key_management_events",
  "api_key_auth_events",
  "api_keys",
  "cluster_members",
  "clusters",
  "delivery_tokens",
  "evidence_receipts",
  "feedback_events",
  "next_moves",
  "opportunities",
  "outcomes",
  "project_context_versions",
  "projects",
  "provider_cost_ledger",
  "provider_verification_records",
  "review_events",
  "scan_requests",
  "scan_runs",
  "signal_metric_snapshots",
  "signals",
  "source_runs",
  "stripe_customers",
  "subscriptions",
] as const;

const EXPECTED_ENUMS = [
  "api_auth_outcome",
  "api_key_environment",
  "api_key_management_action",
  "api_key_status",
  "delivery_status",
  "evidence_availability",
  "evidence_binding_role",
  "feedback_kind",
  "next_move_action",
  "next_move_state",
  "outcome_kind",
  "provider_verification_state",
  "review_action",
  "saturation",
  "scan_origin",
  "scan_state",
  "signal_class",
  "source_run_state",
  "source_slug",
  "subscription_status",
] as const;

const EXPECTED_INDEXES = [
  "api_keys_environment_prefix_uidx",
  "api_key_management_key_occurred_idx",
  "api_key_management_project_occurred_idx",
  "delivery_tokens_hash_uidx",
  "evidence_receipts_move_signal_uidx",
  "next_moves_scan_run_uidx",
  "projects_normalized_url_uidx",
  "provider_cost_scan_ledger_key_uidx",
  "provider_verification_source_completed_idx",
  "provider_verification_state_completed_idx",
  "scan_requests_api_idempotency_uidx",
  "scan_requests_public_id_uidx",
  "scan_runs_one_active_uidx",
  "signals_run_source_source_id_uidx",
  "source_runs_scan_source_provider_uidx",
  "subscriptions_external_uidx",
] as const;

const EXPECTED_CONSTRAINTS = [
  "api_keys_cost_limit_nonnegative_check",
  "api_keys_expiry_after_creation_check",
  "api_keys_rate_limit_positive_check",
  "api_key_management_actor_check",
  "next_moves_never_autopublish_check",
  "provider_cost_currency_check",
  "provider_cost_nonnegative_check",
  "provider_verification_completion_check",
  "provider_verification_cost_check",
  "provider_verification_credential_mode_check",
  "provider_verification_deployment_environment_check",
  "provider_verification_health_status_check",
  "provider_verification_latency_check",
  "provider_verification_production_identity_check",
  "provider_verification_truth_check",
  "scan_requests_api_cost_reservation_nonnegative_check",
  "subscriptions_entitlement_check",
] as const;

function difference(expected: readonly string[], actual: ReadonlySet<string>) {
  return expected.filter((value) => !actual.has(value));
}

function requireDirectUrl() {
  const directUrl = process.env.DIRECT_DATABASE_URL?.trim();
  if (!directUrl) {
    throw new Error(
      "DIRECT_DATABASE_URL is required. Use the direct migration connection, not the pooled runtime URL.",
    );
  }
  return directUrl;
}

async function main() {
  const migrationFiles = (
    await readdir(new URL("../../packages/database/migrations/", import.meta.url))
  )
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort();
  const client = createDatabaseClient({
    connectionString: requireDirectUrl(),
    maxConnections: 1,
    applicationName: "trendsfast-schema-verifier",
    connectionTimeoutMs: 10_000,
    idleTimeoutMs: 5_000,
  });
  const { pool } = client;

  try {
    const [versionResult, tableResult, enumResult, indexResult, constraintResult, migrationResult] =
      await Promise.all([
        pool.query<{ version: string }>("select version() as version"),
        pool.query<{ table_name: string }>(
          "select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name",
        ),
        pool.query<{ enum_name: string }>(
          "select t.typname as enum_name from pg_type t join pg_namespace n on n.oid = t.typnamespace where n.nspname = 'public' and t.typtype = 'e' order by t.typname",
        ),
        pool.query<{ index_name: string }>(
          "select indexname as index_name from pg_indexes where schemaname = 'public' order by indexname",
        ),
        pool.query<{ constraint_name: string }>(
          "select con.conname as constraint_name from pg_constraint con join pg_namespace n on n.oid = con.connamespace where n.nspname = 'public' order by con.conname",
        ),
        pool.query<{ migration_count: string; latest_created_at: string | null }>(
          "select count(*)::text as migration_count, max(created_at)::text as latest_created_at from drizzle.__drizzle_migrations",
        ),
      ]);

    const tables = new Set(tableResult.rows.map((row) => row.table_name));
    const enums = new Set(enumResult.rows.map((row) => row.enum_name));
    const indexes = new Set(indexResult.rows.map((row) => row.index_name));
    const constraints = new Set(constraintResult.rows.map((row) => row.constraint_name));
    const missingTables = difference(EXPECTED_TABLES, tables);
    const missingEnums = difference(EXPECTED_ENUMS, enums);
    const missingIndexes = difference(EXPECTED_INDEXES, indexes);
    const missingConstraints = difference(EXPECTED_CONSTRAINTS, constraints);
    const extraTables = [...tables].filter((table) => !new Set<string>(EXPECTED_TABLES).has(table));
    const strictExtraTables = process.env.STRICT_HOSTED_SCHEMA === "1";
    const migration = migrationResult.rows[0];
    const appliedMigrationCount = Number(migration?.migration_count ?? 0);
    const migrationsMatch = appliedMigrationCount === migrationFiles.length;
    const ok =
      migrationsMatch &&
      missingTables.length === 0 &&
      missingEnums.length === 0 &&
      missingIndexes.length === 0 &&
      missingConstraints.length === 0 &&
      (!strictExtraTables || extraTables.length === 0);
    console.info(
      JSON.stringify(
        {
          ok,
          postgresVersion: versionResult.rows[0]?.version ?? "unknown",
          migration: {
            appliedCount: appliedMigrationCount,
            expectedCount: migrationFiles.length,
            expectedLatestFile: migrationFiles.at(-1) ?? null,
            latestCreatedAt: migration?.latest_created_at ?? null,
            matchesCommittedMigrations: migrationsMatch,
          },
          schema: {
            expectedTables: EXPECTED_TABLES.length,
            actualPublicTables: tables.size,
            missingTables,
            extraTables,
            missingEnums,
            missingIndexes,
            missingConstraints,
          },
          privacy: {
            rowValuesInspected: false,
            secretValuesSelected: false,
          },
        },
        null,
        2,
      ),
    );
    if (!ok) process.exitCode = 1;
  } finally {
    await client.close();
  }
}

await main();
