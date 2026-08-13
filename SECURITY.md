# Security policy

TrendsFast handles untrusted URLs, third-party content, private result tokens,
API credentials, and webhook events. Please report vulnerabilities privately.

## Supported versions

This repository is pre-release alpha software. Security fixes target the latest
commit on the default branch and the newest tagged alpha only. No long-term
support promise exists yet.

## Reporting

Use GitHub's private vulnerability reporting feature when it is enabled for the
repository. If that channel is unavailable, contact the maintainer through a
non-public channel listed on the repository profile and request a secure route.
Do not include exploit details in a public issue.

Include, when possible:

- affected commit or version;
- impact and prerequisites;
- minimal reproduction with secrets removed;
- whether untrusted URL fetching, auth, evidence, billing, or tenant isolation
  is involved;
- suggested mitigation.

Never test against production data, disrupt service, access another person's
scan, retain personal data, or perform denial-of-service testing. Use fixture
mode and your own local data.

## Response targets

These are goals, not contractual service levels:

- acknowledge a complete report within 3 business days;
- provide an initial assessment within 7 business days;
- coordinate disclosure after a fix or documented mitigation.

We will credit reporters who want credit. Duplicate, non-actionable, automated,
or out-of-scope reports may receive a shorter response.

## Security boundaries

Highest-risk areas include SSRF and DNS rebinding, prompt injection, secret
leakage, unguessable-token access, API-key verification, CSRF, idempotency,
webhook signatures, cross-tenant access, evidence fabrication, and retention.
See [the threat model](docs/security/THREAT_MODEL.md).

Repository-level controls, sensitive-path ownership, workflow pinning, and the
remote-settings verification procedure are documented in the
[repository security runbook](docs/security/REPOSITORY_SECURITY.md).

No build or test result should be represented as a third-party security audit.

## Known pre-launch gaps

The current alpha requires additional controls before public deployment:
remote CI and externally observed browser/header/bundle acceptance; trusted
proxy/abuse-boundary verification, including an independent edge throttle for
public capability lookups; scheduled retention and authenticated privacy-request
operations; backup/restore rehearsal; explicit operator policy for uncertain
post-charge retries; and final review of model cost settlement and price
metadata. The current hosted-launch code and database-role audit remains open;
no clean P0/P1 conclusion is claimed until it is tied to an immutable release
SHA. See the
[launch checklist](docs/operations/LAUNCH_CHECKLIST.md). Do not treat this list
as exhaustive or as risk acceptance.
