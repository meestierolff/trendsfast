import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  analyticsEvents,
  apiAuthAdmissionBuckets,
  apiKeyAuthEvents,
  apiKeyManagementEvents,
  apiKeyManagementActionEnum,
  apiKeys,
  billingCheckoutSessions,
  billingPaymentStates,
  billingWebhookEvents,
  clusterMembers,
  clusters,
  deliveryTokens,
  evidenceReceipts,
  feedbackEvents,
  founderEntitlementGrantEvents,
  founderEntitlementGrants,
  founderLaunchInterestEvents,
  founderLaunchInterests,
  founderUsageEvents,
  monitoringRuns,
  monitoringSubscriptions,
  nextMoveRevisions,
  nextMoves,
  opportunities,
  outcomes,
  projectContextVersions,
  projectEntitlements,
  projects,
  providerCostLedger,
  providerVerificationRecords,
  reviewEvents,
  reviewActionEnum,
  scanRequests,
  scanRuns,
  signalMetricSnapshots,
  signals,
  sourceRuns,
  stripeCustomers,
  subscriptions,
} from "../src/index";

const foundationTableNames = [
  "scan_requests",
  "projects",
  "project_context_versions",
  "scan_runs",
  "source_runs",
  "signals",
  "signal_metric_snapshots",
  "clusters",
  "cluster_members",
  "opportunities",
  "next_moves",
  "evidence_receipts",
  "review_events",
  "delivery_tokens",
  "feedback_events",
  "outcomes",
  "api_keys",
  "provider_cost_ledger",
  "analytics_events",
  "stripe_customers",
  "subscriptions",
];

const minimumTableNames = [
  ...foundationTableNames,
  "api_key_management_events",
  "provider_verification_records",
  "billing_checkout_sessions",
  "billing_payment_states",
  "billing_webhook_events",
  "project_entitlements",
  "founder_usage_events",
  "founder_entitlement_grants",
  "founder_entitlement_grant_events",
  "monitoring_subscriptions",
  "monitoring_runs",
  "founder_launch_interests",
  "founder_launch_interest_events",
  "next_move_revisions",
];

describe("portable PostgreSQL schema", () => {
  it("defines every minimum relational table plus API auth auditing", () => {
    const tables = [
      scanRequests,
      projects,
      projectEntitlements,
      projectContextVersions,
      scanRuns,
      sourceRuns,
      signals,
      signalMetricSnapshots,
      clusters,
      clusterMembers,
      billingCheckoutSessions,
      billingPaymentStates,
      billingWebhookEvents,
      opportunities,
      nextMoves,
      nextMoveRevisions,
      evidenceReceipts,
      reviewEvents,
      deliveryTokens,
      feedbackEvents,
      founderLaunchInterests,
      founderLaunchInterestEvents,
      founderUsageEvents,
      founderEntitlementGrants,
      founderEntitlementGrantEvents,
      monitoringSubscriptions,
      monitoringRuns,
      outcomes,
      apiKeys,
      apiKeyManagementEvents,
      providerCostLedger,
      providerVerificationRecords,
      analyticsEvents,
      stripeCustomers,
      subscriptions,
      apiKeyAuthEvents,
      apiAuthAdmissionBuckets,
    ].map(getTableName);

    expect(tables).toEqual(expect.arrayContaining(minimumTableNames));
    expect(tables).toContain("api_key_auth_events");
    expect(tables).toContain("api_auth_admission_buckets");
  });

  it("never models a raw API or provider secret column", () => {
    const columns = [apiKeys, deliveryTokens].flatMap((table) => Object.keys(table));

    expect(columns).toContain("secretHash");
    expect(columns).toContain("tokenHash");
    expect(columns).not.toContain("rawKey");
    expect(columns).not.toContain("secret");
    expect(columns).not.toContain("providerKey");
  });

  it("persists the canonical request digest used to detect idempotency conflicts", () => {
    expect(Object.keys(scanRequests)).toContain("requestPayloadHash");

    const migration = readFileSync(
      fileURLToPath(
        new URL("../migrations/0003_api_idempotency_payload_digest.sql", import.meta.url),
      ),
      "utf8",
    );
    expect(migration).toContain('ADD COLUMN "request_payload_hash"');
  });

  it("persists optional API-key expiry and an auditable expired outcome", () => {
    expect(Object.keys(apiKeys)).toContain("expiresAt");

    const migration = readFileSync(
      fileURLToPath(new URL("../migrations/0004_api-key-expiry.sql", import.meta.url)),
      "utf8",
    );
    expect(migration).toContain("ADD VALUE 'EXPIRED'");
    expect(migration).toContain('ADD COLUMN "expires_at"');
    expect(migration).toContain("api_keys_expiry_after_creation_check");
  });

  it("persists the processing fence used to reject stale scan workers", () => {
    expect(Object.keys(scanRuns)).toContain("processingFence");

    const migration = readFileSync(
      fileURLToPath(new URL("../migrations/0005_processing_fence.sql", import.meta.url)),
      "utf8",
    );
    expect(migration).toContain('ADD COLUMN "processing_fence"');
  });

  it("persists a bounded cross-instance pre-auth admission gate", () => {
    const migration = readFileSync(
      fileURLToPath(new URL("../migrations/0006_api_auth_admission.sql", import.meta.url)),
      "utf8",
    );
    expect(migration).toContain('CREATE TABLE "api_auth_admission_buckets"');
    expect(migration).toContain("api_auth_admission_attempts_nonnegative_check");
  });

  it("persists the conservative API hourly cost reservation", () => {
    expect(Object.keys(scanRequests)).toContain("apiCostReservationUsd");

    const migration = readFileSync(
      fileURLToPath(new URL("../migrations/0007_api_cost_admission.sql", import.meta.url)),
      "utf8",
    );
    expect(migration).toContain('ADD COLUMN "api_cost_reservation_usd"');
    expect(migration).toContain("scan_requests_api_cost_reservation_nonnegative_check");
    expect(migration).toContain("scan_requests_api_cost_window_idx");
  });

  it("persists audited API-key lifecycle and deployment-bound provider truth", () => {
    expect(Object.keys(apiKeyManagementEvents)).not.toContain("rawKey");
    expect(Object.keys(apiKeyManagementEvents)).not.toContain("secret");
    expect(Object.keys(providerVerificationRecords)).toEqual(
      expect.arrayContaining([
        "state",
        "readbackVerified",
        "deploymentEnvironment",
        "releaseSha",
        "deploymentHost",
      ]),
    );

    const migration = readFileSync(
      fileURLToPath(new URL("../migrations/0008_luxuriant_onslaught.sql", import.meta.url)),
      "utf8",
    );
    expect(migration).toContain('CREATE TABLE "api_key_management_events"');
    expect(migration).toContain('CREATE TABLE "provider_verification_records"');
    expect(migration).toContain("provider_verification_production_identity_check");
    expect(migration).toContain("provider_verification_truth_check");
    expect(migration).toContain('ADD COLUMN "binding_role"');
  });

  it("reserves 0011–0013 for webhook authority, Founder usage, and monitoring", () => {
    const billing = readFileSync(
      fileURLToPath(new URL("../migrations/0011_billing_webhook_authority.sql", import.meta.url)),
      "utf8",
    );
    const usage = readFileSync(
      fileURLToPath(new URL("../migrations/0012_founder_usage_limits.sql", import.meta.url)),
      "utf8",
    );
    const monitoring = readFileSync(
      fileURLToPath(new URL("../migrations/0013_paid_monitoring.sql", import.meta.url)),
      "utf8",
    );

    expect(billing).toContain('CREATE TABLE "billing_webhook_events"');
    expect(billing).toContain('CREATE TABLE "project_entitlements"');
    expect(billing).toContain("stripe_customers_project_uidx");
    expect(usage).toContain('CREATE TABLE "founder_usage_events"');
    expect(usage).toContain("founder_usage_project_kind_occurred_idx");
    expect(monitoring).toContain('CREATE TABLE "monitoring_subscriptions"');
    expect(monitoring).toContain('CREATE TABLE "monitoring_runs"');
    expect(monitoring).toContain("monitoring_runs_one_open_uidx");
    expect(monitoring).toContain("ADD VALUE 'MONITORING'");
  });

  it("persists append-once analytics and consented expiring launch interest in 0014", () => {
    expect(Object.keys(analyticsEvents)).toContain("dedupeKey");
    expect(Object.keys(founderLaunchInterestEvents)).not.toContain("email");
    expect(Object.keys(founderLaunchInterestEvents)).not.toContain("emailHash");

    const migration = readFileSync(
      fileURLToPath(new URL("../migrations/0014_launch_analytics_interest.sql", import.meta.url)),
      "utf8",
    );
    expect(migration).toContain('CREATE TABLE "founder_launch_interests"');
    expect(migration).toContain('CREATE TABLE "founder_launch_interest_events"');
    expect(migration).toContain("analytics_events_dedupe_uidx");
    expect(migration).toContain("analytics_events_session_hash_check");
    expect(migration).toContain("founder_launch_interests_expiry_check");
  });

  it("versions founder review edits, proposals, and evidence in replayable migration 0017", () => {
    expect(reviewActionEnum.enumValues).toEqual(
      expect.arrayContaining(["EVIDENCE_VERIFIED", "RECOMPUTED_FROM_STORED_EVIDENCE"]),
    );
    expect(Object.keys(nextMoves)).toEqual(
      expect.arrayContaining(["reviewVersion", "proposalStale"]),
    );
    expect(Object.keys(evidenceReceipts)).toContain("moveVersion");
    expect(Object.keys(opportunities)).toContain("moveVersion");
    expect(Object.keys(nextMoveRevisions)).toEqual(
      expect.arrayContaining([
        "nextMoveId",
        "contextVersionId",
        "version",
        "changeKind",
        "reviewerId",
        "reason",
        "before",
        "after",
        "promptVersion",
        "scoreVersion",
        "retainedEvidenceIds",
      ]),
    );
    expect(getTableConfig(evidenceReceipts).indexes.map((index) => index.config.name)).toContain(
      "evidence_receipts_move_version_signal_uidx",
    );
    expect(getTableConfig(opportunities).indexes.map((index) => index.config.name)).toContain(
      "opportunities_scan_version_rank_uidx",
    );
    expect(getTableConfig(nextMoveRevisions).indexes.map((index) => index.config.name)).toEqual(
      expect.arrayContaining([
        "next_move_revisions_move_version_uidx",
        "next_move_revisions_context_created_idx",
      ]),
    );
    expect(getTableConfig(evidenceReceipts).checks.map((check) => check.name)).toEqual(
      expect.arrayContaining([
        "evidence_receipts_move_version_positive_check",
        "evidence_receipts_verified_review_identity_check",
      ]),
    );

    const migration = readFileSync(
      fileURLToPath(new URL("../migrations/0017_review_edit_bundle.sql", import.meta.url)),
      "utf8",
    );
    expect(migration).toContain('CREATE TABLE "next_move_revisions"');
    expect(migration).toContain('DROP INDEX "evidence_receipts_move_signal_uidx"');
    expect(migration).toContain('DROP INDEX "opportunities_scan_rank_uidx"');
    expect(migration).toContain('ADD COLUMN "move_version" integer DEFAULT 1 NOT NULL');
    expect(migration).toContain('ADD COLUMN "review_version" integer DEFAULT 1 NOT NULL');
    expect(migration).toContain('ADD COLUMN "proposal_stale" boolean DEFAULT false NOT NULL');
    expect(migration).toContain("0017 requires every previously verified evidence receipt");
    expect(migration).toContain('"reviewed_by" IS NULL');
    expect(migration).toContain('"verified_at" IS NULL');
    expect(migration).not.toContain('SET "reviewed_by"');
    expect(migration).not.toContain('SET "verified_at"');

    const verifier = readFileSync(
      fileURLToPath(new URL("../../../scripts/db/verify-hosted-schema.ts", import.meta.url)),
      "utf8",
    );
    expect(verifier).toContain('"next_move_revisions"');
    expect(verifier).toContain('"evidence_receipts_move_version_signal_uidx"');
    expect(verifier).toContain('"opportunities_scan_version_rank_uidx"');
    expect(verifier).toContain('"evidence_receipts_verified_review_identity_check"');
    expect(verifier).toContain('"next_moves.review_version"');
    expect(verifier).not.toContain('"evidence_receipts_move_signal_uidx"');
    expect(verifier).not.toContain('"opportunities_scan_rank_uidx"');
  });

  it("binds payment truth to service periods and prevents duplicate paid enrollment in 0015", () => {
    expect(Object.keys(billingPaymentStates)).toEqual(
      expect.arrayContaining(["periodStart", "periodEnd"]),
    );
    expect(
      getTableConfig(billingCheckoutSessions).indexes.map((index) => index.config.name),
    ).toContain("billing_checkout_project_open_uidx");
    expect(Object.keys(billingCheckoutSessions)).toEqual(
      expect.arrayContaining(["expiresAt", "requestedStripeCustomerId"]),
    );
    expect(billingCheckoutSessions.stripeCheckoutSessionId.notNull).toBe(false);
    expect(getTableConfig(subscriptions).indexes.map((index) => index.config.name)).toContain(
      "subscriptions_project_nonterminal_uidx",
    );

    const migration = readFileSync(
      fileURLToPath(
        new URL("../migrations/0015_billing_period_checkout_guards.sql", import.meta.url),
      ),
      "utf8",
    );
    expect(migration).toContain('ADD COLUMN "period_start"');
    expect(migration).toContain('ADD COLUMN "expires_at"');
    expect(migration).toContain('ADD COLUMN "requested_stripe_customer_id"');
    expect(migration).toContain('ALTER COLUMN "stripe_checkout_session_id" DROP NOT NULL');
    expect(migration).toContain("billing_payment_period_check");
    expect(migration).toContain("billing_checkout_binding_check");
    expect(migration).toContain("BILLING_CHECKOUT_DUPLICATE_OPEN_REQUIRES_RECONCILIATION");
    expect(migration).toContain(
      "BILLING_DUPLICATE_NONTERMINAL_SUBSCRIPTIONS_REQUIRE_RECONCILIATION",
    );
    expect(migration).toContain(`"created_at" + interval '24 hours'`);
    expect(migration).toContain("billing_checkout_project_open_uidx");
    expect(migration).toContain("subscriptions_project_nonterminal_uidx");
  });

  it("reserves 0019 for token-bound Checkout claims and renewal-safe issued keys", () => {
    expect(Object.keys(billingCheckoutSessions)).toEqual(
      expect.arrayContaining([
        "checkoutClaimHash",
        "checkoutClaimExpiresAt",
        "checkoutClaimConsumedAt",
        "issuedApiKeyId",
      ]),
    );
    expect(apiKeyManagementActionEnum.enumValues).toContain("RENEWED");
    expect(
      getTableConfig(billingCheckoutSessions).indexes.map((index) => index.config.name),
    ).toEqual(
      expect.arrayContaining([
        "billing_checkout_claim_hash_uidx",
        "billing_checkout_issued_api_key_uidx",
      ]),
    );

    const migration = readFileSync(
      fileURLToPath(new URL("../migrations/0019_flawless_sandman.sql", import.meta.url)),
      "utf8",
    );
    expect(migration).toContain("ADD VALUE 'RENEWED'");
    expect(migration).toContain('ADD COLUMN "checkout_claim_hash"');
    expect(migration).toContain('ADD COLUMN "issued_api_key_id"');
    expect(migration).toContain("billing_checkout_claim_shape_check");
    expect(migration).toContain("interval '30 minutes'");
    expect(migration).toContain("interval '24 hours'");
    expect(migration).toContain("billing_checkout_claim_consumption_check");
    expect(migration).toContain(
      '"checkout_claim_consumed_at" IS NULL AND "billing_checkout_sessions"."issued_api_key_id" IS NULL',
    );
    expect(migration).toContain(
      '"checkout_claim_consumed_at" IS NOT NULL AND "billing_checkout_sessions"."issued_api_key_id" IS NOT NULL',
    );
  });

  it("keeps the same external signal independent across scan source runs", () => {
    const index = getTableConfig(signals).indexes.find(
      (candidate) => candidate.config.name === "signals_run_source_source_id_uidx",
    );
    expect(index?.config.unique).toBe(true);
    expect(index?.config.columns.map((column) => ("name" in column ? column.name : null))).toEqual([
      "source_run_id",
      "source",
      "source_id",
    ]);

    const migration = readFileSync(
      fileURLToPath(new URL("../migrations/0002_signal_run_ownership.sql", import.meta.url)),
      "utf8",
    );
    expect(migration).toContain('("source_run_id","source","source_id")');
  });

  it("commits a replayable SQL migration with lifecycle checks and indexes", () => {
    const migrationPath = fileURLToPath(
      new URL("../migrations/0000_fixture_foundation.sql", import.meta.url),
    );
    const sql = readFileSync(migrationPath, "utf8");

    for (const table of foundationTableNames) {
      expect(sql).toContain(`CREATE TABLE "${table}"`);
    }
    expect(sql).toContain("CHECK");
    expect(sql).toContain("CREATE INDEX");
    expect(sql).not.toContain("CREATE POLICY");
    expect(sql).not.toContain("auth.uid()");

    const retryMigration = readFileSync(
      fileURLToPath(new URL("../migrations/0001_retry_idempotency.sql", import.meta.url)),
      "utf8",
    );
    expect(retryMigration).toContain("clusters_scan_dedupe_uidx");
    expect(retryMigration).toContain("provider_cost_scan_ledger_key_uidx");
  });
});
