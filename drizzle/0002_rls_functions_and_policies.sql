-- Migration 0002_rls_functions_and_policies.sql — Phase 1 Wave 4, Plan 04.
-- Row-Level Security: the mandatory backstop behind tRPC middleware (CRIT-1).
--
-- This file is hand-authored — drizzle-kit does not auto-detect raw SQL
-- functions or RLS policies (they don't appear in the schema barrel because
-- they aren't pgTable definitions). Same governance rule as 0000 / 0001:
-- never edit this file once it has been applied to staging (MIG-01); to
-- change a policy, write a new migration that ALTERs/CREATEs/DROPs.
--
-- The canonical hand-edited source is split for readability into two
-- artifacts retained in src/ for legal/security review:
--   * src/server/db/rls/functions.sql
--   * src/server/db/rls/policies.sql
-- This migration is the byte-for-byte concatenation of those two files
-- (preceded by this header). Plan 16 (Wave 7) will add a CI check that
-- asserts `cat src/server/db/rls/functions.sql src/server/db/rls/policies.sql`
-- equals this file's body below the header — drift detection.
--
-- The migration depends on:
--   * 0000_initial.sql — provides users / sessions / accounts / verifications /
--     parent_child_links / academy_memberships / consent_records / audit_log /
--     idempotency_keys / lookups + the app_user / app_audit_writer roles.
--   * 0001_medical_isolated.sql — provides medical_events / medical_documents /
--     medical_access_audit + the write-time audit triggers (which need RLS
--     INSERT permission on medical_access_audit, granted below via
--     CREATE POLICY maa_insert WITH CHECK (true)).
--
-- After this migration, the Phase-1 succescriterium #3 ("directe Postgres-
-- query als niet-eigenaar op `medical_events` retourneert nul rijen") is
-- technically true: an `app_user` connection that has not run
-- `SET LOCAL app.user_id = …; SET LOCAL app.user_role = …` (or has set
-- those to a non-privileged role for a foreign player) will get zero rows
-- back from any SELECT against medical_events. Plan 11's tRPC middleware
-- is what makes this useful in practice — without that middleware setting
-- the GUCs per-request, every policy denies (current_user_id() returns
-- NULL → NULL = NULL is NULL, evaluated as false in WHERE).

-- ───────────────────────── functions ─────────────────────────
-- (byte-for-byte copy of src/server/db/rls/functions.sql)

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
$$ LANGUAGE SQL STABLE;--> statement-breakpoint

CREATE OR REPLACE FUNCTION current_user_role() RETURNS TEXT AS $$
  SELECT NULLIF(current_setting('app.user_role', true), '');
$$ LANGUAGE SQL STABLE;--> statement-breakpoint

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
$$ LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public;--> statement-breakpoint

GRANT EXECUTE ON FUNCTION players_visible_to(UUID, TEXT) TO app_user;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION players_visible_to(UUID, TEXT) FROM PUBLIC;--> statement-breakpoint

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
$$ LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public;--> statement-breakpoint

GRANT EXECUTE ON FUNCTION query_medical_access_audit(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO app_user;--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION query_medical_access_audit(UUID, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC;--> statement-breakpoint

-- ───────────────────────── policies ─────────────────────────
-- (byte-for-byte copy of src/server/db/rls/policies.sql)

-- =============================================================
-- VTTL Topsport — Row-Level Security policies
-- Sourced into drizzle/0002_rls_functions_and_policies.sql.
-- This is the canonical hand-edited artifact retained in src/ for
-- legal/security review (more readable than scrolling through the
-- numbered drizzle/ migration file).
--
-- For every sensitive table:
--   ALTER TABLE … ENABLE ROW LEVEL SECURITY;
--   ALTER TABLE … FORCE ROW LEVEL SECURITY;   -- enforce even for table owner
--   CREATE POLICY … per access pattern.
--
-- ENABLE alone exempts the table owner; FORCE applies the policies to the
-- owner too. Both are required (CRIT-1: defense in depth — even a leaked
-- migration-owner password must not bypass the policies via PgBouncer).
--
-- Policies use current_user_id() / current_user_role() — STABLE wrappers
-- defined in functions.sql. The planner can hoist these out of per-row
-- evaluation; using current_setting() inline would force per-row scanning
-- (CRIT-8, RISK-RLS-PERF).
--
-- Critical correctness invariants:
--   - medical_events_read EXCLUDES the 'trainer' role (MED-04 separation).
--     Trainers see traffic-light injury status via Phase-5
--     medical_injury_status_for_trainers VIEW only.
--   - consent_records UPDATE policy USING clause requires withdrawn_at IS
--     NULL (one-way withdrawal — D-06). The snapshot/version columns are
--     additionally protected at the role-grant layer (Plan 02 REVOKE
--     DELETE ON consent_records FROM app_user) and at the app layer (Plan
--     12 service rejects mutations to anything other than withdrawn_at).
--   - audit_log_no_select and maa_no_select use USING (false) — direct
--     SELECT returns 0 rows for every caller. Reads must go through the
--     SECURITY DEFINER function query_medical_access_audit() (medical) or
--     a Phase-7 SECURITY DEFINER admin function (general audit_log).
-- =============================================================

-- ─────────────────────────────────────────────────────────────
-- USERS — self read; TD / medical_staff read all; trainer/academy_manager/parent
-- read via players_visible_to(); UPDATE limited to self or TD.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE users ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE users FORCE ROW LEVEL SECURITY;--> statement-breakpoint

CREATE POLICY users_self_or_td ON users FOR SELECT
  USING (
    id = current_user_id()
    OR current_user_role() IN ('technical_director', 'medical_staff')
    OR id IN (SELECT player_user_id FROM players_visible_to(current_user_id(), current_user_role()))
  );--> statement-breakpoint

CREATE POLICY users_td_writes ON users FOR INSERT
  WITH CHECK (current_user_role() = 'technical_director');--> statement-breakpoint

CREATE POLICY users_self_or_td_updates ON users FOR UPDATE
  USING (id = current_user_id() OR current_user_role() = 'technical_director')
  WITH CHECK (id = current_user_id() OR current_user_role() = 'technical_director');--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────
-- SESSIONS — owner-only (token validation already gates access; RLS adds defense
-- against a leaked DB connection).
-- ─────────────────────────────────────────────────────────────
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE sessions FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY sessions_owner ON sessions FOR ALL
  USING (user_id = current_user_id())
  WITH CHECK (user_id = current_user_id());--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────
-- ACCOUNTS — owner-only (Better Auth credential rows).
-- ─────────────────────────────────────────────────────────────
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE accounts FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY accounts_owner ON accounts FOR ALL
  USING (user_id = current_user_id())
  WITH CHECK (user_id = current_user_id());--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────
-- VERIFICATIONS — Better Auth's email-verification / password-reset token
-- table. Anonymous (pre-login) flows must INSERT (sign-up email) and SELECT
-- (token consumption); security comes from the token's unguessability and
-- expires_at TTL, not from row-level scoping. Granting the open policy is
-- safe because the table holds no PII beyond an opaque token + identifier.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE verifications ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE verifications FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY verifications_anon_inserts ON verifications FOR INSERT WITH CHECK (true);--> statement-breakpoint
CREATE POLICY verifications_consume ON verifications FOR ALL
  USING (true)
  WITH CHECK (true);--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────
-- PARENT_CHILD_LINKS — parent OR child OR TD reads; TD-only writes.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE parent_child_links ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE parent_child_links FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY pcl_visible ON parent_child_links FOR SELECT
  USING (
    parent_user_id = current_user_id()
    OR child_user_id = current_user_id()
    OR current_user_role() = 'technical_director'
  );--> statement-breakpoint
CREATE POLICY pcl_td_writes ON parent_child_links FOR INSERT
  WITH CHECK (current_user_role() = 'technical_director');--> statement-breakpoint
CREATE POLICY pcl_td_updates ON parent_child_links FOR UPDATE
  USING (current_user_role() = 'technical_director')
  WITH CHECK (current_user_role() = 'technical_director');--> statement-breakpoint
CREATE POLICY pcl_td_deletes ON parent_child_links FOR DELETE
  USING (current_user_role() = 'technical_director');--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────
-- ACADEMY_MEMBERSHIPS — own row; TD reads all; trainer/academy_manager reads
-- members of academies the caller belongs to (so academy management UIs work).
-- ─────────────────────────────────────────────────────────────
ALTER TABLE academy_memberships ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE academy_memberships FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY am_visible ON academy_memberships FOR SELECT
  USING (
    user_id = current_user_id()
    OR current_user_role() = 'technical_director'
    OR EXISTS (
      SELECT 1 FROM academy_memberships ca
       WHERE ca.user_id = current_user_id()
         AND ca.academy_code = academy_memberships.academy_code
         AND ca.role IN ('trainer', 'academy_manager')
    )
  );--> statement-breakpoint
CREATE POLICY am_td_writes ON academy_memberships FOR INSERT
  WITH CHECK (current_user_role() = 'technical_director');--> statement-breakpoint
CREATE POLICY am_td_updates ON academy_memberships FOR UPDATE
  USING (current_user_role() = 'technical_director')
  WITH CHECK (current_user_role() = 'technical_director');--> statement-breakpoint
CREATE POLICY am_td_deletes ON academy_memberships FOR DELETE
  USING (current_user_role() = 'technical_director');--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────
-- CONSENT_RECORDS — snapshot is the legal record (D-06). Reads by
-- self, consenting party (parent acting for minor), or TD. INSERT only
-- when the caller is the user OR the consenting party OR a TD doing
-- back-office consent intake. UPDATE strictly limited to flipping
-- withdrawn_at on an active consent (USING withdrawn_at IS NULL).
-- DELETE is forbidden at the role-grant layer (Plan 02).
-- ─────────────────────────────────────────────────────────────
ALTER TABLE consent_records ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE consent_records FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY consent_visible ON consent_records FOR SELECT
  USING (
    user_id = current_user_id()
    OR consenting_party_user_id = current_user_id()
    OR current_user_role() = 'technical_director'
  );--> statement-breakpoint
CREATE POLICY consent_inserts ON consent_records FOR INSERT
  WITH CHECK (
    user_id = current_user_id()
    OR consenting_party_user_id = current_user_id()
    OR current_user_role() = 'technical_director'
  );--> statement-breakpoint
-- UPDATE limited to own withdrawal — `withdrawn_at` only.
-- USING clause requires withdrawn_at IS NULL — withdrawal is one-way; a
-- previously-withdrawn record cannot be "un-withdrawn" via UPDATE.
-- The snapshot/version columns are protected by:
--   (a) the app-layer service (Plan 12) which only emits `UPDATE … SET
--       withdrawn_at = now() WHERE id = $1`,
--   (b) Plan 02's REVOKE DELETE ON consent_records FROM app_user (a delete-
--       and-reinsert workaround is also blocked).
-- A future-phase CHECK constraint on UPDATE could add column-level lockdown
-- via a BEFORE UPDATE trigger; deferred until we observe an attack vector.
CREATE POLICY consent_withdraw ON consent_records FOR UPDATE
  USING (user_id = current_user_id() AND withdrawn_at IS NULL)
  WITH CHECK (user_id = current_user_id());--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────
-- IDEMPOTENCY_KEYS — owner-only (per-user request idempotency keys).
-- ─────────────────────────────────────────────────────────────
ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE idempotency_keys FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY idempotency_owner ON idempotency_keys FOR ALL
  USING (user_id = current_user_id())
  WITH CHECK (user_id = current_user_id());--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────
-- AUDIT_LOG — append-only for app_user (Plan 02 REVOKEs UPDATE/DELETE);
-- direct SELECT blocked at RLS so a leaked connection cannot read the audit
-- trail. TD reads via a Phase-7 SECURITY DEFINER admin function (deferred —
-- Phase 1 only sets up the read-block; the admin read path lands later).
-- ─────────────────────────────────────────────────────────────
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY audit_log_no_select ON audit_log FOR SELECT USING (false);--> statement-breakpoint
CREATE POLICY audit_log_inserts ON audit_log FOR INSERT WITH CHECK (true);--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────
-- LOOKUPS — public read for authenticated app_user role; codes only (no PII).
-- TD-only writes (lookup additions/updates require admin intent).
--
-- Rationale for `FOR ALL TO app_user` syntax: the open SELECT is granted to
-- everyone connected (USING true), but mutating policies are restricted via
-- TO app_user with the role check inside USING/WITH CHECK. This keeps the
-- policy file independent of which DB role the request comes in on (the
-- migration owner / postgres role bypasses by FORCE … nope — FORCE forces
-- it on the owner too; that's the point of the role-check inside the policy).
-- ─────────────────────────────────────────────────────────────
ALTER TABLE status ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE status FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY status_read ON status FOR SELECT USING (true);--> statement-breakpoint
CREATE POLICY status_td_writes ON status FOR ALL TO app_user
  USING (current_user_role() = 'technical_director')
  WITH CHECK (current_user_role() = 'technical_director');--> statement-breakpoint

ALTER TABLE academy ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE academy FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY academy_read ON academy FOR SELECT USING (true);--> statement-breakpoint
CREATE POLICY academy_td_writes ON academy FOR ALL TO app_user
  USING (current_user_role() = 'technical_director')
  WITH CHECK (current_user_role() = 'technical_director');--> statement-breakpoint

ALTER TABLE tournament_type ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE tournament_type FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tt_read ON tournament_type FOR SELECT USING (true);--> statement-breakpoint
CREATE POLICY tt_td_writes ON tournament_type FOR ALL TO app_user
  USING (current_user_role() = 'technical_director')
  WITH CHECK (current_user_role() = 'technical_director');--> statement-breakpoint

ALTER TABLE ranking_type ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE ranking_type FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY rt_read ON ranking_type FOR SELECT USING (true);--> statement-breakpoint
CREATE POLICY rt_td_writes ON ranking_type FOR ALL TO app_user
  USING (current_user_role() = 'technical_director')
  WITH CHECK (current_user_role() = 'technical_director');--> statement-breakpoint

ALTER TABLE training_type ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE training_type FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY trt_read ON training_type FOR SELECT USING (true);--> statement-breakpoint
CREATE POLICY trt_td_writes ON training_type FOR ALL TO app_user
  USING (current_user_role() = 'technical_director')
  WITH CHECK (current_user_role() = 'technical_director');--> statement-breakpoint

ALTER TABLE organisation ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE organisation FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY org_read ON organisation FOR SELECT USING (true);--> statement-breakpoint
CREATE POLICY org_td_writes ON organisation FOR ALL TO app_user
  USING (current_user_role() = 'technical_director')
  WITH CHECK (current_user_role() = 'technical_director');--> statement-breakpoint

ALTER TABLE outcome_level ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE outcome_level FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY ol_read ON outcome_level FOR SELECT USING (true);--> statement-breakpoint
CREATE POLICY ol_td_writes ON outcome_level FOR ALL TO app_user
  USING (current_user_role() = 'technical_director')
  WITH CHECK (current_user_role() = 'technical_director');--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────
-- MEDICAL_EVENTS — strict (CRIT-2, T-01-03, GDPR-03). Trainers EXPLICITLY
-- excluded; coaches get traffic-light status via Phase-5
-- medical_injury_status_for_trainers VIEW (MED-04 separation).
--
-- Visible only to: player-self, technical_director, medical_staff,
-- linked-parent (parent_child_links).
--
-- All policies require deleted_at IS NULL — soft-deleted events disappear
-- from query paths, and only the GDPR-07 erasure SECURITY DEFINER procedure
-- (Plan 18) bypasses RLS to hard-delete.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE medical_events ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE medical_events FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY medical_events_read ON medical_events FOR SELECT
  USING (
    deleted_at IS NULL
    AND (
      player_user_id = current_user_id()
      OR current_user_role() IN ('technical_director', 'medical_staff')
      OR (
        current_user_role() = 'parent'
        AND player_user_id IN (
          SELECT child_user_id FROM parent_child_links
           WHERE parent_user_id = current_user_id()
        )
      )
    )
  );--> statement-breakpoint
CREATE POLICY medical_events_write ON medical_events FOR INSERT
  WITH CHECK (
    current_user_role() IN ('technical_director', 'medical_staff')
    OR player_user_id = current_user_id()
  );--> statement-breakpoint
CREATE POLICY medical_events_update ON medical_events FOR UPDATE
  USING (
    current_user_role() IN ('technical_director', 'medical_staff')
    OR player_user_id = current_user_id()
  )
  WITH CHECK (
    current_user_role() IN ('technical_director', 'medical_staff')
    OR player_user_id = current_user_id()
  );--> statement-breakpoint
-- No DELETE policy — soft-delete via UPDATE deleted_at; hard-delete only via
-- GDPR-07 erasure SECURITY DEFINER fn (deferred to Plan 18, Phase 7).

-- ─────────────────────────────────────────────────────────────
-- MEDICAL_DOCUMENTS — same shape as medical_events.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE medical_documents ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE medical_documents FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY medical_documents_read ON medical_documents FOR SELECT
  USING (
    deleted_at IS NULL
    AND (
      player_user_id = current_user_id()
      OR current_user_role() IN ('technical_director', 'medical_staff')
      OR (
        current_user_role() = 'parent'
        AND player_user_id IN (
          SELECT child_user_id FROM parent_child_links
           WHERE parent_user_id = current_user_id()
        )
      )
    )
  );--> statement-breakpoint
CREATE POLICY medical_documents_write ON medical_documents FOR INSERT
  WITH CHECK (
    current_user_role() IN ('technical_director', 'medical_staff')
    OR player_user_id = current_user_id()
  );--> statement-breakpoint
CREATE POLICY medical_documents_update ON medical_documents FOR UPDATE
  USING (
    current_user_role() IN ('technical_director', 'medical_staff')
    OR player_user_id = current_user_id()
  )
  WITH CHECK (
    current_user_role() IN ('technical_director', 'medical_staff')
    OR player_user_id = current_user_id()
  );--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────
-- MEDICAL_ACCESS_AUDIT — direct SELECT blocked (USING false); reads only via
-- query_medical_access_audit() SECURITY DEFINER function. INSERTs allowed
-- because the audit triggers on medical_events / medical_documents
-- (defined in Plan 03's migration 0001) write here as SECURITY DEFINER —
-- they need a permissive INSERT policy at the RLS layer.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE medical_access_audit ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE medical_access_audit FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY maa_no_select ON medical_access_audit FOR SELECT USING (false);--> statement-breakpoint
CREATE POLICY maa_insert ON medical_access_audit FOR INSERT WITH CHECK (true);
