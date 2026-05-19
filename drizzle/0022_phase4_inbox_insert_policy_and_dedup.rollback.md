# Rollback: 0022_phase4_inbox_insert_policy_and_dedup.sql

## Risk
MEDIUM. Reverting restores the silent-fail state (D-67 ch2 / D-72 ch2 inbox
channel degrades to no-ops) and removes dedup (cron stacks 14 rows/user).
Coupled with 0023 — must roll back 0023 first because its INSERT references
the constraint dropped here.

## Procedure
```sql
-- Roll back 0023 first.
DROP INDEX IF EXISTS "uq_system_inbox_daily";
GRANT INSERT, DELETE ON "system_inbox" TO "app_user";
DROP POLICY IF EXISTS "system_inbox_insert_security_definer" ON "system_inbox";
```

## Verification
- `\d system_inbox` shows no `uq_system_inbox_daily` index.
- `SELECT polname FROM pg_policy WHERE polrelid = 'system_inbox'::regclass`
  returns only `system_inbox_select_own` + `system_inbox_update_own`.
- `pnpm test tests/integration/system-inbox-insert-policy.test.ts --run`
  app_user-cannot-insert assertion now FAILS (expected post-rollback behaviour).

## Reference
- .planning/phases/04-kerndomein/04-VERIFICATION.md §gaps[5,6]
- .planning/phases/04-kerndomein/04-REVIEW.md §CR-06 §CR-07
