# Rollback — 0010_phase3_calendar_extension_tables

**Risk:** Low. The migration is purely additive — dropping the 6 extension tables removes the type-specific domain columns but leaves the base `calendar_events` row in place. Application code in `src/server/trpc/routers/calendar.ts` (Wave 2) that JOINs onto the extensions will fail with "relation does not exist" errors on every read of the affected event_type. Phase 4 operational tables (session_participants, tournament_results, etc.) are NOT yet built and will not be broken by this rollback.

**Procedure:**

1. Confirm Wave 2+ application has been redeployed WITHOUT the Phase 3 calendar router or with the JOINs neutralised.
2. If migration 0011 (RLS policies) has been applied, run its rollback FIRST — Wave 3 RLS policies on the extension tables will be dropped along with the tables, but the rollback md for 0011 documents the policy-removal order explicitly.
3. Connect via DIRECT_DATABASE_URL and run:

   ```sql
   BEGIN;
   DROP TABLE IF EXISTS public.medical_appointments CASCADE;
   DROP TABLE IF EXISTS public.eval_conversations CASCADE;
   DROP TABLE IF EXISTS public.stages CASCADE;
   DROP TABLE IF EXISTS public.meetings CASCADE;
   DROP TABLE IF EXISTS public.tournaments CASCADE;
   DROP TABLE IF EXISTS public.training_sessions CASCADE;
   COMMIT;
   ```

**Verification:**

1. `SELECT to_regclass('public.training_sessions');` returns NULL.
2. `SELECT to_regclass('public.tournaments');` returns NULL.
3. `SELECT to_regclass('public.meetings');` returns NULL.
4. `SELECT to_regclass('public.stages');` returns NULL.
5. `SELECT to_regclass('public.eval_conversations');` returns NULL.
6. `SELECT to_regclass('public.medical_appointments');` returns NULL.
7. `SELECT to_regclass('public.calendar_events');` returns 'calendar_events' (base untouched).
