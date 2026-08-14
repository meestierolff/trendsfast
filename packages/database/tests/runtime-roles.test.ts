import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  APPLICATION_FUNCTIONS,
  APPLICATION_TABLES,
  APPLICATION_TYPES,
  BILLING_FORBIDDEN_MUTATION_TABLES,
  DATABASE_ROLES,
  PUBLIC_PROVIDER_VERIFICATION_FUNCTION_SOURCE,
  PUBLIC_FORBIDDEN_MUTATION_TABLES,
  RETENTION_PURGE_FUNCTION,
  RETENTION_FORBIDDEN_MUTATION_TABLES,
  RUNTIME_COLUMN_PRIVILEGES,
  RUNTIME_TABLE_PRIVILEGES,
  WORKER_FORBIDDEN_MUTATION_TABLES,
} from "../src/index";

describe("hosted least-privilege database roles", () => {
  it("uses fixed, non-overlapping login identities", () => {
    expect(new Set(Object.values(DATABASE_ROLES)).size).toBe(8);
    expect(Object.values(DATABASE_ROLES)).toEqual(
      expect.arrayContaining([
        "trendsfast_migrator",
        "trendsfast_public_runtime",
        "trendsfast_member_runtime",
        "trendsfast_ops_runtime",
        "trendsfast_worker_runtime",
        "trendsfast_billing_runtime",
        "trendsfast_auth_runtime",
        "trendsfast_retention_runtime",
      ]),
    );
  });

  it("closes runtime grants over every current application table", () => {
    expect(APPLICATION_TABLES).toContain("managed_runtime_policy");
    for (const grants of Object.values(RUNTIME_TABLE_PRIVILEGES)) {
      expect(
        Object.keys(grants).every((table) => new Set<string>(APPLICATION_TABLES).has(table)),
      ).toBe(true);
    }
  });

  it("limits ownership work to the explicit application tables and types", () => {
    expect(APPLICATION_TYPES).toContain("scan_state");
    expect(APPLICATION_TYPES).toEqual(
      expect.arrayContaining([
        "app_membership_role",
        "generation_level",
        "project_claim_outcome",
        "project_entity_type",
      ]),
    );
    const provisioner = readFileSync(
      fileURLToPath(new URL("../../../scripts/db/provision-runtime-roles.ts", import.meta.url)),
      "utf8",
    );
    expect(provisioner).toContain("c.relname = any($2::text[])");
    expect(provisioner).toContain("t.typname = any($2::text[])");
    expect(provisioner).toContain("owner.rolname <> $1");
    expect(provisioner).toContain("if (owner.rows[0]?.owner === role) continue");
    expect(provisioner).toContain("revokeUnsafeApplicationBaseline");
    expect(provisioner).not.toContain("ALTER SCHEMA %I OWNER");
    expect(provisioner).not.toContain("p.oid::regprocedure");
    expect(provisioner).toContain("REVOKE SELECT (${columns}), INSERT (${columns})");
    expect(provisioner).toContain("APPLICATION_FUNCTIONS");
    expect(provisioner).toContain("ALTER FUNCTION");
    expect(provisioner).toContain("pg_has_role(current_user, $1, 'SET')");
    expect(provisioner).toContain("pg_has_role(current_user, $1, 'MEMBER')");
    expect(provisioner).toContain("serverVersion >= 160000");
    expect(provisioner).toContain("WITH ADMIN FALSE, INHERIT FALSE, SET TRUE");
    expect(provisioner).toContain("GRANTED BY CURRENT_USER");
    expect(provisioner).toContain('["anon", "authenticated", "service_role"]');
  });

  it("keeps the provider projection migration exact, safe, and separately granted", () => {
    const migration = readFileSync(
      fileURLToPath(new URL("../migrations/0022_public_provider_projection.sql", import.meta.url)),
      "utf8",
    );
    const source = migration.match(
      /AS \$trendsfast_public_provider_verifications\$\n([\s\S]*?)\n\$trendsfast_public_provider_verifications\$;/,
    )?.[1];
    expect(source).toBe(PUBLIC_PROVIDER_VERIFICATION_FUNCTION_SOURCE);
    expect(migration).toContain("SECURITY DEFINER");
    expect(migration).toContain("SET search_path = pg_catalog");
    expect(migration).toContain("FROM public.provider_verification_records AS record");
    expect(migration).toContain("record.release_sha = p_release_sha");
    expect(migration).toContain("record.deployment_host = p_deployment_host");
    expect(migration).toContain("record.deployment_id = p_deployment_id");
    expect(migration).toContain("pg_catalog.jsonb_array_length(record.canonical_urls)");
    expect(migration).toContain("REVOKE ALL PRIVILEGES ON FUNCTION");
    expect(migration).not.toMatch(
      /estimated_cost_usd|actual_cost_usd|quota_used|failure_message|initiated_by|requester|secret_hash/i,
    );
  });

  it("denies public key issuance, grants, review, verification, and billing projection", () => {
    const grants = RUNTIME_TABLE_PRIVILEGES.public;
    for (const table of PUBLIC_FORBIDDEN_MUTATION_TABLES) {
      expect(grants[table] ?? []).not.toEqual(expect.arrayContaining(["INSERT", "DELETE"]));
      expect(grants[table] ?? []).not.toContain("UPDATE");
    }
    expect(RUNTIME_COLUMN_PRIVILEGES.public).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: "api_auth_admission_buckets",
          privilege: "UPDATE",
          columns: ["window_started_at", "attempts", "updated_at"],
        }),
        expect.objectContaining({
          table: "api_keys",
          privilege: "UPDATE",
          columns: ["last_used_at"],
        }),
        expect.objectContaining({
          table: "signals",
          privilege: "SELECT",
        }),
        expect.objectContaining({
          table: "scan_runs",
          privilege: "INSERT",
          columns: ["scan_request_id", "project_context_version_id", "attempt", "state"],
        }),
      ]),
    );
    expect(
      RUNTIME_COLUMN_PRIVILEGES.public.find(
        (grant) => grant.table === "scan_runs" && grant.privilege === "SELECT",
      )?.columns,
    ).toEqual(
      expect.arrayContaining([
        "id",
        "scan_request_id",
        "created_at",
        "estimated_cost_usd",
        "actual_cost_usd",
      ]),
    );
    for (const table of ["user_profiles", "project_memberships", "project_claims"]) {
      expect(RUNTIME_TABLE_PRIVILEGES.public[table] ?? []).toEqual([]);
    }
  });

  it("keeps worker and billing mutation domains disjoint from founder controls", () => {
    for (const table of WORKER_FORBIDDEN_MUTATION_TABLES) {
      expect(RUNTIME_TABLE_PRIVILEGES.worker[table] ?? []).not.toEqual(
        expect.arrayContaining(["INSERT", "UPDATE", "DELETE"]),
      );
    }
    for (const table of BILLING_FORBIDDEN_MUTATION_TABLES) {
      expect(RUNTIME_TABLE_PRIVILEGES.billing[table] ?? []).not.toEqual(
        expect.arrayContaining(["INSERT", "UPDATE", "DELETE"]),
      );
    }
    expect(RUNTIME_TABLE_PRIVILEGES.billing.billing_webhook_events).toEqual(
      expect.arrayContaining(["SELECT", "INSERT", "UPDATE"]),
    );
    expect(RUNTIME_TABLE_PRIVILEGES.billing.billing_webhook_events).not.toContain("DELETE");
  });

  it("isolates verified member controls from the anonymous public runtime", () => {
    const member = RUNTIME_TABLE_PRIVILEGES.member;
    expect(member.project_memberships).toEqual(expect.arrayContaining(["SELECT", "INSERT"]));
    expect(member.project_context_versions).toEqual(expect.arrayContaining(["SELECT", "INSERT"]));
    expect(member.api_keys).toEqual(["INSERT"]);
    expect(RUNTIME_COLUMN_PRIVILEGES.member).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ table: "api_keys", privilege: "SELECT" }),
        expect.objectContaining({ table: "api_keys", privilege: "UPDATE" }),
        expect.objectContaining({ table: "project_context_versions", privilege: "UPDATE" }),
        expect.objectContaining({ table: "projects", privilege: "UPDATE" }),
        expect.objectContaining({ table: "scan_runs", privilege: "SELECT", columns: ["id"] }),
        expect.objectContaining({
          table: "scan_runs",
          privilege: "INSERT",
          columns: ["scan_request_id", "project_context_version_id", "attempt", "state"],
        }),
      ]),
    );
    expect(member.billing_webhook_events ?? []).toEqual([]);
    expect(member.provider_verification_records ?? []).toEqual([]);
    expect(member.project_entitlements).toEqual(["SELECT"]);
    expect(RUNTIME_TABLE_PRIVILEGES.public.api_key_management_events ?? []).not.toContain("INSERT");
  });

  it("limits the ops web runtime to reviewed founder-control mutations", () => {
    const grants = RUNTIME_TABLE_PRIVILEGES.ops;
    expect(grants.founder_launch_interests).toEqual(
      expect.arrayContaining(["SELECT", "UPDATE", "DELETE"]),
    );
    expect(grants.analytics_events).toEqual(["SELECT", "INSERT"]);
    expect(grants.clusters).toEqual(["SELECT"]);
    expect(grants.cluster_members).toEqual(["SELECT"]);
    expect(grants.provider_cost_ledger).toEqual(["SELECT"]);
    expect(grants.project_entitlements).toEqual(["SELECT"]);
    expect(grants.stripe_customers).toEqual(["SELECT"]);
    expect(grants.subscriptions).toEqual(["SELECT"]);
    expect(grants.signals).toEqual(expect.arrayContaining(["SELECT", "INSERT", "UPDATE"]));
    expect(grants.signal_metric_snapshots).toEqual(
      expect.arrayContaining(["SELECT", "INSERT", "UPDATE"]),
    );
    for (const protectedTable of [
      "billing_webhook_events",
      "billing_payment_states",
      "operations_alert_queue",
      "operations_health_checks",
      "operations_reconciliation_runs",
      "api_key_auth_events",
      "feedback_events",
      "outcomes",
    ]) {
      expect(grants[protectedTable] ?? []).not.toEqual(
        expect.arrayContaining(["INSERT", "UPDATE", "DELETE"]),
      );
    }
    expect(
      Object.entries(grants)
        .filter(([, privileges]) => privileges.includes("DELETE"))
        .map(([table]) => table),
    ).toEqual(["founder_launch_interests"]);
  });

  it("gives retention one function capability and no direct table or column access", () => {
    const grants = RUNTIME_TABLE_PRIVILEGES.retention;
    expect(grants).toEqual({});
    expect(RUNTIME_COLUMN_PRIVILEGES.retention).toEqual([]);
    for (const table of RETENTION_FORBIDDEN_MUTATION_TABLES) {
      expect(grants[table] ?? []).not.toEqual(
        expect.arrayContaining(["INSERT", "UPDATE", "DELETE"]),
      );
    }
    expect(RETENTION_PURGE_FUNCTION.executeRoles).toEqual(["retention"]);
    expect(
      APPLICATION_FUNCTIONS.find(
        (definition) => definition.name === "trendsfast_assert_managed_policy_revision",
      )?.executeRoles,
    ).toEqual(["worker"]);
    expect(
      APPLICATION_FUNCTIONS.find(
        (definition) => definition.name === "trendsfast_record_backup_health",
      )?.executeRoles,
    ).toEqual(["worker"]);
    expect(RUNTIME_TABLE_PRIVILEGES.worker.operations_health_checks ?? []).not.toEqual(
      expect.arrayContaining(["INSERT", "UPDATE", "DELETE"]),
    );
    expect(
      APPLICATION_FUNCTIONS.filter((definition) =>
        definition.executeRoles.includes("retention" as never),
      ).map((definition) => definition.name),
    ).toEqual(["trendsfast_purge_retained_data"]);

    const migration = readFileSync(
      fileURLToPath(new URL("../migrations/0023_natural_alex_power.sql", import.meta.url)),
      "utf8",
    );
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.trendsfast_purge_retained_data");
    expect(migration).toContain(
      "CREATE OR REPLACE FUNCTION public.trendsfast_assert_managed_policy_revision",
    );
    expect(migration.match(/SECURITY DEFINER/g)).toHaveLength(3);
    expect(migration.match(/SET search_path = pg_catalog/g)).toHaveLength(3);
    expect(migration).not.toMatch(/trendsfast_public_(?:scan|delivery|analytics|founder)/);
    for (const definition of APPLICATION_FUNCTIONS.filter(
      (candidate) => "sourceHash" in candidate,
    )) {
      const body = migration.match(
        new RegExp(`AS \\$${definition.name}\\$\\n([\\s\\S]*?)\\n\\$${definition.name}\\$;`),
      )?.[1];
      expect(body).toBeDefined();
      expect(createHash("sha256").update(body!.trim().replaceAll("\r\n", "\n")).digest("hex")).toBe(
        definition.sourceHash,
      );
    }
  });

  it("keeps passwords out of source, argv, and success output", () => {
    const provisioner = readFileSync(
      fileURLToPath(new URL("../../../scripts/db/provision-runtime-roles.ts", import.meta.url)),
      "utf8",
    );
    expect(provisioner).toContain(
      'loadPinnedProductionDatabaseEnvironment("provision-runtime-roles")',
    );
    expect(provisioner).toContain("passwordsPrinted: false");
    expect(provisioner).toContain('operatorIsSuperuser ? "NOSUPERUSER " : ""');
    expect(provisioner).toContain("cannot safely demote it");
    expect(provisioner).not.toMatch(/process\.argv/);
    expect(provisioner).not.toMatch(/console\.(?:info|log|error)\([^)]*password/i);
  });

  it("allows only PostgreSQL 16+ managed-creator administration without data inheritance", () => {
    const verifier = readFileSync(
      fileURLToPath(new URL("../../../scripts/db/verify-runtime-roles.ts", import.meta.url)),
      "utf8",
    );
    expect(verifier).toContain("serverVersion >= 160000");
    expect(verifier).toContain("legacyMembershipSql");
    expect(verifier).toContain("modernMembershipSql");
    expect(verifier).toContain("managedMemberships.length !== expectedManagedGrantedRoles.size");
    expect(verifier).toContain("membership.admin_option");
    expect(verifier).toContain("!membership.inherit_option");
    expect(verifier).toContain("!membership.set_option");
    expect(verifier).toContain("membership.grantor_is_superuser");
    expect(verifier).toContain("managedGrantedRoles.size !== expectedManagedGrantedRoles.size");
    expect(verifier).toContain("!managedGrantedRoles.has(role)");
    expect(verifier).toContain("!managedCreatorMembership(membership)");
    expect(verifier).toContain('membership.member === "postgres"');
    expect(verifier).toContain('membership.grantor === "supabase_admin"');
    expect(verifier).not.toContain("information_schema");
    expect(verifier).toContain('["anon", "authenticated", "service_role"]');
    expect(verifier).toContain("unsafeMigratorDefaults");
    expect(verifier).toContain("coalesce(defaults.defaclacl, acldefault");
    expect(verifier).toContain("schema_additions");
    expect(verifier).toContain("migratorDefaultAclClean: true");
  });

  it("looks up named PostgreSQL functions by their type-only argument signature", () => {
    const verifier = readFileSync(
      fileURLToPath(new URL("../../../scripts/db/verify-runtime-roles.ts", import.meta.url)),
      "utf8",
    );
    expect(
      verifier.match(/pg_catalog\.oidvectortypes\(function\.proargtypes\) = \$3/g),
    ).toHaveLength(2);
    expect(verifier).not.toContain("pg_catalog.pg_get_function_identity_arguments(function.oid)");
    expect(verifier.match(/format\('%I\.%I', 'public', \$2::text\)/g)).toHaveLength(2);
    expect(verifier).toContain("application_columns application_column");
    expect(verifier).toContain("application_table(table_name)");
    expect(verifier).not.toContain("application_columns column");
  });
});
