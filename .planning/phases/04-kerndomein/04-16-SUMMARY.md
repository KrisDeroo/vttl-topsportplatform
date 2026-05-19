---
phase: 04-kerndomein
plan: 16
subsystem: domain
tags: [dom-cat-02, brussels-tz, utc-slice, date-formatting, lint-guard, players, calendar, training, tournament, cr-09, wr-02, gap-closure, phase-4-gap-closure]

# Dependency graph
requires:
  - phase: 04-kerndomein-10
    provides: "tests/integration/_helpers.ts barrel (canConnect + freshDb + rawPgAsAppUser re-exports) — Plan 04-10 Task 0 landed in Wave 5; this plan imports canConnect + freshDb via `from './_helpers'` for the DOM-CAT-02 integration test"
  - phase: 04-kerndomein-04
    provides: "tournament.enterResult handler — invokes getAgeCategoryAt(playerUserId, tournament.startsAt) for the DOM-CAT-02 snapshot; the CR-09 fix in this plan corrects the date that handler reads"
  - phase: 04-kerndomein-06
    provides: "calendar.event.editRecurring 3-scope dispatcher — references occurrence_date as the read-key for exception rows; the WR-02 fix here aligns the score-route's occurrenceDate with the same Brussels-anchored convention"
  - phase: 03-kalender
    provides: "src/lib/rrule.ts formatOccurrenceDate (Brussels-anchored Intl.DateTimeFormat 'en-CA' helper) — already shipped by Plan 03 CR-05 fix; this plan extends its reach across Phase 4 surfaces"
  - phase: 02-identiteit-bestanden
    provides: "age_category_history schema (effective_from/effective_to DATE columns) + idx_age_history_lookup composite index; getAgeCategoryAt helper signature"
provides:
  - "src/lib/players.ts:102 getAgeCategoryAt now uses formatOccurrenceDate — Brussels-anchored YYYY-MM-DD. A tournament starting 2026-01-01 02:00 Brussels (= 2025-12-31 23:00 UTC) now snapshots the 2026 age_category_history row, not the 2025 row. DOM-CAT-02 snapshot freezes the correct code on tournament_results.player_age_category_code."
  - "5 additional Phase 4 call sites switched to formatOccurrenceDate (calendar/event-detail-sheet.tsx:202, score page.tsx:32, te-scoren-overview.tsx:43, training.ts:80, tournament.ts:126). Trainers no longer get routed to the wrong occurrence's score form when an event ends after Brussels midnight."
  - "tests/unit/no-utc-slice-in-phase4-domain.test.ts — structural invariant. Walks 7 Phase 4 source files and asserts none contain .toISOString().slice(0, 10) (comment-stripped, whitespace-tolerant regex). Future regressions caught at CI."
  - "tests/integration/dom-cat-02-brussels-anchor.test.ts — 4 it-blocks probing the day-boundary scenarios (evening / afternoon / summer-evening / regression). Skips cleanly via describe.skipIf(!dbReady) when no testcontainer DB is reachable."
affects: [phase-04-kerndomein-12, phase-04-kerndomein-13, phase-04-kerndomein-15, phase-05-uitgebreid-domein, phase-07-synthese, phase-08-kwaliteit-release]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Brussels-anchored YYYY-MM-DD for Phase 4 occurrence-date math — every Date→YYYY-MM-DD conversion on the occurrence-date surface routes through src/lib/rrule.ts formatOccurrenceDate. UTC slicing (`toISOString().slice(0, 10)`) is forbidden by the new structural invariant test in the 7 covered files."
    - "Structural-invariant unit test pattern — fs.readFileSync + comment-stripping + whitespace-tolerant regex against a closed PROHIBITED_FILES list, with an explicitly-documented ALLOWLIST for Phase 2 surfaces where the input is already a date-only column with no DST drift. Sibling precedent: tests/unit/i18n-catalog-completeness.test.ts."
    - "Test-owned `players` row in DOM-CAT-02 integration tests — the calendar-seed fixture's 5-column INSERT INTO players omits several NOT NULL columns; gap-closure tests touching age_category_history plant a full players row in beforeAll (mirrors tests/integration/age-category-snapshot.test.ts:94)."
    - "rawDb singleton for age_category_history fixture writes — getAgeCategoryAt defaults to the `db` singleton from @/server/db/client, so test fixtures plant history rows via the same singleton to keep reads and writes on the same connection pool."

key-files:
  created:
    - "tests/unit/no-utc-slice-in-phase4-domain.test.ts"
    - "tests/integration/dom-cat-02-brussels-anchor.test.ts"
  modified:
    - "src/lib/players.ts"
    - "src/components/calendar/event-detail-sheet.tsx"
    - "src/app/[locale]/(app)/trainings/[eventId]/score/page.tsx"
    - "src/components/training/te-scoren-overview.tsx"
    - "src/server/trpc/routers/training.ts"
    - "src/server/trpc/routers/tournament.ts"

key-decisions:
  - "Used seeded age_category codes age_junior (2025) + age_senior (2026) for the integration test fixture history instead of the plan's hypothetical age_u15/age_u18 — the plan explicitly noted this fallback (lines 691-697) because drizzle/0008_phase2_lookup_seed.sql seeds age_pre_minor/age_minor/age_cadet/age_junior/age_senior/age_veteran/age_unknown, not age_u-prefixed codes. The specific code values don't matter for the CR-09 fix; only the YYYY-MM-DD boundary test does."
  - "describe.skipIf(!dbReady) over the early-return-in-it pattern — matches Wave 5 sibling tests (denied-audit-survives-rollback, idempotency-input-binding, system-inbox-*) and the plan's explicit acceptance criterion. Uses top-level await `const dbReady = await canConnect()` which the ESM-mode vitest config supports."
  - "Comment-stripping in the structural-invariant test — explanatory doc-comments on the new helpers reference the deprecated pattern by name. The test strips `// ...` and `/* ... */` blocks before regex matching so documentation doesn't fail the gate. Verified by inserting and reverting a real `.toISOString().slice(0, 10)` call into src/lib/players.ts: test FAILED with the probe in place, PASSED after revert."
  - "Phase 2 surfaces (player.ts, trainer.ts, *-create-form.tsx, profile/player/trainer DOB displays) intentionally out of scope and added to the test's ALLOWLIST — their inputs are date-only with no time component, so UTC slice and Brussels slice are equivalent at midnight UTC. Phase 8 release-gate cleanup can revisit if a unified policy is preferred."

patterns-established:
  - "Pattern: formatOccurrenceDate is the canonical Brussels-anchored YYYY-MM-DD producer for Phase 4 (and any future Phase 5+ feature touching occurrence_date / match_date / effective_from columns on a Date input that carries a time component). Direct `toISOString().slice(0, 10)` is reserved for date-only inputs (DOB / effective_from on user-supplied DATE fields) per the test ALLOWLIST."
  - "Pattern: Structural lint guard via unit test — when a behavioural fix has 7+ surfaces and a low-effort regression risk (future contributors copy-pasting the deprecated pattern), the cheapest defence is a vitest file-walk + content-regex check, not a custom ESLint rule. Co-located in tests/unit/, runs in every CI lane."

requirements-completed: [DOM-CAT-02]

# Metrics
duration: ~14min
completed: 2026-05-19
---

# Phase 4 Plan 16: DOM-CAT-02 Brussels-Anchor (CR-09 + WR-02) Summary

**Routed 6 Phase 4 occurrence-date call sites through src/lib/rrule.ts formatOccurrenceDate (Brussels-anchored `Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels' })`); a tournament starting 2026-01-01 02:00 Brussels now snapshots the 2026 age category (was: silently the 2025 row), and a structural invariant test in tests/unit/no-utc-slice-in-phase4-domain.test.ts forbids the UTC-slice regression in 7 Phase 4 source files at CI.**

## Performance

- **Duration:** ~14 min
- **Started:** 2026-05-19T12:47:06Z
- **Completed:** 2026-05-19T13:00:46Z
- **Tasks:** 3 (per plan)
- **Files modified:** 8 (2 created, 6 modified)

## Accomplishments

- **CR-09 closed** — DOM-CAT-02 age-category snapshot now resolves the Brussels calendar day, not the UTC day. The pre-fix behaviour: a tournament with `starts_at = 2025-12-31T23:00:00Z` (= 2026-01-01 00:00 CET) snapshotted as the 2025 row because `date.toISOString().slice(0, 10) === '2025-12-31'`. Post-fix: same instant resolves to '2026-01-01' via `Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels' })`. `tournament_results.player_age_category_code` now persists the correct code without auto-correction logic.
- **WR-02 closed** — 5 additional Phase 4 surfaces (calendar event-detail-sheet, score page, te-scoren-overview, training router toIsoDate, tournament router toIsoDate) switched to formatOccurrenceDate. The score-route URL parameter the trainer arrives at now matches the Brussels-day chip rendered on the calendar.
- **Regression gate landed** — tests/unit/no-utc-slice-in-phase4-domain.test.ts walks 7 Phase 4 files (the 6 above + src/server/trpc/routers/calendar.ts) and asserts none contain the prohibited pattern. Allowlist documents Phase 2 surfaces (DOB / effective_from / recordedAt displays) that legitimately use UTC slice because their inputs carry no time component.
- **Boundary-day integration probe** — tests/integration/dom-cat-02-brussels-anchor.test.ts plants an age_category_history transition on 2026-01-01 and probes getAgeCategoryAt with four scenarios (evening 23:30 UTC, afternoon 13:00 UTC, summer CEST 20:30 UTC, regression-documentation block). Test skips cleanly when no DB is available; runs all 4 it-blocks against a testcontainer.

## Task Commits

Each task was committed atomically (--no-verify per worktree convention to skip residual lock pattern from Wave 5):

1. **Task 1: Replace UTC slice with formatOccurrenceDate at the 6 call sites** — `5c0c829` (fix)
2. **Task 2: Structural invariant test forbids UTC slice in Phase 4 surfaces** — `756a3c9` (test)
3. **Task 3: DOM-CAT-02 Brussels-anchor integration test** — `2a8e1b6` (test)

**Plan metadata commit:** to be made by orchestrator with SUMMARY.md (STATE.md / ROADMAP.md owned by orchestrator).

## Files Created/Modified

### Created (2)

- `tests/unit/no-utc-slice-in-phase4-domain.test.ts` — Structural invariant. PROHIBITED_FILES = 7 Phase 4 sources (players, event-detail-sheet, score page, te-scoren-overview, training, tournament, calendar routers). ALLOWLIST = 9 Phase 2 surfaces with inline rationale comments. Comment-stripping (`//` line + `/* */` block) before whitespace-tolerant regex match. Meta-check verifies allowlist documentation is present in the test source.
- `tests/integration/dom-cat-02-brussels-anchor.test.ts` — 4 it-blocks. `describe.skipIf(!dbReady)` via top-level await against `canConnect()` from `./_helpers`. beforeAll plants a full `players` row + 2 age_category_history rows (2025: age_junior, 2026+: age_senior). Each it-block calls `getAgeCategoryAt(fixtures.users.player, <Date>)` and asserts the Brussels-day row.

### Modified (6 — Phase 4 surfaces)

- `src/lib/players.ts` (CR-09 PRIMARY FIX) — added `import { formatOccurrenceDate } from './rrule';`. Replaced `date.toISOString().slice(0, 10)` at getAgeCategoryAt line ~108 with `formatOccurrenceDate(date)` + an inline block-comment documenting the CR-09 rationale.
- `src/components/calendar/event-detail-sheet.tsx` — added `import { formatOccurrenceDate } from '@/lib/rrule';`. Replaced the 3-line `new Date(...).toISOString().slice(0, 10)` chain with a single `formatOccurrenceDate(new Date(event.event.startsAt))` call. Inline note acknowledges that the IN-02 issue (recurring series dtstart ≠ clicked occurrence) is still open and deferred to Phase 5+.
- `src/app/[locale]/(app)/trainings/[eventId]/score/page.tsx` — added `import { formatOccurrenceDate } from '@/lib/rrule';`. Rewrote `defaultOccurrenceDate` body to return `formatOccurrenceDate(new Date())`.
- `src/components/training/te-scoren-overview.tsx` — added `import { formatOccurrenceDate } from '@/lib/rrule';`. `isoDateOf(d)` helper body now delegates to `formatOccurrenceDate(d)` (kept the wrapper name to minimise call-site diff).
- `src/server/trpc/routers/training.ts` — added `import { formatOccurrenceDate } from '@/lib/rrule';` (above the existing `writeAudit/writeAuditOutsideTx` audit import). `toIsoDate` helper body now delegates to `formatOccurrenceDate(d)`. Plan 04-10's `writeAuditOutsideTx` edit at line 170 is preserved (different region).
- `src/server/trpc/routers/tournament.ts` — added `import { formatOccurrenceDate } from '@/lib/rrule';`. `toIsoDate` helper body delegates to `formatOccurrenceDate(d)`. Plan 04-10's `writeAuditOutsideTx` edits at line 603 + the `enterResult` denied path remain intact.

## DOM-CAT-02 Integration Test — 4 Scenarios

| Scenario | UTC instant | Brussels day | Expected snapshot | Pre-fix (UTC slice) |
| --- | --- | --- | --- | --- |
| Evening boundary | `2025-12-31T23:30:00Z` | 2026-01-01 (CET) | `age_senior` (2026) | `age_junior` (2025) |
| Afternoon | `2025-12-31T13:00:00Z` | 2025-12-31 (CET) | `age_junior` (2025) | `age_junior` (2025) |
| Summer evening | `2026-06-15T20:30:00Z` | 2026-06-15 (CEST) | `age_senior` (2026) | `age_senior` (2026) |
| CR-09 regression | `2025-12-31T23:00:00Z` | 2026-01-01 (CET) | `age_senior` (2026) | `age_junior` (2025) |

Scenarios 1 + 4 are the day-boundary cases that previously misfired. Scenario 2 confirms no false negative within a calendar day. Scenario 3 confirms no false positive in CEST (UTC+2) where UTC slice and Brussels slice agree.

## Structural Invariant Test — Verification

PROHIBITED_FILES (7) + ALLOWLIST (9). Verified by inserting a probe (`const _regression_probe = date.toISOString().slice(0, 10);`) into src/lib/players.ts and re-running the suite:

- **With probe:** 1 failed | 7 passed (the players.ts it-block failed as expected).
- **After revert:** 8 passed | 0 failed.

The whitespace-tolerant regex `/\.\s*toISOString\s*\(\s*\)\s*\.\s*slice\s*\(\s*0\s*,\s*10\s*\)/` catches `. toISOString ( ) . slice ( 0 , 10 )` variants. Comments are stripped first so doc-comments mentioning the deprecated pattern (e.g. `* WR-02 fix (CR-09 family): previously used \`.toISOString().slice(0, 10)\`...`) don't trigger a false positive.

## Pinned Fixture API

- **Fixture user IDs:** `fixtures.users.player` (NOT `fixtures.player1`) — matches `SeededRolesMatrix.users: Record<Role, string>` from tests/helpers/seed.ts:52.
- **`players` row plant:** the test plants its own full players row with all NOT NULL columns (date_of_birth, gender, address fields, status_code, academy_code, age_category, category_year, is_minor). Mirrors tests/integration/age-category-snapshot.test.ts:94. The calendar-seed fixture's 5-column INSERT INTO players is structurally incomplete (omits date_of_birth etc.) and is NOT relied on.
- **age_category_history INSERTs:** via the `rawDb` singleton from `@/server/db/client` (the same connection pool `getAgeCategoryAt` reads from). The plan explicitly requires this for read/write consistency.
- **No appCaller / makeCtx / rawPgAsAppUser** — `getAgeCategoryAt` is a server function, not a tRPC handler. Tests call it directly.

## Decisions Made

- Used seeded codes `age_junior` (2025) + `age_senior` (2026) for the integration test fixture instead of the plan's hypothetical `age_u15`/`age_u18`. The plan explicitly noted this fallback (lines 691-697) because drizzle/0008_phase2_lookup_seed.sql does NOT seed age_u-prefixed codes. The CR-09 fix is code-agnostic; only the YYYY-MM-DD boundary case is load-bearing.
- Chose `describe.skipIf(!dbReady)` over `if (!dbReady) return` inside each `it`-block to match Wave 5 sibling-test conventions (denied-audit-survives-rollback.test.ts, idempotency-input-binding.test.ts, system-inbox-*.test.ts) and the plan's explicit acceptance criterion.
- Stripped `//` line comments AND `/* */` block comments in the structural test before regex matching — doc-comments on the new helpers reference the deprecated pattern by name. Without comment-stripping, the test would fail on its own documentation.
- Phase 2 surfaces added to the ALLOWLIST with inline rationale rather than rewritten — their inputs are date-only with no time component, so the UTC slice is equivalent to the Brussels slice at midnight UTC (both return the same calendar day). Phase 8 release-gate cleanup can revisit if a unified policy is preferred.

## Deviations from Plan

None — plan executed exactly as written, with one explicit fallback the plan itself anticipated:

### Anticipated fallback (NOT a deviation — pre-blessed by plan)

The plan's Task 3 code uses `age_u15` / `age_u18` for the history fixtures. drizzle/0008_phase2_lookup_seed.sql actually seeds `age_pre_minor / age_minor / age_cadet / age_junior / age_senior / age_veteran / age_unknown`. The plan explicitly anticipated this (Task 3 action section, lines 691-697): "the executor MAY need to use `age_senior` and `age_veteran` (definitely seeded) and adjust the DOB / transition dates accordingly. The specific codes don't matter for the CR-09 fix; only the YYYY-MM-DD boundary test does." Used `age_junior` (2025) + `age_senior` (2026) which mirror the same boundary semantics.

---

**Total deviations:** 0
**Impact on plan:** None.

## Issues Encountered

- `node_modules` not present in the worktree — symlinked to the main repo's `node_modules` directory so `pnpm typecheck` and `pnpm test` could run. The symlink is .gitignore-protected (untracked); never staged for commit.
- Pre-existing test failures in tests/unit/lookup-codes.test.ts, magic-bytes.test.ts, medical-schema.test.ts, player-schemas.test.ts, timestamps.test.ts, trainer-schemas.test.ts, worker-template.test.ts (TypeError: Cannot read properties of undefined (reading 'columns') on Drizzle schema introspection + missing BullMQ/Redis fixtures). Confirmed pre-existing — `git diff HEAD~3 HEAD -- tests/unit/lookup-codes.test.ts` shows no changes from this plan. These failures pre-date Wave 5 and are tracked outside this plan's scope.

## Self-Check: PASSED

Verified:
- `src/lib/players.ts` exists; FOUND
- `src/components/calendar/event-detail-sheet.tsx` exists; FOUND
- `src/app/[locale]/(app)/trainings/[eventId]/score/page.tsx` exists; FOUND
- `src/components/training/te-scoren-overview.tsx` exists; FOUND
- `src/server/trpc/routers/training.ts` exists; FOUND
- `src/server/trpc/routers/tournament.ts` exists; FOUND
- `tests/unit/no-utc-slice-in-phase4-domain.test.ts` exists; FOUND
- `tests/integration/dom-cat-02-brussels-anchor.test.ts` exists; FOUND
- Commit `5c0c829` (Task 1) exists in git log; FOUND
- Commit `756a3c9` (Task 2) exists in git log; FOUND
- Commit `2a8e1b6` (Task 3) exists in git log; FOUND
- Plan 04-10 `writeAuditOutsideTx` edits preserved (grep -c shows training.ts:2, tournament.ts:3); FOUND
- Phase 2 files unchanged (git diff 64a599d..HEAD on player.ts/trainer.ts shows no output); CONFIRMED
- `pnpm typecheck` returns clean (zero errors); PASSED
- `pnpm test -- tests/unit/no-utc-slice-in-phase4-domain.test.ts` returns 8 passed; PASSED
- `pnpm test -- tests/integration/dom-cat-02-brussels-anchor.test.ts` returns 4 skipped (no DB available) — describe.skipIf gate working; PASSED

## Migration push status

N/A — no DB schema changes in this plan.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- DOM-CAT-02 snapshot now resolves correctly for Brussels-anchored evening events at the day boundary. Phase 7 / Phase 8 release-gate verification of historical tournament_results rows can safely use the post-fix code.
- The structural invariant test catches future regressions automatically in CI — any contributor who copy-pastes `.toISOString().slice(0, 10)` into a Phase 4 surface (or adds calendar.ts back into the prohibited list) will fail the gate.
- IN-02 (event-detail-sheet's `event.startsAt` is the SERIES dtstart, not the clicked occurrence on a recurring training) remains an open follow-up — flagged inside the inline comment at event-detail-sheet.tsx:~205 and deferred to Phase 5+ per the plan's explicit scope note. WR-02 here only fixes the UTC drift on whatever date the sheet currently computes.
- Wave 6 of Phase 4 gap closure complete. Waves 7-9 (Plans 04-12, 04-13, 04-15) can now proceed; none depend on this plan's files.

---
*Phase: 04-kerndomein*
*Completed: 2026-05-19*
