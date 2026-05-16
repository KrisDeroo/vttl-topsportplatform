-- 0018_phase4_rls_helpers_and_sparring_branch.sql
-- Phase 4 RLS layer. Three new SECURITY DEFINER visibility functions +
-- one CREATE OR REPLACE extending Phase 3's calendar_events_visible_to
-- with the deferred sparring_partner UNION branch (filling
-- 0011_phase3_calendar_rls_policies.sql line 140-145 placeholder).
--
-- All functions use SET search_path = pg_catalog, public per Phase 1+3
-- pattern; REVOKE FROM PUBLIC + GRANT EXECUTE TO app_user.
--
-- Sections:
--   1. EXTEND calendar_events_visible_to with Branch 6 (D-63 + SPAR-02).
--   2. session_participants_visible_to (D-61).
--   3. tournament_result_visible_to (D-78 — 5-branch UNION).
--   4. ranking_entry_visible_to (D-89 — 4-branch UNION, no academy-peer).
--   5. ENABLE+FORCE RLS on the 5 new operational tables (system_inbox
--      is enabled in its own migration 0020).
--   6. Per-action RLS policies on the 5 new operational tables.
--
-- Reference: .planning/phases/04-kerndomein/04-CONTEXT.md §A §B §D
--            .planning/phases/04-kerndomein/04-RESEARCH.md §Pattern 5+6
--            drizzle/0011_phase3_calendar_rls_policies.sql

-- ============================================================================
-- Section 1: EXTEND calendar_events_visible_to with Branch 6 (D-63 + SPAR-02).
-- ============================================================================
-- Phase 3 0011 declared a 5-branch UNION with the explicit no-op sparring
-- placeholder at lines 140-145. Phase 4 CREATE OR REPLACE swaps the body
-- in-place — Postgres allows replacing a function as long as the signature
-- matches. ACLs (REVOKE/GRANT) survive CREATE OR REPLACE so we re-apply
-- them defensively.

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
   WHERE caller_role = 'parent'

  UNION

  -- Branch 6: NEW (Phase 4 D-63) — sparring_partner sees own sessions via junction
  SELECT ssp.event_id
    FROM session_sparring_partners ssp
   WHERE ssp.sparring_partner_id = caller_id
     AND caller_role = 'sparring_partner';
$$ LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = pg_catalog, public;--> statement-breakpoint

REVOKE ALL ON FUNCTION calendar_events_visible_to(UUID, TEXT) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION calendar_events_visible_to(UUID, TEXT) TO app_user;--> statement-breakpoint

-- ============================================================================
-- Section 2: session_participants_visible_to (D-61).
-- ============================================================================
-- Branches:
--   1. technical_director sees all
--   2. trainer of session (JOIN training_sessions on event_id)
--   3. academy_manager of the player's academy
--   4. own row (player sees own attendance/score)
--   5. parent of child sees child's row

CREATE OR REPLACE FUNCTION session_participants_visible_to(caller_id UUID, caller_role TEXT)
RETURNS TABLE(event_id UUID, occurrence_date DATE, user_id UUID) AS $$
  -- Branch 1: TD all
  SELECT sp.event_id, sp.occurrence_date, sp.user_id
    FROM session_participants sp
   WHERE caller_role = 'technical_director'

  UNION

  -- Branch 2: Trainer of the session
  SELECT sp.event_id, sp.occurrence_date, sp.user_id
    FROM session_participants sp
    JOIN training_sessions ts ON ts.event_id = sp.event_id
   WHERE ts.trainer_id = caller_id AND caller_role = 'trainer'

  UNION

  -- Branch 3: academy_manager of the player's academy
  SELECT sp.event_id, sp.occurrence_date, sp.user_id
    FROM session_participants sp
    JOIN academy_memberships am_player
      ON am_player.user_id = sp.user_id AND am_player.role = 'player'
    JOIN academy_memberships am_caller
      ON am_caller.academy_code = am_player.academy_code
     AND am_caller.user_id = caller_id
     AND am_caller.role = 'academy_manager'
   WHERE caller_role = 'academy_manager'

  UNION

  -- Branch 4: Own row (player sees own attendance + score)
  SELECT sp.event_id, sp.occurrence_date, sp.user_id
    FROM session_participants sp
   WHERE sp.user_id = caller_id

  UNION

  -- Branch 5: Parent of own child
  SELECT sp.event_id, sp.occurrence_date, sp.user_id
    FROM session_participants sp
    JOIN parent_child_links pcl
      ON pcl.child_user_id = sp.user_id
     AND pcl.parent_user_id = caller_id
   WHERE caller_role = 'parent';
$$ LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = pg_catalog, public;--> statement-breakpoint

REVOKE ALL ON FUNCTION session_participants_visible_to(UUID, TEXT) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION session_participants_visible_to(UUID, TEXT) TO app_user;--> statement-breakpoint

-- ============================================================================
-- Section 3: tournament_result_visible_to (D-78 — 5-branch UNION).
-- ============================================================================
-- Branches:
--   1. technical_director / medical_staff sees all
--   2. Own results
--   3. Trainer / academy_manager in player's academy
--   4. Parent of subject
--   5. D-78: peers (other players sharing an academy with subject)
--      — academy-wide leaderboard energy; documented as accepted threat
--      T-04-08-D78-ACADEMY-PEER-LEAK.

CREATE OR REPLACE FUNCTION tournament_result_visible_to(caller_id UUID, caller_role TEXT)
RETURNS TABLE(tournament_event_id UUID, player_user_id UUID) AS $$
  -- Branch 1: TD all
  SELECT tr.tournament_event_id, tr.player_user_id
    FROM tournament_results tr
   WHERE caller_role IN ('technical_director', 'medical_staff')

  UNION

  -- Branch 2: Own results
  SELECT tr.tournament_event_id, tr.player_user_id
    FROM tournament_results tr
   WHERE tr.player_user_id = caller_id

  UNION

  -- Branch 3: Trainer/academy_manager in player's academy
  SELECT tr.tournament_event_id, tr.player_user_id
    FROM tournament_results tr
    JOIN academy_memberships am_player
      ON am_player.user_id = tr.player_user_id
     AND am_player.role = 'player'
    JOIN academy_memberships am_caller
      ON am_caller.academy_code = am_player.academy_code
     AND am_caller.user_id = caller_id
     AND am_caller.role IN ('trainer', 'academy_manager')
   WHERE caller_role IN ('trainer', 'academy_manager')

  UNION

  -- Branch 4: Parent of subject
  SELECT tr.tournament_event_id, tr.player_user_id
    FROM tournament_results tr
    JOIN parent_child_links pcl
      ON pcl.child_user_id = tr.player_user_id
     AND pcl.parent_user_id = caller_id
   WHERE caller_role = 'parent'

  UNION

  -- Branch 5: D-78 — players sharing an academy with subject (leaderboard energy)
  SELECT tr.tournament_event_id, tr.player_user_id
    FROM tournament_results tr
    JOIN academy_memberships am_subject
      ON am_subject.user_id = tr.player_user_id
     AND am_subject.role = 'player'
    JOIN academy_memberships am_caller
      ON am_caller.academy_code = am_subject.academy_code
     AND am_caller.user_id = caller_id
     AND am_caller.role = 'player'
   WHERE caller_role = 'player'
     AND tr.player_user_id <> caller_id;  -- own results already in Branch 2
$$ LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = pg_catalog, public;--> statement-breakpoint

REVOKE ALL ON FUNCTION tournament_result_visible_to(UUID, TEXT) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION tournament_result_visible_to(UUID, TEXT) TO app_user;--> statement-breakpoint

-- ============================================================================
-- Section 4: ranking_entry_visible_to (D-61 + D-89 — no academy-peer branch).
-- ============================================================================
-- Branches (4 total — NO leaderboard energy for rankings; rankings are personal):
--   1. technical_director / medical_staff sees all
--   2. Own rankings
--   3. Trainer / academy_manager in player's academy
--   4. Parent of subject

CREATE OR REPLACE FUNCTION ranking_entry_visible_to(caller_id UUID, caller_role TEXT)
RETURNS TABLE(player_user_id UUID) AS $$
  -- Branch 1: TD all
  SELECT re.player_user_id FROM ranking_entries re
   WHERE caller_role IN ('technical_director', 'medical_staff')

  UNION

  -- Branch 2: Own rankings
  SELECT re.player_user_id FROM ranking_entries re
   WHERE re.player_user_id = caller_id

  UNION

  -- Branch 3: Trainer/academy_manager in player's academy
  SELECT re.player_user_id
    FROM ranking_entries re
    JOIN academy_memberships am_player
      ON am_player.user_id = re.player_user_id
     AND am_player.role = 'player'
    JOIN academy_memberships am_caller
      ON am_caller.academy_code = am_player.academy_code
     AND am_caller.user_id = caller_id
     AND am_caller.role IN ('trainer', 'academy_manager')
   WHERE caller_role IN ('trainer', 'academy_manager')

  UNION

  -- Branch 4: Parent of subject
  SELECT re.player_user_id
    FROM ranking_entries re
    JOIN parent_child_links pcl
      ON pcl.child_user_id = re.player_user_id
     AND pcl.parent_user_id = caller_id
   WHERE caller_role = 'parent';
$$ LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = pg_catalog, public;--> statement-breakpoint

REVOKE ALL ON FUNCTION ranking_entry_visible_to(UUID, TEXT) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION ranking_entry_visible_to(UUID, TEXT) TO app_user;--> statement-breakpoint

-- ============================================================================
-- Section 5: ENABLE + FORCE RLS on the 5 new Phase 4 operational tables.
-- ============================================================================
-- system_inbox is RLS-enabled in 0020 alongside its table creation.
-- tournament_round + belgium_classification (lookups) get a permissive read
-- policy mirroring the Phase 1+3 lookup pattern (read for all authenticated,
-- TD-only writes).

ALTER TABLE "session_participants"        ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "session_participants"        FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "session_sparring_partners"   ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "session_sparring_partners"   FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tournament_results"          ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tournament_results"          FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "match_results"               ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "match_results"               FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ranking_entries"             ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ranking_entries"             FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- Lookup tables — mirror Phase 1 + Phase 3 lookup pattern (read for all,
-- writes restricted to TD via FOR ALL TO app_user).
ALTER TABLE "tournament_round"         ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tournament_round"         FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "belgium_classification"   ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "belgium_classification"   FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY "tournament_round_read"        ON "tournament_round" FOR SELECT USING (true);--> statement-breakpoint
CREATE POLICY "tournament_round_td_writes"   ON "tournament_round" FOR ALL TO app_user
  USING (current_user_role() = 'technical_director')
  WITH CHECK (current_user_role() = 'technical_director');--> statement-breakpoint
CREATE POLICY "belgium_classification_read"      ON "belgium_classification" FOR SELECT USING (true);--> statement-breakpoint
CREATE POLICY "belgium_classification_td_writes" ON "belgium_classification" FOR ALL TO app_user
  USING (current_user_role() = 'technical_director')
  WITH CHECK (current_user_role() = 'technical_director');--> statement-breakpoint

-- ============================================================================
-- Section 6: Per-action RLS policies on the 5 operational tables.
-- ============================================================================

-- ─── session_participants policies (D-61) ─────────────────────────
-- SELECT: via session_participants_visible_to helper.
CREATE POLICY "sp_select_via_helper" ON "session_participants" FOR SELECT USING (
  (event_id, occurrence_date, user_id) IN (
    SELECT event_id, occurrence_date, user_id
      FROM session_participants_visible_to(current_user_id(), current_user_role())
  )
);--> statement-breakpoint

-- INSERT: TD always, OR trainer of the session (JOIN training_sessions).
CREATE POLICY "sp_insert_trainer_or_td" ON "session_participants" FOR INSERT WITH CHECK (
  current_user_role() = 'technical_director'
  OR EXISTS (
    SELECT 1 FROM training_sessions ts
     WHERE ts.event_id = session_participants.event_id
       AND ts.trainer_id = current_user_id()
       AND current_user_role() = 'trainer'
  )
);--> statement-breakpoint

-- UPDATE: same predicate, USING + WITH CHECK.
CREATE POLICY "sp_update_trainer_or_td" ON "session_participants" FOR UPDATE USING (
  current_user_role() = 'technical_director'
  OR EXISTS (
    SELECT 1 FROM training_sessions ts
     WHERE ts.event_id = session_participants.event_id
       AND ts.trainer_id = current_user_id()
       AND current_user_role() = 'trainer'
  )
) WITH CHECK (
  current_user_role() = 'technical_director'
  OR EXISTS (
    SELECT 1 FROM training_sessions ts
     WHERE ts.event_id = session_participants.event_id
       AND ts.trainer_id = current_user_id()
       AND current_user_role() = 'trainer'
  )
);--> statement-breakpoint

-- DELETE: TD only.
CREATE POLICY "sp_delete_td_only" ON "session_participants" FOR DELETE USING (
  current_user_role() = 'technical_director'
);--> statement-breakpoint

-- ─── session_sparring_partners policies ───────────────────────────
-- SELECT: any caller who can see the parent event.
CREATE POLICY "ssp_select_via_calendar_visibility" ON "session_sparring_partners" FOR SELECT USING (
  event_id IN (
    SELECT event_id FROM calendar_events_visible_to(current_user_id(), current_user_role())
  )
);--> statement-breakpoint

-- INSERT/UPDATE/DELETE: TD-only (D-79 spirit — staff-managed participant rosters).
CREATE POLICY "ssp_insert_td_only" ON "session_sparring_partners" FOR INSERT WITH CHECK (
  current_user_role() = 'technical_director'
);--> statement-breakpoint
CREATE POLICY "ssp_update_td_only" ON "session_sparring_partners" FOR UPDATE
  USING (current_user_role() = 'technical_director')
  WITH CHECK (current_user_role() = 'technical_director');--> statement-breakpoint
CREATE POLICY "ssp_delete_td_only" ON "session_sparring_partners" FOR DELETE USING (
  current_user_role() = 'technical_director'
);--> statement-breakpoint

-- ─── tournament_results policies (D-73 + D-75 + D-78) ─────────────
-- SELECT: via tournament_result_visible_to 5-branch UNION.
CREATE POLICY "tr_select_via_helper" ON "tournament_results" FOR SELECT USING (
  (tournament_event_id, player_user_id) IN (
    SELECT tournament_event_id, player_user_id
      FROM tournament_result_visible_to(current_user_id(), current_user_role())
  )
);--> statement-breakpoint

-- INSERT: TD always; OR player own; OR trainer in player's academy (D-73).
-- The 14-day wall (D-71) is API-layer (depends on calendar_events.ends_at).
CREATE POLICY "tr_insert_eligible" ON "tournament_results" FOR INSERT WITH CHECK (
  current_user_role() = 'technical_director'
  OR (current_user_role() = 'player' AND player_user_id = current_user_id())
  OR (
    current_user_role() = 'trainer'
    AND EXISTS (
      SELECT 1
        FROM academy_memberships am_player
        JOIN academy_memberships am_caller
          ON am_caller.academy_code = am_player.academy_code
         AND am_caller.user_id = current_user_id()
         AND am_caller.role = 'trainer'
       WHERE am_player.user_id = player_user_id
         AND am_player.role = 'player'
    )
  )
);--> statement-breakpoint

CREATE POLICY "tr_update_eligible" ON "tournament_results" FOR UPDATE USING (
  current_user_role() = 'technical_director'
  OR (current_user_role() = 'player' AND player_user_id = current_user_id())
  OR (
    current_user_role() = 'trainer'
    AND EXISTS (
      SELECT 1
        FROM academy_memberships am_player
        JOIN academy_memberships am_caller
          ON am_caller.academy_code = am_player.academy_code
         AND am_caller.user_id = current_user_id()
         AND am_caller.role = 'trainer'
       WHERE am_player.user_id = player_user_id
         AND am_player.role = 'player'
    )
  )
) WITH CHECK (
  current_user_role() = 'technical_director'
  OR (current_user_role() = 'player' AND player_user_id = current_user_id())
  OR (
    current_user_role() = 'trainer'
    AND EXISTS (
      SELECT 1
        FROM academy_memberships am_player
        JOIN academy_memberships am_caller
          ON am_caller.academy_code = am_player.academy_code
         AND am_caller.user_id = current_user_id()
         AND am_caller.role = 'trainer'
       WHERE am_player.user_id = player_user_id
         AND am_player.role = 'player'
    )
  )
);--> statement-breakpoint

CREATE POLICY "tr_delete_td_only" ON "tournament_results" FOR DELETE USING (
  current_user_role() = 'technical_director'
);--> statement-breakpoint

-- ─── match_results policies (ride with tournament_results per D-69) ──
-- SELECT: same 5-branch UNION as tournament_results.
CREATE POLICY "mr_select_via_tr" ON "match_results" FOR SELECT USING (
  (tournament_event_id, player_user_id) IN (
    SELECT tournament_event_id, player_user_id
      FROM tournament_result_visible_to(current_user_id(), current_user_role())
  )
);--> statement-breakpoint

-- INSERT: TD always; OR player own; OR trainer in academy (D-73).
CREATE POLICY "mr_insert_eligible" ON "match_results" FOR INSERT WITH CHECK (
  current_user_role() = 'technical_director'
  OR (current_user_role() = 'player' AND player_user_id = current_user_id())
  OR (
    current_user_role() = 'trainer'
    AND EXISTS (
      SELECT 1
        FROM academy_memberships am_player
        JOIN academy_memberships am_caller
          ON am_caller.academy_code = am_player.academy_code
         AND am_caller.user_id = current_user_id()
         AND am_caller.role = 'trainer'
       WHERE am_player.user_id = player_user_id
         AND am_player.role = 'player'
    )
  )
);--> statement-breakpoint

-- UPDATE: TD or own. Trainer cannot edit individual match rows after entry
-- (they re-enter via the atomic upsert path; D-73 backfill is replace-set).
CREATE POLICY "mr_update_eligible" ON "match_results" FOR UPDATE USING (
  current_user_role() = 'technical_director'
  OR (current_user_role() = 'player' AND player_user_id = current_user_id())
) WITH CHECK (
  current_user_role() = 'technical_director'
  OR (current_user_role() = 'player' AND player_user_id = current_user_id())
);--> statement-breakpoint

CREATE POLICY "mr_delete_eligible" ON "match_results" FOR DELETE USING (
  current_user_role() = 'technical_director'
  OR (current_user_role() = 'player' AND player_user_id = current_user_id())
);--> statement-breakpoint

-- ─── ranking_entries policies (D-89 — player OR TD entry; scoped read via helper) ─
CREATE POLICY "re_select_via_helper" ON "ranking_entries" FOR SELECT USING (
  player_user_id IN (
    SELECT player_user_id FROM ranking_entry_visible_to(current_user_id(), current_user_role())
  )
);--> statement-breakpoint

CREATE POLICY "re_insert_player_or_td" ON "ranking_entries" FOR INSERT WITH CHECK (
  current_user_role() = 'technical_director'
  OR (current_user_role() = 'player' AND player_user_id = current_user_id())
);--> statement-breakpoint

CREATE POLICY "re_update_player_or_td" ON "ranking_entries" FOR UPDATE USING (
  current_user_role() = 'technical_director'
  OR (current_user_role() = 'player' AND player_user_id = current_user_id())
) WITH CHECK (
  current_user_role() = 'technical_director'
  OR (current_user_role() = 'player' AND player_user_id = current_user_id())
);--> statement-breakpoint

CREATE POLICY "re_delete_td_only" ON "ranking_entries" FOR DELETE USING (
  current_user_role() = 'technical_director'
);--> statement-breakpoint

COMMENT ON POLICY "tr_select_via_helper" ON "tournament_results" IS 'D-78 academy-wide visibility via tournament_result_visible_to 5-branch UNION.';
