# Rollback — 0003_users_is_minor

**Risk:** None at the schema layer — this migration is intentionally a no-op (see CR-01 fix in `drizzle/0003_users_is_minor.sql`). The only operational risk is forgetting that the minor flag has moved to application code: a partial revert that drops `isMinorAt()` from `src/lib/consent.ts` while keeping `activate.ts` callers in place would make `canActivate()` reject every user with a non-null `dateOfBirth`.

**Procedure:** No SQL required. If a downstream defect forces a rollback of the application-side helper:
1. `git revert` the CR-01 fix commit (`55f8da4`).
2. Re-deploy the web tier.
3. The journal entry for migration 0003 stays intact (the no-op file is still recorded in `drizzle/meta/_journal.json`).

**Verification:**
1. `\d users` in `psql` returns the column list WITHOUT `is_minor` (confirms no schema change ever applied).
2. After the application revert, every call site of `canActivate(userId)` resolves correctly via the TypeScript-side `isMinorAt(birthDate, now)` helper.
3. Integration tests `tests/integration/minor-flow.test.ts` and `tests/integration/consent.test.ts` still pass.

## Background (CR-01 fix, 2026-05-01)

The original draft of this migration attempted to add `users.is_minor` as a STORED generated column whose expression referenced `CURRENT_DATE`. Postgres rejects non-IMMUTABLE expressions in STORED generated columns, so the migration could not apply.

The minor-flag computation moved to application code: `isMinorAt(dateOfBirth, now)` in `src/lib/consent.ts`, called from `src/server/auth/activate.ts`. The migration file is preserved as a no-op so `drizzle/meta/_journal.json` (idx 3) still references a valid file and subsequent migrations keep contiguous numbering.

## When to roll back

Never — the migration makes no schema change. If a downstream defect forces a rollback, the only artifact to revert is the application-side helper in `src/lib/consent.ts` (and its consumer in `src/server/auth/activate.ts`).

## Rollback SQL

None required.

## Why this is a separate file (MIG-01 / MIG-05)

Drizzle's migration runner does not provide rollback SQL automatically. Each migration in this directory has a `.rollback.md` companion that documents the inverse so an SRE can apply it manually with `psql` if a production rollback is required. This file remains for parity even when the migration itself is a no-op — and is required by `tests/unit/migration-format.test.ts` (MIG-05 contract).
