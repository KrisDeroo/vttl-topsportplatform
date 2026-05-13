---
phase: 02-identiteit-bestanden
plan: 05
subsystem: database
tags: [postgres, rls, security-definer, supabase-storage, drizzle, rbac, gdpr]

# Dependency graph
requires:
  - phase: 01-fundament
    provides: "current_user_id()/current_user_role() STABLE wrappers, players_visible_to() SECURITY DEFINER helper, ROLE_PERMISSIONS matrix, app_user role"
  - phase: 02-identiteit-bestanden/02-03-migration-0006-additive
    provides: "players, trainers, uploaded_files, age_category_history tables that this migration secures"
provides:
  - "Migration 0007 — ENABLE+FORCE RLS on the 4 new Phase 2 tables"
  - "16 per-action RLS policies (4 tables × SELECT/INSERT/UPDATE/DELETE)"
  - "3 storage.objects policies for the profiles bucket (defense-in-depth)"
  - "Idempotent storage.buckets bootstrap for `profiles` (public=false)"
  - "mark_scan_result() SECURITY DEFINER bridge for the BullMQ malware-scan worker (resolves BLOCKER-01)"
  - "16 new Permission codes (players.*, trainers.*, files.*) and per-role grants extending ROLE_PERMISSIONS"
  - "Rollback companion with canonical Risk/Procedure/Verification markers"
affects:
  - "02-06-malware-scan-worker"     # Worker calls mark_scan_result(...)
  - "02-09-trpc-router-file"        # Procedures call hasPermission(role, 'files.*')
  - "02-10-trpc-routers-player-trainer"  # Procedures call hasPermission(role, 'players.*'/'trainers.*')
  - "02-14-blocking-schema-push"    # Push 0007 to Supabase staging
  - "02-15-tests"                   # RLS unit + integration tests
  - "02-16-deployment-docs"         # Document bucket bootstrap + worker grant

# Tech tracking
tech-stack:
  added: []   # No new dependencies; pure Postgres DDL + TypeScript matrix
  patterns:
    - "Per-action RLS policy split (USING + WITH CHECK on every UPDATE) — Phase 2 reaffirms Phase 1 discipline"
    - "SECURITY DEFINER bridge function with pinned search_path + status whitelist + optimistic concurrency (mark_scan_result)"
    - "Defensive storage.buckets bootstrap with ON CONFLICT (id) DO NOTHING — idempotent across re-applies"
    - "Permission matrix extension via union expansion (strict superset — Phase 1 callers unaffected)"

key-files:
  created:
    - "drizzle/0007_phase2_rls_policies.sql (321 lines — 19 policies + bucket bootstrap + mark_scan_result fn)"
    - "drizzle/0007_phase2_rls_policies.rollback.md (Risk/Procedure/Verification + If-rollback-fails)"
    - "drizzle/meta/0007_snapshot.json (mirrors 0006 — RLS not in snapshot)"
  modified:
    - "src/server/auth/permissions.ts (16 new Permission codes; ROLE_PERMISSIONS extended for every role)"
    - "drizzle/meta/_journal.json (idx=7 appended; tag 0007_phase2_rls_policies)"

key-decisions:
  - "D-WORKER-RLS: SECURITY DEFINER mark_scan_result() function for BullMQ worker — resolves the no-GUC-context problem without granting the worker an over-broad bypass"
  - "Pattern 6 (storage.objects RLS) declared even though service-role key bypasses — defense in depth, drift-detection during review, forward-compat for anon-key paths"
  - "Trainer SELECT uses academy_memberships JOIN inline (not a new view) — Phase 1 helpers already work; no need for a new VIEW or function for one policy"
  - "DELETE policies present on every new table even though Phase 2 UI does not expose delete — Phase 7 erasure already wired"
  - "Single FOR ALL policy (profiles_td_all) is the documented exception — TD-explicit on bucket; all other 18 policies are per-action"

patterns-established:
  - "Per-action RLS: every table has SELECT + INSERT + UPDATE + DELETE explicit policy (no FOR ALL except documented TD-bucket exception)"
  - "WITH CHECK on every UPDATE: matches USING predicate so attacker cannot move row out of scope"
  - "SECURITY DEFINER worker-bridge: status whitelist + pending-only WHERE + pinned search_path + REVOKE PUBLIC + EXECUTE TO app_user"
  - "Idempotent bucket bootstrap: INSERT … ON CONFLICT (id) DO NOTHING (safe to re-run)"
  - "Permission union extension: strict superset — never remove a Phase 1 code, never reorder Role keys"

requirements-completed:
  - USER-04
  - PLAYER-05
  - PLAYER-07
  - FILE-03
  - MIG-01
  - MIG-05

# Metrics
duration: 7min
completed: 2026-05-13
---

# Phase 02 Plan 05: Migration 0007 — RLS Policies + mark_scan_result SECURITY DEFINER Summary

**Hand-authored Postgres migration 0007 — ENABLE+FORCE RLS on 4 new Phase 2 tables, 19 per-action policies reusing Phase 1 `players_visible_to()`, idempotent `profiles` bucket bootstrap, and `mark_scan_result()` SECURITY DEFINER bridge unblocking the malware-scan worker — paired with a 16-permission extension of `ROLE_PERMISSIONS` covering players/trainers/files for all 7 roles.**

## Performance

- **Duration:** ~7 min
- **Started:** 2026-05-13T11:27:36Z
- **Completed:** 2026-05-13T11:34:00Z
- **Tasks:** 3
- **Files created/modified:** 5 (3 created, 2 modified)

## Accomplishments

- Migration 0007 hand-authored: 4 ENABLE + 4 FORCE statements on `players`, `trainers`, `uploaded_files`, `age_category_history`
- 16 per-action policies (SELECT/INSERT/UPDATE/DELETE × 4 tables) + 3 storage.objects policies for the `profiles` bucket = **19 policies total**
- Defensive `INSERT INTO storage.buckets (id,name,public) VALUES ('profiles','profiles',false) ON CONFLICT (id) DO NOTHING` — idempotent A6 fallback
- `mark_scan_result(UUID, TEXT, TEXT, TIMESTAMPTZ) RETURNS BOOLEAN` SECURITY DEFINER function with status whitelist, pending-only optimistic concurrency, pinned `search_path`, `REVOKE … FROM PUBLIC`, `GRANT EXECUTE TO app_user` — resolves BLOCKER-01 (Decision D-WORKER-RLS)
- Rollback companion with all canonical markers (Risk / Procedure / Verification + When-to-rollback + If-rollback-fails) — `pnpm test -- migration-format` passes
- `ROLE_PERMISSIONS` matrix extended with 16 new Permission codes (`players.*` ×7, `trainers.*` ×5, `files.*` ×4) and every Role's array grew with the appropriate per-role grants — `npx tsc --noEmit` reports 0 errors

## Policy Inventory

### Section 1: ENABLE + FORCE RLS

| # | Table | Statement |
|---|-------|-----------|
| 1 | `players` | ENABLE + FORCE |
| 2 | `trainers` | ENABLE + FORCE |
| 3 | `uploaded_files` | ENABLE + FORCE |
| 4 | `age_category_history` | ENABLE + FORCE |

### Section 2-5: 16 per-action table policies

| # | Policy Name | Table | Action |
|---|-------------|-------|--------|
| 1 | `players_select` | players | SELECT |
| 2 | `players_insert` | players | INSERT |
| 3 | `players_update` | players | UPDATE (USING + WITH CHECK) |
| 4 | `players_delete` | players | DELETE |
| 5 | `trainers_select` | trainers | SELECT |
| 6 | `trainers_insert` | trainers | INSERT |
| 7 | `trainers_update` | trainers | UPDATE (USING + WITH CHECK) |
| 8 | `trainers_delete` | trainers | DELETE |
| 9 | `uploaded_files_select` | uploaded_files | SELECT |
| 10 | `uploaded_files_insert` | uploaded_files | INSERT |
| 11 | `uploaded_files_update` | uploaded_files | UPDATE (USING + WITH CHECK) |
| 12 | `uploaded_files_delete` | uploaded_files | DELETE |
| 13 | `age_category_history_select` | age_category_history | SELECT |
| 14 | `age_category_history_insert` | age_category_history | INSERT |
| 15 | `age_category_history_update` | age_category_history | UPDATE (USING + WITH CHECK) |
| 16 | `age_category_history_delete` | age_category_history | DELETE |

### Section 6: 3 storage.objects policies (profiles bucket)

| # | Policy Name | Target | Action |
|---|-------------|--------|--------|
| 17 | `profiles_owner_read` | storage.objects | SELECT (own folder) |
| 18 | `profiles_owner_write` | storage.objects | INSERT (own folder) |
| 19 | `profiles_td_all` | storage.objects | FOR ALL (TD-explicit — documented exception) |

### Section 7: SECURITY DEFINER bridge

| Name | Signature | Notes |
|------|-----------|-------|
| `mark_scan_result` | `(p_file_id UUID, p_status TEXT, p_sha256 TEXT, p_scanned_at TIMESTAMPTZ) RETURNS BOOLEAN` | Whitelisted statuses {clean, infected}; `WHERE scan_status='pending'`; pinned `SET search_path = pg_catalog, public`; EXECUTE granted to `app_user` only |

## Permission Codes Added (16)

### players (D-37) — 7 codes
- `players.read_any`         → TD, medical_staff
- `players.read_assigned`    → trainer, academy_manager, parent
- `players.read_own`         → player (self)
- `players.write`            → TD only (create/delete)
- `players.update_any`       → TD; academy_manager in scope (RLS narrows)
- `players.update_self`      → player + parent (acting for child)
- `players.set_age_category` → TD only (D-32)

### trainers (D-38) — 5 codes
- `trainers.read_any`        → TD, medical_staff
- `trainers.read_assigned`   → trainer, academy_manager in same academy
- `trainers.read_own`        → trainer (self)
- `trainers.write`           → TD only (create/delete)
- `trainers.update_self`     → trainer editing own non-sensitive fields

### uploaded_files (FILE-03) — 4 codes
- `files.upload`             → any authenticated user (own files)
- `files.read_any`           → TD, medical_staff
- `files.read_own`           → owner of the file
- `files.delete_any`         → TD only

## Task Commits

Each task was committed atomically (no-verify, parallel worktree branch):

1. **Task 1: Hand-author migration 0007** — `35a2c49` (feat)
   - `drizzle/0007_phase2_rls_policies.sql` (321 lines)
   - `drizzle/meta/_journal.json` (idx=7 appended)
   - `drizzle/meta/0007_snapshot.json` (mirror of 0006)
2. **Task 2: Rollback companion** — `c790940` (docs)
   - `drizzle/0007_phase2_rls_policies.rollback.md` with canonical markers
3. **Task 3: ROLE_PERMISSIONS extension** — `3967446` (feat)
   - `src/server/auth/permissions.ts` (+70 / -1)

_No metadata commit added — the orchestrator owns SUMMARY.md / STATE.md / ROADMAP.md commits at wave end (parallel executor mode)._

## Files Created/Modified

### Created
- `drizzle/0007_phase2_rls_policies.sql` — RLS DDL + storage bootstrap + SECURITY DEFINER fn
- `drizzle/0007_phase2_rls_policies.rollback.md` — rollback runbook
- `drizzle/meta/0007_snapshot.json` — stub (mirrors 0006; RLS not represented in Drizzle snapshots)
- `.planning/phases/02-identiteit-bestanden/02-05-SUMMARY.md` — this file

### Modified
- `src/server/auth/permissions.ts` — 16 new Permission codes; 7 Role arrays extended
- `drizzle/meta/_journal.json` — appended idx=7 (tag `0007_phase2_rls_policies`)

## Decisions Made

- **D-WORKER-RLS implementation (Section 7):** Chose a single SECURITY DEFINER `mark_scan_result()` function over (a) granting `app_user` a blanket `UPDATE uploaded_files SET scan_status = …` bypass policy, or (b) running the worker under a different DB role. Rationale: the function is the narrowest possible privilege — one operation, one column set, status whitelist, pending-only optimistic-concurrency guard. Mirrors the Phase 1 `players_visible_to()` pattern.
- **Snapshot is a mirror of 0006:** Drizzle Kit does not represent RLS / SECURITY DEFINER fns in its snapshot.json (schema introspection only sees `pgTable` definitions). Keeping the snapshot as an exact copy of 0006 means a future `drizzle-kit generate` against the live DB will not erroneously "discover" the RLS DDL as a schema diff.
- **Single FOR ALL policy is intentional:** `profiles_td_all` uses `FOR ALL` because the TD's storage privilege is mode-agnostic (read/write/delete are all allowed). Documented as the sole exception to per-action discipline; threat model entry T-02-05-FOR-ALL-POLICY confirms only one match.
- **No new helper functions:** All policies inline existing predicates (`current_user_id()`, `current_user_role()`, `players_visible_to()`, `academy_memberships` JOIN, `parent_child_links`). Resists the temptation to extract a new "trainer_visible_to()" helper — there is only one consumer (the `trainers_select` policy) so an inline JOIN is simpler.

## Deviations from Plan

None — plan executed exactly as written. All three tasks completed in order; no inline bug fixes were needed; no architectural decisions changed during execution. The migration file, rollback, and permissions extension all match the structures specified in the plan's `<action>` blocks.

## Issues Encountered

- **`node_modules` missing in worktree at agent start.** Resolved by `pnpm install --prefer-offline` before running `pnpm test -- migration-format`. This is a one-time environment setup, not a plan deviation. Did not commit as a separate task — the install only populates `node_modules/` (ignored).
- **`pnpm test -- rbac-matrix` fails with `ECONNREFUSED 127.0.0.1:6543`.** This is a pre-existing infrastructure failure (Supabase/Postgres not running locally) — confirmed by the worker note: "Pre-existing integration-test failures from these constraints are infrastructure-only and NOT regressions." The 36 test cases were SKIPPED (not failed); the only assertion failure is the `afterAll(dbHandle[asyncDispose])` teardown when `dbHandle` is undefined because beforeAll bailed on the missing DB. Type-checking (`npx tsc --noEmit`) is clean (0 errors), proving the new Permission codes integrate correctly with Phase 1 callers.

## User Setup Required

None — no external service configuration required at this plan step. Bucket bootstrap is idempotent and runs as part of `drizzle-kit migrate` in plan 02-14 (blocking schema push). The `mark_scan_result()` GRANT EXECUTE applies automatically when the migration runs as the migration owner. Plan 02-16 (deployment-docs) covers the operator-facing notes (rotating `app_user` password during rollback, etc.).

## Next Phase Readiness

- **02-06 (malware-scan worker):** Worker can immediately use `db.execute(sql\`SELECT mark_scan_result(${id}, ${status}, ${sha256}, ${ts})\`)`. The function is signed (status whitelist, pending-only, RETURNS BOOLEAN — log on FALSE).
- **02-09 (tRPC router file):** Procedures can call `hasPermission(ctx.user.role, 'files.upload' | 'files.read_own' | 'files.read_any' | 'files.delete_any')` for gating.
- **02-10 (tRPC routers player/trainer):** Same shape — `players.*` and `trainers.*` codes ready for `tdProcedure` / `protectedProcedure` integration.
- **02-14 (blocking schema push):** Run `drizzle-kit migrate` against staging — migration 0007 will apply after 0006 (idx ordering). RLS direct-query tests (added in 02-15) will then assert that wrong-scope `SELECT` returns 0 rows.
- **02-15 (tests):** Two new test surfaces are unlocked: (a) policy-level RLS unit tests against an isolated DB (per-table `WITH (rls) SELECT count(*)` patterns); (b) `mark_scan_result` unit test asserting status whitelist + pending-only + boolean return.

## Self-Check

### Files exist on disk

- `drizzle/0007_phase2_rls_policies.sql` — FOUND
- `drizzle/0007_phase2_rls_policies.rollback.md` — FOUND
- `drizzle/meta/0007_snapshot.json` — FOUND
- `src/server/auth/permissions.ts` (modified) — FOUND
- `drizzle/meta/_journal.json` (modified) — FOUND

### Commits exist in branch

- `35a2c49` Task 1 — FOUND
- `c790940` Task 2 — FOUND
- `3967446` Task 3 — FOUND

### Acceptance criteria

- 4 ENABLE + 4 FORCE statements — VERIFIED (`grep -c` returns 4/4)
- 19 named policies (16 per-action + 3 storage) — VERIFIED (`grep -c "CREATE POLICY"` returns 19)
- `mark_scan_result(UUID, TEXT, TEXT, TIMESTAMPTZ)` SECURITY DEFINER + EXECUTE granted to `app_user` + REVOKE FROM PUBLIC + `SET search_path = pg_catalog, public` — VERIFIED
- All 4 UPDATE policies have both `USING` and `WITH CHECK` — VERIFIED (4 UPDATE headers + 11 total `WITH CHECK` lines = 7 INSERT/UPDATE WITH CHECK on the 4 tables × 2 USING/WITH CHECK pairs in compound policies)
- Only `profiles_td_all` uses `FOR ALL` — VERIFIED (`grep -E "FOR ALL"` returns only one match)
- Storage bucket bootstrap idempotent (`ON CONFLICT (id) DO NOTHING`) — VERIFIED
- Migration registered as idx 7 in journal — VERIFIED
- 0 destructive operations (DROP POLICY / DROP TABLE) — VERIFIED (`grep -Ec "DROP POLICY|DROP TABLE"` returns 0 on non-comment lines)
- Canonical rollback markers (Risk / Procedure / Verification) — VERIFIED (`pnpm test -- migration-format` passes — 3/3 tests)
- 16 new Permission codes — VERIFIED (`'players.'` 19 hits = 7 in union + 12 in matrix; `'trainers.'` 12 hits = 5 union + 7 matrix; `'files.'` 18 hits = 4 union + 14 matrix)
- `npx tsc --noEmit` — VERIFIED (0 errors)

## Self-Check: PASSED

---
*Phase: 02-identiteit-bestanden*
*Plan: 02-05-migration-0007-rls-policies*
*Completed: 2026-05-13*
