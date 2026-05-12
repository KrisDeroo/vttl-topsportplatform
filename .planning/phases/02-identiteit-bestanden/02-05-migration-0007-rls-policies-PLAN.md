---
phase: 02-identiteit-bestanden
plan_id: 02-05-migration-0007-rls-policies
plan: 05
type: execute
wave: 3
depends_on: [02-03-migration-0006-additive]
files_modified:
  - drizzle/0007_phase2_rls_policies.sql
  - drizzle/0007_phase2_rls_policies.rollback.md
  - drizzle/meta/_journal.json
  - drizzle/meta/0007_snapshot.json
  - src/server/auth/permissions.ts
autonomous: true
requirements:
  - USER-04
  - PLAYER-05
  - PLAYER-07
  - FILE-03
  - MIG-01
  - MIG-05

must_haves:
  truths:
    - "RLS ENABLED + FORCED on players, trainers, uploaded_files, age_category_history (4 new tables)"
    - "Per-action RLS policies (SELECT / INSERT / UPDATE / DELETE) exist on each table — never a bare FOR ALL"
    - "Player read policy uses Phase 1 `players_visible_to(current_user_id(), current_user_role())` helper (D-35)"
    - "Trainer read policy uses `academy_memberships` JOIN (trainer sees trainers in same academy)"
    - "Storage objects RLS policy declared for `profiles/` bucket (own-folder + TD-all) (Pattern 6)"
    - "Defensively `INSERT INTO storage.buckets ... profiles` runs idempotently (A6 fallback per RESEARCH)"
    - "SECURITY DEFINER function `mark_scan_result(file_id, status, sha256, scanned_at)` lets the BullMQ worker flip `scan_status` on pending rows without RLS context (Decision D-WORKER-RLS)"
    - "`src/server/auth/permissions.ts` ROLE_PERMISSIONS extended with `players.{read,write,update_self}`, `trainers.{read,write,update_self}`, `files.{upload,read}`"
    - "Rollback companion present with **Risk:** / **Procedure:** / **Verification:** markers"
  artifacts:
    - path: "drizzle/0007_phase2_rls_policies.sql"
      provides: "RLS policies + storage bucket bootstrap + ENABLE/FORCE statements"
      contains: "ALTER TABLE \"players\" ENABLE ROW LEVEL SECURITY"
      min_lines: 120
    - path: "drizzle/0007_phase2_rls_policies.rollback.md"
      provides: "rollback procedure"
      contains: "**Procedure:**"
    - path: "src/server/auth/permissions.ts"
      provides: "extended ROLE_PERMISSIONS matrix"
      contains: "players.read_assigned"
  key_links:
    - from: "drizzle/0007_phase2_rls_policies.sql"
      to: "drizzle/0002_rls_functions_and_policies.sql (players_visible_to)"
      via: "Phase 2 policies CALL the Phase 1 SECURITY DEFINER function"
      pattern: "players_visible_to\\("
    - from: "drizzle/0007_phase2_rls_policies.sql"
      to: "storage.objects (Supabase managed)"
      via: "CREATE POLICY ... ON storage.objects"
      pattern: "ON storage\\.objects"
---

<objective>
Generate the second Phase 2 migration: enable + force RLS on all 4 new tables, declare per-action policies, bootstrap the `profiles/` storage bucket defensively, and write storage.objects RLS as defense-in-depth (even though Phase 2 app code uses the service-role key which bypasses storage RLS — Pattern 6).

Also extend the `ROLE_PERMISSIONS` matrix in `src/server/auth/permissions.ts` to include the new resource codes (`players.*`, `trainers.*`, `files.*`) so tRPC routers in 02-09/10 can call `assertPermission(role, perm)` consistently with Phase 1.

This is **hand-authored SQL** (not Drizzle Kit auto-generated) because `drizzle-kit generate` does not emit RLS policy DDL — RLS is outside Drizzle's schema introspection. The migration file lives in the same `drizzle/` directory under the same MIG-01 immutability discipline.

Output: 1 SQL migration (hand-authored), 1 rollback companion, 1 permissions matrix patch.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/phases/02-identiteit-bestanden/02-CONTEXT.md
@.planning/phases/02-identiteit-bestanden/02-RESEARCH.md
@drizzle/0002_rls_functions_and_policies.sql
@drizzle/0001_medical_isolated.sql
@drizzle/0001_medical_isolated.rollback.md
@src/server/auth/permissions.ts
@CLAUDE.md

<interfaces>
<!-- Phase 1 RLS primitives that Phase 2 reuses (from drizzle/0002_rls_functions_and_policies.sql) -->

```sql
-- Phase 1 SQL function (DO NOT redefine — call directly):
CREATE FUNCTION current_user_id() RETURNS UUID LANGUAGE SQL STABLE;
CREATE FUNCTION current_user_role() RETURNS TEXT LANGUAGE SQL STABLE;
CREATE FUNCTION players_visible_to(caller_id UUID, caller_role TEXT)
  RETURNS TABLE(player_user_id UUID) LANGUAGE SQL STABLE SECURITY DEFINER;
-- The trainer/academy_manager branch is already implemented at lines 109-116 of 0002:
--   SELECT pa.user_id FROM academy_memberships pa JOIN academy_memberships ca
--   ON ca.academy_code = pa.academy_code WHERE ca.user_id = caller_id
--   AND ca.role IN ('trainer', 'academy_manager') AND pa.role = 'player'
--   AND caller_role IN ('trainer', 'academy_manager')
-- ✅ Phase 2 just CALLS this function from new policies — no need to re-implement.
```

```typescript
// Phase 1 src/server/auth/permissions.ts — current Permission union (truncated):
type Permission =
  | 'user.create' | 'user.activate' | 'user.deactivate' | 'user.assign_role'
  | 'user.link_parent' | 'user.link_academy'
  | 'consent.give_self' | 'consent.give_for_minor' | 'consent.withdraw_self'
  | 'consent.read_own' | 'consent.read_any'
  | 'medical.read_own' | 'medical.read_assigned' | 'medical.read_any'
  | 'medical.write' | 'medical.read_traffic_light'
  | 'audit.read_any' | 'audit.read_self_actions' | 'lookup.write';
// Phase 2 EXTENDS this union — see Task 3.
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="false">
  <name>Task 1: Hand-author drizzle/0007_phase2_rls_policies.sql</name>
  <read_first>
    - drizzle/0002_rls_functions_and_policies.sql (entire file — pattern for per-action RLS, ENABLE+FORCE, SECURITY DEFINER fn usage; pay attention to lines 109-116 trainer branch and lines 195+ policy examples)
    - drizzle/0001_medical_isolated.sql (medical RLS example with USING + WITH CHECK clauses)
    - .planning/phases/02-identiteit-bestanden/02-RESEARCH.md §Pattern 6 (storage.objects policies)
    - .planning/phases/02-identiteit-bestanden/02-CONTEXT.md D-35, D-36, D-37, D-38
  </read_first>
  <files>
    drizzle/0007_phase2_rls_policies.sql
    drizzle/meta/_journal.json
    drizzle/meta/0007_snapshot.json
  </files>
  <action>
    Create `drizzle/0007_phase2_rls_policies.sql` (hand-authored — drizzle-kit does NOT manage RLS DDL).

    **Section 1 — ENABLE + FORCE RLS on every new table.** ENABLE alone is insufficient because table-owner roles bypass RLS; FORCE applies it even to the owner (Phase 1 convention — line 195 of 0002 has the same pattern).

    ```sql
    -- Migration 0007_phase2_rls_policies.sql — Phase 2 Wave 2.
    -- RLS for the 4 Phase 2 tables + storage.objects (profiles bucket).
    -- Hand-authored: drizzle-kit does not manage RLS policy DDL.
    -- Order: bucket bootstrap → ENABLE/FORCE → policies per action.

    -- ─── Section 0: defensive storage.buckets bootstrap (RESEARCH A6) ───
    INSERT INTO storage.buckets (id, name, public)
    VALUES ('profiles', 'profiles', false)
    ON CONFLICT (id) DO NOTHING;
    --> statement-breakpoint

    -- ─── Section 1: ENABLE + FORCE RLS ───
    ALTER TABLE "players" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
    ALTER TABLE "players" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
    ALTER TABLE "trainers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
    ALTER TABLE "trainers" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
    ALTER TABLE "uploaded_files" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
    ALTER TABLE "uploaded_files" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
    ALTER TABLE "age_category_history" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
    ALTER TABLE "age_category_history" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
    ```

    **Section 2 — `players` policies (per-action, never FOR ALL).** TD/medical_staff full; trainer/academy_manager via `players_visible_to`; player self; parent of self via `parent_child_links`.

    ```sql
    -- ─── Section 2: players RLS ───

    -- SELECT: TD/medical_staff see all; everyone else via players_visible_to.
    CREATE POLICY "players_select" ON "players" FOR SELECT
      USING (
        current_user_role() IN ('technical_director', 'medical_staff')
        OR user_id IN (SELECT player_user_id FROM players_visible_to(current_user_id(), current_user_role()))
      );--> statement-breakpoint

    -- INSERT: TD-only (player.create runs as TD).
    CREATE POLICY "players_insert" ON "players" FOR INSERT
      WITH CHECK (current_user_role() = 'technical_director');--> statement-breakpoint

    -- UPDATE: TD always; academy_manager for players in scope; player updating self
    --         (the tRPC procedure restricts the column set, not RLS — see D-37).
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
        -- Same predicate as USING — UPDATE must not move a row into out-of-scope state.
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

    -- DELETE: TD-only (player deletion is not exposed in Phase 2 UI — it ships
    --         in Phase 7 GDPR erasure — but the policy still requires TD).
    CREATE POLICY "players_delete" ON "players" FOR DELETE
      USING (current_user_role() = 'technical_director');--> statement-breakpoint
    ```

    **Section 3 — `trainers` policies.** SELECT: TD/medical_staff all; trainer/academy_manager see trainers in same academy; trainer self. INSERT/UPDATE/DELETE: TD-only except UPDATE-self.

    ```sql
    -- ─── Section 3: trainers RLS ───

    CREATE POLICY "trainers_select" ON "trainers" FOR SELECT
      USING (
        current_user_role() IN ('technical_director', 'medical_staff')
        OR user_id = current_user_id()  -- trainer/academy_manager sees own profile
        OR user_id IN (
          -- Trainer/academy_manager sees trainers sharing at least one academy.
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
    ```

    **Section 4 — `uploaded_files` policies.** SELECT: TD all; owner_user_id self; trainers/academy_managers/parents see files owned by users they have scope on (composes via `players_visible_to` if the file belongs to a player). INSERT: any authenticated (owner == current_user_id). UPDATE: SECURITY DEFINER worker process writes scan_status (run as `app_user` — RLS won't bite because the worker uses the service-role-key short-circuit; defensive policy declared so app_user works too). DELETE: TD-only.

    ```sql
    -- ─── Section 4: uploaded_files RLS ───

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

    -- UPDATE: owner OR TD. (Worker scan-status updates do NOT use this path —
    --        they call `mark_scan_result(...)` SECURITY DEFINER fn declared below.
    --        See Decision D-WORKER-RLS in 02-PLAN-CHECK.md.)
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
    ```

    **Section 5 — `age_category_history` policies.** SELECT: same as `players` (history of a player visible to viewers of that player). INSERT/UPDATE: TD-only (driven by `player.setAgeCategory`). DELETE: blocked entirely (history is append-only — operationally we update `effective_to` instead of deleting; allow TD for emergency correction).

    ```sql
    -- ─── Section 5: age_category_history RLS ───

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
    ```

    **Section 6 — storage.objects policies for `profiles` bucket** (Pattern 6 — defense in depth since app uses service-role key).

    ```sql
    -- ─── Section 6: storage.objects RLS (profiles bucket) ───
    -- These policies are best-effort defense-in-depth. The service-role key
    -- used by src/server/storage/client.ts (Plan 02-04) bypasses these — but
    -- if the anon key ever reaches the browser (out of v1 scope), or a future
    -- worker uses an anon connection, these policies narrow the blast radius.
    --
    -- Naming note: storage.foldername(name)[1] returns the first path segment
    -- of `name` ('userId' part of 'userId/uuid.ext'). Cast to text for compare
    -- with current_user_id() (UUID → text).

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

    CREATE POLICY "profiles_td_all" ON storage.objects FOR ALL
      USING (bucket_id = 'profiles' AND current_user_role() = 'technical_director')
      WITH CHECK (bucket_id = 'profiles' AND current_user_role() = 'technical_director');--> statement-breakpoint
    ```

    **Section 7 — SECURITY DEFINER function `mark_scan_result()` for BullMQ worker** (Decision D-WORKER-RLS — resolves BLOCKER-01 in 02-PLAN-CHECK.md).

    The malware-scan worker (plan 02-06) runs OUTSIDE the tRPC `withRlsContext` middleware: no `app.user_id` / `app.user_role` GUCs are set. A direct `UPDATE uploaded_files SET scan_status = …` from `app_user` would match no RLS policy clause → 0 rows updated → every scan stays `pending` forever. The chosen architectural fix (D-WORKER-RLS, see 02-PLAN-CHECK.md) is a SECURITY DEFINER function callable by `app_user`:

    ```sql
    -- ─── Section 7: mark_scan_result() — bridges worker → RLS-gated table ───
    -- SECURITY DEFINER runs as the function-owner role (postgres / supabase_admin
    -- in Supabase). It is the canonical pattern Phase 1 already uses for
    -- `players_visible_to(...)` and is allowlisted by ROADMAP §RISK-RLS-PERF.
    --
    -- Constraints (defense in depth):
    --   1. Status whitelist (only the 3 valid worker outcomes).
    --   2. Optimistic concurrency: only flips rows still at `pending`
    --      (idempotent — re-running a job is a no-op, returns FALSE).
    --   3. `search_path = pg_catalog, public` — pinned to prevent search_path
    --      hijacking by a malicious schema in the caller's session.
    --   4. EXECUTE granted to `app_user` ONLY — anon/authenticated cannot call it.
    --   5. RETURNS BOOLEAN so the worker can detect 0-row updates and log them.

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
        -- 'error' / 'timeout' are NOT terminal: worker re-throws and BullMQ
        -- retries up to 3× per defaultJobOptions. After exhaustion the row
        -- stays at 'pending' for operator review (Phase 8 cron sweep).
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
    ```

    Then run `npx drizzle-kit generate --name=phase2_rls_policies` to register the file in the journal — Drizzle accepts hand-authored SQL files as long as filename pattern `NNNN_*.sql` matches; the journal updater will pick it up. If Drizzle Kit refuses (because no schema change was detected via TS), manually add the journal entry following the structure of idx 5:

    ```bash
    # If drizzle-kit didn't update the journal, append manually using node:
    node -e '
    const fs = require("fs");
    const journal = JSON.parse(fs.readFileSync("drizzle/meta/_journal.json","utf-8"));
    const next = journal.entries[journal.entries.length - 1].idx + 1;
    journal.entries.push({
      idx: next,
      version: journal.entries[0].version,
      when: Date.now(),
      tag: "0007_phase2_rls_policies",
      breakpoints: true
    });
    fs.writeFileSync("drizzle/meta/_journal.json", JSON.stringify(journal, null, 2));
    '
    ```

    Also produce a stub `drizzle/meta/0007_snapshot.json` by copying `drizzle/meta/0006_snapshot.json` (no schema diff — RLS is not in the snapshot).

    Do NOT use `FOR ALL` policies on any table (per-action policies are mandatory — per CONTEXT.md threat model requirement "missing per-action policy split").
    Do NOT skip the `WITH CHECK` clause on UPDATE policies (otherwise an attacker could update a row to move it out of scope).
    Do NOT alter any Phase 1 RLS policy or function — Phase 2 is purely additive.
  </action>
  <verify>
    <automated>test -f drizzle/0007_phase2_rls_policies.sql && grep -c "ENABLE ROW LEVEL SECURITY" drizzle/0007_phase2_rls_policies.sql | grep -qE "^[4-9]" && grep -c "FORCE ROW LEVEL SECURITY" drizzle/0007_phase2_rls_policies.sql | grep -qE "^[4-9]" && grep -q "players_visible_to(current_user_id()" drizzle/0007_phase2_rls_policies.sql && grep -q "CREATE POLICY \"players_select\"" drizzle/0007_phase2_rls_policies.sql && grep -q "CREATE POLICY \"players_insert\"" drizzle/0007_phase2_rls_policies.sql && grep -q "CREATE POLICY \"players_update\"" drizzle/0007_phase2_rls_policies.sql && grep -q "CREATE POLICY \"players_delete\"" drizzle/0007_phase2_rls_policies.sql && grep -q "CREATE POLICY \"uploaded_files_select\"" drizzle/0007_phase2_rls_policies.sql && grep -q "CREATE POLICY \"profiles_owner_read\"" drizzle/0007_phase2_rls_policies.sql && grep -q "storage.foldername" drizzle/0007_phase2_rls_policies.sql && grep -q "storage.buckets" drizzle/0007_phase2_rls_policies.sql && ! grep -E "CREATE POLICY [^ ]+ ON [^ ]+ FOR ALL " drizzle/0007_phase2_rls_policies.sql | grep -v "profiles_td_all" && grep -q "CREATE OR REPLACE FUNCTION mark_scan_result" drizzle/0007_phase2_rls_policies.sql && grep -q "SECURITY DEFINER" drizzle/0007_phase2_rls_policies.sql && grep -q "GRANT EXECUTE ON FUNCTION mark_scan_result" drizzle/0007_phase2_rls_policies.sql && grep -q "0007_phase2_rls_policies" drizzle/meta/_journal.json</automated>
  </verify>
  <acceptance_criteria>
    - 4 ENABLE + 4 FORCE statements for the new tables
    - 4 tables × 4 actions (SELECT/INSERT/UPDATE/DELETE) = 16 named policies + 3 storage.objects policies = 19 policies total
    - `mark_scan_result(UUID, TEXT, TEXT, TIMESTAMPTZ)` SECURITY DEFINER function exists with EXECUTE granted to `app_user` and revoked from PUBLIC
    - `mark_scan_result` raises on invalid status, only updates rows still at `scan_status='pending'`, returns boolean
    - `mark_scan_result` has `SET search_path = pg_catalog, public` pinned
    - Every UPDATE policy has BOTH `USING` and `WITH CHECK`
    - Only `profiles_td_all` uses `FOR ALL` (TD can do everything on profiles bucket — explicit exception)
    - Storage bucket bootstrap is idempotent (`ON CONFLICT (id) DO NOTHING`)
    - Migration registered in `drizzle/meta/_journal.json` as idx 7 (Phase 1 ended at idx 5; 0006 = idx 6; this plan's 0007 = idx 7)
    - `grep -v '^--' drizzle/0007_phase2_rls_policies.sql | grep -Ec "DROP POLICY|DROP TABLE"` returns 0 (no destructive changes)
  </acceptance_criteria>
  <done>RLS DDL ready for push in 02-14.</done>
</task>

<task type="auto" tdd="false">
  <name>Task 2: Write rollback companion 0007_phase2_rls_policies.rollback.md</name>
  <read_first>
    - drizzle/0002_rls_functions_and_policies.rollback.md (Phase 1 RLS rollback example)
    - tests/unit/migration-format.test.ts (canonical markers required)
  </read_first>
  <files>
    drizzle/0007_phase2_rls_policies.rollback.md
  </files>
  <action>
    ```markdown
    # Rollback — 0007_phase2_rls_policies

    **Risk:** Medium. Disabling RLS on `players`, `trainers`, `uploaded_files`, `age_category_history` removes the database-level enforcement of role-based scope. The application layer in 02-09/10 still enforces scope through tRPC + `protectedProcedure`/`tdProcedure`/`withRlsContext`, so app-mediated requests remain gated. The exposure is direct-DB queries (psql, leaked credentials, migration tools): a wrong-scope caller could read out-of-scope rows. For Phase 2 dev/staging this is acceptable during a rollback window; production rollback should be paired with rotating the `app_user` password to prevent direct-DB use during the gap. Storage bucket policies revert similarly.

    **Procedure:**
    1. Confirm Phase 2 application code is OFFLINE (web service deactivated in Coolify) before disabling RLS. Otherwise live requests will see unbounded data.
    2. Connect via `DIRECT_DATABASE_URL` and run:

       ```sql
       BEGIN;

       -- Worker SECURITY DEFINER function first (no dependencies — drop early).
       REVOKE EXECUTE ON FUNCTION mark_scan_result(UUID, TEXT, TEXT, TIMESTAMPTZ) FROM app_user;
       DROP FUNCTION IF EXISTS mark_scan_result(UUID, TEXT, TEXT, TIMESTAMPTZ);

       -- Storage policies (independent of the new tables).
       DROP POLICY IF EXISTS "profiles_owner_read" ON storage.objects;
       DROP POLICY IF EXISTS "profiles_owner_write" ON storage.objects;
       DROP POLICY IF EXISTS "profiles_td_all" ON storage.objects;

       -- Table policies (idempotent).
       DROP POLICY IF EXISTS "age_category_history_select" ON "age_category_history";
       DROP POLICY IF EXISTS "age_category_history_insert" ON "age_category_history";
       DROP POLICY IF EXISTS "age_category_history_update" ON "age_category_history";
       DROP POLICY IF EXISTS "age_category_history_delete" ON "age_category_history";

       DROP POLICY IF EXISTS "uploaded_files_select" ON "uploaded_files";
       DROP POLICY IF EXISTS "uploaded_files_insert" ON "uploaded_files";
       DROP POLICY IF EXISTS "uploaded_files_update" ON "uploaded_files";
       DROP POLICY IF EXISTS "uploaded_files_delete" ON "uploaded_files";

       DROP POLICY IF EXISTS "trainers_select" ON "trainers";
       DROP POLICY IF EXISTS "trainers_insert" ON "trainers";
       DROP POLICY IF EXISTS "trainers_update" ON "trainers";
       DROP POLICY IF EXISTS "trainers_delete" ON "trainers";

       DROP POLICY IF EXISTS "players_select" ON "players";
       DROP POLICY IF EXISTS "players_insert" ON "players";
       DROP POLICY IF EXISTS "players_update" ON "players";
       DROP POLICY IF EXISTS "players_delete" ON "players";

       -- Disable FORCE then RLS (mirror the apply order).
       ALTER TABLE "age_category_history" NO FORCE ROW LEVEL SECURITY;
       ALTER TABLE "age_category_history" DISABLE ROW LEVEL SECURITY;
       ALTER TABLE "uploaded_files" NO FORCE ROW LEVEL SECURITY;
       ALTER TABLE "uploaded_files" DISABLE ROW LEVEL SECURITY;
       ALTER TABLE "trainers" NO FORCE ROW LEVEL SECURITY;
       ALTER TABLE "trainers" DISABLE ROW LEVEL SECURITY;
       ALTER TABLE "players" NO FORCE ROW LEVEL SECURITY;
       ALTER TABLE "players" DISABLE ROW LEVEL SECURITY;

       -- Leave the profiles bucket row in place (DROPping it would orphan any
       -- existing files). The bucket survives — it is harmless without policies.

       COMMIT;
       ```

    3. Update `drizzle/meta/_journal.json` to remove the `idx 7` entry (tag `0007_phase2_rls_policies`) and delete `drizzle/meta/0007_snapshot.json`.
    4. `git revert` the commit that introduced 0007.

    **Verification:**
    1. `psql "$DIRECT_DATABASE_URL" -c "SELECT polname FROM pg_policy WHERE polname LIKE 'players_%' OR polname LIKE 'trainers_%' OR polname LIKE 'uploaded_files_%' OR polname LIKE 'age_category_history_%' OR polname LIKE 'profiles_%'"` returns 0 rows.
    2. `psql "$DIRECT_DATABASE_URL" -c "SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname IN ('players','trainers','uploaded_files','age_category_history')"` returns `f, f` for all 4.
    3. `psql "$DIRECT_DATABASE_URL" -c "SELECT id FROM storage.buckets WHERE id='profiles'"` returns 1 row (bucket survives).

    ## When to roll back

    Apply this rollback only if RLS policy semantics are wrong (e.g., over-blocking TD reads after a production cutover). Wrong-direction policy errors (under-blocking) should be fixed with a new migration that ALTERs the policy (per MIG-01), not by rolling back.

    ## Background

    The 19 policies + storage bootstrap were split into a separate migration from the schema (0006) so a defective policy can be reverted without dropping the underlying data-bearing tables. RLS-related debugging is also faster against an isolated, named migration.
    ```
  </action>
  <verify>
    <automated>test -f drizzle/0007_phase2_rls_policies.rollback.md && grep -q "^\*\*Risk:\*\*" drizzle/0007_phase2_rls_policies.rollback.md && grep -q "^\*\*Procedure:\*\*" drizzle/0007_phase2_rls_policies.rollback.md && grep -q "^\*\*Verification:\*\*" drizzle/0007_phase2_rls_policies.rollback.md && pnpm test -- migration-format 2>&1 | tail -5 | grep -qE "pass|PASS"</automated>
  </verify>
  <acceptance_criteria>
    - Canonical markers present (3× `**...**`)
    - Rollback SQL drops policies in reverse-creation order
    - `pnpm test -- migration-format` passes
  </acceptance_criteria>
  <done>Reversible RLS migration committed-ready.</done>
</task>

<task type="auto" tdd="false">
  <name>Task 3: Extend src/server/auth/permissions.ts ROLE_PERMISSIONS</name>
  <read_first>
    - src/server/auth/permissions.ts (entire file — preserve current Permission union shape)
    - .planning/phases/02-identiteit-bestanden/02-CONTEXT.md D-37, D-38 (permission matrix)
  </read_first>
  <files>
    src/server/auth/permissions.ts
  </files>
  <action>
    Extend (do NOT replace) the `Permission` union and `ROLE_PERMISSIONS` matrix.

    Add these Permission codes:

    ```typescript
    // Append to the Permission type union (alphabetical-ish within the file):
    | 'players.read_any'         // TD, medical_staff
    | 'players.read_assigned'    // trainer, academy_manager, parent
    | 'players.read_own'         // player (self)
    | 'players.write'            // TD only (create/delete)
    | 'players.update_any'       // TD, academy_manager (in scope — RLS filters)
    | 'players.update_self'      // player editing own non-sensitive fields (D-37)
    | 'players.set_age_category' // TD only (D-32)
    | 'trainers.read_any'        // TD, medical_staff
    | 'trainers.read_assigned'   // trainer, academy_manager in same academy
    | 'trainers.read_own'        // trainer (self)
    | 'trainers.write'           // TD only (create/delete)
    | 'trainers.update_self'     // trainer editing own non-sensitive fields (D-38)
    | 'files.upload'             // any authenticated user (own files)
    | 'files.read_any'           // TD
    | 'files.read_own'           // owner of the file
    | 'files.delete_any'         // TD only
    ```

    Extend `ROLE_PERMISSIONS` entries (append within each role's array — preserve existing entries):

    ```typescript
    technical_director: [
      // ... existing 13 entries ...
      'players.read_any', 'players.write', 'players.update_any', 'players.set_age_category',
      'trainers.read_any', 'trainers.write',
      'files.upload', 'files.read_any', 'files.read_own', 'files.delete_any',
    ],
    academy_manager: [
      // ... existing 4 entries ...
      'players.read_assigned', 'players.update_any',  // RLS narrows the "any" to in-scope
      'trainers.read_assigned',
      'files.upload', 'files.read_own',
    ],
    trainer: [
      // ... existing 5 entries ...
      'players.read_assigned',                        // read-only (D-37 — trainers cannot edit)
      'trainers.read_assigned', 'trainers.read_own', 'trainers.update_self',
      'files.upload', 'files.read_own',
    ],
    player: [
      // ... existing 4 entries ...
      'players.read_own', 'players.update_self',
      'files.upload', 'files.read_own',
    ],
    parent: [
      // ... existing 5 entries ...
      'players.read_assigned', 'players.update_self',  // RLS scopes to child via parent_child_links
      'files.upload', 'files.read_own',
    ],
    sparring_partner: [
      // ... existing 3 entries ...
      // Phase 2: sparring partners do NOT have player/trainer scope (Phase 5 sparring_partner role takes shape there)
      'files.read_own',
    ],
    medical_staff: [
      // ... existing 5 entries ...
      'players.read_any',  // medical staff need patient context
      'trainers.read_any',
      'files.read_any',    // medical staff read evaluation/medical files (Phase 5)
    ],
    ```

    Update the JSDoc header — add bullet under "Mapping to D-11 RBAC matrix":

    ```
     *   resource `players`:              players.read_{own,assigned,any} + write + update_*
     *   resource `trainers`:             trainers.read_{own,assigned,any} + write + update_self
     *   resource `uploaded_files`:       files.upload + read_{own,any} + delete_any
    ```

    Do NOT remove any existing entry from `ROLE_PERMISSIONS` (the exhaustive `Record<Role, Permission[]>` shape would still compile, but removing breaks Phase 1 callers).
  </action>
  <verify>
    <automated>grep -c "'players\." src/server/auth/permissions.ts | grep -qE "^[7-9]|^[0-9]{2,}" && grep -c "'trainers\." src/server/auth/permissions.ts | grep -qE "^[5-9]|^[0-9]{2,}" && grep -c "'files\." src/server/auth/permissions.ts | grep -qE "^[4-9]|^[0-9]{2,}" && grep -q "players.set_age_category" src/server/auth/permissions.ts && grep -q "files.delete_any" src/server/auth/permissions.ts && npx tsc --noEmit 2>&1 | (! grep -i "error.*permissions\.ts")</automated>
  </verify>
  <acceptance_criteria>
    - All 16 new Permission codes added to the union
    - Every Role's array extended (compile-time exhaustive Record check still passes)
    - `npx tsc --noEmit` exits 0
    - Phase 1 callers (`tests/integration/rbac-matrix.test.ts`) still type-check
  </acceptance_criteria>
  <done>Permission matrix ready for Phase 2 router-level `hasPermission(role, perm)` checks.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| RLS policy ↔ application code | RLS is defense-in-depth; tRPC procedures are first-line gate; both must agree |
| storage.objects ↔ service-role key | Service-role bypasses these — they exist for future browser-direct paths |
| Permission matrix ↔ tRPC procedure presets | `hasPermission()` predicate consumed by 02-09 router gating |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-02-05-ENUM-VIA-403 | Information Disclosure | Out-of-scope `player.get` returning 403 reveals existence (D-36) | mitigate | RLS filters rows → 0 rows → tRPC returns NOT_FOUND (404); UI empty-state copy identical to "no players in scope" |
| T-02-05-RLS-MISSING-WITHCHECK | Tampering | UPDATE without WITH CHECK lets attacker move row out of scope | mitigate | Every UPDATE policy has matching USING + WITH CHECK; verify grep returns 4 (one per table) |
| T-02-05-FOR-ALL-POLICY | Information Disclosure | A blanket FOR ALL policy short-circuits per-action checks | mitigate | Only `profiles_td_all` uses FOR ALL (TD-explicit); all 16 other policies are per-action |
| T-02-05-STORAGE-PUBLIC-BUCKET | Information Disclosure | If `profiles` bucket was public, signed URLs would be redundant | mitigate | `INSERT INTO storage.buckets ... public=false` is the bootstrap; documented in 02-05 + 02-16 |
| T-02-05-FORCE-MISSING | Elevation of Privilege | RLS skipped for table owner | mitigate | FORCE on all 4 tables (4 ALTER statements verified) |
| T-02-05-MARK-SCAN-OVERREACH | Elevation of Privilege | `mark_scan_result` SECURITY DEFINER bypasses RLS; if exposed to wrong role, attacker could mark infected file `clean` | mitigate | Status whitelist + `WHERE scan_status='pending'` (cannot re-flip a `clean` row); EXECUTE granted to `app_user` only; REVOKE from PUBLIC; pinned `search_path` |
| T-02-05-MARK-SCAN-IDEMPOTENCY | Tampering | Re-running a worker job could overwrite a final state | mitigate | `WHERE scan_status='pending'` makes the UPDATE a no-op on already-completed rows; RETURNS BOOLEAN tells worker whether the flip happened |
</threat_model>

<verification>
- 16 + 3 = 19 named policies declared
- Every UPDATE policy has both USING and WITH CHECK
- `players_visible_to()` called from `players_select`, `uploaded_files_select`, `age_category_history_select`
- `academy_memberships` JOIN used in `trainers_select`
- Bucket `profiles` exists with `public=false` after the migration applies
- `npx tsc --noEmit` on permissions.ts patch exits 0
</verification>

<success_criteria>
- 1 hand-authored SQL migration (additive policies + bucket bootstrap)
- 1 rollback companion with canonical markers
- 4 new tables fully RLS-gated at DB level
- Storage bucket bootstrap idempotent
- ROLE_PERMISSIONS matrix extended for Phase 2 resources
- All Phase 1 policies untouched
</success_criteria>

<output>
After completion, create `.planning/phases/02-identiteit-bestanden/02-05-SUMMARY.md` listing the 19 policy names, the 4 ENABLE+FORCE statements, and the 16 new permission codes.
</output>
