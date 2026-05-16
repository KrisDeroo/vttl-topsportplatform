# Rollback — 0016_phase4_rankings_and_belgium_classification

**Risk:** MEDIUM. Drops time-series ranking entries (recoverable via federation re-import for `source = 'federation_official'` rows; manual entries from players are lost). Also drops the `belgium_classification` lookup and reverts the `ranking_type.value_shape` column. The ALTER TABLE on `ranking_type` is the trickiest part — order is critical.

**Procedure:**

1. Roll back 0018 first (drops `ranking_entry_visible_to` and the per-action policies on `ranking_entries`), then this rollback.
2. Roll back 0017 first if seed counts were specific (the value_shape='classification' on ranking_belgium would conflict with this rollback; the seed has its own rollback procedure).
3. Verify no live application is writing — put Coolify deployment in maintenance mode.
4. Connect via `DIRECT_DATABASE_URL` and run:

   ```sql
   BEGIN;

   -- Drop the time-series table (FK target leaves first by FK direction).
   DROP TABLE IF EXISTS "ranking_entries" CASCADE;

   -- Drop the Belgium classification lookup (no remaining FK after ranking_entries
   -- is gone).
   DROP TABLE IF EXISTS "belgium_classification" CASCADE;

   -- Revert ranking_type ALTER: drop the value_shape CHECK + column in order.
   ALTER TABLE "ranking_type" DROP CONSTRAINT IF EXISTS "ranking_type_value_shape_enum";
   ALTER TABLE "ranking_type" DROP COLUMN IF EXISTS "value_shape";

   COMMIT;
   ```

5. Restore application traffic.

**Verification:**

- `SELECT COUNT(*) FROM pg_tables WHERE schemaname='public' AND tablename IN ('ranking_entries','belgium_classification');` returns 0.
- `SELECT column_name FROM information_schema.columns WHERE table_name='ranking_type' AND column_name='value_shape';` returns 0 rows.
- `SELECT conname FROM pg_constraint WHERE conname='ranking_type_value_shape_enum';` returns 0 rows.
- `pnpm typecheck` may fail until `src/server/db/schema/ranking.ts` is also removed (or migration replayed) AND the `valueShape` column reference in `lookups.ts` is reverted. Roll the Drizzle barrels back in the same commit chain.
