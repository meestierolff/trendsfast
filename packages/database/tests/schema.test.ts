import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  analyticsEvents,
  apiAuthAdmissionBuckets,
  apiKeyAuthEvents,
  apiKeys,
  clusterMembers,
  clusters,
  deliveryTokens,
  evidenceReceipts,
  feedbackEvents,
  nextMoves,
  opportunities,
  outcomes,
  projectContextVersions,
  projects,
  providerCostLedger,
  reviewEvents,
  scanRequests,
  scanRuns,
  signalMetricSnapshots,
  signals,
  sourceRuns,
  stripeCustomers,
  subscriptions,
} from "../src/index";

const minimumTableNames = [
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

describe("portable PostgreSQL schema", () => {
  it("defines every minimum relational table plus API auth auditing", () => {
    const tables = [
      scanRequests,
      projects,
      projectContextVersions,
      scanRuns,
      sourceRuns,
      signals,
      signalMetricSnapshots,
      clusters,
      clusterMembers,
      opportunities,
      nextMoves,
      evidenceReceipts,
      reviewEvents,
      deliveryTokens,
      feedbackEvents,
      outcomes,
      apiKeys,
      providerCostLedger,
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

    for (const table of minimumTableNames) {
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
