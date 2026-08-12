import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";

import { createDatabaseClient } from "@trendsfast/database";

const EXPECTED_TABLES = [
  "analytics_events",
  "api_auth_admission_buckets",
  "api_key_management_events",
  "api_key_auth_events",
  "api_keys",
  "billing_checkout_sessions",
  "billing_payment_states",
  "billing_webhook_events",
  "cluster_members",
  "clusters",
  "delivery_tokens",
  "evidence_receipts",
  "feedback_events",
  "founder_launch_interest_events",
  "founder_launch_interests",
  "founder_entitlement_grant_events",
  "founder_entitlement_grants",
  "founder_usage_events",
  "monitoring_runs",
  "monitoring_subscriptions",
  "next_move_revisions",
  "next_moves",
  "opportunities",
  "outcomes",
  "project_context_versions",
  "project_entitlements",
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
  "billing_checkout_state",
  "billing_payment_state",
  "billing_webhook_state",
  "delivery_status",
  "evidence_availability",
  "evidence_binding_role",
  "feedback_kind",
  "founder_usage_kind",
  "monitoring_run_state",
  "monitoring_subscription_state",
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
  "analytics_events_dedupe_uidx",
  "api_keys_environment_prefix_uidx",
  "api_key_management_key_occurred_idx",
  "api_key_management_project_occurred_idx",
  "billing_checkout_external_uidx",
  "billing_checkout_claim_hash_uidx",
  "billing_checkout_issued_api_key_uidx",
  "billing_checkout_project_open_uidx",
  "billing_checkout_project_state_idx",
  "billing_checkout_subscription_idx",
  "billing_payment_customer_idx",
  "billing_payment_last_event_uidx",
  "billing_webhook_state_received_idx",
  "billing_webhook_type_created_idx",
  "clusters_scan_dedupe_uidx",
  "delivery_tokens_hash_uidx",
  "delivery_tokens_prefix_uidx",
  "evidence_receipts_move_version_signal_uidx",
  "feedback_events_delivery_token_uidx",
  "founder_launch_interest_events_action_idx",
  "founder_launch_interest_events_reference_idx",
  "founder_launch_interests_email_hash_uidx",
  "founder_launch_interests_expires_idx",
  "founder_usage_idempotency_uidx",
  "founder_usage_project_kind_occurred_idx",
  "founder_usage_scan_kind_idx",
  "founder_entitlement_grant_events_grant_occurred_idx",
  "founder_entitlement_grant_events_project_occurred_idx",
  "founder_entitlement_grants_active_idx",
  "founder_entitlement_grants_one_open_project_uidx",
  "founder_usage_grant_idx",
  "api_key_auth_events_key_kind_occurred_idx",
  "monitoring_runs_idempotency_uidx",
  "monitoring_runs_lease_idx",
  "monitoring_runs_one_open_uidx",
  "monitoring_runs_project_state_idx",
  "monitoring_runs_slot_uidx",
  "monitoring_subscriptions_due_idx",
  "monitoring_subscriptions_project_uidx",
  "monitoring_subscriptions_subscription_uidx",
  "next_move_revisions_context_created_idx",
  "next_move_revisions_move_version_uidx",
  "next_moves_public_id_uidx",
  "next_moves_scan_run_uidx",
  "opportunities_scan_version_rank_uidx",
  "project_context_one_current_uidx",
  "project_context_project_version_uidx",
  "projects_normalized_url_uidx",
  "projects_public_id_uidx",
  "project_entitlements_active_period_idx",
  "project_entitlements_subscription_uidx",
  "provider_cost_scan_ledger_key_uidx",
  "provider_verification_source_completed_idx",
  "provider_verification_state_completed_idx",
  "scan_requests_api_idempotency_uidx",
  "scan_requests_public_id_uidx",
  "scan_runs_one_active_uidx",
  "scan_runs_request_attempt_uidx",
  "signals_run_source_source_id_uidx",
  "source_runs_scan_source_provider_uidx",
  "stripe_customers_project_uidx",
  "stripe_customers_external_uidx",
  "subscriptions_customer_status_idx",
  "subscriptions_last_event_uidx",
  "subscriptions_project_nonterminal_uidx",
  "subscriptions_project_status_idx",
  "subscriptions_external_uidx",
] as const;

const EXPECTED_CONSTRAINTS = [
  "analytics_events_dedupe_key_check",
  "analytics_events_name_check",
  "analytics_events_session_hash_check",
  "api_keys_cost_limit_nonnegative_check",
  "api_keys_expiry_after_creation_check",
  "api_keys_rate_limit_positive_check",
  "api_key_management_actor_check",
  "billing_checkout_actor_check",
  "billing_checkout_binding_check",
  "billing_checkout_claim_consumption_check",
  "billing_checkout_claim_shape_check",
  "billing_checkout_sessions_issued_api_key_id_api_keys_id_fk",
  "billing_checkout_completion_check",
  "billing_checkout_expiration_check",
  "billing_payment_event_rank_check",
  "billing_payment_period_check",
  "billing_webhook_completion_check",
  "billing_webhook_payload_hash_check",
  "evidence_receipts_move_version_positive_check",
  "evidence_receipts_verified_review_identity_check",
  "evidence_receipts_verified_timestamp_check",
  "founder_launch_interest_events_action_check",
  "founder_launch_interests_consent_version_check",
  "founder_launch_interests_email_hash_check",
  "founder_launch_interests_email_normalized_check",
  "founder_launch_interests_expiry_check",
  "founder_launch_interests_source_check",
  "founder_usage_occurrence_period_check",
  "founder_entitlement_grant_events_action_check",
  "founder_entitlement_grant_events_actor_check",
  "founder_entitlement_grants_duration_check",
  "founder_entitlement_grants_issuer_check",
  "founder_entitlement_grants_revocation_check",
  "founder_entitlement_grants_source_reason_check",
  "founder_usage_entitlement_source_check",
  "founder_usage_period_check",
  "monitoring_runs_attempt_check",
  "monitoring_runs_completion_check",
  "monitoring_runs_lease_check",
  "monitoring_subscriptions_interval_check",
  // PostgreSQL truncates identifiers to 63 bytes.
  "next_move_revisions_context_version_id_project_context_versions",
  "next_move_revisions_kind_check",
  "next_move_revisions_next_move_id_next_moves_id_fk",
  "next_move_revisions_reason_check",
  "next_move_revisions_reviewer_check",
  "next_move_revisions_version_check",
  "next_moves_never_autopublish_check",
  "next_moves_review_version_positive_check",
  "opportunities_move_version_positive_check",
  "project_entitlements_name_check",
  "project_entitlements_period_check",
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
  "scan_requests_public_cost_reservation_nonnegative_check",
  "api_key_auth_events_request_kind_check",
  "subscriptions_event_rank_nonnegative_check",
  "subscriptions_entitlement_check",
] as const;

const EXPECTED_COLUMNS = [
  "api_key_auth_events.request_kind",
  "billing_checkout_sessions.checkout_claim_consumed_at",
  "billing_checkout_sessions.checkout_claim_expires_at",
  "billing_checkout_sessions.checkout_claim_hash",
  "billing_checkout_sessions.expires_at",
  "billing_checkout_sessions.issued_api_key_id",
  "billing_checkout_sessions.requested_stripe_customer_id",
  "billing_payment_states.period_end",
  "billing_payment_states.period_start",
  "evidence_receipts.move_version",
  "founder_usage_events.founder_grant_id",
  "next_move_revisions.after",
  "next_move_revisions.before",
  "next_move_revisions.change_kind",
  "next_move_revisions.context_version_id",
  "next_move_revisions.created_at",
  "next_move_revisions.id",
  "next_move_revisions.next_move_id",
  "next_move_revisions.prompt_version",
  "next_move_revisions.reason",
  "next_move_revisions.retained_evidence_ids",
  "next_move_revisions.reviewer_id",
  "next_move_revisions.score_version",
  "next_move_revisions.version",
  "next_moves.proposal_stale",
  "next_moves.review_version",
  "opportunities.move_version",
  "scan_requests.public_cost_reservation_usd",
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
  const migrationsDirectory = new URL("../../packages/database/migrations/", import.meta.url);
  const migrationFiles = (await readdir(migrationsDirectory))
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort();
  const journal = JSON.parse(
    await readFile(new URL("meta/_journal.json", migrationsDirectory), "utf8"),
  ) as { entries?: Array<{ tag?: unknown; when?: unknown }> };
  const expectedMigrations = await Promise.all(
    (journal.entries ?? []).map(async (entry) => {
      if (typeof entry.tag !== "string" || typeof entry.when !== "number") {
        throw new Error("The committed Drizzle migration journal is malformed.");
      }
      const file = `${entry.tag}.sql`;
      const sql = await readFile(new URL(file, migrationsDirectory), "utf8");
      return {
        file,
        createdAt: String(entry.when),
        hash: createHash("sha256").update(sql).digest("hex"),
      };
    }),
  );
  if (
    expectedMigrations.length !== migrationFiles.length ||
    expectedMigrations.some((migration, index) => migration.file !== migrationFiles[index])
  ) {
    throw new Error("Migration SQL files do not exactly match the committed Drizzle journal.");
  }
  const client = createDatabaseClient({
    connectionString: requireDirectUrl(),
    maxConnections: 1,
    applicationName: "trendsfast-schema-verifier",
    connectionTimeoutMs: 10_000,
    idleTimeoutMs: 5_000,
  });
  const { pool } = client;

  try {
    const [
      versionResult,
      tableResult,
      columnResult,
      enumResult,
      indexResult,
      constraintResult,
      migrationResult,
      unsafeSchemaGrantResult,
      unsafeTableGrantResult,
      unsafeSequenceGrantResult,
      unsafeFunctionGrantResult,
      unsafeDefaultGrantResult,
    ] = await Promise.all([
      pool.query<{ version: string }>("select version() as version"),
      pool.query<{ table_name: string }>(
        "select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name",
      ),
      pool.query<{ column_name: string }>(
        "select table_name || '.' || column_name as column_name from information_schema.columns where table_schema = 'public' order by table_name, ordinal_position",
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
      pool.query<{ id: number; hash: string; created_at: string }>(
        "select id, hash, created_at::text as created_at from drizzle.__drizzle_migrations order by id",
      ),
      pool.query<{ role_name: string }>(`
          select r.rolname as role_name
          from pg_roles r
          where r.rolname in ('anon', 'authenticated')
            and has_schema_privilege(r.oid, 'public', 'USAGE')
          order by r.rolname
        `),
      pool.query<{ role_name: string; table_name: string }>(`
          select r.rolname as role_name, c.relname as table_name
          from pg_roles r
          cross join pg_class c
          join pg_namespace n on n.oid = c.relnamespace
          where r.rolname in ('anon', 'authenticated')
            and n.nspname = 'public'
            and c.relkind in ('r', 'p', 'v', 'm', 'f')
            and (
              has_table_privilege(r.rolname, format('%I.%I', n.nspname, c.relname), 'SELECT')
              or has_table_privilege(r.rolname, format('%I.%I', n.nspname, c.relname), 'INSERT')
              or has_table_privilege(r.rolname, format('%I.%I', n.nspname, c.relname), 'UPDATE')
              or has_table_privilege(r.rolname, format('%I.%I', n.nspname, c.relname), 'DELETE')
              or has_table_privilege(r.rolname, format('%I.%I', n.nspname, c.relname), 'TRUNCATE')
              or has_table_privilege(r.rolname, format('%I.%I', n.nspname, c.relname), 'REFERENCES')
              or has_table_privilege(r.rolname, format('%I.%I', n.nspname, c.relname), 'TRIGGER')
            )
          order by r.rolname, c.relname
        `),
      pool.query<{ role_name: string; sequence_name: string }>(`
          select r.rolname as role_name, c.relname as sequence_name
          from pg_roles r
          cross join pg_class c
          join pg_namespace n on n.oid = c.relnamespace
          where r.rolname in ('anon', 'authenticated')
            and n.nspname = 'public'
            and c.relkind = 'S'
            and (
              has_sequence_privilege(r.rolname, format('%I.%I', n.nspname, c.relname), 'USAGE')
              or has_sequence_privilege(r.rolname, format('%I.%I', n.nspname, c.relname), 'SELECT')
              or has_sequence_privilege(r.rolname, format('%I.%I', n.nspname, c.relname), 'UPDATE')
            )
          order by r.rolname, c.relname
        `),
      pool.query<{ role_name: string; routine_name: string }>(`
          select r.rolname as role_name, p.oid::regprocedure::text as routine_name
          from pg_roles r
          cross join pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
          where r.rolname in ('anon', 'authenticated')
            and n.nspname = 'public'
            and has_function_privilege(r.oid, p.oid, 'EXECUTE')
          order by r.rolname, p.oid::regprocedure::text
        `),
      pool.query<{
        owner_role: string;
        grantee: string;
        object_type: string;
        privilege_type: string;
      }>(`
          select
            owner_role.rolname as owner_role,
            case when expanded.grantee = 0 then 'PUBLIC' else grantee_role.rolname end as grantee,
            defaults.defaclobjtype::text as object_type,
            expanded.privilege_type
          from pg_default_acl defaults
          join pg_roles owner_role on owner_role.oid = defaults.defaclrole
          left join pg_namespace namespace on namespace.oid = defaults.defaclnamespace
          cross join lateral aclexplode(defaults.defaclacl) expanded
          left join pg_roles grantee_role on grantee_role.oid = expanded.grantee
          where (defaults.defaclnamespace = 0 or namespace.nspname = 'public')
            and defaults.defaclobjtype in ('r', 'S', 'f')
            and (
              expanded.grantee = 0
              or grantee_role.rolname in ('anon', 'authenticated')
            )
          order by owner_role.rolname, grantee, object_type, expanded.privilege_type
        `),
    ]);

    const tables = new Set(tableResult.rows.map((row) => row.table_name));
    const columns = new Set(columnResult.rows.map((row) => row.column_name));
    const enums = new Set(enumResult.rows.map((row) => row.enum_name));
    const indexes = new Set(indexResult.rows.map((row) => row.index_name));
    const constraints = new Set(constraintResult.rows.map((row) => row.constraint_name));
    const missingTables = difference(EXPECTED_TABLES, tables);
    const missingColumns = difference(EXPECTED_COLUMNS, columns);
    const missingEnums = difference(EXPECTED_ENUMS, enums);
    const missingIndexes = difference(EXPECTED_INDEXES, indexes);
    const missingConstraints = difference(EXPECTED_CONSTRAINTS, constraints);
    const extraTables = [...tables].filter((table) => !new Set<string>(EXPECTED_TABLES).has(table));
    const strictExtraTables = process.env.STRICT_HOSTED_SCHEMA === "1";
    const appliedMigrations = migrationResult.rows;
    const migrationComparisons = expectedMigrations.map((expected, index) => {
      const applied = appliedMigrations[index];
      return {
        file: expected.file,
        applied: applied !== undefined,
        hashMatches: applied?.hash === expected.hash,
        createdAtMatches: applied?.created_at === expected.createdAt,
      };
    });
    const migrationsMatch =
      appliedMigrations.length === expectedMigrations.length &&
      migrationComparisons.every(
        (migration) => migration.applied && migration.hashMatches && migration.createdAtMatches,
      );
    const ok =
      migrationsMatch &&
      missingTables.length === 0 &&
      missingColumns.length === 0 &&
      missingEnums.length === 0 &&
      missingIndexes.length === 0 &&
      missingConstraints.length === 0 &&
      unsafeSchemaGrantResult.rows.length === 0 &&
      unsafeTableGrantResult.rows.length === 0 &&
      unsafeSequenceGrantResult.rows.length === 0 &&
      unsafeFunctionGrantResult.rows.length === 0 &&
      unsafeDefaultGrantResult.rows.length === 0 &&
      (!strictExtraTables || extraTables.length === 0);
    console.info(
      JSON.stringify(
        {
          ok,
          postgresVersion: versionResult.rows[0]?.version ?? "unknown",
          migration: {
            appliedCount: appliedMigrations.length,
            expectedCount: expectedMigrations.length,
            expectedLatestFile: migrationFiles.at(-1) ?? null,
            matchesCommittedMigrations: migrationsMatch,
            mismatches: migrationComparisons.filter(
              (migration) =>
                !migration.applied || !migration.hashMatches || !migration.createdAtMatches,
            ),
          },
          schema: {
            expectedTables: EXPECTED_TABLES.length,
            actualPublicTables: tables.size,
            missingTables,
            missingColumns,
            extraTables,
            missingEnums,
            missingIndexes,
            missingConstraints,
          },
          privacy: {
            rowValuesInspected: false,
            secretValuesSelected: false,
            unsafeBrowserRoleSchemaGrants: unsafeSchemaGrantResult.rows,
            unsafeBrowserRoleTableGrants: unsafeTableGrantResult.rows,
            unsafeBrowserRoleSequenceGrants: unsafeSequenceGrantResult.rows,
            unsafeBrowserRoleFunctionGrants: unsafeFunctionGrantResult.rows,
            unsafeBrowserRoleDefaultGrants: unsafeDefaultGrantResult.rows,
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
