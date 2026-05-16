# Rollback — 0019_phase4_pg_cron_nudges

**Risk:** LOW. Drops 4 scheduled cron jobs and 2 SECURITY DEFINER functions. No data loss — the `system_inbox` rows already deposited remain (their authors are the cron jobs themselves; future runs simply stop generating new rows). `pg_cron` extension is NOT dropped because other Phase 1+ migrations or future plans may also rely on it; the extension is shared infrastructure.

**Procedure:**

1. Connect via `DIRECT_DATABASE_URL` and run:

   ```sql
   BEGIN;

   -- Unschedule the 4 cron jobs by name (idempotent — IF EXISTS guard).
   SELECT cron.unschedule('daily_trainer_score_nudge_17utc')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'daily_trainer_score_nudge_17utc');
   SELECT cron.unschedule('daily_trainer_score_nudge_16utc')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'daily_trainer_score_nudge_16utc');
   SELECT cron.unschedule('daily_player_tournament_result_nudge_17utc')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'daily_player_tournament_result_nudge_17utc');
   SELECT cron.unschedule('daily_player_tournament_result_nudge_16utc')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'daily_player_tournament_result_nudge_16utc');

   -- Drop the 2 SECURITY DEFINER nudge functions.
   DROP FUNCTION IF EXISTS run_daily_trainer_score_nudge();
   DROP FUNCTION IF EXISTS run_daily_player_tournament_result_nudge();

   COMMIT;
   ```

2. Do NOT `DROP EXTENSION pg_cron` — it's shared infrastructure.

**Verification:**

- `SELECT COUNT(*) FROM cron.job WHERE jobname LIKE 'daily_%_nudge_%';` returns 0.
- `SELECT COUNT(*) FROM pg_proc WHERE proname IN ('run_daily_trainer_score_nudge','run_daily_player_tournament_result_nudge');` returns 0.
- `SELECT extname FROM pg_extension WHERE extname='pg_cron';` returns 1 row (extension preserved).
