# Rollback — 0009_phase3_calendar_base_lookup_participants_exceptions

**Risk:** Low. The migration is purely additive — dropping the 4 new tables removes Phase 3 base schema entirely but leaves Phase 1 + Phase 2 unmodified. The only externally-visible effect is that `src/server/trpc/routers/calendar.ts` (deployed in Phase 3 Wave 2) will fail with "relation does not exist" errors on every request to the calendar router; the rest of the app (Phase 1 login/admin/consent + Phase 2 players/trainers/files) continues working. RLS coverage from `0002` and `0007` is untouched.

**Procedure:**

1. Confirm the application has been redeployed WITHOUT the Phase 3 router registrations (revert `src/server/trpc/routers/_app.ts` to remove `calendar` sub-router import + property). Otherwise step 4 will leave a window where calendar requests throw 500s instead of returning 404 at the route level.

2. If migration 0010 (extension tables) has been applied, run its rollback FIRST — the extension tables FK-reference calendar_events.id with ON DELETE CASCADE; dropping calendar_events first would cascade-drop them (correct behaviour), but rolling 0010 first keeps the dependency graph explicit.

3. If migration 0011 (RLS policies + SECURITY DEFINER functions) has been applied, run its rollback FIRST — the policies and `calendar_events_visible_to()` / `overlapping_events_for_users()` functions reference these tables and will leave dangling `pg_policy` / `pg_proc` entries if dropped out of order.

4. If migration 0012 (event_type seed) has been applied, run its rollback FIRST — it inserts rows into `event_type` which would block schema DROP without CASCADE.

5. Connect to the target Postgres via `DIRECT_DATABASE_URL` and run:

   ```sql
   BEGIN;
   DROP TABLE IF EXISTS public.calendar_event_exceptions CASCADE;
   DROP TABLE IF EXISTS public.calendar_event_participants CASCADE;
   DROP TABLE IF EXISTS public.calendar_events CASCADE;
   DROP TABLE IF EXISTS public.event_type CASCADE;
   COMMIT;
   ```

   CASCADE is belt-and-braces; with FKs ON DELETE CASCADE already in place the explicit table-by-table order is the auditable record. Do NOT omit `IF EXISTS` — re-runs must be idempotent.

**Verification:**

1. `SELECT to_regclass('public.calendar_events');` returns NULL.
2. `SELECT to_regclass('public.calendar_event_participants');` returns NULL.
3. `SELECT to_regclass('public.calendar_event_exceptions');` returns NULL.
4. `SELECT to_regclass('public.event_type');` returns NULL.
5. `SELECT 1 FROM pg_proc WHERE proname IN ('calendar_events_visible_to','overlapping_events_for_users');` returns 0 rows (only after 0011 rollback ran first).
6. `pnpm test -- migration-format` continues to pass (the test asserts file presence, and the SQL file still exists in `drizzle/`; rollback does not delete the SQL file — it documents the recovery procedure).
