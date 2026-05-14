---
phase: 03-kalender
plan: 05
subsystem: api
tags: [trpc, calendar, rrule, rls, audit, conflict-detection, redaction, gdpr]

# Dependency graph
requires:
  - phase: 01-fundament
    provides: protectedProcedure (auth + withRlsContext + requireCurrentConsent), writeAudit, audit_log append-only contract, CallerScope (userId/role/locale), Role permissions matrix
  - phase: 02-identiteit-bestanden
    provides: players + trainers Drizzle schemas with $inferSelect/$inferInsert, NOT_FOUND-on-RLS-filtered pattern (D-36)
  - phase: 03-kalender / 03-02
    provides: 10 calendar tables (calendar_events + 6 extensions + participants + exceptions), 2 SECURITY DEFINER fns (calendar_events_visible_to, overlapping_events_for_users(uuid[], tstzrange[])), per-action RLS policies
  - phase: 03-kalender / 03-03
    provides: src/lib/rrule.ts (expandRrule + validateHorizon + ensureHorizon), src/lib/calendar/conflicts.ts (redactConflict + RedactedConflict shape), src/server/trpc/schemas/calendar.ts (9 Zod schemas), src/server/trpc/middleware/calendarCreate.ts (canCreateEventType + CREATE_ALLOWED_ROLES matrix)
  - phase: 03-kalender / 03-04
    provides: i18n catalogs with calendar.* + errors.calendar.* + lookup.eventType.* keys in nl/en/fr (consumed by the i18n message-key strings emitted in TRPCError messages)

provides:
  - calendarRouter (9 tRPC procedures composing Wave 1 schema + Wave 2 helpers into the request/response handler layer)
  - 6 distinct audit action codes emitted on calendar mutations
  - server-side rrule expansion contract — FullCalendar never sees raw RRULE
  - D-57 cross-scope conflict probe with role-gated service-layer redaction
  - D-58c pre-delete JSONB snapshot pattern (audit-before-delete + 1000-exception cap)

affects: [03-06 calendar-page-ui, 03-07 fullcalendar-week-view, 03-08 wave-5-integration-tests, future medical-event router (Phase 5) — can reuse audit-before-write pattern]

# Tech tracking
tech-stack:
  added: []  # No new dependencies; uses existing trpc/zod/drizzle/rrule already in the tree.
  patterns:
    - "Inline role allowlist check (canCreateEventType) instead of input-aware middleware factory — preserves tRPC v11's typed-middleware contract"
    - "AnyTx helper type for cross-handle insert/select code that runs on either the top-level Drizzle handle or a transaction handle"
    - "Discriminated-union dispatch via switch(input.type) in helper functions (insertExtensionRow, deleteExtensionRow) — TS narrows each branch to its extension's concrete fields"
    - "Pre-delete JSONB snapshot with explicit cap (MAX_EXCEPTIONS=1000) + truncation-count field (exceptionsTotalCount) so audit row stays bounded"
    - "Cross-scope SECURITY DEFINER overlap fn called with tstzrange[]; redactConflict applied row-by-row using callerIsParticipantInConflicting probe result"

key-files:
  created:
    - src/server/trpc/routers/calendar.ts (1207 lines — single tRPC surface for Phase 3)
  modified:
    - src/server/trpc/routers/_app.ts (calendar sub-router import + registration on appRouter)

key-decisions:
  - "D-48 RBAC: inline canCreateEventType() check rather than a .use(requireRoleForEventType(...)) middleware factory — the role allowlist depends on the parsed input.type which is not available to tRPC middleware without a non-trivial getRawInput dance. The shared CREATE_ALLOWED_ROLES matrix in middleware/calendarCreate.ts remains the single source of truth; calendar_events INSERT WITH CHECK RLS is the DB-layer backstop."
  - "AnyTx helper-arg typing: Drizzle returns subtly different types from db.transaction(...) callbacks (PgTransaction) versus the top-level db handle (PostgresJsDatabase). Helper functions that compose with both (insertExtensionRow, fetchExtensionRow, deleteExtensionRow) accept a loose any-typed handle and use only the shared method surface (insert/select/delete). Strict-typed DbClient is preserved on the top-level handler signatures."
  - "occurrence_date serialisation: Drizzle date() column expects ISO 'YYYY-MM-DD' strings on insert. cancelOccurrence accepts a Date at the Zod boundary then serialises to that format before the insert. The audit-row JSONB stores the same string shape so round-trip is symmetric."
  - "Conflict 'soft error' shape: event.create / event.update throw TRPCError(CONFLICT) with a shaped cause: { conflicts, blocked: false } so the UI can render ConflictWarning inline and resubmit with force:true. D-57 keeps conflicts informational — the server never actually blocks the write when force is set."
  - "ANY()-array WHERE for batch fetches: exceptions/participants for the visible-event set are fetched in a single query each using sql\\`<col> = ANY(<ids>)\\`. Avoids the N+1 trap for the 90% case where calendar.list returns 10-500 instances."

patterns-established:
  - "Audit-before-mutation transaction shape (D-58c): inside a db.transaction(), SELECT ... FOR UPDATE → assemble JSONB snapshot → writeAudit → mutate. Both writes commit atomically; if the audit insert fails the data change rolls back too."
  - "Soft-conflict CONFLICT response: server emits TRPCError(code: 'CONFLICT', message: 'errors.calendar.conflictDetected', cause: { conflicts, blocked: false }) instead of returning a 200 with conflicts inline. Lets the client distinguish 'conflicts blocked the write' from a successful create that warns about visible conflicts."
  - "Idempotent exception insert: cancelOccurrence catches Postgres 23505 (uniqueness violation on event_id+occurrence_date) and returns ok:true. The audit row is still useful even if the second call is a no-op — but writing it conditionally would require pre-checking, which races with the insert."
  - "Lightweight participant summary on list: calendar.list returns participantUserIds: string[] on every EventInstance — enough for the UI to colour-code chips and apply the adjacent-overlap conflict-hint pass. Full participant detail (roleInEvent, rsvpStatus, names) is fetched lazily by event.get when the user opens the detail panel."

requirements-completed: [CAL-01, CAL-04, CAL-05, CAL-07, GDPR-04, GDPR-08, I18N-08, USER-04, TRAIN-01, TOURN-01, MED-EVENT]

# Metrics
duration: ~50 min
completed: 2026-05-14
---

# Phase 3 Plan 05: Calendar tRPC Router Summary

**9 tRPC procedures wiring polymorphic schema + RRULE/redact helpers into a single calendar.* surface — server-side rrule expansion (D-53), per-type RBAC (D-48), 6 audit codes (GDPR-04), SECURITY DEFINER cross-scope conflict probe with role-gated redaction (D-57), and pre-delete JSONB snapshot per D-58c.**

## Performance

- **Duration:** ~50 min
- **Started:** 2026-05-14T10:55Z (worktree base reset + plan read)
- **Completed:** 2026-05-14T11:47Z
- **Tasks:** 2
- **Files modified:** 2 (1 created, 1 modified)

## Accomplishments

- Created `src/server/trpc/routers/calendar.ts` (1207 lines) — exports `calendarRouter` with 9 procedures:
  `calendar.list`, `calendar.event.create`, `calendar.event.update`, `calendar.event.delete`,
  `calendar.event.declineParticipation`, `calendar.event.cancelOccurrence`, `calendar.event.get`,
  `calendar.event.detectConflicts`, `calendar.filterOptions.list`.
- Wired all six audit action codes that the Wave 5 integration test
  `tests/integration/calendar-audit.test.ts` expects (`calendar_event_created`, `_updated`, `_deleted`,
  `_declined`, `_conflict_override`, `_exception_created`).
- Called the SECURITY DEFINER overlap fn (`overlapping_events_for_users(uuid[], tstzrange[])`) with the
  ARRAY[tstzrange(...)] cast pattern; applied per-row redaction via `redactConflict` after the caller-
  participation probe.
- Implemented the D-58c cascade: SELECT FOR UPDATE base + extension + participants + exceptions →
  JSONB snapshot (capped at 1000 exceptions, with `exceptionsTotalCount` recording truncation) →
  `writeAudit` → DELETE → tx commit.
- Implemented RSVP-forgery prevention on `declineParticipation` via row-WHERE clause
  (`userId = callerId`) — defence-in-depth alongside the `cep_update_self` RLS policy.
- Registered `calendarRouter` on `appRouter` (`_app.ts`); `AppRouter` type re-export picks up the new
  sub-router automatically for the typed React client.
- `pnpm typecheck` passes against strict TS (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`).

## The 9 Procedures (Wave 5 reference table)

| Procedure                              | Input schema (Plan 03)        | Audit code emitted                                                                                          |
| -------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `calendar.list`                        | `listInput`                   | _none_ (read; no PII change)                                                                                 |
| `calendar.event.create`                | `eventCreateInput`            | `calendar_event_created` + optional `calendar_event_conflict_override` when `force:true`                    |
| `calendar.event.update`                | `eventUpdateInput`            | `calendar_event_updated` + optional `calendar_event_conflict_override` when `force:true`                    |
| `calendar.event.delete`                | `eventDeleteInput`            | `calendar_event_deleted` (snapshot in `oldValues`)                                                          |
| `calendar.event.declineParticipation`  | `declineParticipationInput`   | `calendar_event_declined`                                                                                    |
| `calendar.event.cancelOccurrence`      | `cancelOccurrenceInput`       | `calendar_event_exception_created`                                                                           |
| `calendar.event.get`                   | `eventGetInput`               | _none_ (read)                                                                                                |
| `calendar.event.detectConflicts`       | `detectConflictsInput`        | _none_ (read-only probe)                                                                                     |
| `calendar.filterOptions.list`          | `filterOptionsInput`          | _none_ (read)                                                                                                |

### The 6 audit action codes (Wave 5 test reference)

```
calendar_event_created
calendar_event_updated
calendar_event_deleted
calendar_event_declined
calendar_event_conflict_override
calendar_event_exception_created
```

All six are reachable via grep on `src/server/trpc/routers/calendar.ts`. The corresponding
`tests/integration/calendar-audit.test.ts` should be activated in Wave 5.

## Task Commits

1. **Task 1: Create calendar router with 9 procedures** — `33b9e9f` (feat)
2. **Task 2: Register calendarRouter on _app.ts** — `8d4c8da` (feat)

## Files Created/Modified

- `src/server/trpc/routers/calendar.ts` (created, 1207 lines) — full tRPC surface for Phase 3
  - 9 procedures composed via `router({...})`
  - 3 helper functions (`fetchExtensionRow`, `insertExtensionRow`, `deleteExtensionRow`) for
    per-event-type discriminated-union dispatch
  - 1 module-private helper (`detectConflictsForParticipants`) wrapping the SECURITY DEFINER call
    + caller-participation probe + display-name lookup + `redactConflict` application
  - `EventInstance` response shape (the contract the `calendar.list` UI consumes — Plan 06/07)
- `src/server/trpc/routers/_app.ts` (modified, +7 lines) — `calendarRouter` import + registration line:
  ```ts
  import { calendarRouter } from './calendar';
  // ...
  calendar: calendarRouter, // Phase 3 — Plan 03-05
  ```
  + JSDoc header updated to include the `calendar.*` sub-router list.

## Decisions Made

See `key-decisions` in frontmatter for the structured form. The five most-load-bearing:

1. **Inline role allowlist instead of input-aware middleware**: the plan's example
   `.use(async (opts) => requireRoleForEventType(opts.input.type)(opts))` does not compile against
   tRPC v11 because middleware doesn't receive the parsed input in that shape, and trying to thread
   it through `getRawInput` is more code than a one-line `if (!canCreateEventType(role, type))` in
   the handler. The shared matrix in `middleware/calendarCreate.ts` is still the single source of
   truth, and the RLS INSERT WITH CHECK policy at the DB layer is the defence-in-depth backstop.
2. **`AnyTx` typed helpers**: Drizzle's transaction callbacks receive a `PgTransaction` handle that
   isn't assignable to `DbClient` (= `PostgresJsDatabase & { $client }`). Rather than threading a
   second type parameter everywhere, the three extension-table helpers accept a loose `any`-typed
   handle and use only the methods both shapes share. Top-level handler signatures keep `DbClient`.
3. **`occurrenceDate` Date → 'YYYY-MM-DD' serialisation in `cancelOccurrence`**: the Zod schema
   accepts a Date (so the UI can send `new Date(...)` directly), and the handler slices the ISO
   string before the Drizzle `date()` insert. Audit-row JSONB stores the same string shape.
4. **`Array<{...}>: string` participant-array typing in `create`/`update`**: the literal-narrowed
   `'pending' as const` form clashed with the `'accepted'` add-on push for the creator-organizer
   row. Explicit element-typed array with plain `string` for `rsvpStatus`/`roleInEvent` keeps
   both branches assignable while the Drizzle `as any` cast (matching the player.ts idiom for
   Drizzle's strict insert-shape inference) handles the `createdAt` default.
5. **`postgres-js` vs `pg` result-shape normalisation**: the SECURITY DEFINER call and the
   `filterOptions.list` queries normalise `Array<T>` vs `{rows: T[]}` because postgres-js returns
   the array directly while some other drivers wrap. This makes the code portable if the Drizzle
   client is ever swapped.

## Deviations from Plan

The plan's code template was followed faithfully for the 9 procedures' shape, audit codes, conflict
logic, and snapshot/delete order. Three small implementation adjustments were made — all in the
"make the strict-TS / Drizzle types compile" category, not behavioural changes.

### Rule 3 — Blocking: middleware composition shape

- **Found during:** Task 1 (first typecheck after authoring the router).
- **Issue:** The plan template used
  `.use(async (opts) => requireRoleForEventType(opts.input.type)(opts as any))`, but tRPC v11's
  `MiddlewareBuilder.use()` signature rejects this — `opts` has no `input` property in the
  middleware shape (input is parsed by `.input()`, not threaded into preceding `.use()` calls).
- **Fix:** Replaced the `.use(...)` line with an inline `canCreateEventType` check at the top of
  the mutation handler. `canCreateEventType` is the public predicate already exported from
  `middleware/calendarCreate.ts` for exactly this kind of imperative check (its docstring lists
  "tests, ad-hoc checks" as the use case). The CREATE_ALLOWED_ROLES matrix remains the single
  source of truth for the D-48 RBAC dispatch; the RLS INSERT WITH CHECK policy on `calendar_events`
  is the DB-layer defence in depth.
- **Files modified:** src/server/trpc/routers/calendar.ts (event.create handler).
- **Verification:** `pnpm typecheck` passes; D-48 semantics preserved (e.g. trainers can still
  create training events but not tournaments — same matrix is checked).
- **Committed in:** `33b9e9f` (Task 1 commit).

### Rule 3 — Blocking: Drizzle transaction handle vs `DbClient`

- **Found during:** Task 1 (typecheck output reported four TS2352 errors casting `tx as DbClient`).
- **Issue:** Drizzle's `db.transaction(callback)` invokes `callback` with a `PgTransaction` instance
  that does NOT satisfy the `PostgresJsDatabase & { $client: Sql<{}> }` shape exported as
  `DbClient` from `src/server/db/client.ts`. The plan template's `as DbClient` casts therefore
  failed the strict-TS `noImplicitAny`/`exactOptionalPropertyTypes` config.
- **Fix:** Introduced a module-local `AnyTx = any` type alias and changed the three extension-table
  helpers (`fetchExtensionRow`, `insertExtensionRow`, `deleteExtensionRow`) to accept it. Each
  helper still uses only the shared method surface (insert/select/delete) — runtime behaviour is
  unchanged. Top-level handler signatures (e.g. `detectConflictsForParticipants`) keep the strict
  `DbClient` parameter type.
- **Files modified:** src/server/trpc/routers/calendar.ts (helper signatures + the three call
  sites inside the create/update/delete txes).
- **Verification:** `pnpm typecheck` passes; all helpers still receive the actual `tx` handle at
  runtime so the RLS-aware transaction context is preserved.
- **Committed in:** `33b9e9f` (Task 1 commit).

### Rule 3 — Blocking: Drizzle `$inferInsert` strictness

- **Found during:** Task 1 (typecheck output reported five TS2769 errors on `.values()` calls for
  `calendar_events`, `calendar_event_participants`, and `calendar_event_exceptions`).
- **Issue:** Drizzle 0.40+ `$inferInsert` types require explicit `createdAt`/`updatedAt` fields
  even when the column has a `DEFAULT NOW()` (it doesn't pick up the default through the `tstz`
  helper's conditional return shape). This is the same paper cut Phase 2's player.ts resolved with
  `.values(... as any)` (see comments at player.ts:124–125, 138–145, 156–162).
- **Fix:** Applied the same idiom — added `// eslint-disable-next-line @typescript-eslint/no-explicit-any`
  + `as any` casts on the three Drizzle inserts that hit this issue. The cast is local and
  documented; the DB schema's CHECK constraints + RLS WITH CHECK policies + Zod input validation
  remain the source of truth for what values are actually permitted.
- **Files modified:** src/server/trpc/routers/calendar.ts (3 `.values(...)` call sites).
- **Verification:** `pnpm typecheck` passes; matches the established Phase 2 pattern.
- **Committed in:** `33b9e9f` (Task 1 commit).

---

**Total deviations:** 3 auto-fixed (all Rule 3 — Blocking: type-system fixes to compile the
plan's code template under the project's strict TS config).
**Impact on plan:** All three are purely mechanical type-system accommodations to match strict-TS
+ Drizzle 0.40+ + tRPC v11 — no behavioural change from the plan. The 9 procedures are wired
exactly as specified; the 6 audit codes are emitted at the exact points the plan describes; the
SECURITY DEFINER call shape and redaction flow match D-57. No scope creep.

## Issues Encountered

- **Pre-existing `pnpm lint` failure (DI-02 in deferred-items.md)** — ESLint runner throws on
  `Converting circular structure to JSON ... property 'react' closes the circle`. Confirmed
  pre-existing by stashing my changes and re-running on the worktree base (same failure). Out of
  scope for this plan; already documented for a Phase 8 ESLint config tidy-up. The
  `pnpm typecheck` gate that the plan actually requires passes cleanly.

## Threat Surface Scan

Reviewed every file created/modified against the plan's `<threat_model>`:

- T-03-21 CONFLICT-PRIVILEGE-ESCALATION → mitigated: `detectConflictsForParticipants` calls
  SECURITY DEFINER, then applies `redactConflict` row-by-row using the
  `callerIsParticipantInConflicting` probe result. Caller-participation is read through RLS, so
  the caller can only confirm participation in events they themselves can see.
- T-03-22 RSVP-FORGERY → mitigated: `declineParticipation` uses
  `where(and(eq(eventId), eq(userId, callerId)))` so the UPDATE matches only the caller's own row.
- T-03-23 DELETE-SNAPSHOT-MISSING → mitigated: `writeAudit` is called BEFORE `db.delete` inside the
  same `db.transaction`. If the audit fails the data delete rolls back.
- T-03-24 DELETE-SNAPSHOT-BLOAT → mitigated: `exceptionRows.slice(0, MAX_EXCEPTIONS)` with
  `MAX_EXCEPTIONS = 1000` plus `exceptionsTotalCount` tracking the untruncated count.
- T-03-25 RRULE-DOS-EXPANSION → mitigated by upstream `expandRrule` clamping `to` to
  `dtstart + 2y`, plus Zod `listInput` refines `(to - from) <= 2y`.
- T-03-26 PER-TYPE-RBAC-BYPASS → mitigated via inline `canCreateEventType(role, type)` check
  inside `event.create` (same matrix the plan's middleware-factory would have applied; RLS
  WITH CHECK is the DB backstop).
- T-03-27 NOT_FOUND-VS-FORBIDDEN → mitigated: `event.get`, `event.update`, and `event.delete`
  all throw `TRPCError({ code: 'NOT_FOUND' })` on missing rows — never reveals whether the row
  exists in another caller's scope.
- T-03-28 CONFLICT-OVERRIDE-NO-AUDIT → mitigated: when `force:true` the override audit row is
  written BEFORE the success audit and before the (potential) success return — so even a failed
  follow-up mutation leaves the override decision in the trail.

No new threat surfaces introduced beyond what the plan's threat_model already covered.

## User Setup Required

None — this plan only wires existing pieces into a tRPC router. No external service config, no
new environment variables, no DB migrations.

## Next Phase Readiness

- The 8 Wave 0 integration test files (`calendar-rls`, `calendar-audit`, `calendar-conflicts`,
  `calendar-decline`, `calendar-cascade`, `calendar-exceptions`, `calendar-rrule-horizon`,
  `calendar-filter-options`) referenced by the plan's success criteria can be activated in Wave 5
  — every endpoint and audit-code they reference exists.
- Plan 03-06 (calendar page UI) and 03-07 (FullCalendar week view) can consume
  `trpc.calendar.list` / `trpc.calendar.event.*` directly via the typed React client — the
  `AppRouter` type picks up the new sub-router automatically.

## Self-Check: PASSED

- `src/server/trpc/routers/calendar.ts`: FOUND (1207 lines, 9 procedures exported).
- `src/server/trpc/routers/_app.ts`: FOUND (calendar import + registration on appRouter).
- Commit `33b9e9f`: FOUND in git log.
- Commit `8d4c8da`: FOUND in git log.
- All 22 plan grep checks pass (file existence + 9 procedure declarations + 6 audit codes +
  SECURITY DEFINER fn ref + horizon helpers + redactConflict + NOT_FOUND + writeAudit).
- `pnpm typecheck` exits 0.

---
*Phase: 03-kalender*
*Plan: 05*
*Completed: 2026-05-14*
