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
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;

CREATE POLICY users_self_or_td ON users FOR SELECT
  USING (
    id = current_user_id()
    OR current_user_role() IN ('technical_director', 'medical_staff')
    OR id IN (SELECT player_user_id FROM players_visible_to(current_user_id(), current_user_role()))
  );

CREATE POLICY users_td_writes ON users FOR INSERT
  WITH CHECK (current_user_role() = 'technical_director');

CREATE POLICY users_self_or_td_updates ON users FOR UPDATE
  USING (id = current_user_id() OR current_user_role() = 'technical_director')
  WITH CHECK (id = current_user_id() OR current_user_role() = 'technical_director');

-- ─────────────────────────────────────────────────────────────
-- SESSIONS — owner-only (token validation already gates access; RLS adds defense
-- against a leaked DB connection).
-- ─────────────────────────────────────────────────────────────
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY sessions_owner ON sessions FOR ALL
  USING (user_id = current_user_id())
  WITH CHECK (user_id = current_user_id());

-- ─────────────────────────────────────────────────────────────
-- ACCOUNTS — owner-only (Better Auth credential rows).
-- ─────────────────────────────────────────────────────────────
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts FORCE ROW LEVEL SECURITY;
CREATE POLICY accounts_owner ON accounts FOR ALL
  USING (user_id = current_user_id())
  WITH CHECK (user_id = current_user_id());

-- ─────────────────────────────────────────────────────────────
-- VERIFICATIONS — Better Auth's email-verification / password-reset token
-- table. Anonymous (pre-login) flows must INSERT (sign-up email) and SELECT
-- (token consumption); security comes from the token's unguessability and
-- expires_at TTL, not from row-level scoping. Granting the open policy is
-- safe because the table holds no PII beyond an opaque token + identifier.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE verifications FORCE ROW LEVEL SECURITY;
CREATE POLICY verifications_anon_inserts ON verifications FOR INSERT WITH CHECK (true);
CREATE POLICY verifications_consume ON verifications FOR ALL
  USING (true)
  WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────
-- PARENT_CHILD_LINKS — parent OR child OR TD reads; TD-only writes.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE parent_child_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE parent_child_links FORCE ROW LEVEL SECURITY;
CREATE POLICY pcl_visible ON parent_child_links FOR SELECT
  USING (
    parent_user_id = current_user_id()
    OR child_user_id = current_user_id()
    OR current_user_role() = 'technical_director'
  );
CREATE POLICY pcl_td_writes ON parent_child_links FOR INSERT
  WITH CHECK (current_user_role() = 'technical_director');
CREATE POLICY pcl_td_updates ON parent_child_links FOR UPDATE
  USING (current_user_role() = 'technical_director')
  WITH CHECK (current_user_role() = 'technical_director');
CREATE POLICY pcl_td_deletes ON parent_child_links FOR DELETE
  USING (current_user_role() = 'technical_director');

-- ─────────────────────────────────────────────────────────────
-- ACADEMY_MEMBERSHIPS — own row; TD reads all; trainer/academy_manager reads
-- members of academies the caller belongs to (so academy management UIs work).
-- ─────────────────────────────────────────────────────────────
ALTER TABLE academy_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE academy_memberships FORCE ROW LEVEL SECURITY;
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
  );
CREATE POLICY am_td_writes ON academy_memberships FOR INSERT
  WITH CHECK (current_user_role() = 'technical_director');
CREATE POLICY am_td_updates ON academy_memberships FOR UPDATE
  USING (current_user_role() = 'technical_director')
  WITH CHECK (current_user_role() = 'technical_director');
CREATE POLICY am_td_deletes ON academy_memberships FOR DELETE
  USING (current_user_role() = 'technical_director');

-- ─────────────────────────────────────────────────────────────
-- CONSENT_RECORDS — snapshot is the legal record (D-06). Reads by
-- self, consenting party (parent acting for minor), or TD. INSERT only
-- when the caller is the user OR the consenting party OR a TD doing
-- back-office consent intake. UPDATE strictly limited to flipping
-- withdrawn_at on an active consent (USING withdrawn_at IS NULL).
-- DELETE is forbidden at the role-grant layer (Plan 02).
-- ─────────────────────────────────────────────────────────────
ALTER TABLE consent_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE consent_records FORCE ROW LEVEL SECURITY;
CREATE POLICY consent_visible ON consent_records FOR SELECT
  USING (
    user_id = current_user_id()
    OR consenting_party_user_id = current_user_id()
    OR current_user_role() = 'technical_director'
  );
CREATE POLICY consent_inserts ON consent_records FOR INSERT
  WITH CHECK (
    user_id = current_user_id()
    OR consenting_party_user_id = current_user_id()
    OR current_user_role() = 'technical_director'
  );
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
  WITH CHECK (user_id = current_user_id());

-- ─────────────────────────────────────────────────────────────
-- IDEMPOTENCY_KEYS — owner-only (per-user request idempotency keys).
-- ─────────────────────────────────────────────────────────────
ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE idempotency_keys FORCE ROW LEVEL SECURITY;
CREATE POLICY idempotency_owner ON idempotency_keys FOR ALL
  USING (user_id = current_user_id())
  WITH CHECK (user_id = current_user_id());

-- ─────────────────────────────────────────────────────────────
-- AUDIT_LOG — append-only for app_user (Plan 02 REVOKEs UPDATE/DELETE);
-- direct SELECT blocked at RLS so a leaked connection cannot read the audit
-- trail. TD reads via a Phase-7 SECURITY DEFINER admin function (deferred —
-- Phase 1 only sets up the read-block; the admin read path lands later).
-- ─────────────────────────────────────────────────────────────
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_log_no_select ON audit_log FOR SELECT USING (false);
CREATE POLICY audit_log_inserts ON audit_log FOR INSERT WITH CHECK (true);

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
ALTER TABLE status ENABLE ROW LEVEL SECURITY;
ALTER TABLE status FORCE ROW LEVEL SECURITY;
CREATE POLICY status_read ON status FOR SELECT USING (true);
CREATE POLICY status_td_writes ON status FOR ALL TO app_user
  USING (current_user_role() = 'technical_director')
  WITH CHECK (current_user_role() = 'technical_director');

ALTER TABLE academy ENABLE ROW LEVEL SECURITY;
ALTER TABLE academy FORCE ROW LEVEL SECURITY;
CREATE POLICY academy_read ON academy FOR SELECT USING (true);
CREATE POLICY academy_td_writes ON academy FOR ALL TO app_user
  USING (current_user_role() = 'technical_director')
  WITH CHECK (current_user_role() = 'technical_director');

ALTER TABLE tournament_type ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournament_type FORCE ROW LEVEL SECURITY;
CREATE POLICY tt_read ON tournament_type FOR SELECT USING (true);
CREATE POLICY tt_td_writes ON tournament_type FOR ALL TO app_user
  USING (current_user_role() = 'technical_director')
  WITH CHECK (current_user_role() = 'technical_director');

ALTER TABLE ranking_type ENABLE ROW LEVEL SECURITY;
ALTER TABLE ranking_type FORCE ROW LEVEL SECURITY;
CREATE POLICY rt_read ON ranking_type FOR SELECT USING (true);
CREATE POLICY rt_td_writes ON ranking_type FOR ALL TO app_user
  USING (current_user_role() = 'technical_director')
  WITH CHECK (current_user_role() = 'technical_director');

ALTER TABLE training_type ENABLE ROW LEVEL SECURITY;
ALTER TABLE training_type FORCE ROW LEVEL SECURITY;
CREATE POLICY trt_read ON training_type FOR SELECT USING (true);
CREATE POLICY trt_td_writes ON training_type FOR ALL TO app_user
  USING (current_user_role() = 'technical_director')
  WITH CHECK (current_user_role() = 'technical_director');

ALTER TABLE organisation ENABLE ROW LEVEL SECURITY;
ALTER TABLE organisation FORCE ROW LEVEL SECURITY;
CREATE POLICY org_read ON organisation FOR SELECT USING (true);
CREATE POLICY org_td_writes ON organisation FOR ALL TO app_user
  USING (current_user_role() = 'technical_director')
  WITH CHECK (current_user_role() = 'technical_director');

ALTER TABLE outcome_level ENABLE ROW LEVEL SECURITY;
ALTER TABLE outcome_level FORCE ROW LEVEL SECURITY;
CREATE POLICY ol_read ON outcome_level FOR SELECT USING (true);
CREATE POLICY ol_td_writes ON outcome_level FOR ALL TO app_user
  USING (current_user_role() = 'technical_director')
  WITH CHECK (current_user_role() = 'technical_director');

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
ALTER TABLE medical_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE medical_events FORCE ROW LEVEL SECURITY;
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
  );
CREATE POLICY medical_events_write ON medical_events FOR INSERT
  WITH CHECK (
    current_user_role() IN ('technical_director', 'medical_staff')
    OR player_user_id = current_user_id()
  );
CREATE POLICY medical_events_update ON medical_events FOR UPDATE
  USING (
    current_user_role() IN ('technical_director', 'medical_staff')
    OR player_user_id = current_user_id()
  )
  WITH CHECK (
    current_user_role() IN ('technical_director', 'medical_staff')
    OR player_user_id = current_user_id()
  );
-- No DELETE policy — soft-delete via UPDATE deleted_at; hard-delete only via
-- GDPR-07 erasure SECURITY DEFINER fn (deferred to Plan 18, Phase 7).

-- ─────────────────────────────────────────────────────────────
-- MEDICAL_DOCUMENTS — same shape as medical_events.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE medical_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE medical_documents FORCE ROW LEVEL SECURITY;
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
  );
CREATE POLICY medical_documents_write ON medical_documents FOR INSERT
  WITH CHECK (
    current_user_role() IN ('technical_director', 'medical_staff')
    OR player_user_id = current_user_id()
  );
CREATE POLICY medical_documents_update ON medical_documents FOR UPDATE
  USING (
    current_user_role() IN ('technical_director', 'medical_staff')
    OR player_user_id = current_user_id()
  )
  WITH CHECK (
    current_user_role() IN ('technical_director', 'medical_staff')
    OR player_user_id = current_user_id()
  );

-- ─────────────────────────────────────────────────────────────
-- MEDICAL_ACCESS_AUDIT — direct SELECT blocked (USING false); reads only via
-- query_medical_access_audit() SECURITY DEFINER function. INSERTs allowed
-- because the audit triggers on medical_events / medical_documents
-- (defined in Plan 03's migration 0001) write here as SECURITY DEFINER —
-- they need a permissive INSERT policy at the RLS layer.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE medical_access_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE medical_access_audit FORCE ROW LEVEL SECURITY;
CREATE POLICY maa_no_select ON medical_access_audit FOR SELECT USING (false);
CREATE POLICY maa_insert ON medical_access_audit FOR INSERT WITH CHECK (true);
