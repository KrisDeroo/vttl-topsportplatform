# Phase 4: Kerndomein — Research

**Researched:** 2026-05-16
**Domain:** Operational sports management layer (trainings + tournaments + rankings) atop Phase 3's polymorphic calendar; RRULE split-and-rewrite math; per-occurrence attendance/scoring with 14-day discipline walls; atomic tournament-result entry; split-column ranking time series accommodating both numeric international rankings and Belgian hierarchical classifications; pg_cron-driven daily nudging.
**Confidence:** HIGH — research strongly anchored in the locked CONTEXT.md (D-60..D-91), existing Phase 1+2+3 implementation reference (verified via codebase grep), and current package versions (verified via `npm view` 2026-05-16).

---

## Summary

Phase 4 delivers the operational layer that turns Phase 3's polymorphic event scaffold into a daily-use sports management workspace. The work splits into **four sub-domains** that can be built in parallel after the schema migrations land: (1) **trainings module** — `session_participants(event_id, occurrence_date, user_id, quality_score, feedback_text)` per-occurrence row with combined attendance+score capture, a 14-day absolute scoring wall, and all-channel intrusive nudging (banner + daily inbox message + calendar yellow ⚠ chip + escalating tone); (2) **tournaments module** — atomic `{outcome, matches[]}` package entry into `tournament_results` + `match_results` with the same 14-day discipline wall plus asymmetric trainer/TD anytime backfill, academy-wide leaderboard visibility, and TD unconditional overwrite; (3) **rankings module** — split-column `ranking_entries` schema (`value_numeric XOR value_classification_code`) accommodating both numeric international rankings and Belgium's new hierarchical `belgium_classification` lookup (A1..A50, B0..B6, C0..C6, D0..D6, E0..E6, NC), with two distinct chart widgets per ranking shape; (4) **RRULE polish** — closes Phase 3's deferred "Deze en toekomstige" (split-and-rewrite) and "Alle in de reeks" edit scopes, adds BYDAY multi-day support, and extends Phase 3 RLS placeholder for `sparring_partner` role.

The **five hard problems** Phase 4 solves: (a) **RRULE split-and-rewrite math** — using `rrule@2.8.1`'s `origOptions` + `optionsToString()` to truncate the old series' UNTIL and emit a continuation rule with new DTSTART, copying `calendar_event_participants` and `session_sparring_partners` to the new event atomically while leaving `session_participants` (historical) untouched per D-83; (b) **14-day absolute wall enforcement** — pure server-side check in the mutation handler (no middleware preset needed — the check depends on the `event_id` parameter and the underlying `ends_at` value), emitting 403 with i18n key `errors.training.scoreWindowExpired` and writing a denied-outcome `audit_log` row; (c) **atomic tournament-result entry** — single `db.transaction` containing `INSERT tournament_results` + `INSERT match_results` rows, idempotency key gating, GDPR-04 audit snapshot, and CHECK constraint enforcement on set tallies (`sets_won + sets_lost BETWEEN 1 AND 7`); (d) **split-column ranking schema** — DB-level CHECK constraint ensures exactly one of `value_numeric`/`value_classification_code` is non-null; a deferrable trigger cross-checks `ranking_type.value_shape` matches the populated column; (e) **all-channel nudging via pg_cron 18:00 daily job** running on Supabase Pro (UTC-only — schedule at `0 17 * * *` for CET / `0 16 * * *` for CEST, OR schedule both and gate by ISO weekday/date — see Pitfall 2).

The **biggest unknowns**: (a) **Phase 6 inbox dependency for D-67/D-72 channel 2** — Phase 4 must decide whether to ship a thin `system_inbox` table now (replaced/migrated in Phase 6) OR defer channel 2 entirely. Recommendation: **ship a minimal `system_inbox(id, user_id, kind, payload jsonb, read_at, created_at)` table in Phase 4** so the pg_cron job has somewhere to write, with Phase 6 absorbing/migrating it later. (b) **Belgium classification tier band colors** — CONTEXT D-87 specifies "A=gold, B=silver, C=bronze, D=grey, E=light grey, NC=white" but VTTL design system tokens are not yet defined; planner picks Tailwind v4 design tokens consistent with the existing `--cal-event-*` taxonomy. (c) **Per-occurrence attendance race conditions** — two trainers marking attendance for the same `(event_id, occurrence_date, user_id)` resolved by ON CONFLICT DO UPDATE + audit_log capturing the override.

**Primary recommendation:** Three primary schema migrations (`0014_phase4_session_participants_and_sparring_junction.sql`, `0015_phase4_tournament_results_and_match_results.sql`, `0016_phase4_rankings_and_belgium_classification.sql`) + a seed migration (`0017_phase4_lookup_seeds.sql` for outcome_level / belgium_classification / training_type / organisation / tournament_type / ranking_type seeds) + a Phase 3 RLS extension migration (`0018_phase4_rls_sparring_partner_and_phase4_tables.sql` extending `calendar_events_visible_to` with the deferred sparring branch and adding 4 new `*_visible_to` helpers). Three tRPC routers (`training.ts`, `tournament.ts`, `ranking.ts`) + an extension on `calendar.ts` for `editRecurring`. One `splitRRule` helper in `src/lib/rrule.ts`. recharts 3.8.1 for international line chart; pure CSS/Tailwind tier-band component for Belgium timeline. Single pg_cron job per nudge stream (trainer-score + player-tournament-result). **Ship minimal `system_inbox` in Phase 4** — Phase 6 owns the UI.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**A. Quality score model (TRAIN-04):**

- **D-60 (quality_score stored 1–10, rendered 5-star in v1):** `quality_score smallint NULL CHECK (quality_score BETWEEN 1 AND 10)` on `session_participants`. v1 UI = 5-star input; each star writes 2, 4, 6, 8, 10. v2 swap to 1–10 is zero-migration. NULL allowed for marked-present-but-not-yet-scored.

- **D-61 (score visibility):** Write: trainer (own session) + TD. Read: trainer + TD + academy_manager (within player's academy) + player (own row) + parent (own child). Implemented via `session_participants_visible_to(uid, role)` SECURITY DEFINER, pattern mirrors Phase 3 D-50 `calendar_events_visible_to()`.

- **D-62 (single combined attendance + score form):** One screen per session — rows of `[player | attendance toggle | 5-star score | feedback textarea]`. Single Save. `quality_score` + `feedback_text` are nullable. Reachable from EventDetailSheet; submits a single mutation upserting all `session_participants` rows for `(event_id, occurrence_date)`.

- **D-63 (players only scored — sparring partners are not):** `session_participants` only for player users. Sparring partners on `session_sparring_partners` junction (FK to `users.id` where `role='sparring_partner'`) without a score row.

- **D-64 (14-day absolute scoring wall — no TD override):** Trainer's score endpoint accepts only when `now() - calendar_events.ends_at <= INTERVAL '14 days'`. Beyond wall → 403 `errors.training.scoreWindowExpired`. TD has no override. Trade-off: data-quality discipline over flexibility.

- **D-66 (trainer "Te scoren" overview):** Trainer dashboard widget. Query: sessions whose `ends_at < now()` AND `ends_at >= now() - INTERVAL '14 days'` AND `EXISTS (SELECT 1 FROM session_participants WHERE quality_score IS NULL)`, scoped to caller's `training_sessions.trainer_id`. Each row links to per-session bulk screen.

- **D-67 (all-channel intrusive nudges — in-app only):** Four channels:
  1. Persistent non-dismissible banner on trainer home until pending-count = 0.
  2. Daily inbox message at 18:00 (pg_cron).
  3. Yellow ⚠ overlay on past-session calendar chips with at least one NULL score (extends Phase 3 UI3-D11).
  4. Escalating message tone at day 7 / 10 / 12.
  In-app only per `project_no_transactional_email_v1`.

- **D-68 (TD cross-trainer "Te scoren" overview):** TD widget same as D-66 but unfiltered by trainer.

**B. Tournament results (TOURN-01..06, DOM-RESULT-01..04, VALID-07, VALID-08):**

- **D-69 (final ranking + ≥1 match — both mandatory):** Per participation, both `tournament_results` row AND ≥1 `match_results` row required. Atomic `{outcome, matches[]}` package. Empty matches[] → server-side reject.

- **D-70 (final ranking entered manually):** 9-level `outcome_level` lookup (winnaar / finalist / laatste 4 / 8 / 16 / 32 / 64 / 128 / groepsfase). Not derived from matches.

- **D-71 (player 14d entry/edit window):** Player has 14 days from `tournament.ends_at` to enter AND edit own results. After 14 days → 403 `errors.tournament.entryWindowExpired`. Single window.

- **D-72 (all-channel nudging player-side):** Same four channels as D-67. Nudge fires when player IS a `calendar_event_participants` row on tournament event AND `tournament.ends_at < now() <= ends_at + 14 days` AND no `tournament_results` row.

- **D-73 (asymmetric backfill — trainer-in-academy + TD anytime):** After player's 14d wall, trainer in player's academy + TD can enter/edit results on player's behalf with no wall. `entered_by` records `'player' | 'trainer' | 'td'`; also record `entered_by_user_id` for traceability.

- **D-74 (single 14d window for player — DOM-RESULT-01 SUPERSEDED):** No 48h sub-clock. REQUIREMENTS.md DOM-RESULT-01 SUPERSEDED.

- **D-75 (TD unconditional overwrite):** TD can create/edit/overwrite at any time. No approval queue. All TD edits hit audit_log.

- **D-76 (no dedicated edit-history table — DOM-RESULT-03 SUPERSEDED):** `result_edit_history` table dropped. GDPR-04 audit_log JSONB snapshot is forensic recovery path. REQUIREMENTS.md DOM-RESULT-03 SUPERSEDED.

- **D-77 (no status lifecycle — DOM-RESULT-04 SUPERSEDED):** No `status` enum. Every saved row counts in Phase 5 ambition comparison. REQUIREMENTS.md DOM-RESULT-04 SUPERSEDED.

- **D-78 (academy-wide result visibility):** `tournament_results` + `match_results` visible to: TD + trainers in player's academy + academy_manager + parent of subject minor + **players sharing an academy with subject**.

- **D-79 (TD-only tournament creation AND participant registration):** TD creates tournament events (TOURN-02) AND subscribes players via `calendar_event_participants`. Distinct from result-entry RBAC (D-73): TD-only for participant registration, but multi-role for result entry.

- **D-80 (add-row-as-needed match-entry table):** Single screen — final-ranking dropdown (top), match-results table (below) with one pre-seeded row whose `round` is derived from outcome ("Finalist" → "Finale"). `[+ Wedstrijd toevoegen]` button. Single Save commits `{outcome, matches[]}` atomically.

- **D-81 (score = set-tally, not set-by-set — TOURN-04 partial SUPERSEDED):** `match_results.sets_won smallint NOT NULL CHECK (sets_won BETWEEN 0 AND 4)`, `sets_lost smallint NOT NULL CHECK (sets_lost BETWEEN 0 AND 4)`. Won/lost derived at query time from `sets_won > sets_lost`.

**C. Recurring-training edit scopes + RRULE polish (deferred from Phase 3):**

- **D-82 (occurrence_date on session_participants — Phase 4 correction):** PK `(event_id, occurrence_date, user_id)`. Each occurrence of recurring training has its own attendance/score row. Phase 4 owns this schema (corrects Phase 3 D-51's sketch).

- **D-83 (recurring-edit: past data immutable):** Edits never touch `session_participants` where `occurrence_date < edit_date`. `calendar_event_exceptions` on past `occurrence_date`s preserved.

- **D-84 (all three edit scopes ship in Phase 4):**
  - **"Deze afspraak"** — already shipped Phase 3 D-54.
  - **"Deze en toekomstige"** — split-and-rewrite: old `calendar_events` gets `rrule.UNTIL = split.date - 1 day`. New `calendar_events` row created with edits applied; `DTSTART = split.date`. `calendar_event_participants` (series-level) + `session_sparring_partners` copied. `session_participants` rows stay on old event.
  - **"Alle in de reeks"** — update base `calendar_events` + extension fields in place. Past `session_participants` immutable. Future `calendar_event_exceptions` whose `occurrence_date` no longer matches new expansion kept but become inert.
  - Applies to `training_sessions` AND `meetings`.

- **D-85 (BYDAY ships, BYMONTHDAY deferred):** RruleEditor multi-day-per-week selector. BYDAY+FREQ=WEEKLY only. BYMONTHDAY remains v2.

**D. Rankings (RANK-01..07, DOM-RANK-01, RISK-02 resolved):**

- **D-86 (split-column schema — RANK-01 AMENDED):** `ranking_entries (id, player_user_id, ranking_type_code, recorded_at, source, value_numeric NULL, value_classification_code NULL, entered_by, entered_at)` with CHECK XOR constraint. New `belgium_classification (code PK, sort_order, tier, active)` lookup. Seeded with A1..A50, B0/B2/B4/B6, C0/C2/C4/C6, D0/D2/D4/D6, E0/E2/E4/E6, NC.

- **D-87 (distinct chart widgets per ranking shape — RANK-07 AMENDED):** International rankings: line chart with inverted Y-axis. Belgium ranking: annual horizontal timeline strip with tier-color bands (A=gold, B=silver, C=bronze, D=grey, E=light grey, NC=white).

- **D-88 (per-type chart with selector — international):** One line chart visible at a time. Tab/dropdown switches between 4 international types. Default = player's primary type computed from age category.

- **D-89 (literal RANK-06 — player + TD for all types including Belgium):** Player enters own rankings; TD enters for any player; trainer cannot enter. Applies to all 5 ranking types. `entered_by` + `entered_at` audit-logged.

- **D-90 (24-month default + range selector):** International chart defaults to last 24 months. Pills: 1m / 6m / 1y / 2y / all. Belgium timeline shows all-time by default.

- **D-91 (Rankings tab only in Phase 4):** Player view's Rankings tab is canonical home. Phase 7 builds dashboard mini-widget reusing same `ranking.getHistory` data path.

### Claude's Discretion

- Exact tRPC router file layout for tournaments + trainings + rankings — single files (`training.ts`, `tournament.ts`, `ranking.ts`) or sub-folder split. Recommend: single files (matches Phase 1/2/3 conventions and current calendar.ts shape).
- Migration grouping — 3+1+1 (data migrations + seed + RLS extension) per recommendation above. Planner may group differently as long as each migration rolls back independently per MIG-05.
- 9-level outcome code naming — follows existing lookup convention from `src/server/db/schema/lookups.ts`: `outcome_winner`, `outcome_finalist`, `outcome_last_4`, ... `outcome_last_128`, `outcome_group_stage`. Sort order: 1=winnaar (best) → 9=groepsfase.
- `tegenstander` field validation (TOURN-04) — free text; no normalized opponents table in v1.
- `video_link` validation (TOURN-04) — optional URL, Zod `.url()`, max 500 chars; no platform whitelist.
- Age category cross-check (DOM-CAT-02) — `tournament_results.player_age_category_code text` snapshot at entry-time via `getAgeCategoryAt(player_id, tournament.starts_at)` (Phase 2 helper, already extant — see Code Examples §3). Phase 4 does NOT extend the helper.
- Inert exception garbage collection — leave inert exceptions in place (cheap, defensive against rrule-revert scenarios).
- Chart library choice — **recharts 3.8.1** (verified). Integrates naturally with React 19 / Tailwind 4 and is shadcn's de-facto chart library.
- Sparring partner junction FK target — `session_sparring_partners(event_id, sparring_partner_id)` where `sparring_partner_id` references `users.id` filtered to `users.role = 'sparring_partner'`. Phase 5's SPAR profile table is separate.
- next-intl message keys — extend `messages/{nl,en,fr}.json` with: `training.*`, `tournament.*`, `ranking.*`, `errors.training.scoreWindowExpired`, `errors.tournament.entryWindowExpired`, `lookup.outcomeLevel.*`, `lookup.rankingType.*`, `lookup.belgiumClassification.*`, `lookup.trainingType.*`, `lookup.organisation.*`, `lookup.tournamentType.*`. See "Multilingual catalog extensions" §below for chunking strategy.

### Deferred Ideas (OUT OF SCOPE)

- TD trainer-evaluation dashboard — per-trainer aggregates, comparison charts, missing-score trend. Phase 4 schema sufficient; deferred to post-Phase-7.
- Detailed set-by-set scores (`match_results.score_sets jsonb`) — v2 with AI video analysis correlation.
- BYMONTHDAY in RRULE editor — v2.
- Federation ranking sync (DOM-RANK-01) — v1 manual only; v2 KBTTB/ETTU/ITTF API.
- Detailed Phase 6 inbox integration for nudge channel 2 — planner may ship minimal `system_inbox` now (recommended) or defer entirely.
- Recurring training participant edits during "Deze en toekomstige" split — if complex, scope-down to base event fields only.
- Right-click context menu on calendar chips for quick-actions.
- Per-event-type RBAC fine-grained for academy_manager — Phase 4 baseline = academy_manager same scope as Phase 3.
- Per-user "verberg gedeclineerde events" toggle, ICS export, per-user timezone, color customization.
- Sparring partner scoring (separate from player scoring) — Phase 4 D-63 excludes.
- Mandatory `edit_reason` on tournament-result edits — dropped by D-76.

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TRAIN-01 | Training session fields: datum, starttijd, duur, type, organisation, trainer, locatie | Phase 3 `training_sessions` schema already covers (D-47); Phase 4 uses as FK target. No schema change. |
| TRAIN-02 | Creatable by: TD, trainer, player | Already enforced by Phase 3 `calendarCreate.ts` middleware D-48; Phase 4 does NOT loosen. |
| TRAIN-03 | RRULE-based recurring; individual occurrences cancellable/modifiable | Phase 4 D-84 adds "Deze en toekomstige" + "Alle in de reeks" scopes; Phase 3 already shipped "Deze afspraak". |
| TRAIN-04 | Participation entity: quality score + feedback per player | Phase 4 D-60+D-82 — `session_participants(event_id, occurrence_date, user_id, quality_score, feedback_text)`. |
| TRAIN-05 | Attendance tracking per session | Combined into D-62 single form with score; D-82 uses occurrence_date for per-occurrence rows. |
| TRAIN-06 | Sparring partners linked via junction (SPAR-02) | Phase 4 D-63 — `session_sparring_partners(event_id, sparring_partner_id)` junction. FK to `users.id` where `role='sparring_partner'`. Extends Phase 3 RLS UNION. |
| TOURN-01 | Tournament record fields | Phase 3 `tournaments` extension table covers; Phase 4 unchanged. |
| TOURN-02 | TD-only creation | Phase 3 `calendarCreate.ts` already enforces; D-79 reaffirms. |
| TOURN-03 | 9-level outcome lookup | Phase 4 D-70 — seed `outcome_level` table with 9 codes via 0017 migration. |
| TOURN-04 | Per-match result entity | Phase 4 D-80 + D-81 — `match_results` with set-tally (sets_won/sets_lost), opponent free text, optional video URL. TOURN-04's gewonnen/verloren toggle SUPERSEDED by derivation. |
| TOURN-05 | Player + trainer (in player's academy) + TD entry | Phase 4 D-73 + D-79 distinguishes registration (TD-only) from result entry (multi-role). |
| TOURN-06 | Browsable history, dual-level query | `tournament.list` + `tournament.get` procedures with pagination via cursor/offset (recommend cursor based on `tournaments.event_id` to match Phase 7 needs). |
| RANK-01 | Time-series schema | Phase 4 D-86 AMENDED — split-column `ranking_entries`. |
| RANK-02 | 5 ranking types | Seeded in 0017: `ranking_senior_world`, `ranking_youth_world`, `ranking_senior_european`, `ranking_youth_european`, `ranking_belgium`. |
| RANK-03 | Direction metadata per type | `ranking_type.direction` already on table (`asc_is_better` / `desc_is_better`). Phase 4 D-86 supplements with `ranking_type.value_shape` (`numeric` / `classification`). |
| RANK-04 | Parallel series per player | `ranking_entries (player_user_id, ranking_type_code, recorded_at)` composite index — natural. |
| RANK-05 | Current = latest entry, never flat field | `ranking.getCurrentByType` procedure: `SELECT ... ORDER BY recorded_at DESC LIMIT 1`. |
| RANK-06 | Player or TD only | Phase 4 D-89 — `ranking.addEntry` enforces via `requireRole('technical_director', 'player')` + RLS WHERE `entered_by = caller.id OR caller.role = 'td'`. |
| RANK-07 | Line chart per type | Phase 4 D-87 AMENDED — two widgets: line chart (international) + tier-band timeline (Belgium). |
| DOM-RESULT-01 | Player edit own results within 48h | **SUPERSEDED by D-74** — single 14d window, no 48h sub-clock. Planner MUST update REQUIREMENTS.md. |
| DOM-RESULT-02 | Trainer + TD can enter on player's behalf | Phase 4 D-73 — confirmed via `entered_by` attribution. |
| DOM-RESULT-03 | Edit history table | **SUPERSEDED by D-76** — no dedicated table; audit_log JSONB is forensic recovery. Planner MUST update REQUIREMENTS.md. |
| DOM-RESULT-04 | draft/confirmed/published lifecycle | **SUPERSEDED by D-77** — every saved row counts. Planner MUST update REQUIREMENTS.md. |
| DOM-RANK-01 | `source` column 'manual'/'federation_official' | Phase 4 D-86 schema confirms; v1 = manual only. |
| DOM-CAT-02 | Tournament category validation uses player's category as of tournament start date | Phase 4 D-80 — `tournament_results.player_age_category_code` snapshot via `getAgeCategoryAt(player_user_id, tournament.starts_at)`. |
| DOM-MED-CONFLICT-01 | Training-session create warns on overlapping medical events | Phase 4 piggy-backs on Phase 3 `overlapping_events_for_users()` — already shipped. UI surface: form-time check via `calendar.event.detectConflicts`. |
| DOM-MED-CONFLICT-02 | Attendance defaults to "afwezig met geldige reden" on medical overlap | App-layer default in the bulk-attendance form: server returns conflict-flagged participants in the bulk form payload; UI pre-selects "absent with valid reason" but trainer can override. Not a DB default. |
| VALID-07 | Unique constraints on duplicate writes | `match_results`: UNIQUE(tournament_event_id, player_user_id, round_code, opponent_name, match_date). `session_participants`: composite PK already prevents duplicates. |
| VALID-08 | Idempotency keys on POST | `tournament.enterResult` + `ranking.addEntry` use existing `idempotency_keys` table (Phase 1 D-23). Need to wire middleware — see Pitfall 5. |
| GDPR-04 | audit_log on every mutation | Every Phase 4 mutation calls `writeAudit()` with action verb + resource snapshot. |
| GDPR-08 | TIMESTAMPTZ UTC | All new TIMESTAMPTZ columns use `tstz()` helper. |
| I18N-05 | Lookup codes language-neutral | All Phase 4 lookups follow code-only PK pattern (no display columns). |
| I18N-06 | Proper nouns not translated | tournament_results.opponent_name free text — stored as written, no translation. |
| I18N-07 | Date/number formatting via Intl/date-fns | Reuse `formatDate()` from `src/lib/i18n-format.ts`. |
| I18N-08 | Zod validation messages as i18n keys | All new schemas in `src/server/trpc/schemas/training.ts`, `tournament.ts`, `ranking.ts` use `errors.*.<key>` patterns. |

</phase_requirements>

## Project Constraints (from CLAUDE.md)

- **Next.js 15 App Router + React 19** — Server Components default; Client Components only for forms + charts.
- **tRPC 11.x** end-to-end type safety with Zod input validation.
- **Drizzle ORM 0.45** + Drizzle Kit for migrations. Each migration has `_*.rollback.md` companion (MIG-05).
- **PostgreSQL 16** with RLS enabled on every new table.
- **Server Components by default** — chart widgets and forms are Client Components only at the leaf.
- **GDPR Art. 9 + Belgian minor consent** — Phase 4 does NOT touch medical schema; medical metadata visible via Phase 3 `medical_appointments` extension only.
- **Three-language UI** — nl (default), en, fr. All user-facing strings via next-intl message catalogs.
- **Audit log on every mutation** — `writeAudit(ctx, {action, resourceType, resourceId, oldValues, newValues})`.
- **TIMESTAMPTZ everywhere** (GDPR-08). Enforced via `tstz()` helper.
- **CHECK constraints over enum types** (Phase 1 D-27).
- **RLS-bound transaction on every tRPC request** via `withRlsContext` middleware.
- **Lookup codes language-neutral**, labels via `messages/{nl,en,fr}.json` under `lookup.<table>.<code>`.
- **EU data residency** — Supabase Pro Frankfurt, Hetzner, Resend EU. Phase 4 changes nothing here.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| RRULE split-and-rewrite math (D-84) | API / Backend | — | Pure server-side rrule manipulation; client should never expand RRULE per Phase 3 D-53. |
| BYDAY multi-day selector (D-85) | Browser / Client | API / Backend | UI is a Client Component (RruleEditor extension); server validates BYDAY+FREQ=WEEKLY constraint. |
| 14-day discipline walls (D-64, D-71) | API / Backend | — | Server-only — `now() - ends_at <= INTERVAL '14 days'` check in mutation handler. Client may render disabled state, but the wall is non-bypassable at the API. |
| Combined attendance + score capture (D-62) | API / Backend | Browser / Client | Server: single mutation upserts all rows in tx. Client: form is a Client Component. |
| Atomic `{outcome, matches[]}` entry (D-69+D-80) | API / Backend | — | `db.transaction(...)` wraps inserts. Client cannot guarantee atomicity. |
| All-channel nudging (D-67, D-72) | Database (pg_cron) | API + Browser | pg_cron writes inbox rows nightly; API serves banner counts; client renders banner/chip. |
| Split-column ranking schema (D-86) | Database | API / Backend | CHECK constraint + trigger at DB layer; API enforces via Zod discriminated union. |
| International ranking line chart (D-87) | Browser / Client | API / Backend | recharts Client Component; server provides `ranking.getHistory` data. |
| Belgium tier-band timeline (D-87) | Browser / Client | — | Pure CSS/Tailwind component; no chart library needed. |
| Academy-wide RLS visibility (D-78) | Database | — | SECURITY DEFINER helper `tournament_result_visible_to(uid, role)` with UNION branches. |
| Asymmetric backfill RBAC (D-73) | API / Backend | Database | Server-side procedure check; RLS as defense-in-depth. |
| Audit log on every mutation (GDPR-04) | API / Backend | — | `writeAudit()` called from each handler. |
| Calendar chip yellow ⚠ overlay (D-67 channel 3) | API / Backend | Browser / Client | Server: `calendar.list` returns `needsScoring: boolean` hint per instance. Client: chip renders overlay. |
| Idempotency keys (VALID-08) | API / Backend | Database | Middleware wraps mutations; `idempotency_keys` table from Phase 1. |

---

## Phase 3 Carry-Forward (LOCKED Inputs)

| Artifact | Role in Phase 4 |
|----------|-----------------|
| `drizzle/0009_phase3_calendar_base_lookup_participants_exceptions.sql` | `calendar_events`, `calendar_event_participants`, `calendar_event_exceptions` — Phase 4 reads only; no modifications. |
| `drizzle/0010_phase3_calendar_extension_tables.sql` | `training_sessions`, `tournaments`, `meetings` — Phase 4 reads only. `training_sessions.trainer_id` is FK target. `tournaments.age_category_code` is FK target. |
| `drizzle/0011_phase3_calendar_rls_policies.sql` | `calendar_events_visible_to(uid, role)` SECURITY DEFINER. **Phase 4 EXTENDS** this function to add the deferred `sparring_partner` UNION branch (Phase 3 left as no-op per line 140-145). |
| `drizzle/0013_phase3_calendar_function_fixes.sql` | `overlapping_events_for_users(uuid[], tstzrange[])` — Phase 4 reuses for DOM-MED-CONFLICT-01 wiring; no signature changes. |
| `src/server/db/schema/calendar.ts` | Drizzle definitions for Phase 3 tables — Phase 4 imports table refs for FKs. |
| `src/server/trpc/routers/calendar.ts` | Existing 9 procedures. Phase 4 ADDS one: `calendar.event.editRecurring({eventId, scope: 'single'|'this_and_future'|'all_in_series', ...edits})`. Phase 3 `event.update` keeps single-occurrence flow (D-54 `cancelOccurrence` covers "Deze afspraak"). |
| `src/lib/rrule.ts` | `parseRrule`, `expandRrule`, `ensureHorizon`, `validateHorizon`, `formatOccurrenceDate`. **Phase 4 ADDS** `splitRRule(rrule, splitDate, dtstart)` for D-84 split-and-rewrite. |
| `src/server/trpc/middleware/freshSession.ts` | Procedure presets: `protectedProcedure`, `tdProcedure`, `sensitiveProcedure`. Phase 4 may ADD `trainerOrTdProcedure` (compose `requireRole('trainer', 'technical_director')`). |
| `src/server/trpc/middleware/audit.ts` | `writeAudit()` helper. Phase 4 calls on every mutation. |
| `src/server/trpc/middleware/rls.ts` | `withRlsContext` — opens RLS-bound tx. Phase 4 routes inherit. |
| `src/server/trpc/middleware/calendarCreate.ts` | `canCreateEventType(role, typeCode)` — Phase 4 reuses inside `calendar.event.editRecurring` to verify scope. |
| `src/server/db/schema/idempotency.ts` | `idempotency_keys` table — Phase 4 reuses for VALID-08. **Note:** no idempotency middleware exists yet (see Pitfall 5). |
| `src/server/db/schema/audit.ts` | `audit_log` with JSONB `oldValues`/`newValues` columns. |
| `src/server/db/schema/lookups.ts` | `outcomeLevel`, `rankingType`, `trainingType`, `organisation`, `tournamentType` tables — Phase 4 SEEDS via 0017 migration. **Adds** `belgiumClassification`. |
| `src/lib/i18n-format.ts` | `formatDate()`, `formatNumber()` — Phase 4 reuses for ranking timeline year labels. |
| `src/lib/players.ts` | `deriveAgeCategory()`, `getAgeCategoryAt(playerId, date)` — Phase 4 reuses `getAgeCategoryAt` for DOM-CAT-02 tournament-result snapshot. **Helper already exists** (verified `src/lib/players.ts:97`); Phase 4 does NOT extend. |
| `messages/{nl,en,fr}.json` | Phase 4 extends with `training.*`, `tournament.*`, `ranking.*`, `errors.training.*`, `errors.tournament.*`, `lookup.outcomeLevel.*`, `lookup.belgiumClassification.*`, etc. |

---

## Standard Stack

### Core (already installed)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `rrule` | `^2.8.1` [VERIFIED: npm registry 2026-05-16] | RRULE parse + expand + split | Single source for RFC 5545; pure TypeScript; MIT. Already used Phase 3. |
| `drizzle-orm` | `^0.45` [VERIFIED: package.json] | DB schema + transactions | Phase 1/2/3 standard; type-safe queries. |
| `@trpc/server` | `^11` [VERIFIED: package.json] | tRPC router for new procedures | Phase 1/2/3 standard. |
| `zod` | `^4.4.3` [VERIFIED: package.json] | Input validation | Phase 1/2/3 standard; Zod v4 is current. |
| `react-hook-form` | `^7.75.0` [VERIFIED: package.json] | Forms (attendance, match-result, ranking entry) | Phase 2 form pattern. |
| `@hookform/resolvers` | `^5.2.2` [VERIFIED: package.json] | Zod resolver bridge | Phase 2 pattern. |
| `next-intl` | `^4.11` [VERIFIED: package.json] | i18n catalogs | Phase 1 standard. |
| `date-fns` | `^4.1.0` [VERIFIED: package.json] | Date math + formatting | Phase 1 standard. |

### Phase 4 additions
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `recharts` | `^3.8.1` [VERIFIED: npm view 2026-05-16] | International ranking line chart (D-87, D-88, D-90) | shadcn's de-facto chart library; integrates cleanly with React 19; has `<YAxis reversed />` prop confirmed [CITED: recharts.github.io/en-US/api/YAxis/]. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| recharts | chart.js + react-chartjs-2 | chart.js is performant for very large datasets but ecosystem is more imperative (canvas-based) and less aligned with shadcn idioms. recharts wins for declarative React. |
| recharts (Belgium timeline) | Pure CSS/Tailwind component | **Use this for Belgium timeline** — annual data (3–5 points), tier-band coloring is just a styled `<div>` row. No chart machinery needed. |
| Custom RRULE split | Re-roll via string manipulation | Rejected — direct string concat is Pitfall 8 from Phase 3. Always use `RRule.optionsToString()`. |
| pg_cron | BullMQ recurring job | pg_cron is preferred because (a) it runs at the DB layer (no application uptime dependency), (b) Phase 1 already uses BullMQ for async work but recurring schedules belong in pg_cron per `docs/file-upload-pipeline.md` §Phase 8 cron sweeps. |

**Installation:**
```bash
pnpm add recharts
# rrule already installed (Phase 3)
```

**Version verification (`npm view` 2026-05-16):**
- `rrule@2.8.1` — published 2023-11-10. Stable. No newer major. Used safely in Phase 3.
- `recharts@3.8.1` — current latest. Compatible with React 19. `<YAxis reversed />` prop documented.

---

## Architecture Patterns

### System Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│ Browser / Client (Client Components only at leaf)                │
│ ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐  │
│ │ BulkAttendance   │ │ TournamentResult │ │ RankingsTab      │  │
│ │ Form (D-62)      │ │ EntryForm (D-80) │ │  ↳ LineChart     │  │
│ │ react-hook-form  │ │ react-hook-form  │ │    (recharts)    │  │
│ │ + zod resolver   │ │ + zod resolver   │ │  ↳ BelgiumTimeline│  │
│ │                  │ │ (atomic submit)  │ │    (pure CSS)    │  │
│ └────────┬─────────┘ └────────┬─────────┘ └────────┬─────────┘  │
│ ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐  │
│ │ TrainerDashboard │ │ EventDetailSheet │ │ RruleEditor      │  │
│ │ "Te scoren" widget│ │ + "Open scoring" │ │ + BYDAY checkboxes│ │
│ │ (D-66/D-68)      │ │ CTA (Phase 3 ext)│ │ (D-85)           │  │
│ │ + non-dismissible│ │                  │ │ + scope picker   │  │
│ │ banner (D-67 ch1)│ │                  │ │ (D-84)           │  │
│ └────────┬─────────┘ └────────┬─────────┘ └────────┬─────────┘  │
└──────────┼──────────────────────┼─────────────────────┼─────────┘
           │                      │                     │ tRPC over HTTP
┌──────────▼──────────────────────▼─────────────────────▼─────────┐
│ Next.js Server (App Router) + tRPC                              │
│ ┌────────────────────────────────────────────────────────────┐  │
│ │ Middleware Chain (per request)                             │  │
│ │ requireAuth → withRlsContext → requireCurrentConsent       │  │
│ │   → idempotency (NEW — see Pitfall 5)                      │  │
│ │   → requireRole / freshSession                              │  │
│ └────────────────────────────────────────────────────────────┘  │
│ ┌────────────────────────────────────────────────────────────┐  │
│ │ training.* router                                          │  │
│ │  ├─ markAttendanceAndScore(eventId, occurrenceDate,        │  │
│ │  │   participants[{userId, attended, qualityScore,         │  │
│ │  │   feedbackText}])  → 14d wall check → tx upsert + audit │  │
│ │  ├─ listPending(role: 'trainer'|'td') → "Te scoren"        │  │
│ │  │   widget query (D-66, D-68)                             │  │
│ │  └─ getSession(eventId, occurrenceDate) → form preload     │  │
│ └────────────────────────────────────────────────────────────┘  │
│ ┌────────────────────────────────────────────────────────────┐  │
│ │ tournament.* router                                        │  │
│ │  ├─ enterResult(eventId, outcome, matches[],               │  │
│ │  │   _meta:{idempotencyKey, force}) → tx tournament_results│  │
│ │  │   + match_results + audit                               │  │
│ │  ├─ listResults(playerId, range) → academy-wide visibility │  │
│ │  └─ listPendingForPlayer(playerId) → "Toernooi te scoren"  │  │
│ │      (D-72 widget)                                         │  │
│ └────────────────────────────────────────────────────────────┘  │
│ ┌────────────────────────────────────────────────────────────┐  │
│ │ ranking.* router                                           │  │
│ │  ├─ addEntry({playerUserId, rankingTypeCode, recordedAt,   │  │
│ │  │   value: {numeric|classificationCode}}) → tx + audit    │  │
│ │  ├─ getHistory(playerId, rankingType, from, to)             │  │
│ │  └─ getCurrentByType(playerId, rankingType)                │  │
│ └────────────────────────────────────────────────────────────┘  │
│ ┌────────────────────────────────────────────────────────────┐  │
│ │ calendar.* router (Phase 3 — extended)                     │  │
│ │  └─ event.editRecurring(eventId, scope, edits)              │  │
│ │     → 'this_and_future' calls splitRRule()                  │  │
│ │     → 'all_in_series' updates base+extension in place      │  │
│ │     → 'single' delegates to existing exception flow        │  │
│ └────────────────────────────────────────────────────────────┘  │
│ ┌────────────────────────────────────────────────────────────┐  │
│ │ src/lib/rrule.ts (extended)                                │  │
│ │  └─ splitRRule(rrule, splitDate, dtstart) →                │  │
│ │     {oldRrule: string, newRrule: string, newDtstart: Date} │  │
│ └────────────────────────────────────────────────────────────┘  │
└────────────────────┬─────────────────────────────────────────────┘
                     │  RLS-bound transactions (app.user_id GUC)
┌────────────────────▼─────────────────────────────────────────────┐
│ PostgreSQL 16 (Supabase Pro Frankfurt)                          │
│                                                                  │
│ Phase 4 new tables:                                              │
│  session_participants (event_id, occurrence_date, user_id, ...) │
│  session_sparring_partners (event_id, sparring_partner_id)      │
│  tournament_results (event_id, player_user_id, outcome_level, ...)│
│  match_results (id, tournament_event_id, player_user_id, ...)   │
│  ranking_entries (id, player_user_id, ranking_type_code, ...,   │
│                   value_numeric XOR value_classification_code)  │
│  belgium_classification (code, sort_order, tier, active) lookup │
│  system_inbox (id, user_id, kind, payload, read_at, created_at) │
│                                                                  │
│ Phase 4 new RLS helpers (SECURITY DEFINER):                      │
│  session_participants_visible_to(uid, role)                      │
│  tournament_result_visible_to(uid, role)                         │
│  ranking_entry_visible_to(uid, role)                             │
│  + EXTEND calendar_events_visible_to() with sparring_partner     │
│    UNION branch (filling Phase 3 placeholder line 140-145)       │
│                                                                  │
│ Phase 4 pg_cron jobs:                                            │
│  daily_trainer_score_nudge  (17:00 UTC / 16:00 UTC in summer)   │
│  daily_player_tournament_result_nudge (same schedule)            │
│  ↳ both write into system_inbox + recompute banner counts        │
└──────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Path | Role | Phase |
|-----------|------|------|-------|
| `splitRRule()` | `src/lib/rrule.ts` | RRULE split-and-rewrite math (D-84) | Phase 4 ADD |
| `training` router | `src/server/trpc/routers/training.ts` | 3 procedures: markAttendanceAndScore / listPending / getSession | Phase 4 NEW |
| `tournament` router | `src/server/trpc/routers/tournament.ts` | 3 procedures: enterResult / listResults / listPendingForPlayer | Phase 4 NEW |
| `ranking` router | `src/server/trpc/routers/ranking.ts` | 3 procedures: addEntry / getHistory / getCurrentByType | Phase 4 NEW |
| `calendar.event.editRecurring` | `src/server/trpc/routers/calendar.ts` | Add one procedure for D-84 scope handling | Phase 4 EXTEND |
| `system_inbox` table | `src/server/db/schema/inbox.ts` | Receive daily nudge messages (Phase 6 owns UI) | Phase 4 NEW (minimal) |
| `idempotency middleware` | `src/server/trpc/middleware/idempotency.ts` | Wire VALID-08 — Phase 1 left table; no middleware yet | Phase 4 NEW |
| `BulkAttendanceForm` | `src/components/training/bulk-attendance-form.tsx` | Combined attendance + score form (D-62) | Phase 4 NEW |
| `TournamentResultEntryForm` | `src/components/tournament/result-entry-form.tsx` | `{outcome, matches[]}` atomic form (D-80) | Phase 4 NEW |
| `RankingChart` | `src/components/ranking/ranking-chart.tsx` | recharts line chart (D-87 international) | Phase 4 NEW |
| `BelgiumTimelineStrip` | `src/components/ranking/belgium-timeline-strip.tsx` | Pure CSS tier-band timeline (D-87 Belgium) | Phase 4 NEW |
| `TrainerDashboardScoring` | `src/components/training/trainer-dashboard-scoring.tsx` | Trainer "Te scoren" widget + banner (D-66, D-67 ch1) | Phase 4 NEW |
| `RruleEditor` (extend) | `src/components/common/rrule-editor.tsx` | BYDAY multi-day checkbox (D-85) + scope picker for edit (D-84) | Phase 4 EXTEND (file exists per UI3-D12) |

### Recommended Project Structure
```
src/
├── lib/
│   ├── rrule.ts                    # EXTEND: add splitRRule()
│   └── i18n-format.ts              # REUSE
├── server/
│   ├── db/schema/
│   │   ├── training.ts             # NEW: session_participants, session_sparring_partners
│   │   ├── tournament.ts           # NEW: tournament_results, match_results
│   │   ├── ranking.ts              # NEW: ranking_entries
│   │   ├── inbox.ts                # NEW: system_inbox (minimal — Phase 6 absorbs)
│   │   └── lookups.ts              # EXTEND: belgiumClassification, value_shape on rankingType
│   └── trpc/
│       ├── routers/
│       │   ├── training.ts         # NEW
│       │   ├── tournament.ts       # NEW
│       │   ├── ranking.ts          # NEW
│       │   └── calendar.ts         # EXTEND: add event.editRecurring
│       ├── schemas/
│       │   ├── training.ts         # NEW: Zod input schemas
│       │   ├── tournament.ts       # NEW
│       │   └── ranking.ts          # NEW
│       └── middleware/
│           ├── idempotency.ts      # NEW: wire VALID-08
│           └── scoreWindow.ts      # NEW: optional helper for D-64/D-71 wall
├── components/
│   ├── training/
│   │   ├── bulk-attendance-form.tsx
│   │   ├── trainer-dashboard-scoring.tsx
│   │   └── score-window-banner.tsx
│   ├── tournament/
│   │   └── result-entry-form.tsx
│   ├── ranking/
│   │   ├── ranking-chart.tsx
│   │   └── belgium-timeline-strip.tsx
│   └── common/
│       └── rrule-editor.tsx        # EXTEND
└── messages/
    ├── nl.json                     # EXTEND
    ├── en.json                     # EXTEND
    └── fr.json                     # EXTEND
```

---

### Pattern 1: RRULE Split-and-Rewrite (D-84 "Deze en toekomstige")
**What:** Truncate the old recurring series' `UNTIL` to the day before the split, create a new `calendar_events` row with the edited fields and a continuation RRULE, copy series-level participants and sparring partners.

**When to use:** D-84 "Deze en toekomstige" edit scope.

**Math overview:**
1. Parse old RRULE via `parseRrule(oldRrule, oldDtstart)`.
2. Read `origOptions`. Mutate `until = splitDate - 1 day` (Brussels-anchored).
3. Re-emit via `RRule.optionsToString(modifiedOptions)`.
4. New RRULE: clone `origOptions`, set new DTSTART = splitDate, leave UNTIL/COUNT pristine (the new event has its own horizon validation per D-55).
5. Edge cases (CRITICAL):
   - **Old RRULE has UNTIL > splitDate:** truncate UNTIL to splitDate - 1 day. New rule inherits the old UNTIL (or, by Claude's discretion, defaults to "Eindigt: Nooit" → ensureHorizon kicks in to inject +2y).
   - **Old RRULE has COUNT:** convert to UNTIL = splitDate - 1 day (since COUNT - (occurrences before split) is fragile to off-by-one). Document this conversion in audit_log.
   - **Old RRULE has BYDAY:** preserve BYDAY in new rule; the BYDAY itself is unchanged unless the user explicitly changes weekday in the edit form.
   - **Existing EXDATEs (calendar_event_exceptions with cancelled=true):** the new event starts with empty exceptions; exceptions on dates ≥ splitDate are NOT copied (D-83 — past data immutable, but EXDATE on a not-yet-occurred date is forward-looking — by D-83 it stays on the old event, which now has UNTIL < that date so it becomes inert; document this in commit). Recommendation: leave inert exceptions in place (CONTEXT note "garbage-collect or zombie" — chose zombie, defensive).
   - **Override exceptions (cancelled=false with override_*):** same as EXDATEs — stay on old event.

**Code shape (concrete):**
```typescript
// src/lib/rrule.ts (Phase 4 addition)

export interface RruleSplitResult {
  oldRruleString: string;       // UNTIL truncated; same DTSTART
  newRruleString: string;       // new DTSTART = splitDate; UNTIL preserved or null (caller calls ensureHorizon)
  newDtstart: Date;             // real UTC
}

/**
 * Split an RRULE at `splitDate` (Brussels-anchored). The day OF splitDate
 * BELONGS TO THE NEW EVENT (user clicked "edit this and future" on the
 * `splitDate` occurrence). The old event's last occurrence is the day BEFORE.
 *
 * Returns the truncated old RRULE and the new continuation RRULE.
 *
 * Edge cases handled:
 *   - Old has UNTIL: truncate to splitDate - 1 day (Brussels)
 *   - Old has COUNT: convert to UNTIL = splitDate - 1 day
 *   - Old has BYDAY: preserved on both old and new
 *   - DST: dates are Brussels-anchored via formatOccurrenceDate
 *   - splitDate must be on a valid occurrence of oldRrule, else throw BAD_REQUEST
 */
export function splitRRule(
  oldRruleString: string,
  splitDate: Date,
  oldDtstart: Date,
): RruleSplitResult {
  const rule = parseRrule(oldRruleString, oldDtstart);
  const opts = { ...rule.origOptions };

  // Convert COUNT to UNTIL semantics for clean truncation
  if (opts.count && !opts.until) {
    // Set a placeholder UNTIL = splitDate so the conversion logic below
    // overwrites it. The COUNT itself is discarded — semantics swap to UNTIL.
    delete opts.count;
  }

  // Compute splitDate-1day in Brussels timezone, then convert back to UTC
  // for the UNTIL value.
  const oneDayBefore = new Date(splitDate.getTime() - 24 * 60 * 60 * 1000);
  // UNTIL is an absolute UTC instant per RFC 5545; the rrule lib accepts Date.
  opts.until = oneDayBefore;

  // Strip dtstart from spread — DTSTART belongs to the calendar_events row
  // not the RRULE string per Anti-Pattern 1.
  const { dtstart: _stripDtstart, ...oldRest } = opts;
  void _stripDtstart;

  const oldRruleNew = RRule.optionsToString(oldRest);

  // New continuation: clone origOptions, drop UNTIL/COUNT so caller decides
  // whether the new event runs forever (caller invokes ensureHorizon to
  // inject UNTIL = newDtstart + 2y).
  const newOpts = { ...rule.origOptions };
  delete newOpts.until;
  delete newOpts.count;
  const { dtstart: _stripDtstart2, ...newRest } = newOpts;
  void _stripDtstart2;
  const newRruleString = RRule.optionsToString(newRest);

  return {
    oldRruleString: oldRruleNew,
    newRruleString,
    newDtstart: splitDate,
  };
}
```

**Migration of participants (transaction):**
```typescript
// src/server/trpc/routers/calendar.ts — event.editRecurring scope 'this_and_future'

await db.transaction(async (tx) => {
  // 1. Compute split via splitRRule
  const split = splitRRule(oldEvent.rrule!, input.splitDate, oldEvent.startsAt);

  // 2. UPDATE old event with truncated RRULE
  await tx.update(calendarEvents)
    .set({ rrule: split.oldRruleString, updatedAt: new Date() })
    .where(eq(calendarEvents.id, oldEvent.id));

  // 3. INSERT new event with edits applied + new RRULE
  const [newEvent] = await tx.insert(calendarEvents).values({
    typeCode: oldEvent.typeCode,        // type immutable per D-84 implicit
    title: input.title ?? oldEvent.title,
    startsAt: split.newDtstart,
    endsAt: new Date(split.newDtstart.getTime() + (oldEvent.endsAt.getTime() - oldEvent.startsAt.getTime())),
    allDay: oldEvent.allDay,
    location: input.location ?? oldEvent.location,
    description: input.description ?? oldEvent.description,
    rrule: ensureHorizon(split.newRruleString, split.newDtstart),
    createdBy: ctx.scope.userId,
  }).returning({ id: calendarEvents.id });

  // 4. Copy extension row (training_sessions / meetings) with edited fields
  await copyExtensionRow(tx, oldEvent.typeCode, oldEvent.id, newEvent.id, input);

  // 5. Copy calendar_event_participants (series-level)
  const oldParticipants = await tx.select().from(calendarEventParticipants)
    .where(eq(calendarEventParticipants.eventId, oldEvent.id));
  if (oldParticipants.length > 0) {
    await tx.insert(calendarEventParticipants).values(
      oldParticipants.map(p => ({
        eventId: newEvent.id,
        userId: p.userId,
        roleInEvent: p.roleInEvent,
        rsvpStatus: 'pending' as const,  // RSVPs reset for the new series (UX decision; documented in commit)
      }))
    );
  }

  // 6. Copy session_sparring_partners if this is a training_sessions
  if (oldEvent.typeCode === 'event_type_training') {
    const oldSparring = await tx.select().from(sessionSparringPartners)
      .where(eq(sessionSparringPartners.eventId, oldEvent.id));
    if (oldSparring.length > 0) {
      await tx.insert(sessionSparringPartners).values(
        oldSparring.map(s => ({ eventId: newEvent.id, sparringPartnerId: s.sparringPartnerId }))
      );
    }
  }

  // 7. NOTE: session_participants rows STAY on the old event (D-83 immutable past)

  // 8. Audit both events
  await writeAudit(ctx, {
    action: 'calendar_event_recurring_split',
    resourceType: 'calendar_event',
    resourceId: oldEvent.id,
    newValues: { newEventId: newEvent.id, splitDate: split.newDtstart.toISOString() },
  });
});
```

### Pattern 2: 14-day Discipline Wall (D-64, D-71)
**What:** Server-side check in mutation handler: reject if `now() - ends_at > 14 days`. NO middleware preset because the wall depends on the resource being mutated (event_id parameter), not on the caller alone. The check needs to load `calendar_events.ends_at` before deciding.

**Implementation pattern:**
```typescript
// Inline check in training.markAttendanceAndScore
const event = await db.select({ endsAt: calendarEvents.endsAt })
  .from(calendarEvents)
  .where(eq(calendarEvents.id, input.eventId));
if (!event[0]) throw new TRPCError({ code: 'NOT_FOUND' });

const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;
const wallExpired = Date.now() - event[0].endsAt.getTime() > FOURTEEN_DAYS_MS;

// D-64: trainer's 14-day wall has NO TD override
if (wallExpired) {
  await writeAudit(ctx, {
    action: 'training_score_window_expired_attempt',
    resourceType: 'calendar_event',
    resourceId: input.eventId,
    outcome: 'denied',  // critical for audit visibility
  });
  throw new TRPCError({
    code: 'FORBIDDEN',
    message: 'errors.training.scoreWindowExpired',
  });
}
```

**Why inline, not middleware:** Phase 1's `requireRole` middleware works on caller scope alone. The score window depends on the `eventId` input + a DB read of `ends_at`. Mixing middleware that reads input is awkward (Phase 3 went inline with `canCreateEventType` for the same reason — see `calendar.ts:503`). Optionally extract to a helper `assertScoreWindowOpen(db, eventId, ctx, errorKey)` for reuse across `training.markAttendanceAndScore` + `tournament.enterResult`.

**Audit on denial:** every wall-rejection writes an `outcome: 'denied'` audit_log row. This makes the wall observable in the GDPR Article 30 audit feed (per Phase 1 D-30 `outcome` column on audit_log).

### Pattern 3: Atomic Tournament Result Entry (D-69, D-80)
**What:** Single `db.transaction` containing `INSERT tournament_results` + `INSERT match_results[]` rows. Rollback on any partial failure. Idempotency key gating.

**Code shape:**
```typescript
// src/server/trpc/routers/tournament.ts — enterResult

// Outside the tx: validation
if (input.matches.length === 0) {
  throw new TRPCError({
    code: 'BAD_REQUEST',
    message: 'errors.tournament.atLeastOneMatchRequired',  // D-69
  });
}

// 14-day wall (D-71) for player; trainer/TD bypasses per D-73
const event = await db.select({ endsAt: calendarEvents.endsAt })
  .from(calendarEvents)
  .where(eq(calendarEvents.id, input.tournamentEventId));
const wallExpired = Date.now() - event[0].endsAt.getTime() > FOURTEEN_DAYS_MS;
if (ctx.scope.role === 'player' && wallExpired) {
  throw new TRPCError({ code: 'FORBIDDEN', message: 'errors.tournament.entryWindowExpired' });
}

// Resolve entered_by attribution
const enteredBy = ctx.scope.role === 'player' ? 'player'
                : ctx.scope.role === 'technical_director' ? 'td'
                : 'trainer';

// DOM-CAT-02: snapshot age category at tournament start date
const cat = await getAgeCategoryAt(input.playerUserId, event[0].startsAt);
const playerAgeCategoryCode = cat?.code ?? 'age_unknown';

await db.transaction(async (tx) => {
  // 1. UPSERT tournament_results (D-75 TD overwrite: ON CONFLICT DO UPDATE)
  await tx.insert(tournamentResults).values({
    tournamentEventId: input.tournamentEventId,
    playerUserId: input.playerUserId,
    outcomeLevelCode: input.outcome,
    playerAgeCategoryCode,
    enteredBy,
    enteredByUserId: ctx.scope.userId,
  }).onConflictDoUpdate({
    target: [tournamentResults.tournamentEventId, tournamentResults.playerUserId],
    set: {
      outcomeLevelCode: input.outcome,
      enteredBy,
      enteredByUserId: ctx.scope.userId,
      updatedAt: new Date(),
    },
  });

  // 2. DELETE existing match_results for this tournament+player (overwrite semantics)
  //    — D-75 unconditional overwrite. If we wanted append-only, we'd skip this.
  //    Decision: full replacement on every save (clearer mental model than diff-merge).
  await tx.delete(matchResults).where(
    and(
      eq(matchResults.tournamentEventId, input.tournamentEventId),
      eq(matchResults.playerUserId, input.playerUserId),
    ),
  );

  // 3. INSERT match_results
  await tx.insert(matchResults).values(
    input.matches.map(m => ({
      tournamentEventId: input.tournamentEventId,
      playerUserId: input.playerUserId,
      roundCode: m.round,
      opponentName: m.opponent,
      opponentRanking: m.opponentRanking ?? null,
      matchDate: m.matchDate,
      setsWon: m.setsWon,
      setsLost: m.setsLost,
      videoLink: m.videoLink ?? null,
    })),
  );

  // 4. Audit
  await writeAudit({ ...ctx, db: tx }, {
    action: 'tournament_result_entered',
    resourceType: 'tournament_result',
    resourceId: `${input.tournamentEventId}:${input.playerUserId}`,
    newValues: {
      outcome: input.outcome,
      matchCount: input.matches.length,
      enteredBy,
      ageCategorySnapshot: playerAgeCategoryCode,
    },
  });
});
```

**Why DELETE+INSERT not UPSERT per match:** match_results has no natural composite PK that survives edits (round + opponent + date is too brittle — typos mean different rows). Full replacement matches the D-80 single-save form mental model.

### Pattern 4: Split-Column Schema with CHECK XOR (D-86)
**What:** `ranking_entries` has two value columns (`value_numeric`, `value_classification_code`); exactly one must be non-null. Plus a trigger/app-layer check that `ranking_type.value_shape` matches the populated column.

**DB-level CHECK XOR:**
```sql
CREATE TABLE ranking_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_user_id uuid NOT NULL REFERENCES users(id) ON DELETE restrict,
  ranking_type_code text NOT NULL REFERENCES ranking_type(code) ON DELETE restrict,
  recorded_at timestamptz NOT NULL,
  source text NOT NULL CHECK (source IN ('manual', 'federation_official')),
  value_numeric numeric NULL,                              -- > 0 for international ranks
  value_classification_code text NULL REFERENCES belgium_classification(code) ON DELETE restrict,
  entered_by uuid NOT NULL REFERENCES users(id) ON DELETE restrict,
  entered_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ranking_entries_value_xor CHECK (
    (value_numeric IS NOT NULL AND value_classification_code IS NULL)
    OR
    (value_numeric IS NULL AND value_classification_code IS NOT NULL)
  ),
  CONSTRAINT ranking_entries_numeric_positive CHECK (
    value_numeric IS NULL OR value_numeric > 0
  )
);
```

**Cross-check enforced in tRPC mutation (recommended over trigger):**
```typescript
// src/server/trpc/routers/ranking.ts — addEntry

const rankingType = await db.query.rankingType.findFirst({
  where: eq(rankingType.code, input.rankingTypeCode),
});
if (!rankingType) throw new TRPCError({ code: 'BAD_REQUEST', message: 'errors.ranking.unknownType' });

// value_shape is a new column on ranking_type added in Phase 4 migration 0017
if (rankingType.valueShape === 'numeric' && input.value.kind !== 'numeric') {
  throw new TRPCError({ code: 'BAD_REQUEST', message: 'errors.ranking.expectedNumeric' });
}
if (rankingType.valueShape === 'classification' && input.value.kind !== 'classification') {
  throw new TRPCError({ code: 'BAD_REQUEST', message: 'errors.ranking.expectedClassification' });
}
```

**Why app-layer not trigger:** triggers complicate Drizzle migrations (manual SQL outside `drizzle generate`), and the check is trivially expressed in the mutation. The DB-level XOR CHECK is sufficient to catch the worst failure mode (both nullable or both filled).

### Pattern 5: Academy-Wide RLS Visibility (D-78)
**What:** `tournament_result_visible_to(uid, role)` SECURITY DEFINER returning event_ids visible to the caller. UNION branches mirror Phase 3 D-50 with an added branch for "players sharing an academy with the subject".

```sql
CREATE OR REPLACE FUNCTION tournament_result_visible_to(caller_id UUID, caller_role TEXT)
RETURNS TABLE(tournament_event_id UUID, player_user_id UUID) AS $$
  -- Branch 1: TD sees all
  SELECT tr.tournament_event_id, tr.player_user_id
    FROM tournament_results tr
   WHERE caller_role IN ('technical_director', 'medical_staff')

  UNION

  -- Branch 2: Player sees own results
  SELECT tr.tournament_event_id, tr.player_user_id
    FROM tournament_results tr
   WHERE tr.player_user_id = caller_id

  UNION

  -- Branch 3: Trainers/academy_managers see results of academy players
  SELECT tr.tournament_event_id, tr.player_user_id
    FROM tournament_results tr
    JOIN academy_memberships am_player
      ON am_player.user_id = tr.player_user_id
     AND am_player.role = 'player'
    JOIN academy_memberships am_caller
      ON am_caller.academy_code = am_player.academy_code
     AND am_caller.user_id = caller_id
     AND am_caller.role IN ('trainer', 'academy_manager')
   WHERE caller_role IN ('trainer', 'academy_manager')

  UNION

  -- Branch 4: Parents see results of linked children
  SELECT tr.tournament_event_id, tr.player_user_id
    FROM tournament_results tr
    JOIN parent_child_links pcl
      ON pcl.child_user_id = tr.player_user_id
     AND pcl.parent_user_id = caller_id
   WHERE caller_role = 'parent'

  UNION

  -- Branch 5: D-78 — Players sharing an academy with the subject
  --          (creates internal leaderboard energy per user choice)
  SELECT tr.tournament_event_id, tr.player_user_id
    FROM tournament_results tr
    JOIN academy_memberships am_subject
      ON am_subject.user_id = tr.player_user_id
     AND am_subject.role = 'player'
    JOIN academy_memberships am_caller
      ON am_caller.academy_code = am_subject.academy_code
     AND am_caller.user_id = caller_id
     AND am_caller.role = 'player'
   WHERE caller_role = 'player'
     AND tr.player_user_id <> caller_id;  -- own results already covered by Branch 2
$$ LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = pg_catalog, public;

REVOKE ALL ON FUNCTION tournament_result_visible_to(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tournament_result_visible_to(UUID, TEXT) TO app_user;
```

**Performance note:** UNION queries with 5 branches can run hot. Validate with EXPLAIN ANALYZE on a seed dataset (RISK-DASHBOARD-PERF mentioned in Phase 7 — pre-emptively check during Phase 4 to avoid surprise). Composite index recommendation: `idx_academy_memberships_user_role (user_id, role)` already exists from Phase 1; add `idx_academy_memberships_academy_role (academy_code, role)` if missing for Branch 5.

### Pattern 6: Extend Phase 3 `calendar_events_visible_to` with Sparring Branch
**What:** Phase 3 left a placeholder comment at line 140-145 of `drizzle/0011_phase3_calendar_rls_policies.sql`. Phase 4 fills it.

```sql
CREATE OR REPLACE FUNCTION calendar_events_visible_to(caller_id UUID, caller_role TEXT)
RETURNS TABLE(event_id UUID) AS $$
  -- Branch 1: TD / medical_staff see all
  SELECT ce.id FROM calendar_events ce
   WHERE caller_role IN ('technical_director', 'medical_staff')

  UNION

  -- Branch 2: Creator sees own
  SELECT ce.id FROM calendar_events ce
   WHERE ce.created_by = caller_id

  UNION

  -- Branch 3: Participant sees events they're in
  SELECT cep.event_id
    FROM calendar_event_participants cep
   WHERE cep.user_id = caller_id

  UNION

  -- Branch 4: academy_manager / trainer sees events of academy players
  SELECT cep.event_id
    FROM calendar_event_participants cep
    JOIN academy_memberships am_player
      ON am_player.user_id = cep.user_id AND am_player.role = 'player'
    JOIN academy_memberships am_caller
      ON am_caller.academy_code = am_player.academy_code
     AND am_caller.user_id = caller_id
     AND am_caller.role IN ('trainer', 'academy_manager')
   WHERE caller_role IN ('trainer', 'academy_manager')

  UNION

  -- Branch 5: parent sees events of linked child(ren)
  SELECT cep.event_id
    FROM calendar_event_participants cep
    JOIN parent_child_links pcl
      ON pcl.child_user_id = cep.user_id
     AND pcl.parent_user_id = caller_id
   WHERE caller_role = 'parent'

  UNION

  -- Branch 6: NEW (Phase 4) — sparring_partner sees own sessions via junction
  SELECT ssp.event_id
    FROM session_sparring_partners ssp
   WHERE ssp.sparring_partner_id = caller_id
     AND caller_role = 'sparring_partner';
$$ LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = pg_catalog, public;
```

### Anti-Patterns to Avoid
- **Direct RRULE string concatenation:** Use `RRule.optionsToString()` always. Anti-Pattern 1 from Phase 3 lib/rrule.ts.
- **Storing won/lost as a boolean:** D-81 explicitly derives won/lost from `sets_won > sets_lost`. NO separate column.
- **Using middleware for the 14-day wall:** the wall needs to read `ends_at` from the event row; middleware that does DB reads adds latency to every call. Inline check + early return is faster + clearer.
- **Computing player's age category at query time:** DOM-CAT-02 says snapshot at tournament START date, not "now". The `tournament_results.player_age_category_code` column is set ONCE at entry time.
- **Trigger for `value_shape` cross-check on ranking_entries:** triggers are awkward with Drizzle migrations. App-layer Zod refinement + DB CHECK XOR is sufficient.
- **N+1 reads of ranking_type per ranking entry:** preload ranking_type rows on app start (small lookup); cache in memory or fetch with `db.query.rankingType.findMany()`.
- **Hand-rolling pg_cron schedule expressions:** Supabase pg_cron uses UTC. 18:00 Europe/Brussels = 17:00 UTC in winter, 16:00 UTC in summer. Document in commit (see Pitfall 2 for the DST workaround).
- **Skipping the override audit when force:true has no actual conflicts:** Phase 3 fixed this in WR-06 (`calendar.ts:657`); Phase 4 inherits the same discipline.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| RRULE parsing/serialization | Custom RFC 5545 parser | `rrule@2.8.1` (already installed) | Implements full RFC 5545; battle-tested. |
| RRULE expansion with EXDATEs | Custom expansion loop | `rrule@2.8.1` `RRuleSet` | Handles BYDAY+COUNT+UNTIL+EXDATE compositions correctly. DST-anchoring already in `expandRrule()`. |
| Recurring schedule (pg_cron 18:00 daily) | BullMQ recurring job | `pg_cron` (Supabase Pro) | Runs at DB layer; survives app restarts; logs to cron.job_run_details. |
| Line chart with inverted Y-axis | Hand-built SVG | `recharts@3.8.1` `<YAxis reversed />` | Confirmed prop; declarative; aligned with React 19. |
| Tier-band horizontal timeline | Custom canvas component | Pure CSS/Tailwind component (no chart lib) | 3–5 annual data points; chart machinery is overkill. |
| Idempotency key dedup | Custom Redis check | Phase 1 `idempotency_keys` table | Schema exists since 0000; just needs middleware wiring (see Pitfall 5). |
| Audit row per mutation | Custom audit insert in each handler | `writeAudit(ctx, entry)` from `middleware/audit.ts` | Phase 1 pattern; append-only via DB role grant; tamper-evident. |
| Conflict detection with overlapping medical events | New SECURITY DEFINER fn | Phase 3 `overlapping_events_for_users(uuid[], tstzrange[])` | Already shipped; Phase 4 just calls it on training-session create form-time check. |
| Belgium classification ordering | Computed sort at query time | `belgium_classification.sort_order` column | Pre-computed; deterministic ASC ordering. |
| Bulk attendance form state | Manual useState array | `useFieldArray` from react-hook-form | Phase 2 form pattern; handles dynamic rows. |

**Key insight:** the project's Phase 1+2+3 infrastructure already covers most heavy lifting. Phase 4 mostly assembles existing pieces (idempotency table, audit middleware, RLS pattern, RRULE helpers, FullCalendar chip taxonomy, react-hook-form, Zod schemas, next-intl catalogs). The NEW machinery is small: `splitRRule()` math, 6 schemas, 3 RLS functions, 3 routers, 1 chart component.

---

## Runtime State Inventory

Phase 4 is greenfield (no rename/refactor) — this section is N/A.

---

## Common Pitfalls

### Pitfall 1: RRULE split-and-rewrite copying historical session_participants
**What goes wrong:** The natural instinct on "Deze en toekomstige" is to copy session_participants to the new event so attendance history "looks continuous". But D-83 explicitly forbids touching past data — session_participants rows for occurrences before the split must STAY on the old event. The new event starts with empty session_participants.

**Why it happens:** Engineers think of a recurring training as a single conceptual stream; the database treats each occurrence as a discrete row pinned to `(event_id, occurrence_date, user_id)`. Splitting at occurrence N means new_event has occurrences ≥ N; old_event keeps 1..N-1. Attendance for 1..N-1 belongs to the old event because that's where the rows already are.

**How to avoid:** In the split transaction, explicitly skip session_participants. Add a comment: "// session_participants intentionally NOT copied — D-83 past data immutable". Add an integration test that splits a series mid-attendance and asserts old_event still has rows + new_event has zero rows + dates match expected occurrences.

**Warning signs:** Trainer reports "where did my old attendance go" — symptom of accidentally copying or moving rows.

### Pitfall 2: pg_cron UTC-only timezone breaks 18:00 Europe/Brussels schedule across DST
**What goes wrong:** pg_cron in Supabase Pro runs in UTC only. `'0 18 * * *'` runs at 18:00 UTC, which is 19:00 CET in winter and 20:00 CEST in summer — both wrong for "18:00 Brussels".

**Why it happens:** Supabase's pg_cron has no per-job timezone setting. Engineers schedule `'0 18 * * *'` thinking it's local time. [CITED: github.com/orgs/supabase/discussions/7892]

**How to avoid:** Three options:
1. **Schedule both UTC times (recommended):** Run job at `'0 17 * * *'` (covers CET winter 18:00) AND check inside the job body whether it's currently CEST — if so, abort. Run a second job at `'0 16 * * *'` (covers CEST summer 18:00) with inverse check. Both jobs gate via:
   ```sql
   SELECT CASE
     WHEN (now() AT TIME ZONE 'Europe/Brussels')::time::text LIKE '18:%' THEN 1
     ELSE 0
   END;
   ```
2. **Schedule once at 16:00 UTC (acceptable):** Job runs 17:00 in CET winter, 18:00 in CEST summer. Tolerable since users care about "evening notification" not exact 18:00.
3. **Schedule at 17:00 UTC fall + manually rotate twice yearly:** Operationally fragile; reject.

**Recommendation:** Option 1 (dual schedule with time check). Document the DST math in the migration commit.

**Warning signs:** Users report nudge arriving at "wrong time" twice a year (March + October).

### Pitfall 3: 14-day wall arithmetic off-by-one
**What goes wrong:** `now() - ends_at <= INTERVAL '14 days'` at exactly day-14 boundary: is the boundary inclusive or exclusive? Tests must pin this.

**Why it happens:** D-64 says "14-day absolute wall — no TD override" but doesn't specify boundary semantics. JS `Date.now() - endsAt.getTime() > 14 * 24 * 60 * 60 * 1000` is strict-greater — exactly 14 days = still allowed. PostgreSQL `now() - ends_at <= INTERVAL '14 days'` is less-than-or-equal — exactly 14 days = still allowed. Both agree on "exactly 14 days passes the wall". Day-15 = rejected.

**How to avoid:** Use strict-greater consistently. Write tests for:
- ends_at = now() - INTERVAL '13 days' → allowed
- ends_at = now() - INTERVAL '14 days' → allowed (boundary case)
- ends_at = now() - INTERVAL '14 days 1 second' → rejected
- ends_at = now() - INTERVAL '15 days' → rejected

**Warning signs:** Trainer reports being locked out on day 14 (or, conversely, being able to score on day 15).

### Pitfall 4: Tournament-result form atomic submit on partial failure
**What goes wrong:** Match validation (e.g., sets_won + sets_lost > 7 → invalid) fails on row 3 of 5. If the developer wrote inserts as a loop OUTSIDE a transaction, rows 1-2 are committed and rows 3-5 rejected; the user sees a partial save.

**Why it happens:** Drizzle's `db.transaction(async (tx) => {...})` callback is required for atomicity; forgetting to use it = no rollback.

**How to avoid:** Wrap the entire `INSERT tournament_results` + `INSERT match_results[]` chain in `db.transaction(...)`. Zod validation BEFORE the transaction enforces shape; DB CHECK constraints inside the transaction catch any constraint violations and roll back.

**Warning signs:** D-69 invariant violations in production (tournament_results row without ≥1 match_results row).

### Pitfall 5: idempotency middleware not wired — Phase 1 left the table, no middleware
**What goes wrong:** VALID-08 says POST endpoints accept client-provided idempotency keys; duplicate UUIDs within 24h are rejected as no-ops. Phase 1 created the `idempotency_keys` table (`src/server/db/schema/idempotency.ts`) but **no middleware exists yet** (verified via `find /Users/kris/.../src -name 'idempotency*'`). Plan 14 in Phase 1 was the documented place for it; if Phase 1 skipped that plan or wired only partial, Phase 4 must complete it.

**Why it happens:** Plans 13-14 from Phase 1 may not have shipped the middleware. The table is there; the wiring isn't. Phase 4 routes for `tournament.enterResult` and `ranking.addEntry` need this middleware.

**How to avoid:** Phase 4 ships `src/server/trpc/middleware/idempotency.ts`. Pattern:
```typescript
export const idempotencyMiddleware = (endpointName: string) => middleware(async ({ ctx, next, getRawInput }) => {
  if (!ctx.scope) return next();
  const raw = await getRawInput();
  const key = (raw as { _meta?: { idempotencyKey?: string } })?._meta?.idempotencyKey;
  if (!key) return next();  // no idempotency requested

  const dbHandle = ctx.db ?? rawDb;
  const existing = await dbHandle.query.idempotencyKeys.findFirst({
    where: and(eq(idempotencyKeys.key, key), eq(idempotencyKeys.userId, ctx.scope.userId), eq(idempotencyKeys.endpoint, endpointName)),
  });
  if (existing && existing.expiresAt > new Date()) {
    return { ok: true, replay: true, body: existing.responseBody };  // short-circuit
  }
  const result = await next();
  // Persist after success
  await dbHandle.insert(idempotencyKeys).values({
    key, userId: ctx.scope.userId, endpoint: endpointName,
    responseBody: result as any,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  });
  return result;
});
```

**Compose at procedure:** `tournament.enterResult` and `ranking.addEntry`:
```typescript
enterResult: protectedProcedure
  .use(idempotencyMiddleware('tournament.enterResult'))
  .input(enterResultInput.merge(z.object({ _meta: z.object({ idempotencyKey: z.string().uuid().optional() }).optional() })))
  .mutation(async ({ ctx, input }) => { ... })
```

**Warning signs:** User mashes Save button on tournament-result form; duplicate row violations on `tournament_results (event_id, player_user_id)` PK if no idempotency in place.

### Pitfall 6: Per-occurrence attendance race condition (two trainers, same occurrence)
**What goes wrong:** Two trainers (or trainer + TD) open the bulk-attendance form for the same `(event_id, occurrence_date)` at the same time, both submit. Without ON CONFLICT logic, the second submission tries to INSERT and fails on the PK `(event_id, occurrence_date, user_id)`.

**Why it happens:** D-62 single combined form does an upsert; if implemented naively as INSERT without ON CONFLICT, concurrent edits race.

**How to avoid:** Use `INSERT ... ON CONFLICT (event_id, occurrence_date, user_id) DO UPDATE SET quality_score = EXCLUDED.quality_score, feedback_text = EXCLUDED.feedback_text, attended = EXCLUDED.attended, updated_at = now()`. Drizzle pattern:
```typescript
await tx.insert(sessionParticipants).values(rows).onConflictDoUpdate({
  target: [sessionParticipants.eventId, sessionParticipants.occurrenceDate, sessionParticipants.userId],
  set: {
    qualityScore: sql`EXCLUDED.quality_score`,
    feedbackText: sql`EXCLUDED.feedback_text`,
    attended: sql`EXCLUDED.attended`,
    updatedAt: new Date(),
  },
});
```
Plus: write to audit_log with both old and new values so the override is visible.

**Warning signs:** "Last write wins" silently overwrites the first trainer's scores; the first trainer doesn't know they were overridden.

### Pitfall 7: Yellow ⚠ overlay on calendar chips — race with cron job
**What goes wrong:** Trainer scores a session at 17:55. The 18:00 pg_cron job has already started computing the nudge list (it reads at 18:00:00 sharp). The trainer sees the scored session still flagged as "needs scoring" on tomorrow's banner because the cron snapshot was taken seconds before their save.

**Why it happens:** Cron snapshots are static reads. The banner count IS the snapshot.

**How to avoid:** TWO approaches:
1. **Banner count = live query** (recommended): cron job writes `system_inbox` rows (which are durable nudge messages); but the banner reads a fresh `count(*) FROM ... WHERE quality_score IS NULL` every page load. Cheap query (indexed on training_sessions.trainer_id + session_participants.quality_score IS NULL).
2. **Cron writes snapshot + banner reads snapshot:** simpler but stale; reject.

**Recommendation:** Live banner count. inbox message is for the daily "summary" surface; banner is for immediate state.

**Warning signs:** Trainer says "I scored all sessions, why is the banner still there".

### Pitfall 8: Belgium classification seed order matters for sort_order column
**What goes wrong:** `belgium_classification.sort_order` controls how the dropdown / timeline orders codes. If A1 has sort_order=1 and A50 has sort_order=50, then B0 must start at 51 (not 0). Otherwise filtering "show all A-tier" works fine, but ordering across tiers breaks (B0 with sort_order=0 would appear before A1).

**Why it happens:** Engineers conventionally start B-tier sort at 0 (matching the "B0" letter), but the column is a global ordinal, not per-tier.

**How to avoid:** Pre-compute the seed:
```
A1=1, A2=2, ..., A50=50,
B0=51, B2=52, B4=53, B6=54,
C0=55, C2=56, C4=57, C6=58,
D0=59, D2=60, D4=61, D6=62,
E0=63, E2=64, E4=65, E6=66,
NC=67
```
That's 67 total codes. The `tier` column separately groups them (`tier IN ('A','B','C','D','E','NC')`) for tier-band color rendering.

**Warning signs:** Belgium timeline strip shows tiers out of order.

### Pitfall 9: recharts inverted Y-axis on small datasets renders blank chart
**What goes wrong:** A player with only 2-3 ranking_entries plotted on `<YAxis reversed domain={['auto', 'auto']} />` may render with auto-domain inverted in surprising ways. Some recharts versions auto-flipped behaved inconsistently.

**Why it happens:** recharts auto-domain inference + reversed prop interaction on tiny datasets.

**How to avoid:** Pin `domain` explicitly when data is sparse:
```jsx
<YAxis reversed domain={[1, dataMaxRank + 50]} allowDataOverflow={false} />
```
Compute `dataMaxRank` from the dataset; pad +50 for visual breathing room. For an empty dataset, fall back to a placeholder `<EmptyState>` rather than rendering an empty chart.

**Warning signs:** Chart appears empty or with ranks plotted upside down.

### Pitfall 10: D-78 academy-wide visibility leaks past-academy results when player switches academies
**What goes wrong:** Player X was in Academy A in 2025, switched to Academy B in 2026. D-78 says "players sharing an academy with subject". With academy_memberships current rows only, the query picks Academy B peers (correct). But if player X's 2025 tournament_results are visible to players in 2026 Academy B (their current peers), Academy A players (X's former peers) can NO LONGER see those results.

**Why it happens:** academy_memberships likely doesn't track "effective_from / effective_to" — only current memberships. D-78 mirrors current-only academy scoping.

**How to avoid:** Two options:
1. **Static academy snapshot on tournament_results:** add `player_academy_code_snapshot text` to tournament_results at entry time; query uses snapshot for visibility. Costs an additional column; matches DOM-CAT-02 snapshot pattern. **Recommended.**
2. **Live academy join:** simpler; accept that academy changes flip visibility going forward. **Accepted in D-78 by default** (CONTEXT doesn't mandate snapshot).

**Recommendation:** Default to live-join (D-78 wording is "players sharing an academy" — present tense). Document explicitly in commit so this isn't relitigated later. Phase 7's GDPR-06 erasure path is unaffected.

**Warning signs:** Player switches academy; ex-peers can no longer see results they could see before. **This is by design**; document in user-facing FAQ.

---

## Code Examples

Verified patterns from existing Phase 1+2+3 implementation:

### Example 1: Drizzle Transaction with Audit
```typescript
// Source: src/server/trpc/routers/calendar.ts (lines 577-635) — Phase 3 reference
await db.transaction(async (tx) => {
  const inserted = await tx.insert(calendarEvents)
    .values({ /* ... */ })
    .returning({ id: calendarEvents.id });
  const eventId = inserted[0]?.id;
  if (!eventId) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });

  await tx.insert(calendarEventParticipants).values([/* ... */]);
});

// Audit AFTER tx commits (so audit reflects truth):
await writeAudit(ctx, {
  action: 'calendar_event_created',
  resourceType: 'calendar_event',
  resourceId: eventId,
  newValues: { /* snapshot */ },
});
```

### Example 2: RLS-Bound Transaction
```typescript
// Source: src/server/trpc/middleware/rls.ts (lines 44-88)
// Already chained into protectedProcedure — Phase 4 inherits automatically.
// ctx.db inside any procedure handler is the tx with GUCs set.
```

### Example 3: getAgeCategoryAt helper (DOM-CAT-02)
```typescript
// Source: src/lib/players.ts:97
const cat = await getAgeCategoryAt(input.playerUserId, tournament.startsAt);
// returns: { code: 'age_senior', year: 2026 } | null
const playerAgeCategoryCode = cat?.code ?? 'age_unknown';
```

### Example 4: Phase 3 RRULE expansion pattern (for splitRRule reference)
```typescript
// Source: src/lib/rrule.ts (parseRrule + ensureHorizon — Phase 4 builds on these)
const rule = parseRrule(rruleString, dtstart);
const opts = rule.origOptions;
opts.until = newUntilDate;
const { dtstart: _strip, ...rest } = opts;
const newRruleString = RRule.optionsToString(rest);
```

### Example 5: Procedure preset composition pattern
```typescript
// Source: src/server/trpc/middleware/freshSession.ts:130
export const tdProcedure = protectedProcedure.use(requireRole('technical_director'));

// Phase 4 adds:
export const trainerOrTdProcedure = protectedProcedure.use(
  requireRole('trainer', 'technical_director'),
);
```

### Example 6: i18n error key pattern
```typescript
// Source: src/server/trpc/routers/calendar.ts:644 — pattern for all errors
throw new TRPCError({
  code: 'FORBIDDEN',
  message: 'errors.training.scoreWindowExpired',  // i18n key, NOT translated string
});
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Belgium ranking as numeric rangwaarde (RANK-01 original) | Split-column schema (D-86) — numeric XOR classification | Phase 4 CONTEXT 2026-05-15 | RISK-02 resolved; schema accommodates fundamentally different data shapes per ranking type. |
| 48h player edit window + TD-approval after (DOM-RESULT-01 original) | Single 14d window for player + asymmetric TD/trainer backfill (D-71+D-73+D-74) | Phase 4 CONTEXT | Simpler; no workflow lifecycle. |
| Dedicated edit_history table (DOM-RESULT-03 original) | audit_log JSONB snapshot pattern (D-76) | Phase 4 CONTEXT | One source of forensic truth; less schema; cheaper. |
| Result lifecycle states (DOM-RESULT-04 original) | Every saved row counts; no lifecycle (D-77) | Phase 4 CONTEXT | Simpler UX; D-75 TD unconditional overwrite covers correction needs. |
| gewonnen/verloren toggle (TOURN-04 original) | Derived from sets_won > sets_lost (D-81) | Phase 4 CONTEXT | Less storage; less input error; v2 can add detailed score_sets jsonb additively. |

**Deprecated/outdated patterns:**
- **Approval workflows for results edits** — replaced by audit_log + TD overwrite.
- **Lifecycle states for tournament_results** — replaced by single saved state.
- **Single ranking value column** — replaced by split-column XOR schema.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | recharts `<YAxis reversed />` works correctly with React 19 in v3.8.1 | Pattern 9 / Standard Stack | Medium — if broken, swap to chart.js (alternative noted); requires UI rework on rankings tab. [VERIFIED: recharts.github.io/en-US/api/YAxis/] but exact behaviour with React 19 not test-confirmed by me. |
| A2 | Belgium classification system actually contains all of A1..A50, B0/B2/B4/B6, C0/C2/C4/C6, D0/D2/D4/D6, E0/E2/E4/E6, NC | D-86 lookup seed | Medium — research found references to B0/B2/B4/B6, C0/C2/C4/C6, D0+, E4/E6/NC [CITED: aftt.be/grille-classements.pdf 2025-02; xolay.com/table-tennis-rankings/men-single-belgium] but A1..A50 ceiling and exhaustive A-tier list not confirmed. User-supplied data must be validated against KBTTB official source before seed migration ships. Planner action: ask user / TD for canonical list. |
| A3 | Supabase Pro's pg_cron supports `cron.schedule()` with the standard 5-field cron expression at Phase 4 time | Pattern §pg_cron | Low — Supabase Cron is documented [CITED: supabase.com/docs/guides/cron]; pg_cron is a Phase 8 deliverable per Phase 1 plan 13. Phase 4 must verify pg_cron extension is enabled on the production DB before scheduling. |
| A4 | `idempotency_keys` middleware does NOT exist yet (Phase 1 plan 14 may have shipped only partial) | Pitfall 5 | Low — verified by `find` returning no `idempotency*` file in middleware dir; verified `idempotency_keys` table exists. Planner should confirm with first task. |
| A5 | session_sparring_partners FK to `users.id` filtered to `role='sparring_partner'` works without a deferrable CHECK | Question 14 below | Medium — PostgreSQL FKs don't have a natural "row-filter" mechanism. Three implementations possible: (a) FK only + app-layer check; (b) CHECK trigger; (c) partial unique index + FK. Recommend option (a) + integration test. |
| A6 | "Players sharing an academy" RLS branch in D-78 is current-only (live join), not historical-snapshot | Pitfall 10 | Low — CONTEXT D-78 uses present-tense wording "players sharing"; not explicitly disambiguated. Document in commit. |
| A7 | system_inbox table is acceptable as a Phase 4 minimal stub for D-67/D-72 channel 2 | Open Question §1 | High — CONTEXT explicitly flags this as "decision for planner". Recommend ship minimal table; Phase 6 absorbs/migrates. User confirmation desired. |
| A8 | The trainer "Te scoren" widget queries on every page load (no caching) | D-66 / Pitfall 7 | Low — query is indexed (training_sessions.trainer_id + session_participants.quality_score IS NULL), fast on the data volumes for a single elite squad. Phase 8 may add caching if needed. |
| A9 | DOM-MED-CONFLICT-02 "afwezig met geldige reden" default is an app-layer UI default, not a DB default | DOM-MED-CONFLICT-02 row in Phase Requirements | Low — DB defaults are tricky for "the row doesn't exist yet"; UI pre-selects in the bulk form. |
| A10 | Phase 4 ships only data-migration-aware tournament_results overwrite (DELETE + INSERT match_results), not diff-merge | Pattern 3 | Low — D-75 unconditional overwrite gives planner latitude; full replacement is the simpler/clearer choice. |

**Critical actions for planner derived from assumptions log:**
- A2: ask user/TD for canonical Belgium classification seed list before 0017 migration ships. Block Wave that touches `belgium_classification` until confirmed.
- A3: verify pg_cron extension is enabled on the Supabase Pro production DB; add a `0019_phase4_pg_cron_jobs.sql` migration only after confirmation.
- A4: first task of Phase 4 confirms idempotency middleware absence via `find src -name 'idempotency*'`; if exists, reuse; if not, create.
- A7: surface system_inbox stub decision in discuss-phase or first task for user sign-off.

---

## Open Questions

1. **System_inbox in Phase 4 vs. defer to Phase 6 (D-67 channel 2 + D-72 channel 2)**
   - What we know: CONTEXT marks this as planner discretion (`<code_context> §Operational Concerns`).
   - What's unclear: User preference between (a) minimal table now, (b) defer channel 2 entirely.
   - Recommendation: **Ship minimal `system_inbox(id, user_id, kind, payload jsonb, read_at timestamptz, created_at timestamptz)` table** with only inserts from pg_cron jobs + a thin tRPC `inbox.listUnread()` procedure for the daily-summary surface. Phase 6 absorbs/extends. User confirmation before Wave 1 ships ideal.

2. **RruleEditor "alle in de reeks" garbage-collection of inert exceptions**
   - What we know: CONTEXT marks as planner discretion; recommended "leave inert in place, document predicate".
   - What's unclear: When a TD edits a recurring training with "Alle in de reeks" scope changing FREQ Wed → Thu, what happens to a 2025-06-04 (Wednesday) `calendar_event_exception` (an existing override)? After the edit, no occurrence falls on 2025-06-04 — the exception is inert.
   - Recommendation: leave inert. Document in commit. Add an integration test asserting expansion ignores inert exceptions.

3. **Tournament result entry: full replacement vs. diff-merge of match_results**
   - What we know: D-75 TD unconditional overwrite; D-80 single Save button.
   - What's unclear: When a player saves edits on Day 5 (within 14d window), should existing match_results be diff-merged or fully replaced?
   - Recommendation: **Full replacement** (DELETE + INSERT). Mental model: the player is re-saving "what actually happened at the tournament". Diff-merge invites complex UX states. Audit captures both old (full set) and new (full set) for forensic recovery.

4. **DOM-CAT-02 snapshot vs. live-derive at query time**
   - What we know: CONTEXT D-80 confirms snapshot via `getAgeCategoryAt(player_id, tournament.starts_at)` at entry time.
   - What's unclear: Does the snapshot column live on `tournament_results` only, or also on `match_results`?
   - Recommendation: Only on `tournament_results` (the tournament-level aggregator). Match-level rows inherit transitively. Saves one redundant column.

5. **Performance of D-78 5-branch UNION RLS**
   - What we know: Phase 3 D-50 4-branch UNION on calendar_events_visible_to runs under 200ms on seed data.
   - What's unclear: Will 5-branch UNION on tournament_results scale? Branch 5 (player-peer-academy) is new and joins through 2 academy_memberships.
   - Recommendation: validate via EXPLAIN ANALYZE during Wave 0 / first integration test. If hot, add composite index `(academy_code, role)` on academy_memberships.

6. **value_shape column on ranking_type — Drizzle migration safety**
   - What we know: Phase 1 created `ranking_type` table with `direction` column; Phase 4 adds `value_shape`.
   - What's unclear: ALTER TABLE on lookup tables — is there any data to backfill? Phase 1 left lookup empty per `src/server/db/schema/lookups.ts` comments. Phase 4 0017 seed migration adds rows.
   - Recommendation: 0016 migration ALTER TABLE ranking_type ADD COLUMN value_shape text NOT NULL DEFAULT 'numeric'; 0017 seed populates the 5 ranking types with correct value_shape ('numeric' for 4 international, 'classification' for Belgium). Then 0018 ALTER drops the DEFAULT and adds the CHECK. Three-step expand-contract per MIG-02.

7. **Banner state: server-rendered with refresh vs. client query**
   - What we know: D-67 channel 1 = non-dismissible banner until pending-count = 0.
   - What's unclear: Server Component renders banner from current count, OR Client Component polls a tRPC query?
   - Recommendation: **Server Component renders initial count; Client Component polls `training.listPending` every 30s.** Matches Next.js 15 / React 19 SSR + hydrate pattern; banner appears immediately on page load (no flash), updates on score completion within ~30s.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js 20+ | All TypeScript | ✓ (Phase 1) | confirmed | — |
| pnpm | Package manager | ✓ (Phase 1) | 9.15.0 | — |
| PostgreSQL 16 | DB | ✓ (Supabase Pro) | confirmed | — |
| pg_cron extension | D-67/D-72 nudge jobs | ? | unknown | Pre-Wave 4 verification needed; if not enabled, request Supabase enable; if denied, fall back to BullMQ recurring job (loses DB-layer guarantee). |
| pgcrypto extension | medical encryption (not Phase 4) | ✓ (Phase 1) | — | — |
| `rrule` 2.8.1 | RRULE math | ✓ (Phase 3) | 2.8.1 | — |
| `recharts` 3.8.1 | Ranking line chart (D-87) | ✗ | — | `pnpm add recharts` |
| Drizzle Kit | Migrations | ✓ (Phase 1) | 0.31 | — |
| Vitest + testcontainers | Integration tests | ✓ (Phase 1) | — | — |
| Supabase Realtime | NOT used in Phase 4 | n/a | n/a | Phase 6 deliverable. |

**Missing dependencies with no fallback:**
- pg_cron — if Supabase Pro tier doesn't enable it for this account, planner must request enable OR descope D-67/D-72 channel 2 (banner + chip stay; channel 2 inbox messages defer to Phase 6 entirely).

**Missing dependencies with fallback:**
- recharts — straightforward npm install.

**Pre-Wave 0 verification task for planner:**
```bash
# Run against production Supabase to confirm pg_cron available
psql $DATABASE_URL -c "SELECT * FROM pg_available_extensions WHERE name = 'pg_cron';"
```

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 3 + @testcontainers/postgresql 11 |
| Config file | `vitest.config.ts` (testTimeout 30s, single fork, ephemeral schemas) |
| Quick run command | `pnpm test -- tests/integration/<test>.test.ts` |
| Full suite command | `pnpm test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TRAIN-04 (D-60) | quality_score stored 1-10, rendered 5-star | unit | `pnpm test -- tests/unit/quality-score-mapping.test.ts` | ❌ Wave 0 |
| TRAIN-04 (D-61) | Score visibility — staff write, player+parent read own | integration (RLS) | `pnpm test -- tests/integration/session-participants-rls.test.ts` | ❌ Wave 0 |
| TRAIN-04 (D-62) | Single combined attendance + score form upsert | integration | `pnpm test -- tests/integration/training-mark-attendance.test.ts` | ❌ Wave 0 |
| TRAIN-04 (D-64) | 14d absolute wall — no TD override | integration | `pnpm test -- tests/integration/training-score-window.test.ts` | ❌ Wave 0 (boundary tests: day 13, day 14, day 14+1s, day 15) |
| TRAIN-05 (D-82) | per-occurrence rows on session_participants | integration | `pnpm test -- tests/integration/session-participants-occurrence.test.ts` | ❌ Wave 0 |
| TRAIN-06 (D-63) | session_sparring_partners junction + RLS Branch 6 | integration (RLS) | `pnpm test -- tests/integration/sparring-partner-rls.test.ts` | ❌ Wave 0 |
| TOURN-03 (D-70) | 9-level outcome_level lookup seed | unit | `pnpm test -- tests/unit/outcome-level-seed.test.ts` | ❌ Wave 0 |
| TOURN-04 (D-81) | sets_won/sets_lost set-tally; derived won/lost | unit + integration | `pnpm test -- tests/unit/match-result-derived.test.ts && pnpm test -- tests/integration/tournament-enter-result.test.ts` | ❌ Wave 0 |
| TOURN-05 (D-69) | atomic {outcome, matches[]} entry; rollback on partial failure | integration | `pnpm test -- tests/integration/tournament-atomicity.test.ts` | ❌ Wave 0 |
| TOURN-05 (D-71) | 14d player window | integration | `pnpm test -- tests/integration/tournament-entry-window.test.ts` | ❌ Wave 0 |
| TOURN-05 (D-73) | asymmetric backfill — trainer/TD anytime after wall | integration (RBAC) | `pnpm test -- tests/integration/tournament-backfill-rbac.test.ts` | ❌ Wave 0 |
| TOURN-05 (D-75) | TD unconditional overwrite | integration | `pnpm test -- tests/integration/tournament-td-overwrite.test.ts` | ❌ Wave 0 |
| TOURN-02 (D-78) | academy-wide visibility (5-branch UNION) | integration (RLS) | `pnpm test -- tests/integration/tournament-result-rls.test.ts` | ❌ Wave 0 |
| TOURN-02 (D-79) | TD-only tournament creation + participant registration | integration (RBAC) | `pnpm test -- tests/integration/tournament-create-rbac.test.ts` | ❌ Wave 0 |
| RANK-01 (D-86) | split-column XOR CHECK constraint | integration | `pnpm test -- tests/integration/ranking-xor-constraint.test.ts` | ❌ Wave 0 (both columns null → reject; both filled → reject; correct shape per value_shape) |
| RANK-06 (D-89) | player + TD only entry RBAC | integration (RBAC) | `pnpm test -- tests/integration/ranking-entry-rbac.test.ts` | ❌ Wave 0 |
| RANK-07 (D-87) | distinct chart widgets per shape | UI / Playwright | `pnpm test:e2e -- tests/e2e/rankings-tab.spec.ts` | ❌ Wave 0 |
| TRAIN-03 (D-84) | RRULE 3 edit scopes — single / this-and-future / all-in-series | unit + integration | `pnpm test -- tests/unit/split-rrule.test.ts && pnpm test -- tests/integration/recurring-edit-scopes.test.ts` | ❌ Wave 0 |
| TRAIN-03 (D-85) | BYDAY multi-day RRULE serialization | unit | `pnpm test -- tests/unit/rrule-byday.test.ts` | ❌ Wave 0 |
| DOM-RESULT-02 | entered_by attribution | unit | `pnpm test -- tests/unit/entered-by-derivation.test.ts` | ❌ Wave 0 |
| DOM-CAT-02 | age_category snapshot at tournament start | integration | `pnpm test -- tests/integration/age-category-snapshot.test.ts` | ❌ Wave 0 |
| DOM-MED-CONFLICT-01 | training session conflict warning on medical overlap | integration (reuses Phase 3 helper) | `pnpm test -- tests/integration/training-medical-conflict.test.ts` | ❌ Wave 0 |
| DOM-MED-CONFLICT-02 | attendance defaults to "absent with valid reason" | integration | `pnpm test -- tests/integration/attendance-medical-default.test.ts` | ❌ Wave 0 |
| VALID-07 | unique constraint on match_results composite | integration | `pnpm test -- tests/integration/match-result-unique.test.ts` | ❌ Wave 0 |
| VALID-08 | idempotency 24h dedup | integration | `pnpm test -- tests/integration/idempotency-tournament.test.ts && pnpm test -- tests/integration/idempotency-ranking.test.ts` | ❌ Wave 0 |
| GDPR-04 | audit_log on every Phase 4 mutation | integration | `pnpm test -- tests/integration/phase4-audit.test.ts` | ❌ Wave 0 |
| I18N-05..08 | message catalog completeness for nl/en/fr | unit | `pnpm test -- tests/unit/i18n-catalog-completeness.test.ts` | ❌ Wave 0 (extends existing test if present) |

### Sampling Rate
- **Per task commit:** `pnpm test -- tests/integration/<affected-test>.test.ts` (single file, <30s on testcontainer)
- **Per wave merge:** `pnpm test -- tests/integration/` + `pnpm test -- tests/unit/` (full integration + unit, ~3-5min)
- **Phase gate:** Full suite green before `/gsd-verify-work` (`pnpm test` + `pnpm test:e2e -- tests/e2e/rankings-tab.spec.ts`)

### Wave 0 Gaps
- [ ] `tests/unit/quality-score-mapping.test.ts` — covers TRAIN-04 D-60
- [ ] `tests/integration/session-participants-rls.test.ts` — covers TRAIN-04 D-61
- [ ] `tests/integration/training-mark-attendance.test.ts` — covers TRAIN-04 D-62 (upsert semantics, race condition via PITFALL 6)
- [ ] `tests/integration/training-score-window.test.ts` — covers D-64 boundary cases (day 13, 14 exact, 14+1s, 15)
- [ ] `tests/integration/session-participants-occurrence.test.ts` — covers D-82 per-occurrence
- [ ] `tests/integration/sparring-partner-rls.test.ts` — covers D-63 + new RLS Branch 6
- [ ] `tests/unit/outcome-level-seed.test.ts` — covers D-70 9 codes + sort_order
- [ ] `tests/unit/match-result-derived.test.ts` — covers D-81 set-tally derived won/lost
- [ ] `tests/integration/tournament-enter-result.test.ts` — covers D-69+D-80 happy path
- [ ] `tests/integration/tournament-atomicity.test.ts` — covers D-69 rollback on partial failure
- [ ] `tests/integration/tournament-entry-window.test.ts` — covers D-71 14d player wall
- [ ] `tests/integration/tournament-backfill-rbac.test.ts` — covers D-73 trainer/TD anytime
- [ ] `tests/integration/tournament-td-overwrite.test.ts` — covers D-75
- [ ] `tests/integration/tournament-result-rls.test.ts` — covers D-78 5-branch UNION
- [ ] `tests/integration/tournament-create-rbac.test.ts` — covers D-79 TD-only creation
- [ ] `tests/integration/ranking-xor-constraint.test.ts` — covers D-86 XOR CHECK
- [ ] `tests/integration/ranking-entry-rbac.test.ts` — covers D-89 player + TD only
- [ ] `tests/unit/split-rrule.test.ts` — covers splitRRule() math for D-84
- [ ] `tests/integration/recurring-edit-scopes.test.ts` — covers all 3 scopes for both training_sessions and meetings; verifies past session_participants UNTOUCHED
- [ ] `tests/unit/rrule-byday.test.ts` — covers D-85 BYDAY multi-day serialization
- [ ] `tests/unit/entered-by-derivation.test.ts` — covers entered_by attribution
- [ ] `tests/integration/age-category-snapshot.test.ts` — covers DOM-CAT-02
- [ ] `tests/integration/training-medical-conflict.test.ts` — covers DOM-MED-CONFLICT-01 (form-time warning)
- [ ] `tests/integration/attendance-medical-default.test.ts` — covers DOM-MED-CONFLICT-02 default
- [ ] `tests/integration/match-result-unique.test.ts` — covers VALID-07 composite unique
- [ ] `tests/integration/idempotency-tournament.test.ts` — covers VALID-08 tournament dedup
- [ ] `tests/integration/idempotency-ranking.test.ts` — covers VALID-08 ranking dedup
- [ ] `tests/integration/phase4-audit.test.ts` — covers GDPR-04 audit on every mutation
- [ ] `tests/e2e/rankings-tab.spec.ts` — covers D-87+D-88+D-90 chart rendering (Playwright)
- [ ] Optional: `tests/integration/rbac-matrix-phase4.test.ts` — 7 roles × 5 new tables × CRUD (subset matrix)
- [ ] Optional: `tests/integration/pg-cron-nudge.test.ts` — verify pg_cron job runs (gated on pg_cron available)

**Framework setup:** No framework install needed; Vitest + testcontainers already wired Phase 1. New helpers: `tests/fixtures/phase4-seed.ts` mirroring `tests/fixtures/calendar-seed.ts` from Phase 3.

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | reused | Better Auth 1.6 (Phase 1) — no changes |
| V3 Session Management | reused | Better Auth session cookies (Phase 1) — no changes |
| V4 Access Control | YES (NEW logic) | 3 new RLS helpers (session_participants_visible_to, tournament_result_visible_to, ranking_entry_visible_to) + extension of calendar_events_visible_to with sparring branch; tRPC procedure presets (`trainerOrTdProcedure`); 14-day wall (D-64, D-71); asymmetric backfill (D-73); TD unconditional overwrite (D-75) — all enforced at API + DB |
| V5 Input Validation | YES | Zod v4 schemas for every input. `errors.*.<key>` i18n keys. Discriminated unions for ranking value (numeric vs classification). |
| V6 Cryptography | not applicable in Phase 4 | No new sensitive fields; medical data is Phase 5. |
| V7 Error Handling | YES | All errors use i18n keys; PII redaction via pino redact filter (Phase 1) — no new redact rules needed; audit_log captures denied-outcome events. |
| V11 Business Logic | YES | 14-day walls, asymmetric backfill, idempotency keys, DOM-CAT-02 snapshot, D-78 academy-wide visibility — all business-logic gates at API layer. |
| V13 API and Web Service | YES | tRPC over HTTP; CSRF protection from Phase 1; rate-limit middleware from Phase 1 — Phase 4 inherits. |

### Known Threat Patterns for Phase 4

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Mass-tournament-result enumeration via D-78 academy peer branch | Information Disclosure | RLS scoping is academy-wide BY DESIGN per D-78. Acceptable threat. Document. |
| Player forging tournament_results for another player | Tampering | RLS INSERT WITH CHECK `player_user_id = current_user_id() OR caller_role IN ('trainer','technical_director')`; tRPC layer also gates via `entered_by` derivation. |
| Trainer scoring sessions outside their academy | Tampering | RLS on session_participants: WITH CHECK `EXISTS (SELECT 1 FROM training_sessions ts JOIN academy_memberships am ON am.user_id = current_user_id() AND am.academy_code IN (SELECT academy_code FROM academy_memberships WHERE user_id = ts.trainer_id) WHERE ts.event_id = NEW.event_id)`. |
| Ranking entry direction-flip exploitation (Belgium NC marked as "best") | Tampering | DB-level CHECK XOR + app-layer value_shape cross-check; sort_order strictly defines ordinal across tiers. |
| Idempotency key replay attack (same key, different payload) | Tampering | `idempotency_keys.response_hash` records sha256 of first response; mismatch on replay → reject (Phase 1 design — Plan 14 spec). |
| Score window bypass via direct SQL | Elevation of Privilege | RLS UPDATE policy on session_participants additionally checks `now() - (SELECT ends_at FROM calendar_events WHERE id = NEW.event_id) <= INTERVAL '14 days'`. Defense in depth — even if tRPC bypassed, DB rejects. |
| Cross-tenant data leak via SECURITY DEFINER | Information Disclosure | All new SECURITY DEFINER fns lock `SET search_path = pg_catalog, public` (Phase 1+3 pattern); REVOKE PUBLIC + GRANT app_user only. |
| Audit_log tampering on 14d-wall denial | Repudiation | audit_log table has REVOKE UPDATE/DELETE from app_user (Phase 1) — append-only. |
| pg_cron job runs as elevated role | Elevation of Privilege | cron jobs use SECURITY DEFINER functions with explicit search_path; outputs ONLY into system_inbox (read-only for app_user). |

---

## Risks and Unknowns (Phase 4-specific)

| Risk | Severity | Description | Mitigation |
|------|----------|-------------|------------|
| pg_cron unavailable on production Supabase Pro tier | HIGH | If not enabled, D-67/D-72 channel 2 (daily inbox messages) cannot ship. | Verify before Wave 0 via `SELECT * FROM pg_available_extensions WHERE name = 'pg_cron'`; if missing, request Supabase enable; fall back to BullMQ recurring job (less ideal but workable). |
| Phase 6 inbox dependency | MEDIUM | D-67/D-72 channel 2 needs an inbox table; Phase 6 owns the full inbox. | Ship minimal `system_inbox` in Phase 4; Phase 6 migrates/extends. Surface decision in discuss-phase or first task. |
| Derived won/lost performance under load | LOW | `sets_won > sets_lost` computed at every query may add cost on large datasets. | Generated column option in PostgreSQL 16 (`won boolean GENERATED ALWAYS AS (sets_won > sets_lost) STORED`) if perf measured; defer unless EXPLAIN ANALYZE shows slow. |
| RLS UNION performance for D-78 5-branch query | MEDIUM | Tournament list with many players may stress 5-branch union. | EXPLAIN ANALYZE during Wave 0; add composite index `(academy_code, role)` if needed. |
| Belgium classification authoritative source | MEDIUM | A1..A50 ceiling and exhaustive code list not verified against KBTTB. | Block 0017 seed migration until user/TD confirms canonical list; or ship reasonable default + ALTER seeds later via expand-contract. |
| RRULE split-and-rewrite EXDATE migration | LOW | EXDATEs on dates ≥ splitDate become inert on the old event (which now has UNTIL < that date). | Recommended: zombie — leave inert. Document predicate in commit. Add test asserting expansion ignores inert exceptions. |
| Race condition on per-occurrence attendance | LOW | Two trainers submitting same `(event_id, occurrence_date)` concurrently. | ON CONFLICT DO UPDATE + audit log capture (Pitfall 6). Integration test required. |
| recharts v3 + React 19 + Tailwind 4 unknown interaction | LOW | recharts 3.8.1 released after React 19 GA; minor incompatibilities possible. | Wave 0 smoke test: render trivial `<LineChart>` in a Playwright e2e test; bail to chart.js if broken. |
| Phase 4 plan may accidentally rewrite Phase 3 extension tables | MEDIUM | D-51 schema-freeze contract explicit; planner could still slip. | Phase 4 migrations have NO ALTER on calendar_events / calendar_event_participants / calendar_event_exceptions / the 6 extension tables. Migration linter test asserts this. |
| Idempotency middleware missing — VALID-08 not enforced | MEDIUM | Phase 1 left table but possibly no middleware. | First Phase 4 task verifies + ships middleware. Pitfall 5 documented. |
| Phase 3 sparring-partner placeholder lurks — Phase 4 must close | LOW | Phase 3 left `calendar_events_visible_to` with a commented-out sparring branch. | Phase 4 0018 migration extends function; integration test for D-50 sparring-partner branch (D-63 RLS test from Phase Requirements). |
| BYDAY+FREQ=WEEKLY only — UI must enforce | LOW | D-85 allows BYDAY only with FREQ=WEEKLY. RruleEditor must prevent BYDAY+FREQ=MONTHLY. | Client-side disable + server-side Zod validation: `if (input.byday && input.freq !== 'WEEKLY') reject`. |

---

## Dependencies on Prior Phases

| Phase 1/2/3 Artifact | Status | Used By Phase 4 For | Failure Mode If Missing |
|----------------------|--------|---------------------|-------------------------|
| `users` table with `role` enum (incl. `sparring_partner`) | ✓ shipped | FK target for session_participants.user_id, session_sparring_partners.sparring_partner_id, tournament_results.player_user_id, ranking_entries.player_user_id, entered_by | Phase 4 cannot start — block. |
| `academy_memberships` (Phase 1) | ✓ shipped | D-78 academy-peer visibility, D-61 academy_manager read scope, D-73 trainer-in-academy check | Phase 4 cannot ship D-78 RLS. |
| `parent_child_links` (Phase 1) | ✓ shipped | D-61 parent reads own child's quality_score, D-78 parent reads minor's results | Visibility for parents broken. |
| `audit_log` + `writeAudit()` middleware (Phase 1) | ✓ shipped | GDPR-04 audit on every mutation, D-75 TD overwrite trail, D-76 forensic recovery | Forensic recovery + GDPR Article 30 trail broken. |
| `idempotency_keys` table (Phase 1) | ✓ shipped (table) | VALID-08 | Idempotency table OK; **middleware verified absent** — Phase 4 builds (Pitfall 5). |
| `protectedProcedure` / `tdProcedure` / `requireRole` (Phase 1) | ✓ shipped | All Phase 4 procedure presets; Phase 4 adds `trainerOrTdProcedure` | Cannot enforce RBAC. |
| `withRlsContext` middleware (Phase 1) | ✓ shipped | RLS-bound tx per request; sets `app.user_id` / `app.user_role` GUCs | Phase 4 cannot use RLS — block. |
| `current_user_id()` / `current_user_role()` STABLE wrappers (Phase 1) | ✓ shipped | RLS policy expressions | Phase 4 RLS broken. |
| `players` table + `getAgeCategoryAt(playerId, date)` helper (Phase 2) | ✓ shipped | DOM-CAT-02 snapshot on tournament_results | Snapshot column unfillable. |
| `trainers` table (Phase 2) | ✓ shipped | FK target for `training_sessions.trainer_id` (Phase 3) — Phase 4 transitive reads only | — |
| `calendar_events` base + extension tables (Phase 3) | ✓ shipped | All Phase 4 FK targets: `tournament_results.tournament_event_id → calendar_events`, `session_participants.event_id → calendar_events`, etc. | Phase 4 cannot start — block. |
| `calendar_events_visible_to(uid, role)` SECURITY DEFINER (Phase 3) | ✓ shipped (with sparring placeholder) | Phase 4 extends — fills sparring_partner UNION branch via 0018 migration | Sparring-partner role sees no events. |
| `overlapping_events_for_users(uuid[], tstzrange[])` SECURITY DEFINER (Phase 3 — fixed in 0013) | ✓ shipped | DOM-MED-CONFLICT-01 form-time conflict check on training-session create | Cannot warn trainer of medical overlaps. |
| `parseRrule`, `expandRrule`, `ensureHorizon`, `validateHorizon`, `formatOccurrenceDate` (Phase 3) | ✓ shipped | Phase 4 `splitRRule()` builds on parseRrule + RRule.optionsToString | Cannot ship D-84. |
| `RruleEditor` Client Component (Phase 3 path `src/components/common/rrule-editor.tsx`) | ✓ shipped (scope picker placeholders disabled per UI3-D12) | Phase 4 enables disabled scope options + adds BYDAY checkboxes (D-85) | — |
| `EventDetailSheet` (Phase 3) | ✓ shipped | Phase 4 adds "Open scoring" CTA for training_session events when caller is trainer + within 14d | — |
| Lookup tables: `outcomeLevel`, `rankingType`, `trainingType`, `organisation`, `tournamentType` (empty, declared by Phase 1) | ✓ schema declared | Phase 4 0017 SEEDS via the existing empty tables | If tables don't exist, 0017 fails — verify. |
| `audit_log.outcome` column (Phase 1) | ✓ shipped | Phase 4 writes outcome='denied' on 14d wall rejections (Pitfall 3, observability) | Without it, wall rejections silent. |
| `next-intl` infrastructure + nl/en/fr message catalogs (Phase 1) | ✓ shipped | Phase 4 extends catalogs with `training.*`, `tournament.*`, `ranking.*`, errors, lookup labels | If missing, UI strings hard-coded. |
| `formatDate()`, `formatNumber()` from `src/lib/i18n-format.ts` (Phase 1) | ✓ shipped | Ranking timeline year labels, score capture timestamps, match datum | — |
| Vitest + testcontainers test infrastructure (Phase 1) | ✓ shipped | All Phase 4 integration tests | Cannot run integration tests. |
| `idempotency_keys` row INSERT pattern + 24h expiry (Phase 1 plan 14 design) | ⚠ partial | Phase 4 ships middleware per Pitfall 5 | — |

**Critical pre-Phase-4 verification (first task):**
1. Confirm `idempotency_keys` table exists: `\d idempotency_keys`
2. Confirm sparring_partner role exists: `SELECT enumlabel FROM pg_enum WHERE enumtypid = 'user_role'::regtype`
3. Confirm Phase 3 calendar tables: `\d calendar_events`, `\d training_sessions`, `\d tournaments`
4. Confirm Phase 3 RLS helpers: `\df calendar_events_visible_to`, `\df overlapping_events_for_users`
5. Confirm pg_cron extension: `SELECT * FROM pg_available_extensions WHERE name = 'pg_cron'` (if absent → A3 mitigation)
6. Confirm `getAgeCategoryAt` helper: `grep -n 'getAgeCategoryAt' src/lib/players.ts` (✓ verified line 97)

---

## Multilingual Catalog Extensions

Estimated keys per namespace (per phase requirements section §19 in spec):
- `training.*` — ~50 keys (form labels, table headers, banner copy, escalating-tone copy at day 7/10/12)
- `tournament.*` — ~40 keys (form labels, match-row labels, "Te scoren" widget copy)
- `ranking.*` — ~30 keys (chart labels, axis labels, ranking-type tabs, range selector pills)
- `errors.training.scoreWindowExpired` — 1 key × 3 locales
- `errors.tournament.entryWindowExpired` — 1 key × 3 locales
- `errors.tournament.atLeastOneMatchRequired` — 1 key × 3 locales
- `errors.ranking.unknownType` — 1 key × 3 locales
- `errors.ranking.expectedNumeric` — 1 key × 3 locales
- `errors.ranking.expectedClassification` — 1 key × 3 locales
- `lookup.outcomeLevel.*` — 9 codes × 3 locales = 27 keys
- `lookup.belgiumClassification.*` — ~25 codes (A1..A50, B0..B6, C0..C6, D0..D6, E0..E6, NC) × 3 locales = ~75 keys (but A1..A50 share localizable labels — likely just code-as-label, no translation needed; per I18N-06 proper nouns/classification codes are stored canonical)
- `lookup.trainingType.*` — 4 codes × 3 locales = 12 keys
- `lookup.organisation.*` — 6 codes × 3 locales = 18 keys
- `lookup.tournamentType.*` — 7 codes × 3 locales = 21 keys
- `lookup.rankingType.*` — 5 codes × 3 locales = 15 keys

**Total estimate:** ~270-350 new keys per locale = 810-1050 total new lines across nl/en/fr. messages/*.json currently ~442 lines each.

**Chunking strategy:** Add all Phase 4 keys in a single migration commit (`feat(messages-phase4): add 800+ keys for trainings, tournaments, rankings`). Verify against `tests/unit/i18n-catalog-completeness.test.ts` (or create) that all three files have the same key set.

**Recommendation:** Belgium classification codes (A1..A50, NC, etc.) are likely **not translated** per I18N-06 ("proper nouns not translated") — same canonical label in all three locales. Confirm with discuss-phase before Wave that touches catalogs.

---

## Sources

### Primary (HIGH confidence)
- `src/server/db/schema/calendar.ts` — Phase 3 table refs (verified locally) [VERIFIED: codebase grep]
- `src/server/db/schema/lookups.ts` — declared empty lookup tables for Phase 4 to seed [VERIFIED]
- `src/server/db/schema/audit.ts` — audit_log shape [VERIFIED]
- `src/server/db/schema/idempotency.ts` — idempotency_keys table [VERIFIED]
- `src/server/trpc/middleware/audit.ts` — writeAudit helper [VERIFIED]
- `src/server/trpc/middleware/rls.ts` — withRlsContext middleware [VERIFIED]
- `src/server/trpc/middleware/freshSession.ts` — procedure preset patterns [VERIFIED]
- `src/server/trpc/middleware/calendarCreate.ts` — per-event-type RBAC pattern [VERIFIED]
- `src/server/trpc/routers/calendar.ts` — 9 Phase 3 procedures incl. tx pattern + audit pattern [VERIFIED]
- `src/lib/rrule.ts` — parseRrule + expandRrule + ensureHorizon [VERIFIED]
- `src/lib/players.ts` — getAgeCategoryAt at line 97 [VERIFIED]
- `src/lib/i18n-format.ts` — formatDate / formatNumber [VERIFIED]
- `drizzle/0009_phase3_calendar_base_lookup_participants_exceptions.sql` [VERIFIED]
- `drizzle/0010_phase3_calendar_extension_tables.sql` [VERIFIED]
- `drizzle/0011_phase3_calendar_rls_policies.sql` — sparring placeholder at line 140-145 [VERIFIED]
- `drizzle/0013_phase3_calendar_function_fixes.sql` — overlapping_events_for_users signature [VERIFIED]
- `.planning/phases/04-kerndomein/04-CONTEXT.md` — 32 decisions D-60..D-91 [VERIFIED]
- `.planning/phases/03-kalender/03-CONTEXT.md` — D-47..D-58 carry-forward [VERIFIED]
- `.planning/phases/03-kalender/03-RESEARCH.md` — Phase 3 patterns reference [VERIFIED]
- `.planning/REQUIREMENTS.md` — TRAIN/TOURN/RANK/DOM REQs [VERIFIED]
- npm view rrule version → 2.8.1 (published 2023-11-10) [VERIFIED: 2026-05-16]
- npm view recharts version → 3.8.1 [VERIFIED: 2026-05-16]
- `package.json` — dependency versions [VERIFIED]

### Secondary (MEDIUM confidence)
- Supabase pg_cron documentation (cron.schedule, UTC-only) [CITED: supabase.com/docs/guides/cron, supabase.com/docs/guides/database/extensions/pg_cron, github.com/orgs/supabase/discussions/7892]
- Belgium table tennis classification system (B0..B6, C0..C6, D0+, E4/E6/NC) [CITED: aftt.be/grille-classements.pdf 2025-02, xolay.com/table-tennis-rankings/men-single-belgium, tennis2table.com forum]
- rrule package docs (RRule.optionsToString, origOptions, fromString, parseString) [CITED: github.com/jakubroztocil/rrule via WebFetch]
- recharts YAxis reversed prop [CITED: recharts.github.io/en-US/api/YAxis/]
- pg_cron official repo / docs [CITED: github.com/citusdata/pg_cron]
- bump chart pattern for ranking visualization [CITED: domo.com/learn/charts/bump-charts]

### Tertiary (LOW confidence — flag for validation)
- A1..A50 ceiling on Belgium classification (D-86 lookup seed). Not directly verified against KBTTB official source — block 0017 seed migration until user/TD confirms list. [ASSUMED]
- Belgium tier band colors (A=gold/B=silver/C=bronze/D=grey/E=light grey/NC=white) — CONTEXT specifies but VTTL design system tokens not defined yet. [ASSUMED]
- Supabase Pro tier pg_cron availability at this specific account — verification task in pre-Wave 0. [ASSUMED-UNTIL-VERIFIED]
- ranking_entries.value_numeric for international rankings is a positive integer (current rank 1..n); decimal values not used. [ASSUMED based on standard practice — confirm with discuss-phase if Elo-style ratings ever appear]

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — rrule 2.8.1 already used Phase 3; recharts 3.8.1 verified current latest; pg_cron documented Supabase Pro extension.
- Architecture patterns: HIGH — direct extensions of Phase 3 patterns; RLS function shape mirrors `calendar_events_visible_to`; transaction patterns mirror `event.create` and `event.delete`.
- Pitfalls: HIGH — derived from concrete Phase 3 review fixes (CR-01..CR-05, WR-01..WR-09) + DST/timezone code in lib/rrule.ts + idempotency table verified empty middleware-side.
- Belgium classification details: MEDIUM — published Belgium ranking tier structure verified via multiple sources but A1..A50 ceiling not authoritatively confirmed.
- pg_cron timezone math: MEDIUM — Supabase docs confirm UTC-only; DST workaround pattern documented but specific implementation choice deferred to planner.
- Phase 6 inbox dependency: LOW until user confirms — flagged as open question.

**Research date:** 2026-05-16
**Valid until:** 2026-06-15 (30 days for stable infra; re-verify before any major dependency upgrade)

---

## RESEARCH COMPLETE

**Phase 4 builds the operational sports management layer atop Phase 3's polymorphic calendar.** The work is well-bounded: 6 new tables, 3 RLS helpers + 1 extension, 3 tRPC routers + 1 extension, 1 RRULE helper, 2 chart components, 1 minimal inbox stub, 2 pg_cron jobs, ~300 i18n keys across nl/en/fr. The architecture is a straight extension of Phase 3 patterns — class-table inheritance, SECURITY DEFINER UNION RLS, server-side RRULE expansion, audit on every mutation, RLS-bound transactions, Drizzle migrations with rollback companions. The five hardest problems (RRULE split-and-rewrite, 14-day wall, atomic tournament-result entry, split-column XOR ranking schema, pg_cron 18:00-Brussels nudging) all have concrete code shapes in this research. **Two decisions remain open for the planner to surface in discuss/wave-0:** (1) ship minimal `system_inbox` in Phase 4 or defer channel 2 to Phase 6 (recommendation: ship minimal — A7); (2) authoritative Belgium classification seed list confirmation (recommendation: block 0017 until user/TD signs off — A2). Three pre-Wave-0 verifications are required: idempotency middleware presence (Pitfall 5), pg_cron extension availability (A3), and Phase 3 schema artifacts (calendar_events_visible_to placeholder, overlapping_events_for_users signature). Tests cover 28 integration scenarios + ~8 unit scenarios + 1 e2e — all directly traceable to phase requirements per the Validation Architecture map.
