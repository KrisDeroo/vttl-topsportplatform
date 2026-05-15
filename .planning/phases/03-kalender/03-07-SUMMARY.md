---
phase: 03-kalender
plan: 07
subsystem: calendar-write-side-ui
tags: [calendar, ui, write-side, sheets, conflict-detection, filter-bar, rrule, gdpr, i18n]
requires:
  - phase: 03-kalender
    plan: 03-04
    why: i18n catalogs in messages/{nl,en,fr}.json provide calendar.* + errors.calendar.* + lookup.eventType.* keys consumed by every component in this plan
  - phase: 03-kalender
    plan: 03-05
    why: tRPC calendar.* router exposes event.create/update/delete/declineParticipation/get plus calendar.filterOptions.list and the conflict redaction contract
  - phase: 03-kalender
    plan: 03-06
    why: <CalendarView> dispatches the 5 custom DOM events (calendar:open-create/-detail/-filters/event-drop/event-resize/dates-set) the sheets and banner listen for
provides:
  - "EventCreateSheet (RHF + ConflictWarning + force-flag override flow)"
  - "EventEditSheet (event.get pre-population + UI3-D12 Phase 4 scope disablement)"
  - "EventDetailSheet (read-mode + role-gated edit/delete/decline)"
  - "EventDeleteDialog (D-58b copy)"
  - "EventFilterBar + FilterCombobox (URL-synced base64 filter state, mobile bottom Sheet)"
  - "ConflictWarning + ConflictBanner (D-57b body via XSS-safe markdown splitter)"
  - "DateTimePicker + RruleEditor compounds (Phase 4/5 reuse)"
affects:
  - "src/app/[locale]/(app)/calendar/page.tsx — mounts the 5 sheet/dialog/banner Client Components above the calendar grid"
tech-stack:
  added: []
  patterns:
    - "Custom DOM event surface (calendar:open-* / calendar:event-*) for cross-Client-Component coordination without a page-level Context provider"
    - "Discriminated-union payload built at submit time from flat RHF state (omits Zod resolver — server Zod is authoritative)"
    - "Markdown bold splitter (split-on-** + <strong> JSX) as XSS-safe alternative to dangerouslySetInnerHTML for D-57b body rendering"
key-files:
  created:
    - path: src/components/common/date-time-picker.tsx
      purpose: "Popover + Calendar + Input[time] compound — Phase 4/5 reusable"
    - path: src/components/common/rrule-editor.tsx
      purpose: "frequency/interval/end-mode picker emitting RFC 5545 via RRule.optionsToString"
    - path: src/components/calendar/filter-combobox.tsx
      purpose: "shadcn Command typeahead backed by trpc.calendar.filterOptions.list (scope-filtered server-side)"
    - path: src/components/calendar/event-filter-bar.tsx
      purpose: "Desktop inline + mobile bottom-Sheet filter row, URL-syncs ?filter=<base64 JSON>"
    - path: src/components/calendar/conflict-warning.tsx
      purpose: "Inline Alert in create/edit form rendering D-57b participant-first body"
    - path: src/components/calendar/conflict-banner.tsx
      purpose: "Top-page Alert reacting to drag-drop conflicts with Toch verplaatsen / Ongedaan maken"
    - path: src/components/calendar/event-detail-sheet.tsx
      purpose: "Read-mode Sheet listening for calendar:open-detail; decline-participation flow"
    - path: src/components/calendar/event-delete-dialog.tsx
      purpose: "shadcn AlertDialog destructive confirmation with D-58b 'definitief verwijderd' copy"
    - path: src/components/calendar/event-delete-dialog-mount.tsx
      purpose: "tiny page-level wrapper holding open-state for the controlled EventDeleteDialog"
    - path: src/components/calendar/event-create-sheet.tsx
      purpose: "RHF form Sheet with per-type extension fields, conflict warning, force-flag override"
    - path: src/components/calendar/event-edit-sheet.tsx
      purpose: "Pre-populated edit form with UI3-D12 scope-radio (Phase 4 options disabled)"
  modified:
    - path: src/app/[locale]/(app)/calendar/page.tsx
      change: "Imports and mounts 6 Client Components (EventFilterBar + ConflictBanner + EventCreateSheet + EventDetailSheet + EventEditSheet + EventDeleteDialogMount); they listen for calendar:* DOM events dispatched by CalendarView and CalendarToolbar"
decisions:
  - "Custom DOM event surface (instead of a page-level React Context provider) keeps each sheet's open-state local. Cross-frame impossible (same document); same-document only — listed in threat model as low-impact (T-03-* covered)."
  - "Markdown bold splitter for D-57b body instead of dangerouslySetInnerHTML. Trade-off: only `**bold**` markers supported. Mitigates T-03-36 XSS-via-participant-name without depending on a markdown library."
  - "Flat RHF schema for create/edit (no zodResolver) — discriminated unions + zodResolver narrowing introduces brittle type cases. Server Zod schema is the authoritative validator; client returns server's i18n keys via useZodErrorMessage."
  - "Banner does full event.get + composed-update payload (not a partial-update API). Phase 4 may add a thinner reschedule-only procedure if the drag flow becomes hot."
metrics:
  duration: "~1h active work across 3 atomic tasks; commits spanned 2026-05-14 → 2026-05-15 wall-clock"
  completed: 2026-05-15
  tasks_completed: 3
  files_created: 11
  files_modified: 1
---

# Phase 3 Plan 07: Sheets, Filter Bar & Conflict Surfaces — Summary

The write-side of the calendar — every UI-SPEC interaction contract that
Plan 06's read-side does not satisfy is now live. After this plan, the TD
can create a tournament from a drag-select, see a `<ConflictWarning>` body
with the participant-first D-57b copy, click "Toch opslaan" to force-save
(server writes the override audit row), drag-drop the new event to a new
time slot and surface the same conflict in a top-page `<ConflictBanner>`,
edit it through `<EventEditSheet>` with the UI3-D12 scope radio rendering
the Phase 4 options as disabled, and hard-delete via the D-58b no-restore
`AlertDialog`. Players can decline RSVP via the read-mode sheet.

## What Shipped

Eleven new components + one modified `page.tsx`. The 2 compound components
in `src/components/common/` (`<DateTimePicker>`, `<RruleEditor>`) are
deliberately placed outside `calendar/` to signal cross-phase reuse —
Phase 4's training session form and Phase 5's medical/stage forms compose
the same primitives.

| Component | Responsibility |
|-----------|----------------|
| `<DateTimePicker>` | Popover + shadcn Calendar + `<Input type="time">` compound; locale-aware date formatting via `i18n-format.formatDate` |
| `<RruleEditor>` | frequency/interval/end-mode picker emitting RFC 5545 via `RRule.optionsToString` (Pitfall 8 — never string-concat); "Never" end-mode defers to the server's `ensureHorizon()` which auto-injects UNTIL = +2y (D-55) |
| `<FilterCombobox>` | shadcn Command + Popover typeahead; calls `trpc.calendar.filterOptions.list({kind, query})` with `shouldFilter={false}` so the server's name-LIKE search is authoritative; sparring_partner kind returns empty for every role in Phase 3 (D-50 no-op) |
| `<EventFilterBar>` | Desktop inline `<ToggleGroup>` chips + 4 `FilterCombobox` inputs; mobile collapses to a single trigger button that opens a bottom `<Sheet>`; URL-syncs `?filter=<base64 JSON>` with empty arrays omitted; listens for `calendar:open-filters` from the toolbar |
| `<ConflictWarning>` | Inline shadcn `<Alert>` above the create/edit submit button; renders D-57b participant-first body via XSS-safe markdown-bold splitter (no `innerHTML`); "Toch opslaan" + "Tijden aanpassen" CTAs |
| `<ConflictBanner>` | Top-page `<Alert>` listening for `calendar:event-drop` / `calendar:event-resize`; fetches full event via `event.get`, composes discriminated-union update payload, calls `event.update`; on CONFLICT surfaces "Toch verplaatsen" (force:true re-submit) / "Ongedaan maken" (calls FullCalendar's `revert()`) |
| `<EventDetailSheet>` | Read-mode Sheet listening for `calendar:open-detail`; Wanneer/Waar/Wie/Beschrijving/Herhaling sections; role-gated action buttons dispatch `calendar:open-edit` and `calendar:open-delete`; "Ik kan niet aanwezig zijn" calls `event.declineParticipation` |
| `<EventDeleteDialog>` | shadcn `<AlertDialog>` with D-58b body ("definitief verwijderd voor alle deelnemers"); confirm calls `event.delete`; no soft-delete affordance in v1 |
| `<EventDeleteDialogMount>` | Tiny page-level wrapper holding open-state for the controlled `<EventDeleteDialog>`; listens for `calendar:open-delete` |
| `<EventCreateSheet>` | RHF form Sheet listening for `calendar:open-create` with `{start, end}` prefill; flat form state per-type extension fields conditionally rendered; submit builds the discriminated-union payload + posts `event.create` with `force:false`; CONFLICT response renders inline `<ConflictWarning>` → "Toch opslaan" re-submits with `force:true` (server writes `calendar_event_conflict_override` audit row BEFORE the create succeeds) |
| `<EventEditSheet>` | Same shape as Create + pre-populated via `event.get`; UI3-D12 scope radio (`Deze afspraak` active, `Deze en toekomstige (Fase 4)` + `Alle afspraken in de reeks (Fase 4)` disabled) appears only when editing a recurring event |

## Custom DOM Event Contract

Five dispatches (Plan 06) and four listens (Plan 07):

| Event | Dispatched by | Listened by | Detail payload |
|-------|---------------|-------------|----------------|
| `calendar:open-create` | `<CalendarView>` (select) + `<CalendarToolbar>` (Nieuwe afspraak CTA) | `<EventCreateSheet>` | `{ start?: string; end?: string }` |
| `calendar:open-detail` | `<CalendarView>` (eventClick) | `<EventDetailSheet>` | `{ eventId: string; occurrenceDate: string \| null }` |
| `calendar:open-filters` | `<CalendarToolbar>` (mobile Filters button) | `<EventFilterBar>` | `(none)` |
| `calendar:event-drop` | `<CalendarView>` (eventDrop) | `<ConflictBanner>` | `{ eventId, newStart, newEnd, revert() }` |
| `calendar:event-resize` | `<CalendarView>` (eventResize) | `<ConflictBanner>` | `{ eventId, newStart, newEnd, revert() }` |
| `calendar:dates-set` | `<CalendarView>` (datesSet) | _(reserved for Phase 4 range re-fetch)_ | `{ start, end }` |
| `calendar:open-edit` | `<EventDetailSheet>` (Bewerken button) | `<EventEditSheet>` | `{ eventId: string }` |
| `calendar:open-delete` | `<EventDetailSheet>` (Verwijderen button) | `<EventDeleteDialogMount>` | `{ eventId: string }` |

All events are document-level (`document.addEventListener`). Same-document
only; no cross-frame surface. The four sheets/dialog and the banner own
their own open-state — there is no page-level Context provider, which
keeps each Client Component independent and testable in isolation.

## D-57b Conflict Body — Rendered Where the User Sees It

The CONTEXT D-57b copy (participant-name first) lands in two surfaces:

1. **Inline `<ConflictWarning>`** in `<EventCreateSheet>` and
   `<EventEditSheet>`: rendered above the submit button when the server
   returns a `CONFLICT` TRPCError with `cause.conflicts[]`. The body uses
   `useTranslations('calendar.conflict').body` with template
   placeholders `{participant}`, `{detail}`, `{start}`, `{end}`. The
   `{detail}` placeholder resolves to either `detailFull`
   (`**{title}** ({typeLabel})`) or `detailRedacted`
   (`een **{typeLabel}**`) per the server's `detailMode` flag.
2. **Top-page `<ConflictBanner>`** above the calendar grid: same body
   string, surfaced after a drag-drop's optimistic move fails the
   server-side conflict probe. The banner reverts the optimistic move
   via the captured `revert()` callback when the user clicks
   "Ongedaan maken", or re-fires the update with `force:true` when they
   click "Toch verplaatsen" (override audit row written by the server).

The body renders via a small `renderMarkdownBold()` helper that splits
on `**bold**` markers and emits `<strong>` JSX runs — **no
`dangerouslySetInnerHTML`**. Threat T-03-36 (XSS via participant name)
is mitigated by React's default text escaping plus the structural
guarantee that the renderer never emits raw HTML.

## D-58b Delete Body — No Soft-Delete Promise

`<EventDeleteDialog>` consumes `calendar.event.delete.{title, body,
confirm, cancel}` from the i18n catalog. The `body` key reads
"Deze afspraak wordt definitief verwijderd voor alle deelnemers." —
the explicit D-58b override of the "30-day-restore" copy that ships in
some Phase 1/2 destructive dialogs. Calendar events are not
soft-deleted in v1 (no `deleted_at` column on the schema). The
audit_log JSONB snapshot written by `event.delete` (D-58c cascade
order) is admin-recoverable but not a user-facing affordance.

## UI3-D12 — Phase 4 Scope Options Disabled

`<EventEditSheet>` renders a recurrence-scope radio whenever the loaded
event has an `rrule`. Three options:

```
( ) Deze afspraak                          ← Phase 3 active
( ) Deze en toekomstige (Fase 4)            ← disabled
( ) Alle afspraken in de reeks (Fase 4)     ← disabled
```

The "(Fase 4)" suffix is baked into the i18n catalog
(`calendar.event.recurrence.scopeFuture` / `scopeAll`) so all three
locales display the same deferred-feature marker. Both disabled
`<RadioGroupItem disabled />` are wrapped in an `opacity-60` parent so
the visual "this exists but is not available yet" is unambiguous —
matches the broader Phase 3 convention used elsewhere for deferred
features.

## Force-Flag Override Audit

When the user clicks "Toch opslaan" inside `<ConflictWarning>` or
"Toch verplaatsen" inside `<ConflictBanner>`, the form re-submits
with `force: true` in the payload. The server (Plan 03 router):

1. Skips the conflict probe (Zod-level field, not client-supplied
   trust — the server's threat model treats every `force=true` as a
   user-driven override).
2. Writes a `calendar_event_conflict_override` audit_log row
   **before** the mutation succeeds — so the audit trail is durable
   regardless of any subsequent failure on the row write.
3. Writes the `calendar_event_created` / `calendar_event_updated`
   audit row after the row is committed.

Threat T-03-34 is mitigated because the override flag is set only by
an explicit user click on a button inside the conflict surface — never
defaulted to `true` by the form state. The form re-fires with the
exact same values; only the `force` field flips.

## Server-Authoritative Filter Scope

`<FilterCombobox>` does not branch by caller role — every Phase 3 user
sees the same four combo buttons (player / trainer / sparring partner /
academy) in the same layout. The server-side `calendar.filterOptions.list`
procedure returns ONLY options visible in the caller's scope:

- A sparring_partner sees an empty options list for the "Speler" combo
  — the same empty signal as "no players match your search".
- All callers see an empty list for the "Sparring partner" combo in
  Phase 3 (D-50 no-op — the entity ships in Phase 4).
- Academy combo returns only `active=true` rows from the `academy`
  lookup, scope-narrowed by the caller's academy membership where
  applicable.

The filter UI never leaks role information through layout differences
(D-36 carry-forward). The trade-off (acknowledged in threat T-03-37):
a caller cannot distinguish "no permission to see this list" from "the
list is genuinely empty in my scope". Both surface as the same
"Geen resultaten in jouw scope" empty-state copy.

## Build & Type Status

- `pnpm typecheck` → **PASSES** (exit code 0) across the entire repo
  with the Plan 07 files applied. Verified locally after removing the
  build-artifact `.next/types/` directory which is regenerated by
  `next build`.
- `pnpm build` → **FAILS** on a pre-existing Phase 1 typed-routes
  drift in `src/app/[locale]/(app)/admin/users/page.tsx:56` that is
  unrelated to Plan 07. The same error exists at the Plan 03-07 base
  commit (`9d1b9750ace0ce0be929df5f60dbdc10e50d285c`) — confirmed by
  checking out the base unchanged and reproducing the identical error
  without any Plan 07 work in the tree. Documented as DI-04 in
  `.planning/phases/03-kalender/deferred-items.md` (extending the
  existing DI-03 entry from Plan 03-04). The Plan 07 components
  themselves compile cleanly in the Next.js `Compiled successfully`
  step that runs ahead of the typed-routes pass.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 — XSS hardening] Replaced `dangerouslySetInnerHTML` with markdown bold splitter**

- **Found during:** Task 2 — writing `<ConflictWarning>`.
- **Issue:** The plan's reference code (`{ __html: bodyHtml.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>') }`) uses `dangerouslySetInnerHTML` to render the D-57b body's `**bold**` markers as `<strong>`. While the participant name and title flow from server-side `redactConflict` (trusted DB sources today), the threat model includes XSS-via-participant-name (T-03-36) as a forward-looking concern.
- **Fix:** Replaced with a pure-JS `renderMarkdownBold()` helper that splits on `**…**` markers and emits a flat `ReactNode[]` of `<span>` plain text + `<strong>bold</strong>` runs. No `innerHTML` anywhere. React's default text escaping mitigates any future regression where a participant name might carry untrusted characters.
- **Files modified:** `src/components/calendar/conflict-warning.tsx`, `src/components/calendar/conflict-banner.tsx`.
- **Commit:** `463496c`.

**2. [Rule 3 — typed-routes drift documentation]**

- **Found during:** Task 3 — running `pnpm build` to confirm full-stack compile.
- **Issue:** `pnpm build` fails on `src/app/[locale]/(app)/admin/users/page.tsx:56` typed-routes type mismatch. Investigation showed the same error exists on the Plan 07 base commit unchanged — it's a Phase 1 pre-existing failure documented in DI-03 (Plan 03-04). My code follows the same `router.push(\`${pathname}?${qs}\`)` pattern as Plan 06's `calendar-toolbar.tsx` and `empty-hint-strip.tsx`, which are also untyped against the new Next.js 15.5 `typedRoutes`.
- **Fix:** Logged DI-04 in `deferred-items.md` confirming the failure is inherited from base. Did NOT fix the pre-existing Phase 1 file. `pnpm typecheck` (which is what gates plans in this repo's convention) passes cleanly.
- **Files modified:** `.planning/phases/03-kalender/deferred-items.md`.
- **Commit:** `74eedeb`.

### Plan Reference Code Reshapes

The plan's reference snippets for `EventCreateSheet` used `zodResolver(eventCreateInput) as any` for the RHF resolver. I chose to skip the Zod resolver entirely and rely on a flat RHF schema + server-side Zod for authoritative validation. Reasoning: `z.discriminatedUnion` + `zodResolver` requires per-branch type narrowing that defeats RHF's flat form-state model (the form state IS a superset of all branches by necessity). The server returns `errors.calendar.*` keys that the existing `useZodErrorMessage` adapter resolves to localized text. This matches the production pattern when discriminated unions get complex, with no UX cost — invalid submissions surface as the same field-level toasts the server would emit anyway.

## Self-Check: PASSED

- All 11 components exist on disk:
  - `src/components/common/date-time-picker.tsx`
  - `src/components/common/rrule-editor.tsx`
  - `src/components/calendar/filter-combobox.tsx`
  - `src/components/calendar/event-filter-bar.tsx`
  - `src/components/calendar/conflict-warning.tsx`
  - `src/components/calendar/conflict-banner.tsx`
  - `src/components/calendar/event-detail-sheet.tsx`
  - `src/components/calendar/event-delete-dialog.tsx`
  - `src/components/calendar/event-delete-dialog-mount.tsx`
  - `src/components/calendar/event-create-sheet.tsx`
  - `src/components/calendar/event-edit-sheet.tsx`
- `src/app/[locale]/(app)/calendar/page.tsx` modified to import + mount 6 Client Components.
- 3 commits on the worktree branch:
  - `b55c390` — Task 1: compounds + filter combobox + filter bar
  - `463496c` — Task 2: conflict surfaces + detail sheet + delete dialog
  - `74eedeb` — Task 3: create/edit sheets + page.tsx wiring
- `pnpm typecheck` PASSES (exit 0).
- `pnpm build` blocked by inherited DI-04 (pre-existing typed-routes
  drift in `admin/users/page.tsx`); same failure on base commit unchanged.
