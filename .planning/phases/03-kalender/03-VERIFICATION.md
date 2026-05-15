---
phase: 03-kalender
verified: 2026-05-15T14:35:00Z
status: human_needed
score: 16/17
overrides_applied: 0
human_verification:
  - test: "TD opens /[locale]/calendar — week view loads with all 6 event types visible, each correctly color-coded"
    expected: "FullCalendar timeGridWeek is default; training=blue, tournament=orange, meeting=green, stage=purple, evalconv=yellow, medical=red chips visible with seeded data"
    why_human: "Requires running Next.js dev server + seeded Postgres; can't verify SSR + FullCalendar mount without browser"
  - test: "Player logs in and opens calendar — sees ONLY own events, not other players' events"
    expected: "Player scope via calendar_events_visible_to() returns only events where player is a participant; direct API call with another player's credentials returns empty for out-of-scope events"
    why_human: "RLS correctness requires DB running + multiple user sessions; testcontainer not available in this environment"
  - test: "Sparring partner logs in — sees zero events (Phase 3 D-50 NO-OP)"
    expected: "calendar.list returns [] for sparring_partner role; direct psql with GUC set confirms zero rows; will be wired in Phase 4"
    why_human: "Requires running Postgres with GUC-bound session"
  - test: "Create event for a participant who has an existing event at the same time — ConflictWarning surfaces; clicking 'Toch opslaan' succeeds and writes audit_log conflict_override row"
    expected: "TRPCError CONFLICT thrown; UI shows ConflictWarning with participant name + redacted/full detail; force:true submission creates event and writes calendar_event_conflict_override audit row"
    why_human: "Requires running dev server + DB; end-to-end flow across create sheet, conflict warning, and audit log"
  - test: "Mobile viewport (Pixel 5 / 360×640px) — timeGridDay renders; horizontal swipe navigates to next/prev day"
    expected: "isMobile=true forces timeGridDay; pointer swipe dx≥60px, dt≤400ms calls calendarRef.current.getApi().next()/prev(); FAB or CTA visible in fixed position"
    why_human: "Requires browser with touch/pointer emulation; Playwright e2e not runnable in this CI-style environment"
  - test: "Drag an existing event to a new time slot — optimistic update visible; if conflicting, CalendarBanner appears and revert is called"
    expected: "eventDrop dispatches calendar:event-drop; EventEditSheet/mutation processes the move; on server CONFLICT response, ConflictBanner shows and revert() is invoked to snap back"
    why_human: "Requires browser + running server + drag-and-drop interaction"
  - test: "Color contrast WCAG AA for all 6 event type chips (light + dark modes)"
    expected: "Each --cal-event-{type}-fg on --cal-event-{type}-bg meets 4.5:1 contrast ratio; design review sign-off"
    why_human: "WCAG contrast audit requires color-contrast tool or browser DevTools inspection with design review"
  - test: "Cross-locale visual regression: calendar renders correctly in nl, en, fr — date headers, weekday short names, event copy, filter labels match catalogs"
    expected: "Dutch Monday='Ma', English Monday='Mon', French Monday='Lu'; event chip labels use correct locale; filter bar labels translated"
    why_human: "Per-locale screenshot diff is out of scope for Phase 3; deferred to Phase 8 release-quality polish per 03-VALIDATION.md §Manual-Only Verifications"
---

# Phase 3: Kalender — Verification Report

**Phase Goal:** De kalender is de centrale dagelijkse werkvlakte van het platform; na deze fase kunnen alle gebruikersrollen hun gescopede agenda zien en kunnen de eerste evenementtypen worden aangemaakt — inclusief volledige domeinkolommen per type (D-47 schema-uitbreiding) zodat Phase 4 uitsluitend de operationele/result-laag toevoegt.

**Verified:** 2026-05-15T14:35:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Polymorphic schema (10 tables) exists with full domain columns per D-47 | VERIFIED | `src/server/db/schema/calendar.ts` (283 lines): `calendar_events` + `calendar_event_participants` + `calendar_event_exceptions` + 6 typed extension tables (`training_sessions`, `tournaments`, `meetings`, `stages`, `eval_conversations`, `medical_appointments`); each with correct FK ON DELETE CASCADE |
| 2 | 4 migrations (0009–0012) exist with rollback companions | VERIFIED | `drizzle/0009_*.sql`, `0010_*.sql`, `0011_*.sql`, `0012_*.sql` + matching `.rollback.md` files confirmed present |
| 3 | 38 RLS policies + 2 SECURITY DEFINER functions in migration 0011 | VERIFIED | `grep "CREATE POLICY"` = 38; `calendar_events_visible_to(UUID, TEXT)` and `overlapping_events_for_users(uuid[], tstzrange[])` both defined SECURITY DEFINER with REVOKE PUBLIC + GRANT app_user in `0011_phase3_calendar_rls_policies.sql` (389 lines) |
| 4 | tRPC calendar router with 9 procedures and RLS context wiring | VERIFIED | `src/server/trpc/routers/calendar.ts` (1207 lines): `list`, `event.create`, `event.update`, `event.delete`, `event.declineParticipation`, `event.cancelOccurrence`, `event.get`, `event.detectConflicts`, `filterOptions.list` — all `protectedProcedure`; `calendarRouter` registered in `_app.ts` line 45 |
| 5 | Per-type RBAC matrix (D-48) enforced at tRPC layer | VERIFIED | `src/server/trpc/middleware/calendarCreate.ts`: `canCreateEventType()` predicate with correct allowlist (training→TD+trainer; tournament/stage/evalconv/medical→TD only; meeting→all roles); applied inline in `event.create` |
| 6 | RRULE 2-year horizon validation (D-55): write-time + read-time | VERIFIED | `src/lib/rrule.ts` (240 lines): `validateHorizon()` rejects rules without UNTIL/COUNT or UNTIL > createdAt+2y; `expandRrule()` clamps read-time to dtstart+2y; `ensureHorizon()` auto-injects UNTIL for "never" rules |
| 7 | Conflict detection: SECURITY DEFINER cross-scope + role-gated redaction (D-57) | VERIFIED | `src/lib/calendar/conflicts.ts` (164 lines): `redactConflict()` pure function; `detectConflictsForParticipants()` in calendar.ts calls `overlapping_events_for_users()` SQL fn + membership probe + display-name lookup; returns `{conflicts, blocked: false}` |
| 8 | Pre-delete JSONB snapshot + 6 audit action codes (GDPR-04, D-58c) | VERIFIED | `calendar_event_deleted` handler: SELECT FOR UPDATE → snapshot (base+extension+participants+exceptions, capped 1000) → `writeAudit` → DELETE; all 6 codes confirmed: `calendar_event_created`, `calendar_event_updated`, `calendar_event_deleted`, `calendar_event_declined`, `calendar_event_conflict_override`, `calendar_event_exception_created` |
| 9 | /kalender route with FullCalendar 6.x week-view-default + RLS-scoped initial events | VERIFIED | `src/app/[locale]/(app)/calendar/page.tsx` (186 lines): RSC pattern, `appRouter.createCaller(ctx)`, `calendar.list({from, to})`, initialEvents passed to `<CalendarView>`; default view='week'; role-gated `canCreate` |
| 10 | CalendarView: 6 color-coded event types, mobile timeGridDay + swipe (CAL-08) | VERIFIED | `src/components/calendar/calendar-view.tsx` (335 lines): `viewName()` forces `timeGridDay` when `isMobile`; pointer-event swipe handler (60px threshold, 400ms max, touch-only); `renderEventChip` with all 6 type-to-slug mappings |
| 11 | 36 CSS color tokens (18 × light+dark) in globals.css | VERIFIED | `src/app/[locale]/globals.css`: 36 `--cal-event-{type}-{bg/fg/border}` declarations confirmed; `grep -c "cal-event-" globals.css = 36`; colors: training=blue, tournament=orange, meeting=green, stage=purple, evalconv=yellow, medical=red |
| 12 | Write-side UI: EventCreateSheet, EventDetailSheet, EventEditSheet, EventDeleteDialog (D-58b) | VERIFIED | All 5 components exist under `src/components/calendar/`; EventCreateSheet (549 lines) wired to `trpc.calendar.event.create.useMutation()`; EventEditSheet (600 lines) wired to `event.update`; ConflictBanner (277 lines) and ConflictWarning (143 lines) present |
| 13 | Filter bar: 6 type chips + scope-filtered typeahead (CAL-04, CAL-05) + URL state | VERIFIED | `src/components/calendar/event-filter-bar.tsx` (329 lines): base64 URL state, ToggleGroup for 6 types, FilterCombobox for player/trainer/sparring/academy via `filterOptions.list`; `sparring_partner` returns `[]` (D-50 no-op) |
| 14 | 3 locale catalogs extended with calendar.*, errors.calendar.*, lookup.eventType.* (I18N-08) | VERIFIED | `messages/nl.json`, `en.json`, `fr.json` all contain `calendar` (9 top-level keys, 96 nodes in nl), `errors.calendar` (7 keys), `lookup.eventType` (6 codes); confirmed via Python parse |
| 15 | 2 reusable compound components: DateTimePicker + RruleEditor | VERIFIED | `src/components/common/date-time-picker.tsx` (118 lines), `src/components/common/rrule-editor.tsx` (178 lines) both exist and are substantive |
| 16 | Unit tests (rrule, color-tokens, calendar-schemas) pass green | VERIFIED | `pnpm test -- --run "tests/unit/rrule"` = 13/13 PASS; `tests/unit/color-tokens` = 14/14 PASS; `tests/unit/calendar-schemas` = 12/12 PASS; `pnpm typecheck` exits 0 |
| 17 | All user roles see only scope-appropriate events (CAL-04) and sparring partner is Phase 3 NO-OP (D-50) | UNCERTAIN (PARTIAL) | Schema + RLS policies + SECURITY DEFINER functions verified in code; `calendar_events_visible_to()` has role-based UNION branches per D-50 visible in migration SQL; correctness of RLS branches requires Postgres testcontainer (unavailable in this environment) — integration and RLS test files exist with real assertions but cannot be executed here |

**Score:** 16/17 truths verified (1 PARTIAL requiring DB integration)

---

### Deferred Items

Items not yet met but explicitly addressed in later milestone phases.

| # | Item | Addressed In | Evidence |
|---|------|-------------|----------|
| 1 | CAL-06: ICS/iCal export for Outlook sync | Phase 8 | ROADMAP.md line 283: "CAL-06 (ICS-export) is een release-quality feature en wordt afgewerkt in Fase 8"; Phase 8 plans: "CAL-06 (ICS), OPS-07..12, I18N-10" |
| 2 | sparring_partner calendar scope wired to actual sessions | Phase 4 | ROADMAP.md Phase 3 SC #3: "Phase 3 NO-OP per D-50; Phase 4 wires session_sparring_partners"; Phase 4 ROADMAP explicitly fills the sparring RLS UNION branches |

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/server/db/schema/calendar.ts` | 10 polymorphic tables | VERIFIED | 283 lines; all 10 tables present with correct FK cascade and constraints |
| `drizzle/0009_*.sql` | Base table + lookup + participants + exceptions | VERIFIED | File present with rollback companion |
| `drizzle/0010_*.sql` | 6 extension tables | VERIFIED | File present with rollback companion |
| `drizzle/0011_*.sql` | 38 RLS policies + 2 SECURITY DEFINER fns | VERIFIED | 389 lines; 38 CREATE POLICY statements; both SECURITY DEFINER functions defined |
| `drizzle/0012_*.sql` | event_type seed (6 codes) | VERIFIED | File present with rollback companion |
| `src/lib/rrule.ts` | parseRrule/expandRrule/validateHorizon/ensureHorizon | VERIFIED | 240 lines; all 4 exports substantive |
| `src/lib/calendar/conflicts.ts` | redactConflict, redactConflicts, shouldFlagAsConflict | VERIFIED | 164 lines; pure functions with full D-57 policy |
| `src/server/trpc/routers/calendar.ts` | 9 procedures | VERIFIED | 1207 lines; all 9 procedures present with real DB queries |
| `src/server/trpc/schemas/calendar.ts` | Discriminated-union Zod schemas | VERIFIED | 287 lines; per-type strict schemas with i18n-key errors (I18N-08) |
| `src/server/trpc/middleware/calendarCreate.ts` | D-48 RBAC matrix | VERIFIED | 87 lines; correct allowlist per design decision |
| `src/app/[locale]/(app)/calendar/page.tsx` | RSC + initial server-side fetch | VERIFIED | 186 lines; createCaller pattern, view/date URL parsing, all write-side sheet mounts |
| `src/components/calendar/calendar-view.tsx` | FullCalendar 6.x client boundary | VERIFIED | 335 lines; dynamic locale loading, mobile detection, swipe handler, 6-type event chip |
| `src/components/calendar/event-chip.tsx` | 6-type color-coded chip renderer | VERIFIED | TYPE_TOKEN_SLUG maps all 6 codes; CSS var() tokens applied |
| `src/components/calendar/event-create-sheet.tsx` | Create form with discriminated union | VERIFIED | 549 lines; `trpc.calendar.event.create.useMutation()` wired |
| `src/components/calendar/event-filter-bar.tsx` | Filter bar + URL state | VERIFIED | 329 lines; base64 URL state, 4 typeahead combos, 6 type chips |
| `src/components/calendar/conflict-banner.tsx` | Drag-move conflict banner | VERIFIED | 277 lines; listens for `calendar:event-drop`/`calendar:event-resize` custom events |
| `src/components/calendar/conflict-warning.tsx` | Create/edit conflict warning | VERIFIED | 143 lines; surfaces ConflictWarning inside create/edit sheets |
| `src/components/common/date-time-picker.tsx` | Reusable DateTimePicker | VERIFIED | 118 lines; substantive component for Phase 4/5 reuse |
| `src/components/common/rrule-editor.tsx` | Reusable RruleEditor | VERIFIED | 178 lines; substantive component for Phase 4/5 reuse |
| `messages/nl.json` + `en.json` + `fr.json` | calendar.* + errors.calendar.* + lookup.eventType.* | VERIFIED | All 3 locales verified via Python parse; nl has 96 calendar nodes, 7 error keys, 6 event type codes |
| `src/app/[locale]/globals.css` | 36 color tokens × 2 modes + FC overrides | VERIFIED | 36 cal-event-* tokens confirmed; FullCalendar override block present |
| `tests/unit/rrule.test.ts` | Real assertions, passing green | VERIFIED | 13/13 pass; DST boundary, exception skip, horizon validation all concrete assertions |
| `tests/unit/color-tokens.test.ts` | Real assertions, passing green | VERIFIED | 14/14 pass; all 18 tokens × 2 modes asserted against actual globals.css |
| `tests/unit/calendar-schemas.test.ts` | Real assertions, passing green | VERIFIED | 12/12 pass; discriminated union, strict(), i18n keys, horizon rejection |
| `tests/fixtures/calendar-seed.ts` | Implemented seedCalendarFixtures (not throwing) | VERIFIED | 314 lines; function body implemented (not the Wave-0 throw stub); no "throw new Error" found |
| All 13 integration/RLS/e2e test files | Exist with real assertions | VERIFIED | All 13 files present (path-checked); real assertions visible (no todo stubs in calendar-rls.test.ts sample check); requires DB testcontainer to execute |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `calendar/page.tsx` | `calendar.list` procedure | `appRouter.createCaller(ctx)` | WIRED | Line 101: `const caller = appRouter.createCaller(ctx)` + `caller.calendar.list({from, to})` |
| `calendar-view.tsx` | `CalendarView` component | `import { CalendarView }` in page.tsx | WIRED | Line 40 in page.tsx; line 121 in calendar-view.tsx exports the component |
| `event-create-sheet.tsx` | `calendar.event.create` | `trpc.calendar.event.create.useMutation()` | WIRED | Line 241 in event-create-sheet.tsx |
| `calendarRouter` | `_app.ts` | `calendar: calendarRouter` | WIRED | `_app.ts` line 35 import + line 45 registration |
| `calendar.ts router` | `writeAudit` middleware | `import { writeAudit } from '../middleware/audit'` | WIRED | Line 70 import; 7 call sites across create/update/delete/decline/cancelOccurrence |
| `calendar.ts router` | `overlapping_events_for_users()` SQL fn | `sql\`...FROM overlapping_events_for_users(...)\`` | WIRED | Lines 1080-1093 in calendar.ts; fn defined in migration 0011 |
| `calendar.ts router` | `redactConflict` | `import { redactConflict }` from conflicts.ts | WIRED | Line 52-53 import; line 1190-1205 usage in detectConflictsForParticipants |
| `event-create-sheet.tsx` | `conflict-warning.tsx` | `import { ConflictWarning }` | WIRED | Conflict state passed through create sheet flow |
| `calendar-events` base table | 6 extension tables | `FK REFERENCES calendar_events(id) ON DELETE CASCADE` | WIRED | Confirmed in schema.ts and migration 0010 |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `calendar/page.tsx` | `initialEvents` | `caller.calendar.list({from, to})` | DB query via `SELECT FROM calendar_events WHERE ...` (lines 306-324 in router) | FLOWING |
| `calendar-view.tsx` | `fcEvents` (EventInput[]) | `initialEvents` prop from page.tsx | Derived from server-fetched DB rows; `useMemo` transforms to FullCalendar format | FLOWING |
| `event-filter-bar.tsx` | `filterOptions` | `filterOptions.list` queries `players`, `trainers`, `academy` tables via RLS | Real DB queries (lines 1008-1054 in router) | FLOWING |
| `conflict-banner.tsx` | conflict state | `calendar:event-drop`/`calendar:event-resize` custom events → tRPC `event.update` call | Populated on actual drag+drop interactions; listener wired | FLOWING |

---

### Behavioral Spot-Checks

Step 7b: SKIPPED for integration/e2e behaviors (requires running Postgres + Next.js dev server). Unit-level spot-checks run as part of Step 3.

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| rrule unit tests pass | `pnpm test -- --run "tests/unit/rrule"` | 13/13 PASS | PASS |
| color-tokens unit tests pass | `pnpm test -- --run "tests/unit/color-tokens"` | 14/14 PASS | PASS |
| calendar-schemas unit tests pass | `pnpm test -- --run "tests/unit/calendar-schemas"` | 12/12 PASS | PASS |
| TypeScript compiles cleanly | `pnpm typecheck` | exit 0 | PASS |
| FullCalendar deps present | `grep "@fullcalendar/core" package.json` | Found at `^6.1.20` | PASS |
| SECURITY DEFINER fns in migration | `grep "SECURITY DEFINER" drizzle/0011_*.sql` | 9 matches | PASS |
| 38 RLS policies in migration | `grep "CREATE POLICY" drizzle/0011_*.sql \| wc -l` | 38 | PASS |
| 6 audit codes present in router | `grep "action: 'calendar_event" router/calendar.ts` | All 6 found | PASS |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| CAL-01 | 03-01..03-08 | Calendar week view (timeGridWeek) default | VERIFIED | `viewName()` returns `timeGridWeek` by default; `initialView={view}` in CalendarView |
| CAL-02 | 03-06 | Month + year views available | VERIFIED | `dayGridMonth` (month) and `multiMonthYear` (year) plugins registered; CalendarToolbar has view switcher |
| CAL-03 | 03-04, 03-06 | 6 event types color-coded | VERIFIED | 36 CSS tokens + event-chip TYPE_TOKEN_SLUG + globals.css |
| CAL-04 | 03-05, 03-06, 03-07 | Scope-filtered calendar events | SATISFIED (partial UAT) | RLS via `calendar_events_visible_to()`; `filterOptions.list` scope-filters typeahead; DB integration test requires Postgres |
| CAL-05 | 03-07 | Filter bar: player/trainer/sparring/academy/type | VERIFIED | EventFilterBar with 4 typeahead combos + 6 type ToggleGroup chips |
| CAL-06 | (none in Phase 3) | ICS/iCal export | DEFERRED | Explicitly deferred to Phase 8 in ROADMAP.md line 283 |
| CAL-07 | 03-05, 03-07 | Conflict warning on overlap | VERIFIED | `detectConflictsForParticipants()` + `ConflictWarning` + `ConflictBanner` + force:true override audit |
| CAL-08 | 03-06 | Mobile single-day + swipe | VERIFIED (code); UAT needed | isMobile detection + `timeGridDay` forced + pointer-event swipe (60px, 400ms) — physical device UAT required |
| TRAIN-01 | 03-02 | Training fields: type/organisation/trainer/duration | VERIFIED | `training_sessions` table: `duration_minutes`, `training_type_code`, `organisation_code`, `trainer_id` |
| TOURN-01 | 03-02 | Tournament fields: city/country/age_category/type | VERIFIED | `tournaments` table: `city`, `country`, `age_category_code`, `tournament_type_code` |
| MED-EVENT | 03-02 | Medical appointment fields (non-Article-9 only) | VERIFIED | `medical_appointments` table: `is_injury`, `doctor` (non-Article-9; Article-9 data stays in Phase 1's `medical_events`) |
| GDPR-04 | 03-05 | Audit log on every mutation | VERIFIED | `writeAudit` called at 7 sites covering all 6 audit action codes; pre-delete snapshot per D-58c |
| GDPR-08 | 03-02 | TIMESTAMPTZ UTC storage | VERIFIED | `tstz()` helper used for `starts_at`, `ends_at`, `created_at`, `updated_at`; comment in schema.ts references GDPR-08 |
| I18N-08 | 03-04 | Zod errors as i18n keys | VERIFIED | All Zod schemas use `{ message: 'errors.calendar.*' }` pattern; `errors.calendar.*` keys present in all 3 locales |
| USER-04 | 03-02, 03-05 | Scope enforcement at API + DB layer | SATISFIED (partial UAT) | RLS policies + SECURITY DEFINER function in migration; tRPC `protectedProcedure` wraps all procedures; DB layer enforcement requires Postgres UAT |

**Note on MED-EVENT:** This identifier is not a formal REQUIREMENTS.md ID. It maps to the concept described across `MED-01` (medical event fields) and AGE calendar metadata. The `medical_appointments` extension table implements the calendar-layer metadata for medical appointments (non-Article-9 data only); the GDPR-protected Article-9 data lives in Phase 1's `medical_events` table per the scoping note in `calendar.ts` schema file.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `calendar-view.tsx` | 240 | `return null` when fcLocale not yet loaded | INFO | Intentional: gates FullCalendar mount until dynamic locale module resolves; outer Suspense shows skeleton — not a data stub |
| `conflict-banner.tsx` | 211, 214 | `if (!state) return null` / `if (!first) return null` | INFO | Intentional: banner only renders when a conflict event is dispatched; not a stub |
| `calendar.ts router` | 192 | `type AnyTx = any` for transaction handle | INFO | Known Drizzle type limitation; documented with comment; no security impact |

No blockers found. The `return null` patterns are functional guards, not placeholder stubs — each has a clear rendering path that activates when real data arrives.

---

### Human Verification Required

#### 1. Week view rendering with scoped data (TD role)

**Test:** Log in as a Technical Director → navigate to `/nl/calendar` → verify week view is default, all 6 event types are visible with correct colors (training=blue, tournament=orange, meeting=green, stage=purple, evalconv=yellow, medical=red).
**Expected:** FullCalendar `timeGridWeek` renders with color-coded chips; clicking a chip opens EventDetailSheet.
**Why human:** Requires Next.js dev server + seeded Postgres DB; FullCalendar mount requires browser APIs.

#### 2. Player scope isolation — RLS correctness

**Test:** Log in as Player A → open calendar → confirm only own events visible. Then attempt to call `calendar.list` API directly with Player B's session token — expect empty results for Player B's private events.
**Expected:** Player scope enforced by `calendar_events_visible_to()` SECURITY DEFINER function; zero out-of-scope rows returned even via direct API call.
**Why human:** Multi-user RLS correctness requires running Postgres with GUC-bound sessions per role.

#### 3. Sparring partner NO-OP (Phase 3 D-50)

**Test:** Log in as a sparring partner account → open calendar → confirm zero events visible.
**Expected:** `calendar.list` returns `[]`; will be wired in Phase 4 (session_sparring_partners junction).
**Why human:** Requires running DB with sparring_partner role session.

#### 4. Conflict warning + override flow

**Test:** Create an event for Player X who already has an existing event at the same time → confirm ConflictWarning surface → click "Toch opslaan" → verify event created + `calendar_event_conflict_override` audit row.
**Expected:** TRPCError CONFLICT raised on first submit; ConflictWarning shows participant name (redacted or full per D-57); force:true resubmit succeeds; audit_log has override row with `force: true`.
**Why human:** End-to-end create sheet → conflict → force flow requires running server + DB.

#### 5. Mobile swipe navigation (CAL-08)

**Test:** Open calendar on 360×640px viewport (Pixel 5 or DevTools emulation) → confirm `timeGridDay` renders → perform horizontal swipe (>60px) → verify navigation to next/prev day.
**Expected:** `isMobile` state triggers `timeGridDay`; swipe handler calls `calendarRef.current.getApi().next()` / `.prev()` correctly.
**Why human:** Touch/pointer event emulation in Playwright not reliable for this flow; physical device or browser DevTools required.

#### 6. Drag-and-drop edit + conflict revert

**Test:** Drag a training session event to a conflicting time slot → verify optimistic UI update → confirm ConflictBanner appears → verify `revert()` is called and event snaps back.
**Expected:** `calendar:event-drop` dispatched → EventEditSheet/mutation processes → CONFLICT response → ConflictBanner shows → revert() invoked.
**Why human:** Requires browser drag-and-drop interaction + running server.

#### 7. WCAG AA color contrast for event chips

**Test:** Run color-contrast check on all 6 event type chip combinations in light and dark modes.
**Expected:** `--cal-event-{type}-fg` on `--cal-event-{type}-bg` meets 4.5:1 contrast ratio for all 6 types × 2 modes.
**Why human:** Requires design tooling or browser DevTools color-contrast inspection; design review sign-off needed.

#### 8. Cross-locale UI rendering (nl/en/fr)

**Test:** Open calendar in each locale → verify date headers, weekday short names, filter labels, event chip labels all match the locale catalogs.
**Expected:** nl: 'Kalender', 'Ma Di Wo Do Vr Za Zo'; en: 'Calendar', 'Mon Tue...'; fr: 'Calendrier', 'Lu Ma...'.
**Why human:** Per-locale visual regression (Playwright screenshot diff) deferred to Phase 8 per `03-VALIDATION.md §Manual-Only Verifications`.

---

### Gaps Summary

No blockers. The single PARTIAL truth (Truth #17 — RLS scope correctness across all roles) has:
- All structural code in place (SECURITY DEFINER functions, RLS policies, tRPC middleware, sparring D-50 no-op)
- Integration and RLS test files present with real assertions (not todos)
- The gap is purely the inability to execute DB-level integration tests in this CI-style environment (Docker testcontainer unavailable)

This is the documented Phase 3 infrastructure constraint, not a code gap. The 8 human verification items above are the required UAT against a running dev server before Phase 3 can be marked fully complete.

**CAL-06 (ICS/iCal export)** is explicitly deferred to Phase 8 in ROADMAP.md and is not a Phase 3 gap.

---

_Verified: 2026-05-15T14:35:00Z_
_Verifier: Claude (gsd-verifier)_
