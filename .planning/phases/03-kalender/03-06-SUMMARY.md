---
phase: 03-kalender
plan: 06
subsystem: ui
tags: [next-15, react-19, fullcalendar-6, server-components, suspense, fullcalendar-locales, mobile-swipe, url-state]

requires:
  - phase: 03-kalender
    provides: "calendar.list tRPC procedure + EventInstance shape (Plan 05)"
  - phase: 03-kalender
    provides: "--cal-event-* design tokens + FullCalendar .fc overrides (Plan 04)"
  - phase: 03-kalender
    provides: "shadcn primitives (sheet, alert, command, toggle, toggle-group, scroll-area) (Plan 01)"
  - phase: 03-kalender
    provides: "calendar.* i18n catalogs in nl/en/fr (Plan 04)"
  - phase: 01-fundament
    provides: "createContext + appRouter.createCaller server-caller pattern (BLOCKER-03)"
  - phase: 01-fundament
    provides: "(app) layout auth redirect, TrpcProvider, next-intl routing"

provides:
  - "/[locale]/(app)/calendar route — Server Component pre-fetching the visible-range events via tRPC server caller"
  - "CalendarView Client Component — single 'use client' boundary wrapping FullCalendar 6.x with timeGrid + dayGrid + multiMonth + interaction plugins"
  - "CalendarToolbar — URL-state view switcher (week/day/month/year) + date nav + filter trigger + create CTA, mobile FAB"
  - "EventChip renderer — FullCalendar eventContent callback, Preact-rendered, no React hooks; 6 type colours + lucide icons + past/happening/recurring/conflicting/cancelled overlays"
  - "CalendarSkeleton — grid-shaped Suspense fallback sized to the final FullCalendar dimensions (near-zero CLS)"
  - "EmptyHintStrip — below-grid informational hint with filtersActive variant + clear button"
  - "Custom DOM event contract for Plan 07: calendar:open-create, calendar:open-detail, calendar:open-filters, calendar:event-drop, calendar:event-resize, calendar:dates-set"
  - "Mobile contract: < 640px forces timeGridDay, drag-edit/click-create disabled, swipe-to-navigate via vanilla pointer events on the container"
  - "URL state contract: ?view=week|day|month|year, ?date=YYYY-MM-DD — survives refresh and back/forward"

affects: [03-07-write-side-sheets-and-filter-bar, 03-08-e2e-activation, phase-04-medical, phase-05-rankings-and-tournaments]

tech-stack:
  added: ["FullCalendar 6.x (timeGrid + dayGrid + multiMonth + interaction plugins, react wrapper, locale modules)"]
  patterns:
    - "Single 'use client' boundary per feature — Server Component pre-fetch + Suspense + one client wrapper holding the browser-API-dependent library"
    - "Dynamic locale loader gated render — `if (!fcLocale) return null;` blocks the FC mount until @fullcalendar/core/locales/{nl,en-gb,fr} resolves (Pitfall 2 mitigation against English-month flash)"
    - "Vanilla pointer-event swipe handler on the wrapper container (NOT the library root) — preserves the library's internal scroll while reading horizontal gestures (Pitfall 7 mitigation)"
    - "Custom-DOM-event pub/sub between Client Components in the same feature — the toolbar dispatches `calendar:open-*` events that the read-side ignores in this wave, and that Plan 07's write-side sheets will subscribe to without prop drilling"
    - "Preact-aware event renderer — `renderEventChip` is a pure function returning JSX consumed by FullCalendar's Preact tree; React hooks are forbidden in this scope (enforced via comment + grep verification)"
    - "Trust-boundary type narrowing — the Server Component casts `calendar.list[].typeCode` from `string` to the closed 6-code union before passing to the Client Component, matching the DB-level FK + Zod discriminated union"

key-files:
  created:
    - "src/app/[locale]/(app)/calendar/page.tsx — /[locale]/calendar Server Component"
    - "src/app/[locale]/(app)/calendar/loading.tsx — Suspense fallback"
    - "src/components/calendar/calendar-view.tsx — single 'use client' boundary wrapping FullCalendar"
    - "src/components/calendar/calendar-toolbar.tsx — view switcher + date nav + create CTA"
    - "src/components/calendar/event-chip.tsx — FullCalendar eventContent renderer"
    - "src/components/calendar/calendar-skeleton.tsx — grid-shaped Suspense fallback"
    - "src/components/calendar/empty-hint-strip.tsx — below-grid informational strip"
  modified: []

key-decisions:
  - "EventChip is intentionally a pure renderer, not a React component — FullCalendar 6.x renders eventContent JSX through Preact, so React hooks crash at runtime. Documented + grep-verified."
  - "Mobile swipe handler attaches to the wrapper container (`containerRef`), NOT the FullCalendar root — attaching to the FC root steals its internal scroll on tall day grids."
  - "Mobile drag-edit + click-create are disabled in Wave 4 (UI-SPEC §Mobile Strategy) — long-press-to-create is deferred to v2."
  - "Toolbar mobile view switcher uses a native <select> instead of ToggleGroup — saves chrome real estate on 360px viewports without breaking the URL-state contract."
  - "Per UI-SPEC, the EmptyHintStrip is below-grid and never blocks — the calendar grid itself IS the primary empty state; the strip just hints at why."
  - "Server-to-client type cast at the trust boundary in page.tsx narrows `typeCode: string` to the 6-code union — the cast is safe because the DB FK + Zod discriminated union already constrain the values."
  - "URL state uses raw next/navigation router (not next-intl router) because the [locale] segment is already in `pathname` and we only need to mutate ?view + ?date."
  - "Custom DOM events as cross-component pub/sub for Plan 07 — keeps the read-side bundle decoupled from the not-yet-shipped write-side sheets and avoids global state for a one-shot integration."

patterns-established:
  - "FullCalendar in App Router: single 'use client' file, Server Component pre-fetch, gated render until locale resolves, container-scoped swipe handler"
  - "URL-state Client Component (toolbar): mutate searchParams via useCallback, push via raw next/navigation router; survives refresh + back/forward (UI3-D8)"
  - "Trust-boundary cast for tRPC return types whose server union is wider than the client mirror needs"
  - "Custom-DOM-event integration contract for sibling Client Components in the same feature (here: read-side + Plan 07 write-side)"

requirements-completed: [CAL-01, CAL-02, CAL-03, CAL-04, CAL-08, I18N-05, I18N-06, I18N-07]

duration: 9min
completed: 2026-05-14
---

# Phase 3 Plan 06: Calendar Read-Side Surfaces Summary

**Read-side calendar UI complete: /[locale]/calendar route renders FullCalendar 6.x in week-default with 6-colour event chips, mobile single-day swipe, and URL-state survival — wired to Plan 05's `calendar.list` server caller, ready for Plan 07's write-side sheets to listen on the custom-event bus.**

## Performance

- **Duration:** 9 min
- **Started:** 2026-05-14T11:53:22Z
- **Completed:** 2026-05-14T12:02:42Z (approx)
- **Tasks:** 3
- **Files created:** 7
- **Files modified:** 0
- **Total lines:** ~950 LOC (production code, includes JSDoc and runtime comments)

## Accomplishments

- **/[locale]/calendar route ships.** Server Component pre-fetches the visible week via `appRouter.createCaller(ctx).calendar.list({ from, to })` and hands the result to the Client Component. RLS already scopes the row set server-side (Phase 1 carry-forward). Monday week-start enforced by `weekStartsOn: 1` (I18N-07).
- **Single 'use client' boundary.** `CalendarView` is the only client component in the calendar tree that touches FullCalendar; everything else (toolbar, empty-hint, skeleton) is either a Server Component or a thin URL-state Client Component. Server Components keep medical/sensitive data off the client bundle by default (CLAUDE.md GDPR constraint).
- **6 event types colour-coded with lucide icons.** training (Dumbbell, blue), tournament (Trophy, orange), meeting (Users, green), stage (MapPin, purple), eval_conversation (MessagesSquare, yellow — note slug `evalconv`), medical (Stethoscope, red). Past events dim to 60% opacity, currently-happening get an inset primary ring, recurring show a Repeat icon, conflicting show AlertTriangle, cancelled get strikethrough + 50% opacity.
- **Mobile contract (CAL-08).** Viewport observer (`matchMedia '(max-width: 640px)'`) forces `timeGridDay`, disables drag-edit and click-create, and attaches a vanilla pointer-event swipe handler on the wrapper container (NOT the FC root, per Pitfall 7). Thresholds: 60px horizontal, 30px vertical tolerance, 400ms max duration — touch-only.
- **URL-state survival (UI3-D8).** `?view=week|day|month|year` + `?date=YYYY-MM-DD` survive refresh and back/forward. Toolbar mutates search params via `useCallback`; page.tsx parses + validates them with `parseISO`/`isValid` fallbacks.
- **Custom-event bus for Plan 07.** `calendar:open-create`, `calendar:open-detail`, `calendar:open-filters`, `calendar:event-drop`, `calendar:event-resize`, and `calendar:dates-set` are dispatched on `document` — Plan 07's write-side sheets will listen without prop drilling or global state.
- **Skeleton + empty hint.** `CalendarSkeleton` matches the final grid dimensions (toolbar row + filter row + 7 columns × 14 hour rows) for near-zero CLS. `EmptyHintStrip` has two variants (filtered vs unfiltered) and never blocks — the grid is the primary empty state per UI-SPEC.

## Task Commits

Each task committed atomically:

1. **Task 1: Server Component (page.tsx + loading.tsx) + CalendarSkeleton + EmptyHintStrip** — `d7c8efe` (feat)
2. **Task 2: CalendarToolbar + EventChip eventContent renderer** — `727aa4b` (feat)
3. **Task 3: CalendarView — single 'use client' FullCalendar boundary + swipe** — `8233ee8` (feat)

## Files Created

- `src/app/[locale]/(app)/calendar/page.tsx` — Server Component; calls `createContext()` + `appRouter.createCaller(ctx)`; parses `?view` and `?date` searchParams; computes the visible range; pre-fetches `calendar.list`; renders `<CalendarToolbar>` + `<Suspense fallback={<CalendarSkeleton/>}><CalendarView/></Suspense>` + conditional `<EmptyHintStrip>`. Casts the server `typeCode: string` to the 6-code union at the trust boundary.
- `src/app/[locale]/(app)/calendar/loading.tsx` — Suspense fallback wrapping `<CalendarSkeleton/>`.
- `src/components/calendar/calendar-view.tsx` — single `'use client'` boundary. Imports `FullCalendar`, `timeGridPlugin`, `dayGridPlugin`, `interactionPlugin`, `multiMonthPlugin`. Dynamic FC locale loader (`@fullcalendar/core/locales/{nl,en-gb,fr}`). Mobile observer (`matchMedia '(max-width: 640px)'`). Vanilla pointer-event swipe handler. Maps `EventInstance[]` to `EventInput[]` with composite IDs (eventId + occurrenceDate or 'single') and extendedProps the chip renderer reads. Dispatches 6 custom DOM events for Plan 07 integration. Disables drag/select on mobile.
- `src/components/calendar/calendar-toolbar.tsx` — Client Component. Today / prev / next, ToggleGroup view switcher (>= 640px), native select view switcher (< 640px), Filters button (< 768px), "Nieuwe afspraak" inline CTA (>= 768px) + FAB (< 768px). Rewrites URL search params via `useCallback`. Dispatches `calendar:open-create` and `calendar:open-filters`.
- `src/components/calendar/event-chip.tsx` — pure function `renderEventChip(arg: EventContentArg)`. NO React hooks, NO `useTranslations`, NO context. Maps the 6 typeCodes to colour-token slugs (`event_type_eval_conversation` → `evalconv`) and lucide icons. Renders chip with `var(--cal-event-{slug}-{bg|fg|border})` inline style; overlays past/happening/cancelled; shows Repeat + AlertTriangle indicators.
- `src/components/calendar/calendar-skeleton.tsx` — Server Component. Toolbar-row + filter-row + grid (7 day columns × 14 hour rows from 08:00 to 22:00) with shadcn `Skeleton` cells. Some occupied cells (every 5th by row+col) render full-height blocks to hint at events.
- `src/components/calendar/empty-hint-strip.tsx` — Client Component. Two variants (`emptyHint` vs `emptyFiltered`) + "Filters wissen" button when filters active. Uses `usePathname` + `useSearchParams` + `useRouter` from `next/navigation`.

## Files Modified

None — the plan creates 7 new files; no existing files needed changes. (The Tasks-1/2/3 split kept page.tsx in flux until Task 3 committed both its final state and the new `CalendarView`.)

## Decisions Made

Followed plan as specified except for the type-narrowing cast in page.tsx (see Deviations below).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Server `typeCode: string` vs client narrow union mismatch**

- **Found during:** Task 3 (`pnpm typecheck` after CalendarView landed).
- **Issue:** The server router types `calendar.list[].typeCode` as `string` (the Drizzle column inference is broad). The client `<CalendarView>` mirrors `EventInstance.typeCode` as the closed 6-code union (so `renderEventChip`'s `TYPE_TOKEN_SLUG` / `TYPE_ICON` maps remain exhaustive and the discriminated chip renderer stays type-safe). `pnpm typecheck` flagged the cross-trust-boundary assignment with `TS2719: Type 'EventInstance[]' is not assignable to type 'EventInstance[]'`.
- **Fix:** At the trust boundary in page.tsx (immediately after `caller.calendar.list(...)`), cast the result to a derived type that narrows `typeCode` to the 6 D-47 codes. The cast is safe at runtime — the DB-level FK on `calendar_events.type_code` and the Zod discriminated union on `event.create` / `event.update` already constrain the column values to exactly those 6 codes. A multi-line block comment documents why the cast is sound.
- **Files modified:** `src/app/[locale]/(app)/calendar/page.tsx`
- **Verification:** `pnpm typecheck` passes cleanly.
- **Committed in:** `8233ee8` (Task 3 commit — the narrowing cast belongs to the same commit that introduces the typed client surface that needs it).

## Verification Results

- `pnpm typecheck` — passes cleanly (no errors, no warnings).
- 7 files at canonical paths: confirmed via `ls -la src/components/calendar/ src/app/[locale]/(app)/calendar/`.
- Grep verifications from the plan's automated `<verify>` blocks all passed:
  - Task 1: `export default async function CalendarPage`, `appRouter.createCaller`, `weekStartsOn: 1`, `CalendarSkeleton`, `EmptyHintStrip`, `emptyHint` — all present.
  - Task 2: `'use client'`, `ToggleGroup`, `calendar:open-create` in toolbar; `renderEventChip`, `cal-event-`, all 6 lucide icons, `AlertTriangle`, `Repeat` in event-chip; NO React hooks (`useState`/`useEffect`/`useTranslations`) in event-chip (only doc-comment mentions, grep-verified).
  - Task 3: `'use client'`, `FullCalendar`, all 4 plugins, `headerToolbar={false}`, `firstDay={1}`, `renderEventChip`, `pointerdown`/`pointerup`, `matchMedia('(max-width: 640px)')`, `calendar:open-create`/`calendar:open-detail` — all present.
- Manual UAT (deferred to Wave 5 e2e activation per VALIDATION.md):
  - Navigate to `/nl/calendar` → week view renders with seeded events colour-coded by type.
  - URL `?view=month&date=2026-06-01` → renders June 2026 month view; refresh preserves state.
  - 360×640 viewport → renders `timeGridDay`; left swipe advances to next day, right swipe goes back.
  - Clicking an event chip → `calendar:open-detail` event observable on `document` (no listener yet — Wave 5 with Plan 07 wires the sheet).

## Custom DOM Event Contract (for Plan 07)

| Event name | Source | Payload | Plan 07 listener |
|---|---|---|---|
| `calendar:open-create` | `CalendarToolbar` (CTA click) / `CalendarView` (`select` callback) | Toolbar: none. View: `{ start: ISO, end: ISO }`. | `<EventCreateSheet>` opens with optional time pre-fill |
| `calendar:open-detail` | `CalendarView` (`eventClick`) | `{ eventId: string, occurrenceDate: string \| null }` | `<EventDetailSheet>` opens and fetches via `calendar.event.get` |
| `calendar:open-filters` | `CalendarToolbar` (mobile filter button) | none | `<FilterBar>` opens on mobile |
| `calendar:event-drop` | `CalendarView` (`eventDrop`) | `{ eventId, newStart, newEnd, revert: () => void }` | `<MoveConfirm>` confirms or calls `revert()` |
| `calendar:event-resize` | `CalendarView` (`eventResize`) | `{ eventId, newStart, newEnd, revert: () => void }` | same as `event-drop` for resize |
| `calendar:dates-set` | `CalendarView` (`datesSet`) | `{ start: ISO, end: ISO }` | Plan 07 re-fetches `calendar.list` for the new range |

## Mobile Swipe Constants

- Container: wrapper `<div ref={containerRef}>` around `<FullCalendar/>` (NOT the FC root — Pitfall 7).
- `THRESHOLD_X` = 60px (horizontal distance to register as a swipe)
- `VERTICAL_TOLERANCE` = 30px (max vertical drift; rejects accidental scroll gestures)
- `MAX_DURATION_MS` = 400 (max pointerdown → pointerup time)
- Pointer type filter: `e.pointerType !== 'touch'` rejects mouse/pen.
- Left swipe (dx < 0) → `api.next()`; right swipe → `api.prev()`.

## Threat Model Compliance

All 5 STRIDE entries from the plan's `<threat_model>` are mitigated:

- **T-03-29-CHIP-RENDER-HOOK-ESCAPE** (V11) — `renderEventChip` is a pure function with NO `useState`/`useEffect`/`useTranslations`. Grep-verified (only the JSDoc comment mentions these hook names, no actual calls).
- **T-03-30-MOBILE-SWIPE-FALSE-POSITIVE** (V11) — 60px horizontal threshold + 30px vertical tolerance + 400ms max duration + `pointerType === 'touch'` filter. Attached to the container, not the FC root. Manual UAT on real iOS/Android devices is on the 03-VALIDATION.md manual-only list.
- **T-03-31-LOCALE-MISMATCH-FLASH** (I, V11) — `if (!fcLocale) return null;` blocks the FC mount until `@fullcalendar/core/locales/{nl,en-gb,fr}` resolves. The outer Suspense fallback paints the skeleton during the wait.
- **T-03-32-HYDRATION-DRIFT** (V11) — `'use client'` only on CalendarView. The Server Component pre-fetches and serialises a static `initialEvents` prop. FullCalendar instantiates only in the browser; there is no SSR rendering of the calendar grid.
- **T-03-33-SR-LABEL-MISSING** (V8) — all icon-only `<Button>`s in the toolbar (prev/next/FAB-create) carry `aria-label={t(...)}`. The page renders an `<h1 className="sr-only">` with the localised calendar title for screen readers.

No new threat surface introduced beyond what the plan's `<threat_model>` enumerates. No threat flags section needed.

## Self-Check: PASSED

- File `src/app/[locale]/(app)/calendar/page.tsx` — FOUND
- File `src/app/[locale]/(app)/calendar/loading.tsx` — FOUND
- File `src/components/calendar/calendar-view.tsx` — FOUND
- File `src/components/calendar/calendar-toolbar.tsx` — FOUND
- File `src/components/calendar/event-chip.tsx` — FOUND
- File `src/components/calendar/calendar-skeleton.tsx` — FOUND
- File `src/components/calendar/empty-hint-strip.tsx` — FOUND
- Commit `d7c8efe` (Task 1) — FOUND on branch
- Commit `727aa4b` (Task 2) — FOUND on branch
- Commit `8233ee8` (Task 3) — FOUND on branch
- `pnpm typecheck` — PASSES
