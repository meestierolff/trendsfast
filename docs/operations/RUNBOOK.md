# Founder operations runbook

This runbook assumes one application, standard PostgreSQL, bounded scan
execution, and billing/paid monitoring disabled. Replace placeholder contacts
and dashboards in the private deployment record before launch.

## Principles

1. Preserve user privacy, evidence integrity, and audit history.
2. Stop new harmful/expensive work before attempting repair.
3. Degrade or return `WAIT`; never hide missing coverage.
4. Retry the smallest idempotent step, not the entire scan.
5. Do not delete or mutate production data during diagnosis.
6. Record timestamps in UTC, release SHA, scope, actions, and owner.

## Triage

| Severity | Example                                                                                              | First response goal                                                          |
| -------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| P0       | secret/customer-data exposure, cross-tenant access, fraudulent charge, evidence fabrication at scale | disable affected entry point immediately; page founder/security/legal owners |
| P1       | all scans unavailable, runaway spend, repeated duplicate delivery, deletion failure                  | stop affected work and begin incident record urgently                        |
| P2       | one provider degraded, backlog growing, incorrect non-critical metadata                              | mark degraded, bound impact, schedule repair                                 |
| P3       | cosmetic/docs issue with no trust impact                                                             | normal issue workflow                                                        |

No response-time promise is public until staffing supports it.

## Stuck scan

1. Identify request/run/attempt without exposing private tokens.
2. Inspect the last committed checkpoint, hard deadline, processing fence,
   source statuses, attempts, duration, and reserved/actual/unknown cost.
3. Confirm the current deadline/fence and whether any provider step is still
   `RUNNING`. Do not infer that an interrupted upstream call had no effect.
4. After the hard deadline, let the processor rotate the fence and reclaim the
   persisted attempt; there is no separate reclaim button. Stale workers are
   rejected at every processing mutation. Never edit state directly in SQL
   without an approved emergency procedure.
5. The current ops action retries a whole `FAILED` scan. Source-only/synthesis-
   only retry is not callable yet; do not pretend the broader retry is the
   smallest step. When fine-grained retry exists, recompute dependent work.
6. If recovery records `PROVIDER_OUTCOME_UNKNOWN`, it has intentionally not
   replayed that provider. Reconcile the provider request/effect and charge
   before considering the explicit whole-scan retry. Keep non-fixture retry
   blocked when the outcome cannot be established. This classification wins
   over an expired-deadline label when both apply.
7. Verify delivery effect has not succeeded before redelivery.
8. If quality/coverage is inadequate, convert to reviewed `WAIT` or fail with a
   clear limitation. Record the review event.

## Provider degradation or bad evidence

1. Disable the provider circuit/config flag if it can return harmful results or
   exceed spend; otherwise let the breaker trip.
2. Change the public source status to `DEGRADED`/`UNVERIFIED` and add the scope
   and timestamp. Do not retain “LIVE” based on historical success.
3. Quarantine affected evidence from new recommendations; do not silently swap
   URLs in delivered results.
4. Identify provider request IDs, contract version, normalization change,
   affected scans, cost, and rights implications.
5. Use fixtures to reproduce, then a minimal authorized read-back.
6. Re-enable gradually and update the read-back record.

For a disappeared or disputed URL, mark `SOURCE_NO_LONGER_AVAILABLE`, remove
public display when appropriate, retain minimal lawful audit facts, and notify
affected users if the recommendation materially changes.

## Provider cost ceiling or quota incident

1. Stop admission of new external steps; preserve fixture mode and result access.
2. Compare durable pre-I/O reservations, settled/unknown costs, retries,
   price-version metadata, and provider invoice/usage console. A valid
   provider-reported usage record may settle a reservation; entries still
   labeled `conservative_pre_call_reservation`/`unknown_not_settled` are ceilings,
   not provider-reported usage.
3. Revoke a leaked key and rotate through the secret manager if abuse is
   suspected. Do not print the old/new key.
4. Lower per-scan/provider limits or disable the adapter; do not raise the
   ceiling just to clear the queue.
5. Reconcile unknown cost, verify the operator-supplied model input/output price
   schedule and effective date, and document whether users received partial or
   `WAIT` results.

For API-key budget incidents, inspect each rolling-hour request's persisted
reservation and summed run `GREATEST(estimated, actual)` cost without editing the
ledger. Admission counts the greater per request and compares integer micro-USD
totals. A crash reservation intentionally remains until the hour elapses; do not
clear it merely to admit work.

## Suspected secret exposure

1. Treat the secret as compromised; revoke/rotate it at the issuing provider.
2. Disable affected integration and scan logs/artifacts/browser bundles without
   reproducing the secret in the incident record.
3. Determine exposure window and misuse from provider/audit metadata.
4. Rotate dependent sessions/peppers only when scoped evidence requires it;
   pepper rotation needs an API-key reissue plan.

Current blocker: a Stripe test key appeared in local CLI output. Revoke/rotate
it before further Stripe work, inspect the provider audit trail for misuse, run
`stripe login` for the intended sandbox account, and retain only redacted
rotation/verifier evidence. Do not reproduce the key in the incident record. 5. Notify affected parties and authorities as counsel determines. 6. Add a regression check and sanitized post-incident record.

## Private result or tenant access incident

Disable sharing/token lookups if needed, revoke affected tokens/keys, preserve
access logs, establish which records were accessible, stop public analytics for
affected routes, and follow privacy/legal notification decisions. Never test by
opening another user's result.

## Database/migration incident

Pause new scans and migrations. Capture health, connection pool, migration
version, and error without dumping rows. Prefer forward repair. Roll back app
code only when schema compatibility is verified. Restore to a separate database
first and compare; never overwrite production with an unverified backup.

Legacy upgrade note: migration `0007` backfills existing requests with a zero
API cost reservation. Operators upgrading across that historical migration must
drain preexisting queued API work or perform a reviewed conservative backfill
before allowing concurrent production creation. Do not assume a zero backfill
represents the work's real maximum cost.

## Billing incident

Billing and paid monitoring should be off until their live gate passes. If later
enabled, set `BILLING_ENABLED=false` and `PAID_MONITORING_ENABLED=false` to stop
new checkout/scheduled claims while retaining subscriptions and webhook
reconciliation.
Never delete Stripe/local records to make them “match.” Verify signed events,
event order, and customer identity; coordinate refunds and notifications through
approved policy.

## Deletion request

Authenticate the request proportionately, identify all scan/project/evidence/
feedback/analytics/billing references, disclose lawful retention exceptions,
invoke the exact-project deletion repository operation from a reviewed one-off
admin procedure, verify public/cache removal and backup expiry, and record only
the minimal completion audit. No authenticated privacy-request endpoint or
operator UI exists yet. Manual SQL deletion is a last-resort reviewed operation
with a transaction and backup.

## Retention purge

The repository exposes `pnpm db:purge` for retained terminal and nonterminal
(`QUEUED`, `RUNNING`, and `REVIEW_REQUIRED`) scans, expired delivery tokens,
linked analytics, and eligible orphan projects. The application does not
schedule it. Until a single-owner job with alerts and reviewed dry-run evidence
exists, run the CLI only through a reviewed operational procedure, record counts
and cutoff without row payloads, and treat missed execution as a launch blocker.

## Recovery closeout

Confirm product behavior, status labels, alerts, cost, evidence validity, queue,
and user remediation. Record cause, detection gap, timeline, impact,
countermeasure, owner, due date, and any public notice. Close only after the
regression test and documentation are merged.
