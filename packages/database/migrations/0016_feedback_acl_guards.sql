-- A delivery capability may submit exactly one durable feedback choice. Older
-- duplicate feedback may also have emitted indistinguishable outcome and
-- analytics rows, so never silently delete only one side of that history.
DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM "feedback_events"
		WHERE "delivery_token_id" IS NOT NULL
		GROUP BY "delivery_token_id"
		HAVING count(*) > 1
	) THEN
		RAISE EXCEPTION USING
			MESSAGE = 'Duplicate delivery-token feedback requires reviewed feedback/outcome/analytics reconciliation before migration 0016',
			ERRCODE = '23505';
	END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX "feedback_events_delivery_token_uidx" ON "feedback_events" USING btree ("delivery_token_id");
--> statement-breakpoint
-- TrendsFast uses direct PostgreSQL only. Remove browser/Data API access to
-- application objects even when a hosted PostgreSQL provider creates broad
-- PUBLIC grants by default. Object owners retain their implicit privileges.
REVOKE ALL PRIVILEGES ON SCHEMA "public" FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA "public" FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA "public" FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA "public" FROM PUBLIC;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES REVOKE ALL PRIVILEGES ON SEQUENCES FROM PUBLIC;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES REVOKE ALL PRIVILEGES ON FUNCTIONS FROM PUBLIC;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA "public" REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA "public" REVOKE ALL PRIVILEGES ON SEQUENCES FROM PUBLIC;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA "public" REVOKE ALL PRIVILEGES ON FUNCTIONS FROM PUBLIC;
--> statement-breakpoint
DO $$
DECLARE
	browser_role text;
BEGIN
	FOREACH browser_role IN ARRAY ARRAY['anon', 'authenticated']
	LOOP
		IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = browser_role) THEN
			EXECUTE format('REVOKE ALL PRIVILEGES ON SCHEMA public FROM %I', browser_role);
			EXECUTE format(
				'REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM %I',
				browser_role
			);
			EXECUTE format(
				'REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM %I',
				browser_role
			);
			EXECUTE format(
				'REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM %I',
				browser_role
			);
			EXECUTE format(
				'ALTER DEFAULT PRIVILEGES REVOKE ALL PRIVILEGES ON TABLES FROM %I',
				browser_role
			);
			EXECUTE format(
				'ALTER DEFAULT PRIVILEGES REVOKE ALL PRIVILEGES ON SEQUENCES FROM %I',
				browser_role
			);
			EXECUTE format(
				'ALTER DEFAULT PRIVILEGES REVOKE ALL PRIVILEGES ON FUNCTIONS FROM %I',
				browser_role
			);
			EXECUTE format(
				'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL PRIVILEGES ON TABLES FROM %I',
				browser_role
			);
			EXECUTE format(
				'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL PRIVILEGES ON SEQUENCES FROM %I',
				browser_role
			);
			EXECUTE format(
				'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL PRIVILEGES ON FUNCTIONS FROM %I',
				browser_role
			);
		END IF;
	END LOOP;
END $$;
