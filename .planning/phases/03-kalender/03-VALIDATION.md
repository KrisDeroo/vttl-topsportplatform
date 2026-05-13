---
phase: 3
slug: kalender
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-14
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
| _filled by planner during PLAN.md authoring_ | | | | | | | | | |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Create these RED test files **before** wave-1 implementation (per Nyquist sampling rule — every task must have a verify hook or a Wave 0 dependency):

- [ ] `tests/unit/rrule.test.ts` — `expandRrule`, `parseRrule`, `validateRruleHorizon` (pure-function coverage incl. DST boundary at Oct 25 Europe/Brussels)
- [ ] `tests/unit/color-tokens.test.ts` — assert 18 `--cal-event-{type}-{bg|fg|border}` tokens × 2 modes (light + dark) in `globals.css`
- [ ] `tests/unit/lookup-codes.test.ts` — EXTEND with 6 `event_type` codes (training/tournament/meeting/stage/eval_conversation/medical_appointment)
- [ ] `tests/unit/schema-locale.test.ts` — EXTEND with `calendar.*`, `lookup.eventType.*`, `errors.calendar.*` namespaces in nl/en/fr
- [ ] `tests/unit/migration-format.test.ts` — EXTEND to assert `0009`, `0010`, `0011`, `0012` exist with rollback companions (MIG-05)
- [ ] `tests/integration/calendar-rls.test.ts` — 30-case sample of 5 roles × 6 event types (player/trainer/TD/parent/sparring_partner; sparring asserts empty in Phase 3 — D-50 no-op)
- [ ] `tests/integration/calendar-rrule-horizon.test.ts` — D-55 write-time validation + read-time clamp
- [ ] `tests/integration/calendar-exceptions.test.ts` — D-54 cancel/move/retitle override + `UNIQUE(event_id, occurrence_date)`
- [ ] `tests/integration/calendar-conflicts.test.ts` — D-56/D-57 per-participant overlap + cross-scope SECURITY DEFINER + role-gated redaction (4 visibility paths)
- [ ] `tests/integration/calendar-audit.test.ts` — 5 audit codes (`calendar_event_{created,updated,deleted,decline,conflict_override}`) + JSONB snapshot completeness
- [ ] `tests/integration/calendar-cascade.test.ts` — FK CASCADE on `DELETE FROM calendar_events` drops extension + participants + exceptions atomically
- [ ] `tests/integration/calendar-decline.test.ts` — RSVP decline ≠ delete; event still visible to other participants
- [ ] `tests/integration/calendar-perf.test.ts` — RISK-POLYMORPH < 200ms week-range with 200 events + 30 RRULE fixture
- [ ] `tests/integration/calendar-filter-options.test.ts` — `calendar.filterOptions.list` is scope-filtered (trainer-as-caller sees only academy players)
- [ ] `tests/rls/calendar-direct-query.test.ts` — direct psql with `app.user_id` GUC set per fixture; asserts zero rows out of scope
- [ ] `tests/e2e/calendar-week-view.spec.ts` — week view renders, event click opens detail sheet, all 6 type colors visible
- [ ] `tests/e2e/calendar-create-event.spec.ts` — drag-create flow → conflict warning → "Toch opslaan" → audit row
- [ ] `tests/e2e/calendar-mobile.spec.ts` — Pixel 5 viewport (360×640) → `timeGridDay` rendered → swipe → `.next()` called
- [ ] `tests/e2e/calendar-drag.spec.ts` — drag event to new time → optimistic update → server conflict → revert
- [ ] `tests/fixtures/calendar-seed.ts` — shared seed helper: 1 TD + 2 trainers + 6 players + 1 academy + ≥ 1 event per type (mix of recurring + exceptions + conflicts)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Cross-locale visual regression (nl/en/fr renderings) | I18N-05/06/07/08 | Playwright per-locale screenshot diff is out of scope for Phase 3 (deferred to Phase 8 release-quality polish) | Reviewer opens `/kalender` in each locale; verifies date headers, weekday short names, event chip copy, filter combobox labels match catalogs |
| Touch swipe on iOS Safari + Android Chrome | CAL-08 | Playwright touch emulation is imperfect on `pointerevents`-vanilla flow | UAT on physical iPhone (iOS 17) + Pixel 7 (Chrome): swipe left → next day; swipe right → prev day; no false-positive swipes during drag-create |
| Color contrast (WCAG AA) for 6 event-type tokens on light + dark | UI3-D5 | Tooling-assisted but final sign-off is design review | Reviewer runs design-tokens contrast script + spot-checks chip on busy week view |

---

## Validation Sign-Off

- [ ] All planner tasks have `<automated>` verify or Wave 0 dependencies (filled by gsd-planner)
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all 20 RED files above
- [ ] No watch-mode flags in CI commands
- [ ] Feedback latency < 30s for quick filter
- [ ] `nyquist_compliant: true` set in frontmatter once gsd-plan-checker confirms map is complete

**Approval:** pending
