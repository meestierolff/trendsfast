# Threat model

Status: living alpha threat model, last reviewed 2026-08-11. This is not a
third-party security audit or certification.

## Scope and assets

In scope: public scan/API routes, URL fetcher, provider/model calls, PostgreSQL,
private result tokens, API keys, ops sessions, evidence receipts, cost and event
ledgers, future Stripe webhooks, logs, and CI/release configuration.

Protect confidentiality of secrets and private scans; integrity of evidence,
states, entitlements, and audit history; availability and bounded provider
spend; user deletion/retention choices; and accurate public status claims.

## Actors and assumptions

Attackers may be anonymous users, malicious site owners, compromised provider
content, leaked-key holders, abusive tenants, dependency attackers, or mistaken
operators. Fetched pages and every provider/model response are hostile data.
Possession of an unguessable token authorizes only the narrow resource encoded
by that token; it is not identity.

## Primary threats and controls

| Threat                               | Current prevention/detection                                                                                                                                                                                                                                                     | Verification/residual                                                                                                                               |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| SSRF, redirect escape, DNS rebinding | Allow only HTTP(S); normalize; reject credentials/reserved hosts and addresses; re-resolve every hop; pin the Node connection to a validated numeric address while preserving Host/SNI; cap redirects/body/time/content types; abort the socket on deadline                      | Address/redirect/rebinding/transport tests exist; a production read-back and controlled-socket integration remain release evidence                  |
| Prompt injection from sites/signals  | Delimit hostile content; least-data prompts; no tools; strict schemas; 65,536-byte model input, 262,144-byte response, and output-token caps; at most one repair                                                                                                                 | Malicious fixtures and bounded model-client tests; live model behavior remains unverified                                                           |
| Fabricated or swapped evidence       | Deterministic selection precedes synthesis; model output must retain the exact evidence-ID set and cannot supply URLs, metrics, providers, or sources; binding requires stored/allowed records, valid URLs/sources, relevance reason, and support                                | Negative exact-set, invented/dropped/duplicate ID, field-injection, missing-record, and tamper tests                                                |
| Secret exposure                      | Server-only config; fail-closed environment schema; redaction; provider keys excluded from DB/client; bounded diagnostic fragments; rotate after suspected exposure                                                                                                              | Secret-pattern, browser-bundle/config, and log tests remain release checks                                                                          |
| Private result enumeration           | Public scan/status and delivery capabilities each use 256 CSPRNG bits; delivery tokens are hashed and expire; errors are generic; retained scans/tokens can be purged                                                                                                            | Entropy/hash/unknown-token tests; public lookup has no independent durable throttle, so deployed edge control remains a defense-in-depth P2         |
| API-key theft/forgery                | Show-once secret; prefix plus secure hash/pepper; constant-time compare; scope/environment/project/expiry/revoke/audit; strict key syntax; in-process in-flight bound plus PostgreSQL-backed cross-instance admission before scrypt                                              | Auth/mode/scope/rate/revoke/expiry and durable-admission tests; deployed trusted-proxy/fingerprint behavior still requires verification             |
| Cross-tenant access                  | Tenant-filtered repositories, key/project restriction, deny-by-default authorization                                                                                                                                                                                             | Negative matrix/integration tests                                                                                                                   |
| CSRF/session fixation                | Signed `HttpOnly`/`SameSite=Strict` ops session; same-origin login/private mutations; session-bound CSRF for ops actions; bounded JSON/form bodies                                                                                                                               | Browser, origin, session, action, and actual-byte body-bound tests                                                                                  |
| Injection/XSS                        | Runtime validation, parameterized ORM/SQL, output escaping, sanitized limited HTML, CSP                                                                                                                                                                                          | Injection corpus and CSP/browser checks                                                                                                             |
| Abuse and spend exhaustion           | Atomic public admission; bounded bodies; provider/day/cost limits; durable auth admission; and atomic per-key rolling-hour API cost admission that locks the key, rechecks idempotency, and compares exact micro-USD reservations/committed cost                                 | Race/body/limit/cost tests; public lookup edge throttling, proxy-boundary, alert, and deployed capacity verification remain                         |
| State/delivery replay                | PostgreSQL state, persisted hard deadline, rotating processing fence on claim/reclaim, fenced mutations, request/provider/delivery idempotency, and no automatic replay after an interrupted provider effect                                                                     | Unknown provider outcome takes precedence over an expired deadline; explicit whole-scan retry after an uncertain charge remains ambiguous           |
| Model spend/accounting               | Explicit non-fixture input/output prices; conservative byte/output-token upper-bound estimate; atomic pre-call ledger reservation; duplicate reservation refuses replay; scan ceiling includes committed estimate                                                                | Reservation concurrency/ceiling tests; provider-reported actual token usage is not settled and operator price metadata is not independently trusted |
| Stripe spoofing                      | Billing off by default; target design requires raw-body signatures, event idempotency, and server-derived price/entitlement                                                                                                                                                      | Application billing routes do not exist; official test fixtures/CLI are required before enablement                                                  |
| Retention/privacy failure            | Minimal excerpts; exact-project delete; `pnpm db:purge` covers retained terminal/nonterminal scans, expired delivery tokens, linked analytics, and eligible orphan projects; optional external analytics is privacy-filtered                                                     | Repository/CLI/integration contracts exist; authenticated request intake, scheduling/alerts, export, backup expiry, and legal holds remain gates    |
| Supply-chain compromise              | Frozen lockfile, reviewed dependency updates, minimal workflow permissions, pinned actions by major/version policy, artifact provenance before release                                                                                                                           | CI audit/review; founder chooses release policy                                                                                                     |
| Ops compromise                       | Long server-only token; constant-time compare; signed secure cookie; same-origin login; CSRF for review actions; bounded bodies; in-process in-flight bound plus PostgreSQL-backed admission (5/fingerprint and 100/global per five-minute window); audit; optional network gate | Session/action/admission/origin tests; single-founder token auth and deployed access/proxy controls remain limitations                              |

## SSRF decision sequence

1. Parse once with a standards-compliant URL parser and allow only `http:` or
   `https:`.
2. Reject malformed hosts, embedded credentials, prohibited ports, and direct
   IPs in blocked ranges.
3. Resolve all A/AAAA records; reject if any result is blocked.
4. Connect to a validated numeric address with bounded timeout/size while
   retaining the original Host/SNI and preventing library-level redirect
   following.
5. For each redirect, repeat parsing and DNS/range validation; stop at the cap.
6. Permit only explicitly supported textual content types; never render or
   execute fetched scripts.
7. Record safe metadata, not secret-bearing headers or full bodies.

The default Node transport pins the connection to an address returned by the
validation step and repeats the process for every redirect. Any replacement
transport must preserve that contract. The injected-dispatch tests do not
replace a controlled-socket test or production-environment read-back.

## Privacy/data flows

Submitted URLs, inferred product context, evidence excerpts, feedback, and ops
edits may be personal or confidential. Do not send emails, private tokens,
submitted URL query strings, API keys, evidence text, prompts, provider payloads,
or free-text feedback to optional external analytics. Publishing a private scan
as a public case study requires explicit consent and a revocation/takedown path;
the current repository records opt-in but does not yet expose withdrawal or
publication automation.

## Abuse cases that must fail safely

- URL points to `localhost`, RFC1918, IPv6 loopback, cloud metadata, or a public
  hostname that redirects/rebinds there;
- a page tells the model to reveal secrets or override its policy;
- a provider returns an invented URL or extreme metrics;
- two requests race with one idempotency key;
- a worker dies after charging a provider but before committing success;
- an attacker guesses result tokens or replays a delivery/webhook;
- a valid low-cost source produces a recommendation with dependent evidence;
- billing configuration is partial or a price ID is supplied by the browser.

## Residual risks and release blockers

Provider terms and data rights can change; legal review is separate from
technical security. Founder-token ops auth is not suitable for multi-user
administration. A replacement/serverless website transport must preserve the
validated-address pinning contract. Model outputs remain probabilistic.
Dependency and provider compromise cannot be eliminated.

Before public launch, all P0/P1 findings must be resolved or explicitly accepted
by the founder with scope and expiry. Before live billing or customer accounts,
obtain focused legal/security review and replace temporary auth where needed.

The final local read-only audit found no open P0/P1. The remaining
public-capability lookup throttle/deployed-edge control is a lower-priority P2,
not permission to skip remote CI or external verification.

One internal request type still permits `apiKeyId` with a non-API origin. No
current/external caller constructs that combination, and API-origin generic
creation is rejected, but future repository callers must not treat the type as
the authorization boundary.

Implementation audit note: public count/duplicate/insert admission is serialized
per pseudonymous fingerprint, and all mutation bodies are stream-counted before
parsing. API and ops authentication add fixed-cardinality PostgreSQL admission
before expensive verification. Public scan and delivery capabilities use 256
random bits. API creation separately uses row-locked rolling-hour cost admission
with a persisted one-hour fail-safe reservation and in-lock idempotency recheck.
Local application candidate `072d5fc` passed the production build/browser and direct private
no-store/noindex/referrer/CSP/isolation checks. Remote CI and external
verification are still required.

Automatic recovery checks for a provider left `RUNNING` before the expired
deadline label, records `PROVIDER_OUTCOME_UNKNOWN`, and invalidates stale workers
through a persisted fence. The explicit ops whole-scan retry is broader: until an operator can
reconcile whether the upstream charge/effect occurred, non-fixture manual retry
remains launch-blocking. Model reservations likewise stay conservative and
`unknown_not_settled` until actual provider usage reconciliation exists.
