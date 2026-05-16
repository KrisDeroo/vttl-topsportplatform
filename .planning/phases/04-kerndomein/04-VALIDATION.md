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

> Filled by planner during PLAN.md creation; rows in this table are extended task-by-task in Plan 04-01 (Wave 0). Each task lists its automated verification command OR declares a Wave 0 dependency.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 04-01-01 | 04-01 | 0 | DOM-RESULT-01/03/04, TOURN-04, I18N-05, I18N-10 | T-04-01-VERIFICATION-STATE-DRIFT, T-04-02-MISSING-LOCALE-FALLBACK, T-04-03-MIGRATION-FORMAT-DRIFT | REQUIREMENTS.md supersedes annotations + nl/en/fr key parity + Phase 4 migration manifest extension | unit | `pnpm test -- tests/unit/i18n-catalog-completeness.test.ts tests/unit/migration-format.test.ts --run --reporter=dot` | ✅ | ⬜ pending |
| 04-01-02 | 04-01 | 0 | VALID-07, VALID-08, GDPR-04, DOM-CAT-02, DOM-MED-CONFLICT-01/02 | T-04-04-WAVE-0-DRIFT-FROM-VALIDATION-MD | 32 Wave 0 RED test skeletons + seed fixture compile cleanly | unit + integration | `pnpm typecheck && pnpm test -- tests/unit/ --run --reporter=dot` | ✅ | ⬜ pending |
| 04-02-01 | 04-02 | 1 | TRAIN-01..06, TOURN-01..06, RANK-01..07, DOM-RANK-01 | T-04-03-MIGRATION-FORMAT-DRIFT | Migrations 0014..0017 with rollback companions; outcome_level + belgium_classification + ranking_type + organisation + tournament_type seeds | unit | `pnpm test -- tests/unit/migration-format.test.ts tests/unit/outcome-level-seed.test.ts --run --reporter=dot` | ❌ W0 | ⬜ pending |
| 04-02-02 | 04-02 | 1 | DOM-RANK-01, GDPR-04, VALID-08 | — | Migrations 0018 (RLS helpers) + 0019 (pg_cron jobs) + 0020 (system_inbox) | unit | `pnpm test -- tests/unit/migration-format.test.ts --run --reporter=dot` | ❌ W0 | ⬜ pending |
| 04-02-03 | 04-02 | 1 | MIG-01..05 | — | `pnpm db:push` applies 0014..0020 cleanly to dev DB | manual | `pnpm db:push && psql $DATABASE_URL -c "\\d session_participants"` | n/a | ⬜ pending |
| 04-03-01 | 04-03 | 2 | TRAIN-04, VALID-08 | T-04-IDEMPOTENCY-MISWIRE | Idempotency middleware + trainerOrTdProcedure preset + quality-score helper | unit | `pnpm test -- tests/unit/idempotency-middleware.test.ts tests/unit/quality-score-range.test.ts --run --reporter=dot` | ❌ W0 | ⬜ pending |
| 04-03-02 | 04-03 | 2 | TRAIN-04..06, D-61, D-62, D-64, D-66, D-68, DOM-MED-CONFLICT-01/02, GDPR-04 | T-04-WALL-BYPASS | training.markAttendanceAndScore + listPending + getSession with 14d wall + audit + RLS | integration | `pnpm test -- tests/integration/14d-walls.test.ts tests/integration/training-mark-attendance.test.ts tests/integration/session-participants-rls.test.ts tests/integration/training-medical-conflict.test.ts tests/integration/attendance-medical-default.test.ts --run --reporter=dot` | ❌ W0 | ⬜ pending |
| 04-04-01 | 04-04 | 2 | TOURN-01..03, TOURN-05..06, D-79 | T-04-PARTICIPANT-RBAC | tournament.create + list + get + addParticipant + removeParticipant (TD-only) | integration | `pnpm test -- tests/integration/tournament-create-rbac.test.ts --run --reporter=dot` | ❌ W0 | ⬜ pending |
| 04-04-02 | 04-04 | 2 | TOURN-04, DOM-RESULT-02, DOM-CAT-02, VALID-07, VALID-08, GDPR-04, D-69..D-81 | T-04-ATOMIC-PARTIAL-COMMIT, T-04-WALL-BYPASS, T-04-RLS-LEAK | tournament.enterResult atomic + 14d wall + asymmetric backfill + TD overwrite + listResults (5-branch UNION) + listPendingForPlayer | integration | `pnpm test -- tests/integration/tournament-atomic-entry.test.ts tests/integration/tournament-enter-result.test.ts tests/integration/tournament-entry-window.test.ts tests/integration/tournament-backfill-rbac.test.ts tests/integration/tournament-td-overwrite.test.ts tests/integration/rls-academy-wide-result-visibility.test.ts tests/integration/age-category-snapshot.test.ts tests/integration/match-result-unique.test.ts tests/integration/idempotency-tournament.test.ts --run --reporter=dot` | ❌ W0 | ⬜ pending |
| 04-05-01 | 04-05 | 2 | RANK-01..07, DOM-RANK-01, D-86..D-90, GDPR-04, VALID-08 | T-04-XOR-VIOLATION, T-04-RBAC-LEAK | ranking router (4 procedures) + discriminated-union Zod + XOR CHECK + entry RBAC + idempotency | unit + integration | `pnpm test -- tests/unit/ranking-xor.test.ts tests/integration/ranking-xor-constraint.test.ts tests/integration/ranking-entry-rbac.test.ts tests/integration/idempotency-ranking.test.ts --run --reporter=dot` | ❌ W0 | ⬜ pending |
| 04-06-01 | 04-06 | 2 | TRAIN-03 (BYDAY), D-84, D-85 | T-04-SPLIT-MATH | splitRRule helper + editRecurringInput Zod schema with BYDAY validation | unit | `pnpm test -- tests/unit/rrule-split.test.ts tests/unit/rrule-byday.test.ts --run --reporter=dot` | ❌ W0 | ⬜ pending |
| 04-06-02 | 04-06 | 2 | TRAIN-03, D-63, D-83, D-84, GDPR-04, CAL-04 | T-04-PAST-MUTATION, T-04-SPARRING-LEAK | calendar.event.editRecurring 3-scope + sparring_partner RLS branch + audit | integration | `pnpm test -- tests/integration/rrule-edit-scopes.test.ts tests/integration/sparring-partner-rls.test.ts tests/integration/session-participants-occurrence.test.ts --run --reporter=dot` | ❌ W0 | ⬜ pending |
| 04-07-01 | 04-07 | 2 | D-67 ch2, D-72 ch2 | — | inbox router + pg_cron daily nudges materialize system_inbox rows | integration | `pnpm test -- tests/integration/pg-cron-nudge-jobs.test.ts --run --reporter=dot` | ❌ W0 | ⬜ pending |
| 04-08-01 | 04-08 | 3 | I18N-01, I18N-05, I18N-10 | — | Refined nl/en/fr copy + recharts install + tokens | unit | `pnpm test -- tests/unit/i18n-catalog-completeness.test.ts --run --reporter=dot && pnpm typecheck` | ✅ (i18n test) | ⬜ pending |
| 04-08-02 | 04-08 | 3 | TRAIN-04..06, D-60, D-62, D-66 | — | Training UI surface — BulkAttendanceScoreForm + StarRatingInput + TeScorenOverview | manual + unit | `pnpm typecheck && pnpm lint` + manual UAT (chip overlay, sticky save) | n/a | ⬜ pending |
| 04-08-03 | 04-08 | 3 | TOURN-01..06, D-69, D-79, D-80, D-81 | — | Tournament UI surface — list / detail / entry / leaderboard / pending widget | manual + unit | `pnpm typecheck && pnpm lint` + manual UAT (atomic save UX) | n/a | ⬜ pending |
| 04-08-04 | 04-08 | 3 | RANK-01..07, D-67, D-72, D-87, D-88, D-90 | — | Rankings UI (recharts + Belgium timeline + entry sheet) + nudge banners + inbox UI | manual + unit | `pnpm typecheck && pnpm lint` + manual UAT (inverted Y-axis; Belgium tier colors) | n/a | ⬜ pending |
| 04-08-05 | 04-08 | 3 | TRAIN-03, D-84, D-85, UI3-D11, UI3-D12 | — | Calendar UI extensions — EventChip overlay + RruleScopePickerDialog + MultiDayPicker | manual + unit | `pnpm typecheck && pnpm lint` + manual UAT (chip overlay, scope picker copy) | n/a | ⬜ pending |
| 04-09-01 | 04-09 | 4 | DOM-CAT-02, GDPR-04, all Phase 4 fixtures | — | Phase 4 seed fixture: session_participants + tournament_results + ranking_entries + belgium_classification + sparring_partner user | unit | `pnpm test -- tests/integration/ --run --reporter=dot` | ❌ W0 | ⬜ pending |
| 04-09-02 | 04-09 | 4 | All Wave 0 RED tests | — | Implement Wave 0 integration test bodies against live Phase 4 routers + schemas | integration | `pnpm test -- tests/integration/ --run --reporter=dot` (full Phase 4 suite green) | ❌ W0 | ⬜ pending |
| 04-09-03 | 04-09 | 4 | I18N-01, RANK-07, D-88, D-90 | — | Playwright `rankings-tab.spec.ts` covers chart interaction; 04-HUMAN-UAT.md ships; per-task map final-fill | E2E + manual | `pnpm test:e2e -- tests/e2e/rankings-tab.spec.ts` | n/a | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky · `❌ W0` = file exists as Wave 0 RED skeleton awaiting implementation*

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
