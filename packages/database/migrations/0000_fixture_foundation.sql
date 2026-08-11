CREATE TYPE "public"."api_auth_outcome" AS ENUM('SUCCESS', 'NOT_FOUND', 'INVALID', 'REVOKED', 'RATE_LIMITED', 'COST_LIMITED');--> statement-breakpoint
CREATE TYPE "public"."api_key_environment" AS ENUM('test', 'live');--> statement-breakpoint
CREATE TYPE "public"."api_key_status" AS ENUM('ACTIVE', 'REVOKED');--> statement-breakpoint
CREATE TYPE "public"."delivery_status" AS ENUM('ACTIVE', 'DELIVERED', 'REVOKED', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."evidence_availability" AS ENUM('AVAILABLE', 'SOURCE_NO_LONGER_AVAILABLE', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."feedback_kind" AS ENUM('WOULD_USE', 'RELEVANT_WRONG_ANGLE', 'NOT_RELEVANT', 'USED_OR_PUBLISHED', 'REQUEST_ANOTHER_SCAN');--> statement-breakpoint
CREATE TYPE "public"."next_move_action" AS ENUM('PUBLISH', 'REPLY', 'REMIX', 'WAIT');--> statement-breakpoint
CREATE TYPE "public"."next_move_state" AS ENUM('DRAFT', 'APPROVED', 'READY', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."outcome_kind" AS ENUM('USED', 'PUBLISHED', 'REPLIED', 'REMIXED', 'SKIPPED', 'UNKNOWN');--> statement-breakpoint
CREATE TYPE "public"."review_action" AS ENUM('CONTEXT_EDITED', 'QUERY_PLAN_EDITED', 'EVIDENCE_REJECTED', 'MANUAL_EVIDENCE_ADDED', 'SOURCE_RERUN_REQUESTED', 'SYNTHESIS_RERUN_REQUESTED', 'APPROVED', 'EDITED_AND_APPROVED', 'CONVERTED_TO_WAIT', 'DELIVERED', 'MARKED_FAILED');--> statement-breakpoint
CREATE TYPE "public"."saturation" AS ENUM('low', 'low_to_medium', 'medium', 'high', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."scan_origin" AS ENUM('PUBLIC_FORM', 'API', 'OPS', 'FIXTURE');--> statement-breakpoint
CREATE TYPE "public"."scan_state" AS ENUM('QUEUED', 'RUNNING', 'REVIEW_REQUIRED', 'READY', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."signal_class" AS ENUM('MEASURED_EXTERNAL_SERIES', 'MEASURED_INTERNAL_VELOCITY', 'CORROBORATED_SIGNAL', 'EMERGING_SIGNAL', 'INSUFFICIENT_SIGNAL');--> statement-breakpoint
CREATE TYPE "public"."source_run_state" AS ENUM('PENDING', 'RUNNING', 'SUCCEEDED', 'DEGRADED', 'FAILED', 'SKIPPED');--> statement-breakpoint
CREATE TYPE "public"."source_slug" AS ENUM('website', 'x', 'google_trends', 'dataforseo_trends', 'hacker_news', 'github', 'tavily', 'youtube', 'manual', 'reddit');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('INCOMPLETE', 'TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'UNPAID', 'PAUSED');--> statement-breakpoint
CREATE TABLE "analytics_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"anonymous_session_hash" varchar(200),
	"scan_request_id" uuid,
	"next_move_id" uuid,
	"api_key_id" uuid,
	"referrer" varchar(500),
	"utm_source" varchar(200),
	"utm_medium" varchar(200),
	"utm_campaign" varchar(200),
	"first_landing_path" varchar(500),
	"first_touch" jsonb,
	"current_touch" jsonb,
	"properties" jsonb,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analytics_events_name_check" CHECK ("analytics_events"."name" IN ('landing_viewed','example_scan_viewed','free_scan_started','free_scan_submitted','scan_qualified','scan_processing_started','scan_review_required','scan_reviewed','scan_delivered','scan_result_viewed','scan_feedback_submitted','move_marked_used','second_scan_requested','api_key_issued','api_request_succeeded','pricing_viewed','checkout_started','subscription_started'))
);
--> statement-breakpoint
CREATE TABLE "api_key_auth_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"api_key_id" uuid,
	"presented_prefix" varchar(32),
	"outcome" "api_auth_outcome" NOT NULL,
	"requester_fingerprint_hash" varchar(200),
	"request_id" varchar(160),
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid,
	"name" varchar(200) NOT NULL,
	"visible_prefix" varchar(32) NOT NULL,
	"secret_hash" text NOT NULL,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"environment" "api_key_environment" NOT NULL,
	"status" "api_key_status" DEFAULT 'ACTIVE' NOT NULL,
	"rate_limit_per_hour" integer DEFAULT 20 NOT NULL,
	"provider_cost_limit_usd" numeric(10, 4) DEFAULT '5.0000' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "api_keys_rate_limit_positive_check" CHECK ("api_keys"."rate_limit_per_hour" > 0),
	CONSTRAINT "api_keys_cost_limit_nonnegative_check" CHECK ("api_keys"."provider_cost_limit_usd" >= 0),
	CONSTRAINT "api_keys_revocation_consistency_check" CHECK (("api_keys"."status" = 'REVOKED') = ("api_keys"."revoked_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "cluster_members" (
	"cluster_id" uuid NOT NULL,
	"signal_id" uuid NOT NULL,
	"similarity" numeric(6, 5) NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cluster_members_pk" PRIMARY KEY("cluster_id","signal_id"),
	CONSTRAINT "cluster_members_similarity_check" CHECK ("cluster_members"."similarity" >= 0 AND "cluster_members"."similarity" <= 1)
);
--> statement-breakpoint
CREATE TABLE "clusters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scan_run_id" uuid NOT NULL,
	"topic" varchar(500) NOT NULL,
	"summary" text,
	"signal_class" "signal_class" NOT NULL,
	"independent_source_count" integer DEFAULT 0 NOT NULL,
	"saturation" "saturation" DEFAULT 'unknown' NOT NULL,
	"score_components" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clusters_independent_source_count_check" CHECK ("clusters"."independent_source_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "delivery_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"next_move_id" uuid NOT NULL,
	"token_prefix" varchar(32) NOT NULL,
	"token_hash" varchar(100) NOT NULL,
	"status" "delivery_status" DEFAULT 'ACTIVE' NOT NULL,
	"public_share_consent" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"delivered_at" timestamp with time zone,
	"first_viewed_at" timestamp with time zone,
	"last_viewed_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "delivery_tokens_expiry_check" CHECK ("delivery_tokens"."expires_at" > "delivery_tokens"."created_at")
);
--> statement-breakpoint
CREATE TABLE "evidence_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"next_move_id" uuid NOT NULL,
	"signal_id" uuid NOT NULL,
	"source" "source_slug" NOT NULL,
	"provider" varchar(100) NOT NULL,
	"canonical_url" text NOT NULL,
	"title" varchar(500),
	"published_at" timestamp with time zone,
	"observed_at" timestamp with time zone NOT NULL,
	"reason" text NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"availability" "evidence_availability" DEFAULT 'AVAILABLE' NOT NULL,
	"reviewed_by" varchar(160),
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "evidence_receipts_verified_timestamp_check" CHECK ("evidence_receipts"."verified" = false OR "evidence_receipts"."verified_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "feedback_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"next_move_id" uuid NOT NULL,
	"delivery_token_id" uuid,
	"kind" "feedback_kind" NOT NULL,
	"free_text" text,
	"visitor_fingerprint_hash" varchar(200),
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feedback_events_free_text_length_check" CHECK ("feedback_events"."free_text" IS NULL OR length("feedback_events"."free_text") <= 2000)
);
--> statement-breakpoint
CREATE TABLE "next_moves" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"public_id" varchar(80) NOT NULL,
	"scan_request_id" uuid NOT NULL,
	"scan_run_id" uuid NOT NULL,
	"project_context_version_id" uuid NOT NULL,
	"opportunity_id" uuid,
	"state" "next_move_state" DEFAULT 'DRAFT' NOT NULL,
	"action" "next_move_action" NOT NULL,
	"channel" varchar(100) NOT NULL,
	"topic" varchar(500) NOT NULL,
	"angle" text NOT NULL,
	"format" varchar(100) NOT NULL,
	"hook" text NOT NULL,
	"outline" jsonb NOT NULL,
	"cta" text NOT NULL,
	"priority" integer NOT NULL,
	"confidence" numeric(6, 5) NOT NULL,
	"confidence_rationale" text,
	"why_now" text NOT NULL,
	"signal_class" "signal_class" NOT NULL,
	"independent_source_count" integer NOT NULL,
	"saturation" "saturation" NOT NULL,
	"limitations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"founder_reviewed" boolean DEFAULT false NOT NULL,
	"auto_publish" boolean DEFAULT false NOT NULL,
	"prompt_version" varchar(100) NOT NULL,
	"score_version" varchar(100) NOT NULL,
	"valid_until" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	CONSTRAINT "next_moves_priority_confidence_check" CHECK ("next_moves"."priority" BETWEEN 0 AND 100 AND "next_moves"."confidence" BETWEEN 0 AND 1),
	CONSTRAINT "next_moves_sources_nonnegative_check" CHECK ("next_moves"."independent_source_count" >= 0),
	CONSTRAINT "next_moves_never_autopublish_check" CHECK ("next_moves"."auto_publish" = false),
	CONSTRAINT "next_moves_review_consistency_check" CHECK ("next_moves"."state" NOT IN ('APPROVED', 'READY') OR ("next_moves"."founder_reviewed" = true AND "next_moves"."approved_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "opportunities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scan_run_id" uuid NOT NULL,
	"cluster_id" uuid,
	"rank" integer NOT NULL,
	"action_candidate" "next_move_action" NOT NULL,
	"channel" varchar(100) NOT NULL,
	"format" varchar(100) NOT NULL,
	"total_score" numeric(8, 6) NOT NULL,
	"score_components" jsonb NOT NULL,
	"passes_quality_floor" boolean DEFAULT false NOT NULL,
	"rejection_reason" text,
	"valid_until" timestamp with time zone,
	"score_version" varchar(100) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "opportunities_rank_positive_check" CHECK ("opportunities"."rank" > 0),
	CONSTRAINT "opportunities_score_range_check" CHECK ("opportunities"."total_score" >= -1 AND "opportunities"."total_score" <= 1)
);
--> statement-breakpoint
CREATE TABLE "outcomes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"next_move_id" uuid NOT NULL,
	"kind" "outcome_kind" NOT NULL,
	"public_url" text,
	"notes" text,
	"reported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outcomes_verified_timestamp_check" CHECK ("outcomes"."verified" = false OR "outcomes"."verified_at" IS NOT NULL),
	CONSTRAINT "outcomes_notes_length_check" CHECK ("outcomes"."notes" IS NULL OR length("outcomes"."notes") <= 2000)
);
--> statement-breakpoint
CREATE TABLE "project_context_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"is_current" boolean DEFAULT true NOT NULL,
	"inferred_name" varchar(200) NOT NULL,
	"category" varchar(500) NOT NULL,
	"audience" text NOT NULL,
	"problem" text NOT NULL,
	"language" varchar(35) NOT NULL,
	"credible_topics" jsonb NOT NULL,
	"assumptions" jsonb NOT NULL,
	"context" jsonb NOT NULL,
	"source_content_hash" varchar(200),
	"prompt_version" varchar(100),
	"model" varchar(200),
	"created_by" varchar(160) DEFAULT 'system' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_context_version_positive_check" CHECK ("project_context_versions"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"public_id" varchar(80) NOT NULL,
	"name" varchar(200),
	"url" text NOT NULL,
	"normalized_url" text NOT NULL,
	"status" varchar(20) DEFAULT 'ACTIVE' NOT NULL,
	"public_case_study_consent" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "projects_status_check" CHECK ("projects"."status" IN ('ACTIVE', 'ARCHIVED')),
	CONSTRAINT "projects_url_length_check" CHECK (length("projects"."url") <= 2048)
);
--> statement-breakpoint
CREATE TABLE "provider_cost_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scan_run_id" uuid NOT NULL,
	"source_run_id" uuid,
	"provider" varchar(100) NOT NULL,
	"operation" varchar(160) NOT NULL,
	"provider_request_id" varchar(200),
	"estimated_cost_usd" numeric(10, 6) DEFAULT '0' NOT NULL,
	"actual_cost_usd" numeric(10, 6) DEFAULT '0' NOT NULL,
	"quota_units" numeric(14, 4) DEFAULT '0' NOT NULL,
	"unit_metadata" jsonb,
	"currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_cost_nonnegative_check" CHECK ("provider_cost_ledger"."estimated_cost_usd" >= 0 AND "provider_cost_ledger"."actual_cost_usd" >= 0 AND "provider_cost_ledger"."quota_units" >= 0),
	CONSTRAINT "provider_cost_currency_check" CHECK ("provider_cost_ledger"."currency" = 'USD')
);
--> statement-breakpoint
CREATE TABLE "review_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scan_request_id" uuid NOT NULL,
	"scan_run_id" uuid,
	"next_move_id" uuid,
	"action" "review_action" NOT NULL,
	"reviewer_id" varchar(160) NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_events_note_length_check" CHECK ("review_events"."note" IS NULL OR length("review_events"."note") <= 4000)
);
--> statement-breakpoint
CREATE TABLE "scan_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"public_id" varchar(80) NOT NULL,
	"project_id" uuid,
	"api_key_id" uuid,
	"origin" "scan_origin" NOT NULL,
	"state" "scan_state" DEFAULT 'QUEUED' NOT NULL,
	"submitted_url" text NOT NULL,
	"normalized_url" text NOT NULL,
	"goal" varchar(100),
	"market" varchar(50),
	"language" varchar(35),
	"preferred_channels" jsonb,
	"available_formats" jsonb,
	"idempotency_key_hash" varchar(200),
	"requester_fingerprint_hash" varchar(200),
	"failure_code" varchar(100),
	"failure_message" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	CONSTRAINT "scan_requests_url_length_check" CHECK (length("scan_requests"."submitted_url") <= 2048),
	CONSTRAINT "scan_requests_terminal_timestamp_check" CHECK ("scan_requests"."state" NOT IN ('READY', 'FAILED') OR "scan_requests"."completed_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "scan_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scan_request_id" uuid NOT NULL,
	"project_context_version_id" uuid,
	"attempt" integer DEFAULT 1 NOT NULL,
	"state" "scan_state" DEFAULT 'QUEUED' NOT NULL,
	"query_plan" jsonb,
	"query_plan_version" varchar(100),
	"score_version" varchar(100),
	"prompt_version" varchar(100),
	"model_input" jsonb,
	"model_output" jsonb,
	"source_coverage" jsonb,
	"signal_class" "signal_class",
	"estimated_cost_usd" numeric(10, 6) DEFAULT '0' NOT NULL,
	"actual_cost_usd" numeric(10, 6) DEFAULT '0' NOT NULL,
	"hard_deadline_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"review_required_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"failure_code" varchar(100),
	"failure_message" varchar(500),
	CONSTRAINT "scan_runs_attempt_positive_check" CHECK ("scan_runs"."attempt" > 0),
	CONSTRAINT "scan_runs_cost_nonnegative_check" CHECK ("scan_runs"."estimated_cost_usd" >= 0 AND "scan_runs"."actual_cost_usd" >= 0)
);
--> statement-breakpoint
CREATE TABLE "signal_metric_snapshots" (
	"signal_id" uuid NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"metrics" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "signal_metric_snapshots_pk" PRIMARY KEY("signal_id","observed_at")
);
--> statement-breakpoint
CREATE TABLE "signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_run_id" uuid NOT NULL,
	"source" "source_slug" NOT NULL,
	"source_id" varchar(300) NOT NULL,
	"canonical_url" text NOT NULL,
	"title" varchar(500),
	"text_excerpt" text,
	"author" jsonb,
	"published_at" timestamp with time zone,
	"observed_at" timestamp with time zone NOT NULL,
	"language" varchar(35),
	"metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"query_id" varchar(160) NOT NULL,
	"provider" varchar(100) NOT NULL,
	"provider_request_id" varchar(200),
	"retrieved_at" timestamp with time zone NOT NULL,
	"cached" boolean DEFAULT false NOT NULL,
	"raw_payload_hash" varchar(200),
	"provenance" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "signals_url_length_check" CHECK (length("signals"."canonical_url") <= 2048),
	CONSTRAINT "signals_excerpt_length_check" CHECK ("signals"."text_excerpt" IS NULL OR length("signals"."text_excerpt") <= 4000)
);
--> statement-breakpoint
CREATE TABLE "source_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scan_run_id" uuid NOT NULL,
	"source" "source_slug" NOT NULL,
	"provider" varchar(100) NOT NULL,
	"state" "source_run_state" DEFAULT 'PENDING' NOT NULL,
	"query_plan_fragment" jsonb,
	"max_calls" integer NOT NULL,
	"calls_made" integer DEFAULT 0 NOT NULL,
	"candidate_count" integer DEFAULT 0 NOT NULL,
	"estimated_cost_usd" numeric(10, 6) DEFAULT '0' NOT NULL,
	"actual_cost_usd" numeric(10, 6) DEFAULT '0' NOT NULL,
	"quota_used" numeric(14, 4) DEFAULT '0' NOT NULL,
	"duration_ms" integer,
	"provider_payload_fragment" jsonb,
	"failure_code" varchar(100),
	"failure_message" varchar(500),
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_runs_bounds_check" CHECK ("source_runs"."max_calls" >= 0 AND "source_runs"."calls_made" >= 0 AND "source_runs"."calls_made" <= "source_runs"."max_calls" AND "source_runs"."candidate_count" >= 0),
	CONSTRAINT "source_runs_cost_nonnegative_check" CHECK ("source_runs"."estimated_cost_usd" >= 0 AND "source_runs"."actual_cost_usd" >= 0 AND "source_runs"."quota_used" >= 0)
);
--> statement-breakpoint
CREATE TABLE "stripe_customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid,
	"stripe_customer_id" varchar(255) NOT NULL,
	"email_hash" varchar(200),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stripe_customer_id" uuid NOT NULL,
	"stripe_subscription_id" varchar(255) NOT NULL,
	"stripe_price_id" varchar(255) NOT NULL,
	"entitlement" varchar(100) DEFAULT 'founder_cloud' NOT NULL,
	"status" "subscription_status" NOT NULL,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"current_period_start" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"canceled_at" timestamp with time zone,
	"last_stripe_event_id" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_entitlement_check" CHECK ("subscriptions"."entitlement" = 'founder_cloud')
);
--> statement-breakpoint
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_scan_request_id_scan_requests_id_fk" FOREIGN KEY ("scan_request_id") REFERENCES "public"."scan_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_next_move_id_next_moves_id_fk" FOREIGN KEY ("next_move_id") REFERENCES "public"."next_moves"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_key_auth_events" ADD CONSTRAINT "api_key_auth_events_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cluster_members" ADD CONSTRAINT "cluster_members_cluster_id_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."clusters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cluster_members" ADD CONSTRAINT "cluster_members_signal_id_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."signals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clusters" ADD CONSTRAINT "clusters_scan_run_id_scan_runs_id_fk" FOREIGN KEY ("scan_run_id") REFERENCES "public"."scan_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_tokens" ADD CONSTRAINT "delivery_tokens_next_move_id_next_moves_id_fk" FOREIGN KEY ("next_move_id") REFERENCES "public"."next_moves"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_receipts" ADD CONSTRAINT "evidence_receipts_next_move_id_next_moves_id_fk" FOREIGN KEY ("next_move_id") REFERENCES "public"."next_moves"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_receipts" ADD CONSTRAINT "evidence_receipts_signal_id_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."signals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_events" ADD CONSTRAINT "feedback_events_next_move_id_next_moves_id_fk" FOREIGN KEY ("next_move_id") REFERENCES "public"."next_moves"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback_events" ADD CONSTRAINT "feedback_events_delivery_token_id_delivery_tokens_id_fk" FOREIGN KEY ("delivery_token_id") REFERENCES "public"."delivery_tokens"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "next_moves" ADD CONSTRAINT "next_moves_scan_request_id_scan_requests_id_fk" FOREIGN KEY ("scan_request_id") REFERENCES "public"."scan_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "next_moves" ADD CONSTRAINT "next_moves_scan_run_id_scan_runs_id_fk" FOREIGN KEY ("scan_run_id") REFERENCES "public"."scan_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "next_moves" ADD CONSTRAINT "next_moves_project_context_version_id_project_context_versions_id_fk" FOREIGN KEY ("project_context_version_id") REFERENCES "public"."project_context_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "next_moves" ADD CONSTRAINT "next_moves_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_scan_run_id_scan_runs_id_fk" FOREIGN KEY ("scan_run_id") REFERENCES "public"."scan_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_cluster_id_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."clusters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outcomes" ADD CONSTRAINT "outcomes_next_move_id_next_moves_id_fk" FOREIGN KEY ("next_move_id") REFERENCES "public"."next_moves"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_context_versions" ADD CONSTRAINT "project_context_versions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_cost_ledger" ADD CONSTRAINT "provider_cost_ledger_scan_run_id_scan_runs_id_fk" FOREIGN KEY ("scan_run_id") REFERENCES "public"."scan_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_cost_ledger" ADD CONSTRAINT "provider_cost_ledger_source_run_id_source_runs_id_fk" FOREIGN KEY ("source_run_id") REFERENCES "public"."source_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_events" ADD CONSTRAINT "review_events_scan_request_id_scan_requests_id_fk" FOREIGN KEY ("scan_request_id") REFERENCES "public"."scan_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_events" ADD CONSTRAINT "review_events_scan_run_id_scan_runs_id_fk" FOREIGN KEY ("scan_run_id") REFERENCES "public"."scan_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_events" ADD CONSTRAINT "review_events_next_move_id_next_moves_id_fk" FOREIGN KEY ("next_move_id") REFERENCES "public"."next_moves"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_requests" ADD CONSTRAINT "scan_requests_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_requests" ADD CONSTRAINT "scan_requests_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_runs" ADD CONSTRAINT "scan_runs_scan_request_id_scan_requests_id_fk" FOREIGN KEY ("scan_request_id") REFERENCES "public"."scan_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_runs" ADD CONSTRAINT "scan_runs_project_context_version_id_project_context_versions_id_fk" FOREIGN KEY ("project_context_version_id") REFERENCES "public"."project_context_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_metric_snapshots" ADD CONSTRAINT "signal_metric_snapshots_signal_id_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."signals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signals" ADD CONSTRAINT "signals_source_run_id_source_runs_id_fk" FOREIGN KEY ("source_run_id") REFERENCES "public"."source_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_runs" ADD CONSTRAINT "source_runs_scan_run_id_scan_runs_id_fk" FOREIGN KEY ("scan_run_id") REFERENCES "public"."scan_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stripe_customers" ADD CONSTRAINT "stripe_customers_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_stripe_customer_id_stripe_customers_id_fk" FOREIGN KEY ("stripe_customer_id") REFERENCES "public"."stripe_customers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "analytics_events_name_occurred_idx" ON "analytics_events" USING btree ("name","occurred_at");--> statement-breakpoint
CREATE INDEX "analytics_events_scan_occurred_idx" ON "analytics_events" USING btree ("scan_request_id","occurred_at");--> statement-breakpoint
CREATE INDEX "api_key_auth_events_key_occurred_idx" ON "api_key_auth_events" USING btree ("api_key_id","occurred_at");--> statement-breakpoint
CREATE INDEX "api_key_auth_events_outcome_occurred_idx" ON "api_key_auth_events" USING btree ("outcome","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_environment_prefix_uidx" ON "api_keys" USING btree ("environment","visible_prefix");--> statement-breakpoint
CREATE INDEX "api_keys_project_status_idx" ON "api_keys" USING btree ("project_id","status");--> statement-breakpoint
CREATE INDEX "cluster_members_signal_idx" ON "cluster_members" USING btree ("signal_id");--> statement-breakpoint
CREATE INDEX "clusters_scan_signal_class_idx" ON "clusters" USING btree ("scan_run_id","signal_class");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_tokens_hash_uidx" ON "delivery_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_tokens_prefix_uidx" ON "delivery_tokens" USING btree ("token_prefix");--> statement-breakpoint
CREATE INDEX "delivery_tokens_move_status_idx" ON "delivery_tokens" USING btree ("next_move_id","status");--> statement-breakpoint
CREATE INDEX "delivery_tokens_expiry_idx" ON "delivery_tokens" USING btree ("status","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "evidence_receipts_move_signal_uidx" ON "evidence_receipts" USING btree ("next_move_id","signal_id");--> statement-breakpoint
CREATE INDEX "evidence_receipts_move_availability_idx" ON "evidence_receipts" USING btree ("next_move_id","availability");--> statement-breakpoint
CREATE INDEX "feedback_events_move_created_idx" ON "feedback_events" USING btree ("next_move_id","created_at");--> statement-breakpoint
CREATE INDEX "feedback_events_kind_created_idx" ON "feedback_events" USING btree ("kind","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "next_moves_public_id_uidx" ON "next_moves" USING btree ("public_id");--> statement-breakpoint
CREATE UNIQUE INDEX "next_moves_scan_run_uidx" ON "next_moves" USING btree ("scan_run_id");--> statement-breakpoint
CREATE INDEX "next_moves_scan_request_state_idx" ON "next_moves" USING btree ("scan_request_id","state");--> statement-breakpoint
CREATE UNIQUE INDEX "opportunities_scan_rank_uidx" ON "opportunities" USING btree ("scan_run_id","rank");--> statement-breakpoint
CREATE INDEX "opportunities_scan_floor_score_idx" ON "opportunities" USING btree ("scan_run_id","passes_quality_floor","total_score");--> statement-breakpoint
CREATE INDEX "outcomes_move_reported_idx" ON "outcomes" USING btree ("next_move_id","reported_at");--> statement-breakpoint
CREATE UNIQUE INDEX "project_context_project_version_uidx" ON "project_context_versions" USING btree ("project_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "project_context_one_current_uidx" ON "project_context_versions" USING btree ("project_id") WHERE "project_context_versions"."is_current" = true;--> statement-breakpoint
CREATE INDEX "project_context_language_category_idx" ON "project_context_versions" USING btree ("language","category");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_public_id_uidx" ON "projects" USING btree ("public_id");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_normalized_url_uidx" ON "projects" USING btree ("normalized_url");--> statement-breakpoint
CREATE INDEX "projects_status_created_idx" ON "projects" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "provider_cost_scan_occurred_idx" ON "provider_cost_ledger" USING btree ("scan_run_id","occurred_at");--> statement-breakpoint
CREATE INDEX "provider_cost_provider_occurred_idx" ON "provider_cost_ledger" USING btree ("provider","occurred_at");--> statement-breakpoint
CREATE INDEX "review_events_request_created_idx" ON "review_events" USING btree ("scan_request_id","created_at");--> statement-breakpoint
CREATE INDEX "review_events_move_created_idx" ON "review_events" USING btree ("next_move_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "scan_requests_public_id_uidx" ON "scan_requests" USING btree ("public_id");--> statement-breakpoint
CREATE UNIQUE INDEX "scan_requests_api_idempotency_uidx" ON "scan_requests" USING btree ("api_key_id","idempotency_key_hash") WHERE "scan_requests"."idempotency_key_hash" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "scan_requests_queue_idx" ON "scan_requests" USING btree ("state","submitted_at");--> statement-breakpoint
CREATE INDEX "scan_requests_project_created_idx" ON "scan_requests" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "scan_requests_fingerprint_created_idx" ON "scan_requests" USING btree ("requester_fingerprint_hash","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "scan_runs_request_attempt_uidx" ON "scan_runs" USING btree ("scan_request_id","attempt");--> statement-breakpoint
CREATE UNIQUE INDEX "scan_runs_one_active_uidx" ON "scan_runs" USING btree ("scan_request_id") WHERE "scan_runs"."state" IN ('QUEUED', 'RUNNING', 'REVIEW_REQUIRED');--> statement-breakpoint
CREATE INDEX "scan_runs_state_updated_idx" ON "scan_runs" USING btree ("state","updated_at");--> statement-breakpoint
CREATE INDEX "signal_metric_snapshots_observed_idx" ON "signal_metric_snapshots" USING btree ("observed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "signals_source_source_id_uidx" ON "signals" USING btree ("source","source_id");--> statement-breakpoint
CREATE INDEX "signals_source_observed_idx" ON "signals" USING btree ("source","observed_at");--> statement-breakpoint
CREATE INDEX "signals_query_observed_idx" ON "signals" USING btree ("query_id","observed_at");--> statement-breakpoint
CREATE INDEX "signals_canonical_url_idx" ON "signals" USING btree ("canonical_url");--> statement-breakpoint
CREATE UNIQUE INDEX "source_runs_scan_source_provider_uidx" ON "source_runs" USING btree ("scan_run_id","source","provider");--> statement-breakpoint
CREATE INDEX "source_runs_state_updated_idx" ON "source_runs" USING btree ("state","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "stripe_customers_external_uidx" ON "stripe_customers" USING btree ("stripe_customer_id");--> statement-breakpoint
CREATE INDEX "stripe_customers_project_idx" ON "stripe_customers" USING btree ("project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_external_uidx" ON "subscriptions" USING btree ("stripe_subscription_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_last_event_uidx" ON "subscriptions" USING btree ("last_stripe_event_id") WHERE "subscriptions"."last_stripe_event_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "subscriptions_customer_status_idx" ON "subscriptions" USING btree ("stripe_customer_id","status");