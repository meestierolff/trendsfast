# Data flow and subprocessor review template

This document describes code paths and review questions. It does not assert
that a candidate is enabled, contractually approved, or legally a subprocessor.

```text
visitor/API client
  -> Cloudflare Turnstile when enabled (browser/network challenge; server sends token, not optional raw IP)
  -> public web/API runtime (admission, validation, pseudonymization)
  -> scoped PostgreSQL runtime role
  -> worker runtime -> enabled public-source/search/model providers
  -> founder ops runtime (human review, correction, delivery)
  -> private capability result

customer -> Stripe-hosted checkout/portal
Stripe signed webhook -> billing runtime -> entitlement/key projection

authenticated ops scheduler -> dedicated retention runtime -> purge -> aggregate health/alerts

account user -> Supabase Auth -> optional Google identity provider
  -> application profile (Auth ID, normalized email, bounded display name/avatar when supplied)
```

The browser must never receive database URLs, provider secrets, Stripe secret
keys, raw API-key material after its one issuance response, or private result
rows. `anon`, `authenticated`, and PostgreSQL `PUBLIC` receive zero application
table/column access; server runtimes use separate public, worker, ops, billing,
and retention login roles. A sixth login, the migrator, owns only the explicit
TrendsFast schema objects and is not an application runtime.

## Candidate register

For each enabled production dependency, the operator must replace “candidate”
with reviewed facts and link the signed DPA/terms and current privacy notice.

| Candidate                     | Proposed purpose/data                                                               | Configuration evidence                              | Review fields before enablement                                                          |
| ----------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Vercel                        | server-rendered hosting, request metadata, application logs                         | deployment-specific                                 | entity, region, log fields/retention, DPA, transfers, access controls                    |
| Supabase                      | hosted PostgreSQL/backups                                                           | database-specific                                   | region, backup/PITR and deletion expiry, DPA, TLS/network controls, restore owner        |
| Supabase Auth / Google        | authentication ID, email, sign-in/session metadata, optional bounded profile fields | only when each sign-in method is explicitly enabled | roles, scopes, provider retention, DPA/terms, transfers, account deletion, support owner |
| Cloudflare Turnstile          | browser/network challenge and challenge token; Siteverify omits optional raw IP     | only when public abuse protection is enabled        | widget hostname/action, DPA/terms, retention, transfers, accessibility and failure path  |
| Stripe                        | hosted checkout/customer portal, signed billing events                              | only when billing gates are enabled                 | controller/processor allocation, IDs/events sent, DPA, tax/statutory records, transfers  |
| xAI / OpenAI                  | synthesis and/or search, depending on selected provider                             | only when configured                                | exact payload minimization, training/retention terms, region/transfers, abuse logging    |
| DataForSEO                    | Google Trends research                                                              | only when configured                                | task payload, retention, data rights, location, DPA/terms                                |
| Tavily                        | public web search                                                                   | only when configured                                | query/result retention, content rights, region/transfers                                 |
| YouTube Data API / GitHub API | public-source metadata                                                              | only when configured                                | API terms, attribution/display, deletion/refresh obligations, token scopes               |
| alert/analytics provider      | aggregate operational alerts or allowlisted analytics                               | optional and disabled until configured              | payload allowlist, consent, retention, recipients, DPA/transfers                         |

Reddit automation remains `LEGAL_REVIEW` and is not approved by this template.
Manual founder evidence must record canonical URLs and provenance without
turning a public page into permission to retain or republish unrestricted text.

## Release review

For the frozen release, inventory every outbound hostname and data field from
runtime configuration and code, compare it with this register and the published
notice, and record: reviewer, UTC date, SHA, dependency status, data categories,
region, retention, transfer mechanism, contract link, deletion route, and
security contact. Unknown fields block enablement; do not infer them from an API
key or a successful request.
