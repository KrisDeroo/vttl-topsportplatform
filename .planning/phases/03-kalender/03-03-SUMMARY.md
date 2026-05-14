---
phase: 03-kalender
plan: 03
subsystem: api
tags: [rrule, zod, discriminated-union, rbac, calendar, conflict-redaction, trpc, i18n-keys, gdpr]

# Dependency graph
requires:
  - phase: 03-kalender
    provides: "Plan 02 Wave 1b — calendar schema (calendar_events + 6 extension tables + participants + exceptions + 2 SECURITY DEFINER fns)"
  - phase: 01-fundament
    provides: "tRPC middleware factory pattern (requireRole), CallerContext.scope, TRPCError + i18n-key error pattern, Role type"
  - phase: 02-identiteit-bestanden
    provides: ".strict() Zod schema convention (VALID-06), error-message = i18n-key pattern (D-46/I18N-08)"
provides:
  - "src/lib/rrule.ts — pure parseRrule / validateHorizon / ensureHorizon / expandRrule with D-55 horizon defense in depth"
  - "src/server/trpc/schemas/calendar.ts — Zod discriminated-union per 6 event types + 8 mutation/query input schemas + EVENT_TYPE_CODES tuple"
  - "src/server/trpc/middleware/calendarCreate.ts — requireRoleForEventType factory + canCreateEventType helper + CREATE_ALLOWED_ROLES matrix per D-48"
  - "src/lib/calendar/conflicts.ts — pure redactConflict / redactConflicts / shouldFlagAsConflict per D-57 + D-57b"
affects: [03-04-i18n-keys, 03-05-trpc-router, 03-06-rls-policies-handler, 03-08-conflict-tests, 03-09-rrule-tests, phase-4-training-module]

# Tech tracking
tech-stack:
  added: []  # No new deps — rrule 2.8.1 / date-fns 4.1 / zod 4.4 / @trpc/server 11 were installed in earlier waves
  patterns:
    - "Pure service-layer module with explicit dependency injection: conflict redaction takes (row, caller, displayName) — no DB I/O"
    - "RRULE horizon defense in depth: write-time validateHorizon + read-time clamp inside expandRrule"
    - "Discriminator-driven RBAC: middleware factory keyed off input.type, dispatched per branch"
    - "Anti-Pattern 1 guard (rrule DTSTART:): rejected at both Zod refinement and parseRrule runtime check"

key-files:
  created:
    - "src/lib/rrule.ts (240 lines)"
    - "src/lib/calendar/conflicts.ts (164 lines)"
    - "src/server/trpc/schemas/calendar.ts (281 lines)"
    - "src/server/trpc/middleware/calendarCreate.ts (88 lines)"
  modified: []

key-decisions:
  - "RRULE parser uses TRPCError BAD_REQUEST for all rejection paths (invalid RFC 5545, DTSTART: dual source, RRuleSet input) — uniform `errors.calendar.rruleHorizonExceeded` key so UI surfaces a single message"
  - "ensureHorizon strips dtstart from spread instead of setting to undefined — required by tsconfig exactOptionalPropertyTypes:true"
  - "discriminatedUnion branches use .strict() + .refine() chain — kept the .refine on the inner ZodObject before union assembly so each branch validates endsAt > startsAt and (for medical) startsAt not too far in past"
  - "Conflict redaction redacts eventId itself when caller has no scope — prevents enumeration of out-of-scope event ids (Pitfall 6)"
  - "shouldFlagAsConflict permissive (returns true) — v1 surfaces all overlaps; future phases can filter self-overlaps"

patterns-established:
  - "i18n-key error namespace: 5 distinct errors.calendar.* keys defined (endBeforeStart, medicalPastStart, rangeTooLarge, rruleHorizonExceeded, titleRequired) — Plan 04 ships catalog entries"
  - "D-48 RBAC matrix encoded as Record<typeCode, ReadonlyArray<Role>> for clarity + test-friendliness"
  - "Pure-function service modules: redactConflict / expandRrule take all inputs explicitly so unit tests can drive them without DB bootstrap"

requirements-completed: [CAL-07, GDPR-04, GDPR-08, I18N-08, USER-04]

# Metrics
duration: 5min
completed: 2026-05-14
---

# Phase 3 Plan 03: Wave 2 service-layer building blocks Summary

**Four pure-/service-layer modules — RRULE expand+horizon, Zod discriminated-union per 6 event types, per-type RBAC matrix, conflict redaction — that gate every Phase 3 mutation in Wave 3+ without depending on tRPC orchestration.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-05-14T10:42:18Z
- **Completed:** 2026-05-14T10:46:57Z
- **Tasks:** 3/3
- **Files modified:** 4 (created)

## Accomplishments

- Server-side RRULE expansion library with D-55 horizon defense in depth (write-time validateHorizon + read-time clamp inside expandRrule); never string-concats UNTIL clauses (Pitfall 8); rejects DTSTART:-containing strings (Anti-Pattern 1).
- Zod discriminated-union covering all 6 event types (training/tournament/meeting/stage/eval_conversation/medical) with type-specific extension fields, `.strict()` everywhere (VALID-06), all error messages as i18n keys (I18N-08); plus 8 sibling mutation/query input schemas (update/delete/get/declineParticipation/cancelOccurrence/detectConflicts/list/filterOptions).
- Per-event-type RBAC matrix factory `requireRoleForEventType(typeCode)` encoding D-48 verbatim with `canCreateEventType(role, code)` test helper; anonymous → UNAUTHORIZED, wrong role → FORBIDDEN role_not_allowed (Phase 1 WR-03 fix carry-forward).
- Pure conflict-redaction service `redactConflict(row, caller, displayName)` enforcing D-57's 4-path visibility decision with redacted-shape eventId/title/location blanking (Pitfall 6 mitigation).

## Task Commits

Each task was committed atomically:

1. **Task 1: src/lib/rrule.ts — RFC 5545 helpers + D-55 horizon defense in depth** — `e182ac8` (feat)
2. **Task 2: Zod discriminated union schemas + per-type RBAC middleware** — `43739a6` (feat)
3. **Task 3: src/lib/calendar/conflicts.ts — service-layer redaction helper (D-57)** — `07aa5ec` (feat)

## Files Created/Modified

- `src/lib/rrule.ts` (created, 240 lines) — Pure RFC 5545 helpers. Exports: parseRrule, validateHorizon, ensureHorizon, expandRrule + types ExpandedOccurrence, ExceptionInput. Imports rrule 2.8.1 + date-fns addYears.
- `src/server/trpc/schemas/calendar.ts` (created, 281 lines) — Zod input schemas. Exports: eventCreateInput (discriminatedUnion), eventUpdateInput, eventDeleteInput, eventGetInput, declineParticipationInput, cancelOccurrenceInput, detectConflictsInput, listInput, filterOptionsInput + all inferred types + EVENT_TYPE_CODES tuple.
- `src/server/trpc/middleware/calendarCreate.ts` (created, 88 lines) — Per-event-type role gate. Exports: requireRoleForEventType (factory), canCreateEventType (helper), CREATE_ALLOWED_ROLES (matrix).
- `src/lib/calendar/conflicts.ts` (created, 164 lines) — Pure conflict redaction. Exports: redactConflict, redactConflicts, shouldFlagAsConflict + types OverlapRow, OverlapWithMembership, CallerForRedaction, RedactedConflict.

## Anti-Pattern 1 Guard Locations

The DTSTART:-rejection guard lives in **two complementary places**:

1. **Zod refinement** (`src/server/trpc/schemas/calendar.ts:31`):
   ```ts
   const rruleStringSchema = z.string().max(2000, ...).refine(
     (s) => !s.includes('DTSTART:'),
     { message: 'errors.calendar.rruleHorizonExceeded' }
   );
   ```
   First-line defense at HTTP boundary — fails before any database hit.

2. **Runtime check** (`src/lib/rrule.ts:89` in `parseRrule`):
   ```ts
   if (rruleStr.includes('DTSTART:')) {
     throw new TRPCError({ code: 'BAD_REQUEST',
       message: 'errors.calendar.rruleHorizonExceeded' });
   }
   ```
   Defense in depth — protects `validateHorizon`, `ensureHorizon`, and `expandRrule` even if a caller bypasses Zod (e.g. internal helper invocation, future REST endpoint).

## Discriminated-Union Branches (6 event types)

| Branch | Discriminator | Extension fields | Refinements |
|--------|---------------|------------------|-------------|
| trainingCreateBranch | `event_type_training` | trainingTypeCode, organisationCode, trainerId (uuid), durationMinutes (positive int) | endsAt > startsAt |
| tournamentCreateBranch | `event_type_tournament` | city, country (ISO-2), ageCategoryCode, tournamentTypeCode | endsAt > startsAt |
| meetingCreateBranch | `event_type_meeting` | _(base fields only)_ | endsAt > startsAt |
| stageCreateBranch | `event_type_stage` | place, country (ISO-2) | endsAt > startsAt |
| evalConvCreateBranch | `event_type_eval_conversation` | evaluatorUserId (uuid), playerUserId (uuid) | endsAt > startsAt |
| medicalCreateBranch | `event_type_medical` | isInjury (bool, default false), doctor (text optional) | endsAt > startsAt, startsAt ≥ now − 1y |

All branches inherit `baseEventFields`: title (1..200), startsAt/endsAt (coerce.date), allDay (default false), location (max 200, optional), description (max 2000, optional), rrule (rruleStringSchema, optional), participants (array of {userId, roleInEvent}), force (default false — D-57).

## D-48 RBAC Matrix (7 roles × 6 event types)

| Role \ Event type | training | tournament | meeting | stage | eval_conversation | medical |
|-------------------|----------|------------|---------|-------|-------------------|---------|
| technical_director | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| trainer | ✓ |   | ✓ |   |   |   |
| player |   |   | ✓ |   |   |   |
| academy_manager |   |   | ✓ |   |   |   |
| sparring_partner |   |   |   |   |   |   |
| parent |   |   |   |   |   |   |
| medical_staff |   |   | ✓ |   |   |   |

Encoded as `CREATE_ALLOWED_ROLES: Record<string, ReadonlyArray<Role>>` in `src/server/trpc/middleware/calendarCreate.ts`. Anonymous callers → UNAUTHORIZED (WR-03 fix); authenticated wrong role → FORBIDDEN `role_not_allowed`.

## Conflict-Redaction Policy (4 visibility paths)

`redactConflict(row, caller, displayName)` returns `detailMode='full'` if ANY of these hold:

| Path | Condition | Rationale |
|------|-----------|-----------|
| 1 | `caller.role === 'technical_director'` | TD sees the entire platform; operational oversight |
| 2 | `caller.role === 'medical_staff'` | medical_staff needs full conflict detail across medical-adjacent contexts |
| 3 | `row.createdBy === caller.userId` | Caller is the creator of the conflicting event — they already know its details |
| 4 | `row.callerIsParticipantInConflicting === true` | Caller is a participant — they already see the event in their own scope |

Otherwise → `detailMode='redacted'`. Redacted shape blanks `eventId` (prevents enumeration — Pitfall 6), `title`, `location`. `participant` + `startsAt` + `endsAt` + `typeCode` always returned so the UI can render the D-57b template:

- nl: `**{participant}** is al geboekt voor {detail} {start}–{end}. Toch opslaan?`
- en: `**{participant}** is already booked for {detail} {start}–{end}. Save anyway?`
- fr: `**{participant}** est déjà réservé pour {detail} {start}–{end}. Enregistrer quand même ?`

Where `{detail}` = full → `**{title}** ({typeLabel})`; redacted → locale-specific indefinite article + `**{typeLabel}**`.

## Decisions Made

- **Use `_stripDtstart` rename + spread** in `ensureHorizon` instead of `dtstart: undefined`: `exactOptionalPropertyTypes:true` rejects `Date | undefined` for `dtstart: Date | null`. Cleanest fix was to destructure and discard.
- **Permissive `shouldFlagAsConflict`**: v1 reports all overlaps (incl. self-creator overlaps) per D-57 verbatim. Future phases can filter; keep contract simple now.
- **`forceConflict` flag lives in `baseEventFields`** (every branch carries it) — saves duplication and matches D-57's design: any event-creation can declare "I acknowledge a conflict".

## Deviations from Plan

None — plan executed exactly as written. One minor compile-time accommodation: `ensureHorizon`'s "strip dtstart from spread" technique replaced the plan-text `dtstart: undefined` to satisfy `exactOptionalPropertyTypes:true`; the behavioural contract (never emit DTSTART:) is unchanged.

## Issues Encountered

None.

## Verification Performed

| Check | Result |
|-------|--------|
| `pnpm typecheck` (after each task) | passed |
| `grep -c "z.literal('event_type_"` in schemas/calendar.ts | 6 ✓ |
| Distinct `errors.calendar.*` keys in schemas/calendar.ts | 5 (≥ 4 ✓) |
| `pnpm test tests/unit/rrule.test.ts tests/unit/calendar-schemas.test.ts` | 1 sanity guard passed + 21 todo (RED scaffolds still parse, imports resolve in Wave 5) |
| 4 new files exist at canonical paths | ✓ |
| No modifications to STATE.md / ROADMAP.md | ✓ (worktree mode) |

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

Wave 3 (Plan 05 tRPC router) can compose against this contract:

- `calendar.event.create` → `protectedProcedure.input(eventCreateInput).use((opts) => requireRoleForEventType(opts.input.type)(opts)).mutation(...)`
- `calendar.event.detectConflicts` + `calendar.event.create({...,force:true})` → call `overlapping_events_for_users` SECURITY DEFINER fn, then map rows through `redactConflicts(rows, caller, displayNameByUserId)`
- `calendar.list` → for each row with `rrule != null`, call `expandRrule(rrule, startsAt, durationMs, from, to, exceptions)`

Plan 04 (i18n catalogs, parallel wave) ships the message strings for the 5 `errors.calendar.*` keys + the D-57b conflict copy template + D-58b delete copy. The schemas reference these keys as strings now — they render in catalogs when Plan 04 lands.

Wave 0 RED tests at `tests/unit/rrule.test.ts` (10 it.todo) and `tests/unit/calendar-schemas.test.ts` (11 it.todo) are already parked. Wave 5 will flip them by removing `it.todo → it` and writing assertions against these implementations.

## Self-Check

Files exist:
- `src/lib/rrule.ts` — FOUND
- `src/lib/calendar/conflicts.ts` — FOUND
- `src/server/trpc/schemas/calendar.ts` — FOUND
- `src/server/trpc/middleware/calendarCreate.ts` — FOUND

Commits exist:
- `e182ac8` — FOUND (Task 1 RRULE helpers)
- `43739a6` — FOUND (Task 2 Zod schemas + RBAC middleware)
- `07aa5ec` — FOUND (Task 3 conflict redaction)

## Self-Check: PASSED

---
*Phase: 03-kalender*
*Completed: 2026-05-14*
