# Deferred database push — 04-14

`pnpm db:push --force` was not executed during Wave 5 worktree execution because:

1. `DATABASE_URL` is unset in the executor environment.
2. `node_modules` is also absent in the worktree (drizzle-kit not on PATH); the
   parent project installs it, but parallel worktrees do not get a copy.

The migrations 0022 + 0023 are committed to git and additive only
(CREATE POLICY, REVOKE, CREATE INDEX, CREATE OR REPLACE FUNCTION) — there are
no DROP or destructive operations. The `--force` flag is therefore safe.

## Operator action required on staging

```bash
# 1. Apply the migrations non-interactively.
pnpm db:push --force

# 2. Verify the policy is present.
psql "$DATABASE_URL" -c "SELECT polname FROM pg_policy WHERE polrelid = 'system_inbox'::regclass;"
# Expected output includes:
#   system_inbox_insert_security_definer
#   system_inbox_select_own
#   system_inbox_update_own

# 3. Verify the partial unique index is present.
psql "$DATABASE_URL" -c "SELECT indexname FROM pg_indexes WHERE tablename = 'system_inbox';"
# Expected output includes:
#   uq_system_inbox_daily
#   idx_system_inbox_user_unread
#   idx_system_inbox_user_all

# 4. Verify app_user has no INSERT/DELETE on system_inbox.
psql "$DATABASE_URL" -c "
  SELECT grantee, privilege_type
  FROM information_schema.role_table_grants
  WHERE table_name = 'system_inbox' AND grantee = 'app_user';
"
# Expected: NO rows with privilege_type IN ('INSERT', 'DELETE').
# SELECT + UPDATE may still appear (preserved for inbox.markRead).

# 5. Verify the cron functions contain ON CONFLICT.
psql "$DATABASE_URL" -c "
  SELECT pg_get_functiondef('run_daily_trainer_score_nudge'::regproc);
" | grep "ON CONFLICT"
psql "$DATABASE_URL" -c "
  SELECT pg_get_functiondef('run_daily_player_tournament_result_nudge'::regproc);
" | grep "ON CONFLICT"
# Both should output the ON CONFLICT line.
```

## Why this is recorded, not blocking

- Tasks 4 + 5 (integration tests) skip cleanly via their `canConnect()`
  gate when no DB is reachable. They will run with full assertion power
  against staging once the push lands there.
- Plan stays `autonomous: true` per WARNING-4 plan-checker resolution; the
  `--force` flag removes interactive confirmation but the worktree
  environment cannot reach a database, so the push itself is deferred to
  the staging deploy step.

## Reference

- `.planning/phases/04-kerndomein/04-VERIFICATION.md` §gaps[5,6]
- `.planning/phases/04-kerndomein/04-REVIEW.md` §CR-06 §CR-07
- `drizzle/0022_phase4_inbox_insert_policy_and_dedup.sql`
- `drizzle/0023_phase4_inbox_cron_dedup.sql`
