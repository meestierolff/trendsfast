import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

import type { PoolClient } from "pg";
import { afterAll, describe, expect, it } from "vitest";

import { createDatabaseFromEnv } from "../src/index";

const databaseDescribe = process.env.RUN_DATABASE_INTEGRATION === "1" ? describe : describe.skip;
const migrationsFolder = new URL("../migrations/", import.meta.url);
const baselineMigrations = [
  "0000_fixture_foundation",
  "0011_billing_webhook_authority",
  "0012_founder_usage_limits",
  "0013_paid_monitoring",
] as const;

async function applyMigration(client: PoolClient, tag: string, schemaName: string) {
  const path = fileURLToPath(new URL(`${tag}.sql`, migrationsFolder));
  const isolatedSql = readFileSync(path, "utf8").replaceAll('"public"', `"${schemaName}"`);
  for (const statement of isolatedSql.split("--> statement-breakpoint")) {
    if (statement.trim()) await client.query(statement);
  }
}

databaseDescribe("0020 monitoring reliability migration", () => {
  const database = createDatabaseFromEnv();

  afterAll(async () => {
    await database.close();
  });

  it("upgrades a non-failed legacy attempt four without weakening the retry bound", async () => {
    const schemaName = `migration_0020_${randomUUID().replaceAll("-", "")}`;
    const client = await database.pool.connect();
    try {
      await client.query(`CREATE SCHEMA "${schemaName}"`);
      await client.query(`SET search_path TO "${schemaName}"`);
      for (const migration of baselineMigrations) {
        await applyMigration(client, migration, schemaName);
      }
      await client.query(`
        WITH project AS (
          INSERT INTO projects (public_id, url, normalized_url)
          VALUES ('migration-0020-project', 'https://migration-0020.example', 'https://migration-0020.example')
          RETURNING id
        ), customer AS (
          INSERT INTO stripe_customers (project_id, stripe_customer_id)
          SELECT id, 'cus_migration_0020' FROM project
          RETURNING id, project_id
        ), subscription AS (
          INSERT INTO subscriptions (
            stripe_customer_id,
            stripe_subscription_id,
            stripe_price_id,
            status,
            project_id
          )
          SELECT id, 'sub_migration_0020', 'price_migration_0020', 'ACTIVE', project_id
          FROM customer
          RETURNING id, project_id
        ), entitlement AS (
          INSERT INTO project_entitlements (
            project_id,
            subscription_id,
            active,
            period_start,
            period_end,
            source_stripe_event_id,
            source_stripe_event_created_at
          )
          SELECT
            project_id,
            id,
            true,
            '2026-08-01T00:00:00Z',
            '2026-09-01T00:00:00Z',
            'evt_migration_0020',
            '2026-08-01T00:00:00Z'
          FROM subscription
          RETURNING project_id, subscription_id
        ), monitoring AS (
          INSERT INTO monitoring_subscriptions (
            project_id,
            subscription_id,
            state,
            next_due_at
          )
          SELECT project_id, subscription_id, 'ACTIVE', '2026-08-02T00:00:00Z'
          FROM entitlement
          RETURNING id, project_id
        )
        INSERT INTO monitoring_runs (
          monitoring_subscription_id,
          project_id,
          scheduled_for,
          idempotency_key,
          state,
          attempt,
          claimed_at,
          completed_at
        )
        SELECT
          id,
          project_id,
          '2026-08-01T00:00:00Z',
          'migration-0020-attempt-four',
          'REVIEW_REQUIRED',
          4,
          '2026-08-01T00:00:00Z',
          '2026-08-01T00:01:00Z'
        FROM monitoring
      `);

      await client.query("BEGIN");
      try {
        await applyMigration(client, "0020_perfect_blob", schemaName);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
      const upgraded = await client.query<{
        state: string;
        attempt: number;
        max_attempts: number;
        failure_disposition: string | null;
      }>(`
        SELECT state, attempt, max_attempts, failure_disposition
        FROM monitoring_runs
        WHERE idempotency_key = 'migration-0020-attempt-four'
      `);
      expect(upgraded.rows).toEqual([
        {
          state: "REVIEW_REQUIRED",
          attempt: 4,
          max_attempts: 4,
          failure_disposition: null,
        },
      ]);

      const insertAlert = (payload: Record<string, unknown>) =>
        client.query(
          `
            INSERT INTO operations_alert_queue (event_type, severity, dedupe_hash, payload)
            VALUES ('MONITORING_FAILURE', 'critical', 'sha256:' || repeat('a', 64), $1::jsonb)
          `,
          [JSON.stringify(payload)],
        );
      for (const privatePayload of [
        { code: "CUSTOMER_EMAIL" },
        { privateUrl: "https://private.example/customer" },
        { evidenceText: "customer evidence" },
        { token: "not-a-real-token" },
      ]) {
        await expect(insertAlert(privatePayload)).rejects.toThrow(
          /operations_alert_queue_payload_check/,
        );
      }
      await expect(
        insertAlert({ code: "PROVIDER_OUTCOME_UNKNOWN", count: 1 }),
      ).resolves.toBeDefined();
    } finally {
      await client.query("RESET search_path");
      await client.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
      client.release();
    }
  });
});
