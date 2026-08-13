import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";

import { APPLICATION_FUNCTIONS, createDatabaseClient, DATABASE_ROLES } from "@trendsfast/database";

import {
  compareHostedSchemaCatalog,
  readPinned0024HostedSchemaManifest,
} from "./hosted-schema-manifest";

/**
 * Human-readable launch sentinels retained for targeted review tests. The complete, exact
 * table/column/index/FK/CHECK manifest is loaded from the immutable 0024 Drizzle snapshot below.
 */

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
  "managed_runtime_policy",
  "operations_alert_queue",
  "operations_health_checks",
  "operations_reconciliation_runs",
  "next_move_revisions",
  "next_moves",
  "opportunities",
  "outcomes",
  "project_context_versions",
  "project_claims",
  "project_entitlements",
  "project_memberships",
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
  "user_profiles",
] as const;
const SUPABASE_DATA_API_ROLES = ["anon", "authenticated", "service_role"] as const;

const EXPECTED_ENUMS = [
  "api_auth_outcome",
  "app_membership_role",
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
  "generation_level",
  "monitoring_run_state",
  "monitoring_subscription_state",
  "next_move_action",
  "next_move_state",
  "outcome_kind",
  "provider_verification_state",
  "project_claim_outcome",
  "project_entity_type",
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
  "monitoring_runs_retry_idx",
  "monitoring_runs_slot_uidx",
  "monitoring_subscriptions_due_idx",
  "monitoring_subscriptions_project_uidx",
  "monitoring_subscriptions_subscription_uidx",
  "operations_alert_queue_dedupe_uidx",
  "operations_alert_queue_due_idx",
  "operations_alert_queue_event_occurred_idx",
  "operations_reconciliation_period_uidx",
  "operations_reconciliation_state_lease_idx",
  "next_move_revisions_context_created_idx",
  "next_move_revisions_move_version_uidx",
  "next_moves_public_id_uidx",
  "next_moves_scan_run_uidx",
  "next_moves_valid_until_state_idx",
  "opportunities_scan_version_rank_uidx",
  "project_context_one_current_uidx",
  "project_context_project_version_uidx",
  "project_claims_delivery_created_idx",
  "project_claims_delivery_open_uidx",
  "project_claims_expiry_idx",
  "project_claims_project_created_idx",
  "project_claims_secret_hash_uidx",
  "project_memberships_one_owner_uidx",
  "project_memberships_project_user_uidx",
  "project_memberships_user_created_idx",
  "projects_normalized_url_uidx",
  "projects_public_id_uidx",
  "project_entitlements_active_period_idx",
  "project_entitlements_subscription_uidx",
  "provider_cost_scan_ledger_key_uidx",
  "provider_verification_source_completed_idx",
  "provider_verification_state_completed_idx",
  "scan_requests_api_idempotency_uidx",
  "scan_requests_public_id_uidx",
  "scan_requests_project_generation_created_idx",
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
  "user_profiles_auth_user_uidx",
  "user_profiles_email_idx",
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
  "monitoring_runs_failure_shape_check",
  "monitoring_runs_lease_check",
  "monitoring_runs_retry_policy_check",
  "monitoring_subscriptions_interval_check",
  "managed_runtime_policy_api_check",
  "managed_runtime_policy_public_scan_check",
  "managed_runtime_policy_retention_check",
  "managed_runtime_policy_revision_check",
  "managed_runtime_policy_singleton_check",
  "managed_runtime_policy_version_check",
  "operations_alert_queue_attempt_check",
  "operations_alert_queue_dedupe_check",
  "operations_alert_queue_delivery_check",
  "operations_alert_queue_event_check",
  "operations_alert_queue_payload_check",
  "operations_alert_queue_severity_check",
  "operations_alert_queue_state_check",
  "operations_health_checks_failure_check",
  "operations_health_checks_type_check",
  "operations_reconciliation_shape_check",
  "operations_reconciliation_state_check",
  // PostgreSQL truncates identifiers to 63 bytes.
  "next_move_revisions_context_version_id_project_context_versions",
  "next_move_revisions_kind_check",
  "next_move_revisions_next_move_id_next_moves_id_fk",
  "next_move_revisions_reason_check",
  "next_move_revisions_reviewer_check",
  "next_move_revisions_version_check",
  "next_moves_never_autopublish_check",
  "next_moves_decision_contract_shape_check",
  "next_moves_draft_content_check",
  "next_moves_review_version_positive_check",
  "opportunities_move_version_positive_check",
  "project_entitlements_name_check",
  "project_entitlements_period_check",
  "project_claims_consumption_shape_check",
  "project_claims_consumed_by_user_profile_id_user_profiles_id_fk",
  "project_claims_delivery_token_id_delivery_tokens_id_fk",
  "project_claims_expiry_check",
  "project_claims_invalidation_check",
  "project_claims_project_id_projects_id_fk",
  "project_claims_secret_hash_check",
  "project_memberships_project_id_projects_id_fk",
  "project_memberships_user_profile_id_user_profiles_id_fk",
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
  "user_profiles_avatar_url_check",
  "user_profiles_email_normalized_check",
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
  "monitoring_runs.dead_lettered_at",
  "monitoring_runs.failure_disposition",
  "monitoring_runs.max_attempts",
  "monitoring_runs.next_retry_at",
  "monitoring_runs.quarantined_at",
  "monitoring_runs.retry_base_seconds",
  "managed_runtime_policy.revision",
  "managed_runtime_policy.policy_version",
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
  "next_moves.decision_contract_version",
  "next_moves.action_details",
  "next_moves.trend_window",
  "next_moves.breakout_potential",
  "next_moves.generation_level",
  "next_moves.draft_content",
  "opportunities.move_version",
  "project_claims.claim_secret_hash",
  "project_claims.consumption_outcome",
  "project_context_versions.entity_type",
  "project_context_versions.context_provenance",
  "project_context_versions.voice_profile",
  "project_context_versions.content_capabilities",
  "project_memberships.role",
  "scan_requests.generation_level",
  "scan_requests.requested_content_capabilities",
  "scan_requests.public_cost_reservation_usd",
  "user_profiles.auth_user_id",
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
  const snapshot0024 = await readFile(new URL("meta/0024_snapshot.json", migrationsDirectory));
  const expectedCatalog = readPinned0024HostedSchemaManifest(snapshot0024);
  const sentinelGroups = [
    ["tables", EXPECTED_TABLES, expectedCatalog.tables],
    ["columns", EXPECTED_COLUMNS, expectedCatalog.columns],
    ["enums", EXPECTED_ENUMS, expectedCatalog.enums],
    ["indexes", EXPECTED_INDEXES, expectedCatalog.indexes],
    ["constraints", EXPECTED_CONSTRAINTS, expectedCatalog.constraints],
  ] as const;
  for (const [label, sentinels, completeManifest] of sentinelGroups) {
    const absentSentinels = difference(sentinels, new Set<string>(completeManifest));
    if (absentSentinels.length > 0) {
      throw new Error(
        `The committed 0024 snapshot is missing hosted ${label} sentinels: ${absentSentinels.join(", ")}`,
      );
    }
  }
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
    ...(process.env.DATABASE_SSL_CA?.trim() ? { sslCa: process.env.DATABASE_SSL_CA.trim() } : {}),
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
      platformDefaultGrantResult,
      applicationOwnerDriftResult,
      apiPolicyDefaultResult,
    ] = await Promise.all([
      pool.query<{ version: string }>("select version() as version"),
      pool.query<{ table_name: string }>(
        `select relation.relname as table_name
           from pg_catalog.pg_class relation
           join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
          where namespace.nspname = 'public'
            and relation.relkind in ('r', 'p')
          order by relation.relname`,
      ),
      pool.query<{ column_name: string }>(
        `
          select relation.relname || '.' || attribute.attname as column_name
          from pg_catalog.pg_attribute attribute
          join pg_catalog.pg_class relation on relation.oid = attribute.attrelid
          join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
          where namespace.nspname = 'public'
            and relation.relkind in ('r', 'p')
            and attribute.attnum > 0
            and not attribute.attisdropped
          order by relation.relname, attribute.attnum
        `,
      ),
      pool.query<{ enum_name: string }>(
        "select t.typname as enum_name from pg_type t join pg_namespace n on n.oid = t.typnamespace where n.nspname = 'public' and t.typtype = 'e' order by t.typname",
      ),
      pool.query<{ index_name: string }>(
        `
          select index_class.relname as index_name
          from pg_index index_metadata
          join pg_class table_class on table_class.oid = index_metadata.indrelid
          join pg_namespace namespace on namespace.oid = table_class.relnamespace
          join pg_class index_class on index_class.oid = index_metadata.indexrelid
          left join pg_constraint constraint_metadata
            on constraint_metadata.conindid = index_metadata.indexrelid
          where namespace.nspname = 'public'
            and table_class.relkind in ('r', 'p')
            and constraint_metadata.oid is null
          order by index_class.relname
        `,
      ),
      pool.query<{ constraint_name: string }>(
        `
          select constraint_metadata.conname as constraint_name
          from pg_constraint constraint_metadata
          join pg_namespace namespace on namespace.oid = constraint_metadata.connamespace
          where namespace.nspname = 'public'
            and constraint_metadata.contype in ('f', 'c')
          order by constraint_metadata.conname
        `,
      ),
      pool.query<{ id: number; hash: string; created_at: string }>(
        "select id, hash, created_at::text as created_at from drizzle.__drizzle_migrations order by id",
      ),
      pool.query<{ role_name: string }>(
        `
          select r.rolname as role_name
          from pg_roles r
          where r.rolname = any($1::text[])
            and has_schema_privilege(r.oid, 'public', 'USAGE')
          order by r.rolname
        `,
        [SUPABASE_DATA_API_ROLES],
      ),
      pool.query<{ role_name: string; table_name: string }>(
        `
          select r.rolname as role_name, c.relname as table_name
          from pg_roles r
          cross join pg_class c
          join pg_namespace n on n.oid = c.relnamespace
          where r.rolname = any($1::text[])
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
        `,
        [SUPABASE_DATA_API_ROLES],
      ),
      pool.query<{ role_name: string; sequence_name: string }>(
        `
          select r.rolname as role_name, c.relname as sequence_name
          from pg_roles r
          cross join pg_class c
          join pg_namespace n on n.oid = c.relnamespace
          where r.rolname = any($1::text[])
            and n.nspname = 'public'
            and c.relkind = 'S'
            and (
              has_sequence_privilege(r.rolname, format('%I.%I', n.nspname, c.relname), 'USAGE')
              or has_sequence_privilege(r.rolname, format('%I.%I', n.nspname, c.relname), 'SELECT')
              or has_sequence_privilege(r.rolname, format('%I.%I', n.nspname, c.relname), 'UPDATE')
            )
          order by r.rolname, c.relname
        `,
        [SUPABASE_DATA_API_ROLES],
      ),
      pool.query<{ role_name: string; routine_name: string }>(
        `
          select r.rolname as role_name, p.oid::regprocedure::text as routine_name
          from pg_roles r
          cross join pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
          where r.rolname = any($1::text[])
            and n.nspname = 'public'
            and p.proname = any($2::text[])
            and has_function_privilege(r.oid, p.oid, 'EXECUTE')
          order by r.rolname, p.oid::regprocedure::text
        `,
        [SUPABASE_DATA_API_ROLES, APPLICATION_FUNCTIONS.map((record) => record.name)],
      ),
      pool.query<{
        owner_role: string;
        grantee: string;
        object_type: string;
        privilege_type: string;
      }>(
        `with owner as (
           select oid, rolname from pg_roles where rolname = $2
         ), object_types(object_type) as (
           values ('r'::"char"), ('S'::"char"), ('f'::"char")
         ), global_defaults as (
           select owner.rolname as owner_role,
                  object_types.object_type::text as object_type,
                  expanded.grantee,
                  expanded.privilege_type
             from owner
             cross join object_types
             left join pg_default_acl defaults
               on defaults.defaclrole = owner.oid
              and defaults.defaclnamespace = 0
              and defaults.defaclobjtype = object_types.object_type
             cross join lateral aclexplode(
               coalesce(defaults.defaclacl, acldefault(object_types.object_type, owner.oid))
             ) expanded
         ), schema_additions as (
           select owner.rolname as owner_role,
                  defaults.defaclobjtype::text as object_type,
                  expanded.grantee,
                  expanded.privilege_type
             from owner
             join pg_default_acl defaults on defaults.defaclrole = owner.oid
             join pg_namespace namespace
               on namespace.oid = defaults.defaclnamespace
              and namespace.nspname = 'public'
             cross join lateral aclexplode(defaults.defaclacl) expanded
            where defaults.defaclobjtype in ('r', 'S', 'f')
         ), unsafe as (
           select * from global_defaults
           union all
           select * from schema_additions
         )
         select unsafe.owner_role,
                case when unsafe.grantee = 0 then 'PUBLIC' else grantee_role.rolname end as grantee,
                unsafe.object_type,
                unsafe.privilege_type
           from unsafe
           left join pg_roles grantee_role on grantee_role.oid = unsafe.grantee
          where unsafe.grantee = 0 or grantee_role.rolname = any($1::text[])
          order by owner_role, grantee, object_type, privilege_type`,
        [SUPABASE_DATA_API_ROLES, DATABASE_ROLES.migrator],
      ),
      pool.query<{ owner_role: string }>(
        `select owner_role.rolname as owner_role
           from pg_default_acl defaults
           join pg_roles owner_role on owner_role.oid = defaults.defaclrole
           left join pg_namespace namespace on namespace.oid = defaults.defaclnamespace
           cross join lateral aclexplode(defaults.defaclacl) expanded
           left join pg_roles grantee_role on grantee_role.oid = expanded.grantee
          where (defaults.defaclnamespace = 0 or namespace.nspname = 'public')
            and defaults.defaclobjtype in ('r', 'S', 'f')
            and owner_role.rolname <> $2
            and (
              expanded.grantee = 0
              or grantee_role.rolname = any($1::text[])
            )
          order by owner_role.rolname`,
        [SUPABASE_DATA_API_ROLES, DATABASE_ROLES.migrator],
      ),
      pool.query<{ object_type: string; object_name: string; owner_role: string }>(
        `select 'relation'::text as object_type,
                namespace.nspname || '.' || relation.relname as object_name,
                owner.rolname as owner_role
           from pg_class relation
           join pg_namespace namespace on namespace.oid = relation.relnamespace
           join pg_roles owner on owner.oid = relation.relowner
          where relation.relkind in ('r', 'p', 'S', 'v', 'm', 'f', 'i', 'I')
            and namespace.nspname in ('public', 'drizzle')
             and owner.rolname <> $1
          union all
         select 'type'::text,
                namespace.nspname || '.' || type.typname,
                owner.rolname
           from pg_type type
           join pg_namespace namespace on namespace.oid = type.typnamespace
           join pg_roles owner on owner.oid = type.typowner
          where namespace.nspname = 'public'
            and type.typtype = 'e'
             and type.typname = any($2::text[])
             and owner.rolname <> $1
          union all
         select 'function'::text,
                function.oid::regprocedure::text,
                owner.rolname
           from pg_proc function
           join pg_namespace namespace on namespace.oid = function.pronamespace
           join pg_roles owner on owner.oid = function.proowner
          where namespace.nspname = 'public'
             and function.proname = any($3::text[])
             and owner.rolname <> $1
          order by object_type, object_name`,
        [
          DATABASE_ROLES.migrator,
          EXPECTED_ENUMS,
          APPLICATION_FUNCTIONS.map((record) => record.name),
        ],
      ),
      pool.query<{ column_name: string; column_default: string | null }>(`
          select attribute.attname as column_name,
                 case when default_value.oid is null then null
                      else pg_catalog.pg_get_expr(default_value.adbin, default_value.adrelid)
                  end as column_default
            from pg_catalog.pg_attribute attribute
            join pg_catalog.pg_class relation on relation.oid = attribute.attrelid
            join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
            left join pg_catalog.pg_attrdef default_value
              on default_value.adrelid = attribute.attrelid
             and default_value.adnum = attribute.attnum
           where namespace.nspname = 'public'
             and relation.relname = 'api_keys'
             and attribute.attname in ('rate_limit_per_hour', 'provider_cost_limit_usd')
             and attribute.attnum > 0
             and not attribute.attisdropped
           order by attribute.attname
        `),
    ]);

    const actualCatalog = {
      tables: tableResult.rows.map((row) => row.table_name),
      columns: columnResult.rows.map((row) => row.column_name),
      enums: enumResult.rows.map((row) => row.enum_name),
      indexes: indexResult.rows.map((row) => row.index_name),
      constraints: constraintResult.rows.map((row) => row.constraint_name),
    };
    const strictExtras = process.env.STRICT_HOSTED_SCHEMA === "1";
    const schemaDrift = compareHostedSchemaCatalog(expectedCatalog, actualCatalog, strictExtras);
    const apiPolicyColumnsHaveNoDefault =
      apiPolicyDefaultResult.rows.length === 2 &&
      apiPolicyDefaultResult.rows.every((row) => row.column_default === null);
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
      schemaDrift.ok &&
      unsafeSchemaGrantResult.rows.length === 0 &&
      unsafeTableGrantResult.rows.length === 0 &&
      unsafeSequenceGrantResult.rows.length === 0 &&
      unsafeFunctionGrantResult.rows.length === 0 &&
      unsafeDefaultGrantResult.rows.length === 0 &&
      applicationOwnerDriftResult.rows.length === 0 &&
      apiPolicyColumnsHaveNoDefault;
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
            snapshotId: expectedCatalog.snapshotId,
            strictExtras,
            expectedTables: expectedCatalog.tables.length,
            actualPublicTables: actualCatalog.tables.length,
            expectedColumns: expectedCatalog.columns.length,
            actualPublicTableColumns: actualCatalog.columns.length,
            expectedEnums: expectedCatalog.enums.length,
            actualPublicEnums: actualCatalog.enums.length,
            expectedIndexes: expectedCatalog.indexes.length,
            actualPublicExplicitIndexes: actualCatalog.indexes.length,
            expectedForeignKeyAndCheckConstraints: expectedCatalog.constraints.length,
            actualPublicForeignKeyAndCheckConstraints: actualCatalog.constraints.length,
            ...schemaDrift,
            apiPolicyColumnsHaveNoDefault,
            expectedApplicationOwner: DATABASE_ROLES.migrator,
            applicationOwnerDrift: applicationOwnerDriftResult.rows,
          },
          privacy: {
            rowValuesInspected: false,
            secretValuesSelected: false,
            unsafeBrowserRoleSchemaGrants: unsafeSchemaGrantResult.rows,
            unsafeBrowserRoleTableGrants: unsafeTableGrantResult.rows,
            unsafeBrowserRoleSequenceGrants: unsafeSequenceGrantResult.rows,
            unsafeBrowserRoleFunctionGrants: unsafeFunctionGrantResult.rows,
            unsafeBrowserRoleDefaultGrants: unsafeDefaultGrantResult.rows,
            platformManagedDefaultGrants: {
              count: platformDefaultGrantResult.rows.length,
              owners: [...new Set(platformDefaultGrantResult.rows.map((row) => row.owner_role))],
              affectsMigratorOwnedObjects: false,
            },
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
