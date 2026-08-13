-- Drizzle applies every pending migration in one transaction. PostgreSQL
-- forbids using an enum value added in that same transaction, so replace the
-- enum atomically instead of ALTER TYPE ... ADD VALUE.
CREATE TYPE "public"."monitoring_run_state_v2" AS ENUM('PROCESSING', 'RETRY_WAIT', 'QUARANTINED', 'REVIEW_REQUIRED', 'COMPLETED', 'FAILED', 'DEAD_LETTER');--> statement-breakpoint
ALTER TABLE "monitoring_runs" DROP CONSTRAINT "monitoring_runs_lease_check";--> statement-breakpoint
ALTER TABLE "monitoring_runs" DROP CONSTRAINT "monitoring_runs_completion_check";--> statement-breakpoint
DROP INDEX "monitoring_runs_one_open_uidx";--> statement-breakpoint
DROP INDEX "monitoring_runs_project_state_idx";--> statement-breakpoint
DROP INDEX "monitoring_runs_lease_idx";--> statement-breakpoint
ALTER TABLE "monitoring_runs" ALTER COLUMN "state" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "monitoring_runs" ALTER COLUMN "state" TYPE "public"."monitoring_run_state_v2" USING "state"::text::"public"."monitoring_run_state_v2";--> statement-breakpoint
DROP TYPE "public"."monitoring_run_state";--> statement-breakpoint
ALTER TYPE "public"."monitoring_run_state_v2" RENAME TO "monitoring_run_state";--> statement-breakpoint
ALTER TABLE "monitoring_runs" ALTER COLUMN "state" SET DEFAULT 'PROCESSING';--> statement-breakpoint
CREATE UNIQUE INDEX "monitoring_runs_one_open_uidx" ON "monitoring_runs" USING btree ("monitoring_subscription_id") WHERE "monitoring_runs"."state" IN ('PROCESSING','RETRY_WAIT');--> statement-breakpoint
CREATE INDEX "monitoring_runs_project_state_idx" ON "monitoring_runs" USING btree ("project_id","state");--> statement-breakpoint
CREATE INDEX "monitoring_runs_lease_idx" ON "monitoring_runs" USING btree ("state","lease_expires_at");--> statement-breakpoint
CREATE TABLE "operations_alert_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" varchar(40) NOT NULL,
	"severity" varchar(12) NOT NULL,
	"dedupe_hash" varchar(71) NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"state" varchar(16) DEFAULT 'PENDING' NOT NULL,
	"attempt" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_owner" varchar(100),
	"lease_expires_at" timestamp with time zone,
	"last_failure_code" varchar(100),
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operations_alert_queue_event_check" CHECK ("operations_alert_queue"."event_type" IN ('MONITORING_FAILURE','REVIEW_QUEUE_AGE','PROVIDER_DEGRADATION','COST_REJECTION','STRIPE_WEBHOOK_FAILURE','BACKUP_RETENTION_FAILURE')),
	CONSTRAINT "operations_alert_queue_severity_check" CHECK ("operations_alert_queue"."severity" IN ('warning','critical')),
	CONSTRAINT "operations_alert_queue_state_check" CHECK ("operations_alert_queue"."state" IN ('PENDING','SENDING','DELIVERED','DEAD_LETTER')),
	CONSTRAINT "operations_alert_queue_attempt_check" CHECK ("operations_alert_queue"."attempt" >= 0 AND "operations_alert_queue"."max_attempts" BETWEEN 1 AND 10 AND "operations_alert_queue"."attempt" <= "operations_alert_queue"."max_attempts"),
	CONSTRAINT "operations_alert_queue_dedupe_check" CHECK (length("operations_alert_queue"."dedupe_hash") = 71 AND "operations_alert_queue"."dedupe_hash" LIKE 'sha256:%'),
	CONSTRAINT "operations_alert_queue_payload_check" CHECK (jsonb_typeof("operations_alert_queue"."payload") = 'object'
		AND ("operations_alert_queue"."payload" - ARRAY['code','count','maxAgeSeconds']::text[]) = '{}'::jsonb
		AND ("operations_alert_queue"."payload"->'code' IS NULL OR (
			jsonb_typeof("operations_alert_queue"."payload"->'code') = 'string'
			AND "operations_alert_queue"."payload"->>'code' IN (
				'MONITORING_RETRY_SCHEDULED',
				'PROVIDER_OUTCOME_UNKNOWN',
				'MONITORING_ATTEMPTS_EXHAUSTED',
				'MONITORING_TERMINAL_FAILURE',
				'DAILY_RECONCILIATION_FAILED',
				'PROVIDER_DEGRADED',
				'COST_REJECTED',
				'STRIPE_WEBHOOK_PROJECTION_FAILED',
				'BACKUP_RETENTION_HEARTBEAT_STALE',
				'BACKUP_FAILED',
				'RETENTION_FAILED'
			)
		))
		AND ("operations_alert_queue"."payload"->'count' IS NULL OR (
			jsonb_typeof("operations_alert_queue"."payload"->'count') = 'number'
			AND ("operations_alert_queue"."payload"->>'count')::numeric BETWEEN 0 AND 1000000
			AND trunc(("operations_alert_queue"."payload"->>'count')::numeric) = ("operations_alert_queue"."payload"->>'count')::numeric
		))
		AND ("operations_alert_queue"."payload"->'maxAgeSeconds' IS NULL OR (
			jsonb_typeof("operations_alert_queue"."payload"->'maxAgeSeconds') = 'number'
			AND ("operations_alert_queue"."payload"->>'maxAgeSeconds')::numeric BETWEEN 0 AND 31536000
			AND trunc(("operations_alert_queue"."payload"->>'maxAgeSeconds')::numeric) = ("operations_alert_queue"."payload"->>'maxAgeSeconds')::numeric
		))),
	CONSTRAINT "operations_alert_queue_delivery_check" CHECK ((
        "operations_alert_queue"."state" = 'SENDING'
        AND "operations_alert_queue"."lease_owner" IS NOT NULL
        AND "operations_alert_queue"."lease_expires_at" IS NOT NULL
        AND "operations_alert_queue"."delivered_at" IS NULL
      ) OR (
        "operations_alert_queue"."state" = 'DELIVERED'
        AND "operations_alert_queue"."lease_owner" IS NULL
        AND "operations_alert_queue"."lease_expires_at" IS NULL
        AND "operations_alert_queue"."delivered_at" IS NOT NULL
      ) OR (
        "operations_alert_queue"."state" IN ('PENDING','DEAD_LETTER')
        AND "operations_alert_queue"."lease_owner" IS NULL
        AND "operations_alert_queue"."lease_expires_at" IS NULL
        AND "operations_alert_queue"."delivered_at" IS NULL
      ))
);
--> statement-breakpoint
CREATE TABLE "operations_health_checks" (
	"check_type" varchar(16) PRIMARY KEY NOT NULL,
	"last_succeeded_at" timestamp with time zone,
	"last_failed_at" timestamp with time zone,
	"failure_code" varchar(100),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operations_health_checks_type_check" CHECK ("operations_health_checks"."check_type" IN ('BACKUP','RETENTION')),
	CONSTRAINT "operations_health_checks_failure_check" CHECK (("operations_health_checks"."last_failed_at" IS NULL AND "operations_health_checks"."failure_code" IS NULL) OR ("operations_health_checks"."last_failed_at" IS NOT NULL AND "operations_health_checks"."failure_code" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "operations_reconciliation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"state" varchar(12) DEFAULT 'RUNNING' NOT NULL,
	"lease_owner" varchar(100),
	"lease_expires_at" timestamp with time zone,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"failure_code" varchar(100),
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operations_reconciliation_state_check" CHECK ("operations_reconciliation_runs"."state" IN ('RUNNING','COMPLETED','FAILED')),
	CONSTRAINT "operations_reconciliation_shape_check" CHECK ((
        "operations_reconciliation_runs"."state" = 'RUNNING'
        AND "operations_reconciliation_runs"."lease_owner" IS NOT NULL
        AND "operations_reconciliation_runs"."lease_expires_at" IS NOT NULL
        AND "operations_reconciliation_runs"."completed_at" IS NULL
        AND "operations_reconciliation_runs"."failure_code" IS NULL
      ) OR (
        "operations_reconciliation_runs"."state" = 'COMPLETED'
        AND "operations_reconciliation_runs"."lease_owner" IS NULL
        AND "operations_reconciliation_runs"."lease_expires_at" IS NULL
        AND "operations_reconciliation_runs"."completed_at" IS NOT NULL
        AND "operations_reconciliation_runs"."failure_code" IS NULL
      ) OR (
        "operations_reconciliation_runs"."state" = 'FAILED'
        AND "operations_reconciliation_runs"."lease_owner" IS NULL
        AND "operations_reconciliation_runs"."lease_expires_at" IS NULL
        AND "operations_reconciliation_runs"."completed_at" IS NOT NULL
        AND "operations_reconciliation_runs"."failure_code" IS NOT NULL
      ))
);
--> statement-breakpoint
ALTER TABLE "monitoring_runs" ADD COLUMN "max_attempts" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "monitoring_runs" ADD COLUMN "retry_base_seconds" integer DEFAULT 300 NOT NULL;--> statement-breakpoint
ALTER TABLE "monitoring_runs" ADD COLUMN "failure_disposition" varchar(24);--> statement-breakpoint
ALTER TABLE "monitoring_runs" ADD COLUMN "next_retry_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "monitoring_runs" ADD COLUMN "quarantined_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "monitoring_runs" ADD COLUMN "dead_lettered_at" timestamp with time zone;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "monitoring_runs" WHERE "attempt" > 10) THEN
    RAISE EXCEPTION '0020 cannot safely infer a capped retry policy for a monitoring run with more than 10 prior attempts';
  END IF;
END
$$;--> statement-breakpoint
UPDATE "monitoring_runs"
SET
	"max_attempts" = greatest(3, "attempt");--> statement-breakpoint
UPDATE "monitoring_runs"
SET
	"failure_code" = coalesce("failure_code", 'LEGACY_MONITORING_FAILURE'),
	"failure_disposition" = 'KNOWN_TERMINAL'
WHERE "state" = 'FAILED';--> statement-breakpoint
CREATE UNIQUE INDEX "operations_alert_queue_dedupe_uidx" ON "operations_alert_queue" USING btree ("dedupe_hash");--> statement-breakpoint
CREATE INDEX "operations_alert_queue_due_idx" ON "operations_alert_queue" USING btree ("state","next_attempt_at");--> statement-breakpoint
CREATE INDEX "operations_alert_queue_event_occurred_idx" ON "operations_alert_queue" USING btree ("event_type","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "operations_reconciliation_period_uidx" ON "operations_reconciliation_runs" USING btree ("period_start");--> statement-breakpoint
CREATE INDEX "operations_reconciliation_state_lease_idx" ON "operations_reconciliation_runs" USING btree ("state","lease_expires_at");--> statement-breakpoint
CREATE INDEX "monitoring_runs_retry_idx" ON "monitoring_runs" USING btree ("state","next_retry_at");--> statement-breakpoint
ALTER TABLE "monitoring_runs" ADD CONSTRAINT "monitoring_runs_retry_policy_check" CHECK ("monitoring_runs"."max_attempts" BETWEEN 1 AND 10 AND "monitoring_runs"."retry_base_seconds" BETWEEN 30 AND 86400 AND "monitoring_runs"."attempt" <= "monitoring_runs"."max_attempts");--> statement-breakpoint
ALTER TABLE "monitoring_runs" ADD CONSTRAINT "monitoring_runs_lease_check" CHECK (("monitoring_runs"."state" = 'PROCESSING') = ("monitoring_runs"."lease_owner" IS NOT NULL AND "monitoring_runs"."lease_expires_at" IS NOT NULL AND "monitoring_runs"."completed_at" IS NULL));--> statement-breakpoint
ALTER TABLE "monitoring_runs" ADD CONSTRAINT "monitoring_runs_failure_shape_check" CHECK ((
        "monitoring_runs"."state" IN ('PROCESSING','REVIEW_REQUIRED','COMPLETED')
        AND "monitoring_runs"."failure_code" IS NULL
        AND "monitoring_runs"."failure_disposition" IS NULL
        AND "monitoring_runs"."next_retry_at" IS NULL
        AND "monitoring_runs"."quarantined_at" IS NULL
        AND "monitoring_runs"."dead_lettered_at" IS NULL
      ) OR (
        "monitoring_runs"."state" = 'RETRY_WAIT'
        AND "monitoring_runs"."failure_code" IS NOT NULL
        AND "monitoring_runs"."failure_disposition" = 'KNOWN_RETRYABLE'
        AND "monitoring_runs"."next_retry_at" IS NOT NULL
        AND "monitoring_runs"."quarantined_at" IS NULL
        AND "monitoring_runs"."dead_lettered_at" IS NULL
      ) OR (
        "monitoring_runs"."state" = 'QUARANTINED'
        AND "monitoring_runs"."failure_code" IS NOT NULL
        AND "monitoring_runs"."failure_disposition" = 'OUTCOME_UNKNOWN'
        AND "monitoring_runs"."next_retry_at" IS NULL
        AND "monitoring_runs"."quarantined_at" IS NOT NULL
        AND "monitoring_runs"."dead_lettered_at" IS NULL
      ) OR (
        "monitoring_runs"."state" = 'FAILED'
        AND "monitoring_runs"."failure_code" IS NOT NULL
        AND "monitoring_runs"."failure_disposition" = 'KNOWN_TERMINAL'
        AND "monitoring_runs"."next_retry_at" IS NULL
        AND "monitoring_runs"."quarantined_at" IS NULL
        AND "monitoring_runs"."dead_lettered_at" IS NULL
      ) OR (
        "monitoring_runs"."state" = 'DEAD_LETTER'
        AND "monitoring_runs"."failure_code" IS NOT NULL
        AND "monitoring_runs"."failure_disposition" = 'KNOWN_RETRYABLE'
        AND "monitoring_runs"."next_retry_at" IS NULL
        AND "monitoring_runs"."quarantined_at" IS NULL
        AND "monitoring_runs"."dead_lettered_at" IS NOT NULL
      ));--> statement-breakpoint
ALTER TABLE "monitoring_runs" ADD CONSTRAINT "monitoring_runs_completion_check" CHECK (("monitoring_runs"."state" IN ('PROCESSING','RETRY_WAIT')) = ("monitoring_runs"."completed_at" IS NULL));--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE "operations_alert_queue" FROM PUBLIC;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE "operations_health_checks" FROM PUBLIC;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE "operations_reconciliation_runs" FROM PUBLIC;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL PRIVILEGES ON TABLE "operations_alert_queue" FROM anon;
    REVOKE ALL PRIVILEGES ON TABLE "operations_health_checks" FROM anon;
    REVOKE ALL PRIVILEGES ON TABLE "operations_reconciliation_runs" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL PRIVILEGES ON TABLE "operations_alert_queue" FROM authenticated;
    REVOKE ALL PRIVILEGES ON TABLE "operations_health_checks" FROM authenticated;
    REVOKE ALL PRIVILEGES ON TABLE "operations_reconciliation_runs" FROM authenticated;
  END IF;
END
$$;
