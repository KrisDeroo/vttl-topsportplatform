# Rollback — 0018_phase4_rls_helpers_and_sparring_branch

**Risk:** MEDIUM. Drops 3 SECURITY DEFINER functions (`session_participants_visible_to`, `tournament_result_visible_to`, `ranking_entry_visible_to`) AND reverts `calendar_events_visible_to` to its Phase 3 sparring-no-op state. Also drops all per-action policies on 5 operational tables — those tables remain RLS-enabled with FORCE, which means dropping the policies = default-deny lockout for app_user until 0018 is re-applied or those policies re-created. The two lookup tables (`tournament_round`, `belgium_classification`) keep their read+TD-write policies intact in this rollback (they live with their tables); if those need rolling back too, drop them in the 0015/0016 rollback chain.

**Procedure:**

1. Application code that depends on `tournament_result_visible_to`, `session_participants_visible_to`, or `ranking_entry_visible_to` MUST be redeployed first (or app stopped) — runtime calls will throw "function does not exist".
2. Confirm 0019 has been rolled back (cron jobs reading `session_participants` will silently noop after the helper functions disappear, but the cron functions themselves remain — drop those too via 0019 rollback if a clean uninstall is desired).
3. Connect via `DIRECT_DATABASE_URL` and run:

   ```sql
   BEGIN;

   -- Drop per-action policies (5 operational tables × 4 actions ≈ 20 policies).
   -- session_participants
   DROP POLICY IF EXISTS "sp_select_via_helper"      ON "session_participants";
   DROP POLICY IF EXISTS "sp_insert_trainer_or_td"   ON "session_participants";
   DROP POLICY IF EXISTS "sp_update_trainer_or_td"   ON "session_participants";
   DROP POLICY IF EXISTS "sp_delete_td_only"         ON "session_participants";

   -- session_sparring_partners
   DROP POLICY IF EXISTS "ssp_select_via_calendar_visibility" ON "session_sparring_partners";
   DROP POLICY IF EXISTS "ssp_insert_td_only"                 ON "session_sparring_partners";
   DROP POLICY IF EXISTS "ssp_update_td_only"                 ON "session_sparring_partners";
   DROP POLICY IF EXISTS "ssp_delete_td_only"                 ON "session_sparring_partners";

   -- tournament_results
   DROP POLICY IF EXISTS "tr_select_via_helper" ON "tournament_results";
   DROP POLICY IF EXISTS "tr_insert_eligible"   ON "tournament_results";
   DROP POLICY IF EXISTS "tr_update_eligible"   ON "tournament_results";
   DROP POLICY IF EXISTS "tr_delete_td_only"    ON "tournament_results";

   -- match_results
   DROP POLICY IF EXISTS "mr_select_via_tr"    ON "match_results";
   DROP POLICY IF EXISTS "mr_insert_eligible"  ON "match_results";
   DROP POLICY IF EXISTS "mr_update_eligible"  ON "match_results";
   DROP POLICY IF EXISTS "mr_delete_eligible"  ON "match_results";

   -- ranking_entries
   DROP POLICY IF EXISTS "re_select_via_helper"     ON "ranking_entries";
   DROP POLICY IF EXISTS "re_insert_player_or_td"   ON "ranking_entries";
   DROP POLICY IF EXISTS "re_update_player_or_td"   ON "ranking_entries";
   DROP POLICY IF EXISTS "re_delete_td_only"        ON "ranking_entries";

   -- Drop the 3 new SECURITY DEFINER fns.
   DROP FUNCTION IF EXISTS session_participants_visible_to(UUID, TEXT);
   DROP FUNCTION IF EXISTS tournament_result_visible_to(UUID, TEXT);
   DROP FUNCTION IF EXISTS ranking_entry_visible_to(UUID, TEXT);

   -- Re-create calendar_events_visible_to with the Phase 3 5-branch body
   -- (paste verbatim from drizzle/0011_phase3_calendar_rls_policies.sql §Section 2,
   -- without Branch 6). This restores the pre-Phase-4 state.
   CREATE OR REPLACE FUNCTION calendar_events_visible_to(caller_id UUID, caller_role TEXT)
   RETURNS TABLE(event_id UUID) AS $$
     SELECT ce.id FROM calendar_events ce
      WHERE caller_role IN ('technical_director', 'medical_staff')
     UNION
     SELECT ce.id FROM calendar_events ce WHERE ce.created_by = caller_id
     UNION
     SELECT cep.event_id FROM calendar_event_participants cep WHERE cep.user_id = caller_id
     UNION
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
     SELECT cep.event_id
       FROM calendar_event_participants cep
       JOIN parent_child_links pcl
         ON pcl.child_user_id = cep.user_id
        AND pcl.parent_user_id = caller_id
      WHERE caller_role = 'parent';
   $$ LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = pg_catalog, public;

   REVOKE ALL  ON FUNCTION calendar_events_visible_to(UUID, TEXT) FROM PUBLIC;
   GRANT EXECUTE ON FUNCTION calendar_events_visible_to(UUID, TEXT) TO app_user;

   COMMIT;
   ```

4. Restore application traffic.

**Verification:**

- `SELECT COUNT(*) FROM pg_proc WHERE proname IN ('session_participants_visible_to','tournament_result_visible_to','ranking_entry_visible_to');` returns 0.
- `SELECT prosrc FROM pg_proc WHERE proname='calendar_events_visible_to';` body no longer contains `session_sparring_partners` (Branch 6 is gone).
- `SELECT COUNT(*) FROM pg_policies WHERE schemaname='public' AND tablename IN ('session_participants','session_sparring_partners','tournament_results','match_results','ranking_entries');` returns 0.
