# Rollback — 0003_users_is_minor

Removes the `is_minor` STORED generated column from `users`.

## When to roll back

Roll back this migration only if a downstream defect blocks production
deploys. The `canActivate` minor-gate (`src/server/auth/activate.ts`)
depends on this column; rolling back the column will break the GDPR-02
minor-consent enforcement and Phase 1 succescriterium #5 ("under-16
cannot activate without parental consent").

## Rollback SQL

```sql
ALTER TABLE "users" DROP COLUMN "is_minor";
```

## Post-rollback checklist

1. Update `src/server/db/schema/auth.ts` to remove the `isMinor` column
   declaration.
2. Update `src/server/auth/activate.ts` to compute the minor flag in
   application code (NOT a long-term solution — re-introduces the
   timezone-drift risk that the generated column eliminates).
3. Re-run `tests/integration/minor-flow.test.ts` to confirm the
   `parent_link_missing` / `consent_missing` reasons still resolve in
   the application-layer fallback.

## Why this is a separate file (MIG-01)

Drizzle's migration runner does not provide rollback SQL automatically.
Each migration in this directory has a `.rollback.md` companion that
documents the inverse so an SRE can apply it manually with `psql` if a
production rollback is required.
