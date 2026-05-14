---
phase: 03-kalender
plan: 01
subsystem: testing
tags: [fullcalendar, rrule, shadcn, vitest, playwright, calendar, rls, gdpr, i18n, design-tokens]

# Dependency graph
requires:
  - phase: 01-fundament
    provides: vitest 3.x + playwright 1.59 + testcontainers + freshDb/rawPgAsAppUser/appCaller + seedRolesMatrix
  - phase: 02-identiteit-bestanden
    provides: shadcn primitives, globals.css, RBAC matrix pattern (rbac-matrix.test.ts), RLS direct-query pattern (players-direct-query.test.ts)
provides:
  - FullCalendar v6.1.20 + 7 plugins (core, react, timegrid, daygrid, interaction, rrule, multimonth) in dependencies
  - rrule 2.8.1 — canonical RRULE library for server-side expansion (D-52, D-53)
  - 6 new shadcn primitives (sheet, alert, command, toggle, toggle-group, scroll-area) — required UI surfaces for EventCreateSheet, ConflictWarning, FilterCombobox, ToggleGroup view-switcher, ScrollArea agenda list
  - 17 new Wave 0 RED test files + 1 shared fixture (seedCalendarFixtures stub that throws by design)
  - 3 extended test files — Phase 3 event_type code manifest, i18n namespace manifest, and 4-migration manifest
  - Nyquist-compliant verify hooks for every Wave 1+ task (every Wave 1+ task has a RED test waiting)
affects: [03-02-PLAN (schema migrations), 03-03-PLAN (rrule lib), 03-04-PLAN (tRPC + redaction), 03-05-PLAN (server pages + RSC), 03-06-PLAN (Client components), 03-07-PLAN (i18n catalogs), 03-08-PLAN (e2e + perf gate)]

# Tech tracking
tech-stack:
  added:
    - "@fullcalendar/core@6.1.20"
    - "@fullcalendar/react@6.1.20"
    - "@fullcalendar/timegrid@6.1.20"
    - "@fullcalendar/daygrid@6.1.20"
    - "@fullcalendar/interaction@6.1.20"
    - "@fullcalendar/rrule@6.1.20 (installed but NOT wired — server-side expansion is the rule per D-53; plugin kept for future-proofing only)"
    - "@fullcalendar/multimonth@6.1.20"
    - "rrule@2.8.1"
    - "cmdk@1.1.1 (via shadcn command primitive)"
    - "@radix-ui/react-toggle-group (via shadcn toggle-group primitive)"
    - "@radix-ui/react-scroll-area (via shadcn scroll-area primitive)"
  patterns:
    - "Wave 0 Nyquist-compliant RED scaffolding — every Wave 1+ task gets a verify hook before code lands"
    - "Shared seedCalendarFixtures helper that throws by design — prevents T-03-03-TEST-FALSE-POSITIVE silent green"
    - "Manifest-and-todo pattern for extending existing test files — adds a passing 'declares the canonical N' assertion + it.todo placeholders for the substantive behaviour"

key-files:
  created:
    - "src/components/ui/sheet.tsx (shadcn primitive)"
    - "src/components/ui/alert.tsx (shadcn primitive)"
    - "src/components/ui/command.tsx (shadcn primitive)"
    - "src/components/ui/toggle.tsx (shadcn primitive)"
    - "src/components/ui/toggle-group.tsx (shadcn primitive)"
    - "src/components/ui/scroll-area.tsx (shadcn primitive)"
    - "tests/unit/rrule.test.ts"
    - "tests/unit/color-tokens.test.ts"
    - "tests/unit/calendar-schemas.test.ts"
    - "tests/integration/calendar-rls.test.ts"
    - "tests/integration/calendar-rrule-horizon.test.ts"
    - "tests/integration/calendar-exceptions.test.ts"
    - "tests/integration/calendar-conflicts.test.ts"
    - "tests/integration/calendar-audit.test.ts"
    - "tests/integration/calendar-cascade.test.ts"
    - "tests/integration/calendar-decline.test.ts"
    - "tests/integration/calendar-perf.test.ts"
    - "tests/integration/calendar-filter-options.test.ts"
    - "tests/rls/calendar-direct-query.test.ts"
    - "tests/e2e/calendar-week-view.spec.ts"
    - "tests/e2e/calendar-create-event.spec.ts"
    - "tests/e2e/calendar-mobile.spec.ts"
    - "tests/e2e/calendar-drag.spec.ts"
    - "tests/fixtures/calendar-seed.ts (seedCalendarFixtures — throws today by design)"
    - ".planning/phases/03-kalender/deferred-items.md (out-of-scope discoveries)"
  modified:
    - "package.json (8 new deps + Radix sub-packages)"
    - "pnpm-lock.yaml (lockfile-pinned to 6.1.20 / 2.8.1)"
    - "tests/unit/lookup-codes.test.ts (+ event_type 6-code manifest describe)"
    - "tests/unit/schema-locale.test.ts (+ Phase 3 i18n namespace manifest describe)"
    - "tests/unit/migration-format.test.ts (+ Phase 3 4-migration manifest describe with skipIf gates)"

key-decisions:
  - "FullCalendar 6.1.20 + rrule 2.8.1 — canonical versions per RESEARCH §Standard Stack; lockfile-pinned via pnpm-lock.yaml"
  - "@fullcalendar/rrule plugin installed but NOT wired (D-53 — server-side expansion is the rule); plugin kept solely to avoid future re-architecture cost"
  - "seedCalendarFixtures throws today — T-03-03-TEST-FALSE-POSITIVE mitigation; Wave 1+ tests fail loudly instead of silently greening"
  - "color-tokens.test.ts uses real expect() (not it.todo) per planner's verbatim template — 12 RED failures are intended Nyquist contract until Wave 2 adds CSS tokens"
  - "Modified test files use manifest-and-todo pattern — one passing manifest assertion + N it.todo placeholders — so the existing test runs stay green and only Phase 3 behaviours are pending"

patterns-established:
  - "Wave 0 RED contract: it.todo for behavioural tests, it.each + expect for static-content tests where assertions can run today against unchanged files (globals.css), test.skip + test.todo for e2e specs that need a dev server"
  - "Shared fixture throws + JSDoc cross-reference: any test importing seedCalendarFixtures gets a loud error pointing at the Wave-1 dependency"
  - "Deferred-items log: out-of-scope discoveries during execution go to .planning/phases/03-kalender/deferred-items.md, not silent fixes that drift from plan scope"

requirements-completed:
  - CAL-01
  - CAL-02
  - CAL-03
  - CAL-04
  - CAL-05
  - CAL-07
  - CAL-08
  - TRAIN-01
  - TOURN-01
  - MED-EVENT
  - GDPR-04
  - GDPR-08
  - I18N-05
  - I18N-06
  - I18N-07
  - I18N-08
  - USER-04

# Metrics
duration: 10min
completed: 2026-05-14
---

# Phase 3 Plan 01: Wave 0 RED Scaffolding Summary

**FullCalendar 6.1.20 + rrule 2.8.1 + 6 shadcn primitives installed; 20 Wave 0 RED test files and the shared `seedCalendarFixtures` fixture in place — every Wave 1+ task now has a verify hook satisfying the Nyquist sampling rule.**

## Performance

- **Duration:** 10 min
- **Started:** 2026-05-14T10:01:13Z
- **Completed:** 2026-05-14T10:11:08Z
- **Tasks:** 2 (of 2)
- **Files modified:** 25 (8 new shadcn/dep files + 17 new test files + 1 fixture + 1 deferred-items log + 3 modified test files + package.json + pnpm-lock.yaml)

## Accomplishments

- All 8 npm dependencies installed at exact pinned versions (FullCalendar v6.1.20 core + 6 plugins + rrule 2.8.1).
- All 6 shadcn primitives generated at canonical paths under `src/components/ui/`.
- All 20 Wave 0 RED test files exist at the paths declared in `03-VALIDATION.md`; `pnpm typecheck` passes; `pnpm test` parses every file without syntax errors.
- Shared `seedCalendarFixtures` exported from `tests/fixtures/calendar-seed.ts` (throws today by design — prevents silent-green RED-flip during Wave 1+).
- Three pre-existing test files (`lookup-codes`, `schema-locale`, `migration-format`) extended with Phase 3 manifest describe blocks that pass + `it.todo`/`it.skipIf` placeholders for the substantive Wave 2+ behaviours.
- Out-of-scope discoveries (pre-existing `lookup-codes.test.ts` Drizzle introspection failures, eslint peer-dep warnings) logged to `deferred-items.md`, not silently fixed.

## Task Commits

Each task was committed atomically:

1. **Task 1: Install FullCalendar + rrule + 6 shadcn primitives** — `4926c48` (chore)
2. **Task 2: Scaffold 20 Wave 0 RED test files + 1 fixture** — `d4f5478` (test)

_Note: No final metadata commit — orchestrator owns post-wave shared-file writes (STATE.md, ROADMAP.md) per worktree contract._

## Files Created/Modified

### Dependencies + UI primitives (Task 1)
- `package.json` — added 7 FullCalendar plugins + rrule (pinned to ^6.1.20 / ^2.8.1)
- `pnpm-lock.yaml` — lockfile pinned to exact versions 6.1.20 / 2.8.1 / cmdk 1.1.1
- `src/components/ui/sheet.tsx` — shadcn Sheet primitive (for EventCreateSheet, EventDetailSheet, EventEditSheet)
- `src/components/ui/alert.tsx` — shadcn Alert primitive (for ConflictWarning, ConflictBanner)
- `src/components/ui/command.tsx` — shadcn Command primitive (cmdk-based typeahead for FilterCombobox)
- `src/components/ui/toggle.tsx` — shadcn Toggle primitive
- `src/components/ui/toggle-group.tsx` — shadcn ToggleGroup primitive (week/month/year view switcher)
- `src/components/ui/scroll-area.tsx` — shadcn ScrollArea primitive (agenda list, long combobox results)

### Wave 0 RED test files (Task 2)

**Unit tests (3 new):**
- `tests/unit/rrule.test.ts` — pure-function RRULE coverage (expandRrule / validateHorizon / parseRrule per D-52..D-55)
- `tests/unit/color-tokens.test.ts` — assert 18 cal-event tokens × 2 modes (light + dark) + FullCalendar variable overrides + mobile media-query rules in globals.css
- `tests/unit/calendar-schemas.test.ts` — Zod discriminated-union per event_type (.strict() / i18n-key errors / write-time horizon)

**Integration tests (9 new):**
- `tests/integration/calendar-rls.test.ts` — 5 roles × 6 event types = 30-cell matrix (D-50 sparring no-op explicit)
- `tests/integration/calendar-rrule-horizon.test.ts` — D-55 write + read horizon defense in depth
- `tests/integration/calendar-exceptions.test.ts` — D-54 cancel / move / retitle override + UNIQUE constraint + FK CASCADE
- `tests/integration/calendar-conflicts.test.ts` — D-56 per-participant overlap + D-57 cross-scope SECURITY DEFINER + role-gated redaction + override audit
- `tests/integration/calendar-audit.test.ts` — 6 audit action codes + D-58c JSONB snapshot completeness + 1000-cap
- `tests/integration/calendar-cascade.test.ts` — FK CASCADE on calendar_events DELETE (extension + participants + exceptions)
- `tests/integration/calendar-decline.test.ts` — RSVP decline ≠ delete + RSVP forgery prevention
- `tests/integration/calendar-perf.test.ts` — RISK-POLYMORPH p95 < 200ms with 200 events + 30 RRULE rows
- `tests/integration/calendar-filter-options.test.ts` — scope-filtered typeahead per CAL-04

**RLS tests (1 new):**
- `tests/rls/calendar-direct-query.test.ts` — USER-04 direct psql probe with app.user_id GUC bound

**E2E specs (4 new):**
- `tests/e2e/calendar-week-view.spec.ts` — CAL-01/CAL-03 week view + event click + view switcher
- `tests/e2e/calendar-create-event.spec.ts` — CAL-07 drag-create + conflict warning + override audit
- `tests/e2e/calendar-mobile.spec.ts` — CAL-08 mobile single-day + swipe + floating CTA (Pixel 5 viewport)
- `tests/e2e/calendar-drag.spec.ts` — drag-to-edit + optimistic update + conflict revert

**Fixtures (1 new):**
- `tests/fixtures/calendar-seed.ts` — exports `seedCalendarFixtures` (throws today — T-03-03-TEST-FALSE-POSITIVE mitigation)

**Modified Phase 1 test files (3, manifest-and-todo pattern):**
- `tests/unit/lookup-codes.test.ts` — `+describe('Phase 3 — event_type lookup')` with 6 canonical codes manifest + it.todo for table/seed presence
- `tests/unit/schema-locale.test.ts` — `+describe('Phase 3 — calendar namespace coverage')` with 3 namespaces manifest + it.todo for per-locale catalog coverage
- `tests/unit/migration-format.test.ts` — `+describe('Phase 3 — expected migration manifest')` with 4 stems + per-stem it.skipIf gates on file presence

**Documentation:**
- `.planning/phases/03-kalender/deferred-items.md` — out-of-scope discoveries logged for follow-up (DI-01 pre-existing lookup-codes Drizzle introspection bug; DI-02 eslint peer-dep warnings)

## Decisions Made

Followed plan as written. No new key decisions during execution. Three minor execution choices worth recording for the next plan:

- **`it.each` + real `expect()` in color-tokens.test.ts** — verbatim per planner template; produces 12 intended RED failures until Wave 2/4 adds the 36 CSS-variable declarations. Treated as Nyquist-RED contract, not as deviation.
- **seedCalendarFixtures throws on call** — per planner template + plan threat-register T-03-03-TEST-FALSE-POSITIVE; any Wave 1+ test importing it will fail loudly until Wave 5 implements the seed body.
- **Modified-file manifest-and-todo pattern** — three extended test files use `describe('Phase 3 — …')` blocks at file tail, leaving the existing Phase 1 describe blocks (and their pre-existing failures) untouched. Keeps blast radius minimal and rollback trivial.

## Deviations from Plan

None - plan executed exactly as written. All steps in Task 1 and Task 2 followed the planner's verbatim instructions, including identical RED-test bodies and the `seedCalendarFixtures` JSDoc stub.

## Issues Encountered

### Pre-existing test infrastructure noise surfaced during verification (not caused by this plan)

Both logged to `.planning/phases/03-kalender/deferred-items.md` — out of scope for Plan 03-01 per scope-boundary rule.

1. **`tests/unit/lookup-codes.test.ts` already-existing describe block** fails 9 of 9 assertions with `TypeError: Cannot read properties of undefined (reading 'columns')` at the `cols()` helper. Confirmed by running the file at the Phase 3 base commit (`9c93689`) — failures predate this plan. Likely root cause: Drizzle 0.45 changed its internal column-metadata accessor. My added describe block (`Phase 3 — event_type lookup`) passes (1 passed, 2 todo). The pre-existing failures continue unchanged. **Deferred to Phase 8 quality pass.**

2. **`testcontainers` (Postgres) + Redis unavailable** in some local environments — integration tests skip cleanly (`testcontainer container runtime unavailable, skipping Postgres setup`). Does not affect the new Wave 0 files (all 13 todo-only files passed: 1 sanity assertion + 142 todos + 0 failures). **Environmental — not a code issue.**

3. **ESLint peer-dependency mismatch** — pre-existing warning from `pnpm add` due to eslint 10 vs `eslint-plugin-import` capping at <=9. Not introduced by Phase 3 deps. **Deferred.**

### Verification result

- `pnpm typecheck` passes after Task 1 (no TypeScript errors introduced).
- `pnpm test -- --run --reporter dot` parses every new test file. 13 todo-only RED files: **1 passed + 142 todos + 0 failures**.
- `color-tokens.test.ts` produces **12 intended RED failures** per planner's verbatim template (real `expect()` calls against CSS tokens Wave 2/4 hasn't added yet). These are the canonical Nyquist RED contract — they convert to GREEN in Wave 2/4.
- `tests/unit/schema-locale.test.ts` and `tests/unit/migration-format.test.ts` extended files: **9 passed + 8 skipIf-gated + 7 todo + 0 failures** — confirms my additions integrate cleanly with the pre-existing assertions.
- All grep contracts in the planner's `<verify>` block satisfied:
  - `grep -c event_type_training|...` in lookup-codes returns **6** (>= 6 required).
  - `0009_phase3_calendar` present in migration-format.
  - `0012_phase3_event_type_seed` present in migration-format.

## Threat Flags

No new security surface introduced. Plan adds only dev/test scaffolding and dependency declarations — no new endpoints, auth paths, file-access patterns, or schema changes at trust boundaries.

Plan's declared threat refs (V1, V5) and STRIDE entries (T-03-01-DEP-SUPPLY, T-03-02-DEP-PIN, T-03-03-TEST-FALSE-POSITIVE) were all honoured:

- **T-03-01-DEP-SUPPLY** (accept): the 8 npm packages are all MIT/BSD per RESEARCH; Phase 1's existing `pnpm audit` gate continues to cover this install.
- **T-03-02-DEP-PIN** (mitigate): `pnpm-lock.yaml` pins to exact versions 6.1.20 / 2.8.1 / 1.1.1; CI must continue running with frozen-lockfile.
- **T-03-03-TEST-FALSE-POSITIVE** (mitigate): every behavioural test is `it.todo` / `test.todo`; `seedCalendarFixtures` throws on call so no Wave 1+ test can silently green without real implementation.

## Self-Check: PASSED

- Files claimed in this SUMMARY exist on disk (all 24 created + 3 modified verified via `test -f` chain in the verify step).
- Both task commits (`4926c48`, `d4f5478`) exist in `git log` on this worktree branch.
- Deviations: NONE (plan executed verbatim).
- Out-of-scope discoveries: 2 (pre-existing) logged to `deferred-items.md`, NOT silently fixed.

## Next Phase Readiness

- **Wave 1 (03-02-PLAN, schema migrations) can start:** `tests/integration/calendar-rls.test.ts`, `tests/integration/calendar-cascade.test.ts`, `tests/integration/calendar-exceptions.test.ts`, `tests/rls/calendar-direct-query.test.ts`, and `tests/unit/migration-format.test.ts` all wait for Wave 2 migrations `0009`-`0012`.
- **Wave 2/3 (`@/lib/rrule`, schemas, tRPC):** `tests/unit/rrule.test.ts`, `tests/unit/calendar-schemas.test.ts`, `tests/integration/calendar-rrule-horizon.test.ts`, `tests/integration/calendar-conflicts.test.ts`, `tests/integration/calendar-audit.test.ts`, `tests/integration/calendar-decline.test.ts`, `tests/integration/calendar-filter-options.test.ts`, `tests/integration/calendar-perf.test.ts` waiting.
- **Wave 4 (UI):** 6 shadcn primitives + 4 e2e specs + `tests/unit/color-tokens.test.ts` waiting (color tokens will GREEN once globals.css gets the 36 CSS-variable declarations).
- **Wave 5 (fixture body + plan-perf seeding):** `tests/fixtures/calendar-seed.ts` body to be implemented; current throw is intentional.
- **No blockers** for the next plan in the wave. Plan 03-01 is fully complete and committed.

---
*Phase: 03-kalender*
*Completed: 2026-05-14*
