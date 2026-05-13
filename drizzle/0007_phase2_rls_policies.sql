-- Migration 0007_phase2_rls_policies.sql — Phase 2 Wave 3.
-- RLS for the 4 Phase 2 tables + storage.objects (profiles bucket) + the
-- mark_scan_result() SECURITY DEFINER bridge for the BullMQ malware-scan worker.
--
-- This file is hand-authored — drizzle-kit does not auto-detect RLS policy
-- DDL (policies live alongside CREATE TABLE in raw SQL, not in the
-- pgTable barrel). Same governance discipline as Phase 1's 0002:
-- never edit this migration once it has been applied to staging (MIG-01);
-- to change a policy, write a new migration that ALTERs/CREATEs/DROPs.
--
-- The migration depends on:
--   * 0002_rls_functions_and_policies.sql — provides current_user_id() /
--     current_user_role() STABLE wrappers and players_visible_to(UUID, TEXT)
--     SECURITY DEFINER helper that we call from the new policies.
--   * 0006_phase2_profiles_and_files.sql — creates the 4 tables this
--     migration secures (players, trainers, uploaded_files,
--     age_category_history) plus the 2 lookups.
--
-- Sections:
--   0. Defensive storage bucket bootstrap (`profiles`, public=false)
--      — runs idempotently in case the bucket was not created in Phase 1
--      setup (RESEARCH A6 — "bucket profiles/ bestaat al" is unverified).
--   1. ENABLE + FORCE RLS on the 4 new tables.
--      ENABLE alone exempts the table owner; FORCE applies the policies
--      to the owner too. Both are required (Phase 1 convention; CRIT-1).
--   2. players policies (SELECT / INSERT / UPDATE / DELETE).
--   3. trainers policies (SELECT / INSERT / UPDATE / DELETE).
--   4. uploaded_files policies (SELECT / INSERT / UPDATE / DELETE).
--   5. age_category_history policies (SELECT / INSERT / UPDATE / DELETE).
--   6. storage.objects policies for the profiles bucket (defense in
--      depth — service-role key bypasses these, but they exist for future
--      anon-key paths and for legal/security drift detection).
--   7. mark_scan_result(UUID, TEXT, TEXT, TIMESTAMPTZ) SECURITY DEFINER
--      function — bridges the malware-scan worker (no GUC context) to
--      the RLS-gated uploaded_files table. Resolves BLOCKER-01
--      (D-WORKER-RLS in 02-PLAN-CHECK.md).
--
-- Total policy count: 4 tables × 4 actions = 16 named per-action policies
-- + 3 storage.objects policies = 19 policies. The only FOR ALL policy is
-- profiles_td_all (TD-explicit on the profiles bucket — documented exception).

-- ============================================================================
-- Section 0: Defensive storage.buckets bootstrap (RESEARCH A6).
-- ============================================================================
-- Idempotent: ON CONFLICT (id) DO NOTHING means re-running this migration
-- (or running it against an environment where the bucket already exists)
-- is a no-op. public=false is mandatory — see T-02-05-STORAGE-PUBLIC-BUCKET
-- in the plan threat model and FILE-01 in CONTEXT.md (signed URLs only).

INSERT INTO storage.buckets (id, name, public)
VALUES ('profiles', 'profiles', false)
ON CONFLICT (id) DO NOTHING;
--> statement-breakpoint

-- ============================================================================
-- Section 1: ENABLE + FORCE RLS on the 4 new tables.
-- ============================================================================
-- FORCE is non-negotiable: without it, the `postgres` migration owner
-- bypasses every policy (even though the app connects as `app_user`,
-- the security posture must hold against compromised superuser access
-- too — CRIT-1 / T-02-05-FORCE-MISSING).

ALTER TABLE "players" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "players" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "trainers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "trainers" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "uploaded_files" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "uploaded_files" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "age_category_history" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "age_category_history" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- ============================================================================
-- Section 2: players RLS — per-action policies, never FOR ALL.
-- ============================================================================
-- SELECT: technical_director / medical_staff see all; everyone else via the
--         players_visible_to() SECURITY DEFINER function from Phase 1 (D-35).
-- INSERT: technical_director only (player creation is admin-driven).
-- UPDATE: TD always; academy_manager for players in scope (RLS narrows via
--         players_visible_to); player self; parent of self via
--         parent_child_links. The tRPC procedure restricts the column set,
--         not RLS — see D-37 in 02-CONTEXT.md.
-- DELETE: TD only (player deletion is a Phase 7 GDPR erasure concern).

CREATE POLICY "players_select" ON "players" FOR SELECT
  USING (
    current_user_role() IN ('technical_director', 'medical_staff')
    OR user_id IN (SELECT player_user_id FROM players_visible_to(current_user_id(), current_user_role()))
  );--> statement-breakpoint

CREATE POLICY "players_insert" ON "players" FOR INSERT
  WITH CHECK (current_user_role() = 'technical_director');--> statement-breakpoint

-- UPDATE must specify both USING and WITH CHECK. Without WITH CHECK an
-- attacker could update a row to move it OUT of scope and silently
-- succeed (T-02-05-RLS-MISSING-WITHCHECK).
CREATE POLICY "players_update" ON "players" FOR UPDATE
  USING (
    current_user_role() = 'technical_director'
    OR (
      current_user_role() = 'academy_manager'
      AND user_id IN (SELECT player_user_id FROM players_visible_to(current_user_id(), 'academy_manager'))
    )
    OR (current_user_role() = 'player' AND user_id = current_user_id())
    OR (
      current_user_role() = 'parent'
      AND user_id IN (
        SELECT child_user_id FROM parent_child_links WHERE parent_user_id = current_user_id()
      )
    )
  )
  WITH CHECK (
    current_user_role() = 'technical_director'
    OR (
      current_user_role() = 'academy_manager'
      AND user_id IN (SELECT player_user_id FROM players_visible_to(current_user_id(), 'academy_manager'))
    )
    OR (current_user_role() = 'player' AND user_id = current_user_id())
    OR (
      current_user_role() = 'parent'
      AND user_id IN (
        SELECT child_user_id FROM parent_child_links WHERE parent_user_id = current_user_id()
      )
    )
  );--> statement-breakpoint

CREATE POLICY "players_delete" ON "players" FOR DELETE
  USING (current_user_role() = 'technical_director');--> statement-breakpoint

-- ============================================================================
-- Section 3: trainers RLS — per-action policies.
-- ============================================================================
-- SELECT: TD/medical_staff all; trainer/academy_manager sees trainers
--         sharing at least one academy via academy_memberships JOIN; own row.
-- INSERT/DELETE: TD-only (trainer onboarding is admin-driven).
-- UPDATE: TD always; trainer editing own non-sensitive fields (D-38).

CREATE POLICY "trainers_select" ON "trainers" FOR SELECT
  USING (
    current_user_role() IN ('technical_director', 'medical_staff')
    OR user_id = current_user_id()
    OR user_id IN (
      -- Trainer/academy_manager sees trainers sharing at least one academy.
      -- ca = caller-academy rows; pa = peer-academy rows; same academy_code
      -- across rows means they overlap on at least one academy.
      SELECT pa.user_id FROM academy_memberships pa
      JOIN academy_memberships ca ON ca.academy_code = pa.academy_code
      WHERE ca.user_id = current_user_id()
        AND ca.role IN ('trainer', 'academy_manager')
        AND pa.role IN ('trainer', 'academy_manager')
        AND current_user_role() IN ('trainer', 'academy_manager')
    )
  );--> statement-breakpoint

CREATE POLICY "trainers_insert" ON "trainers" FOR INSERT
  WITH CHECK (current_user_role() = 'technical_director');--> statement-breakpoint

CREATE POLICY "trainers_update" ON "trainers" FOR UPDATE
  USING (
    current_user_role() = 'technical_director'
    OR (current_user_role() = 'trainer' AND user_id = current_user_id())
  )
  WITH CHECK (
    current_user_role() = 'technical_director'
    OR (current_user_role() = 'trainer' AND user_id = current_user_id())
  );--> statement-breakpoint

CREATE POLICY "trainers_delete" ON "trainers" FOR DELETE
  USING (current_user_role() = 'technical_director');--> statement-breakpoint

-- ============================================================================
-- Section 4: uploaded_files RLS — per-action policies.
-- ============================================================================
-- SELECT: TD/medical_staff see all; owner sees own files; users with player
--         scope see files owned by players in their scope (composes via
--         players_visible_to so trainers/academy_managers/parents see only
--         scope-appropriate files).
-- INSERT: any authenticated user (owner_user_id == current_user_id());
--         storage-key uniqueness + magic-bytes check at app layer.
-- UPDATE: owner OR TD. NOTE: worker scan-status updates do NOT use this
--         path — they call mark_scan_result(...) SECURITY DEFINER fn
--         declared in Section 7 below. See D-WORKER-RLS / BLOCKER-01.
-- DELETE: TD only (manual cleanup of orphaned uploads; user-driven delete
--         is out of scope until Phase 7 GDPR erasure).

CREATE POLICY "uploaded_files_select" ON "uploaded_files" FOR SELECT
  USING (
    current_user_role() IN ('technical_director', 'medical_staff')
    OR owner_user_id = current_user_id()
    OR owner_user_id IN (
      SELECT player_user_id FROM players_visible_to(current_user_id(), current_user_role())
    )
  );--> statement-breakpoint

CREATE POLICY "uploaded_files_insert" ON "uploaded_files" FOR INSERT
  WITH CHECK (owner_user_id = current_user_id());--> statement-breakpoint

CREATE POLICY "uploaded_files_update" ON "uploaded_files" FOR UPDATE
  USING (
    current_user_role() = 'technical_director'
    OR owner_user_id = current_user_id()
  )
  WITH CHECK (
    current_user_role() = 'technical_director'
    OR owner_user_id = current_user_id()
  );--> statement-breakpoint

CREATE POLICY "uploaded_files_delete" ON "uploaded_files" FOR DELETE
  USING (current_user_role() = 'technical_director');--> statement-breakpoint

-- ============================================================================
-- Section 5: age_category_history RLS — per-action policies.
-- ============================================================================
-- SELECT: same shape as players (history of a player visible to viewers
--         of that player). The column is `player_id` (FK to players.user_id),
--         passed through players_visible_to() as the player UUID.
-- INSERT / UPDATE / DELETE: TD only. Operationally the history is
--         append-only — we update effective_to via player.setAgeCategory
--         (D-32) which the TD initiates; DELETE allowed only as an
--         emergency-correction escape hatch for the TD.

CREATE POLICY "age_category_history_select" ON "age_category_history" FOR SELECT
  USING (
    current_user_role() IN ('technical_director', 'medical_staff')
    OR player_id IN (SELECT player_user_id FROM players_visible_to(current_user_id(), current_user_role()))
  );--> statement-breakpoint

CREATE POLICY "age_category_history_insert" ON "age_category_history" FOR INSERT
  WITH CHECK (current_user_role() = 'technical_director');--> statement-breakpoint

CREATE POLICY "age_category_history_update" ON "age_category_history" FOR UPDATE
  USING (current_user_role() = 'technical_director')
  WITH CHECK (current_user_role() = 'technical_director');--> statement-breakpoint

CREATE POLICY "age_category_history_delete" ON "age_category_history" FOR DELETE
  USING (current_user_role() = 'technical_director');--> statement-breakpoint

-- ============================================================================
-- Section 6: storage.objects policies for the `profiles` bucket.
-- ============================================================================
-- Pattern 6 in 02-RESEARCH.md — defense in depth. The service-role key used
-- by src/server/storage/client.ts (Plan 02-04) bypasses these policies for
-- all app-side operations. They exist because:
--   1. If the service-role key ever leaks, RLS still narrows damage.
--   2. If a future feature uses the anon key for direct browser uploads
--      (out of v1 scope), the policies are already in place.
--   3. Every access rule is visible in code — drift detection during
--      legal/security review.
--
-- Naming note: storage.foldername(name)[1] returns the first path segment
-- of the object name ('userId' in 'userId/uuid.ext'). Cast current_user_id()
-- to text because the path segment is text but the UUID column is uuid.
--
-- IMPORTANT: storage RLS evaluates `auth.jwt()->>'sub'` by default in
-- Supabase, but we use Better Auth (not Supabase Auth), so auth.jwt() is
-- empty. The policies below use current_user_id() — they only work if the
-- caller has set the `app.user_id` GUC. For the service-role-key path used
-- by the app this is irrelevant (RLS bypassed). For any future anon-key
-- path we would need to wire the GUC into the storage request. Documented
-- in RESEARCH §Pattern 6 footnote.

CREATE POLICY "profiles_owner_read" ON storage.objects FOR SELECT
  USING (
    bucket_id = 'profiles'
    AND (storage.foldername(name))[1] = current_user_id()::text
  );--> statement-breakpoint

CREATE POLICY "profiles_owner_write" ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'profiles'
    AND (storage.foldername(name))[1] = current_user_id()::text
  );--> statement-breakpoint

-- The single FOR ALL policy in this migration — TD-explicit override on the
-- profiles bucket only. Documented as an exception to the per-action
-- discipline (T-02-05-FOR-ALL-POLICY in the threat model).
CREATE POLICY "profiles_td_all" ON storage.objects FOR ALL
  USING (bucket_id = 'profiles' AND current_user_role() = 'technical_director')
  WITH CHECK (bucket_id = 'profiles' AND current_user_role() = 'technical_director');--> statement-breakpoint

-- ============================================================================
-- Section 7: mark_scan_result() SECURITY DEFINER bridge for the BullMQ worker.
-- ============================================================================
-- Decision D-WORKER-RLS (see 02-PLAN-CHECK.md / BLOCKER-01 resolution).
--
-- Problem: the malware-scan worker (plan 02-06) runs OUTSIDE the tRPC
-- `withRlsContext` middleware. No `app.user_id` / `app.user_role` GUCs are
-- set. A direct `UPDATE uploaded_files SET scan_status = …` from `app_user`
-- would not match any branch of uploaded_files_update (owner_user_id !=
-- current_user_id() because current_user_id() is NULL; role != 'technical_director'
-- because current_user_role() is NULL). Result: 0 rows updated, every scan
-- stays pending forever.
--
-- Solution: SECURITY DEFINER function that runs as the function owner
-- (postgres / supabase_admin), bypassing RLS for this single controlled path.
--
-- Constraints (defense in depth — see T-02-05-MARK-SCAN-OVERREACH and
-- T-02-05-MARK-SCAN-IDEMPOTENCY in the threat model):
--   1. Status whitelist — only the two terminal worker outcomes ('clean'
--      or 'infected'). 'error' / 'timeout' are NOT terminal — the worker
--      re-throws and BullMQ retries up to 3× per defaultJobOptions; after
--      exhaustion the row stays at 'pending' for operator review (Phase 8
--      cron sweep).
--   2. Optimistic concurrency: only flips rows still at `scan_status='pending'`
--      — re-running a job is a no-op (returns FALSE), and a previously-clean
--      row cannot be downgraded to infected (T-02-05-MARK-SCAN-IDEMPOTENCY).
--   3. SET search_path = pg_catalog, public — pinned to prevent search_path
--      hijacking by a malicious schema in the caller's session. Mandatory
--      on every SECURITY DEFINER function (Phase 1 convention).
--   4. EXECUTE granted to `app_user` ONLY — anon/authenticated cannot call
--      it. REVOKE FROM PUBLIC explicitly.
--   5. RETURNS BOOLEAN so the worker can detect 0-row updates and log them
--      at WARN level (a worker that gets FALSE knows the row was already
--      terminal — useful for de-duplication detection across job retries).
--
-- The CHECK constraint `uploaded_files_scan_status_enum` on the table
-- already restricts scan_status to ('pending', 'clean', 'infected') — the
-- whitelist below is a belt-and-braces second layer that also produces
-- a friendlier error than the constraint violation.

CREATE OR REPLACE FUNCTION mark_scan_result(
  p_file_id     UUID,
  p_status      TEXT,
  p_sha256      TEXT,
  p_scanned_at  TIMESTAMPTZ
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_updated INTEGER;
BEGIN
  IF p_status NOT IN ('clean', 'infected') THEN
    RAISE EXCEPTION 'mark_scan_result: invalid status %', p_status
      USING ERRCODE = '22023';  -- invalid_parameter_value
  END IF;

  UPDATE uploaded_files
    SET scan_status        = p_status,
        sha256             = COALESCE(p_sha256, sha256),
        scan_completed_at  = p_scanned_at,
        updated_at         = now()
    WHERE id = p_file_id
      AND scan_status = 'pending';

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION mark_scan_result(UUID, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION mark_scan_result(UUID, TEXT, TEXT, TIMESTAMPTZ) TO app_user;--> statement-breakpoint

COMMENT ON FUNCTION mark_scan_result(UUID, TEXT, TEXT, TIMESTAMPTZ) IS
  'Worker-only path to flip uploaded_files.scan_status. Bypasses the row-level uploaded_files_update policy via SECURITY DEFINER. See plan 02-05 Section 7 / Decision D-WORKER-RLS.';--> statement-breakpoint
