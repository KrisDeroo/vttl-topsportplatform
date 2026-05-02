-- =============================================================
-- VTTL Topsport — RLS support functions
-- Sourced into drizzle/0002_rls_functions_and_policies.sql.
-- This is the canonical hand-edited artifact retained in src/ for
-- legal/security review (more readable than scrolling through the
-- numbered drizzle/ migration file).
--
-- Two responsibilities:
--   1. STABLE wrappers around the per-request GUCs
--      (current_user_id / current_user_role) so the planner can
--      hoist them out of per-row evaluation in policies (CRIT-8,
--      RISK-RLS-PERF). VOLATILE function calls inside a policy
--      USING/WITH CHECK clause are re-evaluated for every row,
--      which turns a 50ms ranking query into a 5s sequential scan.
--   2. SECURITY DEFINER helpers that intentionally bypass RLS:
--      - players_visible_to() is the canonical visibility rule
--        (single source of truth for "which players is the caller
--        allowed to see?", CRIT-3). Used by future phases for
--        rankings, training plans, evaluations.
--      - query_medical_access_audit() is the only read path for
--        the tamper-evident audit (CRIT-7, T-01-04). The table's
--        own RLS policy is USING (false) — a bare SELECT returns
--        zero rows; this function is the controlled exception.
--
-- The GUCs are populated per-request by Plan 11's tRPC middleware
-- via SET LOCAL app.user_id / app.user_role inside each transaction.
-- Without that wiring, current_user_id() returns NULL and every
-- policy that requires id = current_user_id() denies (NULL = NULL
-- is NULL, evaluated as false in WHERE).
-- =============================================================

-- 1. Stable wrapper around current_setting('app.user_id') — enables planner to hoist
--    the value out of per-row evaluation in policies (CRIT-8, RISK-RLS-PERF).
--    NULLIF coalesces an empty-string GUC (set explicitly to '') to NULL so the
--    cast to UUID does not throw 'invalid input syntax for type uuid: ""'.
--    Second arg `true` to current_setting = "missing_ok": returns NULL instead of
--    throwing when the GUC is unset (e.g., during migrations or admin sessions).
CREATE OR REPLACE FUNCTION current_user_id() RETURNS UUID AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid;
$$ LANGUAGE SQL STABLE;

CREATE OR REPLACE FUNCTION current_user_role() RETURNS TEXT AS $$
  SELECT NULLIF(current_setting('app.user_role', true), '');
$$ LANGUAGE SQL STABLE;

-- 2. The canonical visibility rule (CRIT-3). Single source of truth for "which
--    players is the caller allowed to see?". Each role contributes one UNION
--    branch — planner chooses the cheapest path per role and the role-discriminating
--    WHERE clauses act as no-op short-circuits for branches that don't apply.
--    SECURITY DEFINER so it can read parent_child_links / academy_memberships even
--    when the caller's RLS policies on those tables would block them; SET search_path
--    = public is mandatory on every SECURITY DEFINER function (defense against
--    schema-search-path injection).
--    LANGUAGE SQL STABLE means the planner can call this once per query (inlined
--    or memoized for the duration of the snapshot) rather than per row.
CREATE OR REPLACE FUNCTION players_visible_to(caller_id UUID, caller_role TEXT)
RETURNS TABLE(player_user_id UUID) AS $$
  -- Player sees self
  SELECT id FROM users WHERE id = caller_id AND caller_role = 'player'

  UNION

  -- Parent sees own child(ren) — explicit link via parent_child_links
  SELECT child_user_id FROM parent_child_links
   WHERE parent_user_id = caller_id AND caller_role = 'parent'

  UNION

  -- Trainer / academy_manager: sees players in same academies as the caller
  SELECT pa.user_id
    FROM academy_memberships pa
    JOIN academy_memberships ca ON ca.academy_code = pa.academy_code
   WHERE ca.user_id = caller_id
     AND ca.role IN ('trainer', 'academy_manager')
     AND pa.role = 'player'
     AND caller_role IN ('trainer', 'academy_manager')

  UNION

  -- Technical director / medical_staff sees all players (privileged roles)
  SELECT id FROM users WHERE caller_role IN ('technical_director', 'medical_staff')

  UNION

  -- Sparring partner branch: Phase 5 fills it via session_sparring_partners +
  -- calendar_event_participants. Placeholder for forward compatibility — returns
  -- no rows in Phase 1.
  SELECT NULL::UUID WHERE FALSE;
$$ LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION players_visible_to(UUID, TEXT) TO app_user;
REVOKE EXECUTE ON FUNCTION players_visible_to(UUID, TEXT) FROM PUBLIC;

-- 3. Only read path for medical_access_audit (CRIT-7, T-01-04).
--    SECURITY DEFINER so it bypasses the table's RLS USING (false) policy.
--    Caller-side authorization (TD-only) is enforced in app code at the tRPC
--    procedure layer (Plan 11 / Phase 7 admin UI). The LIMIT 10000 cap is a
--    defense against runaway memory in the admin UI when a TD requests an
--    over-broad date range; the date range is required (NOT NULL params) so
--    callers cannot accidentally page through all-time history in one call.
CREATE OR REPLACE FUNCTION query_medical_access_audit(p_subject UUID, p_from TIMESTAMPTZ, p_to TIMESTAMPTZ)
RETURNS SETOF medical_access_audit AS $$
  SELECT * FROM medical_access_audit
   WHERE subject_player_id = p_subject AND occurred_at BETWEEN p_from AND p_to
   ORDER BY occurred_at DESC
   LIMIT 10000;
$$ LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION query_medical_access_audit(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO app_user;
REVOKE EXECUTE ON FUNCTION query_medical_access_audit(UUID, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC;
