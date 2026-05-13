---
phase: 02-identiteit-bestanden
plan: 03
subsystem: database
tags: [drizzle, postgres, migration, additive, rollback, players, trainers, uploaded_files, age_categories, trainer_diploma, age_category_history]

# Dependency graph
requires:
  - phase: 02-identiteit-bestanden
    provides: "Drizzle TS schemas (02-02): players.ts, trainers.ts, files.ts, lookups.ts additions"
  - phase: 01-fundament
    provides: "Phase 1 base schema (users, status, academy lookups) + drizzle/meta/_journal.json contract"
provides:
  - "drizzle/0006_phase2_profiles_and_files.sql — DDL for 6 new tables, 3 named CHECK/UNIQUE constraints, 5 performance indexes, 12 FK constraints"
  - "drizzle/0006_phase2_profiles_and_files.rollback.md — canonical Risk/Procedure/Verification rollback companion"
  - "drizzle/meta/0006_snapshot.json — Drizzle snapshot reflecting the post-migration full schema state"
  - "drizzle/meta/_journal.json idx=6 entry with canonical tag 0006_phase2_profiles_and_files"
affects: [02-05-migration-0007-rls-policies, 02-08-migration-0008-lookup-seed, 02-09-trpc-router-file, 02-10-trpc-routers-player-trainer, 02-14-blocking-schema-push]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Hand-extraction of additive migration from drizzle-kit full-schema output (worktree pattern — same governance as Phase 1 hand-authored migrations 0000-0005)"
    - "Three-migration split for one schema delivery: 0006 schema, 0007 RLS, 0008 seed — each rollback-independent"
    - "FK ordering convention: lookup tables -> uploaded_files -> players/trainers -> age_category_history"

key-files:
  created:
    - drizzle/0006_phase2_profiles_and_files.sql
    - drizzle/0006_phase2_profiles_and_files.rollback.md
    - drizzle/meta/0006_snapshot.json
  modified:
    - drizzle/meta/_journal.json

key-decisions:
  - "Hand-extracted the additive subset from drizzle-kit output rather than committing the full-schema dump — drizzle-kit emitted CREATE TABLE for all 25 tables (no prior snapshot to diff against), but only 6 are new"
  - "Renamed drizzle-kit's auto-slug (0006_robust_sue_storm) to canonical 0006_phase2_profiles_and_files for Phase 2 plan/CI reference stability"
  - "Set DEFAULT 'BE' on country columns in players/trainers (matches TS schema; players are Belgian by default, no manual override required at INSERT time)"
  - "Index direction on idx_age_history_lookup is DESC NULLS LAST on effective_from — supports the typical 'latest active row as of date D' query in getAgeCategoryAt() (Pattern 2 in 02-RESEARCH)"

patterns-established:
  - "Hand-extracted additive migration pattern: run drizzle-kit generate to confirm column shapes, then carve out only the new CREATE TABLE / ALTER TABLE statements (governance per Phase 1 0001_medical_isolated.sql header)"
  - "Rollback companion canonical structure: Risk / Procedure (numbered + SQL block) / Verification (numbered psql commands) / When-to-roll-back / If-rollback-fails / Background / Forward-compatibility"
  - "DROP order for rollback: leaf tables first (age_category_history -> players + trainers -> uploaded_files -> lookups), CASCADE as belt-and-braces"

requirements-completed: [PLAYER-01, PLAYER-02, PLAYER-03, PLAYER-04, PLAYER-06, TRAINER-01, TRAINER-02, DOM-CAT-01, MIG-01, MIG-05]

# Metrics
duration: 18min
completed: 2026-05-13
---

# Phase 02 Plan 03: Migration 0006 (additive — players, trainers, uploaded_files) Summary

**Additive Drizzle migration 0006_phase2_profiles_and_files.sql lands 6 new tables (players, trainers, uploaded_files, age_category_history, age_categories, trainer_diploma) with 3 named CHECK/UNIQUE constraints and 5 performance indexes — zero ALTER on Phase 1 tables, expand-contract phase 1 ready for Plan 02-14 push.**

## Performance

- **Duration:** ~18 min
- **Started:** 2026-05-13T13:09:00Z (approx)
- **Completed:** 2026-05-13T13:18:00Z (approx)
- **Tasks:** 2 of 2
- **Files created:** 3 (migration SQL, rollback companion, snapshot JSON)
- **Files modified:** 1 (drizzle/meta/_journal.json)

## Accomplishments

- 6 new tables (players, trainers, uploaded_files, age_category_history, age_categories, trainer_diploma) emitted as a single additive migration with deterministic column shapes matching the TS schemas locked in 02-02
- 3 named CHECK/UNIQUE constraints (`players_minor_emergency_contact`, `uploaded_files_scan_status_enum`, `uniq_age_history_player_effective_from`) — referenceable from future migrations
- 5 performance indexes covering the academy, status, diploma, age-history-lookup, and uploaded-files-owner-scan access paths
- 12 FK constraints with explicit ON DELETE semantics (CASCADE for user-collapsed PK relations, RESTRICT for lookup-code references, SET NULL for profile photo links)
- Rollback companion documents the schema-DROP order with sequencing guidance for 0007 (RLS) and 0008 (seed) — passes `tests/unit/migration-format.test.ts` (MIG-05 canonical-marker contract)
- Verified `drizzle-kit generate` is idempotent against the resulting snapshot ("No schema changes, nothing to migrate")

## Task Commits

Each task was committed atomically:

1. **Task 1: Generate and audit migration 0006 SQL** — `3a81e3e` (feat)
2. **Task 2: Write rollback companion** — `21b6fc9` (docs)

## Files Created/Modified

- `drizzle/0006_phase2_profiles_and_files.sql` (247 lines) — DDL for 6 new tables, 12 FK constraints, 5 indexes; purely additive (no DROP / ALTER on Phase 1)
- `drizzle/0006_phase2_profiles_and_files.rollback.md` (65 lines) — canonical **Risk:** / **Procedure:** / **Verification:** markers + DROP order, sequencing guidance, forward-compatibility note
- `drizzle/meta/0006_snapshot.json` (~2,365 lines) — Drizzle full-schema snapshot reflecting post-migration state; idempotency baseline for future generate runs
- `drizzle/meta/_journal.json` (modified) — added idx=6 entry with canonical tag `0006_phase2_profiles_and_files`

## Named CHECK / UNIQUE Constraints (referenceable from future migrations)

| Constraint name | Table | Kind | Definition |
|-----------------|-------|------|------------|
| `players_minor_emergency_contact` | players | CHECK | `(NOT is_minor) OR (emergency_contact_name IS NOT NULL AND emergency_contact_phone IS NOT NULL)` |
| `uploaded_files_scan_status_enum` | uploaded_files | CHECK | `scan_status IN ('pending', 'clean', 'infected')` |
| `uploaded_files_sha256_format` | uploaded_files | CHECK | `sha256 IS NULL OR sha256 ~ '^[a-f0-9]{64}$'` |
| `uniq_age_history_player_effective_from` | age_category_history | UNIQUE | `(player_id, effective_from)` |
| `age_history_effective_to_after_from` | age_category_history | CHECK | `effective_to IS NULL OR effective_to >= effective_from` |
| `uniq_uploaded_files_storage_key` | uploaded_files | UNIQUE | `(storage_key)` |

## Performance Indexes

| Index | Table | Columns | Purpose |
|-------|-------|---------|---------|
| `idx_uploaded_files_owner_scan` | uploaded_files | `(owner_user_id, scan_status)` | List pending scans per user (worker 02-06); list clean files per user (profile gallery) |
| `idx_age_history_lookup` | age_category_history | `(player_id, effective_from DESC NULLS LAST, effective_to)` | Index-only scan for `getAgeCategoryAt(playerId, asOf)` (Pattern 2 in 02-RESEARCH) |
| `idx_players_academy` | players | `(academy_code)` | Roster per academy filter on admin player list |
| `idx_players_status` | players | `(status_code)` | A/B/C status filter on admin player list |
| `idx_trainers_diploma` | trainers | `(diploma_code)` | Trainer list per diploma on admin roster |

## Decisions Made

- **Hand-extraction over full-schema dump.** `drizzle-kit generate` with no prior snapshots in `drizzle/meta/` emits CREATE TABLE for **all** 25 tables (it has no diff baseline). Phase 1 migrations are also hand-authored for the same reason (see 0001_medical_isolated.sql header). I ran `drizzle-kit generate` once to confirm column shapes match the locked TS schemas verbatim, then extracted only the 6 new tables + 12 FK constraints + 5 indexes into the final 0006 SQL.
- **Filename rename to canonical slug.** Drizzle-kit picked auto-slug `0006_robust_sue_storm`. Renamed to `0006_phase2_profiles_and_files` (and updated `_journal.json` tag) so Phase 2 plan files and CI references stay stable. The auto-slug ordering would otherwise force every downstream plan to track a random name.
- **Snapshot retained at canonical name.** The Drizzle-generated `0006_snapshot.json` is the post-migration full-schema baseline — keeping it ensures the next `drizzle-kit generate` (Plan 02-07 onwards) does not re-emit Phase 2 schema as "new".
- **Rollback DROP order: explicit then CASCADE.** The procedure drops dependents-first (age_category_history -> players + trainers -> uploaded_files -> lookups) AND uses CASCADE on each. The explicit order keeps the DROP path deterministic; CASCADE guards against unexpected FK indexes introduced by 0007/0008 rollback gaps.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Installed `node_modules` to run `drizzle-kit generate`**
- **Found during:** Task 1 (run `npx drizzle-kit generate`)
- **Issue:** The worktree had no `node_modules/`, so `drizzle-kit` was not on PATH. The plan's Task 1 instruction to run `npx drizzle-kit generate` would fail.
- **Fix:** Ran `pnpm install --offline` (resolved from pnpm content-addressed store — no network needed). 
- **Files modified:** None tracked by git (`node_modules` is git-ignored).
- **Verification:** `npm run db:generate` produced output; `drizzle-kit` v0.31.10 confirmed.
- **Committed in:** N/A (no tracked files changed — the install is reproducible by `pnpm install`).

**2. [Rule 1 — Bug] Drizzle-kit emitted the full schema (not the additive diff)**
- **Found during:** Task 1 (audit the generated SQL)
- **Issue:** `drizzle/meta/` contains only `_journal.json` (no prior `0005_snapshot.json` because Phase 1 migrations are hand-authored). Without a snapshot to diff against, drizzle-kit produced `0006_robust_sue_storm.sql` containing CREATE TABLE for all 25 tables — including Phase 1 tables already deployed. Applying that file would error ("relation already exists") on every Phase 1 table.
- **Fix:** Following the same governance as Phase 1 (see 0001_medical_isolated.sql header: "Hand-authored... the agent worktree cannot run `npx drizzle-kit generate`"), I (a) deleted the full-schema `0006_robust_sue_storm.sql`, (b) renamed the auto-slug tag in `_journal.json` to canonical `0006_phase2_profiles_and_files`, (c) hand-extracted only the 6 new tables + 12 new FK constraints + 5 new indexes into the final SQL — every column / constraint / index / FK clause copied verbatim from drizzle-kit output for determinism.
- **Files modified:** drizzle/0006_phase2_profiles_and_files.sql (new), drizzle/meta/_journal.json (tag rename).
- **Verification:** `grep -c "^CREATE TABLE"` returns 6 (down from 25); `grep -v "^--" | grep -Ec "DROP TABLE|DROP COLUMN|TRUNCATE|ALTER COLUMN .* DROP NOT NULL"` returns 0; running `drizzle-kit generate` again reports "No schema changes, nothing to migrate" (idempotency baseline restored).
- **Committed in:** 3a81e3e (Task 1 commit).

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 bug)
**Impact on plan:** Both auto-fixes are essential — without (1), no SQL could be produced; without (2), the migration would corrupt Phase 1. No scope creep; the plan explicitly anticipates this in the Task 1 escape hatch ("If any expected block is missing... fix the upstream TS schema in `src/server/db/schema/*.ts` and re-run `npx drizzle-kit generate`") and in the wider Phase 1 hand-authoring precedent.

## Issues Encountered

- **Auto-slug filename from drizzle-kit.** The generator picked a deterministic-but-non-canonical filename (`0006_robust_sue_storm`). The plan anticipated this ("If Drizzle Kit emits filename `0006_some_other_slug.sql`... `mv drizzle/0006_*.sql drizzle/0006_phase2_profiles_and_files.sql` AFTER updating the matching `_journal.json` entry's `tag` field..."). Followed the documented mv + journal-edit procedure.

## User Setup Required

None — this plan does not change runtime behaviour. Migration 0006 is committed-ready but NOT applied to any DB; the push happens in plan 02-14.

## Next Phase Readiness

- Migration 0006 is committed-ready, additive, deterministic — `drizzle-kit generate` confirmed idempotent against the new snapshot.
- Plan 02-05 (migration 0007 — RLS policies) can build on the 6 new tables. It will attach `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` + `CREATE POLICY` statements; the rollback companion (Task 2) already declares the order constraint that 0007 must roll back BEFORE 0006.
- Plan 02-08 (migration 0008 — lookup seed) can populate `age_categories` and `trainer_diploma` rows.
- Plan 02-14 (BLOCKING — first DB push) will apply 0006 -> 0007 -> 0008 against staging Supabase and reconcile via `drizzle-kit introspect`.

## Self-Check: PASSED

- `drizzle/0006_phase2_profiles_and_files.sql` — FOUND (247 lines, 6 CREATE TABLE, 12 ALTER TABLE/ADD CONSTRAINT, 5 CREATE INDEX; 0 destructive statements outside comments).
- `drizzle/0006_phase2_profiles_and_files.rollback.md` — FOUND (65 lines; canonical `**Risk:**`, `**Procedure:**`, `**Verification:**` markers all present at line start).
- `drizzle/meta/0006_snapshot.json` — FOUND (idempotency baseline; `drizzle-kit generate` reports "No schema changes, nothing to migrate").
- `drizzle/meta/_journal.json` — UPDATED (idx=6 entry with canonical tag `0006_phase2_profiles_and_files`).
- Commit `3a81e3e` — FOUND (Task 1: `feat(02-03): add additive migration 0006_phase2_profiles_and_files`).
- Commit `21b6fc9` — FOUND (Task 2: `docs(02-03): add rollback companion for migration 0006`).
- `tests/unit/migration-format.test.ts` — PASSED (3/3: rollback companion present, sequential 4-digit numbering, canonical Risk/Procedure/Verification markers).

---
*Phase: 02-identiteit-bestanden*
*Completed: 2026-05-13*
