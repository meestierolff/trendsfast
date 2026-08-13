# Privacy request, takedown, export, and deletion runbook

This is an operator workflow, not an automated public rights portal or legal
advice. Counsel must approve rights, deadlines, exceptions, identity standards,
authorized-agent handling, legal holds, and statutory billing retention. Do not
promise an untested mailbox or deadline.

## Intake and triage

1. Record a private request ID, receipt time, jurisdiction claimed, requested
   action, and assigned founder/backup owner. Keep the request body outside
   source control and application logs.
2. Verify identity proportionately using information already held. Never ask
   for an API key, password, full payment card, or private capability token in
   email. Verify an agent's authority separately.
3. Classify access/export, correction, deletion, restriction/objection, consent
   withdrawal, public-source takedown, or billing record request. Escalate
   disputes, minors, litigation/regulatory holds, or uncertain ownership to
   qualified counsel.
4. Resolve one exact internal project ID or normalized submitted URL. Before a
   destructive action, an ops operator must read back the target identity and
   request scope; never use a partial email/domain match or bulk wildcard.

## Export or correction

- Use a separately approved, short-lived operator/admin database session with
  `DATABASE_SSL_CA` from the approved secret manager
  in an access-controlled environment. The existing founder-private dogfood
  export (`pnpm dogfood:export`) is a review artifact, not a general DSAR export;
  adapt and review the exact target query without adding unrelated projects,
  provider secrets, other users, internal abuse fingerprints, or privileged
  security notes.
- Write the export only under an ignored mode-`0700` private directory with a
  mode-`0600` file, encrypt for the verified recipient, use an authenticated
  delivery channel, set a deletion date, and have a second operator review the
  manifest. Do not attach raw database dumps or logs.
- Correct source fields at their authoritative layer; preserve the minimum
  immutable audit required by the approved policy and clearly distinguish a
  corrected projection from third-party source material TrendsFast cannot edit.

## Takedown or deletion

- For public visibility, revoke delivery/share consent first using founder ops
  controls. A source takedown may also require removing stored excerpts and
  preventing re-ingestion; record the canonical source and adapter follow-up.
- The implemented destructive primitive is
  `repositories.privacy.deleteProjectData({ projectId })` or the exact
  normalized-URL form. It deletes linked scan, analytics, key, grant, checkout,
  and project data through reviewed transaction/cascade behavior. Invoke it
  only from a reviewed single-purpose operator script/session after
  backup/legal-hold review; the narrowed web ops and scheduled-retention roles
  intentionally cannot perform this broad exact-project delete, and there is no
  public deletion endpoint.
- Billing/tax, fraud/security, incident, and immutable audit records may require
  a narrower deletion or restricted retention. Do not run the broad primitive
  until counsel and the billing owner decide the exact exception set.
- Capture only aggregate before/after counts, request ID, operator, UTC time,
  release SHA, action, exception category, and backup-expiry ticket. Never put
  row content, email, raw URL query strings, secrets, or tokens in the audit.

## Completion

Verify the target no longer resolves in public, API, founder ops, and optional
analytics/search indexes. Record provider deletion requests and backup expiry
separately; a primary-database delete is not proof of backup/provider erasure.
Have a second operator review the outcome, respond through the verified channel,
and securely delete the working export at its deadline. Any missing mailbox,
owner, legal approval, backup policy, or provider mechanism remains an explicit
launch blocker.
