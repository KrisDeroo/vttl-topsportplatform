---
phase: 04
slug: kerndomein
mapped: 2026-05-16
---

# Phase 4: Kerndomein — Pattern Map

**Mapped:** 2026-05-16
**Files analyzed:** ~75 new + ~6 modified
**Analogs found:** 58 / 75 (17 net-new patterns — splitRRule math, split-column XOR ranking, recharts inversion, Belgium tier-band timeline, custom 5-star input, pg_cron 18:00 Brussels job, "Te scoren" widget, minimal system_inbox, idempotency middleware, yellow ⚠ chip overlay, RruleScopePickerDialog, BYDAY MultiDayPicker)

This map answers, per Phase 4 file: which existing Phase 1/2/3 file does the planner copy from, which lines specifically, and which patterns have no analog in the codebase yet. Every locked decision D-60..D-91 from `04-CONTEXT.md` and every Wave 0 test file from `04-VALIDATION.md` has a row in §File Classification or §No Analog Found.

The pattern density is **very high** because Phase 4 is overwhelmingly an *extension* of Phase 3's polymorphic event scaffold — same schema-discipline split (DDL / RLS / seed migrations), same Drizzle pgTable barrel shape, same tRPC procedure preset composition, same audit-log discipline, same `.strict()` Zod schemas with i18n error keys, same Server-shell + Client-leaf component split. The truly net-new surfaces are: the RRULE split-and-rewrite math (D-84), the split-column XOR ranking schema with global ordinal sort (D-86), the recharts integration (D-87..D-90), the pg_cron 18:00-Brussels nudge jobs (D-67/D-72), and the minimal `system_inbox` stub. Everything else copies patterns directly from Phase 3.

---

## File Classification

### Migrations (drizzle/, additive DDL + seeds + RLS extensions + cron + each with rollback companion)

| New file | Role | Data Flow | Closest Analog | Match |
|----------|------|-----------|----------------|-------|
| `drizzle/0014_phase4_session_participants_and_sparring_junction.sql` | migration / additive DDL | CREATE 2 tables + indexes + CHECK | `drizzle/0009_phase3_calendar_base_lookup_participants_exceptions.sql` (composite-PK junction shape) + `drizzle/0006_phase2_profiles_and_files.sql` sections 3-4 (FK-CASCADE to base) | exact (composite PK `(event_id, occurrence_date, user_id)` mirrors Phase 3 `calendar_event_participants` `(event_id, user_id)`) |
| `drizzle/0014_*.rollback.md` | migration / rollback companion | n/a | `drizzle/0009_phase3_calendar_base_lookup_participants_exceptions.rollback.md` | exact (Risk / Procedure / Verification headers required by `tests/unit/migration-format.test.ts`) |
| `drizzle/0015_phase4_tournament_results_and_match_results.sql` | migration / additive DDL | CREATE 2 tables + FK + CHECK + UNIQUE (VALID-07) | `drizzle/0010_phase3_calendar_extension_tables.sql` (extension-table-with-FK-CASCADE-to-base + per-section header pattern) | role-match (parent table is `calendar_events`/`tournaments` instead of users; structure identical) |
| `drizzle/0015_*.rollback.md` | migration / rollback companion | n/a | `drizzle/0010_phase3_calendar_extension_tables.rollback.md` | exact |
| `drizzle/0016_phase4_rankings_and_belgium_classification.sql` | migration / additive DDL | CREATE 1 lookup + 1 timeseries table + CHECK XOR + ALTER ranking_type ADD COLUMN value_shape | `drizzle/0009_*.sql` (lookup-then-FK pattern) + `drizzle/0006_phase2_profiles_and_files.sql` (multi-section additive DDL) | role-match (split-column XOR CHECK is net-new — see No Analog Found §splitRRule and §rankingXor) |
| `drizzle/0016_*.rollback.md` | migration / rollback companion | n/a | `drizzle/0010_*.rollback.md` | exact |
| `drizzle/0017_phase4_lookup_seeds.sql` | migration / seed data | INSERT ON CONFLICT DO NOTHING (6 lookups) | `drizzle/0008_phase2_lookup_seed.sql` + `drizzle/0012_phase3_event_type_seed.sql` | exact (same `INSERT … ON CONFLICT (code) DO NOTHING` idempotent shape; multi-lookup-per-migration matches 0008) |
| `drizzle/0017_*.rollback.md` | migration / rollback companion | n/a | `drizzle/0008_phase2_lookup_seed.rollback.md` | exact |
| `drizzle/0018_phase4_rls_helpers_and_sparring_branch.sql` | migration / DDL — RLS policies + 3 new SECURITY DEFINER fns + EXTEND `calendar_events_visible_to` | DDL — policy + function + CREATE OR REPLACE | `drizzle/0011_phase3_calendar_rls_policies.sql` (full RLS migration pattern) + `drizzle/0013_phase3_calendar_function_fixes.sql` (CREATE OR REPLACE on existing fn pattern) | exact (per-action policies; FORCE RLS; `SECURITY DEFINER SET search_path = pg_catalog, public`; REVOKE PUBLIC + GRANT app_user) |
| `drizzle/0018_*.rollback.md` | migration / rollback companion | n/a | `drizzle/0011_*.rollback.md` + `drizzle/0013_*.rollback.md` | exact (include "restore calendar_events_visible_to without sparring branch" verification step) |
| `drizzle/0019_phase4_pg_cron_nudges.sql` | migration / DDL — pg_cron job schedule + SECURITY DEFINER nudge functions | one-shot `cron.schedule(...)` + CREATE FUNCTION | **no analog — first pg_cron usage in repo** (verified: no `cron.schedule` or `pg_cron` in any migration). Closest analog: `drizzle/0011_*.sql` SECURITY DEFINER REVOKE/GRANT discipline | no analog — reference RESEARCH §Pitfall 2 (DST-safe dual-schedule) + RESEARCH §Pattern §pg_cron |
| `drizzle/0019_*.rollback.md` | migration / rollback companion | n/a | `drizzle/0011_*.rollback.md` (pattern only — content is `cron.unschedule(...)`) | partial (rollback procedure must call `cron.unschedule('daily_trainer_score_nudge')` + `cron.unschedule('daily_player_tournament_result_nudge')`) |
| `drizzle/0020_phase4_system_inbox.sql` (optional — planner may fold into 0019) | migration / additive DDL | CREATE 1 table + index | `drizzle/0009_*.sql` minimal additive shape | exact |
| `drizzle/0020_*.rollback.md` | migration / rollback companion | n/a | `drizzle/0009_*.rollback.md` | exact |

### Drizzle schema files (src/server/db/schema/)

| New/Modified file | Role | Data Flow | Closest Analog | Match |
|-------------------|------|-----------|----------------|-------|
| `src/server/db/schema/training.ts` (NEW — `session_participants` + `session_sparring_partners`) | schema / pgTable barrel | static schema declarations | `src/server/db/schema/calendar.ts` (multi-table-in-one-file with FK to base) | exact (same `tstz` helper, `(t) => [...]` constraint form, `primaryKey({ columns: [...] })` composite PK from `calendar_event_participants` lines 94-119) |
| `src/server/db/schema/tournament.ts` (NEW — `tournament_results` + `match_results`) | schema / pgTable barrel | static | `src/server/db/schema/calendar.ts` lines 175-189 (`tournaments` extension) for FK shape; `players.ts` for multi-table composition | exact |
| `src/server/db/schema/ranking.ts` (NEW — `ranking_entries`) | schema / pgTable | static with CHECK XOR | `src/server/db/schema/calendar.ts` lines 121-153 (`calendar_event_exceptions` with multi-line CHECK constraint via `sql\`…\``) | role-match (CHECK XOR shape is net-new in semantics; pgTable constraint syntax is identical) |
| `src/server/db/schema/inbox.ts` (NEW — `system_inbox` minimal Phase 4 stub) | schema / pgTable | static | `src/server/db/schema/idempotency.ts` (single-table file with jsonb payload + lifecycle) | exact (same `jsonb('response_body')` / `tstz('created_at', { defaultNow: true })` pattern) |
| `src/server/db/schema/lookups.ts` (MODIFY — add `belgiumClassification` table + `valueShape` column on `rankingType`) | schema / pgTable | static lookup | `lookups.ts` lines 48-53 (`rankingType` with `direction` extra column) + lines 88-94 (`ageCategories` with extra integer columns) | exact (in-file append; same naming `code text PK + sort_order int + active boolean`) |
| `src/server/db/schema/index.ts` (MODIFY — append `export * from './training'` / `'./tournament'` / `'./ranking'` / `'./inbox'`) | schema barrel re-export | static | self (line 24-34) | exact (append 4 lines below existing `./calendar`) |

### tRPC layer (src/server/trpc/)

| New/Modified file | Role | Data Flow | Closest Analog | Match |
|-------------------|------|-----------|----------------|-------|
| `src/server/trpc/routers/training.ts` (NEW — `markAttendanceAndScore`, `listPending`, `getSession`) | controller / tRPC router | request-response + CRUD + bulk-upsert | `src/server/trpc/routers/calendar.ts` (procedure presets, transaction shape, audit pattern, NOT_FOUND on RLS-filtered get) + `routers/player.ts` (multi-procedure router with audit) | exact (compose `protectedProcedure` + inline `requireRole`-style allowlist; tx → audit-after-commit pattern; per-procedure Zod input from `schemas/training.ts`) |
| `src/server/trpc/routers/tournament.ts` (NEW — `enterResult`, `listResults`, `listPendingForPlayer`, `create`, `list`, `get`, `addParticipant`, `removeParticipant`) | controller / tRPC router | request-response + atomic tx + idempotency | `src/server/trpc/routers/calendar.ts` event subgroup (`event.create` lines 491-700 — tx + audit + conflict probe + force-override pattern) | exact (atomic `{outcome, matches[]}` tx mirrors `event.create`'s tx-with-base-then-extension-then-junction shape; idempotency middleware composed per Pitfall 5) |
| `src/server/trpc/routers/ranking.ts` (NEW — `addEntry`, `getHistory`, `getCurrentByType`, `listEntries`) | controller / tRPC router | request-response + idempotency | `src/server/trpc/routers/player.ts` (multi-procedure read+write with audit) | role-match (no atomic-multi-row tx; single-table writes; value_shape cross-check is net-new app-layer Zod refinement — see RESEARCH §Pattern 4) |
| `src/server/trpc/routers/calendar.ts` (MODIFY — add `event.editRecurring({eventId, scope, edits})` procedure) | controller extension | request-response + split-and-rewrite tx | self (`event.update` lines 706-870 — same shape, scope branches inside the handler) | exact (extension on the existing router) |
| `src/server/trpc/routers/_app.ts` (MODIFY — register `training`/`tournament`/`ranking` sub-routers; optionally register `inbox` sub-router) | router composition | n/a | self (lines 33-49 — existing `appRouter = router({...})`) | exact (append 3-4 imports + 3-4 property lines) |
| `src/server/trpc/schemas/training.ts` (NEW — Zod input schemas for bulk attendance, listPending, getSession) | schema-input / Zod validation | static validation | `src/server/trpc/schemas/calendar.ts` (`.strict()`, i18n-key error messages, `participants: z.array(...)` shape) | exact |
| `src/server/trpc/schemas/tournament.ts` (NEW — Zod for `{outcome, matches: [{round, opponent, ...}]}` atomic input) | schema-input / Zod validation | static + cross-field `.refine()` | `src/server/trpc/schemas/calendar.ts` (per-type extension branches + `.refine()` for `endsAt > startsAt`) + `eventCreateInput` discriminated-union shape | role-match (single non-discriminated shape; `matches` is `z.array(matchSchema).min(1, {message: 'errors.tournament.atLeastOneMatchRequired'})` per D-69) |
| `src/server/trpc/schemas/ranking.ts` (NEW — Zod with `z.discriminatedUnion('kind', [numeric, classification])`) | schema-input / Zod validation | static | `src/server/trpc/schemas/calendar.ts` `eventCreateInput` (the `z.discriminatedUnion('type', [...])` pattern) | exact (discriminated union over `value.kind`) |
| `src/server/trpc/middleware/idempotency.ts` (NEW — VALID-08 wiring, Pitfall 5) | middleware / dedup gate | request gate | `src/server/trpc/middleware/calendarCreate.ts` (factory middleware that reads input) + `src/server/trpc/middleware/audit.ts` (write-back pattern after handler) | role-match (no idempotency middleware exists; the `idempotency_keys` table is shipped but unwired — see RESEARCH §Pitfall 5) |
| `src/server/trpc/middleware/scoreWindow.ts` (OPTIONAL — helper, not middleware) | utility / pure function | inline check + audit-on-denial | inline pattern in `routers/calendar.ts` `event.create` lines 503-508 (`canCreateEventType` inline gate) | role-match — recommend NOT making it a middleware (Pitfall 5 reasoning: depends on `eventId` input + DB read). Export a helper `assertScoreWindowOpen(db, eventId, ctx, errorKey)` |

### Domain helpers (src/lib/)

| New/Modified file | Role | Data Flow | Closest Analog | Match |
|-------------------|------|-----------|----------------|-------|
| `src/lib/rrule.ts` (MODIFY — add `splitRRule(oldRruleString, splitDate, oldDtstart)` per D-84) | utility / pure function | transform (origOptions ⊕ optionsToString) | self (`ensureHorizon` lines 324-343 — same `parseRrule(...).origOptions` then `RRule.optionsToString(rest)` shape) | exact for the shape; **net-new for the semantics** (split-at-occurrence is bespoke to D-84 — see No Analog Found §splitRRule) |
| `src/lib/calendar/conflicts.ts` (REUSE — no Phase 4 changes) | utility / pure transform | n/a | (existing — Phase 3) | exact reuse for DOM-MED-CONFLICT-01 form-time warning |
| `src/lib/players.ts` (REUSE — `getAgeCategoryAt(playerId, date)` at line 97 — Phase 2 helper, do NOT extend) | utility / DB read | request-response | self (line 97 — verified) | exact reuse (DOM-CAT-02 snapshot at tournament.startsAt) |
| `src/lib/i18n-format.ts` (REUSE — `formatDate`, `formatNumber`) | utility / formatter | n/a | self | exact reuse (Belgium timeline year labels; ranking value formatting) |

### Server + Client components (src/app/, src/components/)

| New/Modified file | Role | Data Flow | Closest Analog | Match |
|----------|------|-----------|----------------|-------|
| `src/app/[locale]/(app)/dashboard/page.tsx` (NEW — Server) | server-component / pre-fetch + role-conditional widget render | request-response | `src/app/[locale]/(app)/calendar/page.tsx` lines 22-100 (`createContext()` + `appRouter.createCaller(ctx)` + searchParams parsing) | exact (BLOCKER-03 canonical) |
| `src/app/[locale]/(app)/trainings/[eventId]/score/page.tsx` (NEW — Server shell with Client form leaf) | server-component / route-param fetch | request-response | `src/app/[locale]/(app)/calendar/page.tsx` (Server pattern) | role-match (route param `[eventId]` style mirrors `players/[id]` from Phase 2) |
| `src/app/[locale]/(app)/tournaments/page.tsx` (NEW — Server list page) | server-component / list + filter URL state | request-response | `src/app/[locale]/(app)/calendar/page.tsx` (filter URL state pattern; Suspense + Server fetch) | exact |
| `src/app/[locale]/(app)/tournaments/[eventId]/page.tsx` (NEW — Server detail) | server-component / route param fetch | request-response | `src/app/[locale]/(app)/calendar/page.tsx` (Server pattern) | exact |
| `src/app/[locale]/(app)/tournaments/[eventId]/result/page.tsx` (NEW — Server shell with Client form leaf) | server-component | request-response | `src/app/[locale]/(app)/calendar/page.tsx` (Server pattern + `?mode=read` searchParams decoding) | exact |
| `src/app/[locale]/(app)/players/[playerId]/rankings/page.tsx` (NEW — Server) | server-component / tab shell wrapping Client charts | request-response | `src/app/[locale]/(app)/calendar/page.tsx` (Server pattern with searchParams `?type=ranking_senior_world`) | role-match (URL-state-driven tab; tab + chart leaf is Client) |
| `src/components/training/bulk-attendance-score-form.tsx` (NEW — Client) | client-component / RHF form with `useFieldArray` | request-response | `src/components/calendar/event-create-sheet.tsx` lines 35-78 (`'use client'` boundary; RHF; trpc.useMutation + toast pattern) + `src/components/players/player-create-form.tsx` (5-section Card layout + Zod resolver + `useZodErrorMessage` integration) | exact (single-mutation bulk upsert; rows via `useFieldArray`; submit emits one mutation per D-62) |
| `src/components/common/star-rating-input.tsx` (NEW — Client) | client-component / accessible custom radio-group | render + click | `src/components/common/date-time-picker.tsx` (custom compound input; pure shadcn primitives + Tailwind tokens) | role-match — **shape is net-new (5-star UI), but the "custom Client primitive in `src/components/common/`" location matches**. See No Analog Found §StarRatingInput |
| `src/components/training/attendance-toggle.tsx` (NEW — Client) | client-component / 3-state ToggleGroup | render | `src/components/calendar/event-filter-bar.tsx` (URL-state filter using shadcn ToggleGroup pattern — read via Glob) | partial (3-state toggle is custom; DOM-MED-CONFLICT-02 pre-select logic is bespoke) |
| `src/components/training/feedback-textarea.tsx` (NEW — Client) | client-component / wrapper around shadcn Textarea | render | `src/components/players/player-create-form.tsx` (shadcn Textarea composition with FormField/FormControl) | exact |
| `src/components/training/te-scoren-overview.tsx` (NEW — Server with Client buttons) | server-component / list + scope-conditional | request-response | `src/components/players/player-list-table.tsx` (Server table component) — read on-demand by planner | role-match (Server reads `training.listPending` via tRPC server caller; Client `<TeScorenScoreNowButton>` is the "Score nu" CTA leaf) |
| `src/components/nudge/nudge-banner-stack.tsx` (NEW — Server slot above page chrome) | server-component / slot | render | `src/components/calendar/conflict-banner.tsx` (Server-safe banner with Client interaction leaf — read on-demand) | partial (above-chrome slot is net-new layout idiom — see No Analog Found §NudgeBannerStack) |
| `src/components/nudge/nudge-banner.tsx` (NEW — Client) | client-component / non-dismissible banner with escalation color | event-driven (refetch on focus) | `src/components/calendar/conflict-banner.tsx` (Client transient banner; the auto-dismiss timer pattern is the closest match but we explicitly DISABLE it per D-67) | partial (non-dismissible is the inversion of conflict-banner's auto-dismiss; escalation-color logic is net-new) |
| `src/components/tournament/my-tournament-result-pending-widget.tsx` (NEW — Server wraps Client buttons) | server-component / list + CTA | request-response | `src/components/training/te-scoren-overview.tsx` (sibling Phase 4 pattern, planner reads in parallel) | role-match |
| `src/components/inbox/minimal-system-inbox.tsx` (NEW — Server, list-only) | server-component / chronological list | request-response | `src/components/players/player-list-table.tsx` (Server list pattern) | partial (read-only list; no compose/threading — Phase 6 absorbs) |
| `src/components/tournament/tournament-list.tsx` (NEW — Server table) | server-component / DataTable with filter bar above | request-response | `src/components/players/player-list-table.tsx` + `src/components/calendar/event-filter-bar.tsx` (filter URL-state pattern) | exact (shadcn `<Table>` + filter bar; pagination via cursor matches admin-user pattern) |
| `src/components/tournament/tournament-filter-bar.tsx` (NEW — Client) | client-component / URL-state filter UI | url-state event | `src/components/calendar/event-filter-bar.tsx` (base64 JSON filter URL-state pattern — UI3-D08 carry-forward) | exact |
| `src/components/tournament/tournament-create-form.tsx` (NEW — Client RHF form) | client-component / RHF form in Sheet | request-response | `src/components/calendar/event-create-sheet.tsx` (RHF in Sheet; trpc mutation; toast on success) | exact |
| `src/components/tournament/tournament-participants-panel.tsx` (NEW — Client TD-only edit) | client-component / two-column panel (list + add) | request-response | `src/components/calendar/event-create-sheet.tsx` participant section (uses `FilterCombobox` scope-filtered typeahead) | role-match (D-79 RBAC gate hides add/remove for non-TD; reuses `FilterCombobox` from Phase 3) |
| `src/components/tournament/tournament-result-entry-form.tsx` (NEW — Client RHF with `useFieldArray`) | client-component / atomic submit | request-response | `src/components/calendar/event-create-sheet.tsx` (RHF + Zod + tRPC mutation + conflict-banner pattern); `useFieldArray` shape is exactly the bulk-attendance-form sibling | exact (atomic single Save → `{outcome, matches[]}` → `tournament.enterResult` mutation) |
| `src/components/tournament/match-results-table.tsx` (NEW — Client repeating row composer) | client-component / `useFieldArray` table with [+ row] button | render + state | `src/components/calendar/event-create-sheet.tsx` participant list block (Add/Remove rows) | role-match (shadcn `<Table>` body becomes a RHF `fields.map(...)` over `useFieldArray`; remove-row affordance per row) |
| `src/components/tournament/set-tally-input.tsx` (NEW — Client) | client-component / numeric stepper 0-4 | render | `src/components/calendar/event-create-sheet.tsx` `durationMinutes` Input (number + min/max + tabular-nums) | role-match |
| `src/components/tournament/derived-won-lost-indicator.tsx` (NEW — Client pure render) | client-component / derived display | render | `src/components/players/player-header.tsx` (read via Glob — Server pure render component) | partial (display-only React leaf; D-81 derivation logic is trivial inline) |
| `src/components/tournament/tournament-results-leaderboard.tsx` (NEW — Server table) | server-component / academy-wide visibility table | request-response | `src/components/players/player-list-table.tsx` (Server table; RLS-scoped fetch) | exact (RLS does the academy-scope per D-78) |
| `src/components/tournament/tournament-results-read-view.tsx` (NEW — Server read-only mirror) | server-component / static render | request-response | `src/components/calendar/event-detail-sheet.tsx` (read-only event display — read on-demand) | role-match (input components swap to read-only spans) |
| `src/components/ranking/rankings-tab.tsx` (NEW — Server container) | server-component / type-switch wrapping Client charts | request-response | `src/app/[locale]/(app)/calendar/page.tsx` (Server with `?type=...` URL state) | role-match (type selector via URL state; conditional render of line chart OR Belgium timeline) |
| `src/components/ranking/ranking-type-selector.tsx` (NEW — Client tabs) | client-component / URL-state tabs | url-state event | `src/components/i18n/locale-switcher.tsx` (URL-state Client Component with `useSearchParams`) | exact (shadcn `<Tabs>` primitive; persist via `?type=` per UI4-D14) |
| `src/components/ranking/range-pill-selector.tsx` (NEW — Client ToggleGroup pills) | client-component / range selector | url-state event | `src/components/calendar/event-filter-bar.tsx` (URL-state shadcn ToggleGroup pattern) | exact |
| `src/components/ranking/ranking-line-chart.tsx` (NEW — Client recharts wrapper) | client-component / recharts | render | **no analog — first recharts usage in repo.** Closest: `src/components/calendar/calendar-view.tsx` (Client library wrapper with locale-aware import) | no analog — reference RESEARCH §Standard Stack `recharts@3.8.1` + `<YAxis reversed />` documentation + RESEARCH §Pitfall 9 sparse-data domain |
| `src/components/ranking/belgium-timeline-strip.tsx` (NEW — Client pure CSS) | client-component / CSS tier-band timeline | render | `src/components/players/player-header.tsx` (Client pure-render presentation) | partial (no chart library — pure shadcn primitives + Tailwind tokens; see No Analog Found §BelgiumTimelineStrip) |
| `src/components/ranking/new-ranking-entry-sheet.tsx` (NEW — Client Sheet with RHF) | client-component / Sheet form | request-response | `src/components/calendar/event-create-sheet.tsx` (Sheet + RHF + trpc mutation; conditional input swap based on type discriminator) | exact (one form, conditional value-input swap based on `ranking_type.value_shape`) |
| `src/components/ranking/ranking-entries-table.tsx` (NEW — Server table) | server-component / audit/correction table | request-response | `src/components/players/player-list-table.tsx` (Server table — read on-demand) | exact |
| `src/components/common/rrule-editor.tsx` (MODIFY — add `<MultiDayPicker>` BYDAY toggles per D-85; wire scope picker per D-84) | client-component / sub-form extension | render | self (lines 71-100 — existing `<RruleEditor>`) | exact (extend with conditional BYDAY row when FREQ=WEEKLY; emit `byweekday` array per `RRule.optionsToString` spec) |
| `src/components/common/multi-day-picker.tsx` (NEW — Client) | client-component / 7-toggle row with min-1 validation | render | `src/components/calendar/event-filter-bar.tsx` (shadcn `<ToggleGroup type="multiple">` pattern — read via Glob) | role-match (multi-select toggle row; locale-aware day abbreviations via `formatDate`) |
| `src/components/calendar/rrule-scope-picker-dialog.tsx` (NEW — Client AlertDialog) | client-component / pre-save scope choice | event-driven (radio + confirm) | `src/components/calendar/event-delete-dialog.tsx` (shadcn `<AlertDialog>` confirm-then-mutate pattern — read on-demand) | exact (AlertDialog with radio group inside) |
| `src/components/calendar/event-detail-sheet.tsx` (MODIFY — extend action footer with Phase 4 CTAs per UI4-D11 matrix) | client-component / sheet extension | request-response | self (existing — read on-demand) | exact (append CTAs to existing action footer block) |
| `src/components/calendar/event-chip.tsx` (MODIFY — add `needsScoring`/`needsResult` yellow ⚠ overlay variant per UI4-D07) | client-component / FullCalendar `eventContent` callback render | render | self (existing chip variant taxonomy — read on-demand). Token reference: UI-SPEC §Color §State-overlay (`--state-needs-action-*` family) | partial (chip overlay variant is Phase 3 carry-forward shape with new color token; semantic flag `needsScoring`/`needsResult` is net-new — see No Analog Found §YellowOverlayChip) |

### i18n catalogs (messages/)

| Modified file | Role | Data Flow | Closest Analog | Match |
|---------------|------|-----------|----------------|-------|
| `messages/nl.json` (MODIFY — add `training.*`, `tournament.*`, `ranking.*`, `nudge.*`, `errors.training.*`, `errors.tournament.*`, `errors.ranking.*`, `lookup.outcomeLevel.*`, `lookup.belgiumClassification.*`, `lookup.trainingType.*`, `lookup.organisation.*`, `lookup.tournamentType.*`, `lookup.rankingType.*`) | i18n-catalog | static | self (existing `auth.*`, `calendar.*`, `lookup.eventType.*`, `errors.calendar.*` namespaces — verified at file head) | exact (extend existing structure; ~270-350 new keys per locale per RESEARCH §Multilingual Catalog Extensions) |
| `messages/en.json` | i18n-catalog | static | self | exact |
| `messages/fr.json` | i18n-catalog | static | self | exact |

### Design tokens (CSS)

| Modified file | Role | Data Flow | Closest Analog | Match |
|---------------|------|-----------|----------------|-------|
| `src/app/[locale]/globals.css` (MODIFY — append 6 Belgium tier tokens + 3 state-overlay tokens × light+dark = 18 declarations per UI-SPEC §Color §Belgium classification tier-band + §State-overlay) | design-token | static | self (the existing `:root` / `.dark` blocks; Phase 3 added 6 event-type triples in the same file) | exact (append below existing tokens; same oklch() token-naming convention) |

### Test files (Wave 0 — per VALIDATION.md)

| New test file | Role | Data Flow | Closest Analog | Match |
|---------------|------|-----------|----------------|-------|
| `tests/unit/rrule-split.test.ts` (NEW — D-84 split-and-rewrite math) | unit-test / pure-function | n/a | `tests/unit/calendar-schemas.test.ts` (Zod safeParse pattern) + closest semantic match: a hypothetical `tests/unit/rrule.test.ts` mentioned in 03-PATTERNS but verified at `tests/unit/intl-format.test.ts` (pure-function shape) | role-match (vitest describe/it; DST-edge case from RESEARCH §Pitfall 3) |
| `tests/unit/quality-score-range.test.ts` (NEW — CHECK constraint + 5-star → 2/4/6/8/10 mapping) | unit-test / pure-function + DB constraint | n/a | `tests/unit/calendar-schemas.test.ts` (Zod safeParse with `errors.calendar.*` key assertion) | role-match |
| `tests/unit/match-derived-won.test.ts` (NEW — D-81 set-tally derivation) | unit-test / pure-function | n/a | `tests/unit/calendar-schemas.test.ts` | exact |
| `tests/unit/ranking-xor.test.ts` (NEW — split-column XOR Zod + DB CHECK) | unit-test / Zod discriminated union | n/a | `tests/unit/calendar-schemas.test.ts` (`eventCreateInput.safeParse({...})` discriminated-union assertions lines 30-65) | exact (same discriminated-union test pattern) |
| `tests/integration/rbac-matrix-phase4.test.ts` (NEW — 7 roles × 5 new tables × CRUD subset) | integration-test / RBAC matrix | request-response | `tests/integration/rbac-matrix.test.ts` (existing Phase 1 matrix — `seedRolesMatrix` + `appCaller` + per-resource probe) | exact (extends ROLES × RESOURCES matrix with new resources per Phase 4) |
| `tests/integration/14d-walls.test.ts` (NEW — D-64 trainer wall + D-71 player wall boundary cases) | integration-test / business logic | request-response | `tests/integration/calendar-rrule-horizon.test.ts` (D-55 horizon boundary tests — `expect(...).rejects.toMatchObject({code: 'FORBIDDEN', message: 'errors.training.scoreWindowExpired'})` shape) | exact (TZ-correct boundary tests at day 13, 14 exact, 14+1s, 15 per RESEARCH §Pitfall 3) |
| `tests/integration/tournament-atomic-entry.test.ts` (NEW — D-69 atomic tx + idempotency dedup) | integration-test / atomicity | request-response | `tests/integration/calendar-cascade.test.ts` (FK CASCADE behavior post-DELETE) + `tests/integration/age-category-history.test.ts` (multi-row tx sequence) | role-match |
| `tests/integration/rrule-edit-scopes.test.ts` (NEW — all 3 scopes for training_sessions + meetings) | integration-test / state-mutation | request-response | `tests/integration/calendar-exceptions.test.ts` (D-54 exception application — INSERT exception + expand + assert) | role-match |
| `tests/integration/rls-academy-wide-result-visibility.test.ts` (NEW — D-78 5-branch UNION) | integration-test / RLS | request-response | `tests/integration/calendar-rls.test.ts` (5 roles × N event types matrix) + `tests/rls/calendar-direct-query.test.ts` (direct psql probe via `rawPgAsAppUser`) | exact (extends Phase 3 RLS test approach with 5th UNION branch assertion) |
| `tests/integration/pg-cron-nudge-jobs.test.ts` (NEW — daily 18:00 Brussels materialization) | integration-test / scheduled job | request-response | **no analog — no pg_cron tests in repo.** Closest: any integration test that mutates DB state then asserts — see RESEARCH §Validation Architecture | no analog — reference RESEARCH §Pitfall 2 + §pg-cron-nudge.test (Wave 0 Gap) |
| `tests/unit/idempotency-middleware.test.ts` (NEW or extension — VALID-08 24h dedup) | unit-test / middleware behavior | n/a | `tests/integration/ratelimit.test.ts` (middleware that gates mutation; assert dedup) — read on-demand | role-match |
| `tests/integration/training-mark-attendance.test.ts` (NEW — D-62 bulk upsert + Pitfall 6 ON CONFLICT) | integration-test / state-mutation + race | request-response | `tests/integration/age-category-history.test.ts` (INSERT-then-close-old-row sequence) | role-match |
| `tests/integration/session-participants-rls.test.ts` (NEW — D-61 staff write / player+parent read own) | integration-test / RLS | request-response | `tests/integration/calendar-rls.test.ts` | exact |
| `tests/integration/session-participants-occurrence.test.ts` (NEW — D-82 per-occurrence row) | integration-test / DDL behavior | request-response | `tests/integration/calendar-exceptions.test.ts` (occurrence_date semantics) | exact |
| `tests/integration/sparring-partner-rls.test.ts` (NEW — D-63 + Branch 6 RLS) | integration-test / RLS | request-response | `tests/integration/calendar-rls.test.ts` (with the sparring-partner currently-no-op assertion that Phase 4 flips to YES) | exact (replace 03-rls-test's "sparring sees 0 rows" assertion with "sparring sees own session events" after migration 0018) |
| `tests/integration/tournament-result-rls.test.ts` (NEW — D-78 5-branch academy-wide visibility) | integration-test / RLS | request-response | `tests/integration/calendar-rls.test.ts` (5-role matrix) | exact (extend with player-peer-academy 5th branch assertions) |
| `tests/integration/tournament-create-rbac.test.ts` (NEW — D-79 TD-only) | integration-test / RBAC | request-response | `tests/integration/rbac-matrix.test.ts` (canonical RBAC matrix probe shape) | exact |
| `tests/integration/tournament-backfill-rbac.test.ts` (NEW — D-73 asymmetric trainer/TD anytime) | integration-test / RBAC | request-response | `tests/integration/rbac-matrix.test.ts` | exact (matrix probe with time-window dimension) |
| `tests/integration/tournament-td-overwrite.test.ts` (NEW — D-75) | integration-test / RBAC | request-response | `tests/integration/calendar-audit.test.ts` (audit-on-mutation pattern; assert override audit fires) | role-match |
| `tests/integration/tournament-entry-window.test.ts` (NEW — D-71 player 14d wall) | integration-test / business logic | request-response | `tests/integration/calendar-rrule-horizon.test.ts` (boundary test pattern) | exact |
| `tests/integration/ranking-xor-constraint.test.ts` (NEW — D-86 DB-level XOR CHECK) | integration-test / DDL behavior | request-response | `tests/integration/calendar-exceptions.test.ts` (CHECK constraint violation → BAD_REQUEST mapping) | role-match (raw db.insert with both columns null → expect SQLSTATE 23514) |
| `tests/integration/ranking-entry-rbac.test.ts` (NEW — D-89 player + TD only) | integration-test / RBAC | request-response | `tests/integration/rbac-matrix.test.ts` | exact |
| `tests/integration/age-category-snapshot.test.ts` (NEW — DOM-CAT-02 snapshot at tournament.startsAt) | integration-test / business logic | request-response | `tests/integration/age-category-history.test.ts` (canonical `getAgeCategoryAt` test — read on-demand) | exact |
| `tests/integration/training-medical-conflict.test.ts` (NEW — DOM-MED-CONFLICT-01 form-time warning) | integration-test / cross-scope | request-response | `tests/integration/calendar-conflicts.test.ts` (D-56/D-57 detection + redaction via `overlapping_events_for_users` SECURITY DEFINER — read on-demand) | exact (reuses Phase 3 helper) |
| `tests/integration/attendance-medical-default.test.ts` (NEW — DOM-MED-CONFLICT-02 default) | integration-test / app-layer default | request-response | `tests/integration/calendar-conflicts.test.ts` (cross-scope query + role-based output shape) | role-match |
| `tests/integration/match-result-unique.test.ts` (NEW — VALID-07 composite unique) | integration-test / DDL behavior | request-response | `tests/integration/calendar-exceptions.test.ts` (UNIQUE index violation behavior) | role-match |
| `tests/integration/phase4-audit.test.ts` (NEW — GDPR-04 audit on every mutation) | integration-test / audit-trail | request-response | `tests/integration/calendar-audit.test.ts` (6 audit-code-name pattern; `expect(audit_log.findFirst({where: eq(action, ...)})).toBeDefined()`) | exact (Phase 4 emits ~10+ new audit codes — full list in §Cross-Cutting Patterns) |
| `tests/integration/idempotency-tournament.test.ts` + `tests/integration/idempotency-ranking.test.ts` (NEW — VALID-08 dedup) | integration-test / middleware | request-response | `tests/integration/ratelimit.test.ts` (middleware behavior assertion — read on-demand) | role-match |
| `tests/unit/i18n-catalog-completeness.test.ts` (NEW or extend) | unit-test / file invariant | n/a | (none mentioned in Phase 3 PATTERNS) — read existing `tests/unit/intl-format.test.ts` for the static-file invariant shape | partial (Phase 4 may extend or create — assert nl/en/fr have matching key sets) |
| `tests/e2e/rankings-tab.spec.ts` (NEW — D-87/D-88/D-90 chart rendering) | e2e-test / Playwright | request-response | (no Phase 3 chart e2e); closest: `tests/e2e/photo-upload.spec.ts` (login → navigate → assert UI states — read on-demand) | partial (recharts SVG rendering assertions; `<YAxis reversed />` visual verification) |
| `tests/fixtures/phase4-seed.ts` (NEW — extends calendar-seed with session_participants + tournament_results + ranking_entries fixtures) | test-fixture / seed helper | n/a | `tests/fixtures/calendar-seed.ts` (canonical Phase 3 seed helper extending `seedRolesMatrix`) + `tests/helpers/seed.ts` `seedRolesMatrix` | exact (extends with new operational tables; same `db.execute(sql\`INSERT … ON CONFLICT DO NOTHING\`)` shape) |
| `tests/unit/migration-format.test.ts` (EXTEND — add migrations 0014-0020 to format check list) | unit-test / format invariant | n/a | self (existing) | exact (extend list) |

---

## No Analog Found

Files with no close match in the codebase — planner uses RESEARCH.md / UI-SPEC.md / library docs as canonical reference:

| File | Role | Canonical Doc Pointer |
|------|------|--------------------|
| `splitRRule()` in `src/lib/rrule.ts` (D-84 math) | RRULE split-and-rewrite | **RESEARCH §Pattern 1 (lines 440-525)** — full code shape including UNTIL truncation, COUNT-to-UNTIL conversion, DST-anchoring via existing `formatOccurrenceDate`, edge cases for existing exceptions. The output type is `{oldRruleString, newRruleString, newDtstart}`. Closest in-repo shape: `ensureHorizon` lines 324-343 (same `parseRrule(...).origOptions` + `RRule.optionsToString(rest)` flow). |
| `belgium_classification` lookup with rank/tier columns + per-tier global ordinal sort_order (D-86, D-89, Pitfall 8) | Lookup schema with multi-column ordering | **CONTEXT D-86** + **RESEARCH §Pitfall 8** (canonical seed order A1=1 → A50=50 → B0=51 → … → NC=67). No prior lookup table in the repo carries both `sort_order` (global ordinal) and `tier text` (per-row grouping) — `ageCategories` (lookups.ts lines 88-94) has extra columns but a single dimension. Schema shape: `code text PK + sort_order int + tier text CHECK + active boolean`. |
| Split-column XOR ranking schema with DB CHECK + app-layer `value_shape` cross-check (D-86) | DB CHECK XOR + app-layer Zod refinement | **RESEARCH §Pattern 4 (lines 720-765)** — full SQL + Zod code. No prior repo table has a "two columns, exactly one populated" CHECK XOR. App-layer cross-check is the recommended approach (see RESEARCH "Why app-layer not trigger"). |
| `<StarRatingInput>` (D-60) 5-star v1 mapping to 2/4/6/8/10 | Custom accessible radio-group | **UI-SPEC §Component Inventory** (line 299 — full ARIA + keyboard contract). Reference for accessible radio-group: `role="radiogroup"` on container, `role="radio"` + `aria-checked` per star; keyboard: `1`-`5` direct, arrows step, `Esc/0` clear, `Enter/Space` commit. No prior custom-radio-group in repo; closest shape: `src/components/common/date-time-picker.tsx` (custom compound input) for the location and `'use client'` boundary convention. |
| "Te scoren" trainer dashboard widget (D-66, D-68, D-67 ch1 banner) | Aggregator + banner with discipline-loop semantics | **UI-SPEC §Component Inventory** (line 302) + **RESEARCH §Pattern §D-66 query shape**. No prior aggregator widget in repo. Closest: `src/components/players/player-list-table.tsx` (Server table reading from a tRPC list) — table + filter pattern, but the "non-dismissible banner above page chrome" is genuinely net-new (UI4-D08). |
| Daily 18:00 Brussels pg_cron job materializing `system_inbox` rows (D-67 channel 2, D-72 channel 2) | Scheduled DB job + SECURITY DEFINER materialization | **RESEARCH §Pattern §pg_cron + §Pitfall 2 (DST-safe dual-schedule)**. Verified: no `cron.schedule` or `pg_cron` usage in any existing migration. Closest analog discipline: `drizzle/0011_phase3_calendar_rls_policies.sql` SECURITY DEFINER REVOKE/GRANT shape (lines 199-200) for the materialization function itself. Pre-Wave-0 verification task: `SELECT * FROM pg_available_extensions WHERE name = 'pg_cron'` (RESEARCH §Environment Availability). |
| `<NudgeBannerStack>` + `<NudgeBanner>` (D-67 channel 1 banner, escalating color) | Persistent non-dismissible above-chrome banner with color escalation by max-days-since-deadline | **UI-SPEC §Component Inventory** + **UI4-D08** (full visual contract: yellow → orange → red at days 6/9/12). Closest analog: `src/components/calendar/conflict-banner.tsx` (Client banner with timer — but the timer pattern is the *inverse* of what we want; D-67 explicitly forbids dismissal). |
| Yellow ⚠ chip overlay on past-session calendar chips (D-67 channel 3, UI4-D07) | Phase 3 chip variant extension | **UI-SPEC §Chip Variant Extension §UI4-D07** (corner badge: 12px AlertTriangle on 16×16 circle, `--state-needs-action-*` tokens). Extends Phase 3 UI3-D11 chip variant taxonomy. Phase 3's `event.extendedProps` gets two new boolean flags from server: `needsScoring: boolean` (training, trainer in scope, has NULL participant scores, within 14d) and `needsResult: boolean` (tournament, player is participant, no `tournament_results` row, within 14d). |
| recharts `<RankingLineChart>` with `<YAxis reversed />` (D-87, D-88, D-90) | International ranking line chart | **RESEARCH §Standard Stack §Phase 4 additions** (recharts 3.8.1 verified) + **RESEARCH §Pitfall 9 (sparse-data domain)** + **UI-SPEC §Component Inventory** (line 320). No prior chart library usage in repo. The `<YAxis reversed />` prop is verified at recharts docs. Empty-state fallback is `<EmptyState>` Server primitive that already exists at `src/components/common/empty-state.tsx`. |
| `<BelgiumTimelineStrip>` (D-87 annual tier-band horizontal strip) | Pure CSS/Tailwind tier-band timeline (no chart lib) | **UI-SPEC §Component Inventory** (line 321) + **UI-SPEC §Color §Belgium classification tier-band**. No prior similar component; closest: any pure-CSS horizontal scroll component. The `--cls-tier-*` color family is net-new (6 tokens × light+dark = 12 declarations). The 1px outline on NC tier is mandatory (background equals `--background`). |
| `<RankingTypeSelector>` 5-tab selector for ranking types (D-88) | URL-state tab selector | **UI-SPEC §Component Inventory** (line 318) — shadcn `<Tabs>` primitive + URL `?type=ranking_senior_world`. Closest analog for URL-state pattern: `src/components/i18n/locale-switcher.tsx`. |
| `<RangePillSelector>` 5-pill range selector (D-90) for international charts | URL-state range pills | **UI-SPEC §Component Inventory** (line 319) — shadcn `<ToggleGroup type="single">`. Closest: `src/components/calendar/event-filter-bar.tsx` toggle row. |
| `<TournamentResultEntryForm>` + `<MatchResultsTable>` atomic single-screen entry form (D-80, D-69) | Atomic `{outcome, matches[]}` form with `useFieldArray` | **UI-SPEC §Component Inventory** (lines 311-312). Atomic submission pattern is shaped on `event-create-sheet.tsx` mutation flow (lines 35-78), but the "add-row-as-needed" table inside is closer to: any RHF `useFieldArray` example — see `react-hook-form` docs. Round-derivation from outcome ("Finalist" → "Finale") is bespoke client logic. |
| `<RruleScopePickerDialog>` (D-84, UI4-D18) — modal radio at save-time | Pre-save scope choice modal | **UI-SPEC §Component Inventory** (line 325). Closest analog: `src/components/calendar/event-delete-dialog.tsx` shadcn `<AlertDialog>` confirm pattern, but the radio-group inside is bespoke. |
| `<MultiDayPicker>` BYDAY picker (D-85, UI4-D19) | 7-toggle row inside RruleEditor | **UI-SPEC §Component Inventory** (line 324). Closest analog: shadcn `<ToggleGroup type="multiple">` usage in `event-filter-bar.tsx` (read on-demand). Net-new logic: emit `byweekday` array compatible with `RRule.optionsToString({byweekday: [...]})`. |
| `system_inbox` table (D-67 ch2, D-72 ch2 destination) | Minimal Phase 4 stub; Phase 6 absorbs | **RESEARCH §Phase 6 inbox dependency** + **UI4-D09**. Verified: no `system_inbox` or `systemInbox` in repo. Closest schema-shape analog: `idempotency_keys` (single-table file with jsonb payload + lifecycle). |
| Idempotency middleware (Pitfall 5) | VALID-08 wiring | **RESEARCH §Pitfall 5 (lines 980-1015)** — full code shape; reads `_meta.idempotencyKey` from input via `getRawInput`, short-circuits on cache hit, persists on success. Closest analog: `middleware/calendarCreate.ts` (factory middleware that reads input — but Phase 3 went inline rather than middleware for `canCreateEventType`). Verified: `find src -name 'idempotency*'` returns only the schema file, no middleware. |

---

## Cross-Cutting Patterns

### 1. Authentication / scope-binding

**Source:** `src/server/trpc/middleware/freshSession.ts` (procedure presets) + `src/server/trpc/middleware/rls.ts` (RLS GUC binding)
**Apply to:** every Phase 4 tRPC procedure across `training.ts`, `tournament.ts`, `ranking.ts`, `calendar.ts` extension

```typescript
// Existing presets (verified at lines 103-152):
export const protectedProcedure = publicProcedure
  .use(requireAuth)
  .use(withRlsContext)
  .use(requireCurrentConsent);

export const tdProcedure = protectedProcedure.use(requireRole('technical_director'));
export const sensitiveProcedure = protectedProcedure.use(requireFreshSession);

// Phase 4 ADDS (per RESEARCH §Example 5):
export const trainerOrTdProcedure = protectedProcedure.use(
  requireRole('trainer', 'technical_director'),
);
```

**Phase 4 procedure preset matrix:**

| Procedure | Preset | Rationale |
|-----------|--------|-----------|
| `training.markAttendanceAndScore` | `protectedProcedure` + inline `requireRole('trainer', 'technical_director')` + inline `assertScoreWindowOpen(...)` | D-61 write scope; D-64 wall |
| `training.listPending` | `protectedProcedure` (RLS does scope: trainer's own sessions or TD all) | D-66/D-68 |
| `training.getSession` | `protectedProcedure` (RLS does scope) | NOT_FOUND on out-of-scope per D-36 carry-forward |
| `tournament.enterResult` | `protectedProcedure` + inline RBAC (player+trainer-in-academy+TD per D-73) + idempotency middleware | D-69 atomic + VALID-08 |
| `tournament.create` / `tournament.addParticipant` / `tournament.removeParticipant` | `tdProcedure` | D-79 TD-only |
| `tournament.list` / `tournament.get` / `tournament.listResults` / `tournament.listPendingForPlayer` | `protectedProcedure` (RLS does scope per D-78) | TOURN-06 |
| `ranking.addEntry` | `protectedProcedure` + inline `requireRole('player', 'technical_director')` + idempotency middleware | D-89 + VALID-08 |
| `ranking.getHistory` / `ranking.getCurrentByType` / `ranking.listEntries` | `protectedProcedure` | RLS does scope |
| `calendar.event.editRecurring` | `protectedProcedure` + inline `canCreateEventType` (defense in depth) | D-84 |

### 2. Audit logging

**Source:** `src/server/trpc/middleware/audit.ts` — `writeAudit(ctx, entry)` (verified lines 80-107)
**Apply to:** every Phase 4 mutation

```typescript
await writeAudit(ctx, {
  action: '<verb>',
  resourceType: '<resource>',
  resourceId: row.id,
  oldValues: /* pre-image — JSONB snapshot for delete/overwrite */,
  newValues: /* post-image — sanitized */,
  outcome: 'success' | 'denied' | 'error',  // 'denied' for wall rejections per Pitfall 3
});
```

**Phase 4 audit codes (must match `tests/integration/phase4-audit.test.ts` — ~14 codes):**

| Code | Resource Type | Trigger |
|------|---------------|---------|
| `training_attendance_marked` | `session_participants` | D-62 bulk upsert success |
| `training_score_window_expired_attempt` | `calendar_event` | D-64 wall rejection (outcome='denied') |
| `tournament_result_entered` | `tournament_result` | D-69 atomic success |
| `tournament_result_overwritten` | `tournament_result` | D-75 TD overwrite (`oldValues` snapshot mandatory) |
| `tournament_entry_window_expired_attempt` | `tournament` | D-71 wall rejection (outcome='denied') |
| `tournament_created` | `tournament` | D-79 TD create |
| `tournament_participant_added` / `tournament_participant_removed` | `tournament_participation` | D-79 TD subscribes |
| `ranking_entry_added` | `ranking_entry` | D-89 success |
| `ranking_entry_updated` | `ranking_entry` | TD correction |
| `calendar_event_recurring_split` | `calendar_event` | D-84 "Deze en toekomstige" split |
| `calendar_event_recurring_updated_all` | `calendar_event` | D-84 "Alle in de reeks" in-place |
| `sparring_partner_attached` | `session_sparring_partner` | D-63 junction insert |
| `idempotency_replay` | (varies) | VALID-08 cache hit (short-circuit) |

**Audit-before-overwrite pattern** (D-75): SELECT existing row FOR UPDATE → snapshot to `oldValues` → mutate → audit. Mirrors Phase 3 D-58c shape.

### 3. Error handling

**Source:** `src/server/trpc/routers/calendar.ts` lines 636-649 (CHECK constraint violation mapping pattern)
**Apply to:** every Phase 4 mutation that may hit a CHECK or UNIQUE constraint

```typescript
try {
  // ... db.transaction(...)
} catch (err: unknown) {
  const e = err as { code?: string; constraint?: string };
  if (e.code === '23514' && (e.constraint?.includes('quality_score_range') ?? false)) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'errors.training.qualityScoreOutOfRange' });
  }
  if (e.code === '23514' && (e.constraint?.includes('ranking_entries_value_xor') ?? false)) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'errors.ranking.bothValuesPopulated' });
  }
  if (e.code === '23505' && (e.constraint?.includes('match_results_unique') ?? false)) {
    throw new TRPCError({ code: 'CONFLICT', message: 'errors.tournament.duplicateMatch' });
  }
  throw err;
}
```

### 4. Input validation

**Source:** `src/server/trpc/schemas/calendar.ts` (verified `.strict()` + i18n-key error messages + discriminated union)
**Apply to:** every schema in `src/server/trpc/schemas/training.ts`, `tournament.ts`, `ranking.ts`

- `.strict()` on every object (VALID-06 carry-forward; field-smuggling unit tests enforce this)
- All error messages are i18n keys under `errors.training.*`, `errors.tournament.*`, `errors.ranking.*`
- Discriminated union for `ranking.addEntry` over `value.kind` ('numeric' | 'classification') mirrors `eventCreateInput` discriminated union shape
- `.refine()` for cross-field constraints (e.g., `sets_won + sets_lost BETWEEN 1 AND 7`)

### 5. Audit-before-delete (D-58c carry-forward)

**Source:** `src/server/trpc/routers/calendar.ts` `event.delete` (Phase 3 D-58c pattern — read on-demand)
**Apply to:** every Phase 4 destructive mutation (TD remove tournament participant, TD delete ranking entry, etc.)

Pattern: SELECT FOR UPDATE → assemble JSONB snapshot → writeAudit(`*_deleted` with `oldValues` full snapshot) → DELETE inside same tx.

### 6. Date display + locale

**Source:** `src/lib/i18n-format.ts` (`formatDate`, `formatNumber`, `WEEK_STARTS_ON_MONDAY`)
**Apply to:** every Phase 4 component rendering a date/number

- `dd/MM/yyyy` for date and `HH:mm` for time (Belgian convention, 24h)
- Monday weekstart per I18N-07
- Ranking timeline year labels: `formatDate(date, 'yyyy')` per locale (4-digit year is locale-invariant but the helper centralizes the convention)
- Match `datum`: `formatDate(date)` with default `dd/MM/yyyy`
- Score capture timestamps: `formatDate(date) + formatTime(date)`

### 7. Server / Client component split

**Source:** `src/app/[locale]/(app)/calendar/page.tsx` (Server) + `src/components/calendar/calendar-view.tsx` (Client `'use client'` boundary)
**Apply to:**

| Surface | Server | Client boundary location |
|---------|--------|--------------------------|
| `/dashboard` | Server pre-fetch + role-conditional render | `<TeScorenScoreNowButton>` (per row CTA), `<NudgeBanner>` (count refetch on focus), `<MyTournamentResultPendingWidget>` button |
| `/trainings/[eventId]/score` | Server shell + initial form data | `<BulkAttendanceScoreForm>` |
| `/tournaments` | Server table + Server-rendered rows | `<TournamentFilterBar>` |
| `/tournaments/[eventId]` | Server detail + Server `<TournamentResultsLeaderboard>` | `<TournamentParticipantsPanel>` (TD edit panel) |
| `/tournaments/[eventId]/result` | Server shell | `<TournamentResultEntryForm>` |
| `/players/[playerId]/rankings` | Server tab shell + initial data | `<RankingsTab>` children (`<RankingTypeSelector>`, `<RankingLineChart>`, `<BelgiumTimelineStrip>`, `<RangePillSelector>`, `<NewRankingEntrySheet>`) |

### 8. URL state

**Source:** `src/components/i18n/locale-switcher.tsx` (URL-state Client Component with `useSearchParams`)
**Apply to:** `<RankingTypeSelector>` (`?type=ranking_senior_world`), `<RangePillSelector>` (`?range=2y`), `<TournamentFilterBar>` (`?filter=<base64>` per Phase 3 pattern)

### 9. Discriminated-union Zod patterns

**Source:** `src/server/trpc/schemas/calendar.ts` `eventCreateInput` (verified lines 67-160 with 6 branches)
**Apply to:** `ranking.addEntryInput` (numeric | classification)

```typescript
const numericValueBranch = z.object({
  kind: z.literal('numeric'),
  value: z.number().positive({ message: 'errors.ranking.mustBePositive' }),
}).strict();

const classificationValueBranch = z.object({
  kind: z.literal('classification'),
  code: z.string().min(1, { message: 'errors.field.required' }),
}).strict();

export const rankingAddEntryInput = z.object({
  playerUserId: z.string().uuid(),
  rankingTypeCode: z.string(),
  recordedAt: z.coerce.date(),
  source: z.enum(['manual', 'federation_official']),
  value: z.discriminatedUnion('kind', [numericValueBranch, classificationValueBranch]),
}).strict();
```

### 10. SECURITY DEFINER UNION RLS helper (D-78 5-branch)

**Source:** `drizzle/0011_phase3_calendar_rls_policies.sql` lines 98-148 (`calendar_events_visible_to`)
**Apply to:** `tournament_result_visible_to`, `session_participants_visible_to`, `ranking_entry_visible_to`

```sql
CREATE OR REPLACE FUNCTION tournament_result_visible_to(caller_id UUID, caller_role TEXT)
RETURNS TABLE(tournament_event_id UUID, player_user_id UUID) AS $$
  -- Branch 1: TD (verbatim from Phase 3 D-50 pattern)
  -- Branch 2: own results
  -- Branch 3: trainer/academy_manager via academy_memberships JOIN
  -- Branch 4: parent via parent_child_links JOIN
  -- Branch 5: D-78 player-peer-academy — net-new branch
$$ LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = pg_catalog, public;

REVOKE ALL ON FUNCTION tournament_result_visible_to(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tournament_result_visible_to(UUID, TEXT) TO app_user;
```

Full SQL: **RESEARCH §Pattern 5 (lines 769-829)**.

### 11. ON CONFLICT DO UPDATE upsert (Pitfall 6)

**Source:** `src/server/trpc/routers/player.ts` lines 137-146 (`academyMemberships` idempotent upsert with `.onConflictDoNothing()`); Phase 4 uses `.onConflictDoUpdate()` shape from Drizzle docs
**Apply to:** `training.markAttendanceAndScore` (D-62 bulk upsert race-safe)

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

### 12. Atomic multi-row transaction shape

**Source:** `src/server/trpc/routers/calendar.ts` `event.create` lines 577-635 (verified — base table INSERT then extension INSERT then junction INSERT all in `db.transaction(async (tx) => {...})`)
**Apply to:** `tournament.enterResult` (INSERT `tournament_results` + bulk INSERT `match_results`); `calendar.event.editRecurring` scope='this_and_future' (UPDATE old + INSERT new + COPY participants + COPY sparring)

```typescript
await db.transaction(async (tx) => {
  // 1. Validate (zod input already validated outside tx)
  // 2. INSERT or UPSERT parent row
  // 3. DELETE or INSERT children inside same tx (full replacement per RESEARCH §Pattern 3)
  // 4. Audit emitted AFTER tx commits — never inside
});
```

### 13. next-intl message key insertion

**Source:** existing `messages/{nl,en,fr}.json` structure (verified head — `auth.*`, `calendar.*`, `lookup.eventType.*`, `errors.calendar.*`)
**Apply to:** `messages/*.json` Phase 4 extensions

**Phase 4 new namespaces:**

```json
{
  "training": { "score": {...}, "teScoren": {...}, "attendance": {...} },
  "tournament": { "list": {...}, "detail": {...}, "result": {...}, "matchEntry": {...} },
  "ranking": { "chart": {...}, "timeline": {...}, "entry": {...} },
  "nudge": { "banner": {...}, "escalation": {...}, "inbox": {...} },
  "errors": {
    "training": { "scoreWindowExpired": "...", "qualityScoreOutOfRange": "...", ... },
    "tournament": { "entryWindowExpired": "...", "atLeastOneMatchRequired": "...", "duplicateMatch": "...", ... },
    "ranking": { "unknownType": "...", "expectedNumeric": "...", "expectedClassification": "...", "bothValuesPopulated": "...", ... }
  },
  "lookup": {
    "outcomeLevel": { "outcome_winner": "Winnaar", "outcome_finalist": "Finalist", ... },  // 9 codes × 3 locales
    "belgiumClassification": { "A1": "A1", "A2": "A2", ..., "NC": "NC" },  // canonical labels per I18N-06 — same in all 3 locales
    "trainingType": { "training_type_group": "Groepstraining", ... },  // 4 codes
    "organisation": { "org_private": "Privé", ... },  // 6 codes
    "tournamentType": { "tournament_wtt": "WTT", ... },  // 7 codes
    "rankingType": { "ranking_senior_world": "Senior Wereld", ... }  // 5 codes
  }
}
```

Total ~270-350 new keys per locale per RESEARCH §Multilingual Catalog Extensions.

### 14. NOT_FOUND-on-out-of-scope (D-36 enumeration prevention)

**Source:** `src/server/trpc/routers/calendar.ts` `event.update` lines 712-720 (verified)
**Apply to:** every Phase 4 `get` / `update` / `delete` mutation — RLS-filtered rows that don't return surface NOT_FOUND, never FORBIDDEN.

```typescript
const existing = await db.select().from(table).where(eq(table.id, input.id));
const row = existing[0];
if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
```

---

## Coverage Cross-Check

### Locked decisions D-60..D-91 — pattern coverage map

| Decision | Pattern entry |
|----------|---------------|
| D-60 (quality_score 1-10 stored, 5-star rendered) | `0014_*.sql` CHECK constraint; `schema/training.ts` smallint; `<StarRatingInput>` (No Analog Found) |
| D-61 (score visibility staff write / player+parent read own) | `0018_*.sql` `session_participants_visible_to`; pattern §SECURITY DEFINER UNION RLS helper |
| D-62 (single combined attendance + score form) | `0014_*.sql` composite PK; `<BulkAttendanceScoreForm>` per Pattern Assignments; §ON CONFLICT DO UPDATE upsert |
| D-63 (sparring partners no score; junction only) | `0014_*.sql` `session_sparring_partners`; `0018_*.sql` extends `calendar_events_visible_to` with Branch 6 |
| D-64 (14d absolute wall; no TD override) | `routers/training.ts` inline check + audit-on-denial; §Cross-Cutting §Audit logging `training_score_window_expired_attempt` |
| D-66 (trainer "Te scoren" overview) | `<TeScorenOverview>` (Pattern Assignments + No Analog Found); `training.listPending` query shape per RESEARCH §D-66 |
| D-67 (all-channel intrusive nudges in-app) | 4 channels: (1) `<NudgeBannerStack>`, (2) `0019_*.sql` pg_cron + `system_inbox`, (3) yellow ⚠ chip overlay UI4-D07, (4) escalation color in `<NudgeBanner>` |
| D-68 (TD cross-trainer "Te scoren") | `training.listPending(scope: 'td')` variant — same widget unfiltered |
| D-69 (final ranking + ≥1 match — atomic) | `routers/tournament.ts` `enterResult` Zod `matches.min(1)` + §Atomic multi-row transaction shape |
| D-70 (9-level outcome lookup manual) | `0017_*.sql` outcome_level seed (9 codes); `<LookupSelect>` reuse |
| D-71 (player 14d entry/edit window) | `routers/tournament.ts` inline check; §Cross-Cutting §Audit `tournament_entry_window_expired_attempt` |
| D-72 (all-channel player-side nudges) | Same 4 channels as D-67 scoped to player |
| D-73 (asymmetric trainer/TD anytime backfill) | `routers/tournament.ts` inline RBAC: `wallExpired && ctx.scope.role === 'player' → 403`; trainer/TD path skips wall |
| D-74 (single 14d player window — DOM-RESULT-01 superseded) | REQUIREMENTS.md update (Phase 4 plan); D-71 implementation |
| D-75 (TD unconditional overwrite) | §Audit-before-overwrite pattern; `tournament_result_overwritten` audit code |
| D-76 (no edit-history table — DOM-RESULT-03 superseded) | No new table; §Audit `oldValues` JSONB snapshot is forensic recovery |
| D-77 (no status lifecycle — DOM-RESULT-04 superseded) | No status column on `tournament_results` |
| D-78 (academy-wide visibility) | `0018_*.sql` `tournament_result_visible_to` 5-branch UNION; §SECURITY DEFINER UNION RLS helper |
| D-79 (TD-only tournament creation + participant registration) | `tournament.create` / `tournament.addParticipant` on `tdProcedure`; `<TournamentParticipantsPanel>` RBAC gate |
| D-80 (add-row-as-needed match-entry table) | `<TournamentResultEntryForm>` + `<MatchResultsTable>` (No Analog Found) |
| D-81 (set-tally not set-by-set — TOURN-04 partial superseded) | `0015_*.sql` `sets_won` / `sets_lost` smallint CHECK; `<DerivedWonLostIndicator>` |
| D-82 (occurrence_date on session_participants — Phase 4 correction) | `0014_*.sql` composite PK includes `occurrence_date` |
| D-83 (recurring-edit past data immutable) | `routers/calendar.ts` `event.editRecurring` split tx explicitly skips `session_participants` |
| D-84 (3 scopes: single / this-and-future / all-in-series) | `routers/calendar.ts` `event.editRecurring`; `splitRRule()` helper (No Analog Found); `<RruleScopePickerDialog>` |
| D-85 (BYDAY ships, BYMONTHDAY deferred) | `<MultiDayPicker>` (No Analog Found); `<RruleEditor>` extension; server Zod validates `BYDAY && FREQ=WEEKLY` |
| D-86 (split-column XOR ranking schema — RANK-01 amended) | `0016_*.sql` CHECK XOR; `schema/ranking.ts`; §Split-column XOR (No Analog Found); §Discriminated-union Zod patterns |
| D-87 (distinct chart widgets per shape — RANK-07 amended) | `<RankingLineChart>` (recharts) + `<BelgiumTimelineStrip>` (CSS) — both No Analog Found |
| D-88 (per-type chart selector — international) | `<RankingTypeSelector>` (No Analog Found); §URL state pattern |
| D-89 (literal RANK-06 — player + TD all types incl. Belgium) | `routers/ranking.ts` `addEntry` inline `requireRole('player', 'technical_director')` |
| D-90 (24-month default + range selector) | `<RangePillSelector>` (No Analog Found); `ranking.getHistory(from, to)` query |
| D-91 (Rankings tab only in Phase 4) | Route `/players/[playerId]/rankings/page.tsx` Server Component |

### Wave 0 test files — pattern coverage map

| Wave 0 file | Pattern entry |
|-------------|---------------|
| `tests/unit/migration-format.test.ts` (extension) | ✓ Self-extend |
| `tests/unit/rrule-split.test.ts` | ✓ Reference RESEARCH §Pattern 1 |
| `tests/unit/quality-score-range.test.ts` | ✓ Analog `tests/unit/calendar-schemas.test.ts` |
| `tests/unit/match-derived-won.test.ts` | ✓ Analog `tests/unit/calendar-schemas.test.ts` |
| `tests/unit/ranking-xor.test.ts` | ✓ Analog `tests/unit/calendar-schemas.test.ts` discriminated-union shape |
| `tests/integration/rbac-matrix-phase4.test.ts` | ✓ Analog `tests/integration/rbac-matrix.test.ts` |
| `tests/integration/14d-walls.test.ts` | ✓ Analog `tests/integration/calendar-rrule-horizon.test.ts` (boundary cases) |
| `tests/integration/tournament-atomic-entry.test.ts` | ✓ Analog `tests/integration/age-category-history.test.ts` (multi-row tx) |
| `tests/integration/rrule-edit-scopes.test.ts` | ✓ Analog `tests/integration/calendar-exceptions.test.ts` |
| `tests/integration/rls-academy-wide-result-visibility.test.ts` | ✓ Analog `tests/integration/calendar-rls.test.ts` |
| `tests/integration/pg-cron-nudge-jobs.test.ts` | ⚠ No analog — reference RESEARCH §Pitfall 2 + §Wave 0 Gaps |
| `tests/unit/idempotency-middleware.test.ts` | ✓ Analog `tests/integration/ratelimit.test.ts` (middleware shape) |
| `tests/fixtures/phase4-seed.ts` | ✓ Analog `tests/fixtures/calendar-seed.ts` |

---

## Metadata

**Analog search scope:** `drizzle/`, `src/server/db/schema/`, `src/server/trpc/`, `src/lib/`, `src/components/`, `src/app/[locale]/(app)/`, `tests/`, `messages/`
**Files scanned:** 18 files read directly (key analogs) + ~50 verified via Glob/Bash listings (component file existence)
**Phase 1+2+3 status:** ✓ complete — every analog file referenced is currently committed (verified: idempotency middleware ABSENT confirms RESEARCH Pitfall 5; pg_cron usage ABSENT confirms net-new pattern for D-67/D-72; system_inbox table ABSENT confirms net-new for Phase 4)
**Pattern extraction date:** 2026-05-16

---

## PATTERN MAPPING COMPLETE

**Phase:** 04 - Kerndomein
**Files classified:** ~75 new + ~6 modified = 81 files
**Analogs found:** 58 / 75 strong matches

### Coverage

- Files with exact analog: 41 (migrations, schemas, routers, most components, all i18n catalogs, RLS DDL pattern, most tests)
- Files with role-match analog: 17 (procedure preset additions, idempotency middleware, attendance-toggle, banner stack, charts wrappers)
- Files with partial analog (compose existing pieces + net-new logic): 10 (yellow ⚠ chip overlay, NudgeBanner non-dismissible inversion, BelgiumTimelineStrip pure CSS)
- Files with no analog (reference docs only): 13 net-new patterns flagged in §No Analog Found

### Key Patterns Identified

- **Migrations split by concern across 6+ files** (DDL training/sparring → DDL tournaments/matches → DDL rankings/Belgium → seeds → RLS extension → pg_cron) — each rollback-independent per MIG-05; mirrors Phase 3's 0009/0010/0011/0012/0013 split. Each migration has a `_*.rollback.md` companion with Risk / Procedure / Verification headers enforced by `tests/unit/migration-format.test.ts`.
- **Drizzle pgTable uses `tstz` helper + `(t) => [...]` table-level constraints** — `calendar.ts` is the canonical multi-table-in-one-file shape; Phase 4 mirrors with `training.ts` / `tournament.ts` / `ranking.ts`.
- **All tRPC procedures compose `protectedProcedure` + per-mutation `writeAudit`** — Phase 4 adds one new preset (`trainerOrTdProcedure`) and one new middleware (`idempotency`); per-mutation RBAC for asymmetric backfill (D-73) is inline rather than middleware-composed because it depends on a DB read of `tournament.endsAt`.
- **All Zod schemas use `.strict()` + i18n-key error messages** — `errors.training.*`, `errors.tournament.*`, `errors.ranking.*` are the new namespaces; discriminated union for ranking value (numeric XOR classification) mirrors Phase 3 event-type discriminated union shape.
- **NOT_FOUND-on-out-of-scope (D-36) carry-forward** — every Phase 4 `get` / `update` / `delete` surfaces NOT_FOUND on RLS-filtered rows.
- **Audit-before-overwrite pattern (D-75)** — TD overwrite emits `oldValues` JSONB snapshot before mutation; mirrors Phase 3 D-58c delete pattern.
- **SECURITY DEFINER UNION RLS for cross-table visibility** — `tournament_result_visible_to` 5-branch UNION (including the net-new D-78 player-peer-academy branch) follows the same `SET search_path = pg_catalog, public` / `REVOKE FROM PUBLIC` / `GRANT TO app_user` discipline as Phase 3's `calendar_events_visible_to` and Phase 2's `mark_scan_result`.
- **Server-shell + Client-leaf component split** — `/dashboard`, `/trainings/[eventId]/score`, `/tournaments/*`, `/players/[playerId]/rankings` all follow Phase 3's calendar pattern: Server Component does initial fetch via `createContext()` + `appRouter.createCaller(ctx)`, passes data to Client Component leaf where `'use client'` boundary lives.
- **Atomic `{outcome, matches[]}` package via `db.transaction(...)`** — Phase 3's `event.create` is the canonical atomicity analog; Phase 4 `tournament.enterResult` follows the same shape with idempotency-middleware gating per VALID-08.
- **Net-new patterns to import canonically from RESEARCH/UI-SPEC** — `splitRRule()` math (RESEARCH §Pattern 1), split-column XOR ranking schema (RESEARCH §Pattern 4), 5-star input mechanics (UI-SPEC §Component Inventory), Belgium tier-band timeline strip (UI-SPEC §Color), recharts line chart with inverted Y-axis (UI-SPEC §Component Inventory + RESEARCH §Pitfall 9), pg_cron 18:00-Brussels DST-safe dual schedule (RESEARCH §Pitfall 2), persistent non-dismissible banner stack (UI-SPEC §UI4-D08), yellow ⚠ chip overlay (UI-SPEC §UI4-D07).

### File Created

`/Users/kris/Documents/Claude Code/VTTL Topsport/.planning/phases/04-kerndomein/04-PATTERNS.md`

### Ready for Planning

Pattern mapping complete. `gsd-planner` can now reference analog patterns in PLAN.md files. Every locked decision D-60..D-91 and every Wave 0 test file from VALIDATION.md has a pattern entry; the ~13 net-new patterns (splitRRule math, split-column XOR, 5-star input, "Te scoren" widget, pg_cron job, system_inbox, idempotency middleware, NudgeBannerStack, yellow ⚠ chip overlay, recharts wrapper, BelgiumTimelineStrip, RankingTypeSelector, RruleScopePickerDialog, MultiDayPicker) are explicitly flagged with canonical reference docs (RESEARCH.md / UI-SPEC.md / library docs).
