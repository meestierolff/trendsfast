CREATE TYPE "public"."app_membership_role" AS ENUM('OWNER', 'MEMBER');--> statement-breakpoint
CREATE TYPE "public"."generation_level" AS ENUM('brief', 'draft');--> statement-breakpoint
CREATE TYPE "public"."project_claim_outcome" AS ENUM('CLAIMED', 'ALREADY_OWNER', 'OWNERSHIP_CONFLICT');--> statement-breakpoint
CREATE TYPE "public"."project_entity_type" AS ENUM('PRODUCT', 'BRAND', 'CREATOR_LED_BRAND');--> statement-breakpoint
CREATE TABLE "project_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"delivery_token_id" uuid NOT NULL,
	"claim_secret_hash" varchar(71) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"consumed_by_user_profile_id" uuid,
	"consumption_outcome" "project_claim_outcome",
	"invalidated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_claims_secret_hash_check" CHECK ("project_claims"."claim_secret_hash" ~ '^sha256:[0-9a-f]{64}$'),
	CONSTRAINT "project_claims_expiry_check" CHECK ("project_claims"."expires_at" > "project_claims"."created_at"),
	CONSTRAINT "project_claims_consumption_shape_check" CHECK ((
        "project_claims"."consumed_at" IS NULL
        AND "project_claims"."consumed_by_user_profile_id" IS NULL
        AND "project_claims"."consumption_outcome" IS NULL
      ) OR (
        "project_claims"."consumed_at" IS NOT NULL
        AND "project_claims"."consumed_by_user_profile_id" IS NOT NULL
        AND "project_claims"."consumption_outcome" IS NOT NULL
        AND "project_claims"."consumed_at" >= "project_claims"."created_at"
      )),
	CONSTRAINT "project_claims_invalidation_check" CHECK ((
        "project_claims"."invalidated_at" IS NULL
        OR (
          "project_claims"."consumed_at" IS NULL
          AND "project_claims"."invalidated_at" >= "project_claims"."created_at"
        )
      ))
);
--> statement-breakpoint
CREATE TABLE "project_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"user_profile_id" uuid NOT NULL,
	"role" "app_membership_role" DEFAULT 'OWNER' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"auth_user_id" uuid NOT NULL,
	"email" varchar(254) NOT NULL,
	"display_name" varchar(200),
	"avatar_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_profiles_email_normalized_check" CHECK ("user_profiles"."email" = lower(btrim("user_profiles"."email")) AND position('@' in "user_profiles"."email") > 1),
	CONSTRAINT "user_profiles_avatar_url_check" CHECK ("user_profiles"."avatar_url" IS NULL OR (length("user_profiles"."avatar_url") <= 2048 AND "user_profiles"."avatar_url" ~ '^https?://'))
);
--> statement-breakpoint
ALTER TABLE "next_moves" ADD COLUMN "decision_contract_version" varchar(40);--> statement-breakpoint
ALTER TABLE "next_moves" ADD COLUMN "action_details" jsonb;--> statement-breakpoint
ALTER TABLE "next_moves" ADD COLUMN "trend_window" jsonb;--> statement-breakpoint
ALTER TABLE "next_moves" ADD COLUMN "breakout_potential" jsonb;--> statement-breakpoint
ALTER TABLE "next_moves" ADD COLUMN "generation_level" "generation_level" DEFAULT 'brief' NOT NULL;--> statement-breakpoint
ALTER TABLE "next_moves" ADD COLUMN "draft_content" text;--> statement-breakpoint
UPDATE "next_moves"
SET "proposal_stale" = true,
    "updated_at" = now()
WHERE "proposal_stale" = false;--> statement-breakpoint
ALTER TABLE "project_context_versions" ADD COLUMN "entity_type" "project_entity_type" DEFAULT 'PRODUCT' NOT NULL;--> statement-breakpoint
ALTER TABLE "project_context_versions" ADD COLUMN "context_provenance" jsonb DEFAULT '{"observed_facts":[],"inferred_context":[],"assumptions":[]}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "project_context_versions" ADD COLUMN "voice_profile" jsonb DEFAULT '{"traits":[],"preferred_phrases":[],"avoid_phrases":[],"sample_texts":[],"sample_urls":[]}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "project_context_versions" ADD COLUMN "content_capabilities" jsonb DEFAULT '{"founder_text":true,"founder_on_camera":false,"screen_recording":false,"ai_avatar":false,"carousel":false,"product_demo":false,"long_form":false}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "scan_requests" ADD COLUMN "generation_level" "generation_level" DEFAULT 'brief' NOT NULL;--> statement-breakpoint
ALTER TABLE "scan_requests" ADD COLUMN "requested_content_capabilities" jsonb;--> statement-breakpoint
ALTER TABLE "project_claims" ADD CONSTRAINT "project_claims_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_claims" ADD CONSTRAINT "project_claims_delivery_token_id_delivery_tokens_id_fk" FOREIGN KEY ("delivery_token_id") REFERENCES "public"."delivery_tokens"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_claims" ADD CONSTRAINT "project_claims_consumed_by_user_profile_id_user_profiles_id_fk" FOREIGN KEY ("consumed_by_user_profile_id") REFERENCES "public"."user_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_memberships" ADD CONSTRAINT "project_memberships_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_memberships" ADD CONSTRAINT "project_memberships_user_profile_id_user_profiles_id_fk" FOREIGN KEY ("user_profile_id") REFERENCES "public"."user_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_claims_secret_hash_uidx" ON "project_claims" USING btree ("claim_secret_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "project_claims_delivery_open_uidx" ON "project_claims" USING btree ("delivery_token_id") WHERE "project_claims"."consumed_at" IS NULL AND "project_claims"."invalidated_at" IS NULL;--> statement-breakpoint
CREATE INDEX "project_claims_project_created_idx" ON "project_claims" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "project_claims_delivery_created_idx" ON "project_claims" USING btree ("delivery_token_id","created_at");--> statement-breakpoint
CREATE INDEX "project_claims_expiry_idx" ON "project_claims" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "project_memberships_project_user_uidx" ON "project_memberships" USING btree ("project_id","user_profile_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_memberships_one_owner_uidx" ON "project_memberships" USING btree ("project_id") WHERE "project_memberships"."role" = 'OWNER';--> statement-breakpoint
CREATE INDEX "project_memberships_user_created_idx" ON "project_memberships" USING btree ("user_profile_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "user_profiles_auth_user_uidx" ON "user_profiles" USING btree ("auth_user_id");--> statement-breakpoint
CREATE INDEX "user_profiles_email_idx" ON "user_profiles" USING btree ("email");--> statement-breakpoint
CREATE INDEX "next_moves_valid_until_state_idx" ON "next_moves" USING btree ("valid_until","state");--> statement-breakpoint
CREATE INDEX "scan_requests_project_generation_created_idx" ON "scan_requests" USING btree ("project_id","generation_level","created_at");--> statement-breakpoint
ALTER TABLE "next_moves" ADD CONSTRAINT "next_moves_decision_contract_shape_check" CHECK ((
        "next_moves"."decision_contract_version" IS NULL
        AND "next_moves"."action_details" IS NULL
        AND "next_moves"."trend_window" IS NULL
        AND "next_moves"."breakout_potential" IS NULL
        AND "next_moves"."draft_content" IS NULL
        AND "next_moves"."proposal_stale" = true
      ) OR (
        "next_moves"."decision_contract_version" = 'next-move-v1'
        AND "next_moves"."action_details" IS NOT NULL
        AND "next_moves"."action_details"->>'action' = "next_moves"."action"::text
        AND "next_moves"."trend_window" IS NOT NULL
        AND "next_moves"."trend_window"->>'valid_until' IS NOT NULL
        AND ("next_moves"."trend_window"->>'valid_until')::timestamptz = "next_moves"."valid_until"
        AND "next_moves"."breakout_potential" IS NOT NULL
      ));--> statement-breakpoint
ALTER TABLE "next_moves" ADD CONSTRAINT "next_moves_draft_content_check" CHECK (("next_moves"."draft_content" IS NOT NULL) = ("next_moves"."generation_level" = 'draft' AND "next_moves"."action" IN ('PUBLISH','REMIX')));
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE "user_profiles", "project_memberships", "project_claims" FROM PUBLIC;
--> statement-breakpoint
DO $trendsfast_browser_roles$
DECLARE
  browser_role text;
BEGIN
  FOREACH browser_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = browser_role) THEN
      EXECUTE format(
        'REVOKE ALL PRIVILEGES ON TABLE public.user_profiles, public.project_memberships, public.project_claims FROM %I',
        browser_role
      );
    END IF;
  END LOOP;
END;
$trendsfast_browser_roles$;
