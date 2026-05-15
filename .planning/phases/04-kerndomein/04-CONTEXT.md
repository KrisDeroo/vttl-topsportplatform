# Phase 4: Kerndomein - Context

**Gathered:** 2026-05-15
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 4 delivers the **operational layer atop Phase 3's polymorphic event schema** across the three core sports domains: **trainings** (attendance + 5-star quality scoring + 14-day discipline-enforced entry window with all-channel intrusive nudging), **tournaments** (atomically-entered final ranking + per-match results with academy-wide visibility and 14-day player entry window backed by trainer/TD anytime-backfill), and **rankings** (split-schema time series accommodating both numeric international rankings and Belgium's hierarchical classification system, with per-type chart UX). Phase 4 also closes Phase 3's deferred RRULE-edit scopes ("Deze en toekomstige" + "Alle in de reeks") and adds BYDAY multi-day-per-week support to the RRULE editor.

**Schema discipline (extends Phase 3 D-51):** Phase 4 adds ONLY operational tables — `session_participants`, `session_sparring_partners`, `tournament_results`, `match_results`, `ranking_entries`, `belgium_classification` (new lookup). **No changes to Phase 3 event schemas** (`calendar_events` / `calendar_event_participants` / `calendar_event_exceptions` / `training_sessions` / `tournaments` / `meetings` / `stages` / `eval_conversations` / `medical_appointments`). Phase 3 D-51's `session_participants(event_id, user_id, …)` sketch is corrected by D-82 to include `occurrence_date` — Phase 4 owns this schema. Sparring-partner visibility (CAL-04) RLS UNION branches that were placeholders in Phase 3 are filled by Phase 4's `session_sparring_partners` junction (FK to `users.id` for users with role `sparring_partner`; the dedicated SPAR profile table is Phase 5 per REQUIREMENTS traceability).

**Out of scope for Phase 4 (deferred):** the rich **TD trainer-evaluation dashboard** (per-trainer aggregates, comparison charts, missing-score trend visualizations) — Phase 4 ships the schema + a minimal cross-trainer "Te scoren" overview for TD (D-68); the richer evaluation dashboard ships as its own follow-up phase. Ambitions (AMB-01..04) belong to Phase 5. Sparring partner profile entity (SPAR-01..04) belongs to Phase 5. Federation ranking sync belongs to v2 (DOM-RANK-01).

</domain>

<decisions>
## Implementation Decisions

### A. Quality score model (TRAIN-04)

- **D-60 (quality_score stored 1–10, rendered 5-star in v1):** `quality_score smallint NULL CHECK (quality_score BETWEEN 1 AND 10)` on `session_participants`. v1 UI = 5-star input; each star writes 2, 4, 6, 8, 10 to the DB. v2 swap to true 1–10 (numeric stepper or half-stars writing odd values 1, 3, 5, 7, 9) is zero-migration — the column already accepts the wider range. NULL allowed for marked-present-but-not-yet-scored.

- **D-61 (score visibility — staff write, player + parent read own):**
  - **Write:** trainer (own session) + TD.
  - **Read:** trainer + TD + academy_manager (within player's academy) + player (own row) + parent (own child).
  - Implemented via `session_participants_visible_to(uid, role)` SECURITY DEFINER, pattern mirrors Phase 3 D-50 `calendar_events_visible_to()`.
  - Powers Phase 7 player-dashboard quality-score-evolution widget on both player-view and staff-view rendering paths.

- **D-62 (single combined attendance + score form):** One screen per session — rows of `[player | attendance toggle | 5-star score | feedback textarea]`. Single Save button. `quality_score` + `feedback_text` are nullable so the trainer can save with attendance-only and revisit later. Form is reachable from the calendar event detail; submits a single mutation that upserts all `session_participants` rows for the given `(event_id, occurrence_date)`.

- **D-63 (players only scored — sparring partners are not):** `session_participants` rows exist only for player users (D-50's `role_in_event = 'participant'` filtered to players). Sparring partners attached to the session live on `session_sparring_partners` junction (FK to `users.id` where role = `sparring_partner`) without a score row. Sparring evaluation as a distinct construct is future scope.

- **D-64 (14-day absolute scoring wall — no TD override):** Trainer's score-entry / score-edit endpoint accepts only when `now() - calendar_events.ends_at <= INTERVAL '14 days'` for the given occurrence. Beyond the wall → 403 with i18n key `errors.training.scoreWindowExpired`. TD has no override — the wall is absolute for everyone. Intentional trade-off: data-quality discipline over catch-up flexibility. Required precondition for the deferred trainer-evaluation dashboard to produce meaningful comparisons.

- **D-66 (trainer "Te scoren" overview):** Trainer's home / dashboard surfaces a "Te scoren" aggregator. Query shape: sessions whose `ends_at < now()` AND `ends_at >= now() - INTERVAL '14 days'` AND `EXISTS (SELECT 1 FROM session_participants WHERE quality_score IS NULL)`, scoped to the calling trainer's `training_sessions.trainer_id`. Each row links to the per-session bulk screen (D-62). No drill-in required to see which sessions are pending.

- **D-67 (all-channel intrusive nudges — in-app only):** Layered nudging system:
  1. **Persistent non-dismissible banner** on trainer home until pending-count = 0.
  2. **Daily inbox message at 18:00** listing pending sessions, generated by `pg_cron` job (Phase 1 cron infra extended).
  3. **Yellow ⚠ overlay** on past-session calendar chips with at least one NULL score (UI-SPEC needs an extension to UI3-D11 chip variants for "needs-scoring" state).
  4. **Escalating message tone at day 7 / day 10 / day 12** — daily message body sharpens with copy like `"⚠ 2 dagen tot deadline"`.
  - Channel scope = in-app only per `project_no_transactional_email_v1`. No transactional email in v1.

- **D-68 (TD cross-trainer "Te scoren" overview):** TD gets the same widget as D-66 but unfiltered by trainer — sees pending sessions across every trainer with the trainer's name displayed on each row. Same SQL query, different scope (drops the `trainer_id = ctx.user.id` predicate). Operationally lightweight; fills the supervision gap in Phase 4 without committing to the richer evaluation dashboard.

### B. Tournament results (TOURN-01..06, DOM-RESULT-01..04, VALID-07, VALID-08)

- **D-69 (final ranking + ≥1 match — both mandatory):** Per tournament participation, both a `tournament_results` row (final ranking outcome) AND at least one `match_results` row are required. Server-side validation on `tournament.enterResult` mutation rejects empty `matches[]`. A `tournament_results` row without ≥1 `match_results` row is invalid (enforced atomically in the entry transaction).

- **D-70 (final ranking entered manually):** Player selects from the 9-level `outcome_level` lookup (winnaar / finalist / laatste 4 / laatste 8 / laatste 16 / laatste 32 / laatste 64 / laatste 128 / groepsfase). The final ranking is **not** derived from matches — group-stage finishes and 5th-place outcomes are not derivable from match data; signal too ambiguous.

- **D-71 (player 14d entry/edit window):** Player has 14 days from `tournament.ends_at` to enter AND edit their own results. After 14 days, the player's create/update endpoints return 403 with i18n key `errors.tournament.entryWindowExpired`. Single window — no separate 48h sub-clock.

- **D-72 (all-channel nudging — player-side for missing tournament results):** Same four channels as D-67, scoped to the player whose tournament result is missing. Nudge fires when (player IS a `calendar_event_participants` row on the tournament event) AND (`tournament.ends_at < now() <= ends_at + 14 days`) AND (no `tournament_results` row exists for this `(player_user_id, event_id)`). Once the player enters the atomic `{outcome, matches[]}` package, the nudge clears for that tournament.

- **D-73 (asymmetric backfill — trainer-in-academy + TD anytime):** After the player's 14d wall expires, trainer in the player's academy + TD can still enter/edit results on the player's behalf with no wall. `entered_by` field records attribution (`'player' | 'trainer' | 'td'`); planner may also record `entered_by_user_id` for full traceability. Tournament history stays complete.

- **D-74 (single 14d window for player — no 48h sub-clock — DOM-RESULT-01 SUPERSEDED):** Player can enter AND edit freely until 14 days post-tournament; no separate 48h grace period that flips into TD-approval mode. REQUIREMENTS.md DOM-RESULT-01 superseded — planner must update REQUIREMENTS.md to reflect this.

- **D-75 (TD unconditional overwrite):** TD can create, edit, or overwrite any `tournament_results` or `match_results` row at any time. No approval queue, no proposed-edit workflow. All TD edits hit `audit_log` per GDPR-04.

- **D-76 (no dedicated edit-history table — DOM-RESULT-03 SUPERSEDED):** The `result_edit_history (result_id, edited_by, old_values, new_values, edit_reason, timestamp)` table specified in REQUIREMENTS.md DOM-RESULT-03 is dropped. No user-facing edit-history widget, no mandatory `edit_reason`. **GDPR-04 audit_log JSONB snapshot pattern (Phase 1) still captures every INSERT/UPDATE/DELETE on `tournament_results` + `match_results`** — forensic recovery is preserved at the audit_log layer. REQUIREMENTS.md DOM-RESULT-03 superseded — flag for planner update.

- **D-77 (no status lifecycle — DOM-RESULT-04 SUPERSEDED):** No `status` enum column on `tournament_results`. Every saved row counts in Phase 5 ambition comparison. No draft / confirmed / published state machine. REQUIREMENTS.md DOM-RESULT-04 superseded — flag for planner update.

- **D-78 (academy-wide result visibility):** `tournament_results` + `match_results` visible to: TD (all) + trainers in player's academy + academy_manager of player's academy + parent of subject minor + **players sharing an academy with the subject** (creates internal leaderboard energy). RLS via `tournament_result_visible_to(caller_uid)` SECURITY DEFINER UNION, pattern from Phase 3 D-50.

- **D-79 (TD-only tournament creation AND participant registration):** TD creates tournament events (TOURN-02) AND subscribes players to them via `calendar_event_participants` rows. Trainers and players cannot register participants. Subscribing makes the tournament appear in the player's calendar (Phase 3 RLS gives participant-visibility) and enables the 14d entry window / nudging chain (D-71, D-72). **Distinct from result-entry RBAC (D-73):** TD-only for participant registration, but multi-role for result entry.

- **D-80 (add-row-as-needed match-entry table):** Single screen for entry — final-ranking dropdown (top), match-results table (below) with one pre-seeded row whose `round` is derived from the chosen outcome (e.g., "Finalist" → first row's round = "Finale"). `[+ Wedstrijd toevoegen]` button adds more rows. Single Save commits `{outcome, matches[]}` atomically — guarantees D-69 invariant in one transaction.

- **D-81 (score = set-tally, not set-by-set — TOURN-04 partial supersede):** `match_results.sets_won smallint NOT NULL CHECK (sets_won BETWEEN 0 AND 4)`, `match_results.sets_lost smallint NOT NULL CHECK (sets_lost BETWEEN 0 AND 4)`. Player enters two numbers per match (e.g., `[3] - [2]`). Won/lost is **derived** at query time from `sets_won > sets_lost` — no separate boolean column. TOURN-04's "gewonnen/verloren (toggle)" UI requirement is superseded by derivation (display indicator only, not a separate user input). v2 can add `score_sets jsonb` for detailed set-by-set scores without migrating sets_won/sets_lost.

### C. Recurring-training edit scopes + RRULE polish (deferred from Phase 3)

- **D-82 (occurrence_date on session_participants — Phase 4 schema correction):** Phase 3 D-51's `session_participants(event_id, user_id, quality_score, feedback_text)` sketch is **incomplete for recurring trainings**. Phase 4 ships it with PK `(event_id, occurrence_date, user_id)` so each occurrence of a recurring training has its own attendance/score row. Phase 4 owns this schema (D-51 froze Phase 3 schemas, not Phase 4 operational tables). The trainer marking attendance for "Tuesday 2026-03-15" creates a row stamped with that `occurrence_date` — every datum is permanently bound to a specific historical day. This is a correction to Phase 3 D-51's sketch; planner should call it out in the migration header.

- **D-83 (recurring-edit semantics: past data is immutable):** Editing recurring trainings with ANY scope (single / this-and-future / all-in-series) never touches `session_participants` rows where `occurrence_date < edit_date`. They're historical records bound to actual past sessions. Edits affect only future occurrences. `calendar_event_exceptions` on past `occurrence_date`s preserved (Phase 3 D-54 already implies this).

- **D-84 (all three edit scopes ship in Phase 4):**
  - **"Deze afspraak"** — single-occurrence. Already shipped by Phase 3 D-54 (writes `calendar_event_exceptions` row).
  - **"Deze en toekomstige"** — split-and-rewrite. The old `calendar_events` row gets `rrule.UNTIL = split.date - INTERVAL '1 day'` (truncating its series at the split). A new `calendar_events` row is created: clones of base + extension columns + edits applied; `DTSTART = split.date`; new RRULE continuation. `calendar_event_participants` (series-level) and `session_sparring_partners` (for training_sessions) are **copied** to the new event. `session_participants` rows stay on the old event (past data, immutable per D-83). New event starts with empty `session_participants` and empty exceptions.
  - **"Alle in de reeks"** — update the base `calendar_events` + extension fields in place. Past `session_participants` immutable. If the RRULE itself changes (e.g., Tue → Thu), future `calendar_event_exceptions` whose `occurrence_date` no longer matches the new expansion are kept but become inert (server-side expansion ignores them; planner may decide whether to actively garbage-collect or leave as zombies — Claude's discretion).
  - **UI3-D12** in Phase 3 UI-SPEC already designed the RruleEditor scope picker; Phase 4 wires up backend semantics.
  - Applies to both `training_sessions` (per-occurrence `session_participants` impact) and `meetings` (only series-level participants, no per-occurrence data).

- **D-85 (BYDAY ships in Phase 4, BYMONTHDAY deferred):** RruleEditor adds a multi-day-per-week selector (BYDAY) — supports "Tue + Thu", "Mon + Wed + Fri" training patterns. Most elite training plans need 2–3 sessions per week on specific weekdays; Phase 3's single-day-weekly limitation forced creating multiple parallel series. BYMONTHDAY (monthly-on-the-Nth) remains v2/deferred — rarely needed for trainings.

### D. Rankings (RANK-01..07, DOM-RANK-01, RISK-02 resolved)

- **D-86 (split-column schema for ranking values — RANK-01 amended):**
  ```sql
  CREATE TABLE ranking_entries (
    id uuid PRIMARY KEY,
    player_user_id uuid NOT NULL REFERENCES users(id),
    ranking_type_code text NOT NULL REFERENCES ranking_type(code),
    recorded_at timestamptz NOT NULL,
    source text NOT NULL CHECK (source IN ('manual', 'federation_official')),  -- DOM-RANK-01
    value_numeric numeric NULL,             -- populated for international rankings (positive integer)
    value_classification_code text NULL REFERENCES belgium_classification(code),  -- populated for Belgium
    entered_by uuid NOT NULL REFERENCES users(id),
    entered_at timestamptz NOT NULL DEFAULT now(),
    CHECK (
      (value_numeric IS NOT NULL AND value_classification_code IS NULL)
      OR
      (value_numeric IS NULL AND value_classification_code IS NOT NULL)
    ),
    -- additional check: ranking_type.value_shape must match which column is populated (enforced in trigger or app layer)
  );
  ```
  New lookup table `belgium_classification (code text PK, sort_order int NOT NULL, tier text NOT NULL CHECK (tier IN ('A','B','C','D','E','NC')), active boolean NOT NULL DEFAULT true)`. Seeded with `A1..A50` (overshoot the year-2026 ceiling of ~25 A-ranked players), `B0/B2/B4/B6`, `C0/C2/C4/C6`, `D0/D2/D4/D6`, `E0/E2/E4/E6`, `NC`. Per-tier sort_order: A1=1, A2=2, ... A50=50, B0=51, B2=52, ..., NC=last. `active=false` retires codes without losing FK integrity. RANK-01's "rangwaarde" wording is amended — flag for REQUIREMENTS.md update.

- **D-87 (distinct chart widgets per ranking shape — RANK-07 amended):** Two visually distinct widgets on the player view's Rankings tab:
  - **International rankings widget:** line chart, Y-axis inverted (rank 1 at top), `recharts` or `chart.js` (planner's discretion). Per-type chart with selector (D-88).
  - **Belgium ranking widget:** annual horizontal **timeline strip** — year-by-year tier history (`2022: B0 → 2023: A25 → 2024: A18 → 2025: A12`). Background-color band per tier (A = gold, B = silver, C = bronze, D = grey, E = light grey, NC = white). No interpolation between annual data points. Distinct visual treatment because Belgium is discrete/annual; international rankings are continuous time series.

- **D-88 (per-type chart with selector — international rankings):** One line chart visible at a time on the Rankings tab. Tab/dropdown selector switches between the 4 international ranking types (Senior World / Youth World / Senior European / Youth European). Default = the player's primary ranking type, computed from age category (Senior World for senior players, Youth World for juniors — derived from `age_category_history` and the player's current category). Y-axis inverted (rank 1 at top).

- **D-89 (literal RANK-06 — player + TD for all ranking types, including Belgium):** Player can enter their own rankings; TD can enter for any player; trainer cannot enter rankings. Applies to all 5 ranking types including Belgium classification — trusting the player to self-report accurately. TD can correct as needed. `entered_by` + `entered_at` audit-logged. No special Belgium-TD-only restriction even though Belgium is federation-set.

- **D-90 (24-month default range with range selector):** International rankings chart defaults to last 24 months. Range selector pills: `1m / 6m / 1y / 2y / all`. Captures roughly a full competitive season plus the prior comparison season — sweet spot for spotting trend. Belgium timeline strip shows all-time by default (annual data is typically 3–5 points anyway).

- **D-91 (Rankings tab only in Phase 4 — chart location):** Player view's Rankings tab is the canonical home for ranking visualization. Phase 7 (VIEW-03) builds the cross-domain dashboard mini-widget separately, reusing the same `ranking.getHistory` data path. Clean phase boundary — no preview/teaser chart on the player home in Phase 4.

### Claude's Discretion

- **Exact tRPC router file layout for tournaments + trainings + rankings** — single files (`src/server/trpc/routers/training.ts`, `tournament.ts`, `ranking.ts`) or sub-folder split. Both match Phase 1/2/3 conventions.
- **Migration grouping** — likely 3 migrations (`0014_phase4_session_participants_and_sparring_junction.sql`, `0015_phase4_tournament_results_and_match_results.sql`, `0016_phase4_rankings_and_belgium_classification.sql`) plus a seed migration (`0017_phase4_lookup_seeds.sql` for `outcome_level`, `training_type`, `organisation`, `tournament_type`, `ranking_type`, `belgium_classification`). Planner may group differently as long as each migration rolls back independently per MIG-05.
- **9-level outcome code naming** — follow existing lookup convention from `src/server/db/schema/lookups.ts` (e.g., `outcome_winner`, `outcome_finalist`, `outcome_last_4`, `outcome_last_8`, ... `outcome_last_128`, `outcome_group_stage`). Sort order: 1..9 with 1 = winnaar (best).
- **tegenstander field validation (TOURN-04)** — free text per requirements. Phase 4 keeps it free text; no normalized opponents table in v1.
- **video_link validation (TOURN-04)** — optional URL, Zod `.url()` validator, max length 500 chars; no platform whitelist. v2 may add Cloudflare Stream integration.
- **Age category cross-check (DOM-CAT-02)** — `tournament_results` records `player_age_category_code text` snapshot at entry-time, derived from `age_category_history` using `tournament.starts_at` as the lookup date. Auto-populated by the entry mutation, not user-editable. Phase 2's `deriveAgeCategoryAt(player_id, on_date)` helper extended if not already extant.
- **Inert exception garbage collection** — D-84 leaves "garbage-collect or zombie" as Claude's discretion. Recommendation: leave inert exceptions in place (cheap, defensive against rrule-revert scenarios) and document the predicate in the migration.
- **Chart library choice** — recharts vs chart.js. Both fit; recharts integrates more naturally with React 19 / Tailwind 4 and is shadcn's de-facto chart library. Planner picks.
- **Sparring partner junction FK target** — `session_sparring_partners(event_id uuid, sparring_partner_id uuid)` where `sparring_partner_id` references `users.id` filtered to `users.role = 'sparring_partner'`. Phase 5 will add the dedicated SPAR profile table; FK target unchanged at that point (the profile is separate from the user record).
- **next-intl message keys** — extend `messages/{nl,en,fr}.json` with: `training.*`, `tournament.*`, `ranking.*`, `errors.training.scoreWindowExpired`, `errors.tournament.entryWindowExpired`, `lookup.outcomeLevel.*`, `lookup.rankingType.*`, `lookup.belgiumClassification.*`, `lookup.trainingType.*`, `lookup.organisation.*`, `lookup.tournamentType.*`.

</decisions>

<requirements_supersedes>
## REQUIREMENTS.md Amendments — Planner MUST Update

This discussion has produced several deliberate overrides of the REQUIREMENTS.md baseline. The planner must update REQUIREMENTS.md as part of Phase 4 planning so downstream traceability stays accurate.

| REQ ID | Status after Phase 4 | Reason | Replacement |
|--------|----------------------|--------|-------------|
| DOM-RESULT-01 | **SUPERSEDED** | No 48h sub-clock | D-71 + D-74 (single 14d player window) |
| DOM-RESULT-03 | **SUPERSEDED** | No dedicated edit-history table | D-76 (audit_log is source of truth) |
| DOM-RESULT-04 | **SUPERSEDED** | No draft/confirmed/published lifecycle | D-77 (single saved state) |
| TOURN-04 (gewonnen/verloren toggle) | **PARTIALLY SUPERSEDED** | Toggle becomes a derived display | D-81 (sets_won > sets_lost) |
| TRAIN-04 (structured score) | **AMPLIFIED** | "Structured" specified as 1–10 stored / 5-star rendered | D-60 + D-61 (visibility) |
| RANK-01 (rangwaarde numeric) | **AMENDED** | Belgium ranking is classification-based, not numeric | D-86 (split-column schema) |
| RANK-03 (direction metadata) | **PARTIALLY AMENDED** | Direction concept applies to international; Belgium uses ordinal sort_order | D-86 + D-87 |
| RANK-06 (player can enter own rankings) | **KEPT LITERAL** | Including Belgium classification | D-89 |
| RISK-02 (Belgium ranking direction) | **RESOLVED — but with different model** | Belgium is hierarchical classification, not a single direction question | D-86 + D-87 |
| TOURN-02 + TOURN-05 + DOM-RESULT-02 | **CLARIFIED, NOT CHANGED** | Distinction between participant **registration** (TD only) and result **entry** (player + trainer-in-academy + TD) made explicit | D-79 + D-73 |

</requirements_supersedes>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project-level
- `.planning/PROJECT.md` — Core value, drietalige constraint (nl/en/fr), GDPR-constraints (Art. 9 medical data; Belgian minor consent threshold)
- `.planning/REQUIREMENTS.md` — TRAIN-01..06, TOURN-01..06, RANK-01..07, DOM-RESULT-01..04 (with D-74 / D-76 / D-77 supersedes per `<requirements_supersedes>`), DOM-RANK-01, DOM-CAT-01..02, DOM-MED-CONFLICT-01..02, VALID-07 (unique index on match_results), VALID-08 (idempotency key), GDPR-04 (audit), GDPR-08 (TIMESTAMPTZ UTC), I18N-05..08
- `.planning/ROADMAP.md` — Phase 4 section (lines 325–381) for Doel, 5 Succescriteria, Kerntaken, Risico's (RISK-RRULE-EXCEPTION, RISK-RESULT-GATE, RISK-RANKING-DIRECTION); Phase 7 lines 499–540 for boundary (VIEW-03 dashboard widgets live in Phase 7, not here)
- `.planning/STATE.md` — Project state; RISK-02 to be closed by D-86 + D-87

### Phase 1 carry-forward (built infrastructure)
- `drizzle/0000_initial.sql` — base schema (users, academy_memberships, parent_child_links, lookups taxonomy, audit_log)
- `drizzle/0002_rls_functions_and_policies.sql` — RLS-fundament + SECURITY DEFINER pattern; Phase 4 adds `session_participants_visible_to()`, `tournament_result_visible_to()` following this pattern
- `src/server/trpc/middleware/freshSession.ts` — `protectedProcedure`, `tdProcedure`, `sensitiveProcedure`, `medicalProcedure` presets. Phase 4 adds `trainerOrTdProcedure` (likely already present from Phase 3 per D-48) and reuses these for the new routers
- `src/server/trpc/middleware/audit.ts` — `writeAudit(ctx, entry)`; required on every `tournament_results` + `match_results` + `session_participants` + `ranking_entries` mutation (GDPR-04)
- `src/server/trpc/middleware/rls.ts` — RLS-bound transactions per request; all Phase 4 mutations inherit this
- `src/server/db/schema/audit.ts` — `audit_log` JSONB `meta` column for snapshot pattern (Phase 1 D-58c-style)
- `src/server/db/schema/lookups.ts` — Phase 4 seeds the empty `outcome_level`, `ranking_type`, `training_type`, `organisation`, `tournament_type` tables AND adds the new `belgium_classification` lookup
- `src/lib/i18n-format.ts` — date-fns + nl-BE/en-GB/fr formatters; reused in score capture form (timestamps), match result entry (datum), ranking timeline (year labels)

### Phase 2 carry-forward (built infrastructure)
- `drizzle/0006_phase2_profiles_and_files.sql` — `players`, `trainers`, `age_category_history` schemas. Phase 4 references via FK: `training_sessions.trainer_id`, `tournament_results.player_user_id`, ranking_entries.player_user_id, etc.
- `drizzle/0008_phase2_lookup_seed.sql` — pattern for Phase 4 lookup seed migration (`0017_phase4_lookup_seeds.sql`)
- `src/server/db/schema/players.ts`, `trainers.ts` — FK targets
- Phase 2's `deriveAgeCategory()` helper — Phase 4 extends with `deriveAgeCategoryAt(player_id, on_date)` for D-80's age-category snapshot on tournament results (DOM-CAT-02)
- `src/components/players/` form patterns — react-hook-form + zod resolver; reused for the tournament-result entry form (D-80 add-row-as-needed table) and ranking-entry form

### Phase 3 carry-forward (LOCKED — MUST READ for Phase 4 schema/RLS/UI patterns)
- `.planning/phases/03-kalender/03-CONTEXT.md` §D-47..D-58 — schema scope (especially D-51 schema-handover contract; D-82 here corrects D-51's `session_participants` sketch), RLS pattern, RRULE strategy, conflict-detection, delete semantics
- `.planning/phases/03-kalender/03-UI-SPEC.md` — UI3-D11 event-chip contract (Phase 4 adds yellow ⚠ overlay variant for "needs-scoring" per D-67), UI3-D12 RruleEditor (Phase 4 wires backend for "Deze en toekomstige" + "Alle in de reeks" + BYDAY per D-84/D-85), Filter Bar, Mobile strategy
- `drizzle/0009_phase3_calendar_base_lookup_participants_exceptions.sql` — `calendar_events`, `calendar_event_participants`, `calendar_event_exceptions` schemas (Phase 4 reads these, does not modify)
- `drizzle/0010_phase3_calendar_extension_tables.sql` — `training_sessions`, `tournaments`, `meetings`, `stages`, `eval_conversations`, `medical_appointments` extension tables (Phase 4 reads these, does not modify)
- `drizzle/0011_phase3_calendar_rls_policies.sql` — `calendar_events_visible_to()`, `overlapping_events_for_users()` SECURITY DEFINER; Phase 4 extends RLS with new functions for the new operational tables
- `drizzle/0012_phase3_event_type_seed.sql` — event_type lookup seeded; Phase 4 does NOT add codes per D-51
- `drizzle/0013_phase3_calendar_function_fixes.sql` — RLS function refinements; Phase 4 follows same patterns
- `src/server/db/schema/calendar.ts` — Phase 3 schema definitions (Phase 4 imports the table references)
- `src/server/trpc/routers/calendar.ts` — Phase 3 routers including event create/update/delete; Phase 4 adds `calendar.event.editRecurring({scope: 'single'|'this_and_future'|'all_in_series'})` per D-84

### Phase 3 deferred items now in Phase 4 scope
- "Deze en toekomstige" + "Alle afspraken in de reeks" RRULE-edit scopes (per Phase 3 §Deferred)
- BYDAY pickers in RRULE editor (per Phase 3 §Deferred)

### Stack-specifics
- `rrule` npm package — `https://github.com/jakubroztocil/rrule` — RFC 5545 parser/generator. Phase 4 uses for split-and-rewrite math in `lib/rrule.ts` (`splitRRule(rrule, splitOccurrence)` helper to be added).
- Drizzle ORM relations and transactions — `https://orm.drizzle.team/docs/rqb`, `https://orm.drizzle.team/docs/transactions`
- recharts — `https://recharts.org/en-US/api` — primary chart library for international rankings line chart (D-87, D-88, D-90). Belgium timeline strip is likely a custom component (not a chart).
- PostgreSQL `pg_cron` — `https://github.com/citusdata/pg_cron` — daily nudge job at 18:00 generating in-app inbox messages (D-67 channel 2, D-72 channel 2)
- `next-intl` — `https://next-intl-docs.vercel.app` — extended message catalogs

### GDPR & legal
- `.planning/PITFALLS-ADDITIONS.md` §CRIT-7 (medical access audit pattern, not directly applicable to Phase 4 tables but pattern-relevant)
- Phase 1 D-21..D-30 patterns (rate limit, audit, RLS) — herbruikbaar
- Audit log requirement on every Phase 4 mutation: `tournament_results`, `match_results`, `session_participants`, `ranking_entries`, `session_sparring_partners`, recurring-edit-scope operations

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets (built in Phases 1 + 2 + 3)
- **`src/server/db/schema/audit.ts`** — `audit_log` with JSONB `meta` column; all Phase 4 mutations hang their snapshot here (D-75, D-76 rely on this)
- **`src/server/db/schema/lookups.ts`** — Already declares `outcomeLevel`, `rankingType` (with `direction` column), `trainingType`, `organisation`, `tournamentType` tables — **empty, awaiting Phase 4 seeds**. Phase 4 adds `belgiumClassification` table in the same file.
- **`src/server/db/schema/calendar.ts`** — Phase 3 `calendar_events`, `calendar_event_participants`, `calendar_event_exceptions`, `training_sessions`, `tournaments` table references; Phase 4 imports for FK linkage
- **`src/server/trpc/middleware/*`** — `requireFreshSession`, `requireRole`, `withRlsContext`, `writeAudit` — all Phase 4 routes inherit these
- **`src/lib/rrule.ts`** — Phase 3 `parseRrule(string)` + `expandRrule(rrule, from, to, exceptions[])`. Phase 4 ADDS `splitRRule(rrule, splitOccurrence)` for D-84 "Deze en toekomstige".
- **`src/lib/i18n-format.ts`** — date-fns formatters per locale (nl-BE / en-GB / fr); reused for ranking timeline year labels, score capture timestamps, match datum
- **`src/components/ui/calendar.tsx`** — shadcn date-picker (different from FullCalendar); reused in `<DateTimePicker>` for match `datum` fields
- **`src/components/players/`** — react-hook-form + zod patterns; reused for tournament-result entry form (D-80)
- **`messages/{nl,en,fr}.json`** — Phase 1/2/3 catalog basis; Phase 4 extends with `training.*`, `tournament.*`, `ranking.*`, `errors.*`, `lookup.outcomeLevel.*`, `lookup.belgiumClassification.*`, `lookup.trainingType.*`, `lookup.organisation.*`, `lookup.tournamentType.*`

### Established Patterns
- **Drizzle migratie-discipline**: each new migration has a `_*.rollback.md` companion with `**Risk:** / **Procedure:** / **Verification:**` markers (MIG-05); enforced by `tests/unit/migration-format.test.ts`
- **tRPC router file = one per domain** in `src/server/trpc/routers/<domain>.ts`: Phase 4 adds `training.ts`, `tournament.ts`, `ranking.ts` (Claude's discretion on internal sub-folder split)
- **Zod schemas shared between server (input) and client (form resolver)** in `src/server/trpc/schemas/<domain>.ts`
- **Zod messages = i18n keys** (Phase 2 D-46): `errors.training.scoreWindowExpired`, `errors.tournament.entryWindowExpired`, etc.
- **Server Component for list pages; Client Component for forms + charts**: Rankings tab = Server Component shell with Client Component chart widgets; Tournament result entry form = Client Component (state-heavy)
- **TIMESTAMPTZ everywhere** (GDPR-08); enforced via `tstz()` helper
- **RLS-bound transaction on every tRPC request** (`withRlsContext`); Phase 4 routes inherit
- **Audit-log on every mutation**: create/update/delete on session_participants, tournament_results, match_results, ranking_entries
- **CHECK constraints over enum types** in Drizzle (Phase 1 D-27 pattern); preferred over PostgreSQL ENUM for migration flexibility
- **Idempotency key middleware** (Phase 1 D-23) — applied to `tournament.enterResult` and `ranking.addEntry` per VALID-08

### Integration Points
- **Phase 3 calendar.list integration**: when a training session is rendered as a chip in the calendar, the chip needs a "needs-scoring" overlay state (yellow ⚠) for trainer view per D-67 channel 3. Phase 4 extends Phase 3 UI3-D11 chip variant taxonomy.
- **Phase 3 event detail sheet**: the per-session bulk attendance/score screen (D-62) is reached from the event detail sheet's "Open scoring" button — Phase 4 adds this CTA to the EventDetailSheet for training_session events when caller is the trainer + occurrence is within 14d window.
- **Phase 3 conflict detection**: training session schedule + result-day overlaps with medical events (DOM-MED-CONFLICT-01..02) — Phase 4 wires this in by piggy-backing on Phase 3 `overlapping_events_for_users()`. Trainer marking attendance gets a soft warning if a player has a medical event overlapping the session.
- **Phase 5 schema-handover**: Phase 5 builds SPAR-01..04 (sparring partner profile entity). Phase 4's `session_sparring_partners(event_id, sparring_partner_id)` junction FKs to `users.id` for users with role `sparring_partner`. Phase 5's SPAR profile table is a separate construct (player-profile-like); the junction is unchanged.
- **Phase 5 AMB schema**: Phase 5's `ambitions` table reads from `tournament_results` (D-77: every saved row counts) — schema is ready; no Phase 4 changes needed.
- **Phase 7 dashboard**: VIEW-03 dashboard widgets reuse Phase 4 routers (`training.getStats`, `tournament.getStats`, `ranking.getHistory`). Phase 4 designs the queries with reusability in mind (e.g., `ranking.getHistory(playerUserId, rankingType, from, to)` works for both Rankings tab D-88 and Phase 7 dashboard widget).
- **pg_cron job scheduling**: Phase 1 ships pg_cron infra (if not, Phase 4 must enable it). Phase 4 adds jobs: `daily_trainer_score_nudge` (18:00 daily, generates inbox messages per D-67); `daily_player_tournament_result_nudge` (18:00 daily per D-72). Both write into the inbox message table (Phase 6 ships the inbox; D-67/D-72 use a placeholder table or stub until Phase 6 — planner decides whether nudges are best-effort until Phase 6 or implemented now).
- **CI**: RBAC matrix tests extended — 7 roles × 5 new operational tables × CRUD operations (subset). Result-entry tests cover D-69 atomicity, D-71 14d wall, D-73 asymmetric backfill, D-75 TD overwrite. RRULE-edit tests cover D-84 all three scopes.
- **shadcn components install**: planner verifies `command`, `popover`, `tooltip`, `tabs`, `table` already installed from Phase 2/3; chart library setup if recharts (`npm install recharts`).

### Operational Concerns
- **Inbox dependency**: D-67 channel 2 + D-72 channel 2 require an in-app inbox table to deposit daily messages. Phase 6 (Communicatie) builds the full messaging UI. **Decision for planner:** either ship a thin `system_inbox` table in Phase 4 (just enough for daily nudge messages, replaced/migrated in Phase 6) OR defer the inbox channel until Phase 6 and ship only banner + calendar chip + escalation in Phase 4. The user accepted "all channels" (D-67); if Phase 6 is the canonical inbox owner, planner should propose Phase-4 minimal inbox + Phase-6 integration.
- **Phase 6 cross-dependency**: D-67 + D-72 nudge channels include an inbox message. If Phase 6 isn't yet shipped at Phase 4's go-live, nudges may degrade to banner+calendar+escalation-tone-via-banner without inbox. Planner to surface this in their dependency analysis.

</code_context>

<specifics>
## Specific Ideas

- **"More push the better"** — user explicitly chose maximalist nudging (all 4 channels for D-67 and D-72). The tone of the platform is that scoring/result-entry discipline is enforced through frequent intrusive prompts, not gentle reminders. UI copy should match — "⚠ Je hebt 4 wedstrijden wachtend" not "Je kan nog wedstrijden invoeren".
- **"Same as trainer scores" applied to player tournament results** — user explicitly transferred D-64/D-66/D-67 patterns to D-71/D-72. The 14d-discipline-with-intrusive-nudging shape is a platform-level pattern, not a per-domain choice. Future operational domains (Phase 5 evaluations? Phase 6 communications?) may also adopt it.
- **"No edit logs required"** + **"TD overwrite anytime"** — user wants simplicity over heavyweight workflow. No approval queues, no edit-history widgets, no lifecycle states. The platform trusts the trainer/TD inputs as authoritative; GDPR-04 audit_log is the floor for accountability.
- **Belgium ranking as classification, not number** — user's domain knowledge corrected a fundamental misassumption in REQUIREMENTS.md RANK-01 ("rangwaarde numeric"). The split-column schema (D-86) properly accommodates the hierarchical Belgium tier system AND the numeric international rankings. The annual update cadence (~May) for Belgium informs UI design (distinct timeline widget per D-87) and removes any nudging need for Belgium-ranking entry.
- **Player can self-report Belgium classification** — RANK-06 kept literal; user trusts player honesty over TD-only restriction. The federation publishes Belgium classifications publicly, so a player's self-report is verifiable against a public source if needed. TD can correct any errors.
- **TD trainer-evaluation dashboard is deferred but explicitly desired** — user explicitly named this future feature when committing to D-64 (14d absolute wall). The phase-4 discipline exists to feed that dashboard. Deferred capture means it's not lost; planner should flag it for the next milestone planning cycle.
- **Academy-wide leaderboard energy** — D-78 chose academy-wide visibility for tournament results (peers see each other) over staff-only privacy. The user explicitly chose this orientation: elite training thrives on visible peer competition.

</specifics>

<deferred>
## Deferred Ideas

- **TD trainer-evaluation dashboard** — per-trainer aggregates (avg score given, sessions count, missing-score trend, comparison views, evaluation-feeder graphs). Phase 4 schema is sufficient; this is purely a read-side dashboard build. Target: post-Phase-7 milestone or its own dedicated phase. Likely needs its own UI-SPEC discussion.
- **Detailed set-by-set scores (`match_results.score_sets jsonb`)** — v1 stores set tally (3-2). v2 adds detailed per-set scores when AI video analysis (AI-VIDEO v2 requirement) wants to correlate. Migration-free addition.
- **BYMONTHDAY in RRULE editor** — monthly-on-the-Nth recurrence. Rare for trainings; defer to v2 with the rest of the RRULE polish.
- **Federation ranking sync** — DOM-RANK-01 v1 = manual only. Federation API integration (KBTTB, ETTU, ITTF where API exists) is v2.
- **Detailed Phase 6 inbox integration for nudge channel 2** — depends on Phase 6 sequence; planner may ship minimal `system_inbox` in Phase 4 and migrate in Phase 6, or defer channel 2 until Phase 6.
- **Recurring training participant edits during "Deze en toekomstige" split** — user implicit expectation: split flow allows editing all base fields including participants. If complex, planner may scope-down to "base event fields only" (title, time, location, rrule, trainer) and require a follow-up "manage participants" action.
- **"Right-click context menu"** on calendar chips for quick-actions (mark attendance, view result) — deferred per Phase 3.
- **Per-event-type RBAC fine-grained for academy_manager** — Phase 3 deferred; Phase 4 baseline = academy_manager same scope as Phase 3.
- **Per-user "verberg gedeclineerde events"** toggle, ICS/iCal export, per-user timezone, color customization — all carry-forward deferreds from Phase 3.
- **Sparring partner scoring** (separate from player scoring) — Phase 4 D-63 explicitly excludes. If TD later wants to evaluate sparring-partner effectiveness, that's a future capability.
- **Mandatory `edit_reason`** on tournament-result edits — dropped by D-76; if compliance ever requires it, can be added later with column ALTER and form validation.

</deferred>

---

*Phase: 04-Kerndomein*
*Context gathered: 2026-05-15*
