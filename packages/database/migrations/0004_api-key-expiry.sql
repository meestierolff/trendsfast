ALTER TYPE "public"."api_auth_outcome" ADD VALUE 'EXPIRED' BEFORE 'RATE_LIMITED';--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "api_keys_status_expiry_idx" ON "api_keys" USING btree ("status","expires_at");--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_expiry_after_creation_check" CHECK ("api_keys"."expires_at" IS NULL OR "api_keys"."expires_at" > "api_keys"."created_at");