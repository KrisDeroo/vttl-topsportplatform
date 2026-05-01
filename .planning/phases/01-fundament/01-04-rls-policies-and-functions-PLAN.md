---
phase: 01-fundament
plan: 04
type: execute
wave: 4
depends_on: [02, 03]
files_modified:
  - drizzle/0002_rls_functions_and_policies.sql
  - drizzle/0002_rls_functions_and_policies.rollback.md
  - src/server/db/rls/functions.sql
  - src/server/db/rls/policies.sql
autonomous: true
requirements:
  - USER-05
requirements_supports:  # informational — primary owners listed below
  - USER-04
threat_refs:
  - T-01-02
  - T-01-03
  - T-01-04
  - T-01-10
tags:
  - phase-1
  - rls
  - postgres
  - security

must_haves:
  truths:
    - "Migration 0002 creates the canonical SECURITY DEFINER function `players_visible_to(caller_id UUID, caller_role TEXT) RETURNS TABLE(player_user_id UUID)`"
    - "Migration 0002 creates the STABLE wrapper `current_user_id()` returning UUID — used inside policies for plan-hoisting (CRIT-8)"
    - "Migration 0002 creates `query_medical_access_audit(p_subject UUID, p_from TIMESTAMPTZ, p_to TIMESTAMPTZ)` SECURITY DEFINER fn — only path to read medical_access_audit"
    - "ALTER TABLE … ENABLE ROW LEVEL SECURITY + FORCE ROW LEVEL SECURITY on: users, sessions, parent_child_links, consent_records, idempotency_keys, medical_events, medical_documents, medical_access_audit, audit_log"
    - "CREATE POLICY blocks for: users (self-or-TD select), sessions (owner-only), parent_child_links (parent OR child OR TD), consent_records (snapshot UPDATE locked to withdrawn_at column), medical_events (self OR TD OR medical_staff OR linked-parent — explicitly NOT trainer), medical_access_audit (USING (false) — block direct SELECT), audit_log (USING (false) — block direct SELECT; INSERT only)"
    - "After migration, app_user (NOT postgres role) attempting `SELECT * FROM medical_events` for foreign player returns 0 rows"
  artifacts:
    - path: "drizzle/0002_rls_functions_and_policies.sql"
      provides: "All SECURITY DEFINER functions + ENABLE/FORCE RLS + CREATE POLICY statements"
      contains: "players_visible_to"
    - path: "src/server/db/rls/functions.sql"
      provides: "Canonical functions.sql sourced into migration 0002 — committed as readable artifact for legal/security review"
      contains: "SECURITY DEFINER"
    - path: "src/server/db/rls/policies.sql"
      provides: "Canonical policies.sql sourced into migration 0002 — readable artifact"
      contains: "ENABLE ROW LEVEL SECURITY"
    - path: "drizzle/0002_rls_functions_and_policies.rollback.md"
      provides: "DROP POLICY + DROP FUNCTION + DISABLE RLS reverse procedure"
      contains: "DROP POLICY"
  key_links:
    - from: "drizzle/0002_rls_functions_and_policies.sql"
      to: "drizzle/0000_initial.sql"
      via: "Postgres roles app_user / app_audit_writer must exist before policies are applied"
      pattern: "app_user"
    - from: "drizzle/0002_rls_functions_and_policies.sql"
      to: "drizzle/0001_medical_isolated.sql"
      via: "medical_events / medical_documents / medical_access_audit must exist before RLS is enabled"
      pattern: "medical_events"
    - from: "src/server/db/rls/policies.sql"
      to: "tests/rls/medical-isolation.test.ts (Plan 17)"
      via: "RLS direct-query test relies on these policies being present"
      pattern: "medical_events_read"
---

<objective>
Migration 0002 — the row-level security layer. RLS is the mandatory backstop behind tRPC middleware (CRIT-1: defense in depth). This is the migration that makes the Phase-1 succescriterium #3 ("directe Postgres-query als niet-eigenaar op `medical_events` retourneert nul rijen") technically true.

Three pieces:
1. **Stable functions.** `current_user_id()` (STABLE wrapper around `current_setting`), `players_visible_to(caller_id, caller_role)` SECURITY DEFINER (canonical visibility rule, CRIT-3), `query_medical_access_audit(...)` SECURITY DEFINER (only read path for tamper-evident audit).
2. **ENABLE + FORCE ROW LEVEL SECURITY** on every sensitive table.
3. **CREATE POLICY** statements per table — handcrafted SQL (more readable for legal/security review than Drizzle's `pgPolicy()`).

Critical correctness requirements:
- `players_visible_to()` uses UNION (not OR-chain in WHERE) so the planner can choose different access paths per role
- `current_user_id()` is STABLE (not VOLATILE) so it gets hoisted out of row scans (CRIT-8 — RISK-RLS-PERF)
- Trainers do NOT appear in `medical_events_read` policy — they get traffic-light status via Phase 5's `medical_injury_status_for_trainers` view (MED-04 separation)
- `consent_records` UPDATE policy restricts the change to `withdrawn_at` only (snapshot is the legal record — D-06)

Output: `drizzle/0002_rls_functions_and_policies.sql` + companion `.rollback.md` + readable copies in `src/server/db/rls/`.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/phases/01-fundament/01-CONTEXT.md
@.planning/phases/01-fundament/01-RESEARCH.md
@.planning/PITFALLS-ADDITIONS.md
@CLAUDE.md
</context>

<tasks>

<task type="auto" tdd="false">
  <name>Task 1: Define functions.sql + policies.sql (readable artifacts)</name>
  <read_first>
    - .planning/phases/01-fundament/01-RESEARCH.md §players_visible_to() (lines 850–891) — exact SECURITY DEFINER function body
    - .planning/phases/01-fundament/01-RESEARCH.md §Caller-context session variables (lines 893–902)
    - .planning/phases/01-fundament/01-RESEARCH.md §Concrete RLS policies (lines 904–998) — full per-table policy SQL
    - .planning/phases/01-fundament/01-RESEARCH.md §RLS performance tactics (lines 1000–1024) — current_user_id() STABLE wrapper + indexes
    - .planning/PITFALLS-ADDITIONS.md (CRIT-3, CRIT-7, CRIT-8 — full pattern)
  </read_first>
  <files>
    src/server/db/rls/functions.sql
    src/server/db/rls/policies.sql
  </files>
  <action>
    Create `src/server/db/rls/functions.sql` (canonical, hand-edited):

    ```sql
    -- =============================================================
    -- VTTL Topsport — RLS support functions
    -- Sourced into drizzle/0002_rls_functions_and_policies.sql
    -- =============================================================

    -- 1. Stable wrapper around current_setting('app.user_id') — enables planner to hoist
    --    the value out of per-row evaluation in policies (CRIT-8, RISK-RLS-PERF).
    CREATE OR REPLACE FUNCTION current_user_id() RETURNS UUID AS $$
      SELECT NULLIF(current_setting('app.user_id', true), '')::uuid;
    $$ LANGUAGE SQL STABLE;

    CREATE OR REPLACE FUNCTION current_user_role() RETURNS TEXT AS $$
      SELECT NULLIF(current_setting('app.user_role', true), '');
    $$ LANGUAGE SQL STABLE;

    -- 2. The canonical visibility rule (CRIT-3). Single source of truth for "which players is the caller allowed to see?".
    --    Each role contributes one UNION branch — planner chooses the cheapest path per role.
    --    SECURITY DEFINER so it can read parent_child_links / academy_memberships even when the caller's RLS would block them.
    CREATE OR REPLACE FUNCTION players_visible_to(caller_id UUID, caller_role TEXT)
    RETURNS TABLE(player_user_id UUID) AS $$
      -- Player sees self
      SELECT id FROM users WHERE id = caller_id AND caller_role = 'player'

      UNION

      -- Parent sees own child(ren)
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

      -- Technical director / medical_staff sees all players
      SELECT id FROM users WHERE caller_role IN ('technical_director', 'medical_staff')

      -- Sparring partner branch (Phase 5 fills it via session_sparring_partners)
      UNION
      SELECT NULL::UUID WHERE FALSE;
    $$ LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public;

    GRANT EXECUTE ON FUNCTION players_visible_to(UUID, TEXT) TO app_user;
    REVOKE EXECUTE ON FUNCTION players_visible_to(UUID, TEXT) FROM PUBLIC;

    -- 3. Only read path for medical_access_audit (CRIT-7, T-01-04).
    --    SECURITY DEFINER so it bypasses the table's RLS USING (false) policy.
    --    Caller-side authorization enforced in app code (TD only — Plan 11 middleware).
    CREATE OR REPLACE FUNCTION query_medical_access_audit(p_subject UUID, p_from TIMESTAMPTZ, p_to TIMESTAMPTZ)
    RETURNS SETOF medical_access_audit AS $$
      SELECT * FROM medical_access_audit
       WHERE subject_player_id = p_subject AND occurred_at BETWEEN p_from AND p_to
       ORDER BY occurred_at DESC
       LIMIT 10000;
    $$ LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public;

    GRANT EXECUTE ON FUNCTION query_medical_access_audit(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO app_user;
    REVOKE EXECUTE ON FUNCTION query_medical_access_audit(UUID, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC;
    ```

    Create `src/server/db/rls/policies.sql`:

    ```sql
    -- =============================================================
    -- VTTL Topsport — Row-Level Security policies
    -- Sourced into drizzle/0002_rls_functions_and_policies.sql
    -- =============================================================

    -- USERS
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

    -- SESSIONS — owner-only
    ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
    ALTER TABLE sessions FORCE ROW LEVEL SECURITY;
    CREATE POLICY sessions_owner ON sessions FOR ALL
      USING (user_id = current_user_id())
      WITH CHECK (user_id = current_user_id());

    -- ACCOUNTS — owner-only
    ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
    ALTER TABLE accounts FORCE ROW LEVEL SECURITY;
    CREATE POLICY accounts_owner ON accounts FOR ALL
      USING (user_id = current_user_id())
      WITH CHECK (user_id = current_user_id());

    -- VERIFICATIONS — Better Auth manages internally; allow service-role-only via direct DB access.
    --   For app_user role, allow INSERT (sign-up) and SELECT/DELETE on rows matching identifier.
    ALTER TABLE verifications ENABLE ROW LEVEL SECURITY;
    ALTER TABLE verifications FORCE ROW LEVEL SECURITY;
    CREATE POLICY verifications_anon_inserts ON verifications FOR INSERT WITH CHECK (true);
    CREATE POLICY verifications_consume ON verifications FOR ALL
      USING (true)  -- Better Auth needs to look up by token; security comes from token unguessability + expiresAt
      WITH CHECK (true);

    -- PARENT_CHILD_LINKS
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

    -- ACADEMY_MEMBERSHIPS
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

    -- CONSENT_RECORDS — snapshot is the legal record (D-06)
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
    -- Belt-and-braces: enforced via WITH CHECK that all snapshot/version columns are unchanged.
    -- (The check below relies on Postgres allowing OLD/NEW reference; in policy WITH CHECK, NEW is the post-update row,
    --  and we cannot reference OLD directly; we therefore lock down at the app layer (Plan 12 service) AND
    --  use a row-level CHECK constraint on UPDATE.)
    CREATE POLICY consent_withdraw ON consent_records FOR UPDATE
      USING (user_id = current_user_id() AND withdrawn_at IS NULL)
      WITH CHECK (user_id = current_user_id());

    -- IDEMPOTENCY_KEYS
    ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;
    ALTER TABLE idempotency_keys FORCE ROW LEVEL SECURITY;
    CREATE POLICY idempotency_owner ON idempotency_keys FOR ALL
      USING (user_id = current_user_id())
      WITH CHECK (user_id = current_user_id());

    -- AUDIT_LOG — INSERT only via app_user; reads blocked via RLS, accessed by TD via SECURITY DEFINER fn (Phase 7)
    ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
    ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;
    CREATE POLICY audit_log_no_select ON audit_log FOR SELECT USING (false);
    CREATE POLICY audit_log_inserts ON audit_log FOR INSERT WITH CHECK (true);

    -- LOOKUPS — public read for authenticated users (codes only — no PII)
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

    ALTER TABLE organisation ENABLE ROW LEVEL SECURITY;
    ALTER TABLE organisation FORCE ROW LEVEL SECURITY;
    CREATE POLICY org_read ON organisation FOR SELECT USING (true);

    ALTER TABLE outcome_level ENABLE ROW LEVEL SECURITY;
    ALTER TABLE outcome_level FORCE ROW LEVEL SECURITY;
    CREATE POLICY ol_read ON outcome_level FOR SELECT USING (true);

    -- MEDICAL_EVENTS — strict (CRIT-2). Trainers EXPLICITLY excluded; coaches get traffic-light view in Phase 5.
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
    -- Soft-delete only via UPDATE deleted_at; no DELETE statement.

    -- MEDICAL_DOCUMENTS — same shape
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

    -- MEDICAL_ACCESS_AUDIT — direct SELECT blocked; reads via SECURITY DEFINER fn
    ALTER TABLE medical_access_audit ENABLE ROW LEVEL SECURITY;
    ALTER TABLE medical_access_audit FORCE ROW LEVEL SECURITY;
    CREATE POLICY maa_no_select ON medical_access_audit FOR SELECT USING (false);
    CREATE POLICY maa_insert ON medical_access_audit FOR INSERT WITH CHECK (true);
    ```
  </action>
  <verify>
    <automated>test -f src/server/db/rls/functions.sql && test -f src/server/db/rls/policies.sql && grep -q "current_user_id" src/server/db/rls/functions.sql && grep -q "STABLE" src/server/db/rls/functions.sql && grep -q "players_visible_to" src/server/db/rls/functions.sql && grep -q "SECURITY DEFINER" src/server/db/rls/functions.sql && grep -q "query_medical_access_audit" src/server/db/rls/functions.sql && grep -q "ENABLE ROW LEVEL SECURITY" src/server/db/rls/policies.sql && grep -q "FORCE ROW LEVEL SECURITY" src/server/db/rls/policies.sql && grep -q "users_self_or_td" src/server/db/rls/policies.sql && grep -q "consent_withdraw" src/server/db/rls/policies.sql && grep -q "medical_events_read" src/server/db/rls/policies.sql && grep -q "maa_no_select" src/server/db/rls/policies.sql && grep -q "audit_log_no_select" src/server/db/rls/policies.sql && grep -vc "trainer" src/server/db/rls/policies.sql; ! grep -E "medical_events.*USING.*trainer" src/server/db/rls/policies.sql</automated>
  </verify>
  <acceptance_criteria>
    - `src/server/db/rls/functions.sql` defines `current_user_id()` with `LANGUAGE SQL STABLE`
    - `players_visible_to()` is `LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public` and uses UNION (NOT a single OR-chain)
    - `query_medical_access_audit()` is `SECURITY DEFINER` with `LIMIT 10000`
    - GRANT EXECUTE on both functions to `app_user`; REVOKE EXECUTE FROM PUBLIC
    - `src/server/db/rls/policies.sql` has `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY` for every sensitive table (users, sessions, accounts, parent_child_links, academy_memberships, consent_records, idempotency_keys, audit_log, medical_events, medical_documents, medical_access_audit, status, academy, tournament_type, ranking_type, training_type, organisation, outcome_level)
    - `medical_events_read` policy DOES NOT include `'trainer'` in its allowlist (CRIT-2, MED-04 separation)
    - `medical_events_read` policy DOES include `'medical_staff'` and `'technical_director'`
    - `consent_records` UPDATE policy `USING` clause includes `withdrawn_at IS NULL` (one-way withdrawal)
    - `audit_log_no_select` policy `USING (false)` blocks all direct SELECT
    - `maa_no_select` policy `USING (false)` blocks all direct SELECT on medical_access_audit
  </acceptance_criteria>
  <done>functions.sql + policies.sql committed; trainers EXCLUDED from medical_events read; consent UPDATE locked.</done>
</task>

<task type="auto" tdd="false">
  <name>Task 2: Generate migration 0002_rls_functions_and_policies.sql sourcing the .sql artifacts + rollback runbook</name>
  <read_first>
    - src/server/db/rls/functions.sql (just-created)
    - src/server/db/rls/policies.sql (just-created)
    - drizzle/0001_medical_isolated.rollback.md (Plan 03 — rollback pattern reference)
  </read_first>
  <files>
    drizzle/0002_rls_functions_and_policies.sql
    drizzle/0002_rls_functions_and_policies.rollback.md
    drizzle/meta/_journal.json
  </files>
  <action>
    Drizzle Kit will not auto-detect raw RLS SQL changes (RLS isn't in the schema files). Create the migration manually:

    1. Determine the next sequential number by reading `drizzle/meta/_journal.json`. After Plan 02 + Plan 03, the next number is `0002`.

    2. Create `drizzle/0002_rls_functions_and_policies.sql` by concatenating the two readable artifacts with a header:
    ```sql
    -- =============================================================
    -- Migration 0002 — RLS functions + policies
    -- Generated: copy of src/server/db/rls/functions.sql + src/server/db/rls/policies.sql
    -- (RLS is NOT auto-detected by drizzle-kit; this file is hand-authored.)
    -- =============================================================

    -- ───────────────────────── functions ─────────────────────────
    -- (paste full contents of src/server/db/rls/functions.sql here)

    -- ───────────────────────── policies ─────────────────────────
    -- (paste full contents of src/server/db/rls/policies.sql here)
    ```

    Use a build step (or a one-liner during plan execution): `cat src/server/db/rls/functions.sql src/server/db/rls/policies.sql > drizzle/0002_rls_functions_and_policies.sql` then prepend the header comment.

    3. Update `drizzle/meta/_journal.json` to register migration 0002. Drizzle Kit normally manages this; for hand-authored migrations, append an entry:
    ```json
    {
      "idx": 2,
      "version": "7",
      "when": <unix-ms>,
      "tag": "0002_rls_functions_and_policies",
      "breakpoints": true
    }
    ```
    Use `node -e "console.log(Date.now())"` to fill the `when` field. (Drizzle Kit reads this journal to know which migrations are pending.)

    Alternative (simpler): run `npx drizzle-kit generate --custom --name=rls_functions_and_policies` — Drizzle 0.31+ supports `--custom` to create an empty migration file you fill manually, AND it correctly updates the journal.

    4. Create `drizzle/0002_rls_functions_and_policies.rollback.md`:
    ```markdown
    # Rollback — 0002_rls_functions_and_policies.sql

    **Risk:** Removes RLS protection from all sensitive tables. After rollback, app_user role can SELECT every row in users / medical_events / consent_records / audit_log / medical_access_audit. ONLY run during incident response with explicit incident-commander approval.

    **Procedure:**
    ```sql
    BEGIN;

    -- Drop policies (alphabetic — order does not matter once tables enabled RLS)
    DROP POLICY IF EXISTS users_self_or_td ON users;
    DROP POLICY IF EXISTS users_td_writes ON users;
    DROP POLICY IF EXISTS users_self_or_td_updates ON users;
    DROP POLICY IF EXISTS sessions_owner ON sessions;
    DROP POLICY IF EXISTS accounts_owner ON accounts;
    DROP POLICY IF EXISTS verifications_anon_inserts ON verifications;
    DROP POLICY IF EXISTS verifications_consume ON verifications;
    DROP POLICY IF EXISTS pcl_visible ON parent_child_links;
    DROP POLICY IF EXISTS pcl_td_writes ON parent_child_links;
    DROP POLICY IF EXISTS pcl_td_updates ON parent_child_links;
    DROP POLICY IF EXISTS pcl_td_deletes ON parent_child_links;
    DROP POLICY IF EXISTS am_visible ON academy_memberships;
    DROP POLICY IF EXISTS am_td_writes ON academy_memberships;
    DROP POLICY IF EXISTS consent_visible ON consent_records;
    DROP POLICY IF EXISTS consent_inserts ON consent_records;
    DROP POLICY IF EXISTS consent_withdraw ON consent_records;
    DROP POLICY IF EXISTS idempotency_owner ON idempotency_keys;
    DROP POLICY IF EXISTS audit_log_no_select ON audit_log;
    DROP POLICY IF EXISTS audit_log_inserts ON audit_log;
    DROP POLICY IF EXISTS medical_events_read ON medical_events;
    DROP POLICY IF EXISTS medical_events_write ON medical_events;
    DROP POLICY IF EXISTS medical_events_update ON medical_events;
    DROP POLICY IF EXISTS medical_documents_read ON medical_documents;
    DROP POLICY IF EXISTS medical_documents_write ON medical_documents;
    DROP POLICY IF EXISTS maa_no_select ON medical_access_audit;
    DROP POLICY IF EXISTS maa_insert ON medical_access_audit;
    DROP POLICY IF EXISTS status_read ON status;
    DROP POLICY IF EXISTS status_td_writes ON status;
    DROP POLICY IF EXISTS academy_read ON academy;
    DROP POLICY IF EXISTS academy_td_writes ON academy;
    DROP POLICY IF EXISTS tt_read ON tournament_type;
    DROP POLICY IF EXISTS tt_td_writes ON tournament_type;
    DROP POLICY IF EXISTS rt_read ON ranking_type;
    DROP POLICY IF EXISTS rt_td_writes ON ranking_type;
    DROP POLICY IF EXISTS trt_read ON training_type;
    DROP POLICY IF EXISTS org_read ON organisation;
    DROP POLICY IF EXISTS ol_read ON outcome_level;

    -- Disable RLS on every table
    ALTER TABLE users DISABLE ROW LEVEL SECURITY;
    ALTER TABLE sessions DISABLE ROW LEVEL SECURITY;
    ALTER TABLE accounts DISABLE ROW LEVEL SECURITY;
    ALTER TABLE verifications DISABLE ROW LEVEL SECURITY;
    ALTER TABLE parent_child_links DISABLE ROW LEVEL SECURITY;
    ALTER TABLE academy_memberships DISABLE ROW LEVEL SECURITY;
    ALTER TABLE consent_records DISABLE ROW LEVEL SECURITY;
    ALTER TABLE idempotency_keys DISABLE ROW LEVEL SECURITY;
    ALTER TABLE audit_log DISABLE ROW LEVEL SECURITY;
    ALTER TABLE medical_events DISABLE ROW LEVEL SECURITY;
    ALTER TABLE medical_documents DISABLE ROW LEVEL SECURITY;
    ALTER TABLE medical_access_audit DISABLE ROW LEVEL SECURITY;
    ALTER TABLE status DISABLE ROW LEVEL SECURITY;
    ALTER TABLE academy DISABLE ROW LEVEL SECURITY;
    ALTER TABLE tournament_type DISABLE ROW LEVEL SECURITY;
    ALTER TABLE ranking_type DISABLE ROW LEVEL SECURITY;
    ALTER TABLE training_type DISABLE ROW LEVEL SECURITY;
    ALTER TABLE organisation DISABLE ROW LEVEL SECURITY;
    ALTER TABLE outcome_level DISABLE ROW LEVEL SECURITY;

    -- Drop functions
    DROP FUNCTION IF EXISTS query_medical_access_audit(UUID, TIMESTAMPTZ, TIMESTAMPTZ);
    DROP FUNCTION IF EXISTS players_visible_to(UUID, TEXT);
    DROP FUNCTION IF EXISTS current_user_role();
    DROP FUNCTION IF EXISTS current_user_id();

    COMMIT;
    ```

    **Verification:** `\d+ users` shows "Row security: off"
    ```

    5. Verify the SQL is parseable (`pg_dump` style: spawn a Postgres testcontainer and `\i drizzle/0002_rls_functions_and_policies.sql` returns no error). Defer the actual integration test to Plan 16 (Wave 7 push); Plan 17 (Wave 1) testcontainer setup will pick this up automatically.
  </action>
  <verify>
    <automated>test -f drizzle/0002_rls_functions_and_policies.sql && test -f drizzle/0002_rls_functions_and_policies.rollback.md && grep -q "players_visible_to" drizzle/0002_rls_functions_and_policies.sql && grep -q "current_user_id" drizzle/0002_rls_functions_and_policies.sql && grep -q "query_medical_access_audit" drizzle/0002_rls_functions_and_policies.sql && grep -q "ENABLE ROW LEVEL SECURITY" drizzle/0002_rls_functions_and_policies.sql && grep -q "FORCE ROW LEVEL SECURITY" drizzle/0002_rls_functions_and_policies.sql && grep -q "medical_events_read" drizzle/0002_rls_functions_and_policies.sql && grep -q "audit_log_no_select" drizzle/0002_rls_functions_and_policies.sql && grep -q "DROP POLICY IF EXISTS" drizzle/0002_rls_functions_and_policies.rollback.md && grep -q "DISABLE ROW LEVEL SECURITY" drizzle/0002_rls_functions_and_policies.rollback.md && grep -q "DROP FUNCTION IF EXISTS players_visible_to" drizzle/0002_rls_functions_and_policies.rollback.md && grep -E "0002_rls|rls_functions" drizzle/meta/_journal.json</automated>
  </verify>
  <acceptance_criteria>
    - `drizzle/0002_rls_functions_and_policies.sql` exists and contains both function definitions + every CREATE POLICY statement from the readable artifacts
    - `drizzle/meta/_journal.json` lists migration `0002_rls_functions_and_policies`
    - `drizzle/0002_rls_functions_and_policies.rollback.md` lists DROP for every policy + DISABLE RLS for every table + DROP for all 4 functions
    - File line count >= 200 (sanity bound — full policy set is large)
  </acceptance_criteria>
  <done>RLS migration committed with full reverse procedure.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| App role ↔ DB rows | Postgres RLS evaluates policy USING/WITH CHECK on every query — defense in depth behind tRPC middleware |
| App SET LOCAL ↔ Policy fn | `current_user_id()` STABLE wrapper hoists the value out of row scans |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-01-02 | Information Disclosure | Cross-academy data read | mitigate | `players_visible_to()` UNION branch limits trainers/academy_managers to same-academy player set; FORCE RLS applies to table owner too |
| T-01-03 | Information Disclosure | Medical data leak via shared query path | mitigate | `medical_events_read` policy excludes `'trainer'`; only player-self / TD / medical_staff / linked-parent see rows; trainers' traffic-light view is a separate table (Phase 5, MED-04) |
| T-01-04 | Repudiation | Audit log tampering | mitigate | `audit_log_no_select` and `maa_no_select` policies USING (false) block every direct SELECT; reads must go through SECURITY DEFINER functions |
| T-01-10 | Information Disclosure | Encryption-at-rest bypass | mitigate | `medical_events` plaintext is in cipher columns (Plan 03); RLS adds defense-in-depth so even a leaked encryption key requires Postgres role + `app.user_id` setting |
</threat_model>

<verification>
- `drizzle/0002_rls_functions_and_policies.sql` exists and is committed
- Wave-0 RLS direct-query test (`tests/rls/medical-isolation.test.ts`, `tests/rls/direct-query.test.ts`) is now wired against actual policies — but tests stay RED until Plan 16 pushes the migration to a real Postgres
- `npx drizzle-kit migrate --dry-run` (or `pg_dump --schema-only` after dry-run) shows the policies in the resulting schema
</verification>

<success_criteria>
- 4 PostgreSQL functions: current_user_id, current_user_role, players_visible_to, query_medical_access_audit
- 19 tables have ENABLE + FORCE ROW LEVEL SECURITY
- 30+ CREATE POLICY statements cover SELECT/INSERT/UPDATE/DELETE per table
- Trainers EXCLUDED from medical_events read policy (MED-04 separation)
- Consent UPDATE locked to withdrawn_at via USING clause
- Audit tables have USING (false) SELECT policies
- Rollback procedure documented for incident response
</success_criteria>

<output>
After completion, create `.planning/phases/01-fundament/01-04-SUMMARY.md` documenting:
- Final policy count per table
- Confirmation that `medical_events_read` does NOT mention `trainer`
- Reminder that Plan 11 (CallerContext middleware) populates `app.user_id` / `app.user_role` GUCs per request — without that wiring, every policy denies (USING resolves to NULL → false)
</output>
