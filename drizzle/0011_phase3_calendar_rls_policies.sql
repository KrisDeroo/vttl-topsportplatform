-- Migration 0011_phase3_calendar_rls_policies.sql — Phase 3 Wave 1.
-- RLS for the 4 base calendar tables + 6 extension tables + 2 SECURITY DEFINER
-- helpers (calendar_events_visible_to + overlapping_events_for_users)
-- per D-50 + D-57.
--
-- Depends on:
--   * 0002_rls_functions_and_policies.sql — current_user_id() / current_user_role()
--     STABLE wrappers and players_visible_to() (used as a structural reference
--     for calendar_events_visible_to but NOT called directly).
--   * 0009_*.sql — the 4 base calendar tables.
--   * 0010_*.sql — the 6 extension tables.
--
-- Hand-authored — same governance rule as Phase 1+2 RLS migrations
-- (0002, 0007). RLS policies + SECURITY DEFINER functions are NOT
-- drizzle-kit-trackable; they live in raw SQL only.
--
-- D-57 SECURITY DEFINER cross-scope rationale:
--   `overlapping_events_for_users` DELIBERATELY bypasses RLS so an academy
--   manager planning a training can detect that player X is already booked
--   for a medical appointment even though the manager normally cannot see
--   medical events. The service layer (src/lib/calendar/conflicts.ts in
--   Wave 3) applies role-gated redaction: full title + location only when
--   the caller IS already a participant or IS TD; redacted to type-label-
--   only otherwise. This is an intentional existence-leak documented as
--   accepted threat T-03-04-CONFLICT-EXISTENCE-LEAK in this plan's
--   threat_model and 03-RESEARCH §Pitfall 6.
--
-- D-50 sparring-partner NO-OP: the SQL function's UNION below has NO
-- branch for sparring_partner. Phase 4 will add a UNION branch reading
-- the new session_sparring_partners junction. Until then sparring_partner
-- callers receive an empty result set, satisfying CAL-04 + D-50.
--
-- Sections:
--   1. ENABLE + FORCE RLS on all 10 new tables.
--   2. SECURITY DEFINER calendar_events_visible_to(uid, role).
--   3. SECURITY DEFINER overlapping_events_for_users(uids[], from, to).
--   4. RLS policies on calendar_events.
--   5. RLS policies on calendar_event_participants.
--   6. RLS policies on calendar_event_exceptions.
--   7. RLS policies on each of the 6 extension tables.

-- ============================================================================
-- Section 1: ENABLE + FORCE RLS on all 10 new tables (Phase 1+2 discipline).
-- ============================================================================
-- event_type is a lookup but still gets RLS per Phase 1's pattern (status,
-- academy, tournament_type, etc. all have ENABLE+FORCE in 0002). A simple
-- read-for-authenticated policy preserves the "every new table has RLS"
-- must_have claim while not creating any practical access friction.

ALTER TABLE "event_type" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "event_type" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "calendar_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "calendar_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "calendar_event_participants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "calendar_event_participants" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "calendar_event_exceptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "calendar_event_exceptions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "training_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "training_sessions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tournaments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tournaments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "meetings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "meetings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "stages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "stages" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "eval_conversations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "eval_conversations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "medical_appointments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "medical_appointments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- event_type lookup policies — mirror Phase 1 academy pattern:
--   * read: USING (true) — every caller can read lookup codes.
--   * writes restricted to TD via FOR ALL TO app_user policy.
-- Migration owner (postgres direct connection) bypasses RLS for seed
-- inserts; same pattern as Phase 1 academy + status + tournament_type.
CREATE POLICY "event_type_read" ON "event_type" FOR SELECT USING (true);--> statement-breakpoint
CREATE POLICY "event_type_td_writes" ON "event_type" FOR ALL TO app_user
  USING (current_user_role() = 'technical_director')
  WITH CHECK (current_user_role() = 'technical_director');--> statement-breakpoint

-- ============================================================================
-- Section 2: calendar_events_visible_to(caller_id, caller_role) — SECURITY DEFINER.
-- ============================================================================
-- Returns SETOF uuid (event ids the caller may see). Mirrors players_visible_to
-- structure: one UNION branch per role; role discriminator short-circuits
-- non-applicable branches.
--
-- Branches (per D-50):
--   1. technical_director / medical_staff sees ALL events.
--   2. Creator sees own events (any role).
--   3. Participant sees events they're in (any role; covers player/trainer
--      participants and is the main scope path).
--   4. academy_manager / trainer sees events of academy players (via
--      academy_memberships JOIN).
--   5. parent sees events of linked child(ren) (via parent_child_links JOIN).
--   6. sparring_partner: NO branch in Phase 3 (D-50 no-op). Phase 4 will add.

CREATE OR REPLACE FUNCTION calendar_events_visible_to(caller_id UUID, caller_role TEXT)
RETURNS TABLE(event_id UUID) AS $$
  -- Branch 1: TD / medical_staff see all
  SELECT ce.id FROM calendar_events ce
   WHERE caller_role IN ('technical_director', 'medical_staff')

  UNION

  -- Branch 2: Creator sees own
  SELECT ce.id FROM calendar_events ce
   WHERE ce.created_by = caller_id

  UNION

  -- Branch 3: Participant sees events they're in
  SELECT cep.event_id
    FROM calendar_event_participants cep
   WHERE cep.user_id = caller_id

  UNION

  -- Branch 4: academy_manager / trainer sees events of academy players
  SELECT cep.event_id
    FROM calendar_event_participants cep
    JOIN academy_memberships am_player
      ON am_player.user_id = cep.user_id AND am_player.role = 'player'
    JOIN academy_memberships am_caller
      ON am_caller.academy_code = am_player.academy_code
     AND am_caller.user_id = caller_id
     AND am_caller.role IN ('trainer', 'academy_manager')
   WHERE caller_role IN ('trainer', 'academy_manager')

  UNION

  -- Branch 5: parent sees events of linked child(ren)
  SELECT cep.event_id
    FROM calendar_event_participants cep
    JOIN parent_child_links pcl
      ON pcl.child_user_id = cep.user_id
     AND pcl.parent_user_id = caller_id
   WHERE caller_role = 'parent';

  -- Branch 6 (sparring_partner): Phase 3 NO-OP per D-50.
  -- Phase 4 will add UNION + SELECT cep.event_id FROM calendar_event_participants
  --                 cep JOIN session_sparring_partners ssp
  --                 ON ssp.event_id = cep.event_id AND ssp.sparring_partner_id = caller_id
  --                 WHERE caller_role = 'sparring_partner';
$$ LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = pg_catalog, public;--> statement-breakpoint

REVOKE ALL ON FUNCTION calendar_events_visible_to(UUID, TEXT) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION calendar_events_visible_to(UUID, TEXT) TO app_user;--> statement-breakpoint

-- ============================================================================
-- Section 3: overlapping_events_for_users(uids[], from, to) — SECURITY DEFINER.
-- ============================================================================
-- DELIBERATELY bypasses RLS for cross-scope conflict detection per D-57.
-- The service layer (src/lib/calendar/conflicts.ts) applies role-gated
-- redaction; this function ONLY returns the columns needed to compose
-- the redacted-or-full warning. Description is NEVER returned (Pitfall 6).
--
-- Returns: event_id + user_id + type_code + title + starts_at + ends_at
--          + location + created_by. (Extension-table columns are NEVER
--          returned — the service layer joins separately when full
--          visibility is granted.)
--
-- The overlap predicate uses tstzrange(starts_at, ends_at, '[)') && tstzrange(from, to, '[)')
-- — half-open interval at the right edge so an event ending exactly at
-- 'from' is NOT a conflict (matches FullCalendar's interval semantics).
-- Recurring rows are NOT auto-expanded here; the service layer calls
-- expandRrule() separately within a ±15 day window per D-56.

CREATE OR REPLACE FUNCTION overlapping_events_for_users(
  p_user_ids UUID[],
  p_from TIMESTAMPTZ,
  p_to TIMESTAMPTZ
)
RETURNS TABLE(
  event_id UUID,
  user_id UUID,
  type_code TEXT,
  title TEXT,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  location TEXT,
  created_by UUID
) AS $$
  SELECT ce.id AS event_id,
         cep.user_id,
         ce.type_code,
         ce.title,
         ce.starts_at,
         ce.ends_at,
         ce.location,
         ce.created_by
    FROM calendar_events ce
    JOIN calendar_event_participants cep ON cep.event_id = ce.id
   WHERE cep.user_id = ANY(p_user_ids)
     AND tstzrange(ce.starts_at, ce.ends_at, '[)') && tstzrange(p_from, p_to, '[)')
   ORDER BY ce.starts_at;
$$ LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = pg_catalog, public;--> statement-breakpoint

REVOKE ALL ON FUNCTION overlapping_events_for_users(UUID[], TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION overlapping_events_for_users(UUID[], TIMESTAMPTZ, TIMESTAMPTZ) TO app_user;--> statement-breakpoint

-- ============================================================================
-- Section 4: calendar_events policies (per-action, never FOR ALL).
-- ============================================================================
-- WITH CHECK is non-negotiable on UPDATE (T-02-05-RLS-MISSING-WITHCHECK).

CREATE POLICY "calendar_events_select" ON "calendar_events" FOR SELECT
  USING (
    id IN (SELECT event_id FROM calendar_events_visible_to(current_user_id(), current_user_role()))
  );--> statement-breakpoint

-- INSERT: any authenticated user can create an event row addressed to themselves
-- as creator. Per-type RBAC matrix from D-48 (which roles can create which type)
-- is enforced at the tRPC layer via middleware/calendarCreate.ts — the RLS
-- policy is defense in depth (FOR INSERT WITH CHECK created_by = caller).
CREATE POLICY "calendar_events_insert" ON "calendar_events" FOR INSERT
  WITH CHECK (created_by = current_user_id());--> statement-breakpoint

CREATE POLICY "calendar_events_update" ON "calendar_events" FOR UPDATE
  USING (
    current_user_role() = 'technical_director'
    OR created_by = current_user_id()
  )
  WITH CHECK (
    current_user_role() = 'technical_director'
    OR created_by = current_user_id()
  );--> statement-breakpoint

CREATE POLICY "calendar_events_delete" ON "calendar_events" FOR DELETE
  USING (
    current_user_role() = 'technical_director'
    OR created_by = current_user_id()
  );--> statement-breakpoint

-- ============================================================================
-- Section 5: calendar_event_participants policies.
-- ============================================================================
-- SELECT: participants visible to anyone who can see the parent event.
-- INSERT: creator/TD can add participants when creating/updating the event.
-- UPDATE: only the calling participant can change own rsvp_status (RSVP forgery prevention).
-- DELETE: only the event creator/TD can remove a participant.

CREATE POLICY "cep_select" ON "calendar_event_participants" FOR SELECT
  USING (
    event_id IN (SELECT event_id FROM calendar_events_visible_to(current_user_id(), current_user_role()))
  );--> statement-breakpoint

CREATE POLICY "cep_insert" ON "calendar_event_participants" FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM calendar_events ce
       WHERE ce.id = event_id
         AND (current_user_role() = 'technical_director' OR ce.created_by = current_user_id())
    )
  );--> statement-breakpoint

CREATE POLICY "cep_update_self" ON "calendar_event_participants" FOR UPDATE
  USING (user_id = current_user_id())
  WITH CHECK (user_id = current_user_id());--> statement-breakpoint

CREATE POLICY "cep_delete" ON "calendar_event_participants" FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM calendar_events ce
       WHERE ce.id = event_id
         AND (current_user_role() = 'technical_director' OR ce.created_by = current_user_id())
    )
  );--> statement-breakpoint

-- ============================================================================
-- Section 6: calendar_event_exceptions policies.
-- ============================================================================

CREATE POLICY "cee_select" ON "calendar_event_exceptions" FOR SELECT
  USING (
    event_id IN (SELECT event_id FROM calendar_events_visible_to(current_user_id(), current_user_role()))
  );--> statement-breakpoint

CREATE POLICY "cee_insert" ON "calendar_event_exceptions" FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM calendar_events ce
       WHERE ce.id = event_id
         AND (current_user_role() = 'technical_director' OR ce.created_by = current_user_id())
    )
  );--> statement-breakpoint

CREATE POLICY "cee_update" ON "calendar_event_exceptions" FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM calendar_events ce
       WHERE ce.id = event_id
         AND (current_user_role() = 'technical_director' OR ce.created_by = current_user_id())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM calendar_events ce
       WHERE ce.id = event_id
         AND (current_user_role() = 'technical_director' OR ce.created_by = current_user_id())
    )
  );--> statement-breakpoint

CREATE POLICY "cee_delete" ON "calendar_event_exceptions" FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM calendar_events ce
       WHERE ce.id = event_id
         AND (current_user_role() = 'technical_director' OR ce.created_by = current_user_id())
    )
  );--> statement-breakpoint

-- ============================================================================
-- Section 7: Extension-table policies — SELECT only (write via base + tRPC).
-- ============================================================================
-- Each extension row inherits its visibility from the base calendar_events row.
-- We never INSERT/UPDATE/DELETE an extension row outside a base-event tx
-- (calendar.event.create/update/delete handlers in Wave 3 do both in the
-- same transaction). For defense in depth we still add WITH CHECK policies
-- on INSERT/UPDATE/DELETE matching the base-event ownership rule.
--
-- Pattern repeats for all 6 extensions. We use a SELECT/INSERT/UPDATE/DELETE
-- block per table — verbose but explicit (matches Phase 2's per-table style).

-- training_sessions
CREATE POLICY "training_sessions_select" ON "training_sessions" FOR SELECT
  USING (event_id IN (SELECT event_id FROM calendar_events_visible_to(current_user_id(), current_user_role())));--> statement-breakpoint
CREATE POLICY "training_sessions_insert" ON "training_sessions" FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM calendar_events ce WHERE ce.id = event_id AND (current_user_role() = 'technical_director' OR ce.created_by = current_user_id())));--> statement-breakpoint
CREATE POLICY "training_sessions_update" ON "training_sessions" FOR UPDATE
  USING (EXISTS (SELECT 1 FROM calendar_events ce WHERE ce.id = event_id AND (current_user_role() = 'technical_director' OR ce.created_by = current_user_id())))
  WITH CHECK (EXISTS (SELECT 1 FROM calendar_events ce WHERE ce.id = event_id AND (current_user_role() = 'technical_director' OR ce.created_by = current_user_id())));--> statement-breakpoint
CREATE POLICY "training_sessions_delete" ON "training_sessions" FOR DELETE
  USING (EXISTS (SELECT 1 FROM calendar_events ce WHERE ce.id = event_id AND (current_user_role() = 'technical_director' OR ce.created_by = current_user_id())));--> statement-breakpoint

-- tournaments
CREATE POLICY "tournaments_select" ON "tournaments" FOR SELECT
  USING (event_id IN (SELECT event_id FROM calendar_events_visible_to(current_user_id(), current_user_role())));--> statement-breakpoint
CREATE POLICY "tournaments_insert" ON "tournaments" FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM calendar_events ce WHERE ce.id = event_id AND (current_user_role() = 'technical_director' OR ce.created_by = current_user_id())));--> statement-breakpoint
CREATE POLICY "tournaments_update" ON "tournaments" FOR UPDATE
  USING (EXISTS (SELECT 1 FROM calendar_events ce WHERE ce.id = event_id AND (current_user_role() = 'technical_director' OR ce.created_by = current_user_id())))
  WITH CHECK (EXISTS (SELECT 1 FROM calendar_events ce WHERE ce.id = event_id AND (current_user_role() = 'technical_director' OR ce.created_by = current_user_id())));--> statement-breakpoint
CREATE POLICY "tournaments_delete" ON "tournaments" FOR DELETE
  USING (EXISTS (SELECT 1 FROM calendar_events ce WHERE ce.id = event_id AND (current_user_role() = 'technical_director' OR ce.created_by = current_user_id())));--> statement-breakpoint

-- meetings
CREATE POLICY "meetings_select" ON "meetings" FOR SELECT
  USING (event_id IN (SELECT event_id FROM calendar_events_visible_to(current_user_id(), current_user_role())));--> statement-breakpoint
CREATE POLICY "meetings_insert" ON "meetings" FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM calendar_events ce WHERE ce.id = event_id AND (current_user_role() = 'technical_director' OR ce.created_by = current_user_id())));--> statement-breakpoint
CREATE POLICY "meetings_update" ON "meetings" FOR UPDATE
  USING (EXISTS (SELECT 1 FROM calendar_events ce WHERE ce.id = event_id AND (current_user_role() = 'technical_director' OR ce.created_by = current_user_id())))
  WITH CHECK (EXISTS (SELECT 1 FROM calendar_events ce WHERE ce.id = event_id AND (current_user_role() = 'technical_director' OR ce.created_by = current_user_id())));--> statement-breakpoint
CREATE POLICY "meetings_delete" ON "meetings" FOR DELETE
  USING (EXISTS (SELECT 1 FROM calendar_events ce WHERE ce.id = event_id AND (current_user_role() = 'technical_director' OR ce.created_by = current_user_id())));--> statement-breakpoint

-- stages
CREATE POLICY "stages_select" ON "stages" FOR SELECT
  USING (event_id IN (SELECT event_id FROM calendar_events_visible_to(current_user_id(), current_user_role())));--> statement-breakpoint
CREATE POLICY "stages_insert" ON "stages" FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM calendar_events ce WHERE ce.id = event_id AND (current_user_role() = 'technical_director' OR ce.created_by = current_user_id())));--> statement-breakpoint
CREATE POLICY "stages_update" ON "stages" FOR UPDATE
  USING (EXISTS (SELECT 1 FROM calendar_events ce WHERE ce.id = event_id AND (current_user_role() = 'technical_director' OR ce.created_by = current_user_id())))
  WITH CHECK (EXISTS (SELECT 1 FROM calendar_events ce WHERE ce.id = event_id AND (current_user_role() = 'technical_director' OR ce.created_by = current_user_id())));--> statement-breakpoint
CREATE POLICY "stages_delete" ON "stages" FOR DELETE
  USING (EXISTS (SELECT 1 FROM calendar_events ce WHERE ce.id = event_id AND (current_user_role() = 'technical_director' OR ce.created_by = current_user_id())));--> statement-breakpoint

-- eval_conversations
CREATE POLICY "eval_conversations_select" ON "eval_conversations" FOR SELECT
  USING (event_id IN (SELECT event_id FROM calendar_events_visible_to(current_user_id(), current_user_role())));--> statement-breakpoint
CREATE POLICY "eval_conversations_insert" ON "eval_conversations" FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM calendar_events ce WHERE ce.id = event_id AND (current_user_role() = 'technical_director' OR ce.created_by = current_user_id())));--> statement-breakpoint
CREATE POLICY "eval_conversations_update" ON "eval_conversations" FOR UPDATE
  USING (EXISTS (SELECT 1 FROM calendar_events ce WHERE ce.id = event_id AND (current_user_role() = 'technical_director' OR ce.created_by = current_user_id())))
  WITH CHECK (EXISTS (SELECT 1 FROM calendar_events ce WHERE ce.id = event_id AND (current_user_role() = 'technical_director' OR ce.created_by = current_user_id())));--> statement-breakpoint
CREATE POLICY "eval_conversations_delete" ON "eval_conversations" FOR DELETE
  USING (EXISTS (SELECT 1 FROM calendar_events ce WHERE ce.id = event_id AND (current_user_role() = 'technical_director' OR ce.created_by = current_user_id())));--> statement-breakpoint

-- medical_appointments
CREATE POLICY "medical_appointments_select" ON "medical_appointments" FOR SELECT
  USING (event_id IN (SELECT event_id FROM calendar_events_visible_to(current_user_id(), current_user_role())));--> statement-breakpoint
CREATE POLICY "medical_appointments_insert" ON "medical_appointments" FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM calendar_events ce WHERE ce.id = event_id AND (current_user_role() = 'technical_director' OR ce.created_by = current_user_id())));--> statement-breakpoint
CREATE POLICY "medical_appointments_update" ON "medical_appointments" FOR UPDATE
  USING (EXISTS (SELECT 1 FROM calendar_events ce WHERE ce.id = event_id AND (current_user_role() = 'technical_director' OR ce.created_by = current_user_id())))
  WITH CHECK (EXISTS (SELECT 1 FROM calendar_events ce WHERE ce.id = event_id AND (current_user_role() = 'technical_director' OR ce.created_by = current_user_id())));--> statement-breakpoint
CREATE POLICY "medical_appointments_delete" ON "medical_appointments" FOR DELETE
  USING (EXISTS (SELECT 1 FROM calendar_events ce WHERE ce.id = event_id AND (current_user_role() = 'technical_director' OR ce.created_by = current_user_id())));
