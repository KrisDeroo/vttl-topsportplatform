---
phase: 02-identiteit-bestanden
plan_id: 02-14-blocking-schema-push
plan: 14
type: execute
wave: 7
depends_on: [02-03-migration-0006-additive, 02-05-migration-0007-rls-policies, 02-08-migration-0008-lookup-seed, 02-13-ui-pages-and-forms]
files_modified:
  - .planning/phases/02-identiteit-bestanden/02-14-MIGRATION-LOG.md
autonomous: true
requirements:
  - MIG-04

must_haves:
  truths:
    - "All 3 Phase 2 migrations (0006_phase2_profiles_and_files, 0007_phase2_rls_policies, 0008_phase2_lookup_seed) applied to dev/staging Supabase Postgres via `npx drizzle-kit migrate` (per orchestrator schema-push contract — the canonical command is `drizzle-kit migrate`; the schema_push_requirement block mentions `drizzle-kit push` for ad-hoc syncing, but for versioned migration application we use `migrate`)"
    - "Migration log committed with full output of drizzle-kit migrate + post-migration smoke checks"
    - "Post-migration smoke check verifies: 4 new tables exist, 4 ENABLE+FORCE statements active, 19 named policies present, 18 lookup rows seeded (6 academy + 7 age_category + 5 trainer_diploma), mark_scan_result() SECURITY DEFINER function EXECUTE-granted to app_user"
    - "After successful migration, DIRECT_DATABASE_URL is REMOVED from the live web/worker Coolify containers (it carries owner credentials; only the one-shot migration runner needs it). Documented as the closing step (WARNING-15 mitigation)."
    - "Existing Phase 1 schema (19 tables) untouched"
  artifacts:
    - path: ".planning/phases/02-identiteit-bestanden/02-14-MIGRATION-LOG.md"
      provides: "applied migrations log + checksums + verification matrix"
      contains: "Applied migration 0006_phase2_profiles_and_files"
  key_links:
    - from: "drizzle/0006 + 0007 + 0008"
      to: "Supabase Postgres (dev/staging)"
      via: "DIRECT_DATABASE_URL drizzle-kit migrate"
      pattern: "DIRECT_DATABASE_URL"
---

<objective>
**[BLOCKING]** Apply the 3 Phase 2 migrations to dev/staging Supabase Postgres and capture the verification matrix. Without this step, every Phase 2 integration test (02-15) is RED — there are no tables for the routers to query.

Pattern mirrors Phase 1's `01-16-drizzle-push-blocking-PLAN.md` (`01-16-MIGRATION-LOG.md` is the canonical example).

Run AFTER all schema files (02-02, 02-03, 02-05, 02-08) are committed AND the application code (02-09..02-13) is in main — but this plan only does the database push, not deploy.

Output: a `02-14-MIGRATION-LOG.md` document with full drizzle output + 13 smoke-check queries + pass/fail matrix.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/phases/02-identiteit-bestanden/02-CONTEXT.md
@.planning/phases/02-identiteit-bestanden/02-RESEARCH.md
@.planning/phases/01-fundament/01-16-drizzle-push-blocking-PLAN.md
@.planning/phases/01-fundament/01-16-MIGRATION-LOG.md
@drizzle/0006_phase2_profiles_and_files.sql
@drizzle/0007_phase2_rls_policies.sql
@drizzle/0008_phase2_lookup_seed.sql
@docs/migration-runbook.md
@CLAUDE.md

<interfaces>
<!-- Phase 1 migration log format (01-16-MIGRATION-LOG.md) is the structural template -->
<!-- DIRECT_DATABASE_URL points at port 5432 (non-pooler) — required by Drizzle Kit's DDL (CREATE INDEX CONCURRENTLY needs direct connection) -->
</interfaces>
</context>

<tasks>

<task type="auto" tdd="false">
  <name>Task 1: Apply 3 Phase 2 migrations + 12 post-migration smoke checks</name>
  <read_first>
    - .planning/phases/01-fundament/01-16-drizzle-push-blocking-PLAN.md (entire file — duplicate the structure)
    - .planning/phases/01-fundament/01-16-MIGRATION-LOG.md (Phase 1 log — the actual output format)
    - drizzle/meta/_journal.json (confirm idx 6, 7, 8 entries exist for 0006/0007/0008)
    - docs/migration-runbook.md
  </read_first>
  <files>
    .planning/phases/02-identiteit-bestanden/02-14-MIGRATION-LOG.md
  </files>
  <action>
    **Pre-checks (abort if any fail):**
    1. Verify `.env.local` (or Coolify env in staging) has `DIRECT_DATABASE_URL` pointing at the dev/staging Supabase Postgres on port 5432 (NOT pooler 6543).
    2. Verify journal has 3 new entries: `0006_phase2_profiles_and_files`, `0007_phase2_rls_policies`, `0008_phase2_lookup_seed`.
    3. Verify Phase 1 baseline is applied (run `psql ... -c "SELECT count(*) FROM pg_tables WHERE schemaname='public'"` — should return 19).
    4. Verify `app_user` Postgres role exists (from Phase 1).

    **Apply migrations:**
    ```bash
    npx drizzle-kit migrate 2>&1 | tee /tmp/drizzle-phase2-migrate.log
    ```

    Expected stdout:
    ```
    Applied migration 0006_phase2_profiles_and_files
    Applied migration 0007_phase2_rls_policies
    Applied migration 0008_phase2_lookup_seed
    Applied 3 migrations
    ```

    **Post-migration smoke checks (13 — each MUST pass):**
    ```bash
    psql "$DIRECT_DATABASE_URL" <<'SQL' | tee -a /tmp/drizzle-phase2-migrate.log
    -- 1. Phase 2 tables exist (4 new)
    SELECT count(*) AS phase2_tables FROM pg_tables WHERE schemaname='public'
      AND tablename IN ('players','trainers','uploaded_files','age_category_history');
    -- expect 4

    -- 2. Phase 2 lookup tables exist (2 new)
    SELECT count(*) AS phase2_lookups FROM pg_tables WHERE schemaname='public'
      AND tablename IN ('age_categories','trainer_diploma');
    -- expect 2

    -- 3. Phase 1 tables UNTOUCHED — total count 19 + 6 = 25
    SELECT count(*) AS total_tables FROM pg_tables WHERE schemaname='public';
    -- expect 25

    -- 4. RLS enabled + forced on all 4 new domain tables
    SELECT tablename, rowsecurity, forcerowsecurity FROM pg_tables
      WHERE schemaname='public'
        AND tablename IN ('players','trainers','uploaded_files','age_category_history')
      ORDER BY tablename;
    -- expect 4 rows × rowsecurity=t × forcerowsecurity=t

    -- 5. 19 named policies present (16 table + 3 storage)
    SELECT count(*) AS policy_count FROM pg_policy
      WHERE polname LIKE 'players_%' OR polname LIKE 'trainers_%'
         OR polname LIKE 'uploaded_files_%' OR polname LIKE 'age_category_history_%'
         OR polname LIKE 'profiles_%';
    -- expect 19

    -- 6. storage.buckets has 'profiles' (bootstrap successful)
    SELECT id, public FROM storage.buckets WHERE id='profiles';
    -- expect 1 row, public=f

    -- 7. CHECK constraint players_minor_emergency_contact present
    SELECT conname FROM pg_constraint
      WHERE conrelid = 'players'::regclass AND conname='players_minor_emergency_contact';
    -- expect 1 row

    -- 8. CHECK constraint uploaded_files_scan_status_enum present
    SELECT conname FROM pg_constraint
      WHERE conrelid = 'uploaded_files'::regclass AND conname='uploaded_files_scan_status_enum';
    -- expect 1 row

    -- 9. UNIQUE uniq_age_history_player_effective_from present
    SELECT conname FROM pg_constraint
      WHERE conrelid = 'age_category_history'::regclass
        AND conname='uniq_age_history_player_effective_from';
    -- expect 1 row

    -- 10. Lookup seed counts
    SELECT 'academy' AS tbl, count(*) FROM academy
    UNION ALL SELECT 'age_categories', count(*) FROM age_categories
    UNION ALL SELECT 'trainer_diploma', count(*) FROM trainer_diploma;
    -- expect academy=6, age_categories=7, trainer_diploma=5

    -- 11. players_visible_to() reachable (Phase 1 SECURITY DEFINER, used by Phase 2 policies)
    SELECT proname FROM pg_proc WHERE proname='players_visible_to';
    -- expect 1 row

    -- 12. End-to-end RLS smoke: create a fake TD user, set GUC, attempt SELECT on players
    --     (this should succeed even with 0 rows because RLS allows SELECT for TD)
    BEGIN;
      SET LOCAL app.user_id = '00000000-0000-0000-0000-000000000000';
      SET LOCAL app.user_role = 'technical_director';
      SELECT count(*) AS visible_to_td FROM players;
    -- expect 0 (no players yet); the query MUST succeed (RLS allows TD SELECT)
    COMMIT;

    -- 13. mark_scan_result SECURITY DEFINER function present + EXECUTE-granted to app_user
    SELECT proname, pg_get_userbyid(proowner) AS owner, prosecdef
      FROM pg_proc WHERE proname = 'mark_scan_result';
    -- expect 1 row, prosecdef=t (SECURITY DEFINER)
    SELECT has_function_privilege(
      'app_user',
      'mark_scan_result(uuid, text, text, timestamptz)',
      'execute'
    ) AS app_user_can_execute;
    -- expect t
    SQL
    ```

    **Capture output in `.planning/phases/02-identiteit-bestanden/02-14-MIGRATION-LOG.md`** using the Phase 1 01-16-MIGRATION-LOG.md template structure:

    ```markdown
    # Migration Log — Phase 2 Push

    **Date:** {ISO timestamp}
    **Target:** {staging | dev} Supabase project — {project-id}
    **Operator:** Claude (gsd-execute-phase)

    ## Pre-checks
    - [x] DIRECT_DATABASE_URL points at port 5432
    - [x] Journal lists 0006, 0007, 0008 (idx 6/7/8)
    - [x] Phase 1 baseline: 19 tables present
    - [x] app_user role exists

    ## Applied migrations
    {paste of `drizzle-kit migrate` stdout}

    ## File checksums (SHA-256)
    {output of `sha256sum drizzle/0006_phase2_profiles_and_files.sql drizzle/0007_phase2_rls_policies.sql drizzle/0008_phase2_lookup_seed.sql`}

    ## Post-migration smoke checks
    {paste of each SQL block + result}

    ## Verification matrix
    | # | Check | Expected | Actual | Status |
    |---|-------|----------|--------|--------|
    | 1 | Phase 2 domain tables | 4 | ? | ? |
    | 2 | Phase 2 lookup tables | 2 | ? | ? |
    | 3 | Total tables | 25 | ? | ? |
    | 4 | RLS enabled+forced on 4 new tables | 4×t/t | ? | ? |
    | 5 | Named policies | 19 | ? | ? |
    | 6 | profiles bucket (public=f) | 1×f | ? | ? |
    | 7 | players CHECK constraint | 1 | ? | ? |
    | 8 | uploaded_files scan_status CHECK | 1 | ? | ? |
    | 9 | age_history UNIQUE | 1 | ? | ? |
    | 10 | Lookup seeds | 6 / 7 / 5 | ? | ? |
    | 11 | players_visible_to fn | 1 | ? | ? |
    | 12 | TD RLS SELECT on players | 0 (success) | ? | ? |
    | 13 | mark_scan_result fn + EXECUTE granted to app_user | 1 row, prosecdef=t, can-execute=t | ? | ? |

    ## Credential revocation (WARNING-15)
    After the verification matrix is all-PASS, REMOVE `DIRECT_DATABASE_URL`
    from the Coolify web/worker runtime envs. It only needs to live in the
    one-shot migration-runner env. Leaving it in the runtime carries owner
    credentials in process memory and on disk for the lifetime of the deploy.
    Steps:
    1. `coolify env unset DIRECT_DATABASE_URL --app vttl-web`
    2. `coolify env unset DIRECT_DATABASE_URL --app vttl-worker`
    3. Confirm via `coolify env list --app vttl-web | grep -i direct` returns nothing
    4. Restart both apps to pick up the smaller env set

    DATABASE_URL (pooler, port 6543, app_user — RLS-enabled) stays — that's the runtime path.

    ## Next steps
    - Plan 02-15 RLS direct-query test + RBAC matrix (7×7) now turn GREEN
    - tRPC integration tests can run end-to-end
    - /api/health/ready returns 200 against the populated DB
    ```

    **If any check fails:**
    1. Do NOT proceed.
    2. Determine which migration caused the failure.
    3. Roll back via the corresponding `*.rollback.md` (run in reverse order: 0008 → 0007 → 0006).
    4. Fix the offending migration in a NEW migration (MIG-01 — never edit committed files).
    5. Re-run this plan.

    **Production deploy is OUT OF SCOPE** for this plan — staging-only. Production push is part of the Phase 8 release-gate process (or a later TD-approved release workflow).
  </action>
  <verify>
    <automated>test -f .planning/phases/02-identiteit-bestanden/02-14-MIGRATION-LOG.md && grep -q "Applied migration 0006_phase2_profiles_and_files\|Phase 2 Push" .planning/phases/02-identiteit-bestanden/02-14-MIGRATION-LOG.md && grep -q "Verification matrix" .planning/phases/02-identiteit-bestanden/02-14-MIGRATION-LOG.md && ! grep -Eq "\|\s*FAIL\s*\|" .planning/phases/02-identiteit-bestanden/02-14-MIGRATION-LOG.md</automated>
  </verify>
  <acceptance_criteria>
    - All 3 migrations report "Applied" in `drizzle-kit migrate` output
    - All 13 smoke checks pass (no FAIL rows in the verification matrix)
    - MIGRATION-LOG.md committed to git
    - Phase 1 baseline unchanged (`count(*) FROM pg_tables` was 19 before, 25 after)
    - DIRECT_DATABASE_URL removed from Coolify web/worker runtime envs (WARNING-15)
  </acceptance_criteria>
  <done>Phase 2 schema is live on dev/staging Supabase; integration tests can run end-to-end.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Migration runner ↔ DB | `DIRECT_DATABASE_URL` carries owner credentials; one-shot use in Coolify migration container |
| Staging push ↔ production | Production push is a separate, gated process (Phase 8) |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-02-14-CREDENTIALS | Information Disclosure / Elevation of Privilege | DIRECT_DATABASE_URL exposed in CI logs | mitigate | Coolify Secrets scope; rotate post-Phase-8 per Phase 1 migration runbook; never echo the URL in MIGRATION-LOG.md (paste output, not env) |
| T-02-14-PARTIAL-APPLY | Tampering / Availability | One of three migrations applies, second fails | mitigate | Each migration is in its own transaction (Drizzle Kit default); rollback runbooks in reverse order; smoke checks fail-fast |
| T-02-14-WRONG-TARGET | Information Disclosure | Migration accidentally targets production | mitigate | Pre-check verifies port 5432 (not pooler); operator confirms target name in MIGRATION-LOG.md header |
</threat_model>

<verification>
- 3 migrations applied
- 13/13 smoke checks pass
- 02-14-MIGRATION-LOG.md committed
- Phase 2 routers + tests can now exercise live tables
</verification>

<success_criteria>
- All 3 Phase 2 migrations live on dev/staging
- No Phase 1 schema drift
- Storage bucket `profiles` exists with `public=false`
- 18 lookup rows seeded
</success_criteria>

<output>
The MIGRATION-LOG.md itself IS the SUMMARY for this plan. Additionally create `.planning/phases/02-identiteit-bestanden/02-14-SUMMARY.md` with a 1-paragraph reference + link to the migration log.
</output>
