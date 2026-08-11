DROP INDEX "signals_source_source_id_uidx";--> statement-breakpoint
CREATE UNIQUE INDEX "signals_run_source_source_id_uidx" ON "signals" USING btree ("source_run_id","source","source_id");