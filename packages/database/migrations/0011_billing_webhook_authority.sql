CREATE TYPE "public"."billing_checkout_state" AS ENUM('OPEN', 'COMPLETED', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."billing_payment_state" AS ENUM('UNKNOWN', 'PAID', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."billing_webhook_state" AS ENUM('RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED');--> statement-breakpoint
ALTER TYPE "public"."subscription_status" ADD VALUE 'INCOMPLETE_EXPIRED' BEFORE 'TRIALING';--> statement-breakpoint
CREATE TABLE "billing_checkout_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"stripe_checkout_session_id" varchar(255) NOT NULL,
	"stripe_customer_id" varchar(255),
	"stripe_subscription_id" varchar(255),
	"state" "billing_checkout_state" DEFAULT 'OPEN' NOT NULL,
	"initiated_by" varchar(160) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "billing_checkout_actor_check" CHECK (length("billing_checkout_sessions"."initiated_by") BETWEEN 1 AND 160),
	CONSTRAINT "billing_checkout_completion_check" CHECK (("billing_checkout_sessions"."state" = 'COMPLETED') = ("billing_checkout_sessions"."completed_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "billing_payment_states" (
	"stripe_subscription_id" varchar(255) PRIMARY KEY NOT NULL,
	"stripe_customer_id" varchar(255),
	"state" "billing_payment_state" DEFAULT 'UNKNOWN' NOT NULL,
	"last_invoice_id" varchar(255),
	"last_stripe_event_id" varchar(255) NOT NULL,
	"last_stripe_event_created_at" timestamp with time zone NOT NULL,
	"last_stripe_event_rank" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_payment_event_rank_check" CHECK ("billing_payment_states"."last_stripe_event_rank" >= 0)
);
--> statement-breakpoint
CREATE TABLE "billing_webhook_events" (
	"stripe_event_id" varchar(255) PRIMARY KEY NOT NULL,
	"event_type" varchar(120) NOT NULL,
	"payload_hash" varchar(80) NOT NULL,
	"stripe_created_at" timestamp with time zone NOT NULL,
	"livemode" boolean NOT NULL,
	"state" "billing_webhook_state" DEFAULT 'RECEIVED' NOT NULL,
	"failure_code" varchar(100),
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "billing_webhook_payload_hash_check" CHECK (length("billing_webhook_events"."payload_hash") = 71 AND "billing_webhook_events"."payload_hash" LIKE 'sha256:%'),
	CONSTRAINT "billing_webhook_completion_check" CHECK (("billing_webhook_events"."state" = 'RECEIVED') = ("billing_webhook_events"."processed_at" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "project_entitlements" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"subscription_id" uuid NOT NULL,
	"entitlement" varchar(100) DEFAULT 'founder_cloud' NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"period_start" timestamp with time zone,
	"period_end" timestamp with time zone,
	"source_stripe_event_id" varchar(255) NOT NULL,
	"source_stripe_event_created_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_entitlements_name_check" CHECK ("project_entitlements"."entitlement" = 'founder_cloud'),
	CONSTRAINT "project_entitlements_period_check" CHECK ("project_entitlements"."period_start" IS NULL OR "project_entitlements"."period_end" IS NULL OR "project_entitlements"."period_start" < "project_entitlements"."period_end")
);
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "last_subscription_event_created_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "last_subscription_event_rank" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_checkout_sessions" ADD CONSTRAINT "billing_checkout_sessions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_entitlements" ADD CONSTRAINT "project_entitlements_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_entitlements" ADD CONSTRAINT "project_entitlements_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_checkout_external_uidx" ON "billing_checkout_sessions" USING btree ("stripe_checkout_session_id");--> statement-breakpoint
CREATE INDEX "billing_checkout_project_state_idx" ON "billing_checkout_sessions" USING btree ("project_id","state");--> statement-breakpoint
CREATE INDEX "billing_checkout_subscription_idx" ON "billing_checkout_sessions" USING btree ("stripe_subscription_id");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_payment_last_event_uidx" ON "billing_payment_states" USING btree ("last_stripe_event_id");--> statement-breakpoint
CREATE INDEX "billing_payment_customer_idx" ON "billing_payment_states" USING btree ("stripe_customer_id");--> statement-breakpoint
CREATE INDEX "billing_webhook_state_received_idx" ON "billing_webhook_events" USING btree ("state","received_at");--> statement-breakpoint
CREATE INDEX "billing_webhook_type_created_idx" ON "billing_webhook_events" USING btree ("event_type","stripe_created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "project_entitlements_subscription_uidx" ON "project_entitlements" USING btree ("subscription_id");--> statement-breakpoint
CREATE INDEX "project_entitlements_active_period_idx" ON "project_entitlements" USING btree ("active","period_end");--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "stripe_customers_project_uidx" ON "stripe_customers" USING btree ("project_id") WHERE "stripe_customers"."project_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "subscriptions_project_status_idx" ON "subscriptions" USING btree ("project_id","status");--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_event_rank_nonnegative_check" CHECK ("subscriptions"."last_subscription_event_rank" >= 0);
