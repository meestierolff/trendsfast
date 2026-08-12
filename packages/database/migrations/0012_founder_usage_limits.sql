CREATE TYPE "public"."founder_usage_kind" AS ENUM('SCHEDULED_RUN_ACCEPTED', 'ON_DEMAND_RUN_ACCEPTED', 'NEXT_MOVE_DELIVERED');--> statement-breakpoint
CREATE TABLE "founder_usage_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"subscription_id" uuid,
	"scan_request_id" uuid,
	"kind" "founder_usage_kind" NOT NULL,
	"idempotency_key" varchar(255) NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "founder_usage_period_check" CHECK ("founder_usage_events"."period_start" < "founder_usage_events"."period_end"),
	CONSTRAINT "founder_usage_occurrence_period_check" CHECK ("founder_usage_events"."occurred_at" >= "founder_usage_events"."period_start" AND "founder_usage_events"."occurred_at" < "founder_usage_events"."period_end")
);
--> statement-breakpoint
ALTER TABLE "founder_usage_events" ADD CONSTRAINT "founder_usage_events_project_id_project_entitlements_project_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."project_entitlements"("project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "founder_usage_events" ADD CONSTRAINT "founder_usage_events_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "founder_usage_events" ADD CONSTRAINT "founder_usage_events_scan_request_id_scan_requests_id_fk" FOREIGN KEY ("scan_request_id") REFERENCES "public"."scan_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "founder_usage_idempotency_uidx" ON "founder_usage_events" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "founder_usage_project_kind_occurred_idx" ON "founder_usage_events" USING btree ("project_id","kind","occurred_at");--> statement-breakpoint
CREATE INDEX "founder_usage_scan_kind_idx" ON "founder_usage_events" USING btree ("scan_request_id","kind");