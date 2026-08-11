ALTER TABLE "clusters" ADD COLUMN "dedupe_key" varchar(200);--> statement-breakpoint
ALTER TABLE "provider_cost_ledger" ADD COLUMN "ledger_key" varchar(200);--> statement-breakpoint
CREATE UNIQUE INDEX "clusters_scan_dedupe_uidx" ON "clusters" USING btree ("scan_run_id","dedupe_key") WHERE "clusters"."dedupe_key" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "provider_cost_scan_ledger_key_uidx" ON "provider_cost_ledger" USING btree ("scan_run_id","ledger_key") WHERE "provider_cost_ledger"."ledger_key" IS NOT NULL;