# ADR 0002: Portable PostgreSQL

- Status: Accepted
- Date: 2026-08-11

## Context

The hosted alpha may use Supabase, but open-source operators need ordinary
infrastructure and the lifecycle requires relational constraints and
transactions.

## Decision

Target PostgreSQL 15+ through server-side `DATABASE_URL`, Drizzle ORM, and
committed SQL migrations. Put lifecycle constraints and indexes in PostgreSQL.
Use relational columns for state/filtering and JSONB only for bounded provider
fragments and versioned model inputs/outputs.

The core must not require Supabase Auth, client-side queries, Realtime, Storage,
Edge Functions, RLS, or proprietary generated APIs.

## Consequences

- Supabase is a hosting choice, not an application dependency.
- Migrations must replay from zero and be safe under controlled release.
- State transitions and idempotency can rely on transactions and constraints.
- Operators remain responsible for backups, pooling, upgrades, and retention.

## Rejected alternatives

A Supabase-specific backend harms portability. An in-memory or document-only
store weakens lifecycle filtering, auditability, and transactional guarantees.

## Verification

CI runs migrations against stock PostgreSQL. Release verification includes a
clean migration replay, schema constraint tests, and backup/restore rehearsal
outside CI before production changes.

## Reversal

A replacement must preserve standard exports, migrations, audit history,
transactional claims, and self-hostability. It requires a superseding ADR.
