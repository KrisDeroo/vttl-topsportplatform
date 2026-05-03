# Rollback — 0004_verifications_policy_tighten

**Risk:** Reverts the RLS policy split on `verifications` to the open `FOR ALL USING (true)` form from Migration 0002. Reopens the loose-policy surface that allowed `app_user` to UPDATE arbitrary verification rows. Use only when a Better Auth flow regresses on the tightened policy and an immediate restore is required to unblock signups.

**Procedure:** Apply the rollback SQL below in a single transaction inside `psql`. Coordinate with the on-call engineer because Better Auth's verification consume path is touched.

**Verification:** After rollback, confirm:
1. `\d+ verifications` shows a single `FOR ALL` policy (`verifications_consume`) plus the anon-insert policy.
2. `tests/integration/auth-reset.test.ts` and the password-reset / verify-email Better Auth flows succeed end-to-end.
3. `docs/security-incidents.md` (or equivalent) has a new entry documenting WHY the tightened policy was reverted, with a follow-up ticket linked to revisit the policy with a tighter token-ownership predicate that does not break Better Auth's consume contract.

## When to roll back

Roll back ONLY if a Better Auth flow regresses (e.g. signup tokens fail to delete). The expected failure mode is a not-yet-expired token hitting the `verifications_delete` policy's `expires_at < NOW()` predicate inside a Better Auth consume transaction — surfacing as "verification could not be consumed" or similar in app logs.

## Rollback SQL

```sql
BEGIN;

DROP POLICY IF EXISTS verifications_select ON verifications;
DROP POLICY IF EXISTS verifications_insert ON verifications;
DROP POLICY IF EXISTS verifications_delete ON verifications;
DROP POLICY IF EXISTS verifications_no_update ON verifications;

CREATE POLICY verifications_anon_inserts ON verifications FOR INSERT
  WITH CHECK (true);
CREATE POLICY verifications_consume ON verifications FOR ALL
  USING (true)
  WITH CHECK (true);

COMMIT;
```

## Post-rollback checklist

1. Document why the tightened policy was rolled back in `docs/security-incidents.md` (or equivalent) so the next attempt can target the underlying Better Auth contract instead of the RLS shape.
2. File a follow-up to revisit the policy with a tighter token-ownership check that does not break Better Auth's consume flow.

## Why this is a separate file (MIG-01 / MIG-05)

Drizzle's migration runner does not provide rollback SQL automatically. Each migration in this directory has a `.rollback.md` companion that documents the inverse so an SRE can apply it manually with `psql` if a production rollback is required.
