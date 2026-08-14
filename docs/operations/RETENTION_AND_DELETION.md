# Retention scheduling and health

`SCAN_RETENTION_DAYS` is synchronized from the mode-`0600` managed-policy file
into the owner-only database policy. Runtime callers present only the opaque
`MANAGED_POLICY_REVISION`; they cannot choose the cutoff. The purge removes
eligible old terminal and abandoned nonterminal scans, old analytics, expired
delivery tokens, expired founder launch-interest rows in bounded batches, and
eligible orphan projects. It emits only the cutoff, aggregate counts, and a
durable `RETENTION` health result.

Before a managed deployment can run retention, prepare a bounded mode-`0600`
file containing every variable listed by `MANAGED_POLICY_VARIABLES`, set
`MANAGED_POLICY_FILE`, and run `pnpm db:sync-policy` from the controlled release
environment with `DIRECT_DATABASE_URL` and `DATABASE_SSL_CA`. When that file is
selected it is the complete policy authority; ambient copies of policy values
are ignored. Re-running an identical revision is idempotent. Changing any value
requires a new revision, so a stale deployment fails closed instead of silently
adopting different limits. Deploy only the matching opaque revision to the ops
runtime; never deploy the private policy file or its values.

Two code-local entrypoints share the same repository contract:

- `pnpm db:purge` is a controlled operator command using `RETENTION_DATABASE_URL`,
  verified `DATABASE_SSL_CA`, and `MANAGED_POLICY_REVISION` for recovery/manual runs.
- `GET /api/cron/retention` is hidden on the public surface, accepted only on
  `TRENDSFAST_SURFACE=ops`, and requires the exact `CRON_SECRET` bearer when a
  scheduler is explicitly configured.

The pre-revenue Hobby ops deployment is deliberately cron-free and receives
neither `RETENTION_DATABASE_URL` nor `CRON_SECRET`. Retention therefore remains
a controlled manual/recovery operation for this launch. The only registered
Hobby cron is the public `/api/cron/monitoring` route at `0 7 * * *`, with a
07:00–07:59 UTC invocation window; it does not run retention. Do not add a
second Hobby cron or infer retention scheduling from the route's existence.

The retention login is distinct from public, worker, billing, and founder ops.
It has no direct table or column grants and no health/alert DML. Its sole
application capability is `EXECUTE` on
`trendsfast_purge_retained_data(text)`. That fixed, `SECURITY DEFINER`,
`pg_catalog`-search-path function validates the policy revision, performs the
bounded deletes and interest audit, and records aggregate retention health. The
login also has no DDL, temporary-table, role-membership, or unrelated function
privilege.

Backup health is a separate worker capability. The worker has read-only access
to the aggregate health columns and no direct health-table DML. The
`ops:record-health` command accepts only `BACKUP` and calls the exact
`trendsfast_record_backup_health(boolean, text)` function; it cannot write a
retention success. Retention state is written only by the purge function itself.

The route returns bounded aggregate counts and fails if the expired-interest
batch backlog remains. Daily operations reconciliation alerts when the latest
retention health success becomes stale. Before any future scheduler is enabled,
prove scheduler ownership, request authentication, successful execution, alert
delivery, and acceptable duration in a production-shaped database. Code or a
route alone is not deployed evidence.

Before live traffic, approve and test legal-hold exclusion, provider-side
deletion, backup/PITR expiry and restore behavior, statutory billing/security
retention, exact-project deletion, and the privacy-request runbook. Stop the
scheduler during a legal hold or incident only under a recorded owner/decision;
stale-health alerts must remain visible.
