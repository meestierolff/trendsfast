import { getTableName } from "drizzle-orm";

import { databaseSchema } from "./schema";

export const DATABASE_ROLES = {
  migrator: "trendsfast_migrator",
  public: "trendsfast_public_runtime",
  member: "trendsfast_member_runtime",
  ops: "trendsfast_ops_runtime",
  worker: "trendsfast_worker_runtime",
  billing: "trendsfast_billing_runtime",
  auth: "trendsfast_auth_runtime",
  retention: "trendsfast_retention_runtime",
} as const;

export type DatabaseRoleKind = keyof typeof DATABASE_ROLES;
export type RuntimeDatabaseRoleKind = Exclude<DatabaseRoleKind, "migrator">;
export type TablePrivilege = "SELECT" | "INSERT" | "UPDATE" | "DELETE";

export const APPLICATION_TABLES = Object.freeze(
  [...new Set(Object.values(databaseSchema).map((table) => getTableName(table)))].sort(),
);

export const APPLICATION_TYPES = Object.freeze([
  "app_membership_role",
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
]);

export const PUBLIC_PROVIDER_VERIFICATION_FUNCTION = Object.freeze({
  schema: "public",
  name: "trendsfast_public_provider_verifications",
  identityArguments: "text, text, text",
  executeRoles: ["public"] as const,
  volatility: "s" as const,
});

export const RETENTION_PURGE_FUNCTION = Object.freeze({
  schema: "public",
  name: "trendsfast_purge_retained_data",
  identityArguments: "text",
  executeRoles: ["retention"] as const,
  volatility: "v" as const,
  sourceHash: "b70fd04dca410db6ed756707c2181a12bce9d2638e98c957051a6509953e1b2d",
});

export const MANAGED_POLICY_ASSERTION_FUNCTION = Object.freeze({
  schema: "public",
  name: "trendsfast_assert_managed_policy_revision",
  identityArguments: "text",
  executeRoles: ["worker"] as const,
  volatility: "s" as const,
  sourceHash: "fd28f678f9a6dfe330181b6c82c56ab85273a799ae9701fe990ff42f165b0def",
});

export const BACKUP_HEALTH_FUNCTION = Object.freeze({
  schema: "public",
  name: "trendsfast_record_backup_health",
  identityArguments: "boolean, text",
  executeRoles: ["worker"] as const,
  volatility: "v" as const,
  sourceHash: "621c5ee69639ae6479046d1d4b8b6a7f1aa2ca6d614c244057200dcf42a991a8",
});

/** Migration-owned functions whose ownership and EXECUTE ACLs are exact. */
export const APPLICATION_FUNCTIONS = Object.freeze([
  PUBLIC_PROVIDER_VERIFICATION_FUNCTION,
  RETENTION_PURGE_FUNCTION,
  MANAGED_POLICY_ASSERTION_FUNCTION,
  BACKUP_HEALTH_FUNCTION,
]);

/**
 * Canonical pg_proc.prosrc contract for the migration-owned public projection.
 * The verifier hashes this exact body so a post-migration function replacement
 * cannot quietly widen the projection or its target predicate.
 */
export const PUBLIC_PROVIDER_VERIFICATION_FUNCTION_SOURCE = `SELECT DISTINCT ON (record.source)
  record.source::text AS source,
  record.provider::text AS provider,
  record.state::text AS state,
  record.credential_mode::text AS credential_mode,
  record.deployment_environment::text AS deployment_environment,
  record.health_status::text AS health_status,
  record.readback_verified AS readback_verified,
  pg_catalog.jsonb_array_length(record.canonical_urls)::integer AS canonical_url_count,
  record.latency_ms AS latency_ms,
  record.checked_at AS checked_at,
  record.completed_at AS completed_at
FROM public.provider_verification_records AS record
WHERE pg_catalog.length(pg_catalog.btrim(p_release_sha)) BETWEEN 7 AND 100
  AND p_release_sha = pg_catalog.btrim(p_release_sha)
  AND p_release_sha ~ '^[A-Za-z0-9._-]+$'
  AND pg_catalog.length(p_deployment_host) BETWEEN 3 AND 255
  AND p_deployment_host = pg_catalog.lower(pg_catalog.btrim(p_deployment_host))
  AND p_deployment_host ~ '^[a-z0-9][a-z0-9.-]*(?::[0-9]{1,5})?$'
  AND pg_catalog.strpos(p_deployment_host, '..') = 0
  AND pg_catalog.length(pg_catalog.btrim(p_deployment_id)) BETWEEN 1 AND 255
  AND p_deployment_id = pg_catalog.btrim(p_deployment_id)
  AND p_deployment_id ~ '^[A-Za-z0-9._:-]+$'
  AND record.deployment_environment = 'production'
  AND record.release_sha = p_release_sha
  AND record.deployment_host = p_deployment_host
  AND record.deployment_id = p_deployment_id
  AND record.state IN ('VERIFIED', 'DEGRADED', 'FAILED', 'UNCONFIGURED', 'FIXTURE', 'LEGAL_REVIEW')
ORDER BY record.source, record.completed_at DESC NULLS LAST, record.created_at DESC, record.id DESC`;

const PUBLIC_READ_TABLES = [
  "api_auth_admission_buckets",
  "delivery_tokens",
  "evidence_receipts",
  "founder_usage_events",
  "next_moves",
  "project_context_versions",
  "projects",
  "scan_requests",
] as const;

const PUBLIC_INSERT_TABLES = [
  "analytics_events",
  "api_auth_admission_buckets",
  "feedback_events",
  "founder_launch_interest_events",
  "founder_usage_events",
  "outcomes",
  "scan_requests",
] as const;

const MEMBER_READ_TABLES = [
  "evidence_receipts",
  "feedback_events",
  "founder_entitlement_grants",
  "founder_usage_events",
  "next_moves",
  "outcomes",
  "project_claims",
  "project_context_versions",
  "project_entitlements",
  "project_memberships",
  "projects",
  "scan_requests",
  "user_profiles",
] as const;

const MEMBER_INSERT_TABLES = [
  "api_key_management_events",
  "api_keys",
  "founder_usage_events",
  "outcomes",
  "project_claims",
  "project_context_versions",
  "project_memberships",
  "scan_requests",
  "user_profiles",
] as const;

const MEMBER_UPDATE_TABLES = [] as const;

const OPS_READ_TABLES = [
  "analytics_events",
  "api_auth_admission_buckets",
  "api_keys",
  "api_key_management_events",
  "billing_checkout_sessions",
  "clusters",
  "cluster_members",
  "delivery_tokens",
  "evidence_receipts",
  "founder_entitlement_grants",
  "founder_entitlement_grant_events",
  "founder_launch_interests",
  "founder_launch_interest_events",
  "founder_usage_events",
  "monitoring_runs",
  "next_moves",
  "next_move_revisions",
  "opportunities",
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

const OPS_INSERT_TABLES = [
  "analytics_events",
  "api_auth_admission_buckets",
  "api_keys",
  "api_key_management_events",
  "delivery_tokens",
  "evidence_receipts",
  "founder_entitlement_grants",
  "founder_entitlement_grant_events",
  "founder_launch_interest_events",
  "founder_usage_events",
  "next_move_revisions",
  "opportunities",
  "project_context_versions",
  "provider_verification_records",
  "review_events",
  "signal_metric_snapshots",
  "signals",
  "source_runs",
] as const;

const OPS_UPDATE_TABLES = [
  "api_auth_admission_buckets",
  "api_keys",
  "billing_checkout_sessions",
  "delivery_tokens",
  "evidence_receipts",
  "founder_entitlement_grants",
  "founder_launch_interests",
  "monitoring_runs",
  "next_moves",
  "project_context_versions",
  "projects",
  "provider_verification_records",
  "scan_requests",
  "scan_runs",
  "signal_metric_snapshots",
  "signals",
  "source_runs",
] as const;

const WORKER_MUTATION_TABLES = [
  "analytics_events",
  "cluster_members",
  "clusters",
  "evidence_receipts",
  "founder_usage_events",
  "monitoring_runs",
  "monitoring_subscriptions",
  "next_moves",
  "opportunities",
  "operations_alert_queue",
  "operations_reconciliation_runs",
  "project_context_versions",
  "projects",
  "provider_cost_ledger",
  "review_events",
  "scan_requests",
  "scan_runs",
  "signal_metric_snapshots",
  "signals",
  "source_runs",
] as const;

const WORKER_READ_TABLES = [...WORKER_MUTATION_TABLES] as const;

const BILLING_MUTATION_TABLES = [
  "analytics_events",
  "api_key_management_events",
  "api_keys",
  "billing_checkout_sessions",
  "billing_payment_states",
  "billing_webhook_events",
  "monitoring_runs",
  "monitoring_subscriptions",
  "operations_alert_queue",
  "project_entitlements",
  "stripe_customers",
  "subscriptions",
] as const;

const BILLING_READ_TABLES = BILLING_MUTATION_TABLES.filter(
  (table) =>
    ![
      "analytics_events",
      "api_key_management_events",
      "api_keys",
      "monitoring_runs",
      "monitoring_subscriptions",
      "stripe_customers",
    ].includes(table),
);

function tablePrivilegeMap(
  selectTables: readonly string[],
  insertTables: readonly string[] = [],
  mutationTables: readonly string[] = [],
): Readonly<Record<string, readonly TablePrivilege[]>> {
  const result: Record<string, TablePrivilege[]> = {};
  const add = (table: string, privilege: TablePrivilege) => {
    const privileges = (result[table] ??= []);
    if (!privileges.includes(privilege)) privileges.push(privilege);
  };
  for (const table of selectTables) add(table, "SELECT");
  for (const table of insertTables) add(table, "INSERT");
  for (const table of mutationTables) {
    for (const privilege of ["SELECT", "INSERT", "UPDATE"] as const) {
      add(table, privilege);
    }
  }
  return result;
}

function explicitPrivilegeMap(
  groups: ReadonlyArray<readonly [TablePrivilege, readonly string[]]>,
): Readonly<Record<string, readonly TablePrivilege[]>> {
  const result: Record<string, TablePrivilege[]> = {};
  for (const [privilege, tables] of groups) {
    for (const table of tables) {
      const privileges = (result[table] ??= []);
      if (!privileges.includes(privilege)) privileges.push(privilege);
    }
  }
  return result;
}

/**
 * Explicit grants are deliberately closed over the current schema. A newly
 * migrated table receives no runtime access until this post-migration
 * provisioner is reviewed and run again.
 */
export const RUNTIME_TABLE_PRIVILEGES: Readonly<
  Record<RuntimeDatabaseRoleKind, Readonly<Record<string, readonly TablePrivilege[]>>>
> = {
  public: tablePrivilegeMap(PUBLIC_READ_TABLES, PUBLIC_INSERT_TABLES),
  member: explicitPrivilegeMap([
    ["SELECT", MEMBER_READ_TABLES],
    ["INSERT", MEMBER_INSERT_TABLES],
    ["UPDATE", MEMBER_UPDATE_TABLES],
  ]),
  ops: explicitPrivilegeMap([
    ["SELECT", OPS_READ_TABLES],
    ["INSERT", OPS_INSERT_TABLES],
    ["UPDATE", OPS_UPDATE_TABLES],
    ["DELETE", ["founder_launch_interests"]],
  ]),
  worker: explicitPrivilegeMap([
    [
      "SELECT",
      WORKER_READ_TABLES.filter(
        (table) =>
          !["analytics_events", "operations_health_checks", "review_events"].includes(table),
      ),
    ],
    ["INSERT", WORKER_MUTATION_TABLES],
    ["UPDATE", WORKER_MUTATION_TABLES],
  ]),
  billing: explicitPrivilegeMap([
    ["SELECT", BILLING_READ_TABLES],
    ["INSERT", BILLING_MUTATION_TABLES],
    ["UPDATE", BILLING_MUTATION_TABLES],
  ]),
  auth: explicitPrivilegeMap([
    ["SELECT", ["api_auth_admission_buckets"]],
    ["INSERT", ["api_auth_admission_buckets", "api_key_auth_events"]],
  ]),
  retention: {},
};

export const RUNTIME_COLUMN_PRIVILEGES: Readonly<
  Record<
    RuntimeDatabaseRoleKind,
    ReadonlyArray<{
      table: string;
      privilege: "SELECT" | "INSERT" | "UPDATE";
      columns: readonly string[];
    }>
  >
> = {
  public: [
    {
      table: "analytics_events",
      privilege: "SELECT",
      columns: ["id", "name", "anonymous_session_hash", "scan_request_id", "occurred_at"],
    },
    {
      table: "api_auth_admission_buckets",
      privilege: "UPDATE",
      columns: ["window_started_at", "attempts", "updated_at"],
    },
    {
      table: "api_keys",
      privilege: "SELECT",
      columns: [
        "id",
        "project_id",
        "environment",
        "status",
        "provider_cost_limit_usd",
        "expires_at",
        "revoked_at",
      ],
    },
    { table: "api_keys", privilege: "UPDATE", columns: ["last_used_at"] },
    {
      table: "feedback_events",
      privilege: "SELECT",
      columns: ["id", "next_move_id", "delivery_token_id", "kind", "created_at"],
    },
    {
      table: "founder_entitlement_grants",
      privilege: "SELECT",
      columns: ["id", "project_id", "created_at", "expires_at", "revoked_at"],
    },
    {
      table: "project_entitlements",
      privilege: "SELECT",
      columns: ["project_id", "subscription_id", "active", "period_start", "period_end"],
    },
    {
      table: "scan_runs",
      privilege: "SELECT",
      columns: [
        "id",
        "scan_request_id",
        "attempt",
        "query_plan",
        "created_at",
        "estimated_cost_usd",
        "actual_cost_usd",
      ],
    },
    {
      table: "scan_runs",
      privilege: "INSERT",
      columns: ["scan_request_id", "project_context_version_id", "attempt", "state"],
    },
    {
      table: "source_runs",
      privilege: "SELECT",
      columns: ["id", "scan_run_id", "source", "state", "created_at"],
    },
    {
      table: "signals",
      privilege: "SELECT",
      columns: [
        "id",
        "source_run_id",
        "source",
        "source_id",
        "canonical_url",
        "title",
        "text_excerpt",
        "author",
        "published_at",
        "observed_at",
        "language",
        "metrics",
        "query_id",
        "provider",
        "retrieved_at",
        "cached",
      ],
    },
    { table: "subscriptions", privilege: "SELECT", columns: ["id"] },
    {
      table: "delivery_tokens",
      privilege: "UPDATE",
      columns: ["first_viewed_at", "last_viewed_at", "public_share_consent"],
    },
    { table: "founder_usage_events", privilege: "UPDATE", columns: ["scan_request_id"] },
    {
      table: "founder_launch_interests",
      privilege: "SELECT",
      columns: ["id", "email_hash"],
    },
    {
      table: "founder_launch_interests",
      privilege: "INSERT",
      columns: [
        "email",
        "email_hash",
        "consent_version",
        "consented_at",
        "source",
        "expires_at",
        "created_at",
        "updated_at",
      ],
    },
    {
      table: "founder_launch_interests",
      privilege: "UPDATE",
      columns: ["email", "consent_version", "consented_at", "source", "expires_at", "updated_at"],
    },
  ],
  member: [
    {
      table: "analytics_events",
      privilege: "INSERT",
      columns: [
        "name",
        "scan_request_id",
        "next_move_id",
        "dedupe_key",
        "properties",
        "occurred_at",
      ],
    },
    {
      table: "api_keys",
      privilege: "SELECT",
      columns: [
        "id",
        "project_id",
        "name",
        "visible_prefix",
        "scopes",
        "environment",
        "status",
        "rate_limit_per_hour",
        "provider_cost_limit_usd",
        "created_at",
        "last_used_at",
        "expires_at",
        "revoked_at",
      ],
    },
    { table: "api_keys", privilege: "UPDATE", columns: ["status", "revoked_at"] },
    {
      table: "billing_checkout_sessions",
      privilege: "SELECT",
      columns: ["id", "project_id", "issued_api_key_id"],
    },
    {
      table: "billing_checkout_sessions",
      privilege: "UPDATE",
      columns: ["issued_api_key_id", "updated_at"],
    },
    {
      table: "delivery_tokens",
      privilege: "SELECT",
      columns: [
        "id",
        "next_move_id",
        "token_prefix",
        "status",
        "expires_at",
        "delivered_at",
        "created_at",
      ],
    },
    {
      table: "delivery_tokens",
      privilege: "INSERT",
      columns: [
        "next_move_id",
        "token_prefix",
        "token_hash",
        "status",
        "expires_at",
        "delivered_at",
      ],
    },
    {
      table: "evidence_receipts",
      privilege: "UPDATE",
      columns: ["verified", "verified_at", "reviewed_by"],
    },
    { table: "founder_usage_events", privilege: "UPDATE", columns: ["scan_request_id"] },
    {
      table: "monitoring_runs",
      privilege: "SELECT",
      columns: ["scan_request_id", "state"],
    },
    {
      table: "monitoring_runs",
      privilege: "UPDATE",
      columns: ["state", "completed_at", "updated_at"],
    },
    {
      table: "next_moves",
      privilege: "UPDATE",
      columns: [
        "proposal_stale",
        "state",
        "founder_reviewed",
        "independent_source_count",
        "approved_at",
        "delivered_at",
        "updated_at",
      ],
    },
    {
      table: "project_claims",
      privilege: "UPDATE",
      columns: [
        "invalidated_at",
        "consumed_at",
        "consumed_by_user_profile_id",
        "consumption_outcome",
      ],
    },
    { table: "project_context_versions", privilege: "UPDATE", columns: ["is_current"] },
    {
      table: "projects",
      privilege: "INSERT",
      columns: ["public_id", "name", "url", "normalized_url"],
    },
    {
      table: "projects",
      privilege: "UPDATE",
      columns: ["url", "normalized_url", "updated_at"],
    },
    {
      table: "review_events",
      privilege: "INSERT",
      columns: [
        "scan_request_id",
        "scan_run_id",
        "next_move_id",
        "action",
        "reviewer_id",
        "before",
        "after",
        "note",
      ],
    },
    {
      table: "scan_requests",
      privilege: "UPDATE",
      columns: ["state", "failure_code", "failure_message", "completed_at", "updated_at"],
    },
    { table: "subscriptions", privilege: "SELECT", columns: ["id"] },
    {
      table: "scan_runs",
      privilege: "INSERT",
      columns: ["scan_request_id", "project_context_version_id", "attempt", "state"],
    },
    {
      table: "scan_runs",
      privilege: "SELECT",
      columns: ["id", "state", "failure_code"],
    },
    {
      table: "scan_runs",
      privilege: "UPDATE",
      columns: ["state", "failure_code", "failure_message", "completed_at", "updated_at"],
    },
    {
      table: "user_profiles",
      privilege: "UPDATE",
      columns: ["email", "display_name", "avatar_url", "updated_at"],
    },
  ],
  ops: [],
  worker: [
    {
      table: "analytics_events",
      privilege: "SELECT",
      columns: ["id", "name", "scan_request_id", "occurred_at"],
    },
    {
      table: "api_key_auth_events",
      privilege: "SELECT",
      columns: ["outcome", "occurred_at"],
    },
    {
      table: "billing_webhook_events",
      privilege: "SELECT",
      columns: ["state", "received_at"],
    },
    {
      table: "founder_entitlement_grants",
      privilege: "SELECT",
      columns: ["id", "project_id", "created_at", "expires_at", "revoked_at"],
    },
    {
      table: "operations_health_checks",
      privilege: "SELECT",
      columns: ["check_type", "last_succeeded_at", "last_failed_at"],
    },
    {
      table: "project_entitlements",
      privilege: "SELECT",
      columns: ["project_id", "subscription_id", "active", "period_start", "period_end"],
    },
    {
      table: "provider_verification_records",
      privilege: "SELECT",
      columns: ["deployment_environment", "state", "completed_at"],
    },
    { table: "subscriptions", privilege: "SELECT", columns: ["id", "status"] },
  ],
  billing: [
    {
      table: "api_keys",
      privilege: "SELECT",
      columns: [
        "id",
        "project_id",
        "name",
        "visible_prefix",
        "scopes",
        "environment",
        "status",
        "rate_limit_per_hour",
        "provider_cost_limit_usd",
        "expires_at",
      ],
    },
    {
      table: "monitoring_runs",
      privilege: "SELECT",
      columns: ["monitoring_subscription_id", "state"],
    },
    {
      table: "monitoring_subscriptions",
      privilege: "SELECT",
      columns: ["id", "project_id", "next_due_at"],
    },
    { table: "projects", privilege: "SELECT", columns: ["id", "status"] },
    {
      table: "stripe_customers",
      privilege: "SELECT",
      columns: ["id", "project_id", "stripe_customer_id"],
    },
  ],
  auth: [
    {
      table: "api_auth_admission_buckets",
      privilege: "UPDATE",
      columns: ["window_started_at", "attempts", "updated_at"],
    },
    {
      table: "api_keys",
      privilege: "SELECT",
      columns: [
        "id",
        "project_id",
        "visible_prefix",
        "secret_hash",
        "scopes",
        "environment",
        "status",
        "rate_limit_per_hour",
        "provider_cost_limit_usd",
        "expires_at",
        "revoked_at",
      ],
    },
    { table: "api_keys", privilege: "UPDATE", columns: ["last_used_at"] },
    {
      table: "api_key_auth_events",
      privilege: "SELECT",
      columns: [
        "id",
        "api_key_id",
        "outcome",
        "requester_fingerprint_hash",
        "request_id",
        "request_kind",
        "occurred_at",
      ],
    },
    { table: "api_key_auth_events", privilege: "UPDATE", columns: ["outcome"] },
    {
      table: "scan_requests",
      privilege: "SELECT",
      columns: ["id", "api_key_id"],
    },
    {
      table: "scan_runs",
      privilege: "SELECT",
      columns: ["scan_request_id", "estimated_cost_usd", "actual_cost_usd", "created_at"],
    },
  ],
  retention: [],
};

export const PUBLIC_FORBIDDEN_MUTATION_TABLES = Object.freeze([
  "api_keys",
  "api_key_management_events",
  "billing_payment_states",
  "billing_webhook_events",
  "founder_entitlement_grants",
  "founder_entitlement_grant_events",
  "project_entitlements",
  "provider_verification_records",
  "review_events",
]);

export const WORKER_FORBIDDEN_MUTATION_TABLES = Object.freeze([
  "api_keys",
  "api_key_management_events",
  "billing_checkout_sessions",
  "billing_payment_states",
  "billing_webhook_events",
  "founder_entitlement_grants",
  "founder_entitlement_grant_events",
  "operations_health_checks",
  "project_entitlements",
  "provider_verification_records",
  "stripe_customers",
  "subscriptions",
]);

export const BILLING_FORBIDDEN_MUTATION_TABLES = Object.freeze([
  "founder_entitlement_grants",
  "founder_entitlement_grant_events",
  "next_move_revisions",
  "provider_verification_records",
  "review_events",
]);

export const RETENTION_FORBIDDEN_MUTATION_TABLES = Object.freeze([
  "api_key_management_events",
  "api_keys",
  "billing_checkout_sessions",
  "billing_payment_states",
  "billing_webhook_events",
  "founder_entitlement_grants",
  "founder_entitlement_grant_events",
  "next_move_revisions",
  "project_claims",
  "project_memberships",
  "project_entitlements",
  "provider_verification_records",
  "review_events",
  "stripe_customers",
  "subscriptions",
  "user_profiles",
]);
