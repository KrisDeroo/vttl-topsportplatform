# Rollback — 0020_phase4_system_inbox

**Risk:** LOW. Drops 1 table (`system_inbox`). Phase 6 will re-create with an extended shape (threads, attachments, compose flow), so the inbox rows in this Phase 4 stub are effectively expendable — Phase 6 migration will not reuse Phase 4's exact schema, and the rows are nudge messages auto-generated nightly (lossy by design).

**Procedure:**

1. Roll back 0019 first (otherwise the cron jobs continue trying to INSERT into a non-existent table and the function calls will error out at next run).
2. Connect via `DIRECT_DATABASE_URL` and run:

   ```sql
   BEGIN;
   DROP TABLE IF EXISTS "system_inbox" CASCADE;
   COMMIT;
   ```

**Verification:**

- `SELECT COUNT(*) FROM pg_tables WHERE schemaname='public' AND tablename='system_inbox';` returns 0.
- `pnpm typecheck` may fail until `src/server/db/schema/inbox.ts` is also removed (or migration replayed). Roll the Drizzle barrel back in the same commit chain.
- Future invocations of `run_daily_trainer_score_nudge()` / `run_daily_player_tournament_result_nudge()` will throw `relation "system_inbox" does not exist` — expected and confirms the table is gone.
