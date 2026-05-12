---
phase: 02-identiteit-bestanden
plan_id: 02-08-migration-0008-lookup-seed
plan: 08
type: execute
wave: 3
depends_on: [02-03-migration-0006-additive]
files_modified:
  - drizzle/0008_phase2_lookup_seed.sql
  - drizzle/0008_phase2_lookup_seed.rollback.md
  - drizzle/meta/_journal.json
  - drizzle/meta/0008_snapshot.json
  - docs/lookup-seeding.md
autonomous: true
requirements:
  - PLAYER-02
  - DOM-CAT-01
  - TRAINER-02

must_haves:
  truths:
    - "0008 migration inserts placeholder rows for 6 academy codes, 7 age_categories codes (incl. age_unknown), 5 trainer_diploma codes — all ON CONFLICT (code) DO NOTHING"
    - "Existing Phase 1 academy rows (topsportschool, academy_antwerpen) are NOT modified"
    - "age_categories rows have NULL boundaries by default (RESEARCH A2 — TD confirms ranges later)"
    - "Rollback companion lists each INSERT for reversal"
    - "docs/lookup-seeding.md documents the migration discipline (RESEARCH §Lookup-Tabel Data Seeding Strategy)"
  artifacts:
    - path: "drizzle/0008_phase2_lookup_seed.sql"
      provides: "ON CONFLICT idempotent INSERTs for the 3 lookup tables"
      contains: "INSERT INTO \"age_categories\""
      min_lines: 30
    - path: "drizzle/0008_phase2_lookup_seed.rollback.md"
      provides: "rollback DELETE statements"
      contains: "**Procedure:**"
    - path: "docs/lookup-seeding.md"
      provides: "developer doc on lookup migration discipline"
      contains: "ON CONFLICT"
  key_links:
    - from: "drizzle/0008_phase2_lookup_seed.sql"
      to: "drizzle/0006_phase2_profiles_and_files.sql (CREATE TABLE age_categories)"
      via: "INSERT depends on the table existing — Drizzle sequential apply"
      pattern: "INSERT INTO \"age_categories\""
---

<objective>
Seed the 3 lookup tables that Phase 2 introduces:

- **academies**: extend from Phase 1's 2 rows to the 6 PLAYER-02 codes. Canonical names for the 4 new codes are placeholders pending TD confirmation (RESEARCH A1).
- **age_categories**: the 7 codes (6 real + `age_unknown` fallback) with NULL birth-year boundaries (RESEARCH A2 — TD confirms ranges before Phase 4 toernooi-validatie).
- **trainer_diploma**: the 5 verbatim codes from TRAINER-02.

All INSERTs are `ON CONFLICT (code) DO NOTHING` so the migration is safe to re-run.

Also produce `docs/lookup-seeding.md` documenting the migration discipline.

Output: 1 SQL migration, 1 rollback companion, 1 doc.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/phases/02-identiteit-bestanden/02-CONTEXT.md
@.planning/phases/02-identiteit-bestanden/02-RESEARCH.md
@CLAUDE.md

<interfaces>
<!-- 02-02 schemas being seeded -->

```typescript
// src/server/db/schema/lookups.ts (extended in 02-02)
academy: { code (PK), canonicalName, sortOrder, active }
ageCategories: { code (PK), sortOrder, bornAfterOrEqual, bornBeforeOrEqual, active }
trainerDiploma: { code (PK), sortOrder, active }
```

Phase 1 already seeded `academy` with 2 codes via a separate path
(`tests/integration/trainer-academy.test.ts` line 35) — Phase 2 adds 4 more via migration so the production seed exists in version-controlled SQL.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="false">
  <name>Task 1: Create drizzle/0008_phase2_lookup_seed.sql</name>
  <read_first>
    - drizzle/0006_phase2_profiles_and_files.sql (Plan 02-03; confirms CREATE TABLE statements for academy / age_categories / trainer_diploma have run)
    - src/server/db/schema/lookups.ts (column list)
    - .planning/phases/02-identiteit-bestanden/02-RESEARCH.md §Lookup-Tabel Data Seeding Strategy (seed tables)
    - .planning/phases/02-identiteit-bestanden/02-CONTEXT.md D-44 (lookup label resolution)
  </read_first>
  <files>
    drizzle/0008_phase2_lookup_seed.sql
    drizzle/meta/_journal.json
    drizzle/meta/0008_snapshot.json
  </files>
  <action>
    Hand-author the seed migration:

    ```sql
    -- Migration 0008_phase2_lookup_seed.sql — Phase 2 Wave 2.
    -- Lookup reference data (idempotent ON CONFLICT DO NOTHING).
    --
    -- Phase 1 already seeded academy rows for 'topsportschool' and
    -- 'academy_antwerpen' via test helpers; Phase 2 extends with the
    -- remaining PLAYER-02 codes. Canonical names for the 4 new academies
    -- are placeholders pending TD confirmation (RESEARCH A1) — once
    -- confirmed, a future UPDATE-only migration will overwrite them.
    --
    -- age_categories: boundaries are intentionally NULL pending TD
    -- confirmation (RESEARCH A2). deriveAgeCategory() returns 'age_unknown'
    -- until at least one row has non-NULL boundaries.
    --
    -- trainer_diploma: 5 codes verbatim from TRAINER-02; no policy concerns.

    -- ─── academy (extends Phase 1 seed) ───
    INSERT INTO "academy" ("code", "canonical_name", "sort_order", "active") VALUES
      ('topsportschool',         'Topsportschool',         1, true),
      ('academy_antwerpen',      'Academy Antwerpen',      2, true),
      ('academy_brussel',        'Academy Brussel',        3, true),
      ('academy_oost_vlaanderen','Academy Oost-Vlaanderen',4, true),
      ('academy_west_vlaanderen','Academy West-Vlaanderen',5, true),
      ('academy_limburg',        'Academy Limburg',        6, true)
    ON CONFLICT ("code") DO NOTHING;
    --> statement-breakpoint

    -- ─── age_categories ───
    -- 'age_unknown' is the safety fallback returned by deriveAgeCategory()
    -- when no other row matches the player's birth year. Always kept active.
    INSERT INTO "age_categories"
      ("code", "sort_order", "born_after_or_equal", "born_before_or_equal", "active")
    VALUES
      ('age_pre_minor', 1, NULL, NULL, true),
      ('age_minor',     2, NULL, NULL, true),
      ('age_cadet',     3, NULL, NULL, true),
      ('age_junior',    4, NULL, NULL, true),
      ('age_senior',    5, NULL, NULL, true),
      ('age_veteran',   6, NULL, NULL, true),
      ('age_unknown',   99, NULL, NULL, true)
    ON CONFLICT ("code") DO NOTHING;
    --> statement-breakpoint

    -- ─── trainer_diploma ───
    INSERT INTO "trainer_diploma" ("code", "sort_order", "active") VALUES
      ('diploma_none',           1, true),
      ('diploma_a',              2, true),
      ('diploma_b',              3, true),
      ('diploma_a_in_training',  4, true),
      ('diploma_b_in_training',  5, true)
    ON CONFLICT ("code") DO NOTHING;
    --> statement-breakpoint
    ```

    Register the migration in `drizzle/meta/_journal.json` (idx 7) — same approach as 02-05 Task 1: prefer `npx drizzle-kit generate --name=phase2_lookup_seed` (Drizzle Kit will record the file even if it doesn't detect schema diffs); fall back to manual journal entry if needed.

    Produce `drizzle/meta/0008_snapshot.json` as a copy of `0007_snapshot.json` (no schema change beyond what 0006 introduced).

    Placeholder canonical names: `Academy Brussel`, `Academy Oost-Vlaanderen`, `Academy West-Vlaanderen`, `Academy Limburg` follow the obvious Belgian-province naming convention; the TD will confirm or correct via an UPDATE-only migration if these are wrong. Per RESEARCH A1, this assumption is documented as a TODO in `docs/lookup-seeding.md` (Task 3).

    Do NOT add ranking_type / training_type rows here — those tables already have full Phase 1 seeds (per `messages/nl.json` line 67+).
    Do NOT add an UPDATE statement attempting to back-fill age boundaries — leaving them NULL is the documented A2 fallback.
  </action>
  <verify>
    <automated>test -f drizzle/0008_phase2_lookup_seed.sql && grep -q "INSERT INTO \"academy\"" drizzle/0008_phase2_lookup_seed.sql && grep -q "INSERT INTO \"age_categories\"" drizzle/0008_phase2_lookup_seed.sql && grep -q "INSERT INTO \"trainer_diploma\"" drizzle/0008_phase2_lookup_seed.sql && grep -c "ON CONFLICT (\"code\") DO NOTHING" drizzle/0008_phase2_lookup_seed.sql | grep -qE "^[3-9]" && grep -q "age_unknown" drizzle/0008_phase2_lookup_seed.sql && grep -q "diploma_a_in_training" drizzle/0008_phase2_lookup_seed.sql && grep -q "0008_phase2_lookup_seed" drizzle/meta/_journal.json</automated>
  </verify>
  <acceptance_criteria>
    - All 3 INSERT blocks use `ON CONFLICT ("code") DO NOTHING`
    - 6 academy codes, 7 age_categories codes (incl. age_unknown), 5 trainer_diploma codes
    - Migration registered in journal as idx 7
    - `grep -c "INSERT INTO" drizzle/0008_phase2_lookup_seed.sql` returns 3
  </acceptance_criteria>
  <done>Lookup tables seedable in idempotent manner; Phase 1 rows preserved.</done>
</task>

<task type="auto" tdd="false">
  <name>Task 2: Write rollback companion 0008_phase2_lookup_seed.rollback.md</name>
  <read_first>
    - drizzle/0005_consenting_party_not_null.rollback.md (small-migration rollback example)
    - tests/unit/migration-format.test.ts (canonical markers required)
  </read_first>
  <files>
    drizzle/0008_phase2_lookup_seed.rollback.md
  </files>
  <action>
    ```markdown
    # Rollback — 0008_phase2_lookup_seed

    **Risk:** Low. Removing seed rows leaves the lookup tables empty (except for Phase 1's pre-seeded `topsportschool` and `academy_antwerpen`). After rollback, ANY `players` row with `academy_code` or `age_category` referencing a removed code would have its FK constraint violated — the migration must be rolled back BEFORE 0006 (the schema migration) OR the operator must accept that Phase 2 player data is non-existent at rollback time (which is the case during the Phase 2 build window).

    **Procedure:**
    1. Confirm `SELECT count(*) FROM players` returns 0 (rollback during build/test) OR confirm no `players.academy_code` value references one of the codes we are about to remove.
    2. Connect via `DIRECT_DATABASE_URL` and run:

       ```sql
       BEGIN;

       -- Reverse the trainer_diploma seed.
       DELETE FROM "trainer_diploma" WHERE "code" IN (
         'diploma_none', 'diploma_a', 'diploma_b',
         'diploma_a_in_training', 'diploma_b_in_training'
       );

       -- Reverse the age_categories seed.
       DELETE FROM "age_categories" WHERE "code" IN (
         'age_pre_minor', 'age_minor', 'age_cadet',
         'age_junior', 'age_senior', 'age_veteran', 'age_unknown'
       );

       -- Reverse the academy seed (preserve Phase 1 rows!).
       DELETE FROM "academy" WHERE "code" IN (
         'academy_brussel', 'academy_oost_vlaanderen',
         'academy_west_vlaanderen', 'academy_limburg'
       );
       -- DO NOT delete 'topsportschool' or 'academy_antwerpen' — those are Phase 1 seed.

       COMMIT;
       ```

    3. Update `drizzle/meta/_journal.json` to remove the `idx 7` entry; delete `drizzle/meta/0008_snapshot.json`.
    4. `git revert` the commit.

    **Verification:**
    1. `psql "$DIRECT_DATABASE_URL" -c "SELECT code FROM academy ORDER BY sort_order"` returns only `topsportschool` and `academy_antwerpen` (Phase 1 baseline).
    2. `psql "$DIRECT_DATABASE_URL" -c "SELECT count(*) FROM age_categories"` returns 0.
    3. `psql "$DIRECT_DATABASE_URL" -c "SELECT count(*) FROM trainer_diploma"` returns 0.
    4. Any `players` row still in the DB has had its FK to age_categories nullified beforehand (otherwise the DELETE would fail with FK violation — RESTRICT on the FK).

    ## When to roll back

    Use this rollback if the seed codes are wrong AND no production data references them. Once Phase 4 lands and `players.academy_code` rows reference the new codes, full rollback requires data migration (DELETE players first, which is a GDPR-implicating action).
    ```
  </action>
  <verify>
    <automated>test -f drizzle/0008_phase2_lookup_seed.rollback.md && grep -q "^\*\*Risk:\*\*" drizzle/0008_phase2_lookup_seed.rollback.md && grep -q "^\*\*Procedure:\*\*" drizzle/0008_phase2_lookup_seed.rollback.md && grep -q "^\*\*Verification:\*\*" drizzle/0008_phase2_lookup_seed.rollback.md && grep -q "DO NOT delete" drizzle/0008_phase2_lookup_seed.rollback.md && pnpm test -- migration-format 2>&1 | tail -5 | grep -qE "pass|PASS"</automated>
  </verify>
  <acceptance_criteria>
    - Canonical markers present
    - Rollback preserves Phase 1 academy rows
    - `pnpm test -- migration-format` passes
  </acceptance_criteria>
  <done>Reversible seed migration committed-ready.</done>
</task>

<task type="auto" tdd="false">
  <name>Task 3: Write docs/lookup-seeding.md</name>
  <read_first>
    - docs/migration-runbook.md (Phase 1 — style reference for tone and structure)
    - .planning/phases/02-identiteit-bestanden/02-RESEARCH.md §Lookup-Tabel Data Seeding Strategy
  </read_first>
  <files>
    docs/lookup-seeding.md
  </files>
  <action>
    ```markdown
    # Lookup-Tabel Seeding Discipline

    Lookup tables (`academy`, `status`, `ranking_type`, `tournament_type`,
    `training_type`, `organisation`, `outcome_level`, `age_categories`,
    `trainer_diploma`) hold reference data, not user data. The schema convention
    is documented in `src/server/db/schema/lookups.ts`:

    - `code text PRIMARY KEY` — language-neutral snake_case identifier
    - `sort_order integer NOT NULL` — UI render order
    - `active boolean NOT NULL DEFAULT true` — soft-retirement flag

    Display labels live in `messages/{nl,en,fr}.json` under
    `lookups.<table>.<code>` (D-44). Proper nouns (academies, clubs) follow the
    I18N-06 / D-45 rule: canonical names stored once on the row, rendered
    identically across locales.

    ## Migration discipline

    1. **Always use `ON CONFLICT ("code") DO NOTHING`** so seed migrations can
       be re-run safely against partially-seeded DBs (dev resets, staging
       refreshes, production after a hot-fix).
    2. **Never edit a committed seed migration** (MIG-01). If a code's
       `canonical_name` or `sort_order` is wrong post-commit, add a NEW
       migration with an UPDATE statement.
    3. **Never DELETE rows from a seed migration** unless the rollback path is
       to restore them (lookups underpin FK constraints on real data).
    4. **Document placeholder canonical names** with `[ASSUMED]` until the
       business owner confirms (current open items: 4 academies, age-category
       birth-year boundaries — RESEARCH A1 + A2).

    ## Current placeholders (TD action required)

    | Table | Code | Placeholder | Source of truth | Status |
    |-------|------|-------------|-----------------|--------|
    | academy | academy_brussel | Academy Brussel | TD-confirmed name | TODO (A1) |
    | academy | academy_oost_vlaanderen | Academy Oost-Vlaanderen | TD-confirmed name | TODO (A1) |
    | academy | academy_west_vlaanderen | Academy West-Vlaanderen | TD-confirmed name | TODO (A1) |
    | academy | academy_limburg | Academy Limburg | TD-confirmed name | TODO (A1) |
    | age_categories | age_pre_minor | NULL boundaries | KBTTB Sportreglementen | TODO (A2) |
    | age_categories | age_minor | NULL boundaries | KBTTB Sportreglementen | TODO (A2) |
    | age_categories | age_cadet | NULL boundaries | KBTTB Sportreglementen | TODO (A2) |
    | age_categories | age_junior | NULL boundaries | KBTTB Sportreglementen | TODO (A2) |
    | age_categories | age_senior | NULL boundaries | KBTTB Sportreglementen | TODO (A2) |
    | age_categories | age_veteran | NULL boundaries | KBTTB Sportreglementen | TODO (A2) |

    Until A2 is resolved, `deriveAgeCategory()` in `src/lib/players.ts` returns
    `'age_unknown'` for every player — the seed includes `age_unknown` as a
    sentinel row so the FK constraint never blocks a `player.create` mutation.

    ## Confirmation procedure (when TD supplies the data)

    1. Create a new migration `00NN_phase2_age_category_boundaries.sql` with the
       confirmed `UPDATE age_categories SET born_after_or_equal = ?, born_before_or_equal = ? WHERE code = ?` statements.
    2. Run the migration through the standard runbook (Phase 1 `docs/migration-runbook.md`).
    3. Re-run `tests/unit/players-derive-age-category.test.ts` with the
       confirmed boundaries; expect green.
    4. Communicate to the i18n catalog owner that `lookups.ageCategory.*` keys
       can now use confirmed labels (or stay verbatim — display labels are
       independent of boundary correctness).

    ## When NOT to use a seed migration

    - **User data** (players, trainers, evaluations). Use the application-level
      mutation surface (`admin.user.create` etc.).
    - **Test fixtures**. Use `tests/helpers/seed.ts` from Phase 1 — those are
      throwaway data, not version-controlled production seed.
    ```
  </action>
  <verify>
    <automated>test -f docs/lookup-seeding.md && grep -q "ON CONFLICT" docs/lookup-seeding.md && grep -q "MIG-01" docs/lookup-seeding.md && grep -q "age_unknown" docs/lookup-seeding.md && grep -q "TODO (A1)\|TODO (A2)" docs/lookup-seeding.md</automated>
  </verify>
  <acceptance_criteria>
    - Doc references the migration discipline (`ON CONFLICT`, MIG-01, no DELETE)
    - Placeholders table lists all 4 academies + all 6 age-category boundary TODOs
    - Confirmation procedure for TD documented
  </acceptance_criteria>
  <done>Developers and TD have a single reference for seed-data discipline.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Lookup seed data ↔ FK constraints | Removing a code breaks downstream FK references; rollback discipline mandatory |
| Placeholder canonical names ↔ UI rendering | Wrong canonical_name displays wrong text identically in nl/en/fr (D-45) until UPDATE migration |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-02-08-WRONG-ACADEMY-NAME | Information Disclosure (minor) | Placeholder name shown to users | accept | TD confirms via UPDATE migration; documented as TODO (A1) in docs/lookup-seeding.md; not blocking Phase 2 release of the schema itself. |
| T-02-08-MISSING-AGE-BOUNDARY | Repudiation | Tournament eligibility decisions made on `age_unknown` are non-actionable | accept (deferred to Phase 4) | Phase 2 does not use age boundaries for any business logic; Phase 4 toernooi-validatie is the consumer and will block until A2 is resolved. |
| T-02-08-SEED-INJECTION | Tampering | Direct INSERT of arbitrary lookup codes | mitigate | All seed via versioned migration; protected by MIG-01 CI guard; production deploy goes through the same migration runbook |
</threat_model>

<verification>
- 3 idempotent INSERTs run safely twice
- Phase 1 seed rows preserved (`topsportschool`, `academy_antwerpen`)
- `age_unknown` sentinel row inserted
- `pnpm test -- migration-format` passes
- `docs/lookup-seeding.md` documents A1 + A2 TODOs
</verification>

<success_criteria>
- 1 SQL migration (idempotent seed)
- 1 rollback companion (canonical markers)
- 1 documentation page
- 18 lookup codes inserted across 3 tables (6 + 7 + 5)
- Phase 1 academy rows unchanged
</success_criteria>

<output>
After completion, create `.planning/phases/02-identiteit-bestanden/02-08-SUMMARY.md` listing the 3 tables seeded, code counts, and the open TD-confirmation items (A1, A2).
</output>
