CREATE TYPE "public"."monitoring_run_state" AS ENUM('PROCESSING', 'REVIEW_REQUIRED', 'COMPLETED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."monitoring_subscription_state" AS ENUM('ACTIVE', 'PAUSED', 'CANCELED');--> statement-breakpoint
ALTER TYPE "public"."scan_origin" ADD VALUE 'MONITORING';--> statement-breakpoint
CREATE TABLE "monitoring_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"monitoring_subscription_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"scan_request_id" uuid,
	"scheduled_for" timestamp with time zone NOT NULL,
	"idempotency_key" varchar(255) NOT NULL,
	"state" "monitoring_run_state" DEFAULT 'PROCESSING' NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"lease_owner" varchar(100),
	"lease_expires_at" timestamp with time zone,
	"claimed_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"failure_code" varchar(100),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "monitoring_runs_attempt_check" CHECK ("monitoring_runs"."attempt" > 0),
	CONSTRAINT "monitoring_runs_lease_check" CHECK (("monitoring_runs"."state" = 'PROCESSING') = ("monitoring_runs"."lease_owner" IS NOT NULL AND "monitoring_runs"."lease_expires_at" IS NOT NULL AND "monitoring_runs"."completed_at" IS NULL)),
	CONSTRAINT "monitoring_runs_completion_check" CHECK ("monitoring_runs"."state" = 'PROCESSING' OR "monitoring_runs"."completed_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "monitoring_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"subscription_id" uuid NOT NULL,
	"state" "monitoring_subscription_state" DEFAULT 'PAUSED' NOT NULL,
	"next_due_at" timestamp with time zone NOT NULL,
	"interval_seconds" integer DEFAULT 86400 NOT NULL,
	"last_claimed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "monitoring_subscriptions_interval_check" CHECK ("monitoring_subscriptions"."interval_seconds" = 86400)
);
--> statement-breakpoint
ALTER TABLE "monitoring_runs" ADD CONSTRAINT "monitoring_runs_monitoring_subscription_id_monitoring_subscriptions_id_fk" FOREIGN KEY ("monitoring_subscription_id") REFERENCES "public"."monitoring_subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitoring_runs" ADD CONSTRAINT "monitoring_runs_project_id_project_entitlements_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_entitlements"("project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitoring_runs" ADD CONSTRAINT "monitoring_runs_scan_request_id_scan_requests_id_fk" FOREIGN KEY ("scan_request_id") REFERENCES "public"."scan_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitoring_subscriptions" ADD CONSTRAINT "monitoring_subscriptions_project_id_project_entitlements_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_entitlements"("project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitoring_subscriptions" ADD CONSTRAINT "monitoring_subscriptions_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "monitoring_runs_idempotency_uidx" ON "monitoring_runs" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "monitoring_runs_slot_uidx" ON "monitoring_runs" USING btree ("monitoring_subscription_id","scheduled_for");--> statement-breakpoint
CREATE UNIQUE INDEX "monitoring_runs_one_open_uidx" ON "monitoring_runs" USING btree ("monitoring_subscription_id") WHERE "monitoring_runs"."state" = 'PROCESSING';--> statement-breakpoint
CREATE INDEX "monitoring_runs_project_state_idx" ON "monitoring_runs" USING btree ("project_id","state");--> statement-breakpoint
CREATE INDEX "monitoring_runs_lease_idx" ON "monitoring_runs" USING btree ("state","lease_expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "monitoring_subscriptions_project_uidx" ON "monitoring_subscriptions" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "monitoring_subscriptions_subscription_uidx" ON "monitoring_subscriptions" USING btree ("subscription_id");--> statement-breakpoint
CREATE INDEX "monitoring_subscriptions_due_idx" ON "monitoring_subscriptions" USING btree ("state","next_due_at");