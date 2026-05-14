---
phase: 03-kalender
plan: 04
subsystem: i18n + design-tokens
tags: [i18n, calendar, design-tokens, fullcalendar, copywriting-contract, color-tokens]
dependency_graph:
  requires:
    - phase-1 messages/{nl,en,fr}.json baseline (auth/consent/lookups/errors/common/nav/admin/players/trainers/me/files namespaces)
    - phase-1 src/app/[locale]/globals.css baseline (shadcn/ui new-york tokens, light + dark)
    - 03-UI-SPEC.md §Color (LOCKED oklch values, lines 146-202)
    - 03-UI-SPEC.md §FullCalendar built-in CSS-variable overrides (lines 219-250)
    - 03-UI-SPEC.md §Copywriting Contract (lines 558-700)
    - 03-UI-SPEC.md §Localization Contract (lines 512-535)
    - 03-CONTEXT.md D-57b (participant-first conflict body override)
    - 03-CONTEXT.md D-58b (no-30-day-restore delete body override)
  provides:
    - calendar.* i18n namespace (82 string leaves) in nl/en/fr
    - lookup.eventType.* i18n namespace (6 keys) in nl/en/fr
    - errors.calendar.* i18n keys (7 keys) appended under existing errors block in nl/en/fr
    - 18 light-mode + 18 dark-mode --cal-event-{training,tournament,meeting,stage,evalconv,medical}-{bg,fg,border} CSS tokens
    - .fc { ... } block with 19 FullCalendar v6 variable overrides
    - @media (max-width: 640px) override for --fc-event-min-height to 2.75rem (WCAG 2.5.5)
  affects:
    - Plan 03 (schemas already reference errors.calendar.* keys via Zod messages)
    - Plan 06 (EventDetailSheet, EventCreateSheet, ConflictAlert — all surfaces consume calendar.*)
    - Plan 07 (CalendarPage, CalendarView, CalendarToolbar, FilterBar — consume calendar.* + view --cal-event-* tokens)
    - tests/unit/color-tokens.test.ts (12 RED assertions flipped GREEN)
    - tests/unit/schema-locale.test.ts (Phase 3 namespace assertions still it.todo — flip in Wave 5)
tech_stack:
  added: []
  patterns:
    - "Tailwind v4 CSS-first: append tokens inside existing :root { ... } and .dark { ... } blocks (no second :root block)"
    - "FullCalendar v6 theming: scope override block to .fc selector (root element renders with class .fc); use color-mix(in oklch, ...) for translucent variants"
    - "next-intl message catalog convention: codes-in-DB / labels-in-i18n; codes language-neutral, label translations per locale catalog (I18N-05)"
    - "Top-level namespace separation: existing lookups (plural) Phase 1/2 keys preserved untouched; new lookup (singular) namespace added for Phase 3 event_type — UI-SPEC contract matched"
key_files:
  created: []
  modified:
    - messages/nl.json
    - messages/en.json
    - messages/fr.json
    - src/app/[locale]/globals.css
    - .planning/phases/03-kalender/deferred-items.md
decisions:
  - "Insert calendar/lookup namespaces between existing lookups and common top-level keys (cleanest JSON object insertion point; preserves all prior key order)"
  - "Append errors.calendar.* INSIDE existing errors block (per UI-SPEC contract — keeps Zod resolver pattern consistent with Phase 1/2 errors.field.* / errors.file.* shape)"
  - "Apply D-57b conflict body verbatim across nl/en/fr; old UI-SPEC line 653 placeholder copy never appeared in catalogs"
  - "Apply D-58b delete body verbatim across nl/en/fr; old UI-SPEC line 665 30-day-restore promise never appeared in catalogs"
  - "Append calendar tokens INSIDE existing :root and .dark blocks (single :root pattern); .fc and @media rules added as top-level selectors before @layer base"
  - "Skip @theme inline exposure for cal-event-* tokens — consumers will use var(--cal-event-training-bg) directly inline (Tailwind v4 arbitrary-value syntax bg-[var(...)] also works); decision documented for Plan 06/07 author"
metrics:
  duration: "5m 51s"
  tasks_completed: 2
  files_modified: 4
  files_created: 0
  completed_date: "2026-05-14"
---

# Phase 3 Plan 04: Catalogs + Tokens Summary

Trilingual message catalogs (nl/en/fr) extended with calendar.*/lookup.eventType.*/errors.calendar.* namespaces, and globals.css extended with 36 cal-event design tokens plus 19 FullCalendar v6 variable overrides — shipping every user-facing string and every CSS design token Phase 3 needs in a single coordinated edit.

## What Was Built

### Message catalog extensions (messages/{nl,en,fr}.json)

Three top-level structural additions per file, identical shape across locales:

1. **`calendar` namespace** (82 string leaves per locale) — page chrome (`title`, `loading`), view switcher (`views.{week,day,month,year}`), toolbar (`actions.{today,prev,next,create,filters}`), filter bar (`filters.{byType,byPlayer,byTrainer,bySparring,byAcademy,searchPlaceholder,empty,clear,apply,countSuffix}`), empty-state copy (`emptyHint`, `emptyFiltered`), event detail sheet (`event.{untitled,sections.*,recurrence.*,fields.*,actions.*}`), event create/edit/delete/decline surfaces (`event.{create,edit,delete,decline}.{title,submit,body,confirm,cancel,toast}`), toast set (`event.toast.{created,updated,deleted,error,notFound,moved,resized}`), and conflict UI (`conflict.{title,body,extra,saveAnyway,adjustTime,moveAnyway,undoMove,detailFull,detailRedacted}`).

2. **`lookup` namespace** (NEW singular — distinct from existing `lookups` plural Phase 1/2 namespace) with `lookup.eventType.*` (6 keys for the 6 event_type codes per UI-SPEC §Lookup additions).

3. **`errors.calendar` sub-namespace** appended INSIDE existing `errors` block (7 keys per locale: `endBeforeStart`, `rruleHorizonExceeded`, `rangeTooLarge`, `titleRequired`, `typeRequired`, `medicalPastStart`, `participantNotInScope`).

D-57b (participant-first conflict body) and D-58b (no-30-day-restore delete body) applied verbatim in all 3 locales — old UI-SPEC line 653 placeholder copy and line 665 30-day-restore promise never appeared.

### CSS design tokens (src/app/[locale]/globals.css)

1. **18 light-mode `--cal-event-*` tokens** appended INSIDE existing `:root { ... }` block: 6 event types × 3 slots (bg/fg/border) per UI-SPEC §Color LOCKED oklch values.
2. **18 dark-mode `--cal-event-*` tokens** appended INSIDE existing `.dark { ... }` block: 6 event types × 3 slots; L=0.85 fg vs L=0.25 bg → AA contrast Δ 0.6 (T-03-20 mitigation).
3. **`.fc { ... }` block** (top-level selector, 19 FullCalendar v6 variable overrides): maps `--fc-border-color` → `--border`, `--fc-page-bg-color` → `--background`, `--fc-today-bg-color` → `color-mix(in oklch, --primary 6%, transparent)`, button states (`--fc-button-{bg,text,border,active-*,hover-*}`), event states (`--fc-event-{text,border}-color`, `--fc-event-selected-overlay-color`), `--fc-now-indicator-color`, `--fc-small-font-size: 0.75rem` (Typography exception), `--fc-event-min-height: 1.5rem` (desktop default).
4. **Mobile `@media (max-width: 640px)` block** overrides `--fc-event-min-height: 2.75rem` (44px — WCAG 2.5.5 mobile tap target — UI-SPEC §Spacing exceptions).

## Verification Results

### JSON parse + grep contract (Task 1 verify.automated)

| Check | nl | en | fr |
|-------|----|----|----|
| `JSON.parse(...)` clean | OK | OK | OK |
| `"calendar":` present | 3 matches (nav + top-level + errors) | 3 | 3 |
| `"lookup":` present | 1 | 1 | 1 |
| `"event_type_training":` present | 1 | 1 | 1 |
| D-57b participant-first body ("is al geboekt voor" / "is already booked for" / "est déjà réservé pour") | 1 | 1 | 1 |
| D-58b no-restore body ("definitief verwijderd" / "permanently deleted" / "définitivement") | 1 | 1 | 1 |
| 30-day-restore promise (MUST be 0) | 0 | 0 | 0 |
| `errors.calendar.rruleHorizonExceeded` | 1 | 1 | 1 |
| `errors.calendar.endBeforeStart` | 1 | 1 | 1 |

Terminal-string-leaf counts: **82/6/7 in all three locales** — identical, zero drift.

### CSS token + override contract (Task 2 verify.automated)

| Check | Count | Required |
|-------|-------|----------|
| `--cal-event-*-bg` declarations (6 types × 2 modes) | 12 | ≥12 |
| `--cal-event-*-fg` declarations | 12 | ≥12 |
| `--cal-event-*-border` declarations | 12 | ≥12 |
| `--fc-border-color: var(--border)` | 1 | 1 |
| `--fc-page-bg-color: var(--background)` | 1 | 1 |
| `--fc-small-font-size: 0.75rem` | 1 | 1 |
| `@media (max-width: 640px)` | 1 | 1 |
| `--fc-event-min-height: 2.75rem` | 1 | 1 |
| `--fc-event-min-height: 1.5rem` (desktop default) | 1 | 1 |

### Test runs

- **`tests/unit/color-tokens.test.ts`**: **12 pass | 2 todo (14 total)** — the 12 RED assertions for `--cal-event-{6 types}-{bg,fg,border}` in `:root` and `.dark` blocks **flipped GREEN**. The 2 `.todo` cases (FullCalendar variable overrides in `.fc` block; mobile @media `--fc-event-min-height`) remain skipped per Wave 0 scaffold intent — they will be activated in Wave 5. (Note: the implementation behind those `.todo` cases already shipped here; only the test scaffolding is gated.)
- **`tests/unit/schema-locale.test.ts`**: **5 pass | 7 todo (12 total)** — baseline locale enum + role enum + Drizzle column metadata still green. Phase 3 namespace coverage `it.todo` cases remain skipped per Wave 0 scaffold (flip in Wave 5).
- **`pnpm build`**: **CSS / Next.js compile step succeeds** ("✓ Compiled successfully in 9.2s"). Tailwind v4 + PostCSS accepts the new tokens cleanly. The downstream lint/type pipeline fails on a Phase-1 unrelated file (`admin/users/page.tsx` typedRoutes drift) — logged as **DI-03** in `deferred-items.md`. CSS contract this plan delivers is unaffected.

## Decisions Made

1. **Insertion point for new top-level namespaces:** placed `calendar` and `lookup` between existing `lookups` and `common`. Cleanest JSON-object insertion preserving all prior key order; no churn on Phase 1/2 keys.
2. **`errors.calendar.*` placement:** appended INSIDE existing `errors` block (next to `errors.field`, `errors.file`) per UI-SPEC contract — keeps the Zod resolver lookup pattern (`errors.{domain}.{key}`) consistent with Phase 1/2 conventions.
3. **`lookup` (singular) vs `lookups` (plural):** added new singular `lookup` namespace for Phase 3 event_type per UI-SPEC §Localization Contract; existing `lookups.*` Phase 1/2 namespace untouched. UI-SPEC contract surface matches our import; small drift from Phase 1 vocabulary is documented in PLAN.
4. **D-57b + D-58b copy applied verbatim:** participant-first conflict body (with `**{participant}**` token + `{detail}` slot supporting full/redacted compositions via `conflict.detailFull` and `conflict.detailRedacted`) and no-30-day-restore delete body. UI-SPEC revision is out-of-band per CONTEXT — not a blocker.
5. **CSS token block placement:** appended INSIDE existing `:root` and `.dark` blocks (single-block-per-selector pattern) rather than creating a second `:root` declaration. `.fc { ... }` and `@media` rules placed as top-level selectors before `@layer base` (matches Tailwind v4 CSS-first conventions).
6. **No `@theme inline` exposure for cal-event tokens:** consumers in Plan 06/07 will use `var(--cal-event-training-bg)` directly (inline style or `bg-[var(...)]` Tailwind v4 arbitrary value). Decision avoids polluting `@theme inline` with type-keyed tokens that have no obvious Tailwind utility shape; documented for Plan 06/07 author.
7. **Skip the schema-locale drift integration:** Phase 3 namespace coverage assertions in `schema-locale.test.ts` remain `it.todo` per the Wave 0 scaffold; flipping them on is a Wave 5 task. The shipped catalogs already satisfy the manifest (verified by terminal-leaf counts above) — the test scaffold just hasn't been wired to enforce yet.

## Deviations from Plan

None — plan executed exactly as written. All canonical text from UI-SPEC §Copywriting Contract and CONTEXT D-57b/D-58b copied verbatim; all 36 `--cal-event-*` token values copied verbatim from UI-SPEC §Color LOCKED block; all 19 FullCalendar overrides copied verbatim from UI-SPEC §FullCalendar built-in CSS-variable overrides.

### Deferred Issues (Out of Scope)

- **DI-03**: `pnpm build`'s lint/type pipeline fails on pre-existing typedRoutes drift in `src/app/[locale]/(app)/admin/users/page.tsx` (Phase 1 file, surfaced because `experimental.typedRoutes` was promoted to top-level `typedRoutes: true` in Next.js 15.5). CSS compile step succeeds cleanly — the contract this plan delivers (Tailwind v4 accepts new tokens) is verified. Pre-existing ESLint circular-structure issue (DI-02) also surfaces in the same pipeline. Documented in `.planning/phases/03-kalender/deferred-items.md`; recommended resolution path is a Phase 8 release-hardening pass moving `typedRoutes` out of `experimental` and casting the route literal with `as Route` or a typed helper.

## Commits

| # | Hash      | Files                                              | Message                                                                                         |
|---|-----------|----------------------------------------------------|-------------------------------------------------------------------------------------------------|
| 1 | `679cec9` | messages/{nl,en,fr}.json                           | feat(03-04): extend nl/en/fr catalogs with calendar.*, lookup.eventType.*, errors.calendar.*    |
| 2 | `78a097c` | src/app/[locale]/globals.css, deferred-items.md    | feat(03-04): add 6 event-type color tokens x 2 modes + FullCalendar overrides to globals.css    |

## Self-Check: PASSED

- [x] `messages/nl.json` exists and parses
- [x] `messages/en.json` exists and parses
- [x] `messages/fr.json` exists and parses
- [x] `src/app/[locale]/globals.css` exists with 36 cal-event tokens
- [x] Commit `679cec9` exists in git log
- [x] Commit `78a097c` exists in git log
- [x] `tests/unit/color-tokens.test.ts` reports 12 pass | 2 todo (RED→GREEN flip confirmed)
- [x] `messages/{nl,en,fr}.json` all have identical 82 calendar / 6 lookup.eventType / 7 errors.calendar leaf counts
- [x] D-57b participant-first body present in all 3 locales
- [x] D-58b no-restore body present; 30-day-restore promise text absent (0 matches) in all 3 locales
- [x] FullCalendar `--fc-*` overrides present in `.fc` block
- [x] Mobile @media `--fc-event-min-height: 2.75rem` present
