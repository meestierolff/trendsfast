CREATE TABLE "founder_entitlement_grant_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"grant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"action" varchar(20) NOT NULL,
	"actor_id" varchar(160) NOT NULL,
	"snapshot" jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "founder_entitlement_grant_events_action_check" CHECK ("founder_entitlement_grant_events"."action" IN ('ISSUED','REVOKED')),
	CONSTRAINT "founder_entitlement_grant_events_actor_check" CHECK (length(btrim("founder_entitlement_grant_events"."actor_id")) BETWEEN 1 AND 160)
);
--> statement-breakpoint
CREATE TABLE "founder_entitlement_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"entitlement_source" varchar(40) DEFAULT 'FOUNDER_GRANT' NOT NULL,
	"grant_reason" varchar(40) DEFAULT 'DESIGN_PARTNER' NOT NULL,
	"issued_by" varchar(160) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" varchar(160),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "founder_entitlement_grants_source_reason_check" CHECK ("founder_entitlement_grants"."entitlement_source" = 'FOUNDER_GRANT' AND "founder_entitlement_grants"."grant_reason" = 'DESIGN_PARTNER'),
	CONSTRAINT "founder_entitlement_grants_issuer_check" CHECK (length(btrim("founder_entitlement_grants"."issued_by")) BETWEEN 1 AND 160),
	CONSTRAINT "founder_entitlement_grants_duration_check" CHECK ("founder_entitlement_grants"."expires_at" > "founder_entitlement_grants"."created_at" AND "founder_entitlement_grants"."expires_at" <= "founder_entitlement_grants"."created_at" + interval '30 days'),
	CONSTRAINT "founder_entitlement_grants_revocation_check" CHECK (("founder_entitlement_grants"."revoked_at" IS NULL AND "founder_entitlement_grants"."revoked_by" IS NULL) OR ("founder_entitlement_grants"."revoked_at" IS NOT NULL AND "founder_entitlement_grants"."revoked_by" IS NOT NULL AND "founder_entitlement_grants"."revoked_at" >= "founder_entitlement_grants"."created_at" AND length(btrim("founder_entitlement_grants"."revoked_by")) BETWEEN 1 AND 160))
);
--> statement-breakpoint
ALTER TABLE "founder_usage_events" DROP CONSTRAINT "founder_usage_events_project_id_project_entitlements_project_id_fk";
--> statement-breakpoint
ALTER TABLE "founder_usage_events" DROP CONSTRAINT "founder_usage_events_subscription_id_subscriptions_id_fk";
--> statement-breakpoint
ALTER TABLE "api_key_auth_events" ADD COLUMN "request_kind" varchar(20) DEFAULT 'OTHER' NOT NULL;--> statement-breakpoint
ALTER TABLE "founder_usage_events" ADD COLUMN "founder_grant_id" uuid;--> statement-breakpoint
ALTER TABLE "scan_requests" ADD COLUMN "public_cost_reservation_usd" numeric(10, 6) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "api_keys" ALTER COLUMN "provider_cost_limit_usd" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "founder_entitlement_grant_events" ADD CONSTRAINT "founder_entitlement_grant_events_grant_id_founder_entitlement_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."founder_entitlement_grants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "founder_entitlement_grant_events" ADD CONSTRAINT "founder_entitlement_grant_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "founder_entitlement_grants" ADD CONSTRAINT "founder_entitlement_grants_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "founder_entitlement_grant_events_grant_occurred_idx" ON "founder_entitlement_grant_events" USING btree ("grant_id","occurred_at");--> statement-breakpoint
CREATE INDEX "founder_entitlement_grant_events_project_occurred_idx" ON "founder_entitlement_grant_events" USING btree ("project_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "founder_entitlement_grants_one_open_project_uidx" ON "founder_entitlement_grants" USING btree ("project_id") WHERE "founder_entitlement_grants"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "founder_entitlement_grants_active_idx" ON "founder_entitlement_grants" USING btree ("project_id","expires_at");--> statement-breakpoint
ALTER TABLE "founder_usage_events" ADD CONSTRAINT "founder_usage_events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "founder_usage_events" ADD CONSTRAINT "founder_usage_events_founder_grant_id_founder_entitlement_grants_id_fk" FOREIGN KEY ("founder_grant_id") REFERENCES "public"."founder_entitlement_grants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "founder_usage_events" ADD CONSTRAINT "founder_usage_events_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_key_auth_events_key_kind_occurred_idx" ON "api_key_auth_events" USING btree ("api_key_id","request_kind","occurred_at");--> statement-breakpoint
CREATE INDEX "founder_usage_grant_idx" ON "founder_usage_events" USING btree ("founder_grant_id","occurred_at");--> statement-breakpoint
ALTER TABLE "api_key_auth_events" ADD CONSTRAINT "api_key_auth_events_request_kind_check" CHECK ("api_key_auth_events"."request_kind" IN ('CREATE','STATUS','OTHER'));--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "founder_usage_events"
    WHERE "subscription_id" IS NULL
  ) THEN
    RAISE EXCEPTION '0018 cannot infer entitlement truth for legacy founder_usage_events without subscription_id';
  END IF;
END
$$;--> statement-breakpoint
ALTER TABLE "founder_usage_events" ADD CONSTRAINT "founder_usage_entitlement_source_check" CHECK (num_nonnulls("founder_usage_events"."subscription_id", "founder_usage_events"."founder_grant_id") = 1);--> statement-breakpoint
ALTER TABLE "scan_requests" ADD CONSTRAINT "scan_requests_public_cost_reservation_nonnegative_check" CHECK ("scan_requests"."public_cost_reservation_usd" >= 0);--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE "founder_entitlement_grants" FROM PUBLIC;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE "founder_entitlement_grant_events" FROM PUBLIC;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL PRIVILEGES ON TABLE "founder_entitlement_grants" FROM anon;
    REVOKE ALL PRIVILEGES ON TABLE "founder_entitlement_grant_events" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL PRIVILEGES ON TABLE "founder_entitlement_grants" FROM authenticated;
    REVOKE ALL PRIVILEGES ON TABLE "founder_entitlement_grant_events" FROM authenticated;
  END IF;
END
$$;
