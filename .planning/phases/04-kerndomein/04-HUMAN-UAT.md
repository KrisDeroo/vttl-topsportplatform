---
status: pending
phase: 04-kerndomein
source: [04-VALIDATION.md §Manual-Only Verifications]
created: 2026-05-19
updated: 2026-05-19
---

# Manual UAT — Phase 4 Kerndomein

> The 8 manual verifications below are the documented gaps in Phase 4's
> automated coverage. Run them on a fresh staging environment seeded with
> the Phase 4 fixtures (`tests/fixtures/phase4-seed.ts` or the equivalent
> production-shape seed) before declaring Phase 4 complete.
>
> Cross-reference: every entry quotes the controlling D-XX from
> `.planning/phases/04-kerndomein/04-CONTEXT.md` so the verifier can audit
> the source artifact when an entry feels stale.

---

## §1 Setup

### 1.1 Prerequisites

- **Staging environment** running the Phase 4 commit (`pnpm db:push` applied
  through migration 0020 inclusive).
- **Seed data**:
  - Phase 1 roles matrix (7 users × 7 roles)
  - Phase 3 calendar canon (6 single events + 1 recurring + 1 cancelled
    exception + 1 overlap pair)
  - Phase 4 operational data:
    - 1 past-training session 8 days ago with 2 NULL `quality_score` rows
    - 1 past-tournament 3 days ago with `tournament_results` + `match_results`
      for player A
    - 5 `ranking_entries` for player A (4 numeric Senior World + 1 Belgium
      `A12`)
    - 1 `session_sparring_partners` junction (sparring partner attached to
      past-training session)
  - Brussels server timezone (so the 18:00 nudge cron fires correctly).
- **Browsers**: Chrome stable + Safari/WebKit (mobile UA test cases).
- **Test accounts**:
  - `td@vttl.test`             (technical_director)
  - `trainer-a@vttl.test`      (trainer in academy A)
  - `manager-a@vttl.test`      (academy_manager A)
  - `player-a@vttl.test`       (player in academy A — primary subject)
  - `player-a2@vttl.test`      (player in academy A — peer)
  - `player-b@vttl.test`       (player in academy B — cross-academy)
  - `parent-a@vttl.test`       (parent of player A)
  - `sparring@vttl.test`       (sparring_partner)

### 1.2 Sign-off

Each section has a pass/fail line. Tester records initials + date.

---

## §2 Manual-Only Verifications

### 2.1 Trainer "Te scoren" banner non-dismissible — D-67 channel 1

**Source:** `04-CONTEXT.md` D-67 channel 1 (in-page banner)
**Why manual:** Visual / interaction state across page navigation.

**Steps**

1. Log in as `trainer-a@vttl.test`.
2. Confirm at least one session ended 7–13 days ago has NULL
   `quality_score` for ≥1 participant (seed fixture A).
3. Navigate to **/nl/dashboard**, observe the page header.
4. Verify a banner reads
   `⚠ Je hebt nog {count} sessie(s) zonder scores. Score binnen 14 dagen.`
5. Click another nav link (Calendar, Players, Tournaments). Verify the
   banner reappears on every page header.
6. Inspect DOM: confirm there is **no close (×) button** on the banner.
7. Navigate back to dashboard, score the pending row, confirm the banner
   disappears (the listPending query now returns 0).

**Expected:** Banner present on every page; not dismissible; only
auto-clears when scoring completes.

**Result:** [ ] PASS  [ ] FAIL  — **Tester: ____  Date: ________**

---

### 2.2 Daily 18:00 inbox message receipt — D-67 channel 2 / D-72 channel 2

**Source:** `04-CONTEXT.md` D-67 channel 2, D-72 channel 2
**Why manual:** Real cron tick + time-of-day; cannot be reproduced in CI
without time mocking the entire stack.

**Steps**

1. On staging, with Brussels server timezone, confirm pg_cron extension is
   running:
   `psql $DATABASE_URL -c "SELECT jobname FROM cron.job WHERE jobname LIKE 'run_daily_%'"`
   — expect 4 rows (trainer-score + player-result × 17:00 UTC + 16:00 UTC).
2. Seed: 1 trainer with pending-score session 8 days ago + 1 player whose
   tournament ended 3 days ago without a `tournament_results` row.
3. Wait for the next 18:00 Europe/Brussels tick.
4. Log in as the trainer; navigate to **/nl/inbox**.
5. Verify a row with `kind=trainer_score_nudge` exists, payload contains
   `pendingCount: 1` + `maxDaysSinceEnd ~= 8`.
6. Log in as the player; navigate to **/nl/inbox**.
7. Verify a row with `kind=player_result_nudge` exists.

**Expected:** Both inbox rows materialise at the 18:00 Brussels tick;
content matches seed.

**Result:** [ ] PASS  [ ] FAIL  — **Tester: ____  Date: ________**

---

### 2.3 Yellow ⚠ overlay on past-session calendar chip — D-67 channel 3 / UI4-D07

**Source:** `04-CONTEXT.md` D-67 channel 3
**Why manual:** Visual rendering on Phase 3 chip variant extension.

**Steps**

1. As `trainer-a@vttl.test`, ensure a training session ended yesterday
   with NULL `quality_score` for ≥1 participant.
2. Navigate to **/nl/calendar** (week view).
3. Locate the chip for that past session.
4. Verify a yellow warning marker `⚠` overlays the chip
   (visible in both light + dark mode).
5. Score the row in another tab; refresh the calendar.
6. Verify the overlay disappears.

**Expected:** Yellow ⚠ icon on past-session chips with pending scores;
disappears when scored.

**Result:** [ ] PASS  [ ] FAIL  — **Tester: ____  Date: ________**

---

### 2.4 Escalating message tone (day 7 / 10 / 12) — D-67 channel 4

**Source:** `04-CONTEXT.md` D-67 channel 4
**Why manual:** Copy verification at specific day-offsets.

**Steps**

1. Seed three pending-score sessions for trainer A:
   - one ending 7 days ago,
   - one ending 10 days ago,
   - one ending 12 days ago.
2. On the next 18:00 Brussels tick (or via the manual `SELECT
   run_daily_trainer_score_nudge()` SQL invocation), inspect the
   `system_inbox` rows created for trainer A.
3. Verify the `payload.maxDaysSinceEnd` value drives the body copy:
   - day 7 → neutral reminder ("Score deze week nog.")
   - day 10 → urgent ("Score binnen 4 dagen.")
   - day 12 → escalated ("⚠ 2 dagen tot deadline — score nu.")
4. Compare against `messages/nl.json` keys under `nudge.trainerScore.*`.

**Expected:** Copy escalates as days approach the 14d wall.

**Result:** [ ] PASS  [ ] FAIL  — **Tester: ____  Date: ________**

---

### 2.5 recharts inverted Y-axis "rank 1 at top" — D-87 / D-88

**Source:** `04-CONTEXT.md` D-87 + D-88; `04-UI-SPEC.md` §Two Ranking Widgets
**Why manual:** Visual chart interpretation. (The Playwright spec
`tests/e2e/rankings-tab.spec.ts` covers the assertion that
`tickFormatter` prepends '#'; human eye still has to confirm the visual
inversion is correct on mobile + zoom.)

**Steps**

1. Log in as `player-a@vttl.test`.
2. Navigate to **/nl/players/{player-a-id}/rankings** (or the player
   self-rankings nav shortcut).
3. Default tab = "Senior Wereld". With ≥3 entries seeded, the chart
   renders.
4. Verify the Y-axis is inverted: rank 1 sits at the TOP of the chart;
   higher rank values (lower performance) sit at the bottom.
5. Confirm the axis label reads "Ranking (lager = beter)" so the
   inversion is signposted for color-blind users.
6. Zoom the chart to 200%: the inversion still reads correctly.

**Expected:** Inverted Y-axis with rank 1 visually at top; redundant
text label present.

**Result:** [ ] PASS  [ ] FAIL  — **Tester: ____  Date: ________**

---

### 2.6 Belgium timeline strip tier-color band — D-87

**Source:** `04-CONTEXT.md` D-87; `04-UI-SPEC.md` §Belgium timeline strip
**Why manual:** Visual color mapping per tier (A=gold, B=silver, …)

**Steps**

1. Seed a Belgium ranking history for player A: A12 (2023), B0 (2024),
   A1 (2025), A12 (2026).
2. Log in as `player-a@vttl.test`. Open Rankings tab; switch to "België".
3. Verify the strip renders 4 year-cells, one per calendar year.
4. Verify each cell's background uses the tier color token:
   - A* → `bg-cls-tier-a-bg` (gold family)
   - B* → `bg-cls-tier-b-bg` (silver family)
   - NC → border + outline (no fill)
5. Click on a cell; verify a popover surfaces date + value + source.
6. Tab through the strip with keyboard — every cell is focusable.

**Expected:** Strip renders tier-colored bands; no interpolation between
years; popover surfaces metadata; keyboard navigable.

**Result:** [ ] PASS  [ ] FAIL  — **Tester: ____  Date: ________**

---

### 2.7 5-star input rendering / DB write — D-60

**Source:** `04-CONTEXT.md` D-60; `src/lib/quality-score.ts`
**Why manual:** Visual interaction; each star click writes 2/4/6/8/10.

**Steps**

1. As `trainer-a@vttl.test`, open a past training session (within 14d)
   via the calendar chip.
2. Form opens (BulkAttendanceScoreForm). Each player row exposes a 5-star
   input.
3. Click the 3rd star for player A.
4. Click "Opslaan". Verify success toast.
5. Query the DB:
   `psql $DATABASE_URL -c "SELECT quality_score FROM session_participants WHERE event_id='{eventId}' AND user_id='{playerA-id}'"`.
6. Verify `quality_score = 6` (3 stars × 2 = 6 per `mapStarsToDb`).
7. Repeat with 5 stars → expect 10. With 0 stars → expect NULL.

**Expected:** Stars map deterministically to 2/4/6/8/10 in the DB;
0 stars = NULL (pending).

**Result:** [ ] PASS  [ ] FAIL  — **Tester: ____  Date: ________**

---

### 2.8 Multi-day BYDAY RRULE picker UX — D-85

**Source:** `04-CONTEXT.md` D-85; `04-UI-SPEC.md` §RRULE editor
**Why manual:** UI affordance for "Tue + Thu" patterns.

**Steps**

1. As `td@vttl.test`, open the calendar event-create dialog.
2. Pick "Training", set start/end, toggle "Herhalend".
3. Open the RRULE editor; select `FREQ=WEEKLY`.
4. Click both "Di" and "Do" pills (BYDAY=TU,TH).
5. Verify the preview shows the next 5 occurrences spanning both Tue/Thu.
6. Save. Open the recurring event detail; verify the RRULE displayed is
   `FREQ=WEEKLY;BYDAY=TU,TH`.
7. Navigate the calendar forward 4 weeks; verify exactly 8 chips appear
   (2 per week × 4 weeks) on Tue + Thu, none on Mon/Wed/Fri.

**Expected:** Multi-day BYDAY picker works; expansion places chips on
both selected days only.

**Result:** [ ] PASS  [ ] FAIL  — **Tester: ____  Date: ________**

---

## §3 Multilingual sanity check

For each new Phase 4 surface, switch the user `preferred_locale` between
`nl`, `en`, and `fr`:

1. `nl` (default): every label, button, form error, and lookup label
   renders Dutch copy.
2. `en`: same surfaces render English copy; no `[MISSING_TRANSLATION]`
   markers.
3. `fr`: same surfaces render French copy; no `[MISSING_TRANSLATION]`.

**Surfaces to sample (≥1 per locale per role):**

- Calendar week view chips + event detail sheet.
- Bulk attendance/score form ("Score" submit, star labels, attendance
  toggle copy).
- Tournament list + entry form (outcome dropdown, round dropdown, match
  fields).
- Rankings tab + chart (axis label "Ranking (lager = beter)" / equivalent).
- Inbox + nudge banner copy (3 escalation levels).
- Error toasts when triggering wall-rejection (`scoreWindowExpired`,
  `entryWindowExpired`).

**Expected:** Every catalog key from `messages/{nl,en,fr}.json` resolves;
zero placeholder markers visible in the UI.

**Result:** [ ] PASS  [ ] FAIL  — **Tester: ____  Date: ________**

---

## §4 End-to-end happy path walkthrough

Goal: prove the full Phase 4 surface composes correctly across roles.

**Acts**

1. **TD creates a tournament.**
   - Log in as `td@vttl.test`. Navigate **/nl/tournaments → New**.
   - Fill: naam "Belgian Open Test", start = +5 days, end = +6 days,
     city Brussel, country BE, age_senior, tournament_belgium.
   - Save. Verify the tournament appears in the calendar week view +
     tournament list.

2. **TD adds player A as participant.**
   - Open the tournament detail. Click "Speler toevoegen". Select
     `player-a`. Save.
   - Verify the participant row appears; `tournament.list` for player A
     now surfaces the tournament.

3. **Player enters their result (within 14d window after end).**
   - Log in as `player-a@vttl.test`. Navigate to the tournament detail
     after the end date.
   - Click "Resultaat invoeren". Fill outcome=outcome_last_8 +
     2 match rows. Save.
   - Verify success toast + tournament_results row + ≥1 match_results row.

4. **TD corrects the player's result (D-75 unconditional overwrite).**
   - Log in as `td@vttl.test`. Open the same tournament's result detail.
   - Edit outcome to `outcome_last_4`. Save.
   - Verify `tournament_result_overwritten` audit row exists with the
     old outcome in `old_values`.

5. **Academy peer sees the result (D-78 Branch 5).**
   - Log in as `player-a2@vttl.test`. Navigate to the academy leaderboard.
   - Verify player A's result appears under the tournament.

6. **Player A adds a Belgium ranking entry.**
   - Log in as `player-a@vttl.test`. Open Rankings tab → "België".
   - Click "Nieuwe ranking". Pick A12. Recorded = today. Save.
   - Verify the entry shows on the timeline strip + the
     `ranking_entries` audit row contains `ranking_entry_added`.

7. **Chart renders in nl + en + fr.**
   - Switch the locale to en; the Y-axis label flips to English.
   - Switch to fr; flip to French. No placeholders.

**Expected:** All 7 acts complete without manual SQL or out-of-band fixes.

**Result:** [ ] PASS  [ ] FAIL  — **Tester: ____  Date: ________**

---

## Summary

| # | Verification                                                | Result | Tester | Date |
|---|-------------------------------------------------------------|--------|--------|------|
| 1 | Trainer "Te scoren" banner non-dismissible (D-67 ch1)       | ____   |        |      |
| 2 | Daily 18:00 inbox receipt (D-67 ch2 / D-72 ch2)             | ____   |        |      |
| 3 | Yellow ⚠ overlay on past-session chip (D-67 ch3 / UI4-D07)  | ____   |        |      |
| 4 | Escalating message tone (D-67 ch4)                          | ____   |        |      |
| 5 | recharts inverted Y-axis (D-87 / D-88)                      | ____   |        |      |
| 6 | Belgium timeline tier-color band (D-87)                     | ____   |        |      |
| 7 | 5-star input → DB 2/4/6/8/10 (D-60)                         | ____   |        |      |
| 8 | Multi-day BYDAY RRULE picker UX (D-85)                      | ____   |        |      |
| § | Multilingual sanity (nl/en/fr) — no [MISSING_TRANSLATION]    | ____   |        |      |
| § | End-to-end walkthrough (7 acts)                             | ____   |        |      |

**Final sign-off:** [ ] All sections PASS — Phase 4 release ready.

Signed: ___________________  Date: ___________
