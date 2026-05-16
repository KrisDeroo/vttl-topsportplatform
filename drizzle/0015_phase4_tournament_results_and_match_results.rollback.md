# Rollback — 0015_phase4_tournament_results_and_match_results

**Risk:** MEDIUM-HIGH. Drops historical tournament results — irrecoverable competitive history once dropped (GDPR-04 audit_log JSONB snapshot pattern preserves a forensic trail but the live operational tables are gone). Three tables: `match_results`, `tournament_results`, `tournament_round` (lookup).

**Procedure:**

1. Roll back 0018 first (drops the per-action policies and SECURITY DEFINER helpers that reference these tables), then this rollback.
2. Verify no live application is writing — put Coolify deployment in maintenance mode.
3. Connect via `DIRECT_DATABASE_URL` and run:

   ```sql
   BEGIN;

   -- Drop in FK-dependency order: leaves first.
   DROP TABLE IF EXISTS "match_results"      CASCADE;
   DROP TABLE IF EXISTS "tournament_results" CASCADE;
   DROP TABLE IF EXISTS "tournament_round"   CASCADE;

   COMMIT;
   ```

4. Restore application traffic.

**Verification:**

- `SELECT COUNT(*) FROM pg_tables WHERE schemaname='public' AND tablename IN ('match_results','tournament_results','tournament_round');` returns 0.
- `pnpm typecheck` may fail until `src/server/db/schema/tournament.ts` is also removed (or migration replayed). Roll the Drizzle barrel back in the same commit chain.
- `SELECT COUNT(*) FROM pg_proc WHERE proname='tournament_result_visible_to';` returns 0 (only after 0018 rollback succeeded).
