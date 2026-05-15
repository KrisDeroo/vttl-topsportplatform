---
status: partial
phase: 03-kalender
source: [03-VERIFICATION.md]
started: 2026-05-15T14:35:00Z
updated: 2026-05-15T14:35:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Week view rendering with scoped data (TD role)
expected: TD opens /[locale]/calendar — week view (timeGridWeek) is default; all 6 event-type chips render with their color-coded backgrounds (training=blue, tournament=orange, meeting=green, stage=purple, evalconv=yellow, medical=red); clicking a chip opens EventDetailSheet.
result: [pending]

### 2. Player scope isolation — RLS correctness
expected: Player A opens calendar — sees ONLY events they participate in; direct API call to `calendar.list` with Player B's session returns empty for Player A's private events. RLS enforced by `calendar_events_visible_to()` SECURITY DEFINER.
result: [pending]

### 3. Sparring partner NO-OP (D-50)
expected: A sparring_partner session opens /[locale]/calendar — `calendar.list` returns `[]` (zero events). Phase 4 will wire `session_sparring_partners` junction; for Phase 3 this is intentionally NO-OP.
result: [pending]

### 4. Conflict warning + force-override audit
expected: Create an event for Player X who already has an overlapping event → first submit returns TRPCError CONFLICT → `ConflictWarning` surfaces with the participant name (redacted/full per D-57) → user clicks "Toch opslaan" → second submit with `force: true` succeeds → `audit_log` has `calendar_event_conflict_override` row with `force: true`.
result: [pending]

### 5. Mobile single-day + swipe (CAL-08)
expected: Pixel-5 viewport (360×640px) — FullCalendar forced into `timeGridDay`; week/year buttons hidden in toolbar; horizontal swipe with dx ≥ 60px and dt ≤ 400ms calls FullCalendar API `.next()`/`.prev()` and advances visible date by one day; "Nieuwe afspraak" CTA floats bottom-right via `position: fixed`.
result: [pending]

### 6. Drag-to-edit + conflict revert
expected: Drag an existing event chip to a different time slot → optimistic visual move → on server CONFLICT response: `ConflictBanner` appears at top of page + `revert()` is invoked to snap the chip back to its original slot.
result: [pending]

### 7. WCAG AA color contrast for all 6 event-type chips
expected: Each `--cal-event-{type}-fg` on `--cal-event-{type}-bg` meets WCAG AA 4.5:1 contrast in both light and dark modes; verified via DevTools color-contrast or design review sign-off.
result: [pending]

### 8. Cross-locale visual regression (nl/en/fr)
expected: Calendar renders correctly per locale — Dutch `Ma/Di/Wo/Do/Vr/Za/Zo`, English `Mon/Tue/Wed/Thu/Fri/Sat/Sun`, French `Lu/Ma/Me/Je/Ve/Sa/Di`; event chip labels, filter bar labels, error copy all match the appropriate i18n catalog.
result: [pending]

## Summary

total: 8
passed: 0
issues: 0
pending: 8
skipped: 0
blocked: 0

## Gaps
