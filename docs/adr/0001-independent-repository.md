# ADR 0001: Independent repository

- Status: Accepted
- Date: 2026-08-11

## Context

TrendsFast needs a clear product boundary, reviewable provenance, and a public
history that does not inherit unrelated branding, authentication, billing,
migrations, or assumptions from Postiz, Venture Harness, ShipToUsers, or another
project.

## Decision

Build TrendsFast in a new independent repository with fresh history. The
preferred public remote is `github.com/trendsfast/trendsfast`; the founder's
namespace is an acceptable fallback. Small generic modules may be copied only
when provenance is documented, assumptions are audited, and rebuilding is
materially slower.

## Consequences

- Product contracts, issues, releases, security policy, and license stand alone.
- Venture Harness may later register or operate this project but is not a code
  host or launch dependency.
- Contributors must not copy whole repositories or obscure provenance.
- A public remote still requires founder action; local history is not evidence
  that the preferred remote exists.

## Rejected alternatives

Forking Postiz, building inside another venture, or blocking on a generic
platform would couple TrendsFast to unrelated history and product choices.

## Verification

Before public launch, verify the repository root, inspect `git log`, confirm
remote ownership, run a provenance/license scan, and record the result in the
launch checklist.

## Reversal

Revisit only if ownership or legal provenance makes the independent repository
impossible. Migration must preserve auditable history and user-facing source
availability.
