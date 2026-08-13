CREATE OR REPLACE FUNCTION public.trendsfast_public_provider_verifications(
  p_release_sha text,
  p_deployment_host text,
  p_deployment_id text
)
RETURNS TABLE (
  source text,
  provider text,
  state text,
  credential_mode text,
  deployment_environment text,
  health_status text,
  readback_verified boolean,
  canonical_url_count integer,
  latency_ms integer,
  checked_at timestamp with time zone,
  completed_at timestamp with time zone
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $trendsfast_public_provider_verifications$
SELECT DISTINCT ON (record.source)
  record.source::text AS source,
  record.provider::text AS provider,
  record.state::text AS state,
  record.credential_mode::text AS credential_mode,
  record.deployment_environment::text AS deployment_environment,
  record.health_status::text AS health_status,
  record.readback_verified AS readback_verified,
  pg_catalog.jsonb_array_length(record.canonical_urls)::integer AS canonical_url_count,
  record.latency_ms AS latency_ms,
  record.checked_at AS checked_at,
  record.completed_at AS completed_at
FROM public.provider_verification_records AS record
WHERE pg_catalog.length(pg_catalog.btrim(p_release_sha)) BETWEEN 7 AND 100
  AND p_release_sha = pg_catalog.btrim(p_release_sha)
  AND p_release_sha ~ '^[A-Za-z0-9._-]+$'
  AND pg_catalog.length(p_deployment_host) BETWEEN 3 AND 255
  AND p_deployment_host = pg_catalog.lower(pg_catalog.btrim(p_deployment_host))
  AND p_deployment_host ~ '^[a-z0-9][a-z0-9.-]*(?::[0-9]{1,5})?$'
  AND pg_catalog.strpos(p_deployment_host, '..') = 0
  AND pg_catalog.length(pg_catalog.btrim(p_deployment_id)) BETWEEN 1 AND 255
  AND p_deployment_id = pg_catalog.btrim(p_deployment_id)
  AND p_deployment_id ~ '^[A-Za-z0-9._:-]+$'
  AND record.deployment_environment = 'production'
  AND record.release_sha = p_release_sha
  AND record.deployment_host = p_deployment_host
  AND record.deployment_id = p_deployment_id
  AND record.state IN ('VERIFIED', 'DEGRADED', 'FAILED', 'UNCONFIGURED', 'FIXTURE', 'LEGAL_REVIEW')
ORDER BY record.source, record.completed_at DESC NULLS LAST, record.created_at DESC, record.id DESC
$trendsfast_public_provider_verifications$;

REVOKE ALL PRIVILEGES ON FUNCTION public.trendsfast_public_provider_verifications(text, text, text)
  FROM PUBLIC;

COMMENT ON FUNCTION public.trendsfast_public_provider_verifications(text, text, text) IS
  'Safe exact-deployment provider verification projection; runtime EXECUTE is provisioned separately.';
