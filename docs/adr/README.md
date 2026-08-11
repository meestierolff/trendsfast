# Architecture decision records

Accepted decisions are durable constraints, not claims that every consequence
has already been implemented or externally verified.

| ADR                                     | Decision                                                            |
| --------------------------------------- | ------------------------------------------------------------------- |
| [0001](0001-independent-repository.md)  | Build in an independent repository with fresh history.              |
| [0002](0002-portable-postgresql.md)     | Use portable PostgreSQL and committed SQL migrations.               |
| [0003](0003-fixture-first.md)           | Prove the complete vertical slice in fixture mode first.            |
| [0004](0004-resumable-state-machine.md) | Persist an asynchronous resumable scan state machine.               |
| [0005](0005-agpl-and-trademark.md)      | License the real engine AGPL-3.0-only and protect marks separately. |

Use the next zero-padded number. Include context, decision, consequences,
alternatives, verification, and reversal conditions. Supersede; do not silently
rewrite the substance of an accepted ADR.
