# Privacy notice — alpha drafting template

> **DO NOT PUBLISH AS-IS. FOUNDER AND QUALIFIED PRIVACY-COUNSEL REVIEW REQUIRED.**
> Replace every `[PLACEHOLDER]`, verify actual data flows and retention, and add
> an effective date. This is not legal advice.

## Who we are

`[LEGAL ENTITY, REGISTRATION/JURISDICTION, ADDRESS]` operates TrendsFast. Contact
`[PRIVACY EMAIL]`. If applicable, identify `[DPO/EEA-UK REPRESENTATIVE]`.

## Scope

This notice covers `[HOSTED SERVICE, WEBSITE, API, SUPPORT]`. It does not govern
independent self-hosted deployments; their operators decide their own purposes
and responsibilities.

## Data we intend to process

- submitted product URLs and optional scan preferences;
- inferred product context, query plans, source receipts, recommendations,
  limitations, founder-review edits, and feedback/outcomes;
- contact/account information only where the implemented journey collects it;
- security/operations data such as IP-derived abuse signals, timestamps, API-key
  prefixes, authorization outcomes, device/browser metadata, and audit events;
- billing identifiers and subscription state if billing is later enabled (Stripe
  processes payment details; specify the real division of responsibility);
- first/current-touch attribution and allowlisted product events.

List fields the deployed build actually collects. Do not say “may collect
anything.” Do not include raw provider keys in any data inventory.

## Sources and purposes

Explain whether data comes from the user, a submitted public website, configured
providers, manual founder evidence, service logs, or Stripe. Map each category
to concrete purposes: provide/review/deliver a scan, prevent abuse, secure and
operate the service, support users, measure product quality, comply with law,
and bill only if enabled.

For each purpose, counsel must assign the lawful basis in every launch
jurisdiction (`[CONTRACT / LEGITIMATE INTERESTS + ASSESSMENT / CONSENT / LEGAL
OBLIGATION]`). Do not reuse submitted content for model training or unrelated
marketing unless that use is explicitly implemented, disclosed, and lawful.

## Providers and recipients

Publish the actual current subprocessor/provider list, purpose, data categories,
location, and policy link. Candidates may include hosting, PostgreSQL hosting,
model/search/data providers, error monitoring, email delivery, analytics, and
Stripe. A candidate architecture list is not a statement that every provider is
active.

Disclose that public-source operators and destination sites have independent
policies. Explain human founder review and whether any legally significant
automated decision-making occurs (`[EXPECTED: NONE; VERIFY]`).

## International transfers

State actual hosting/provider regions and transfer mechanism(s), including SCCs,
UK addendum, adequacy, or other safeguards where applicable: `[DETAILS]`.

## Retention

Replace with implemented periods and deletion mechanics:

| Data                                 | Proposed alpha rule                              | Approved/implemented value |
| ------------------------------------ | ------------------------------------------------ | -------------------------- |
| Scan/request/result                  | default configuration suggests 90 days           | `[VERIFY]`                 |
| Evidence excerpts/provider fragments | minimum needed, never indefinite by default      | `[VERIFY]`                 |
| Security/audit/cost records          | purpose-specific limited period                  | `[VERIFY]`                 |
| Deleted/public scan references       | remove visibility promptly; define backup expiry | `[VERIFY]`                 |
| Billing/tax records                  | statutory period when billing exists             | `[VERIFY]`                 |

Explain backups, legal holds, aggregation/anonymization, and provider-side
retention. A config variable alone is not proof that deletion runs. The current
repository supplies exact-project deletion and `pnpm db:purge` for eligible
terminal/nonterminal scans, expired delivery tokens, linked analytics, and
eligible orphan projects, but no privacy-request route, export,
scheduler/alerts, backup-expiry proof, or legal-hold workflow; the deployed
notice must describe only what operators have actually wired and tested.

## User choices and rights

Describe applicable access, correction, deletion, restriction, objection,
portability, consent withdrawal, complaint, and appeal rights; identity
verification; response channel; deadlines; authorized agents; and regulator
contacts. Public case-study use must be explicit opt-in and revocable without
making prior lawful distributions technically disappear.

## Cookies and analytics

List actual essential session/security cookies and optional analytics. Explain
consent rules by region. TrendsFast must not send private result tokens, emails,
API keys, submitted URL query strings, evidence text, prompts, provider payloads,
or free-text feedback to optional analytics.

## Security and children

Describe reasonable safeguards without promising absolute security. State the
approved minimum age and geography: `[AGE / GEOGRAPHIES / VERIFICATION]`.

## Changes and contact

Explain notice of material changes, effective/archive dates, and privacy request
or complaint contact: `[DETAILS]`.

## Required approval record

`[FOUNDER, COUNSEL, DATE, RELEASE SHA, DATA-FLOW AUDIT, RETENTION JOB TEST,
SUBPROCESSOR REVIEW, JURISDICTIONS]`
