# Provider account ownership

This contract prevents a managed-cloud customer from becoming an accidental
operator of TrendsFast's upstream stack.

## Credential modes

| Mode      | Default context  | Account/key owner   | Storage                                     |
| --------- | ---------------- | ------------------- | ------------------------------------------- |
| `fixture` | Local demo/tests | No external account | Deterministic repository fixtures           |
| `managed` | TrendsFast Cloud | TrendsFast operator | Server-side secret manager only             |
| `byok`    | Self-hosting     | Self-host operator  | Server-side environment/secret manager only |

Cloud customers can create named, project-scoped TrendsFast API keys. Multiple
keys share the project's allowance. They do not connect xAI, DataForSEO, Tavily,
Google, GitHub, or model accounts. Self-hosters create and fund their own
accounts and accept the relevant terms.

## Responsibility matrix

| Responsibility                                   | Managed cloud                      | Self-hosted/BYOK        |
| ------------------------------------------------ | ---------------------------------- | ----------------------- |
| Create/verify provider account                   | TrendsFast operator                | Self-host operator      |
| Accept provider terms and confirm commercial use | TrendsFast operator + legal review | Self-host operator      |
| Pay provider invoices and watch quota            | TrendsFast operator                | Self-host operator      |
| Rotate/revoke upstream keys                      | TrendsFast operator                | Self-host operator      |
| Configure per-scan ceilings                      | TrendsFast operator                | Self-host operator      |
| Maintain adapters and fixtures                   | Project maintainers                | Project + local patches |
| Handle end-user data requests                    | TrendsFast operator                | Self-host operator      |
| Create project-scoped TrendsFast API keys        | Customer                           | Self-host operator      |

The build agent cannot purchase accounts, accept terms, complete identity or
payment checks, approve data rights, or enable production billing. Those are
explicit operator actions.

## Secret rules

- Keep development and production credentials separate.
- Inject keys only into server runtimes; never prefix them `NEXT_PUBLIC_`.
- Never store raw provider keys in PostgreSQL in v0.1.
- Do not print keys in health checks, logs, errors, traces, screenshots, issues,
  analytics, support messages, or model prompts.
- Give each credential the least scope available and restrict origins/IPs where
  supported without breaking the runtime.
- Record owner, environment, creation date, rotation due date, billing contact,
  quota alert, and revocation procedure outside the repository.
- Rotate immediately after suspected exposure and invalidate affected sessions
  or derived credentials.

## Read-back ownership

A configured secret is not a healthy source. The operator who owns the account
must run and record a minimal production read-back, verify the returned canonical
URL/provenance, review actual cost/quota, and update the status matrix. Fixture,
mock, test-mode, or local success never upgrades production status.

Use the evidence template in [SETUP_CHECKLIST.md](SETUP_CHECKLIST.md). No
production read-back has been supplied in this repository at the time of this
documentation.
