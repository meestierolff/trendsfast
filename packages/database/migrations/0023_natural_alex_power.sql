CREATE TABLE "managed_runtime_policy" (
	"id" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"revision" varchar(200) NOT NULL,
	"public_scan_daily_limit" integer NOT NULL,
	"public_scan_global_daily_limit" integer NOT NULL,
	"public_scan_global_daily_budget_usd" numeric(12, 6) NOT NULL,
	"api_create_rate_limit_per_hour" integer NOT NULL,
	"api_status_rate_limit_per_hour" integer NOT NULL,
	"api_auth_failure_limit_per_hour" integer NOT NULL,
	"max_provider_cost_usd_per_scan" numeric(12, 6) NOT NULL,
	"api_provider_cost_limit_usd_per_hour" numeric(12, 6) NOT NULL,
	"scan_retention_days" integer NOT NULL,
	"policy_version" integer NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "managed_runtime_policy_singleton_check" CHECK ("managed_runtime_policy"."id" = true),
	CONSTRAINT "managed_runtime_policy_revision_check" CHECK (length("managed_runtime_policy"."revision") BETWEEN 32 AND 200 AND "managed_runtime_policy"."revision" ~ '^[A-Za-z0-9_-]+$'),
	CONSTRAINT "managed_runtime_policy_public_scan_check" CHECK ("managed_runtime_policy"."public_scan_daily_limit" > 0 AND "managed_runtime_policy"."public_scan_global_daily_limit" > 0 AND "managed_runtime_policy"."public_scan_global_daily_budget_usd" > 0),
	CONSTRAINT "managed_runtime_policy_api_check" CHECK ("managed_runtime_policy"."api_create_rate_limit_per_hour" > 0 AND "managed_runtime_policy"."api_status_rate_limit_per_hour" > 0 AND "managed_runtime_policy"."api_auth_failure_limit_per_hour" > 0 AND "managed_runtime_policy"."max_provider_cost_usd_per_scan" > 0 AND "managed_runtime_policy"."api_provider_cost_limit_usd_per_hour" > 0),
	CONSTRAINT "managed_runtime_policy_retention_check" CHECK ("managed_runtime_policy"."scan_retention_days" BETWEEN 1 AND 365),
	CONSTRAINT "managed_runtime_policy_version_check" CHECK ("managed_runtime_policy"."policy_version" > 0)
);

CREATE OR REPLACE FUNCTION public.trendsfast_purge_retained_data(
  p_expected_revision text
)
RETURNS TABLE (
  retention_cutoff timestamp with time zone,
  deleted_scan_requests bigint,
  deleted_delivery_tokens bigint,
  deleted_analytics_events bigint,
  deleted_founder_launch_interests bigint,
  remaining_expired_founder_launch_interests bigint,
  deleted_orphan_projects bigint
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $trendsfast_purge_retained_data$
DECLARE
  v_now timestamp with time zone := pg_catalog.statement_timestamp();
  v_cutoff timestamp with time zone;
  v_retention_days integer;
  v_batch_count bigint;
  v_interest_batch integer;
  v_request_ids uuid[] := ARRAY[]::uuid[];
  v_deletable_request_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  deleted_scan_requests := 0;
  deleted_delivery_tokens := 0;
  deleted_analytics_events := 0;
  deleted_founder_launch_interests := 0;
  remaining_expired_founder_launch_interests := 0;
  deleted_orphan_projects := 0;
  retention_cutoff := NULL;

  -- Malformed, missing, stale, and absent policy all fail identically.
  IF p_expected_revision IS NULL
     OR pg_catalog.length(p_expected_revision) NOT BETWEEN 32 AND 200
     OR p_expected_revision !~ '^[A-Za-z0-9_-]+$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Managed runtime policy mismatch';
  END IF;

  SELECT policy.scan_retention_days
    INTO v_retention_days
    FROM public.managed_runtime_policy AS policy
   WHERE policy.id IS TRUE
     AND policy.revision = p_expected_revision
   FOR SHARE OF policy;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Managed runtime policy mismatch';
  END IF;

  IF NOT pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtextextended('trendsfast:retention-purge:v1', 0)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '55P03', MESSAGE = 'Retention purge unavailable';
  END IF;

  v_cutoff := v_now - pg_catalog.make_interval(days => v_retention_days);
  retention_cutoff := v_cutoff;

  -- Preserve privacy.ts semantics: max 20 x 500; audit is a dependency of delete.
  FOR v_interest_batch IN 1..20 LOOP
    WITH candidates AS MATERIALIZED (
      SELECT interest.id
        FROM public.founder_launch_interests AS interest
       WHERE interest.expires_at <= v_now
       ORDER BY interest.expires_at, interest.id
       FOR UPDATE OF interest SKIP LOCKED
       LIMIT 500
    ), audited AS (
      INSERT INTO public.founder_launch_interest_events
        (interest_reference, action, actor_id, occurred_at)
      SELECT candidate.id, 'PURGED', 'system:retention', v_now
        FROM candidates AS candidate
      RETURNING interest_reference
    ), deleted AS (
      DELETE FROM public.founder_launch_interests AS interest
       USING audited
       WHERE interest.id = audited.interest_reference
      RETURNING interest.id
    )
    SELECT pg_catalog.count(*)::bigint INTO v_batch_count FROM deleted;
    deleted_founder_launch_interests := deleted_founder_launch_interests + v_batch_count;
    EXIT WHEN v_batch_count < 500;
  END LOOP;

  SELECT pg_catalog.count(*)::bigint
    INTO remaining_expired_founder_launch_interests
    FROM public.founder_launch_interests AS interest
   WHERE interest.expires_at <= v_now;

  -- Direct old-analytics batch: max 5,000.
  WITH candidates AS MATERIALIZED (
    SELECT event.id
      FROM public.analytics_events AS event
     WHERE event.occurred_at < v_cutoff
     ORDER BY event.occurred_at, event.id
     FOR UPDATE OF event SKIP LOCKED
     LIMIT 5000
  ), deleted AS (
    DELETE FROM public.analytics_events AS event
     USING candidates AS candidate
     WHERE event.id = candidate.id
    RETURNING event.id
  )
  SELECT pg_catalog.count(*)::bigint INTO v_batch_count FROM deleted;
  deleted_analytics_events := deleted_analytics_events + v_batch_count;

  -- Lock at most 250 eligible requests. Array contains IDs only and never leaves function.
  SELECT COALESCE(pg_catalog.array_agg(candidate.id), ARRAY[]::uuid[])
    INTO v_request_ids
    FROM (
      SELECT request.id
        FROM public.scan_requests AS request
       WHERE (
         request.state IN ('READY', 'FAILED')
         AND (
           request.completed_at < v_cutoff
           OR (request.completed_at IS NULL AND request.submitted_at < v_cutoff)
         )
       ) OR (
         request.state IN ('QUEUED', 'RUNNING', 'REVIEW_REQUIRED')
         AND request.submitted_at < v_cutoff
       )
       ORDER BY COALESCE(request.completed_at, request.submitted_at), request.id
       FOR UPDATE OF request SKIP LOCKED
       LIMIT 250
    ) AS candidate;

  -- Drain at most 5,000 analytics rows linked directly or through next_moves.
  -- Do not delete a request until every linked analytics row is gone; otherwise
  -- FK SET NULL would erase the linkage and leave personal analytics behind.
  WITH candidates AS MATERIALIZED (
    SELECT event.id
      FROM public.analytics_events AS event
     WHERE event.scan_request_id = ANY (v_request_ids)
        OR EXISTS (
          SELECT 1
            FROM public.next_moves AS move
           WHERE move.id = event.next_move_id
             AND move.scan_request_id = ANY (v_request_ids)
        )
     ORDER BY event.occurred_at, event.id
     FOR UPDATE OF event SKIP LOCKED
     LIMIT 5000
  ), deleted AS (
    DELETE FROM public.analytics_events AS event
     USING candidates AS candidate
     WHERE event.id = candidate.id
    RETURNING event.id
  )
  SELECT pg_catalog.count(*)::bigint INTO v_batch_count FROM deleted;
  deleted_analytics_events := deleted_analytics_events + v_batch_count;

  SELECT COALESCE(pg_catalog.array_agg(candidate.id), ARRAY[]::uuid[])
    INTO v_deletable_request_ids
    FROM (
      SELECT request.id
        FROM public.scan_requests AS request
       WHERE request.id = ANY (v_request_ids)
         AND NOT EXISTS (
           SELECT 1
             FROM public.analytics_events AS event
            WHERE event.scan_request_id = request.id
               OR EXISTS (
                 SELECT 1
                   FROM public.next_moves AS move
                  WHERE move.id = event.next_move_id
                    AND move.scan_request_id = request.id
               )
         )
       ORDER BY COALESCE(request.completed_at, request.submitted_at), request.id
    ) AS candidate;

  DELETE FROM public.scan_requests AS request
   WHERE request.id = ANY (v_deletable_request_ids);
  GET DIAGNOSTICS deleted_scan_requests = ROW_COUNT;

  -- Expired token batch: max 1,000 (cascade-deleted tokens retain current non-counted semantics).
  WITH candidates AS MATERIALIZED (
    SELECT token.id
      FROM public.delivery_tokens AS token
     WHERE token.expires_at < v_now
     ORDER BY token.expires_at, token.id
     FOR UPDATE OF token SKIP LOCKED
     LIMIT 1000
  ), deleted AS (
    DELETE FROM public.delivery_tokens AS token
     USING candidates AS candidate
     WHERE token.id = candidate.id
    RETURNING token.id
  )
  SELECT pg_catalog.count(*)::bigint INTO deleted_delivery_tokens FROM deleted;

  -- Orphan project batch: max 250; exact existing privacy.ts exclusions.
  WITH candidates AS MATERIALIZED (
    SELECT project.id
      FROM public.projects AS project
     WHERE project.updated_at < v_cutoff
       AND NOT EXISTS (
         SELECT 1
           FROM public.scan_requests AS request
          WHERE request.project_id = project.id
       )
       AND NOT EXISTS (
         SELECT 1
           FROM public.api_keys AS key
          WHERE key.project_id = project.id
       )
       AND NOT EXISTS (
         SELECT 1
           FROM public.stripe_customers AS customer
          WHERE customer.project_id = project.id
       )
       AND NOT EXISTS (
         SELECT 1
           FROM public.founder_entitlement_grants AS grant_row
          WHERE grant_row.project_id = project.id
       )
       AND NOT EXISTS (
         SELECT 1
           FROM public.project_memberships AS membership
          WHERE membership.project_id = project.id
       )
     ORDER BY project.updated_at, project.id
     FOR UPDATE OF project SKIP LOCKED
     LIMIT 250
  ), deleted AS (
    DELETE FROM public.projects AS project
     USING candidates AS candidate
     WHERE project.id = candidate.id
    RETURNING project.id
  )
  SELECT pg_catalog.count(*)::bigint INTO deleted_orphan_projects FROM deleted;

  INSERT INTO public.operations_health_checks AS health
    (check_type, last_succeeded_at, last_failed_at, failure_code, created_at, updated_at)
  VALUES (
    'RETENTION',
    CASE WHEN remaining_expired_founder_launch_interests = 0 THEN v_now ELSE NULL END,
    CASE WHEN remaining_expired_founder_launch_interests = 0 THEN NULL ELSE v_now END,
    CASE WHEN remaining_expired_founder_launch_interests = 0 THEN NULL ELSE 'RETENTION_BACKLOG_REMAINS' END,
    v_now,
    v_now
  )
  ON CONFLICT (check_type) DO UPDATE
    SET last_succeeded_at = CASE
          WHEN remaining_expired_founder_launch_interests = 0 THEN v_now
          ELSE health.last_succeeded_at
        END,
        last_failed_at = CASE
          WHEN remaining_expired_founder_launch_interests = 0 THEN health.last_failed_at
          ELSE v_now
        END,
        failure_code = CASE
          WHEN remaining_expired_founder_launch_interests = 0 THEN NULL
          ELSE 'RETENTION_BACKLOG_REMAINS'
        END,
        updated_at = v_now;

  RETURN NEXT;
END;
$trendsfast_purge_retained_data$;

REVOKE ALL PRIVILEGES ON FUNCTION public.trendsfast_purge_retained_data(text) FROM PUBLIC;

COMMENT ON FUNCTION public.trendsfast_purge_retained_data(text) IS
  'Revision-fenced bounded retention purge; returns the cutoff and aggregate counts only.';

--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.trendsfast_assert_managed_policy_revision(
  p_expected_revision text
)
RETURNS void
LANGUAGE plpgsql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $trendsfast_assert_managed_policy_revision$
BEGIN
  IF p_expected_revision IS NULL
     OR pg_catalog.length(p_expected_revision) NOT BETWEEN 32 AND 200
     OR p_expected_revision !~ '^[A-Za-z0-9_-]+$'
     OR NOT EXISTS (
       SELECT 1
         FROM public.managed_runtime_policy AS policy
        WHERE policy.id IS TRUE
          AND policy.revision = p_expected_revision
     ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Managed runtime policy mismatch';
  END IF;
END;
$trendsfast_assert_managed_policy_revision$;

REVOKE ALL PRIVILEGES ON FUNCTION public.trendsfast_assert_managed_policy_revision(text) FROM PUBLIC;

COMMENT ON FUNCTION public.trendsfast_assert_managed_policy_revision(text) IS
  'Fail-closed opaque revision fence for managed external effects.';

--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.trendsfast_record_backup_health(
  p_succeeded boolean,
  p_failure_code text
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $trendsfast_record_backup_health$
DECLARE
  v_now timestamp with time zone := pg_catalog.statement_timestamp();
BEGIN
  IF p_succeeded IS NULL
     OR (p_succeeded IS TRUE AND p_failure_code IS NOT NULL)
     OR (
       p_succeeded IS FALSE
       AND (
         p_failure_code IS NULL
         OR pg_catalog.length(p_failure_code) NOT BETWEEN 1 AND 100
         OR p_failure_code !~ '^[A-Z][A-Z0-9:_-]{0,99}$'
       )
     ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Backup health input is invalid';
  END IF;

  INSERT INTO public.operations_health_checks AS health
    (check_type, last_succeeded_at, last_failed_at, failure_code, created_at, updated_at)
  VALUES (
    'BACKUP',
    CASE WHEN p_succeeded IS TRUE THEN v_now ELSE NULL END,
    CASE WHEN p_succeeded IS TRUE THEN NULL ELSE v_now END,
    CASE WHEN p_succeeded IS TRUE THEN NULL ELSE p_failure_code END,
    v_now,
    v_now
  )
  ON CONFLICT (check_type) DO UPDATE
    SET last_succeeded_at = CASE
          WHEN p_succeeded IS TRUE THEN v_now
          ELSE health.last_succeeded_at
        END,
        last_failed_at = CASE
          WHEN p_succeeded IS TRUE THEN health.last_failed_at
          ELSE v_now
        END,
        failure_code = CASE
          WHEN p_succeeded IS TRUE THEN NULL
          ELSE p_failure_code
        END,
        updated_at = v_now;
END;
$trendsfast_record_backup_health$;

REVOKE ALL PRIVILEGES ON FUNCTION public.trendsfast_record_backup_health(boolean, text) FROM PUBLIC;

COMMENT ON FUNCTION public.trendsfast_record_backup_health(boolean, text) IS
  'Worker-only fixed BACKUP heartbeat; cannot write RETENTION or arbitrary health types.';
