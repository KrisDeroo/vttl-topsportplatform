---
phase: 3
slug: kalender
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-14
signed_off_at: 2026-05-15
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Derived from `03-RESEARCH.md` §Validation Architecture; planner fills the Per-Task Verification Map during Wave 0 design.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 3.x (unit + integration) + Playwright 1.59+ (e2e) — already in `package.json` |
| **Config file** | `vitest.config.ts`, `playwright.config.ts` (repo root); Postgres test container via `@testcontainers/postgresql` 11.x |
| **Quick run command** | `pnpm test -- calendar` (vitest run, filter on `calendar*`) |
| **Full suite command** | `pnpm test && pnpm test:e2e` |
| **Estimated runtime** | ~30s (filtered) / ~3 min unit + ~5 min e2e (full) |

---

## Sampling Rate

- **After every task commit:** Run `pnpm test -- calendar` (vitest filter; unit + integration touching `calendar*` files) — < 30s expected
- **After every plan wave:** Run `pnpm test && pnpm test:e2e` — full suite (~3 min unit, ~5 min e2e)
- **Before `/gsd-verify-work`:** Full suite green + manual smoke on Supabase staging confirming week view loads with seeded events
- **Max feedback latency:** 30s (quick) / 8 min (full)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| rrule expansion | 03 | 2 | CAL-07, D-55 | V11 (RRULE DoS) | server-side expansion with horizon clamp | unit | `pnpm test -- rrule` | ✓ | ✅ |
| color tokens | 04 | 2 | CAL-03 | V8 | 18 cal-event tokens × 2 modes + FC overrides | unit | `pnpm test -- color-tokens` | ✓ | ✅ |
| calendar schemas | 03 | 2 | I18N-08, CAL-01..05 | V5 | .strict() + i18n key errors | unit | `pnpm test -- calendar-schemas` | ✓ | ✅ |
| RLS 5×6 matrix | 02, 05 | 1, 3 | USER-04, CAL-04 | V4 | RLS scope per role × type; D-50 sparring no-op | integration | `pnpm test -- calendar-rls` | ✓ | ✅ |
| RRULE horizon | 03, 05 | 2, 3 | CAL-07, D-55 | V11 | D-55 write+read gates | integration | `pnpm test -- calendar-rrule-horizon` | ✓ | ✅ |
| exceptions | 02, 05 | 1, 3 | D-54 | V5 | cancel/move/retitle override + UNIQUE | integration | `pnpm test -- calendar-exceptions` | ✓ | ✅ |
| conflicts redaction | 02, 03, 05 | 1, 2, 3 | CAL-07, D-56, D-57 | V4, I | cross-scope SECURITY DEFINER + role-gated redaction (4 paths) | integration | `pnpm test -- calendar-conflicts` | ✓ | ✅ |
| audit codes | 05 | 3 | GDPR-04 | T | 6 audit codes + JSONB snapshot cap | integration | `pnpm test -- calendar-audit` | ✓ | ✅ |
| delete cascade | 02, 05 | 1, 3 | D-58, D-58c | T, D | FK CASCADE on delete; pre-DELETE audit | integration | `pnpm test -- calendar-cascade` | ✓ | ✅ |
| RSVP decline | 02, 05 | 1, 3 | D-58 | S, T | row-WHERE prevents forgery | integration | `pnpm test -- calendar-decline` | ✓ | ✅ |
| perf budget | 02, 05 | 1, 3 | RISK-POLYMORPH | D | p95 < 200ms week range | integration | `pnpm test -- calendar-perf` | ✓ | ✅ |
| filter scope | 05 | 3 | CAL-04, CAL-05 | I | scope-filtered typeahead | integration | `pnpm test -- calendar-filter-options` | ✓ | ✅ |
| RLS direct psql | 02 | 1 | USER-04, D-50 | V4 | direct app_user query; D-50 no-op | rls | `pnpm test -- calendar-direct-query` | ✓ | ✅ |
| week view | 06 | 4 | CAL-01, CAL-02, CAL-03 | V11 | week default + 6 colors + click opens detail | e2e | `pnpm test:e2e -- calendar-week-view` | ✓ | ✅ |
| create + conflict | 03, 05, 07 | 2, 3, 5 | CAL-07, D-57 | V4 | drag-create → ConflictWarning → Toch opslaan + audit | e2e | `pnpm test:e2e -- calendar-create-event` | ✓ | ✅ |
| mobile + swipe | 06 | 4 | CAL-08 | V11 | timeGridDay + swipe + FAB | e2e | `pnpm test:e2e -- calendar-mobile` | ✓ | ✅ |
| drag-edit + revert | 07 | 5 | CAL-07 | V11 | drag → optimistic + conflict revert | e2e | `pnpm test:e2e -- calendar-drag` | ✓ | ✅ |
| seed fixture | 02, 05 | 1, 3 | (fixture) | n/a | TD + trainers + players + events of all 6 types + recurring + exception + overlap | helper | `(implicit — used by integration tests)` | ✓ | ✅ |
| lookup-codes ext | 02 | 1 | I18N-05 | n/a | 6 event_type codes asserted | unit | `pnpm test -- lookup-codes` | ✓ | ✅ |
| schema-locale ext | 04 | 2 | I18N-01, I18N-06 | n/a | calendar.* + lookup.eventType.* + errors.calendar.* present in 3 locales | unit | `pnpm test -- schema-locale` | ✓ | ✅ |
| migration-format ext | 02 | 1 | MIG-05 | n/a | 4 new migrations + rollback companions assertion | unit | `pnpm test -- migration-format` | ✓ | ✅ |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

All 21 RED files below were converted from `it.todo()` / `test.todo()` placeholders to real assertions during Plan 03-08 (Wave 6) — the Nyquist sign-off gate.

- [x] `tests/unit/rrule.test.ts` — `expandRrule`, `parseRrule`, `validateRruleHorizon` (pure-function coverage incl. DST boundary at Oct 25 Europe/Brussels)
- [x] `tests/unit/color-tokens.test.ts` — assert 18 `--cal-event-{type}-{bg|fg|border}` tokens × 2 modes (light + dark) in `globals.css`
- [x] `tests/unit/calendar-schemas.test.ts` — Zod discriminated-union per event_type (`.strict()`, i18n-key errors, write-time RRULE horizon validation, per-type required fields)
- [x] `tests/unit/lookup-codes.test.ts` — EXTEND with 6 `event_type` codes (training/tournament/meeting/stage/eval_conversation/medical_appointment)
- [x] `tests/unit/schema-locale.test.ts` — EXTEND with `calendar.*`, `lookup.eventType.*`, `errors.calendar.*` namespaces in nl/en/fr
- [x] `tests/unit/migration-format.test.ts` — EXTEND to assert `0009`, `0010`, `0011`, `0012` exist with rollback companions (MIG-05)
- [x] `tests/integration/calendar-rls.test.ts` — 30-case sample of 5 roles × 6 event types (player/trainer/TD/parent/sparring_partner; sparring asserts empty in Phase 3 — D-50 no-op)
- [x] `tests/integration/calendar-rrule-horizon.test.ts` — D-55 write-time validation + read-time clamp
- [x] `tests/integration/calendar-exceptions.test.ts` — D-54 cancel/move/retitle override + `UNIQUE(event_id, occurrence_date)`
- [x] `tests/integration/calendar-conflicts.test.ts` — D-56/D-57 per-participant overlap + cross-scope SECURITY DEFINER + role-gated redaction (4 visibility paths)
- [x] `tests/integration/calendar-audit.test.ts` — 6 audit codes (`calendar_event_{created,updated,deleted,decline,conflict_override,exception_created}`) + JSONB snapshot completeness
- [x] `tests/integration/calendar-cascade.test.ts` — FK CASCADE on `DELETE FROM calendar_events` drops extension + participants + exceptions atomically
- [x] `tests/integration/calendar-decline.test.ts` — RSVP decline ≠ delete; event still visible to other participants
- [x] `tests/integration/calendar-perf.test.ts` — RISK-POLYMORPH < 200ms week-range with 200 events + 30 RRULE fixture
- [x] `tests/integration/calendar-filter-options.test.ts` — `calendar.filterOptions.list` is scope-filtered (trainer-as-caller sees only academy players)
- [x] `tests/rls/calendar-direct-query.test.ts` — direct psql with `app.user_id` GUC set per fixture; asserts zero rows out of scope
- [x] `tests/e2e/calendar-week-view.spec.ts` — week view renders, event click opens detail sheet, all 6 type colors visible
- [x] `tests/e2e/calendar-create-event.spec.ts` — drag-create flow → conflict warning → "Toch opslaan" → audit row
- [x] `tests/e2e/calendar-mobile.spec.ts` — Pixel 5 viewport (360×640) → `timeGridDay` rendered → swipe → `.next()` called
- [x] `tests/e2e/calendar-drag.spec.ts` — drag event to new time → optimistic update → server conflict → revert
- [x] `tests/fixtures/calendar-seed.ts` — shared seed helper: 1 TD + 2 trainers + 6 players + 1 academy + ≥ 1 event per type (mix of recurring + exceptions + conflicts)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Cross-locale visual regression (nl/en/fr renderings) | I18N-05/06/07/08 | Playwright per-locale screenshot diff is out of scope for Phase 3 (deferred to Phase 8 release-quality polish) | Reviewer opens `/kalender` in each locale; verifies date headers, weekday short names, event chip copy, filter combobox labels match catalogs |
| Touch swipe on iOS Safari + Android Chrome | CAL-08 | Playwright touch emulation is imperfect on `pointerevents`-vanilla flow | UAT on physical iPhone (iOS 17) + Pixel 7 (Chrome): swipe left → next day; swipe right → prev day; no false-positive swipes during drag-create |
| Color contrast (WCAG AA) for 6 event-type tokens on light + dark | UI3-D5 | Tooling-assisted but final sign-off is design review | Reviewer runs design-tokens contrast script + spot-checks chip on busy week view |

---

## Validation Sign-Off

- [x] All planner tasks have `<automated>` verify or Wave 0 dependencies (filled by gsd-planner)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all 21 RED files above
- [x] No watch-mode flags in CI commands
- [x] Feedback latency < 30s for quick filter
- [x] `nyquist_compliant: true` set in frontmatter once gsd-plan-checker confirms map is complete

**Approval:** approved (Plan 03-08 — 2026-05-15; nyquist_compliant + wave_0_complete green)
