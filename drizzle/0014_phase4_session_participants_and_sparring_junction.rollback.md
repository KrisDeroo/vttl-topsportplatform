# Rollback — 0014_phase4_session_participants_and_sparring_junction

**Risk:** MEDIUM. Drops 2 tables.
- `session_participants` rows = attendance + quality scores per player per occurrence (irrecoverable training history once dropped; the GDPR-04 audit_log JSONB snapshot pattern preserves a forensic trail but the live operational table is gone).
- `session_sparring_partners` rows = sparring partner attachments to sessions (operationally recoverable via re-attach; historical signal lost). No FK from other Phase 4 tables targets these — safe to drop in isolation as long as the dependent RLS function (0018) and its policies are rolled back first.

**Procedure:**

1. Roll back 0018 first (drops Branch 6 on `calendar_events_visible_to` + drops the per-action policies that reference `session_participants`), then 0019 (cron jobs that read `session_participants`), THEN this rollback.
2. Verify no live application is writing — put Coolify deployment in maintenance mode.
3. Connect via `DIRECT_DATABASE_URL` and run:

   ```sql
   BEGIN;

   -- session_sparring_partners is the dependency of 0018 Branch 6 — drop after
   -- 0018 rollback already removed the calendar_events_visible_to extension.
   DROP TABLE IF EXISTS "session_sparring_partners" CASCADE;

   -- session_participants drop — irrecoverable training history (GDPR-04 audit
   -- log entries remain).
   DROP TABLE IF EXISTS "session_participants" CASCADE;

   COMMIT;
   ```

4. Restore application traffic.

**Verification:**

- `SELECT COUNT(*) FROM pg_tables WHERE schemaname='public' AND tablename IN ('session_participants','session_sparring_partners');` returns 0.
- `pnpm typecheck` may fail until `src/server/db/schema/training.ts` is also removed (or migration replayed). Roll the Drizzle barrel back in the same commit chain.
- `SELECT prosrc FROM pg_proc WHERE proname='calendar_events_visible_to';` no longer contains `session_sparring_partners` (confirmed by the 0018 rollback).
