---
phase: 01-fundament
plan: 16
type: execute
wave: 8
depends_on: [02, 03, 04, 12, 15]
files_modified:
  - .planning/phases/01-fundament/01-16-MIGRATION-LOG.md
autonomous: true
requirements:
  - MIG-04
threat_refs:
  - T-01-MIG-CREDENTIALS
tags:
  - phase-1
  - schema
  - blocking
  - migration
  - push

must_haves:
  truths:
    - "All 4 migration files (0000_initial, 0001_medical_isolated, 0002_rls_functions_and_policies, 0003_users_is_minor) applied to dev/staging Supabase Postgres via `npx drizzle-kit migrate`"
    - "Postgres roles app_user and app_audit_writer exist with correct GRANT/REVOKE matrix"
    - "All 19 sensitive tables have ENABLE + FORCE ROW LEVEL SECURITY"
    - "All 4 SECURITY DEFINER functions exist (current_user_id, current_user_role, players_visible_to, query_medical_access_audit)"
    - "users.is_minor generated column functional (verified via SELECT)"
    - "Migration log committed to phase folder for verification reference"
  artifacts:
    - path: ".planning/phases/01-fundament/01-16-MIGRATION-LOG.md"
      provides: "Full output of drizzle-kit migrate, post-migration verification queries, and a checksum of every migration file"
      contains: "applied"
  key_links:
    - from: "drizzle/0000_initial.sql + 0001 + 0002 + 0003"
      to: "Supabase Postgres (dev/staging)"
      via: "DIRECT_DATABASE_URL (port 5432, bypasses pooler) — drizzle-kit migrate"
      pattern: "DIRECT_DATABASE_URL"
---

<objective>
**[BLOCKING — required by orchestrator schema-push contract.]**

Apply all 4 Phase-1 migrations to a real dev/staging Supabase Postgres instance. Without this step:
- Wave-0 RLS direct-query test stays RED (no policies to test against)
- 35-test RBAC matrix stays RED (no tables in DB)
- /api/health/ready cannot probe a real DB
- Plans 11 + 12 + 15 cannot be verified end-to-end

This plan executes after every other plan that produces SQL is complete (Plans 02, 03, 04, 12 — and 15 which doesn't produce SQL but is the consumer that validates the wiring). It runs against the staging Supabase project; production is a separate Phase 8 step.

Output: MIGRATION-LOG.md with `drizzle-kit migrate` output, post-migration smoke checks, and confirmation that all four expected migrations were applied.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/phases/01-fundament/01-CONTEXT.md
@.planning/phases/01-fundament/01-RESEARCH.md
@CLAUDE.md
@docs/migration-runbook.md
</context>

<tasks>

<task type="auto" tdd="false">
  <name>Task 1: Apply migrations against dev/staging Supabase + post-migration smoke checks</name>
  <read_first>
    - drizzle/meta/_journal.json (every migration registered: 0000, 0001, 0002, 0003)
    - docs/migration-runbook.md (Plan 18 — Drizzle Kit cheat-sheet)
    - .env.local — DIRECT_DATABASE_URL must point at dev/staging Supabase Postgres (NOT pooler)
  </read_first>
  <files>
    .planning/phases/01-fundament/01-16-MIGRATION-LOG.md
  </files>
  <action>
    **Pre-checks (abort if any fail):**
    1. Verify `.env.local` has `DIRECT_DATABASE_URL` pointing at dev/staging Supabase (port 5432, NOT 6543).
    2. Verify the target DB is empty or contains only previous Phase-0 state. Run:
       ```bash
       psql "$DIRECT_DATABASE_URL" -c "SELECT tablename FROM pg_tables WHERE schemaname='public'"
       ```
       Expect: empty OR only legacy tables. If any Phase-1 tables already exist (e.g., `users`, `medical_events`), STOP — this plan only runs against a clean target.
    3. Verify `drizzle/meta/_journal.json` lists exactly 4 migrations (0000, 0001, 0002, 0003).
    4. Set required GUCs for role passwords:
       ```bash
       export APP_USER_PW="<generate-random-32-char>"
       export APP_AUDIT_WRITER_PW="<generate-random-32-char>"
       ```
       Save these in Coolify Secrets (or .env.local for dev) — Plan 11 connection string will use `app_user` role with this password.

    **Apply migrations:**
    ```bash
    PGOPTIONS="-c app.app_user_pw=$APP_USER_PW -c app.app_audit_writer_pw=$APP_AUDIT_WRITER_PW" \
      npx drizzle-kit migrate 2>&1 | tee /tmp/drizzle-migrate.log
    ```

    Expected output:
    ```
    Applied migration 0000_initial
    Applied migration 0001_medical_isolated
    Applied migration 0002_rls_functions_and_policies
    Applied migration 0003_users_is_minor
    Applied 4 migrations
    ```

    **Post-migration smoke checks (each MUST pass):**
    ```bash
    psql "$DIRECT_DATABASE_URL" <<'SQL' | tee -a /tmp/drizzle-migrate.log
    -- 1. All Phase-1 tables exist
    SELECT count(*) AS table_count FROM pg_tables
     WHERE schemaname='public'
       AND tablename IN ('users','sessions','accounts','verifications',
                         'status','academy','tournament_type','ranking_type','training_type','organisation','outcome_level',
                         'academy_memberships','parent_child_links',
                         'consent_records','audit_log','idempotency_keys',
                         'medical_events','medical_documents','medical_access_audit');
    -- expect 19

    -- 2. RLS enabled on every sensitive table
    SELECT tablename, rowsecurity, forcerowsecurity FROM pg_tables
     WHERE schemaname='public' AND tablename IN
       ('users','medical_events','medical_documents','medical_access_audit','consent_records','audit_log','parent_child_links');
    -- expect rowsecurity=t and forcerowsecurity=t for all 7

    -- 3. SECURITY DEFINER functions exist
    SELECT proname FROM pg_proc WHERE proname IN
      ('current_user_id','current_user_role','players_visible_to','query_medical_access_audit','set_updated_at','medical_event_audit','medical_document_audit')
    ORDER BY proname;
    -- expect 7 rows

    -- 4. Postgres roles created
    SELECT rolname FROM pg_roles WHERE rolname IN ('app_user','app_audit_writer');
    -- expect 2 rows

    -- 5. app_user privileges on audit_log: INSERT only (no UPDATE / DELETE)
    SELECT has_table_privilege('app_user','audit_log','INSERT') AS ins,
           has_table_privilege('app_user','audit_log','UPDATE') AS upd,
           has_table_privilege('app_user','audit_log','DELETE') AS del;
    -- expect ins=t, upd=f, del=f

    -- 6. app_user privileges on medical_access_audit: INSERT only
    SELECT has_table_privilege('app_user','medical_access_audit','INSERT') AS ins,
           has_table_privilege('app_user','medical_access_audit','UPDATE') AS upd,
           has_table_privilege('app_user','medical_access_audit','DELETE') AS del;
    -- expect ins=t, upd=f, del=f

    -- 7. users.is_minor functional
    INSERT INTO users (email, name, date_of_birth) VALUES ('smoke-minor@vttl.test', 'Minor Test', CURRENT_DATE - INTERVAL '14 years');
    INSERT INTO users (email, name, date_of_birth) VALUES ('smoke-adult@vttl.test', 'Adult Test', CURRENT_DATE - INTERVAL '30 years');
    SELECT email, is_minor FROM users WHERE email LIKE 'smoke-%';
    -- expect smoke-minor: t, smoke-adult: f
    DELETE FROM users WHERE email LIKE 'smoke-%';

    -- 8. Foreign-key cascade rules
    SELECT conname, contype, confdeltype FROM pg_constraint
     WHERE conrelid IN ('medical_events'::regclass,'medical_documents'::regclass,'parent_child_links'::regclass,'sessions'::regclass)
       AND contype='f';
    -- expect medical_events.player_user_id confdeltype='r' (RESTRICT)
    -- medical_documents.medical_event_id confdeltype='c' (CASCADE)
    -- medical_documents.player_user_id confdeltype='r'
    -- sessions.user_id confdeltype='c'
    SQL
    ```

    Capture the output of all checks into `.planning/phases/01-fundament/01-16-MIGRATION-LOG.md` with this structure:
    ```markdown
    # Migration Log — Phase 1 Push

    **Date:** {ISO timestamp}
    **Target:** {staging | dev} Supabase project — {project-id}
    **Operator:** Claude (gsd-execute-phase)

    ## Pre-checks
    - [x] DIRECT_DATABASE_URL points at port 5432
    - [x] Target DB has no Phase-1 tables
    - [x] Journal lists 4 migrations

    ## Applied migrations
    {paste of `drizzle-kit migrate` output}

    ## File checksums (SHA-256)
    {output of `sha256sum drizzle/000*.sql`}

    ## Post-migration smoke checks
    {paste of each SQL block + result}

    ## Verification matrix
    | Check | Expected | Actual | Status |
    |-------|----------|--------|--------|
    | 19 tables | 19 | … | OK / FAIL |
    | RLS enabled (7 tables) | 7×t/t | … | OK / FAIL |
    | 7 functions | 7 | … | OK / FAIL |
    | 2 roles | 2 | … | OK / FAIL |
    | audit_log app_user privileges | i/f/f | … | OK / FAIL |
    | medical_access_audit privileges | i/f/f | … | OK / FAIL |
    | is_minor 14yr=t / 30yr=f | t/f | … | OK / FAIL |
    | medical_events.player_user_id RESTRICT | r | … | OK / FAIL |
    | medical_documents.medical_event_id CASCADE | c | … | OK / FAIL |

    ## Next steps
    - Plan 17 RBAC matrix test (Plan 11 wires the appCaller; the 35-test matrix can now verify against real RLS)
    - Plan 17 RLS direct-query test now turns GREEN
    - /api/health/ready returns 200 against the populated DB
    ```

    If any check fails:
    1. Do NOT proceed.
    2. Roll back via `drizzle/0003_*.rollback.md` → `0002_*.rollback.md` → `0001_*.rollback.md` → `0000_*.rollback.md` in reverse order.
    3. Fix the offending migration in a new migration (per MIG-01 — never edit committed files).
    4. Re-run this plan.
  </action>
  <verify>
    <automated>test -f .planning/phases/01-fundament/01-16-MIGRATION-LOG.md && grep -q "Applied migration 0000_initial\|0000_initial.*Applied\|Phase 1 Push" .planning/phases/01-fundament/01-16-MIGRATION-LOG.md && grep -q "Verification matrix" .planning/phases/01-fundament/01-16-MIGRATION-LOG.md && ! grep -Eq "\|\s*FAIL\s*\|" .planning/phases/01-fundament/01-16-MIGRATION-LOG.md</automated>
  </verify>
  <acceptance_criteria>
    - All 4 migrations report "Applied" in `drizzle-kit migrate` output
    - All 8 smoke checks pass (no FAIL rows in the verification matrix)
    - MIGRATION-LOG.md committed to git
    - APP_USER_PW + APP_AUDIT_WRITER_PW added to Coolify Secrets (manual step — log in MIGRATION-LOG.md)
  </acceptance_criteria>
  <done>Phase 1 schema is live on dev/staging Supabase; all RLS + role + function structures verified at the DB layer.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Migration runner ↔ DB | drizzle-kit migrate uses DIRECT_DATABASE_URL (port 5432, owner-credentials); single-shot operation |
| Migration files ↔ git history | MIG-01 (Plan 18 CI guard) prevents post-commit edits |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-01-MIG-CREDENTIALS | Information Disclosure / Elevation of Privilege | `DIRECT_DATABASE_URL` (schema-owner credentials) | mitigate | `DIRECT_DATABASE_URL` is provisioned ONLY for the Coolify migration job, NOT for the web/worker runtimes (which use `DATABASE_URL` pooler URL bound to `app_user`). Coolify Secrets scope the variable to the one-shot migration container. The owner password is rotated post-Phase-8 release; rotation procedure documented in `docs/migration-runbook.md`. |
</threat_model>

<verification>
- `tests/rls/medical-isolation.test.ts` (Plan 17) now turns GREEN against the live DB
- `tests/integration/rbac-matrix.test.ts` can run end-to-end (with seeded fixtures)
- `/api/health/ready` returns 200 in production-mode dev server
</verification>

<success_criteria>
- 4 migrations applied
- 8/8 smoke checks pass
- Migration log committed
- App-side wiring (Plans 11 + 12 + 15) can now run without DB errors
</success_criteria>

<output>
After completion, the migration log itself IS the SUMMARY for this plan. Additionally create `.planning/phases/01-fundament/01-16-SUMMARY.md` with a 1-paragraph summary linking to the migration log.
</output>
