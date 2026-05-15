---
phase: 4
slug: kerndomein
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-16
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 1.x (unit + RBAC matrix) + Playwright (E2E if needed) |
| **Config file** | `vitest.config.ts` (Phase 1 baseline) |
| **Quick run command** | `npm run test -- --run --reporter=dot` |
| **Full suite command** | `npm run test:ci` |
| **Estimated runtime** | ~45 seconds (quick), ~3–4 min (full incl. RBAC matrix) |

---

## Sampling Rate

- **After every task commit:** Run quick command on the changed files (`npm run test -- --run path/to/changed.test.ts`)
- **After every plan wave:** Run full suite
- **Before `/gsd-verify-work`:** Full suite green AND `npm run lint` clean AND `npm run typecheck` clean
- **Max feedback latency:** 60 seconds per task

---

## Per-Task Verification Map

> Filled by planner during PLAN.md creation. Each task must list its automated verification command OR declare Wave 0 dependency.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 04-XX-XX | (planner fills) | (wave) | REQ-XX | T-04-XX or — | (expected) | unit/integration/RBAC | `(command)` | ✅ / ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/unit/migration-format.test.ts` — already exists, may need extension for Phase 4 migrations 0014–0020
- [ ] `tests/unit/rrule-split.test.ts` — new: `splitRRule(rrule, splitOccurrence)` correctness for D-84 "Deze en toekomstige"
- [ ] `tests/unit/quality-score-range.test.ts` — new: CHECK constraint `quality_score BETWEEN 1 AND 10`, 5-star → 2/4/6/8/10 mapping
- [ ] `tests/unit/match-derived-won.test.ts` — new: `sets_won > sets_lost` derivation; CHECK 0..4 bounds
- [ ] `tests/unit/ranking-xor.test.ts` — new: split-column XOR (value_numeric XOR value_classification_code) at app + DB level
- [ ] `tests/integration/rbac-matrix-phase4.test.ts` — new: 7 roles × {training, tournament_result, match_result, session_participant, ranking_entry, sparring_partner} × CRUD
- [ ] `tests/integration/14d-walls.test.ts` — new: D-64 trainer score wall, D-71 player tournament wall (exact boundaries: 14d-1s, 14d+1s, with TZ correctness)
- [ ] `tests/integration/tournament-atomic-entry.test.ts` — new: D-69 atomicity (outcome + ≥1 match in single transaction; rollback on partial failure; idempotency dedup within 24h per VALID-08)
- [ ] `tests/integration/rrule-edit-scopes.test.ts` — new: all three scopes (single / this_and_future / all_in_series) for training_sessions + meetings
- [ ] `tests/integration/rls-academy-wide-result-visibility.test.ts` — new: D-78 academy-wide tournament_result visibility (TD all + trainers + manager + parent of minor + same-academy player)
- [ ] `tests/integration/pg-cron-nudge-jobs.test.ts` — new: daily 18:00 Brussels job materializes inbox messages correctly (mock-time)
- [ ] `tests/unit/idempotency-middleware.test.ts` — new (or extension): VALID-08 24h dedup; verify middleware actually wired into `tournament.enterResult`, `ranking.addEntry`, `training.markAttendanceAndScore`
- [ ] Vitest config: `vitest.config.ts` already in place from Phase 1; no install needed
- [ ] Playwright config (if E2E): only if planner judges browser-level test needed for ranking chart interactions

*If none: "Existing infrastructure covers all phase requirements." — NOT APPLICABLE for Phase 4; substantial new test coverage required.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Trainer "Te scoren" banner non-dismissible | D-67 channel 1 | Visual / interaction state across page navigation | (1) Log in as trainer with NULL scores in last 14d, (2) verify banner shows on every page until all scored, (3) verify cannot be dismissed |
| Daily 18:00 inbox message receipt | D-67 channel 2 / D-72 channel 2 | Real cron tick + time-of-day | Wait for next 18:00 Brussels tick on a staging DB seeded with pending scores; verify inbox row appears for affected trainer/player |
| Yellow ⚠ overlay on past-session calendar chip | D-67 channel 3 | Visual rendering on Phase 3 chip variant taxonomy extension | Create training session ending yesterday with NULL scores; open calendar week view; verify yellow ⚠ overlay rendered on chip |
| Escalating message tone (day 7 / 10 / 12) | D-67 channel 4 | Copy verification at specific day-offsets | Seed pending session 7d / 10d / 12d back; verify nudge body copy matches `⚠ 2 dagen tot deadline` style at day 12 |
| recharts inverted Y-axis "rank 1 at top" | D-87, D-88 | Visual chart interpretation | Open Rankings tab with ≥3 entries; verify Y-axis reversed so rank 1 is at top of chart area |
| Belgium timeline strip tier-color band | D-87 | Visual color mapping per tier (A=gold, B=silver, ...) | Seed Belgium ranking history A→B→A→A for one player; verify horizontal strip shows correct tier-color bands without interpolation between years |
| 5-star input rendering / DB write | D-60 | Visual interaction; each star click writes 2/4/6/8/10 | Open per-session bulk attendance/score form; click 3rd star; verify DB row `quality_score=6` |
| Multi-day BYDAY RRULE picker UX | D-85 | UI affordance for "Tue + Thu" pattern | Create training with FREQ=WEEKLY + BYDAY=TU,TH; verify it expands on every Tue and Thu but not Mon/Wed/Fri |

*Multilingual sanity check (manual):* Switch UI to en and fr, verify all new keys render without `[MISSING_TRANSLATION]` markers — applies to every new form, error message, and lookup label.

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
