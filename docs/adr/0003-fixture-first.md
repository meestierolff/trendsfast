# ADR 0003: Fixture-first delivery

- Status: Accepted
- Date: 2026-08-11

## Context

Provider access costs money, requires external accounts and terms, and can make
early development slow or non-deterministic. A dashboard wired to mocks but not
the real lifecycle would still be a brittle demo.

## Decision

The complete vertical slice must work first in `fixture` credential mode:

```text
URL -> context -> provider-shaped fixture signals -> clusters -> opportunity
    -> proposed Next Move -> founder review -> private delivery -> feedback
```

Fixtures use the same adapter, schema, evidence, scoring, persistence, and UI
contracts as live modes. They must include `WAIT`, partial failure, stale data,
duplicate origins, and malicious content cases—not only a happy path.

## Consequences

- Contributors can work without paid credentials.
- Tests are deterministic and provider cost is zero.
- Passing fixtures do not prove provider connectivity, rights, current schemas,
  production security, or result quality on live data.
- Source status records fixture availability separately from production
  read-back.

## Rejected alternatives

Building live adapters first couples core logic to unstable APIs. UI-only mocks
skip orchestration and evidence guarantees. Unrecorded manual demos cannot be
regression tested.

## Verification

Clean install, migration, seed, unit/contract tests, and browser flows run with
all paid provider variables empty and network provider calls disabled.

## Reversal

Fixture mode is a permanent contributor contract. Individual fixtures may be
versioned or replaced when provider contracts change.
