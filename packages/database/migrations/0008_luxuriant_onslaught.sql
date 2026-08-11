CREATE TYPE "public"."api_key_management_action" AS ENUM('ISSUED', 'REVOKED', 'ROTATED', 'REISSUED');--> statement-breakpoint
CREATE TYPE "public"."evidence_binding_role" AS ENUM('DECISION_SUPPORT', 'SUPPLEMENTAL');--> statement-breakpoint
CREATE TYPE "public"."provider_verification_state" AS ENUM('RUNNING', 'VERIFIED', 'DEGRADED', 'FAILED', 'UNCONFIGURED', 'FIXTURE', 'LEGAL_REVIEW');--> statement-breakpoint
CREATE TABLE "api_key_management_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid,
	"api_key_id" uuid,
	"related_api_key_id" uuid,
	"action" "api_key_management_action" NOT NULL,
	"actor_id" varchar(160) NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_key_management_actor_check" CHECK (length("api_key_management_events"."actor_id") BETWEEN 1 AND 160)
);
--> statement-breakpoint
CREATE TABLE "provider_verification_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" "source_slug" NOT NULL,
	"provider" varchar(100) NOT NULL,
	"state" "provider_verification_state" NOT NULL,
	"credential_mode" varchar(20) NOT NULL,
	"deployment_environment" varchar(20) NOT NULL,
	"release_sha" varchar(100),
	"deployment_host" varchar(255),
	"deployment_id" varchar(255),
	"health_status" varchar(20),
	"readback_verified" boolean DEFAULT false NOT NULL,
	"canonical_urls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"latency_ms" integer,
	"estimated_cost_usd" numeric(10, 6) DEFAULT '0' NOT NULL,
	"actual_cost_usd" numeric(10, 6),
	"quota_used" numeric(14, 4) DEFAULT '0' NOT NULL,
	"limitations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"failure_code" varchar(100),
	"failure_message" varchar(500),
	"initiated_by" varchar(160) NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"checked_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_verification_credential_mode_check" CHECK ("provider_verification_records"."credential_mode" IN ('fixture', 'managed', 'byok', 'none')),
	CONSTRAINT "provider_verification_deployment_environment_check" CHECK ("provider_verification_records"."deployment_environment" IN ('local', 'preview', 'production')),
	CONSTRAINT "provider_verification_production_identity_check" CHECK ("provider_verification_records"."deployment_environment" <> 'production' OR ("provider_verification_records"."release_sha" IS NOT NULL AND length("provider_verification_records"."release_sha") >= 7 AND "provider_verification_records"."deployment_host" IS NOT NULL AND length("provider_verification_records"."deployment_host") >= 3)),
	CONSTRAINT "provider_verification_health_status_check" CHECK ("provider_verification_records"."health_status" IS NULL OR "provider_verification_records"."health_status" IN ('HEALTHY', 'DEGRADED', 'UNCONFIGURED', 'FAILED')),
	CONSTRAINT "provider_verification_cost_check" CHECK ("provider_verification_records"."estimated_cost_usd" >= 0 AND ("provider_verification_records"."actual_cost_usd" IS NULL OR "provider_verification_records"."actual_cost_usd" >= 0) AND "provider_verification_records"."quota_used" >= 0),
	CONSTRAINT "provider_verification_latency_check" CHECK ("provider_verification_records"."latency_ms" IS NULL OR "provider_verification_records"."latency_ms" >= 0),
	CONSTRAINT "provider_verification_completion_check" CHECK (("provider_verification_records"."state" = 'RUNNING') = ("provider_verification_records"."completed_at" IS NULL)),
	CONSTRAINT "provider_verification_truth_check" CHECK ("provider_verification_records"."state" <> 'VERIFIED' OR ("provider_verification_records"."readback_verified" = true AND jsonb_array_length("provider_verification_records"."canonical_urls") > 0))
);
--> statement-breakpoint
ALTER TABLE "evidence_receipts" ADD COLUMN "binding_role" "evidence_binding_role" DEFAULT 'DECISION_SUPPORT' NOT NULL;--> statement-breakpoint
ALTER TABLE "api_key_management_events" ADD CONSTRAINT "api_key_management_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_key_management_events" ADD CONSTRAINT "api_key_management_events_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_key_management_events" ADD CONSTRAINT "api_key_management_events_related_api_key_id_api_keys_id_fk" FOREIGN KEY ("related_api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_key_management_project_occurred_idx" ON "api_key_management_events" USING btree ("project_id","occurred_at");--> statement-breakpoint
CREATE INDEX "api_key_management_key_occurred_idx" ON "api_key_management_events" USING btree ("api_key_id","occurred_at");--> statement-breakpoint
CREATE INDEX "provider_verification_source_completed_idx" ON "provider_verification_records" USING btree ("source","completed_at");--> statement-breakpoint
CREATE INDEX "provider_verification_state_completed_idx" ON "provider_verification_records" USING btree ("state","completed_at");