DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM "evidence_receipts"
		WHERE "verified" = true
			AND (
				"reviewed_by" IS NULL
				OR length(btrim("reviewed_by")) = 0
				OR "verified_at" IS NULL
			)
	) THEN
		RAISE EXCEPTION '0017 requires every previously verified evidence receipt to have reviewer identity and verified timestamp';
	END IF;
END $$;--> statement-breakpoint
ALTER TYPE "public"."review_action" ADD VALUE 'EVIDENCE_VERIFIED' BEFORE 'EVIDENCE_REJECTED';--> statement-breakpoint
ALTER TYPE "public"."review_action" ADD VALUE 'RECOMPUTED_FROM_STORED_EVIDENCE' BEFORE 'APPROVED';--> statement-breakpoint
CREATE TABLE "next_move_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"next_move_id" uuid NOT NULL,
	"context_version_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"change_kind" varchar(40) NOT NULL,
	"reviewer_id" varchar(160) NOT NULL,
	"reason" text NOT NULL,
	"before" jsonb NOT NULL,
	"after" jsonb NOT NULL,
	"prompt_version" varchar(100) NOT NULL,
	"score_version" varchar(100) NOT NULL,
	"retained_evidence_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "next_move_revisions_version_check" CHECK ("next_move_revisions"."version" > 1),
	CONSTRAINT "next_move_revisions_kind_check" CHECK ("next_move_revisions"."change_kind" IN ('EDIT_AND_APPROVE','CONTEXT_CORRECTION','STORED_EVIDENCE_RECOMPUTE','CONVERT_TO_WAIT')),
	CONSTRAINT "next_move_revisions_reviewer_check" CHECK (length(btrim("next_move_revisions"."reviewer_id")) BETWEEN 1 AND 160),
	CONSTRAINT "next_move_revisions_reason_check" CHECK (length(btrim("next_move_revisions"."reason")) BETWEEN 10 AND 4000)
);
--> statement-breakpoint
DROP INDEX "evidence_receipts_move_signal_uidx";--> statement-breakpoint
DROP INDEX "opportunities_scan_rank_uidx";--> statement-breakpoint
ALTER TABLE "evidence_receipts" ADD COLUMN "move_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "next_moves" ADD COLUMN "review_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "next_moves" ADD COLUMN "proposal_stale" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "move_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "next_move_revisions" ADD CONSTRAINT "next_move_revisions_next_move_id_next_moves_id_fk" FOREIGN KEY ("next_move_id") REFERENCES "public"."next_moves"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "next_move_revisions" ADD CONSTRAINT "next_move_revisions_context_version_id_project_context_versions_id_fk" FOREIGN KEY ("context_version_id") REFERENCES "public"."project_context_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "next_move_revisions_move_version_uidx" ON "next_move_revisions" USING btree ("next_move_id","version");--> statement-breakpoint
CREATE INDEX "next_move_revisions_context_created_idx" ON "next_move_revisions" USING btree ("context_version_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "evidence_receipts_move_version_signal_uidx" ON "evidence_receipts" USING btree ("next_move_id","move_version","signal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "opportunities_scan_version_rank_uidx" ON "opportunities" USING btree ("scan_run_id","move_version","rank");--> statement-breakpoint
ALTER TABLE "evidence_receipts" ADD CONSTRAINT "evidence_receipts_move_version_positive_check" CHECK ("evidence_receipts"."move_version" > 0);--> statement-breakpoint
ALTER TABLE "evidence_receipts" ADD CONSTRAINT "evidence_receipts_verified_review_identity_check" CHECK ("evidence_receipts"."verified" = false OR ("evidence_receipts"."reviewed_by" IS NOT NULL AND length(btrim("evidence_receipts"."reviewed_by")) BETWEEN 1 AND 160 AND "evidence_receipts"."verified_at" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "next_moves" ADD CONSTRAINT "next_moves_review_version_positive_check" CHECK ("next_moves"."review_version" > 0);--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_move_version_positive_check" CHECK ("opportunities"."move_version" > 0);
