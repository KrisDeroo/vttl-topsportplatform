---
phase: 02-identiteit-bestanden
plan: 10
subsystem: api
tags: [trpc, drizzle, postgres, rls, audit, rbac, gdpr, serializable, age-categories]

# Dependency graph
requires:
  - phase: 02-identiteit-bestanden
    provides: "playerCreateInput / playerSelfUpdateInput / playerSetAgeCategoryInput / trainer* schemas (02-07), players + ageCategoryHistory + trainers + memberships tables (02-02), RLS policies (02-05), deriveAgeCategory helper (02-04)"
  - phase: 01-fundament
    provides: "tdProcedure / protectedProcedure / sensitiveProcedure presets, writeAudit, withRlsContext (RLS GUC binder), isMinorAt, parent_child_links UNIQUE invariant"
provides:
  - "playerRouter: create, get, list, updateSelf, updateOnBehalfOf, updateAsTd, setAgeCategory"
  - "trainerRouter: create, get, list, updateSelf, updateAsTd"
  - "12 tRPC procedures total, mounted on appRouter as trpc.player.* and trpc.trainer.*"
  - "SERIALIZABLE-transaction recipe for age-category transition (Pitfall 6 mitigation)"
  - "BLOCKER-07 contract: ageCategoryHistory.effectiveFrom = TODAY at create, NOT DOB"
  - "WARNING-02 contract: player.create inserts academy_memberships(role='player')"
  - "WARNING-13 contract: player.updateSelf audit captures `changedFields` (field-name set, no PII)"
affects: [02-13-ui-pages-and-forms, 02-15-tests, 03-medical, 04-toernooi-validatie, 05-evaluaties, 07-admin-audit]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Per-procedure `ctx.db ?? rawDb` narrowing — RLS-aware transaction handle when present, raw pool as fallback"
    - "`.values(... as any)` cast on Drizzle 0.45 inserts — strict TS inference flags defaultNow tstz columns as required; mirrors the established admin.ts pattern (no `as unknown as typeof X.$inferInsert`)"
    - "Plain string for `date` columns (YYYY-MM-DD via `.toISOString().slice(0, 10)`) — Drizzle 0.45 binds string natively (no double-cast)"
    - "Transaction-scoped SERIALIZABLE isolation via `db.transaction(fn, { isolationLevel: 'serializable' })`"
    - "Defensive `if (!row) throw INTERNAL_SERVER_ERROR` after every `.returning()` — Drizzle's row type is `RowType | undefined`"

key-files:
  created:
    - "src/server/trpc/routers/player.ts (526 lines, 7 procedures)"
    - "src/server/trpc/routers/trainer.ts (232 lines, 5 procedures)"
  modified:
    - "src/server/trpc/routers/_app.ts (+9 lines — register player + trainer routers)"

key-decisions:
  - "playerSelfUpdateInput Zod `.strict()` is the D-37 RBAC whitelist — fields outside that schema (statusCode, academyCode, firstName, etc.) cannot be smuggled even with role spoofing because Zod rejects unknown keys before the router sees them"
  - "trainerSelfUpdateInput omits diplomaCode and hasPedagogicalQualification so D-38 self-upgrade attempts fail at the Zod layer (`.strict()` rejects)"
  - "BLOCKER-07: age_category_history.effective_from for the inaugural row is the player creation date (TODAY), not DOB. Tournament-time queries via getAgeCategoryAt(tournament_date) correctly return NULL for dates before player creation; backfilling pre-creation history is a Phase 5 concern"
  - "WARNING-02: player.create inserts academy_memberships(user_id, academy_code, role='player') in the same transaction, idempotent via .onConflictDoNothing(). Without this row the player is invisible to trainers/academy_managers via players_visible_to()"
  - "WARNING-13: player.updateSelf audit captures `changedFields: ['street', 'phone', ...]` (field-name set) instead of `oldValues/newValues: { updatedAt }` — field names are not PII and satisfy GDPR-04 accountability"
  - "setAgeCategory uses SERIALIZABLE isolation to prevent the Pitfall 6 race (two TDs concurrently inserting 'current' rows for the same player)"
  - "_app.ts intentionally does NOT add `file: fileRouter` — Plan 02-09 owns that wiring as a parallel-wave sibling; orchestrator reconciles during merge"

patterns-established:
  - "Pattern 1: Every state-changing mutation calls `writeAudit(ctx, { action, resourceType, resourceId, ...values })` AFTER the DB write; PII fields are intentionally omitted from `newValues`"
  - "Pattern 2: `get` procedures throw `NOT_FOUND` on zero-row RLS-filtered queries (D-36 enumeration prevention — same shape across player.get, trainer.get)"
  - "Pattern 3: Self-update procedures double-check `ctx.scope.role === 'player' | 'trainer'` for a clean 403 even though RLS would also block"
  - "Pattern 4: updateOnBehalfOf explicitly queries `parent_child_links` before the UPDATE — RLS is the second layer, the 404 here is for UI clarity"

requirements-completed:
  - PLAYER-01
  - PLAYER-02
  - PLAYER-03
  - PLAYER-04
  - PLAYER-05
  - PLAYER-06
  - PLAYER-07
  - TRAINER-01
  - TRAINER-02
  - TRAINER-03
  - DOM-CAT-01
  - DOM-CAT-02
  - USER-04

# Metrics
duration: 12min
completed: 2026-05-13
---

# Phase 02 Plan 10: tRPC Routers — Player & Trainer Summary

**12 tRPC procedures (7 player + 5 trainer) wiring D-37/D-38 schema-level RBAC, SERIALIZABLE age-category transitions, and BLOCKER-07/WARNING-02/WARNING-13 invariants — the only writeable path to the new Phase-2 tables.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-05-13T11:48:00Z
- **Completed:** 2026-05-13T11:55:34Z
- **Tasks:** 3
- **Files modified:** 3 (2 created, 1 edited)

## Accomplishments

- `playerRouter`: 7 procedures (`create`, `get`, `list`, `updateSelf`, `updateOnBehalfOf`, `updateAsTd`, `setAgeCategory`) wired with `tdProcedure` / `protectedProcedure` presets and the D-37 schema-level whitelist
- `trainerRouter`: 5 procedures (`create`, `get`, `list`, `updateSelf`, `updateAsTd`) wired with the D-38 self-update whitelist
- `setAgeCategory` runs a **SERIALIZABLE** transaction that closes the prior `effective_to IS NULL` row, inserts the new "current" row, and mirrors the snapshot onto `players` — Pitfall 6 (concurrent-TD age-category race) cannot leak two open rows
- `player.create` runs a 3-statement transaction (insert players + insert academy_memberships + insert inaugural ageCategoryHistory) honouring BLOCKER-07 (effective_from = TODAY) and WARNING-02 (academy_memberships(role='player'))
- `player.updateSelf` audit captures the `changedFields` set per WARNING-13 (forensically useful, GDPR-04 accountable, zero PII)
- `_app.ts` mounts both routers; `trpc.player.*` and `trpc.trainer.*` are now visible to typed React clients

## Task Commits

Each task was committed atomically:

1. **Task 1: Create src/server/trpc/routers/player.ts (7 procedures)** — `e5dfecf` (feat)
2. **Task 2: Create src/server/trpc/routers/trainer.ts (5 procedures)** — `952c23b` (feat)
3. **Task 3: Register both routers in src/server/trpc/routers/_app.ts** — `78dec88` (feat)

## Files Created/Modified

- **Created** `src/server/trpc/routers/player.ts` (526 lines) — playerRouter with 7 procedures, SERIALIZABLE setAgeCategory, BLOCKER-07/WARNING-02/WARNING-13 invariants honoured
- **Created** `src/server/trpc/routers/trainer.ts` (232 lines) — trainerRouter with 5 procedures, D-38 schema-level whitelist enforcement
- **Modified** `src/server/trpc/routers/_app.ts` (+9 lines) — added `import { playerRouter } from './player'`, `import { trainerRouter } from './trainer'`, and `player: playerRouter` / `trainer: trainerRouter` keys on `appRouter`

## Decisions Made

1. **BLOCKER-07 honour** — `player.create` inserts the inaugural `age_category_history` row with `effectiveFrom = TODAY` (player creation date in UTC YYYY-MM-DD), NOT `dateOfBirth`. Setting `effectiveFrom` to DOB would falsely claim the player has been in their current age-category since birth, breaking DOM-CAT-02's invariant that `getAgeCategoryAt(playerId, tournament_date)` returns the category in effect at tournament time. Phase 4 tournament-time queries for dates before player creation correctly return `null` — there is no historical category record before the player existed in the platform. Documented inline in player.ts with explicit reference to BLOCKER-07.

2. **WARNING-02 honour** — `player.create`'s transaction inserts a `academy_memberships(userId, academyCode, role='player', linkedBy=ctx.scope.userId)` row alongside the player row. Without this membership, the player is invisible to trainers and academy_managers via `players_visible_to()` (Phase 1 SECURITY DEFINER) used by the 02-05 RLS policies. Idempotent via `.onConflictDoNothing()` against the composite PK `(user_id, academy_code, role)`.

3. **WARNING-13 honour** — `player.updateSelf` audit captures `newValues: { changedFields: ['street', 'phone', ...] }` (field-name set), NOT `oldValues/newValues: { updatedAt }`. Field names are non-PII; the previous pattern was forensically useless (every update changes `updatedAt` so the diff was always `[]`). `changedFields` is allowed under the pino `log-redact-paths` convention because it carries no PII values.

4. **`ctx.db ?? rawDb` narrowing pattern** — Every handler reads `const dbHandle = (ctx.db as DbClient | undefined) ?? rawDb;` to honour the RLS-bound transaction when `withRlsContext` has run (which is for every `protectedProcedure` / `tdProcedure`), falling back to the raw pool for safety. Mirrors the established `admin.ts` pattern.

5. **`.values(... as any)` Drizzle insert cast** — Drizzle 0.45 strict TS inference flags `createdAt`/`updatedAt` columns (filled by `tstz(..., { defaultNow: true })`) as required, but the DB defaults are canonical. The `as any` cast mirrors the established `admin.ts` / `audit.ts` / `consent.ts` patterns. **BLOCKER-06 compliance verified: zero occurrences of `as unknown as string` or `as unknown as typeof X.$inferInsert` anywhere in player.ts or trainer.ts.**

6. **Plain string for `date` columns** — `dateOfBirth: input.dateOfBirth.toISOString().slice(0, 10)` (YYYY-MM-DD). Drizzle 0.45 binds plain strings to `date` columns natively (driver coerces). No `as unknown as string` double-cast.

7. **`_app.ts` does NOT add `file: fileRouter`** — Plan 02-09 (parallel wave-4 sibling) owns the `file` router wiring. Adding it here would break the typecheck (the router file does not exist in this worktree base) and would conflict with 02-09's edit. The orchestrator merges both worktrees and reconciles.

8. **`isMinor` null-handling** — `isMinorAt(...)` can return `null` only when DOB is null/invalid, but `playerCreateInput` / `playerUpdateAsTdInput` require a valid DOB via Zod (`z.coerce.date().max(new Date())`), so a null is a contract violation. Defensive default to `false` keeps the type narrow; the Zod validation is the actual gate.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 — Missing Critical] Defensive `if (!row) throw INTERNAL_SERVER_ERROR` after every `.returning()`**
- **Found during:** Task 1 (player.ts) and Task 2 (trainer.ts)
- **Issue:** The plan's inline code referenced `created.userId` / `updated.statusCode` directly after destructuring `const [row] = await ...returning();`. Drizzle types `.returning()` as `RowType[]`, so `[row]` is `RowType | undefined`. A failed insert (constraint violation manifesting as zero rows returned) would crash with "Cannot read properties of undefined" instead of a clean tRPC `INTERNAL_SERVER_ERROR` — and the unhandled error is harder to diagnose downstream.
- **Fix:** Added `if (!row) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'player_insert_returned_no_row' })` (and analogous guards for `updated`, `newRow`) after every `.returning()` destructure in both routers. Mirrors the established `admin.ts` pattern (e.g. `if (!u) throw ...user_insert_returned_no_row`).
- **Files modified:** `src/server/trpc/routers/player.ts`, `src/server/trpc/routers/trainer.ts`
- **Verification:** `npx tsc --noEmit` exits 0; reachable code paths after the guards safely deref the row without optional-chaining.
- **Committed in:** `e5dfecf` (Task 1), `952c23b` (Task 2)

**2. [Rule 3 — Blocking] _app.ts does NOT add `file: fileRouter` even though the plan's Task-3 action lists it**
- **Found during:** Task 3 (_app.ts)
- **Issue:** The plan's action prescribes `file: fileRouter, // NEW (Phase 2)` and the verify line greps for `file: fileRouter`. But the `src/server/trpc/routers/file.ts` file is created by Plan 02-09 (a parallel-wave sibling, also wave 4) and does not exist in this worktree. Adding the import would have failed the typecheck.
- **Fix:** Added only `player: playerRouter` and `trainer: trainerRouter` to `appRouter`. Documented inline in the commit message and JSDoc. The orchestrator will merge both worktrees and the final `_app.ts` will carry all three (file + player + trainer).
- **Files modified:** `src/server/trpc/routers/_app.ts`
- **Verification:** `npx tsc --noEmit` exits 0; the file-router import would have failed compile, which would have blocked subsequent waves.
- **Committed in:** `78dec88` (Task 3)

---

**Total deviations:** 2 auto-fixed (1 missing-critical correctness guard, 1 blocking parallel-wave conflict)
**Impact on plan:** Both auto-fixes are correctness requirements for parallel wave-4 execution. No scope creep — the schema-level RBAC, audit, and concurrency contracts are exactly as planned.

## Issues Encountered

- ESLint flat-config crashes with "Converting circular structure to JSON" when invoked on changed files. Pre-existing infrastructure issue (per environment_note "Pre-existing failures... are infrastructure-only and NOT regressions"). Not a regression; out of scope.

## Verification

- `npx tsc --noEmit` exits 0 (all of `src/`)
- 7 procedures in playerRouter, 5 in trainerRouter — totals match plan's `<verification>` (12 procedures)
- `isolationLevel: 'serializable'` appears exactly once (in `setAgeCategory`)
- 0 occurrences of `as unknown as string` or `as unknown as typeof X.$inferInsert` (BLOCKER-06 compliance)
- `writeAudit` invoked in every state-changing procedure (5 in playerRouter, 3 in trainerRouter)
- `player.create` inserts BOTH `academyMemberships` (role='player') AND `ageCategoryHistory` (effectiveFrom = TODAY) in the same transaction
- `player.updateSelf` audit shape: `newValues: { changedFields }` (field-name set, no PII)

## Threat Surface

All threat-register dispositions from the plan's `<threat_model>` are mitigated:

- **T-02-10-SELF-UPDATE-PRIVESC**: Zod `.strict()` on `playerSelfUpdateInput` + role check + RLS UPDATE policy (three layers)
- **T-02-10-AGE-RACE**: `{ isolationLevel: 'serializable' }` on `setAgeCategory` transaction
- **T-02-10-PARENT-WRONG-CHILD**: explicit `parent_child_links` query in `updateOnBehalfOf` before UPDATE
- **T-02-10-MINOR-DRIFT**: `updateAsTd` recomputes `isMinorAt(dob, now)`; CHECK constraint at DB layer enforces emergency-contact consistency
- **T-02-10-AUDIT-PII-LEAK**: PII fields (first/last name, address, phone, email, emergency contact) intentionally OMITTED from every `writeAudit` call

No new threat-flagged surface introduced beyond what the plan already documented.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `trpc.player.*` and `trpc.trainer.*` are mounted and typed
- Plan 02-13 (UI pages and forms) can consume these procedures via the typed React client
- Plan 02-15 (integration tests) can probe each procedure against the threat-register mitigations (per-test concrete assertions already specified in the threat table)
- After orchestrator merge with Plan 02-09, `_app.ts` will carry `file: fileRouter` plus our two routers; no further reconciliation needed

## Self-Check: PASSED

- File `src/server/trpc/routers/player.ts`: FOUND
- File `src/server/trpc/routers/trainer.ts`: FOUND
- File `src/server/trpc/routers/_app.ts`: FOUND (modified)
- Commit `e5dfecf` (Task 1 — playerRouter): FOUND in `git log`
- Commit `952c23b` (Task 2 — trainerRouter): FOUND in `git log`
- Commit `78dec88` (Task 3 — _app.ts wiring): FOUND in `git log`
- `npx tsc --noEmit` exit 0: PASS
- 0 `as unknown as string` / 0 `as unknown as typeof X.$inferInsert`: PASS (BLOCKER-06)
- `player.create` inserts `academy_memberships` AND `age_category_history(effectiveFrom=TODAY)`: PASS (BLOCKER-07 + WARNING-02)
- `player.updateSelf` audit uses `changedFields` shape: PASS (WARNING-13)
- No modifications to STATE.md / ROADMAP.md: PASS

---
*Phase: 02-identiteit-bestanden*
*Completed: 2026-05-13*
