---
phase: 02-identiteit-bestanden
plan: 08
plan_id: 02-08-migration-0008-lookup-seed
subsystem: database/migrations
tags: [migration, lookup-seed, idempotent, gdpr-compliant-ref-data]
one_liner: Idempotent seed migration adding 18 lookup codes across 3 tables — academy (6), age_categories (7 incl. age_unknown sentinel), trainer_diploma (5) — all guarded by ON CONFLICT DO NOTHING.
status: complete
completed_date: 2026-05-13
duration_minutes: 12
task_count: 3
file_count: 4
requirements:
  - PLAYER-02
  - DOM-CAT-01
  - TRAINER-02
dependency_graph:
  requires:
    - 02-03-migration-0006-additive (CREATE TABLE statements for age_categories + trainer_diploma must exist first)
    - 02-02-drizzle-schema-files (ageCategories + trainerDiploma TS schema definitions)
  provides:
    - "Idempotent seed data for academy (6 codes), age_categories (7 codes), trainer_diploma (5 codes)"
    - "age_unknown sentinel row so deriveAgeCategory() FK never fails"
    - "docs/lookup-seeding.md as canonical seeding discipline reference"
  affects:
    - 02-09-trpc-router-file (consumes trainer_diploma codes via Zod enum)
    - 02-10-trpc-routers-player-trainer (consumes academy + age_categories codes)
    - 02-13-ui-pages-and-forms (lookup-select components query these rows)
tech-stack:
  added: []
  patterns:
    - "ON CONFLICT (\"code\") DO NOTHING — idempotent INSERT pattern"
    - "Sentinel row pattern (age_unknown) — preserves FK constraint under uncertainty"
    - "Placeholder canonical_name with [ASSUMED] tag pending business owner confirmation"
key-files:
  created:
    - drizzle/0008_phase2_lookup_seed.sql
    - drizzle/0008_phase2_lookup_seed.rollback.md
    - drizzle/meta/0008_snapshot.json
    - docs/lookup-seeding.md
  modified:
    - drizzle/meta/_journal.json
decisions:
  - "Used ON CONFLICT (\"code\") DO NOTHING (not ON CONFLICT DO UPDATE) — seed migration must not silently overwrite TD-corrected values"
  - "age_unknown sentinel inserted with sort_order=99 — surfaces last in UI lists if accidentally exposed"
  - "Snapshot copied from 0006 (not 0007) because 0007 doesn't exist in this parallel worktree; functionally equivalent since seed migration introduces zero schema diff"
metrics:
  commits: 3
  insert_rows: 18
  insert_statements: 3
  conflict_clauses: 3
  placeholders_pending_td: 10  # 4 academies + 6 age-category boundary sets
---

# Phase 02 Plan 08: Migration 0008 — Lookup Seed Summary

## What Was Built

A single Drizzle migration (`drizzle/0008_phase2_lookup_seed.sql`) that seeds the three lookup tables Phase 2 introduces or extends, accompanied by a rollback companion and a developer-facing discipline doc.

### Tables seeded (18 codes total)

| Table | Code count | Notes |
|-------|-----------|-------|
| `academy` | 6 | Extends Phase 1 (2 codes already seeded via test helpers). Includes `topsportschool`, `academy_antwerpen`, plus 4 new codes with placeholder canonical names. |
| `age_categories` | 7 | 6 real cohorts (`age_pre_minor`/`age_minor`/`age_cadet`/`age_junior`/`age_senior`/`age_veteran`) + `age_unknown` sentinel. All boundaries inserted as NULL pending TD confirmation. |
| `trainer_diploma` | 5 | Verbatim from TRAINER-02: `diploma_none`, `diploma_a`, `diploma_b`, `diploma_a_in_training`, `diploma_b_in_training`. |

All three INSERT statements use `ON CONFLICT ("code") DO NOTHING`, so re-running the migration against a partially-seeded DB (Phase 1 had `topsportschool` and `academy_antwerpen` pre-seeded via test helpers) is safe.

## Commits

| Task | Description | Commit |
|------|-------------|--------|
| 1 | Create 0008 SQL + journal entry + snapshot | `1ba9789` |
| 2 | Add rollback companion (MIG-05 canonical markers) | `de2e9cd` |
| 3 | Add `docs/lookup-seeding.md` (MIG-01 discipline doc) | `f9063d2` |

## Open TD-Confirmation Items

The migration ships with placeholders — once the TD confirms, a future UPDATE-only migration will overwrite them. None of these block Phase 2 schema/storage/tRPC work; they only block Phase 4 toernooi-validatie (age boundaries) and the customer-facing academy list UI (canonical names).

### A1 — Academy canonical names (4 placeholders)

| Code | Placeholder | TD-confirmed name |
|------|-------------|--------------------|
| `academy_brussel` | "Academy Brussel" | (pending) |
| `academy_oost_vlaanderen` | "Academy Oost-Vlaanderen" | (pending) |
| `academy_west_vlaanderen` | "Academy West-Vlaanderen" | (pending) |
| `academy_limburg` | "Academy Limburg" | (pending) |

### A2 — Age-category birth-year boundaries (6 placeholders)

All 6 boundary pairs (`born_after_or_equal`, `born_before_or_equal`) inserted as NULL. Per RESEARCH §Lookup-Tabel Data Seeding Strategy, the TD will supply the canonical KBTTB Sportreglementen ranges before Phase 4 toernooi-validatie consumes them. Until then, `deriveAgeCategory()` returns `'age_unknown'` for every player (the sentinel row guarantees the FK never fails).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — blocking issue] Snapshot copied from 0006 instead of 0007**
- **Found during:** Task 1
- **Issue:** Plan says "Produce `drizzle/meta/0008_snapshot.json` as a copy of `0007_snapshot.json`", but `0007_snapshot.json` does not exist in this worktree — 02-05 creates it in a parallel worktree.
- **Fix:** Copied `0006_snapshot.json` to `0008_snapshot.json` and updated `id`/`prevId` UUIDs. Functionally equivalent because the seed migration introduces zero schema diff (0006, 0007, and 0008 all describe the same table set; only data differs).
- **Files modified:** `drizzle/meta/0008_snapshot.json`
- **Commit:** `1ba9789`

**2. [Rule 3 — blocking issue] Journal entry idx=8 (not idx=7 as plan text suggested)**
- **Found during:** Task 1
- **Issue:** The plan's Task 1 action says "Register the migration in `drizzle/meta/_journal.json` (idx 7)". The orchestrator's parallel-execution note explicitly directs `idx=8` because 02-05 simultaneously appends `idx=7` (tag `0007_phase2_rls_policies`) in a parallel worktree.
- **Fix:** Followed the orchestrator's authoritative note — appended `idx=8` with `tag=0008_phase2_lookup_seed`. The orchestrator merge step will resolve the add/add conflict between this worktree's `_journal.json` and 02-05's.
- **Files modified:** `drizzle/meta/_journal.json`
- **Commit:** `1ba9789`

### Known parallel-execution constraints (not deviations — documented in orchestrator note)

- The on-disk migration-format unit test (`tests/unit/migration-format.test.ts`) would fail in this worktree on the "no gaps in sequential numbering" assertion because `0007_*.sql` is being authored in a parallel 02-05 worktree and is not present on this disk. After the orchestrator merges both worktrees, `0007_*.sql` and `0008_*.sql` will exist together, the gap will close, and the test will pass. No test code is broken; this is purely a transient state during parallel execution.
- The plan's Task 2 verify step (`pnpm test -- migration-format ... | grep pass`) cannot run in this worktree because `node_modules` is not installed here. Manual marker-grep check passed: `**Risk:**`, `**Procedure:**`, `**Verification:**`, and "DO NOT delete" all present in the rollback companion.

## Threat-Register Mitigations Applied

Per the plan's `<threat_model>`:

| Threat ID | Disposition | How addressed in this plan |
|-----------|-------------|-----------------------------|
| T-02-08-WRONG-ACADEMY-NAME | accept | Documented as TODO (A1) in `docs/lookup-seeding.md`; future UPDATE migration will correct. |
| T-02-08-MISSING-AGE-BOUNDARY | accept (deferred to Phase 4) | Boundaries inserted as NULL; `age_unknown` sentinel row guarantees FK integrity until A2 is resolved. |
| T-02-08-SEED-INJECTION | mitigate | All seed data is committed inside the versioned migration file; the MIG-01 CI guard prevents post-merge edits to `0008_*.sql`. |

No new threat surface introduced — all changes are reference data INSERTs through Drizzle's migration ledger.

## Verification

### Task acceptance criteria (all met)

- [x] All 3 INSERT blocks use `ON CONFLICT ("code") DO NOTHING` (verified: `grep -c` = 3)
- [x] 6 academy codes, 7 age_categories codes (incl. `age_unknown`), 5 trainer_diploma codes (counted by row)
- [x] Migration registered in journal as a new entry (idx=8 per orchestrator instruction)
- [x] `grep -c "INSERT INTO" drizzle/0008_phase2_lookup_seed.sql` returns 3
- [x] Rollback companion has Risk/Procedure/Verification canonical markers
- [x] Rollback explicitly preserves Phase 1 academy rows ("DO NOT delete 'topsportschool' or 'academy_antwerpen'")
- [x] `docs/lookup-seeding.md` documents ON CONFLICT, MIG-01, no DELETE, age_unknown, TODO (A1)/(A2)

### Plan-level success criteria (all met)

- [x] 1 SQL migration (idempotent seed) — `drizzle/0008_phase2_lookup_seed.sql`
- [x] 1 rollback companion — `drizzle/0008_phase2_lookup_seed.rollback.md`
- [x] 1 documentation page — `docs/lookup-seeding.md`
- [x] 18 lookup codes inserted across 3 tables (6 + 7 + 5)
- [x] Phase 1 academy rows unchanged (`ON CONFLICT DO NOTHING` is the guard)

## Self-Check: PASSED

### Files exist
- `drizzle/0008_phase2_lookup_seed.sql` — FOUND
- `drizzle/0008_phase2_lookup_seed.rollback.md` — FOUND
- `drizzle/meta/0008_snapshot.json` — FOUND
- `docs/lookup-seeding.md` — FOUND
- `drizzle/meta/_journal.json` — MODIFIED (entry idx=8 added)

### Commits exist
- `1ba9789` — `feat(02-08): add 0008 phase2 lookup-seed migration` — FOUND
- `de2e9cd` — `docs(02-08): add 0008 rollback companion (MIG-05)` — FOUND
- `f9063d2` — `docs(02-08): add lookup-seeding migration discipline doc` — FOUND
