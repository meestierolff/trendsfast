CREATE TABLE "api_auth_admission_buckets" (
	"scope_hash" varchar(200) PRIMARY KEY NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_auth_admission_attempts_nonnegative_check" CHECK ("api_auth_admission_buckets"."attempts" >= 0)
);
--> statement-breakpoint
CREATE INDEX "api_auth_admission_window_idx" ON "api_auth_admission_buckets" USING btree ("window_started_at");
