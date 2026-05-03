# Rollback — 0003_users_is_minor

This migration is intentionally a no-op (see CR-01 fix in
`drizzle/0003_users_is_minor.sql`). There is nothing to roll back at the
schema layer.

## Background (CR-01 fix, 2026-05-01)

The original draft of this migration attempted to add `users.is_minor`
as a STORED generated column whose expression referenced
`CURRENT_DATE`. Postgres rejects non-IMMUTABLE expressions in STORED
generated columns, so the migration could not apply.

The minor-flag computation moved to application code:
`isMinorAt(dateOfBirth, now)` in `src/lib/consent.ts`, called from
`src/server/auth/activate.ts`. The migration file is preserved as a
no-op so `drizzle/meta/_journal.json` (idx 3) still references a valid
file and subsequent migrations keep contiguous numbering.

## When to roll back

Never — the migration makes no schema change. If a downstream defect
forces a rollback, the only artifact to revert is the application-side
helper in `src/lib/consent.ts` (and its consumer in
`src/server/auth/activate.ts`).

## Rollback SQL

None required.

## Why this is a separate file (MIG-01)

Drizzle's migration runner does not provide rollback SQL automatically.
Each migration in this directory has a `.rollback.md` companion that
documents the inverse so an SRE can apply it manually with `psql` if a
production rollback is required. This file remains for parity even when
the migration itself is a no-op.
