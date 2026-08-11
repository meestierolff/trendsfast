CREATE TABLE "founder_launch_interest_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"interest_reference" uuid NOT NULL,
	"action" varchar(20) NOT NULL,
	"actor_id" varchar(100) NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "founder_launch_interest_events_action_check" CHECK ("founder_launch_interest_events"."action" IN ('JOINED','RECONSENTED','DELETED','PURGED'))
);
--> statement-breakpoint
CREATE TABLE "founder_launch_interests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(254) NOT NULL,
	"email_hash" varchar(64) NOT NULL,
	"consent_version" varchar(40) NOT NULL,
	"consented_at" timestamp with time zone NOT NULL,
	"source" varchar(32) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "founder_launch_interests_email_normalized_check" CHECK ("founder_launch_interests"."email" = lower(btrim("founder_launch_interests"."email")) AND position('@' in "founder_launch_interests"."email") > 1),
	CONSTRAINT "founder_launch_interests_email_hash_check" CHECK ("founder_launch_interests"."email_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "founder_launch_interests_consent_version_check" CHECK ("founder_launch_interests"."consent_version" = 'founder-launch-v1'),
	CONSTRAINT "founder_launch_interests_source_check" CHECK ("founder_launch_interests"."source" IN ('homepage','pricing')),
	CONSTRAINT "founder_launch_interests_expiry_check" CHECK ("founder_launch_interests"."expires_at" > "founder_launch_interests"."consented_at")
);
--> statement-breakpoint
ALTER TABLE "analytics_events" DROP CONSTRAINT "analytics_events_name_check";--> statement-breakpoint
ALTER TABLE "analytics_events" ADD COLUMN "dedupe_key" varchar(64);--> statement-breakpoint
CREATE INDEX "founder_launch_interest_events_reference_idx" ON "founder_launch_interest_events" USING btree ("interest_reference","occurred_at");--> statement-breakpoint
CREATE INDEX "founder_launch_interest_events_action_idx" ON "founder_launch_interest_events" USING btree ("action","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "founder_launch_interests_email_hash_uidx" ON "founder_launch_interests" USING btree ("email_hash");--> statement-breakpoint
CREATE INDEX "founder_launch_interests_expires_idx" ON "founder_launch_interests" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_events_dedupe_uidx" ON "analytics_events" USING btree ("dedupe_key") WHERE "analytics_events"."dedupe_key" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_dedupe_key_check" CHECK ("analytics_events"."dedupe_key" IS NULL OR "analytics_events"."dedupe_key" ~ '^[0-9a-f]{64}$');--> statement-breakpoint
UPDATE "analytics_events" SET "anonymous_session_hash" = NULL WHERE "anonymous_session_hash" IS NOT NULL AND "anonymous_session_hash" !~ '^[0-9a-f]{64}$';--> statement-breakpoint
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_session_hash_check" CHECK ("analytics_events"."anonymous_session_hash" IS NULL OR "analytics_events"."anonymous_session_hash" ~ '^[0-9a-f]{64}$');--> statement-breakpoint
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_name_check" CHECK ("analytics_events"."name" IN ('landing_viewed','hero_cta_clicked','demo_viewed','free_scan_submitted','scan_status_viewed','scan_delivered','evidence_opened','feedback_submitted','move_would_use','move_used','repeat_scan_requested','agents_page_viewed','docs_viewed','pricing_viewed','beta_waitlist_joined','checkout_started','subscription_started','example_scan_viewed','free_scan_started','scan_qualified','scan_processing_started','scan_review_required','scan_reviewed','scan_result_viewed','scan_feedback_submitted','move_marked_used','second_scan_requested','api_key_issued','api_request_succeeded'));
