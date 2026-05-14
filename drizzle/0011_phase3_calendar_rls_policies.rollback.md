# Rollback — 0011_phase3_calendar_rls_policies

**Risk:** Medium. Dropping the RLS policies leaves the 10 Phase 3 tables with `ENABLE+FORCE RLS` but no policies — effectively default-deny on every operation. Application reads/writes from `src/server/trpc/routers/calendar.ts` will return 0 rows or fail. The 2 SECURITY DEFINER functions, when dropped, also break the conflict-detection service-layer code in `src/lib/calendar/conflicts.ts`. Rolling forward (re-applying the migration) is the preferred recovery; this rollback is for break-glass scenarios.

**Procedure:**

1. Confirm application has been redeployed without Phase 3 calendar router OR application is intentionally being taken offline.
2. Connect via DIRECT_DATABASE_URL and run:

   ```sql
   BEGIN;

   -- Section 1 (lookup): event_type policies
   DROP POLICY IF EXISTS "event_type_read" ON "event_type";
   DROP POLICY IF EXISTS "event_type_td_writes" ON "event_type";

   -- Section 7: extension-table policies
   DROP POLICY IF EXISTS "medical_appointments_select" ON "medical_appointments";
   DROP POLICY IF EXISTS "medical_appointments_insert" ON "medical_appointments";
   DROP POLICY IF EXISTS "medical_appointments_update" ON "medical_appointments";
   DROP POLICY IF EXISTS "medical_appointments_delete" ON "medical_appointments";
   DROP POLICY IF EXISTS "eval_conversations_select" ON "eval_conversations";
   DROP POLICY IF EXISTS "eval_conversations_insert" ON "eval_conversations";
   DROP POLICY IF EXISTS "eval_conversations_update" ON "eval_conversations";
   DROP POLICY IF EXISTS "eval_conversations_delete" ON "eval_conversations";
   DROP POLICY IF EXISTS "stages_select" ON "stages";
   DROP POLICY IF EXISTS "stages_insert" ON "stages";
   DROP POLICY IF EXISTS "stages_update" ON "stages";
   DROP POLICY IF EXISTS "stages_delete" ON "stages";
   DROP POLICY IF EXISTS "meetings_select" ON "meetings";
   DROP POLICY IF EXISTS "meetings_insert" ON "meetings";
   DROP POLICY IF EXISTS "meetings_update" ON "meetings";
   DROP POLICY IF EXISTS "meetings_delete" ON "meetings";
   DROP POLICY IF EXISTS "tournaments_select" ON "tournaments";
   DROP POLICY IF EXISTS "tournaments_insert" ON "tournaments";
   DROP POLICY IF EXISTS "tournaments_update" ON "tournaments";
   DROP POLICY IF EXISTS "tournaments_delete" ON "tournaments";
   DROP POLICY IF EXISTS "training_sessions_select" ON "training_sessions";
   DROP POLICY IF EXISTS "training_sessions_insert" ON "training_sessions";
   DROP POLICY IF EXISTS "training_sessions_update" ON "training_sessions";
   DROP POLICY IF EXISTS "training_sessions_delete" ON "training_sessions";

   -- Section 6: exceptions
   DROP POLICY IF EXISTS "cee_select" ON "calendar_event_exceptions";
   DROP POLICY IF EXISTS "cee_insert" ON "calendar_event_exceptions";
   DROP POLICY IF EXISTS "cee_update" ON "calendar_event_exceptions";
   DROP POLICY IF EXISTS "cee_delete" ON "calendar_event_exceptions";

   -- Section 5: participants
   DROP POLICY IF EXISTS "cep_select" ON "calendar_event_participants";
   DROP POLICY IF EXISTS "cep_insert" ON "calendar_event_participants";
   DROP POLICY IF EXISTS "cep_update_self" ON "calendar_event_participants";
   DROP POLICY IF EXISTS "cep_delete" ON "calendar_event_participants";

   -- Section 4: base
   DROP POLICY IF EXISTS "calendar_events_select" ON "calendar_events";
   DROP POLICY IF EXISTS "calendar_events_insert" ON "calendar_events";
   DROP POLICY IF EXISTS "calendar_events_update" ON "calendar_events";
   DROP POLICY IF EXISTS "calendar_events_delete" ON "calendar_events";

   -- Section 3: SECURITY DEFINER fn for cross-scope conflict
   DROP FUNCTION IF EXISTS overlapping_events_for_users(UUID[], TIMESTAMPTZ, TIMESTAMPTZ);

   -- Section 2: SECURITY DEFINER fn for visibility
   DROP FUNCTION IF EXISTS calendar_events_visible_to(UUID, TEXT);

   -- Section 1: turn RLS OFF on all 10 tables (idempotent: NO ROW LEVEL SECURITY
   -- is the default; toggling it off after dropping policies is safe).
   ALTER TABLE "medical_appointments" DISABLE ROW LEVEL SECURITY;
   ALTER TABLE "medical_appointments" NO FORCE ROW LEVEL SECURITY;
   ALTER TABLE "eval_conversations" DISABLE ROW LEVEL SECURITY;
   ALTER TABLE "eval_conversations" NO FORCE ROW LEVEL SECURITY;
   ALTER TABLE "stages" DISABLE ROW LEVEL SECURITY;
   ALTER TABLE "stages" NO FORCE ROW LEVEL SECURITY;
   ALTER TABLE "meetings" DISABLE ROW LEVEL SECURITY;
   ALTER TABLE "meetings" NO FORCE ROW LEVEL SECURITY;
   ALTER TABLE "tournaments" DISABLE ROW LEVEL SECURITY;
   ALTER TABLE "tournaments" NO FORCE ROW LEVEL SECURITY;
   ALTER TABLE "training_sessions" DISABLE ROW LEVEL SECURITY;
   ALTER TABLE "training_sessions" NO FORCE ROW LEVEL SECURITY;
   ALTER TABLE "calendar_event_exceptions" DISABLE ROW LEVEL SECURITY;
   ALTER TABLE "calendar_event_exceptions" NO FORCE ROW LEVEL SECURITY;
   ALTER TABLE "calendar_event_participants" DISABLE ROW LEVEL SECURITY;
   ALTER TABLE "calendar_event_participants" NO FORCE ROW LEVEL SECURITY;
   ALTER TABLE "calendar_events" DISABLE ROW LEVEL SECURITY;
   ALTER TABLE "calendar_events" NO FORCE ROW LEVEL SECURITY;
   ALTER TABLE "event_type" DISABLE ROW LEVEL SECURITY;
   ALTER TABLE "event_type" NO FORCE ROW LEVEL SECURITY;

   COMMIT;
   ```

**Verification:**

1. `SELECT count(*) FROM pg_policies WHERE tablename IN ('event_type','calendar_events','calendar_event_participants','calendar_event_exceptions','training_sessions','tournaments','meetings','stages','eval_conversations','medical_appointments');` returns 0.
2. `SELECT 1 FROM pg_proc WHERE proname IN ('calendar_events_visible_to','overlapping_events_for_users');` returns 0 rows.
3. `SELECT relrowsecurity FROM pg_class WHERE relname = 'calendar_events';` returns `false`.
