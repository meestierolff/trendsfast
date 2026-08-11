# ADR 0005: AGPL engine with separate trademark policy

- Status: Accepted
- Date: 2026-08-11

## Context

The repository should be a real acquisition and trust channel. Users need the
actual decision engine, while network-hosted improvements should remain
available and the official service must remain distinguishable from forks.

## Decision

License the web app, API, orchestration, provider interfaces, scoring, evidence,
and decision engine under **GNU AGPL v3.0 only**. Keep the TrendsFast name, logo,
domain, and trade dress outside that copyright license under `TRADEMARK.md`.
A future thin SDK/CLI may use MIT only through a separate explicit decision.

## Consequences

- Network operators modifying covered software must understand AGPL section 13
  source-offer obligations.
- The public repository must contain the real engine, not an intentionally
  crippled substitute.
- Managed differentiation comes from operations, credentials, history,
  scheduling, reliability, cost controls, and support.
- Forks may exercise license rights but may not imply official endorsement.

## Rejected alternatives

Permissive licensing would not preserve network modifications. A closed engine
would create open-source theater. Treating trademark as a license restriction
would blur separate bodies of law.

## Verification

Confirm the full license text, package metadata, source-link availability for a
hosted modified version, third-party license provenance, and trademark wording.
Founder and qualified legal counsel must review before commercial launch.

## Reversal

Relicensing existing contributions may require every copyright holder's
permission. Do not assume it can be changed unilaterally.
