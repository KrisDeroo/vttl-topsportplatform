# Phase 4: Kerndomein - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-15
**Phase:** 04-kerndomein
**Areas discussed:** Quality score model (TRAIN-04), Tournament results: granularity/lifecycle/edit windows, Recurring-training edit scopes, Ranking chart UX + RISK-02 confirmation

---

## A. Quality score model (TRAIN-04)

### Q1 — Score shape

| Option | Description | Selected |
|--------|-------------|----------|
| Single 1–10 integer | One smallint column; matches KBTTB trainer reports; easiest UI | partial (storage) |
| 1–5 stars | smallint 1–5; reduces granularity | partial (rendering) |
| Multi-axis (technique/intensity/mental) | Three smallint cols; richer signal, more entry burden | |
| Free-text only | Drop structured score | |

**User's choice:** Hybrid — render 1–5 stars in v1 but store in a model that can extend to 1–10 later.
**Notes:** Captured as D-60 — `quality_score smallint CHECK 1..10` stored; 5-star UI writes 2/4/6/8/10. v2 swap to 1–10 stepper or half-stars is zero-migration.

### Q2 — Score visibility (semantic, prose-based)

Open-ended discussion of three shapes:
1. Coach-circle only (literal TRAIN-04)
2. Player sees own + parent sees child's
3. Free-text feedback player-visible, numeric score staff-only

**User's choice:** Option 2 — player + parent of minor see own scores; staff see all.
**Notes:** Captured as D-61. RLS policy `session_participants_visible_to(uid, role)` mirrors Phase 3 D-50 pattern. Powers Phase 7 player-dashboard score-evolution widget for both player and staff render paths.

### Q3 — Capture flow

| Option | Description | Selected |
|--------|-------------|----------|
| Two-step (attendance during, scoring after) | Real coaching workflow split across moments | |
| Single combined form | One screen, one save, attendance + score + feedback per player row | ✓ |
| Three-step (attendance / score / feedback separate) | Most flexible, most navigation cost | |

**User's choice:** Single combined form.
**Notes:** D-62. Score + feedback nullable to allow attendance-only save with revisit later.

### Q4 — Sparring partner scoring

| Option | Description | Selected |
|--------|-------------|----------|
| Players only (TRAIN-04 literal) | Sparring partners only on junction, no score row | ✓ |
| Sparring partners also scored | session_participants accepts any user FK | |
| Sparring partners feedback-only (no numeric) | Compromise; NULL ambiguity | |

**User's choice:** Players only.
**Notes:** D-63.

### Q5 — Temporal guardrail on scoring

| Option | Description | Selected |
|--------|-------------|----------|
| Soft — nudge but never block | Late entries flagged in UI | |
| Hard 30-day for trainer; TD override beyond | Cleaner data quality | partial |
| No guardrail | Simplest | |

**User's choice:** Free-text — "Trainer should be able to enter scores like maximum 2 weeks after the actual training session. The trainer should have a good overview of 'missing scores' without having to enter into each individual training session. Per training session, the list of players should show where he can enter attendance and scoring for all players on 1 screen. Besides that, a kind of 'missing scores' should be pushed to the trainer frequently, disturbing him to motivate him to enter the scores."
**Notes:** Decomposed into D-64 (14d hard wall), D-66 (Te scoren overview), D-67 (intrusive nudges).

### Q6 — Nudge channels

| Option | Description | Selected |
|--------|-------------|----------|
| Daily system message | Inbox alert | ✓ |
| Persistent banner | Non-dismissible on trainer home | ✓ |
| Calendar event chip | Yellow ⚠ on past sessions with missing scores | ✓ |
| Escalation tone at day 7/10/12 | Sharper message wording approaching wall | ✓ |

**User's choice:** "I like option 2. The more the trainer is pushed/notified the better" — interpreted as all 4 channels active with banner as anchor.
**Notes:** D-67. In-app only per `project_no_transactional_email_v1`.

### Q7 — TD override after 14d

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — TD anytime, audit-logged | Sick-trainer scenario covered | |
| No — 14d absolute for everyone | Cleanest data quality | ✓ |
| TD override with mandatory reason_late_entry | Stronger audit; extra friction | |

**User's choice:** Option 2 — 14d absolute for everyone including TD. Plus addendum: TD overview dashboard with cross-trainer metrics feeds trainer-evaluation.
**Notes:** D-64 (no TD override). The TD dashboard ask flagged as scope-creep; deferred to follow-up phase. Minimal cross-trainer "Te scoren" overview shipped in Phase 4 (D-68) as Phase 4 ship.

### Q8 — Defer TD trainer-evaluation dashboard?

**User's choice:** "Yes — defer rich dashboard, ship minimal TD overview in Phase 4".
**Notes:** D-68 + deferred-idea entry for the richer dashboard.

---

## B. Tournament results: granularity, lifecycle, 48h edit clock

### Q1 — Final ranking vs match results relationship (semantic, prose-based)

Three readings discussed:
1. Independent, both optional
2. Final ranking required, matches optional drill-in
3. Matches required, final ranking computed

**User's choice:** Free-text — "For a tournament both the final ranking and the matches are mandatory. The final ranking is not easy to be automatically derived, so to be entered manually by the player. The same 'pushing' should apply as with the trainer scores. A player can enter its tournament results up to 2 weeks after playing and it should be pushed in the same ways to the player as the trainer is notified when missing scores."
**Notes:** Decomposed into D-69 (both mandatory), D-70 (manual outcome selection), D-71 (14d player window), D-72 (same all-channel nudging).

### Q2 — 14d wall for staff entering on behalf

| Option | Description | Selected |
|--------|-------------|----------|
| Asymmetric — staff anytime | Player 14d, trainer/TD no wall | ✓ |
| Hardline parity 14d for everyone | Permanent gap if missed | |
| Player 14d hard, staff 30d soft cap | Compromise; 3 clocks | |

**User's choice:** Asymmetric.
**Notes:** D-73. `entered_by` field tracks attribution.

### Q3 — 48h edit window + edit_reason

| Option | Description | Selected |
|--------|-------------|----------|
| 48h free; later → TD approval; reason mandatory | Standard DOM-RESULT-01 + audit-strict | |
| 48h free; reason optional | Weaker audit | |
| No 48h grace — every edit needs TD approval | Strict | |

**User's choice:** Free-text — "Player can enter/edit till 2 weeks after the tournament. No edit logs required. TD can overwrite at anytime."
**Notes:** Decomposed into D-74 (single 14d window — DOM-RESULT-01 superseded), D-75 (TD unconditional overwrite), D-76 (no result_edit_history table — DOM-RESULT-03 superseded). audit_log still captures per GDPR-04.

### Q4 — Status lifecycle

| Option | Description | Selected |
|--------|-------------|----------|
| Drop the lifecycle — single saved state | DOM-RESULT-04 superseded | ✓ |
| Two states: draft / final | Player controls transition | |
| Keep 3 states (draft / confirmed / published) | Heavyweight; conflicts with TD anytime overwrite | |

**User's choice:** Drop the lifecycle.
**Notes:** D-77. REQUIREMENTS DOM-RESULT-04 superseded.

### Q5 — Result visibility (semantic, prose-based)

| Option | Description | Selected |
|--------|-------------|----------|
| Academy-wide (peers + staff + parent) | Leaderboard energy | ✓ |
| Staff-only + own + parent | Mirrors D-61 score visibility | |
| Per-player opt-out toggle | Most flexible; v1 complexity | |

**User's choice:** Academy-wide.
**Notes:** D-78. RLS policy `tournament_result_visible_to(caller_uid)`.

### Q6 — Tournament participant registration

| Option | Description | Selected |
|--------|-------------|----------|
| TD/trainer adds + player self-add | Best-of-both | |
| TD/trainer only | Tight control | |
| Auto-derive from result entry | Breaks nudging | |

**User's choice:** Free-text — "It is the TD that creates a new tournament and 'subscribes' players to that tournament. As a result, the tournament appears in the players' calendar and the player can enter results."
**Notes:** D-79. TD-only for registration; multi-role for result entry (D-73).

### Q7 — Bulk match entry UX

| Option | Description | Selected |
|--------|-------------|----------|
| Add-row-as-needed table | Final ranking top, [+ Wedstrijd] adds rows | ✓ |
| Pre-allocated rows from outcome | Round labels seeded; brittle on non-64-draws | |
| Wizard — one match at a time | Low density | |

**User's choice:** Add-row-as-needed table.
**Notes:** D-80.

### Q8 — Score field format

| Option | Description | Selected |
|--------|-------------|----------|
| Free text with opportunistic parse | varchar + optional jsonb derive | |
| Structured array required | jsonb only | |
| Free text only — no parsing | Cheapest | |

**User's choice:** Free-text — "For the moment only result in sets is required (e.g. 3-2) without the detailed set scores. Based on the result, the system knows if he won or lost (3-2 is win, 1-3 is lost). In a later phase of the project, set scores may become useful."
**Notes:** D-81. `sets_won smallint`, `sets_lost smallint`. Won/lost derived. TOURN-04 "gewonnen/verloren toggle" partially superseded. v2 can add `score_sets jsonb`.

---

## C. Recurring-training edit scopes

### Q1 — Which edit scopes ship in Phase 4

| Option | Description | Selected |
|--------|-------------|----------|
| All three: single + this-and-future + all-in-series | Google/Outlook parity | ✓ |
| Single + all-in-series only | Skip split-and-rewrite | |
| Single + this-and-future only | Skip base edit; bad for typo fixes | |

**User's choice:** All three.
**Notes:** D-84. Plus D-82 schema correction (occurrence_date on session_participants — Phase 3 D-51 sketch was incomplete) and D-83 (past data immutable across all scopes).

### Q2 — BYDAY / BYMONTHDAY pickers

| Option | Description | Selected |
|--------|-------------|----------|
| BYDAY only (multi-day-per-week) | Tue+Thu trainings supported | ✓ |
| Both BYDAY + BYMONTHDAY | Full coverage | |
| Neither | Stay with Phase 3 simple weekly | |

**User's choice:** BYDAY only.
**Notes:** D-85. BYMONTHDAY deferred to v2.

---

## D. Ranking chart UX + RISK-02 confirmation

### Q1 — RISK-02 Belgium ranking direction confirmation

| Option | Description | Selected |
|--------|-------------|----------|
| Confirm — all 5 types asc_is_better | Schema docstring matches reality | |
| Belgium uses desc_is_better | Different direction | |

**User's choice:** Free-text — "All international rankings are numeric (rank 1 = best), the Belgian system works different with classifications: A (1 to 25), there is only 1 player A1 in Belgium, one player A2,… Today there are 25 A ranked players, but this can differ each year. After A it is more structured B0 B2 B4 B6 C0 C2 C4 C6 D0 D2 D4 D6 E0 E2 E4 E6 NC (no classification). Of all these classifications there are numerous players. This ranking is only adapted once a year (around the month of may)."
**Notes:** RISK-02 resolved with a completely different model — Belgium ranking is hierarchical classification, not a numeric rank. REQUIREMENTS.md RANK-01 ("rangwaarde numeric") amended.

### Q2 — Schema model for ranking values

| Option | Description | Selected |
|--------|-------------|----------|
| Split columns: value_numeric + value_classification_code | Type-safe; new belgium_classification lookup | ✓ |
| Unified text + value_shape on ranking_type | Compact; loses type safety | |
| JSONB value | Most flexible; least readable | |

**User's choice:** Split columns.
**Notes:** D-86. `belgium_classification` lookup seeded with A1..A50 + tier codes + NC.

### Q3 — Belgium chart UX

| Option | Description | Selected |
|--------|-------------|----------|
| Annual timeline strip + tier-evolution viz | Distinct widget from int'l line chart | ✓ |
| Force line chart on ordinal axis | Single layout; harder to read | |
| Tabular history only — no chart | Cleanest implementation | |

**User's choice:** Annual timeline strip.
**Notes:** D-87. International gets the line chart (D-88).

### Q4 — International chart presentation

| Option | Description | Selected |
|--------|-------------|----------|
| Per-type chart with selector | Cleanest reading per type | ✓ |
| All 4 on one chart with multi-series toggle | Different scales confusing | |
| Small multiples (2×2 grid) | Dense overview; mobile-unfriendly | |

**User's choice:** Per-type chart with selector.
**Notes:** D-88. Default = player's primary type derived from age category.

### Q5 — Entry agency

| Option | Description | Selected |
|--------|-------------|----------|
| Belgium TD-only, international player+TD | Acknowledges federation-set nature | |
| All TD only | Strict | |
| All player + TD (literal RANK-06) | Player self-reports Belgium too | ✓ |

**User's choice:** Option 3 — literal RANK-06 for all types including Belgium.
**Notes:** D-89. Trust player honesty; TD can correct.

### Q6 — Default time range

| Option | Description | Selected |
|--------|-------------|----------|
| Last 24 months | Sweet spot — season + comparison | ✓ |
| Last 12 months | Shorter; misses long-term arc | |
| All-time | Most context; visually compressed | |

**User's choice:** Last 24 months.
**Notes:** D-90. Range selector pills: 1m/6m/1y/2y/all.

### Q7 — Chart location

| Option | Description | Selected |
|--------|-------------|----------|
| Rankings tab only — Phase 7 builds dashboard separately | Clean phase boundary | ✓ |
| Both Rankings tab + home dashboard chip | Lightweight extra | |

**User's choice:** Rankings tab only.
**Notes:** D-91. Phase 7 VIEW-03 builds the dashboard ranking widget reusing same query.

---

## Claude's Discretion

- Exact tRPC router file layout (single files or sub-folder split) — per Phase 1/2/3 conventions
- Migration grouping (3–4 migrations: per-domain table + lookup seeds + RLS policies)
- 9-level outcome code naming following `outcome_winner`, `outcome_last_4`, ... `outcome_group_stage` convention
- tegenstander field validation (free text per TOURN-04; no normalized opponents table v1)
- video_link validation (Zod url() + max 500 chars; no platform whitelist)
- Age category cross-check (DOM-CAT-02) — snapshot column on tournament_results via `deriveAgeCategoryAt()` helper
- Inert exception garbage collection (D-84) — leave inert vs garbage-collect: leave alone
- Chart library (recharts vs chart.js — recharts recommended for React 19 + Tailwind 4 + shadcn affinity)
- Sparring partner junction FK target (users.id with role filter; SPAR profile table Phase 5)
- next-intl message key naming under domain namespaces
- Phase 6 inbox dependency for nudge channel 2 — planner decides Phase-4 minimal inbox vs defer

## Deferred Ideas

- **TD trainer-evaluation dashboard** with per-trainer aggregates, comparison charts, missing-score trend, evaluation-feeder graphs — post-Phase-7 or own dedicated phase
- **Detailed set-by-set scores** (`match_results.score_sets jsonb`) — v2, supports AI video analysis
- **BYMONTHDAY in RRULE editor** — v2/deferred
- **Federation ranking sync** — v2 per DOM-RANK-01
- **Phase 6 inbox integration for nudge channel 2** — depends on Phase 6 sequence
- **Recurring-training participant edits during "Deze en toekomstige"** — implicit in user expectation; planner may scope-down to base fields only
- **Right-click context menu** on calendar chips — Phase 3 deferred
- **Per-event-type RBAC fine-grained for academy_manager** — Phase 3 deferred
- **"Verberg gedeclineerde events" toggle, ICS export, per-user timezone, color customization** — Phase 3 deferreds carried forward
- **Sparring partner scoring** as separate construct — D-63 excludes explicitly
- **Mandatory `edit_reason`** on tournament-result edits — dropped by D-76; reversible if compliance requires
