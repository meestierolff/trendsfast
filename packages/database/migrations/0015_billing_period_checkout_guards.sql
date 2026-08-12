ALTER TABLE "billing_checkout_sessions" ALTER COLUMN "stripe_checkout_session_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_checkout_sessions" ADD COLUMN "requested_stripe_customer_id" varchar(255);--> statement-breakpoint
ALTER TABLE "billing_checkout_sessions" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "billing_payment_states" ADD COLUMN "period_start" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "billing_payment_states" ADD COLUMN "period_end" timestamp with time zone;--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (
		SELECT 1 FROM "billing_checkout_sessions"
		WHERE "state" = 'OPEN'
		GROUP BY "project_id"
		HAVING count(*) > 1
	) THEN
		RAISE EXCEPTION 'BILLING_CHECKOUT_DUPLICATE_OPEN_REQUIRES_RECONCILIATION';
	END IF;
END
$$;--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (
		SELECT 1 FROM "subscriptions"
		WHERE "project_id" IS NOT NULL
			AND "status" IN ('INCOMPLETE', 'TRIALING', 'ACTIVE', 'PAST_DUE', 'UNPAID', 'PAUSED')
		GROUP BY "project_id"
		HAVING count(*) > 1
	) THEN
		RAISE EXCEPTION 'BILLING_DUPLICATE_NONTERMINAL_SUBSCRIPTIONS_REQUIRE_RECONCILIATION';
	END IF;
END
$$;--> statement-breakpoint
UPDATE "billing_checkout_sessions" SET "requested_stripe_customer_id" = "stripe_customer_id", "expires_at" = "created_at" + interval '24 hours', "updated_at" = now() WHERE "state" = 'OPEN';--> statement-breakpoint
UPDATE "project_entitlements" SET "active" = false, "updated_at" = now() WHERE "active" = true;--> statement-breakpoint
UPDATE "monitoring_subscriptions" SET "state" = 'PAUSED', "updated_at" = now() WHERE "state" = 'ACTIVE';--> statement-breakpoint
UPDATE "monitoring_runs" SET "state" = 'FAILED', "lease_owner" = NULL, "lease_expires_at" = NULL, "completed_at" = now(), "failure_code" = 'ENTITLEMENT_PERIOD_REVALIDATION', "updated_at" = now() WHERE "state" = 'PROCESSING';--> statement-breakpoint
CREATE UNIQUE INDEX "billing_checkout_project_open_uidx" ON "billing_checkout_sessions" USING btree ("project_id") WHERE "billing_checkout_sessions"."state" = 'OPEN';--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_project_nonterminal_uidx" ON "subscriptions" USING btree ("project_id") WHERE "subscriptions"."project_id" IS NOT NULL AND "subscriptions"."status" IN ('INCOMPLETE', 'TRIALING', 'ACTIVE', 'PAST_DUE', 'UNPAID', 'PAUSED');--> statement-breakpoint
ALTER TABLE "billing_checkout_sessions" ADD CONSTRAINT "billing_checkout_expiration_check" CHECK ("billing_checkout_sessions"."expires_at" IS NULL OR "billing_checkout_sessions"."expires_at" > "billing_checkout_sessions"."created_at");--> statement-breakpoint
ALTER TABLE "billing_checkout_sessions" ADD CONSTRAINT "billing_checkout_binding_check" CHECK ("billing_checkout_sessions"."state" <> 'COMPLETED' OR "billing_checkout_sessions"."stripe_checkout_session_id" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "billing_payment_states" ADD CONSTRAINT "billing_payment_period_check" CHECK (("billing_payment_states"."period_start" IS NULL AND "billing_payment_states"."period_end" IS NULL) OR ("billing_payment_states"."period_start" IS NOT NULL AND "billing_payment_states"."period_end" IS NOT NULL AND "billing_payment_states"."period_start" < "billing_payment_states"."period_end"));
