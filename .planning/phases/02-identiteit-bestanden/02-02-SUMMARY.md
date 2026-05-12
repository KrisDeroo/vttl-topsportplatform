---
phase: 02-identiteit-bestanden
plan: 02
subsystem: database
tags: [drizzle, postgres, schema, players, trainers, files, age-categories, rbac-prereq]

# Dependency graph
requires:
  - phase: 01-fundament
    provides: users + sessions + Better Auth integration, status/academy/training_type/ranking_type lookup tables, `tstz()` TIMESTAMPTZ helper, academy_memberships junction, audit_log + medical_access_audit, RLS function `players_visible_to()` placeholder
provides:
  - Drizzle pgTable `uploadedFiles` (uploaded_files) — bucket-agnostic single source of truth for every file managed by the platform (Phase 2/4/5 reuse)
  - Drizzle pgTable `players` (players) — user_id PK, full address, sport metadata, denormalised is_minor, CHECK-enforced minor-emergency-contact rule
  - Drizzle pgTable `ageCategoryHistory` (age_category_history) — temporal history with UNIQUE(player_id, effective_from) + composite index for getAgeCategoryAt() queries
  - Drizzle pgTable `trainers` (trainers) — user_id PK, diploma + pedagogical-qualification flag
  - Drizzle pgTable `ageCategories` (age_categories) lookup — birth-year boundary columns for deriveAgeCategory()
  - Drizzle pgTable `trainerDiploma` (trainer_diploma) lookup — 5-code TRAINER-02 enumeration
  - Barrel re-exports through `src/server/db/schema/index.ts` so downstream plans use `@/server/db/schema`
affects: [02-03-migration-0006-additive, 02-05-migration-0007-rls-policies, 02-07-trpc-schemas, 02-08-migration-0008-lookup-seed, 02-09-trpc-router-file, 02-10-trpc-routers-player-trainer, 02-14-blocking-schema-push, 02-15-tests]

# Tech tracking
tech-stack:
  added: []  # No new npm deps — drizzle-orm/zod/etc. already shipped in Phase 1
  patterns:
    - "Drizzle `check(name, sql\`...\`)` constraints with explicit names (Pattern 1 in 02-RESEARCH)"
    - "Composite B-tree index `idx_name`.on(t.col.desc(), ...) for time-range queries (Pattern 2 in 02-RESEARCH)"
    - "User-is-PK satellite tables: domain entities key on user_id (no surrogate id) to keep RLS predicates trivial (D-26)"
    - "Soft-delete via dedicated marker column (`superseded_at`, not `deleted_at`) for file replacement audit (D-30)"
    - "Denormalised is_minor on `players` + DB-level CHECK constraint for defense in depth above Zod (D-28, Pitfall 2)"

key-files:
  created:
    - src/server/db/schema/files.ts
    - src/server/db/schema/players.ts
    - src/server/db/schema/trainers.ts
    - .planning/phases/02-identiteit-bestanden/02-02-SUMMARY.md
  modified:
    - src/server/db/schema/lookups.ts
    - src/server/db/schema/index.ts

key-decisions:
  - "players.user_id is the PRIMARY KEY (D-26) — collapses player.id to user.id; RLS predicates can scope on users.id directly without an extra join."
  - "Trainers omit emergency_contact_* columns — TRAINER-01..02 makes no such requirement (only PLAYER-06)."
  - "Lookups age_categories + trainer_diploma stay language-neutral codes — no per-locale display_name columns (D-45 / I18N-06)."
  - "scan_status column carries a 3-value CHECK enum at DB level — Postgres native CHECK-on-text-enum is the cheapest path; no pgEnum (migration-fragile)."
  - "uploaded_files has no FK to players/trainers — file table is bucket-agnostic; back-reference belongs on the owning entity (e.g. players.profile_photo_file_id)."

patterns-established:
  - "Pattern A: New table that 1:0..1 binds to `users` — make user_id a primary-key FK with ON DELETE CASCADE; drop any surrogate id. Phase 2 establishes this for players and trainers; Phase 4 evaluation owners and Phase 5 medical authors can follow the same shape."
  - "Pattern B: File-like tables — owner FK with ON DELETE CASCADE; explicit `bucket` discriminator; UNIQUE on `storage_key`; lifecycle tracked via `scan_status` (CHECK enum), `scan_completed_at`, `superseded_at` (soft-delete), and an `(owner, scan_status)` composite index for sweeper cron queries."
  - "Pattern C: Temporal history tables (`*_history`) — `bigserial id` PK + UNIQUE on (entity_id, effective_from) + CHECK on (effective_to ≥ effective_from) + composite index on (entity_id, effective_from DESC, effective_to). Reusable for ranking_history (Phase 3) and status_history (Phase 4)."

requirements-completed:
  - PLAYER-01
  - PLAYER-02
  - PLAYER-03
  - PLAYER-04
  - PLAYER-06
  - TRAINER-01
  - TRAINER-02
  - DOM-CAT-01

# Metrics
duration: ~12min
completed: 2026-05-12
---

# Phase 2 Plan 02: Drizzle Schema (players, trainers, uploaded_files, age_category_history, age_categories, trainer_diploma) Summary

**Locked the Phase 2 TypeScript schema surface: 4 new domain tables + 2 lookups + barrel re-exports — `tsc --noEmit` green, every FK has an explicit ON DELETE rule, CHECK constraints for minor-emergency-contact + scan-status enum + sha256 format are declared with stable names, ready for Plan 02-03 to generate matching SQL.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-05-12T14:53:00Z (approx — first commit timestamp 2026-05-12T14:53)
- **Completed:** 2026-05-12T15:05:27Z
- **Tasks:** 5 / 5 (all `type="auto"`, no checkpoints)
- **Files created:** 3 (`files.ts`, `players.ts`, `trainers.ts`)
- **Files modified:** 2 (`lookups.ts`, `index.ts`)

## Accomplishments

- **3 new domain schema modules** wired into the Drizzle barrel: `files.ts` (74 lines), `players.ts` (127 lines, players + age_category_history), `trainers.ts` (65 lines). All meet `min_lines` constraints in the plan frontmatter.
- **6 new tables modelled in Drizzle**: `uploaded_files`, `players`, `age_category_history`, `trainers`, `age_categories`, `trainer_diploma`.
- **CHECK constraints with explicit names** (so Drizzle Kit generates predictable, stable SQL names that 02-15 integration tests will assert against):
  - `uploaded_files_scan_status_enum` — `IN ('pending','clean','infected')` (D-30)
  - `uploaded_files_sha256_format` — `IS NULL OR ~ '^[a-f0-9]{64}$'` (D-30)
  - `players_minor_emergency_contact` — `(NOT is_minor) OR (name AND phone NOT NULL)` (D-28, PLAYER-06)
  - `age_history_effective_to_after_from` — `effective_to IS NULL OR effective_to >= effective_from` (D-34)
- **UNIQUE + composite indexes** declared with stable names: `uniq_uploaded_files_storage_key`, `uniq_age_history_player_effective_from`, `idx_uploaded_files_owner_scan`, `idx_age_history_lookup (player_id, effective_from DESC, effective_to)` (D-33), `idx_players_academy`, `idx_players_status`, `idx_trainers_diploma`.
- **All FK ON DELETE rules explicit**: 11 FK declarations across the 3 new files; mix of `cascade` (user-owned data), `restrict` (lookup integrity), and `set null` (profile photo).
- **Barrel verified at runtime**: temporary `__barrel_check.ts` script asserts the 6 Phase 2 exports resolve through `@/server/db/schema` (script removed after success).
- **`users.image` from Phase 1 left untouched** — Phase 2 uses `players.profilePhotoFileId` not `users.image` (success-criteria item).

## Task Commits

Each task was committed atomically with no pre-commit hooks (parallel-worktree mode):

1. **Task 1: Create src/server/db/schema/files.ts** — `586ba2c` (feat)
2. **Task 2: Append ageCategories + trainerDiploma to lookups.ts** — `a1b68e2` (feat)
3. **Task 3: Create src/server/db/schema/players.ts (players + age_category_history)** — `29c3179` (feat)
4. **Task 4: Create src/server/db/schema/trainers.ts** — `6cb7d4c` (feat)
5. **Task 5: Update src/server/db/schema/index.ts barrel exports** — `8917d27` (feat)

## Files Created/Modified

- **`src/server/db/schema/files.ts` (created)** — `uploadedFiles` pgTable + `UploadedFile`/`NewUploadedFile` types. Single source of truth for every file managed by the platform; bucket-agnostic; `scan_status`/`sha256`/`updated_at` columns for the malware-scan worker (02-06) to fill via `mark_scan_result()` (02-05).
- **`src/server/db/schema/lookups.ts` (modified — appended)** — added `ageCategories` (birth-year boundary columns + `'age_unknown'` placeholder) and `trainerDiploma` (5-code TRAINER-02 enumeration). No per-locale display columns (D-45 / I18N-06). Phase 1 lookups (status, academy, tournament_type, ranking_type, training_type, organisation, outcome_level) untouched.
- **`src/server/db/schema/players.ts` (created)** — `players` pgTable (user_id PK, full address D-27, status/academy/age_category lookup FKs, is_minor + emergency contact, profile_photo_file_id) and `ageCategoryHistory` pgTable (bigserial PK, UNIQUE(player_id, effective_from), composite index for getAgeCategoryAt). Exports `Player`, `NewPlayer`, `AgeCategoryHistoryRow`, `NewAgeCategoryHistoryRow`.
- **`src/server/db/schema/trainers.ts` (created)** — `trainers` pgTable (user_id PK, identity + flat address, diploma_code FK + has_pedagogical_qualification, profile_photo_file_id). Exports `Trainer`, `NewTrainer`. No emergency-contact columns (TRAINER-02 doesn't require; PLAYER-06-only concern).
- **`src/server/db/schema/index.ts` (modified)** — appended `export * from './files'`, `./players`, `./trainers`; comment block updated; Phase 1 exports preserved verbatim.

## Decisions Made

- **Followed plan as specified.** All 5 tasks executed exactly per the plan's action blocks; no architectural deviations.
- **Drizzle `check()` API signature confirmed** in installed `drizzle-orm@0.45.2`: `check(name: string, value: SQL): CheckBuilder` — matches the plan's `check('name', sql\`...\`)` pattern and the Pattern 1 example in 02-RESEARCH.
- **`(t) => [...]` array-return table-builder syntax used** — drizzle-orm 0.45 supports both legacy object and new array form; the plan specifies array form (newer API, less verbose, type narrows the way `index().on(col.desc())` requires). Phase 1's `memberships.ts` still uses the legacy object form but that file is frozen per CLAUDE.md.
- **Barrel uses `export *`** for the new schemas (consistent with all Phase 1 schema files); explicit named exports would add maintenance burden without changing reachability.

## Deviations from Plan

None - plan executed exactly as written.

## Threat Surface Scan

No new security-relevant surface was added beyond what the plan's `<threat_model>` already lists (T-02-02-MINOR-DRIFT, T-02-02-CHECK-BYPASS, T-02-02-DISPLAY-NAME-PER-LOCALE). Mitigations for the first two are downstream (02-10 mutation logic + 02-15 integration test); the third was actively enforced during Task 2 (planner-grep'ed `display_name_(nl|en|fr)` returns 0 occurrences). No `threat_flag:` items to surface.

## Self-Check: PASSED

- `[FOUND]` `src/server/db/schema/files.ts` exists (74 lines)
- `[FOUND]` `src/server/db/schema/players.ts` exists (127 lines)
- `[FOUND]` `src/server/db/schema/trainers.ts` exists (65 lines)
- `[FOUND]` `src/server/db/schema/lookups.ts` modified (+36 lines, +2 exports — total 9 exports vs Phase 1's 7)
- `[FOUND]` `src/server/db/schema/index.ts` modified (+3 export lines)
- `[FOUND]` Commit `586ba2c` (Task 1, feat: uploaded_files schema)
- `[FOUND]` Commit `a1b68e2` (Task 2, feat: ageCategories + trainerDiploma lookups)
- `[FOUND]` Commit `29c3179` (Task 3, feat: players + age_category_history)
- `[FOUND]` Commit `6cb7d4c` (Task 4, feat: trainers schema)
- `[FOUND]` Commit `8917d27` (Task 5, feat: barrel re-exports)
- `[FOUND]` `npx tsc --noEmit` exits 0 across the project
- `[FOUND]` Runtime barrel reachability — all 6 of `players`, `trainers`, `uploadedFiles`, `ageCategoryHistory`, `ageCategories`, `trainerDiploma` resolve through `@/server/db/schema`

## Issues Encountered

None.

## Known Stubs

None — every column listed in the plan's truths/artifacts blocks is present with the specified type, default, and constraint. The lookup tables intentionally have placeholder birth-year boundaries (`age_categories` boundary columns nullable) per RESEARCH §Open Questions A2 — this is by design, not a stub; Plan 02-08 (lookup seed migration) inserts the rows with NULL boundaries and Plan 02-04 (`deriveAgeCategory` helper) returns `'age_unknown'` until the TD locks the canonical values.

## TDD Gate Compliance

Plan frontmatter is `type: execute` (not `type: tdd`); no TDD gates required for this plan. Test coverage for the schema invariants is owned by Plan 02-15 (integration tests against the actual database after the migrations in 02-03/05/08 apply).

## User Setup Required

None — no external service configuration required. Plan 02-03 will write the corresponding migration SQL; Plan 02-14 will blocking-push the schema to the live database.

## Next Phase Readiness

- **Ready for 02-03 (migration 0006 additive):** Drizzle Kit's `db:generate` can run against the locked schema to emit the SQL migration. All CHECK / UNIQUE / INDEX constraint names are explicit so the generated SQL is deterministic and reviewable.
- **Ready for 02-04 (storage + magic-bytes helpers):** `uploadedFiles` type + types are importable; helper code can type-check against `NewUploadedFile` during file.upload mutation drafting.
- **Ready for 02-05 (migration 0007 RLS policies):** RLS can target `players`, `trainers`, `uploaded_files` and call the existing `players_visible_to()` SECURITY DEFINER — `players.user_id` being the PK keeps the IN-clause trivial (D-26 dividend).
- **Ready for 02-07 (tRPC schemas):** Drizzle column shapes are stable; Zod schemas can mirror them with confidence.
- **Ready for 02-08 (lookup seed migration):** `age_categories` and `trainer_diploma` table shapes are locked; seed migration writes rows with NULL boundaries (age_categories) + 5 codes (trainer_diploma).

---
*Phase: 02-identiteit-bestanden*
*Plan: 02-02 (drizzle-schema-files)*
*Completed: 2026-05-12*
