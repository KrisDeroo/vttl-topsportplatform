---
phase: 04-kerndomein
verified: 2026-05-19T10:30:00Z
status: gaps_found
score: 6/14 must-haves verified (8 with blockers)
overrides_applied: 0
gaps:
  - truth: "Denied-outcome audit rows are forensically observable (D-67/D-72 + GDPR-04 + Pitfall 3)"
    status: failed
    reason: "Every `writeAudit(..., outcome:'denied')` call in training/tournament/calendar runs inside the RLS-bound withRlsContext transaction. The TRPCError throw immediately afterward rolls the audit row back. The forensic-visibility property documented in the inline T-04-19 threat-mitigation comment is not delivered."
    artifacts:
      - path: "src/server/trpc/routers/training.ts"
        issue: "Lines 170-184: writeAudit('training_score_window_expired_attempt', outcome:'denied') is followed by `throw new TRPCError` inside the RLS tx — Drizzle rolls back the audit row with the failing tx."
      - path: "src/server/trpc/routers/tournament.ts"
        issue: "Lines 600-617: writeAudit('tournament_entry_window_expired_attempt', outcome:'denied') has the same rollback bug."
      - path: "src/server/trpc/routers/calendar.ts"
        issue: "Lines 1738-1749 & 1822-1833: calendar_event_* denied-outcome audit rows roll back."
      - path: "src/server/trpc/middleware/audit.ts"
        issue: "auditMiddleware (lines 136-158) strips ctx.db on rejection — the explicit per-handler denied calls need the same treatment."
    missing:
      - "Add `writeAuditOutsideTx(ctx, entry)` helper that swaps ctx.db for rawDb so the audit INSERT commits outside the failing transaction."
      - "Apply the helper to all 4 denied-audit call sites listed above."
      - "Verify audit_log RLS INSERT policy is WITH CHECK (true) so the post-rollback insert succeeds."

  - truth: "VALID-08 idempotency middleware binds requests to their input (Pitfall 5)"
    status: failed
    reason: "Cache lookup uses (key, userId, endpoint) with no input hash. A client can send the same `_meta.idempotencyKey` with DIFFERENT inputs within 24h and receive the cached response of the first call. The schema declares `response_hash` precisely for this; the middleware always writes `null`."
    artifacts:
      - path: "src/server/trpc/middleware/idempotency.ts"
        issue: "Lines 77-92 (lookup) and 131-151 (insert) — `responseHash: null` on line 145 with comment 'Optional sha256 — defer to v2'. No input canonicalisation, no comparison on cache HIT."
    missing:
      - "Canonicalise raw input (sorted-keys JSON) and sha256 it; store as request_hash on insert."
      - "On cache HIT, verify stored hash matches the new request's hash; mismatch = treat as miss OR reject with CONFLICT."
      - "Rename schema column to request_hash OR add a separate column."

  - truth: "Past-data immutability (D-83) holds for ALL three editRecurring scopes"
    status: failed
    reason: "The past-occurrence guard (splitIso < todayIso) is implemented only in the 'single' and 'this_and_future' branches. The 'all_in_series' branch UPDATEs calendar_events.startsAt / endsAt / rrule with no past-date check, breaking the conceptual anchor of historical session_participants rows."
    artifacts:
      - path: "src/server/trpc/routers/calendar.ts"
        issue: "Lines 2019-2113 (all_in_series branch): no `splitIso < todayIso` guard. The Zod refinement (schemas/calendar.ts:423-431) only checks endsAt > startsAt."
    missing:
      - "Add a past-startsAt check in the 'all_in_series' branch, OR a refinement on editRecurringEditsSchema."
      - "Add i18n key `errors.calendar.cannotMoveSeriesToPast` to all three locale catalogs."

  - truth: "tournament.enterResult entry route targets a deterministically chosen player (D-79 + D-75 correctness)"
    status: failed
    reason: "`result/page.tsx` line 65 picks `existing?.results[0]?.playerUserId` as the default target for non-player callers — the first-by-enteredAt player. A TD navigating to /tournaments/[id]/result is silently positioned to overwrite some other player's result instead of entering one for the intended player. No `?playerId=` query parameter is read."
    artifacts:
      - path: "src/app/[locale]/(app)/tournaments/[eventId]/result/page.tsx"
        issue: "Line 65: `const targetPlayerId = isPlayer ? callerId : (existing?.results[0]?.playerUserId ?? callerId);` — arbitrary fallback for non-player callers. Line 89 then flags the form as overwrite, pre-populating with another player's data."
      - path: "src/components/tournament/tournament-results-leaderboard.tsx"
        issue: "Result-row navigation links do not include `?playerId=` query string."
      - path: "src/components/tournament/tournament-participants-panel.tsx"
        issue: "Same — links to the result route do not carry a target playerId."
    missing:
      - "Accept `?playerId=` and require it for non-player callers (or render a player-selector when absent)."
      - "Gate the navigation links from the leaderboard and participants panel to include the playerId query string."

  - truth: "tournament.listPendingForPlayer enforces the documented role allowlist (RBAC + nudge-banner contract)"
    status: failed
    reason: "Docstring (line 856-857) says 'Other roles → FORBIDDEN' but handler only rejects the player-cross-target case. medical_staff, sparring_partner, academy_manager, etc. can call with any playerUserId. RLS narrows the LEFT JOIN result, but the procedure's own contract is violated and enumeration surface grows."
    artifacts:
      - path: "src/server/trpc/routers/tournament.ts"
        issue: "Lines 858-872: only `if (callerRole === 'player' && targetPlayerId !== callerId)` is gated. No else branch rejecting non-allowlisted roles."
    missing:
      - "Add `else if (!['player','trainer','technical_director','parent'].includes(callerRole)) throw FORBIDDEN`."
      - "For the parent branch, verify targetPlayerId is a child via parent_child_links probe (mirror trainer-academy probe at lines 619-641)."

  - truth: "system_inbox cron-INSERT path is reachable on managed Postgres (D-67 ch2 + D-72 ch2)"
    status: failed
    reason: "system_inbox has FORCE ROW LEVEL SECURITY. Migration 0020 declares only SELECT-own and UPDATE-own policies. No INSERT policy. The SECURITY DEFINER cron functions from 0019 INSERT into a FORCE-RLS table — under FORCE RLS the function owner IS subject to RLS, so on Supabase (the platform's chosen managed Postgres tier) the nightly nudge INSERTs will silently raise and be lost to cron.job_run_details. Comment in 0020 lines 54-58 acknowledges this and defers the fix."
    artifacts:
      - path: "drizzle/0020_phase4_system_inbox.sql"
        issue: "Lines 39-58: ENABLE + FORCE RLS, then SELECT/UPDATE policies only. No CREATE POLICY ... FOR INSERT and no explicit REVOKE/GRANT for the function role."
      - path: "drizzle/0019_phase4_pg_cron_nudges.sql"
        issue: "Lines 40-55 + 80-98 — SECURITY DEFINER functions INSERT into system_inbox unconditionally."
    missing:
      - "Add `CREATE POLICY system_inbox_insert_security_definer ON system_inbox FOR INSERT WITH CHECK (true)` plus explicit `REVOKE INSERT, UPDATE, DELETE ON system_inbox FROM app_user`."
      - "Alternative: drop FORCE and rely on ENABLE only — but the explicit policy is the better invariant."

  - truth: "system_inbox guards against per-day duplicate nudge stacking (D-67/D-72 inbox hygiene)"
    status: failed
    reason: "Two cron functions INSERT INTO system_inbox unconditionally per day. No UNIQUE constraint, no `WHERE NOT EXISTS` guard. A trainer with one unscored session accumulates 14 rows over 14 days. UI shows wall-of-text fatigue contrary to the nudge UX intent. Also a GDPR retention concern."
    artifacts:
      - path: "drizzle/0020_phase4_system_inbox.sql"
        issue: "Lines 21-30: no UNIQUE (user_id, kind, generated_date) or partial unique on (user_id, kind, date(created_at AT TIME ZONE 'Europe/Brussels'))."
      - path: "drizzle/0019_phase4_pg_cron_nudges.sql"
        issue: "Cron INSERTs lack `ON CONFLICT DO NOTHING` or anti-duplicate predicate."
    missing:
      - "Add partial unique index on (user_id, kind, (created_at AT TIME ZONE 'Europe/Brussels')::date)."
      - "Change cron INSERTs to `ON CONFLICT ON CONSTRAINT uq_system_inbox_daily DO NOTHING`."
      - "Recommended: admin pg_cron job purges read rows > 30 days."

  - truth: "i18n strings render without literal markdown markers and without HTML-injection sinks"
    status: failed
    reason: "Two components render i18n catalog strings via `dangerouslySetInnerHTML`. Catalogs contain markdown-style `**bold**` markers that do NOT render as <strong> in HTML — users literally see asterisks AND any future catalog change introducing real HTML renders unsanitised. Phase 3 conflict-banner.tsx already chose the safer JSX-split pattern; Phase 4 regressed."
    artifacts:
      - path: "src/components/nudge/nudge-banner.tsx"
        issue: "Line 127: `<p className='flex-1 text-sm' dangerouslySetInnerHTML={{ __html: body }} />` rendering catalog strings like `⚠ **{n} trainingen** — nog **{daysLeft} dagen**`."
      - path: "src/components/calendar/rrule-scope-picker-dialog.tsx"
        issue: "Lines 85, 101, 117: three dangerouslySetInnerHTML sinks rendering scopeThisPreview/scopeFuturePreview/scopeAllPreview with `**date**` markdown markers."
    missing:
      - "Replace catalog `**bold**` markers with next-intl rich-text `<b>` chunks and use `t.rich(key, { b: c => <strong>{c}</strong> })`."
      - "Drop dangerouslySetInnerHTML from both files."
      - "Add a lint guard or test forbidding dangerouslySetInnerHTML in components under src/components/."

  - truth: "DOM-CAT-02 age-category snapshot resolves the correct calendar-day for evening tournaments (Brussels anchoring)"
    status: failed
    reason: "`getAgeCategoryAt` slices the date via `.toISOString().slice(0, 10)`, producing a UTC date. For a tournament starting at 2026-01-01 02:00 Brussels (= 2025-12-31 23:00 UTC), the helper queries age_category_history with `dateIso = '2025-12-31'` — finding the prior year's age-category row. The wrong code is frozen on tournament_results.player_age_category_code with no auto-correction. Phase 4 rrule.ts ships formatOccurrenceDate as the Brussels-anchored replacement."
    artifacts:
      - path: "src/lib/players.ts"
        issue: "Line 102: `const dateIso = date.toISOString().slice(0, 10);` — UTC slice instead of Brussels-anchored format."
      - path: "src/server/trpc/routers/tournament.ts"
        issue: "Line 664: calls `getAgeCategoryAt(input.playerUserId, ev.startsAt, db)` — propagates the UTC drift into DOM-CAT-02 snapshot."
    missing:
      - "Import `formatOccurrenceDate` from `@/lib/rrule` in `src/lib/players.ts` and use it on the date param."
      - "Audit other call sites of `.toISOString().slice(0, 10)` across Phase 4 (see also WR-02 in 04-REVIEW.md — six additional call sites in calendar/training/tournament UI)."

deferred:
  - truth: "Tournament/training routers expose human-readable user names for UUID-keyed result/pending rows"
    addressed_in: "Phase 5 (Uitgebreid domein) — extends player/trainer profiles and read-side projections"
    evidence: "tournament.get/listResults/training.listPending return user uuids without userName JOINs; 04-08 SUMMARY acknowledges this; Phase 5 expands the player view (VIEW-01) and adds the named projections via the synthesis layer. Phase 7 (Synthese) finalises the tabbed player view."

  - truth: "typedRoutes pre-existing 25 typecheck errors resolved (build green)"
    addressed_in: "Phase 8 (Kwaliteit & Release) — build/lint hardening + tooling stabilisation"
    evidence: "deferred-items.md notes the issue is a project-wide Next.js 15 `experimental.typedRoutes: true` incompatibility with `redirect(\\`/${locale}/...\\`)`. 9 baseline + 10 added by Phase 4 (same idiom). Recommended fix (typedRoutes: false) is a single-line workspace change appropriate for the release-quality phase."

  - truth: "15 pre-existing unit test failures (medical-schema, lookup-codes, magic-bytes, etc.) resolved"
    addressed_in: "Phase 8 (Kwaliteit & Release)"
    evidence: "deferred-items.md verifies these all fail at base commit b6d56ce, predating Phase 4. They reflect Phase 1/2 Drizzle API drift and pre-existing helper mismatches — not Phase 4 regressions."

  - truth: "Daily 18:00 inbox cron tick + cron.job_run_details visibility (HUMAN-UAT §2.2)"
    addressed_in: "Phase 4 close — HUMAN-UAT.md staging verification"
    evidence: "8 documented manual UAT items in 04-HUMAN-UAT.md cover: trainer banner non-dismissible (D-67 ch1), daily 18:00 inbox tick (D-67 ch2 + D-72 ch2), yellow chip overlay (D-67 ch3), escalating tone (D-67 ch4), recharts inverted Y-axis (D-87/D-88), Belgium tier-color band (D-87), 5-star DB write (D-60), BYDAY picker (D-85), plus multilingual sanity and end-to-end walkthrough."

human_verification:
  - test: "Trainer 'Te scoren' banner non-dismissible across navigation (D-67 ch1)"
    expected: "Banner appears on every page header for trainer with NULL-quality_score sessions, no close (×) button, auto-clears when all scored."
    why_human: "Visual interaction state across page navigation cannot be programmatically verified."
  - test: "Daily 18:00 Brussels inbox tick (D-67 ch2 / D-72 ch2)"
    expected: "After 18:00 Brussels tick on staging, trainer with pending-score session sees `kind=trainer_score_nudge` row; player with pending tournament result sees `kind=player_result_nudge` row."
    why_human: "Real cron tick + time-of-day cannot be reproduced in CI without mocking the entire stack. ALSO blocked by CR-06 — INSERT policy must be added before this can pass on Supabase tier."
  - test: "Yellow ⚠ chip overlay on past-session calendar chip (D-67 ch3)"
    expected: "Yellow warning marker on chip for past session with NULL quality scores; disappears when scored."
    why_human: "Visual rendering on Phase 3 chip variant extension. ALSO blocked by WR-09 — needsScoring aggregate is across-all-occurrences."
  - test: "Escalating message tone day 7 / 10 / 12 (D-67 ch4)"
    expected: "Body copy escalates as the 14d wall approaches; messages/nl.json `nudge.trainerScore.day7/day10/day12` keys drive the copy."
    why_human: "Copy verification at specific day-offsets. ALSO blocked by WR-10 — daysLeft off-by-one + CR-08 markdown markers."
  - test: "recharts inverted Y-axis (D-87 / D-88)"
    expected: "Rank 1 at top of chart; axis label `Ranking (lager = beter)`; inversion survives 200% zoom."
    why_human: "Visual chart interpretation. ALSO impacted by WR-07 — chart hardcodes nl-BE date locale."
  - test: "Belgium timeline strip tier-color band (D-87)"
    expected: "Year cells colored per tier (A=gold/B=silver/etc); no interpolation; popover surfaces metadata; keyboard navigable."
    why_human: "Visual color mapping per tier."
  - test: "5-star input → DB 2/4/6/8/10 (D-60)"
    expected: "Click 3rd star + Save → session_participants.quality_score = 6; 0 stars = NULL."
    why_human: "Visual interaction + DB write verification."
  - test: "Multi-day BYDAY RRULE picker (D-85)"
    expected: "FREQ=WEEKLY + BYDAY=TU,TH expansion places chips on Tue+Thu only; preview shows next 5 occurrences across both days."
    why_human: "UI affordance for multi-day patterns."
---

# Phase 4: Kerndomein Verification Report

**Phase Goal:** Ship the operational domain — training quality scoring, tournament results, ranking entries, internal nudging, calendar refinements — with full RBAC, audit, and i18n (nl/en/fr) coverage. Backend routers, schema migrations, and frontend surfaces must all be in place; tests transition from Wave 0 RED to GREEN.

**Verified:** 2026-05-19T10:30:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #   | Truth                                                                                        | Status     | Evidence                                                                                                                                                                                                                                                                                                                                  |
| --- | -------------------------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Trainer can record attendance + quality_score (D-60) + feedback per session (TRAIN-04/05)    | ✓ VERIFIED | `src/server/trpc/routers/training.ts` exposes `markAttendanceAndScore` atomic bulk upsert (lines 274-347 list-pending; mark-attendance includes occurrenceDate PK + audit). Schema CHECK 1..10. Form `BulkAttendanceScoreForm` + `StarRatingInput` (mapDb 2/4/6/8/10) wired.                                                                |
| 2   | D-64 14-day absolute wall on training scoring (NO TD override)                                 | ✓ VERIFIED | `training.ts:167-184` — wallExpired check `Date.now() - endsAt > FOURTEEN_DAYS_MS`; throws FORBIDDEN errors.training.scoreWindowExpired.                                                                                                                                                                                                  |
| 3   | TRAIN-03 RRULE recurring training with 3-scope edit (D-83/D-84/D-85 BYDAY)                     | ✗ FAILED   | `calendar.editRecurring` exists with all 3 scopes (calendar.ts:1668-2113). `splitRRule` helper present in src/lib/rrule.ts. BYDAY validation in schemas/calendar.ts. **BUT** `all_in_series` branch (lines 2019-2113) bypasses D-83 past-immutable guard. See gap "Past-data immutability".                                                |
| 4   | Tournament atomic enterResult (D-69 + D-80) + DOM-CAT-02 snapshot + entered_by attribution    | ⚠️ PARTIAL  | Atomic tx (lines 696-746): UPSERT tournament_results + DELETE+INSERT match_results. DOM-CAT-02 snapshot at startsAt (line 664). entered_by derived from caller role. BUT see CR-09 — UTC slice in `getAgeCategoryAt` drifts snapshot day for evening events. **AND** see CR-03 — entry route picks arbitrary first-by-enteredAt player.    |
| 5   | TOURN-05 + D-71/D-73/D-75 asymmetric 14d wall per role                                         | ✓ VERIFIED | `tournament.enterResult` line 600-617 walls player only; trainer-in-academy + TD bypass. Denied audit emission written (but rolled back — see gap "Denied audit").                                                                                                                                                                          |
| 6   | TOURN-02 + D-79: TD-only tournament/participant CRUD                                           | ✓ VERIFIED | `tournament.create`/`addParticipant`/`removeParticipant` declared with `tdProcedure`. Audit codes `tournament_created` + `tournament_participant_added`/`_removed` present.                                                                                                                                                                  |
| 7   | TOURN-06 + D-78: academy-wide result visibility (5-branch UNION)                               | ✓ VERIFIED | `tournament_result_visible_to(uid, role)` SECURITY DEFINER 5-branch UNION declared in `drizzle/0018_phase4_rls_helpers_and_sparring_branch.sql` lines 146-211. `tournament.listResults` defers entirely to RLS scope.                                                                                                                       |
| 8   | RANK-01..07 + DOM-RANK-01 split-column XOR + D-86 + D-89 RBAC                                  | ⚠️ PARTIAL  | Schema XOR CHECK present (`ranking_entries_value_xor`). Discriminated union Zod, value_shape cross-check, idempotency wired (ranking.ts:127-260). RBAC player+TD only enforced. RankingLineChart `<YAxis reversed />` (line 150). BUT WR-07 — chart hardcodes `nl-BE` date locale; en/fr users see Dutch-formatted dates.                  |
| 9   | D-67/D-72 system_inbox nudge channels (4-channel system) with pg_cron                          | ✗ FAILED   | system_inbox table exists, pg_cron functions registered, inbox router exposes listUnread/listAll/markRead, NudgeBanner stack ships. **BUT** CR-06 — INSERT into FORCE-RLS table without INSERT policy will silently fail on Supabase. **AND** CR-07 — no anti-duplicate constraint stacks rows daily. **AND** WR-09 needsScoring aggregate. |
| 10  | DOM-MED-CONFLICT-01/02 surfaces overlapping medical events; defaults attendance to absent_medical | ✓ VERIFIED | `training.markAttendanceAndScore` + `getSession` consume overlap signal; form pre-flags via `hasMedicalConflict`; `AttendanceToggle` defaults to `absent_medical`. Wave-0 RED test `attendance-medical-default.test.ts` exists.                                                                                                              |
| 11  | VALID-07 match_results UNIQUE (tournament, player, round, opponent, date)                      | ✓ VERIFIED | `src/server/db/schema/tournament.ts:130-136` — `match_results_unique_player_round_opponent_date`. Migration 0015 contains the same.                                                                                                                                                                                                         |
| 12  | VALID-08 idempotency middleware composed on POST endpoints                                     | ✗ FAILED   | Middleware exists and is wired into `tournament.enterResult` + `training.markAttendanceAndScore` + `ranking.addEntry`. BUT CR-02 — input is not hashed; `responseHash: null` allows same key + different input to replay cached response. Correctness break + replay surface.                                                              |
| 13  | GDPR-04 audit log emission on every state-changing write                                       | ⚠️ PARTIAL  | 14 of 15 audit codes emitted across routers (success path). BUT CR-01 — every `denied` audit row is rolled back with its failing transaction, so forensic visibility on FORBIDDEN paths is broken.                                                                                                                                          |
| 14  | i18n nl/en/fr key parity + no placeholder markers (I18N-10 prep)                                | ✓ VERIFIED | `messages/{nl,en,fr}.json` all 592 keys identical, zero MISSING_TRANSLATION markers, `tests/unit/i18n-catalog-completeness.test.ts` green. **BUT** at runtime 5 hardcoded Dutch labels in `tournaments/[eventId]/page.tsx` lines 56-77 bypass i18n entirely — WR-05. Catalog parity ≠ surface parity.                                       |

**Score:** 6 verified / 5 partial / 3 failed of 14 must-haves. 9 BLOCKERs (REVIEW.md CR-01 to CR-09) directly contradict declared Phase 4 invariants.

### Deferred Items

| # | Item                                                            | Addressed In             | Evidence                                                                                                       |
| - | --------------------------------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------- |
| 1 | UUID→userName JOINs on tournament.get / listResults / training.listPending | Phase 5 + Phase 7 (Synthese / player view VIEW-01) | Acknowledged in 04-08 SUMMARY; Phase 5 expands player profile + read projections; Phase 7 builds player view.   |
| 2 | 25 typedRoutes typecheck errors (build)                         | Phase 8 (Kwaliteit & Release) | Documented in `deferred-items.md`; pattern affects whole codebase, not just Phase 4. Suggested fix `typedRoutes: false` is a single-line workspace change. |
| 3 | 15 pre-existing unit test failures                              | Phase 8 (Kwaliteit & Release) | Verified at base commit b6d56ce in deferred-items.md — pre-Phase-4. Reflects Phase 1/2 Drizzle drift; not regressions. |
| 4 | 8 HUMAN-UAT manual verifications                                | Phase 4 close (staging UAT) | 04-HUMAN-UAT.md ships; staging environment + Brussels TZ required. Several items unblocked only after BLOCKERs resolved. |

### Required Artifacts

| Artifact                                                                  | Expected                                                                              | Status     | Details |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ---------- | ------- |
| `drizzle/0014_phase4_session_participants_and_sparring_junction.sql`     | session_participants (PK occurrence_date) + session_sparring_partners junction        | ✓ VERIFIED | Table DDL + FK to calendar_events present. |
| `drizzle/0015_phase4_tournament_results_and_match_results.sql`            | tournament_results + match_results with VALID-07 unique + D-81 set-tally CHECK         | ✓ VERIFIED | UNIQUE + CHECK constraints declared. |
| `drizzle/0016_phase4_rankings_and_belgium_classification.sql`             | ranking_entries XOR CHECK + belgium_classification lookup + value_shape ALTER         | ✓ VERIFIED | Schema verified against barrels. |
| `drizzle/0017_phase4_lookup_seeds.sql`                                    | 9+5+4+6+7+10+67 lookup rows seeded                                                    | ✓ VERIFIED | Seven INSERT blocks confirmed. |
| `drizzle/0018_phase4_rls_helpers_and_sparring_branch.sql`                 | 3 new SECURITY DEFINER + extends calendar_events_visible_to with Branch 6              | ✓ VERIFIED | session_participants_visible_to, tournament_result_visible_to, ranking_entry_visible_to all declared. |
| `drizzle/0019_phase4_pg_cron_nudges.sql`                                  | pg_cron + 2 nudge fns + dual 16:00/17:00 UTC schedule + Brussels guard                 | ⚠️ STUB     | Functions exist with Brussels-hour guard, BUT INSERT into FORCE-RLS table without policy will fail (CR-06). |
| `drizzle/0020_phase4_system_inbox.sql`                                    | system_inbox table + RLS                                                              | ⚠️ STUB     | Table + SELECT/UPDATE policies present. Missing INSERT policy (CR-06) + dedup constraint (CR-07). |
| `src/server/db/schema/{training,tournament,ranking,inbox}.ts`             | Drizzle barrels with composite PKs and CHECK constraints                              | ✓ VERIFIED | Imports + exports correct; index.ts barrel re-exports all. |
| `src/server/trpc/middleware/idempotency.ts`                               | VALID-08 dedup with 24h TTL                                                           | ⚠️ STUB     | Middleware factory + 24h TTL + audit replay code present, BUT no input hash (CR-02). |
| `src/server/trpc/routers/training.ts`                                     | training router 3 procedures (markAttendanceAndScore / listPending / getSession)      | ⚠️ PARTIAL  | Procedures exist; denied audit pattern broken (CR-01). listPending returns raw trainer UUID (WR-04 — deferred). |
| `src/server/trpc/routers/tournament.ts`                                   | tournament router 8 procedures                                                        | ⚠️ PARTIAL  | All 8 procedures shipped; CR-01 denied audit bug; CR-04 listPendingForPlayer role gate; listResults returns raw player UUIDs (deferred). |
| `src/server/trpc/routers/ranking.ts`                                      | ranking router 4 procedures + discriminated union + idempotency                       | ✓ VERIFIED | All 4 procedures present; XOR Zod composed; RBAC literal. |
| `src/server/trpc/routers/calendar.ts`                                     | event.editRecurring 3-scope + sparring branch                                          | ⚠️ PARTIAL  | All 3 scopes implemented; **CR-05 — `all_in_series` bypasses D-83 past-immutable**. |
| `src/server/trpc/routers/inbox.ts`                                        | listUnread / listAll / markRead                                                       | ✓ VERIFIED | RLS DiD + idempotent markRead + inbox_marked_read audit emitted. |
| `src/lib/rrule.ts`                                                        | splitRRule helper (D-84)                                                              | ✓ VERIFIED | Function exported and unit-tested. |
| `src/lib/quality-score.ts`                                                | mapStarsToDb (5-star → 2/4/6/8/10)                                                    | ✓ VERIFIED | Helper + unit tests green. |
| `src/lib/players.ts`                                                      | getAgeCategoryAt for DOM-CAT-02 snapshot                                              | ⚠️ STUB     | Function exists; **CR-09 — UTC slice drifts the snapshot day for Brussels evening events**. |
| `src/components/common/star-rating-input.tsx`                             | ARIA-compliant 5-star → DB 2/4/6/8/10                                                  | ✓ VERIFIED | Renders + writes correct DB values per HUMAN-UAT §2.7. |
| `src/components/training/bulk-attendance-score-form.tsx`                  | Combined attendance+score form (D-62)                                                  | ✓ VERIFIED | useFieldArray + single Save composition. |
| `src/components/tournament/tournament-result-entry-form.tsx`              | Atomic entry form                                                                     | ⚠️ PARTIAL  | Form OK; WR-12 datetime-local timezone confusion; WR-13/14 idempotency key handling. |
| `src/components/ranking/ranking-line-chart.tsx`                           | recharts `<YAxis reversed />`                                                          | ⚠️ PARTIAL  | Inverted Y present; WR-07 — locale hardcoded `nl-BE`. |
| `src/components/ranking/belgium-timeline-strip.tsx`                       | Pure-CSS tier-band timeline                                                            | ✓ VERIFIED | Tier-band rendering + popover. |
| `src/components/nudge/nudge-banner-stack.tsx` + `nudge-banner.tsx`        | Non-dismissible escalating banner                                                     | ✗ STUB     | Renders, but **CR-08 dangerouslySetInnerHTML XSS + markdown markers fail to bold; WR-10 daysLeft off-by-one**. |
| `src/components/calendar/rrule-scope-picker-dialog.tsx`                   | 3-scope picker dialog with preview                                                    | ⚠️ STUB     | UI exists; **CR-08 dangerouslySetInnerHTML XSS in 3 places**. |
| `src/components/common/multi-day-picker.tsx`                              | BYDAY 7-toggle picker                                                                 | ✓ VERIFIED | Toggle group + Zod min(1). |
| `messages/{nl,en,fr}.json`                                                | i18n parity + Phase 4 keyspace                                                        | ⚠️ PARTIAL  | Catalogs identical 592 keys with no markers. BUT WR-05 `tournament-detail` page hardcodes 5 Dutch labels bypassing i18n entirely. |
| `tests/fixtures/phase4-seed.ts`                                           | seedPhase4 helper                                                                     | ✓ VERIFIED | Exports seedPhase4; 24 integration tests reference it. |
| `tests/integration/*.test.ts` (24 files)                                  | Wave 0 RED → GREEN                                                                    | ✓ VERIFIED | All compile cleanly; skip-on-no-DB gate works locally (ECONNREFUSED on 127.0.0.1:6543 surfaces as "fail" only when CI testcontainer absent). |
| `tests/e2e/rankings-tab.spec.ts`                                          | recharts inverted Y + Belgium tier-band                                                | ✓ VERIFIED | Playwright spec exists with skip-on-no-auth gate. |
| `.planning/phases/04-kerndomein/04-HUMAN-UAT.md`                          | 8-item manual UAT script                                                              | ✓ VERIFIED | Complete with reproduction steps; 8 D-XX-anchored items + multilingual + e2e walkthrough. |
| `.planning/phases/04-kerndomein/04-VALIDATION.md`                         | Per-Task Verification Map filled GREEN                                                | ✓ VERIFIED | 21 rows green; nyquist_compliant true. |

### Key Link Verification

| From                                                          | To                                            | Via                                            | Status     | Details |
| ------------------------------------------------------------- | --------------------------------------------- | ---------------------------------------------- | ---------- | ------- |
| `drizzle/0014_*.sql`                                         | `drizzle/0009_*.sql`                          | FK to calendar_events                          | ✓ VERIFIED | 2 REFERENCES "calendar_events"("id") in 0014. |
| `drizzle/0018_*.sql`                                         | `drizzle/0011_*.sql`                          | CREATE OR REPLACE calendar_events_visible_to   | ✓ VERIFIED | Function declaration + Branch 6 sparring filled in 0018. |
| `drizzle/0019_*.sql`                                         | `drizzle/0020_*.sql`                          | pg_cron INSERT INTO system_inbox               | ⚠️ STUB     | INSERT present, but reception blocked by missing INSERT policy on receiver. |
| `src/server/db/schema/index.ts`                               | training/tournament/ranking/inbox barrels      | `export * from './training'` etc.              | ✓ VERIFIED | All four barrels re-exported. |
| `src/server/trpc/routers/training.ts`                         | `src/server/db/schema/training.ts`            | sessionParticipants import                     | ✓ VERIFIED | Import present + used in markAttendanceAndScore + listPending. |
| `src/server/trpc/routers/tournament.ts`                       | `src/lib/players.ts`                          | getAgeCategoryAt for DOM-CAT-02                | ✓ VERIFIED | Line 664 call; BUT see CR-09 UTC drift. |
| `src/server/trpc/routers/tournament.ts`                       | `src/server/trpc/middleware/idempotency.ts`   | idempotencyMiddleware('tournament.enterResult')| ✓ VERIFIED | Wired at line 539. |
| `src/server/trpc/routers/ranking.ts`                          | `src/server/trpc/middleware/idempotency.ts`   | idempotencyMiddleware('ranking.addEntry')      | ✓ VERIFIED | Wired at line 128. |
| `src/server/trpc/routers/calendar.ts`                         | `src/lib/rrule.ts`                            | splitRRule import                              | ✓ VERIFIED | Used in editRecurring this_and_future branch. |
| `src/components/training/bulk-attendance-score-form.tsx`      | `src/server/trpc/routers/training.ts`         | trpc.training.markAttendanceAndScore.useMutation | ✓ VERIFIED | Wiring through trpc-client. |
| `src/components/tournament/tournament-result-entry-form.tsx`  | `src/server/trpc/routers/tournament.ts`       | trpc.tournament.enterResult.useMutation        | ✓ VERIFIED | Idempotency key generation + meta wiring. |
| `src/components/ranking/ranking-line-chart.tsx`               | `src/server/trpc/routers/ranking.ts`          | trpc.ranking.getHistory.useQuery               | ✓ VERIFIED | Query hook present. |
| `src/components/nudge/nudge-banner.tsx`                       | `src/server/trpc/routers/training.ts`         | trpc.training.listPending.useQuery (30s)       | ✓ VERIFIED | Polling interval set. |

### Data-Flow Trace (Level 4)

| Artifact                                                          | Data Variable                       | Source                                                | Produces Real Data | Status        |
| ----------------------------------------------------------------- | ----------------------------------- | ----------------------------------------------------- | ------------------ | ------------- |
| `tournaments/[eventId]/page.tsx` TournamentParticipantsPanel       | participants={[]}                   | hardcoded empty array prop                            | ✗                  | ✗ HOLLOW_PROP — needs to fetch participant list from tournament router (not shipped; tracked alongside CR-03 fix). |
| `BulkAttendanceScoreForm` participants                            | session.participants                | training.getSession → session_participants            | ✓                  | ✓ FLOWING — DB-backed query. |
| `TournamentResultEntryForm` initial state                         | playerResult, playerMatches         | tournament.listResults                                | ✓ (with caveat)    | ⚠️ DRIFT — for non-player callers the result page picks first-by-enteredAt row (CR-03); data flows but to wrong subject. |
| `RankingLineChart` data                                           | ranking.getHistory                  | ranking_entries via 4-branch UNION RLS                | ✓                  | ✓ FLOWING. |
| `NudgeBannerStack` count                                          | training.listPending / inbox.listUnread | session_participants quality_score IS NULL aggregate | ⚠️                  | ⚠️ HOLLOW for trainer overlay — WR-09 needsScoring aggregates across all occurrences of a recurring training rather than per-occurrence. |
| `MinimalSystemInbox`                                              | inbox.listAll                       | system_inbox table                                    | ⚠️                  | ⚠️ DISCONNECTED on Supabase — CR-06 INSERT policy missing means table will not receive cron rows. |
| `tournament-detail/page.tsx` lookup labels                         | tournamentTypeCode / ageCategoryCode | Raw lookup codes shown to user                       | ⚠️                  | ⚠️ STATIC — WR-06 displays `tournament_wtt` / `age_senior` literally instead of i18n labels. |

### Behavioral Spot-Checks

| Behavior                                                   | Command                                                  | Result      | Status |
| ---------------------------------------------------------- | -------------------------------------------------------- | ----------- | ------ |
| Phase 4 unit tests pass                                    | `pnpm test -- tests/unit/{i18n-catalog,migration-format,rrule-split,quality-score-range,match-derived-won,ranking-xor,idempotency-middleware,outcome-level-seed,rrule-byday,entered-by-derivation}.test.ts --run` | 37 passed, 24 todo, 0 failed | ✓ PASS |
| i18n nl/en/fr key parity                                    | Node script flattening + diffing all three catalogs       | 592 keys each, 0 missing, 0 extra | ✓ PASS |
| No `[MISSING_TRANSLATION]` markers in nl.json               | Flatten + grep                                            | 0 placeholder markers | ✓ PASS |
| typecheck                                                   | `pnpm typecheck`                                          | 25 errors — all `RouteImpl` typedRoutes (deferred-items.md) | ? SKIP — pre-existing tooling issue, deferred to Phase 8. |
| Integration tests                                           | `pnpm test -- tests/integration/ --run`                   | 34 failed — all `ECONNREFUSED 127.0.0.1:6543` (no local DB) | ? SKIP — testcontainer/staging-only. Tests compile and exit-skip when DB absent. |
| Belgium classification lookup seeded with 67 rows           | grep + manual SQL inspection                              | 67 codes present in 0017 (A1..A50 + B/C/D/E0/2/4/6 + NC) | ✓ PASS |
| pg_cron jobs registered                                     | grep                                                      | 4 cron.schedule calls present (dual 16/17 UTC × 2 funcs) | ✓ PASS |
| All 15 audit codes emitted                                  | grep across routers                                       | 14 of 15 codes emit; `ranking_entry_updated` documented as v2-reserved | ⚠️ PARTIAL — acceptable scope; documented. |

### Requirements Coverage

| Requirement      | Source Plan(s)                   | Description                                                         | Status        | Evidence                                                                                                                                |
| ---------------- | -------------------------------- | ------------------------------------------------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| TRAIN-01..06     | 04-01/02/03/06/08/09             | Training fields, RRULE recurring, session_participants, sparring junction | ⚠️ PARTIAL    | Schema + routers + UI ship; D-83 immutable past broken in editRecurring all_in_series.                                                  |
| TOURN-01..06     | 04-01/02/04/08/09                | Tournament + 9-level outcome + per-match + entered_by + dual-level query | ⚠️ PARTIAL    | All endpoints ship; CR-03 entry route target; CR-04 listPendingForPlayer gate.                                                          |
| RANK-01..07      | 04-01/02/05/08/09                | Time series + 5 ranking types + chart + RANK-06 RBAC literal        | ✓ SATISFIED   | Discriminated union + value_shape cross-check + line chart inverted Y + RBAC enforced.                                                  |
| DOM-RESULT-01..04 | 04-01/02/04                     | SUPERSEDED by D-74/D-76/D-77/D-81 — REQUIREMENTS.md annotations     | ✓ SATISFIED   | Verified annotation lines in REQUIREMENTS.md.                                                                                            |
| DOM-RANK-01      | 04-01/02/05                      | source column manual/federation_official; v1 manual only            | ✓ SATISFIED   | CHECK + Zod default manual.                                                                                                              |
| DOM-CAT-01..02   | 04-01/02/04                      | age_category_history + snapshot at tournament.startsAt              | ✗ BLOCKED     | DOM-CAT-01 from Phase 2 reused; DOM-CAT-02 snapshot CALL exists but uses UTC slice (CR-09) — drifts day for Brussels evening events.    |
| DOM-MED-CONFLICT-01/02 | 04-01/03                   | Overlapping medical events warn + default attendance to absent_medical | ✓ SATISFIED   | training.getSession returns conflict flag; AttendanceToggle defaults absent_medical.                                                    |
| VALID-07         | 04-01/02/09                      | match_results UNIQUE                                                | ✓ SATISFIED   | Unique constraint shipped at schema + DB layer.                                                                                          |
| VALID-08         | 04-01/03/04/05                   | idempotency middleware on POST endpoints                            | ✗ BLOCKED     | Middleware composed but CR-02 input-binding missing — replay of cached response with mutated input is a correctness bug.                |
| GDPR-04          | 04-01/03/04/05/06/07/09          | Audit coverage                                                       | ✗ BLOCKED     | 14/15 success codes emit. CR-01 denied-outcome audit ROLLED BACK — forensic visibility on FORBIDDEN paths broken.                       |
| RANK-06          | 04-01/05/09                      | Rankings entered by player (own) or TD                              | ✓ SATISFIED   | D-89 + RANK-06 literal enforced in ranking.addEntry (trainer FORBIDDEN explicitly).                                                      |
| I18N-01..11      | 04-01/08                         | nl/en/fr key parity + I18N-10 catalog completeness test              | ⚠️ PARTIAL    | Catalogs parity 592 keys identical. But WR-05 — tournaments/[eventId]/page.tsx hardcodes 5 Dutch labels bypassing i18n.                  |

#### Orphan check
No Phase 4-scoped requirement IDs from REQUIREMENTS.md exist that are not declared in at least one plan's `requirements` frontmatter. (TRAIN/TOURN/RANK/DOM-RESULT/DOM-RANK/VALID-07/08/GDPR-04 all claimed.)

### Anti-Patterns Found

| File                                                                                        | Line(s)            | Pattern                                                | Severity   | Impact                                                                          |
| ------------------------------------------------------------------------------------------- | ------------------ | ------------------------------------------------------ | ---------- | ------------------------------------------------------------------------------- |
| `src/server/trpc/middleware/idempotency.ts`                                                  | 144-145            | `responseHash: null` "defer to v2"                     | 🛑 Blocker | CR-02 input-binding correctness bug.                                            |
| `src/server/trpc/routers/training.ts`                                                        | 170-184            | writeAudit denied INSIDE rollback tx                  | 🛑 Blocker | CR-01 denied-audit rolled back.                                                 |
| `src/server/trpc/routers/tournament.ts`                                                      | 600-617, 858-872   | writeAudit denied in tx; listPending role gate         | 🛑 Blocker | CR-01 + CR-04.                                                                  |
| `src/server/trpc/routers/calendar.ts`                                                        | 1738, 1822, 2019-2113 | writeAudit denied in tx; all_in_series past mutable | 🛑 Blocker | CR-01 + CR-05.                                                                  |
| `drizzle/0020_phase4_system_inbox.sql`                                                       | 39-58              | FORCE RLS without INSERT policy                        | 🛑 Blocker | CR-06 nightly cron silently fails on Supabase.                                  |
| `drizzle/0019_phase4_pg_cron_nudges.sql`                                                     | 40-55, 80-98       | No anti-duplicate guard                                | 🛑 Blocker | CR-07 inbox row stacking 14×.                                                   |
| `src/components/nudge/nudge-banner.tsx`                                                      | 127                | dangerouslySetInnerHTML with markdown markers          | 🛑 Blocker | CR-08 XSS sink + literal asterisks rendered.                                    |
| `src/components/calendar/rrule-scope-picker-dialog.tsx`                                      | 85, 101, 117       | dangerouslySetInnerHTML                                | 🛑 Blocker | CR-08 (3 sites).                                                                |
| `src/lib/players.ts`                                                                         | 102                | UTC date slice for DOM-CAT-02                          | 🛑 Blocker | CR-09 evening-tournament age category drift.                                    |
| `src/app/[locale]/(app)/tournaments/[eventId]/result/page.tsx`                              | 65                 | Default to results[0].playerUserId                     | 🛑 Blocker | CR-03 silent overwrite on wrong player.                                         |
| `src/server/trpc/routers/calendar.ts`                                                        | 732-794            | needsScoring aggregates across all occurrences          | ⚠️ Warning  | WR-09 chip overlay false-negative for established recurring trainings.          |
| `src/components/training/te-scoren-overview.tsx`                                             | 108, 105           | Progress formula meaningless; raw trainer UUID         | ⚠️ Warning  | WR-03 + WR-04 — misleading bar + undebuggable trainer column.                   |
| `src/app/[locale]/(app)/tournaments/[eventId]/page.tsx`                                    | 56, 62, 68, 72, 76 | 5 hardcoded Dutch labels in JSX                        | ⚠️ Warning  | WR-05 i18n parity violation in nl/en/fr renders.                                |
| `src/app/[locale]/(app)/tournaments/[eventId]/page.tsx`                                    | 69, 73             | Raw lookup codes shown to users                        | ⚠️ Warning  | WR-06 users see `tournament_wtt` / `age_senior` literally.                     |
| `src/app/[locale]/(app)/trainings/[eventId]/score/page.tsx`                                  | 80, 82             | Raw lookup codes via i18n var (not translated)         | ⚠️ Warning  | WR-06.                                                                          |
| `src/components/ranking/ranking-line-chart.tsx`                                              | 58-62, 140-144     | Hardcoded `nl-BE` date format                          | ⚠️ Warning  | WR-07 chart dates wrong locale for en/fr.                                       |
| `src/server/trpc/routers/tournament.ts`                                                      | 446-493            | savepoint vs outer-tx confusion in audit-before-delete | ⚠️ Warning  | WR-01 doc-code mismatch.                                                        |
| `src/components/calendar/event-detail-sheet.tsx` + others                                     | 6 sites total      | `.toISOString().slice(0, 10)` (UTC drift)             | ⚠️ Warning  | WR-02 occurrenceDate query param drifts for evening Brussels events.            |
| `src/components/nudge/nudge-banner.tsx`                                                      | 69-76, 87-94       | `daysLeft` off-by-one on boundary day                  | ⚠️ Warning  | WR-10 "Nog 0 dagen" banner appears while writes still accepted.                 |
| `src/components/inbox/mark-inbox-row-read-button.tsx`                                        | 38                 | No debounce, race-able double mutate                   | ⚠️ Warning  | WR-11 redundant network round trips.                                            |
| `src/components/tournament/tournament-create-form.tsx`                                       | 96-97, 120, 124    | datetime-local in browser-local TZ                     | ⚠️ Warning  | WR-12 dev/CI environments produce wrong offsets.                                |
| `src/components/tournament/tournament-result-entry-form.tsx`                                  | 117-119, 144       | Idempotency key not regenerated on input change         | ⚠️ Warning  | WR-13 potential stale-cache replay.                                             |
| 3 form files                                                                                  | various            | Math.random fallback for idempotency key                | ⚠️ Warning  | WR-14 dead-code branch; allows predictable keys if reached.                     |
| `src/components/tournament/tournament-detail/page.tsx`                                       | 83                 | `participants={[]}` hardcoded prop                     | ℹ️ Info     | Hollow prop; tracked alongside CR-03.                                            |
| `src/components/calendar/event-detail-sheet.tsx`                                              | 194, 198           | `event.event as unknown` for needsScoring/needsResult  | ℹ️ Info     | IN-01 always-FALSE — conditional CTAs never fire from the sheet.                |

### Human Verification Required

8 items documented in `04-HUMAN-UAT.md`:

1. Trainer "Te scoren" banner non-dismissible (D-67 ch1) — visual interaction state.
2. Daily 18:00 inbox tick (D-67 ch2 / D-72 ch2) — real cron tick. *Blocked by CR-06 on Supabase.*
3. Yellow ⚠ overlay on past-session chip (D-67 ch3) — visual rendering. *Impacted by WR-09 needsScoring aggregate.*
4. Escalating message tone day 7/10/12 (D-67 ch4) — copy verification. *Blocked by CR-08 markdown markers + WR-10 off-by-one.*
5. recharts inverted Y-axis (D-87/D-88) — chart interpretation. *Impacted by WR-07 hardcoded nl-BE locale.*
6. Belgium timeline tier-color band (D-87) — color mapping per tier.
7. 5-star → DB 2/4/6/8/10 (D-60) — visual interaction + DB write.
8. Multi-day BYDAY picker (D-85) — UI affordance.

Plus multilingual sanity (nl/en/fr) and end-to-end walkthrough — *impacted by WR-05 hardcoded Dutch labels in tournament-detail page*.

### Gaps Summary

Phase 4 ships a substantial domain layer that wires up the correct skeleton — 7 Drizzle migrations, 5 tRPC routers, idempotency middleware, 38 components, full i18n catalog parity at 592 keys, and 24 integration tests that compile and skip cleanly when no live DB is reachable.

**However**, nine concrete BLOCKERs (REVIEW.md CR-01..CR-09) directly contradict declared Phase 4 invariants and roadmap success criteria:

1. **CR-01 / GDPR-04**: Denied-outcome audit rows are rolled back with their failing transaction — forensic visibility on the 14d wall rejections (D-64 + D-71) is NOT delivered. Every wall-expired write attempt vanishes from audit_log, contradicting the explicit T-04-19 threat-mitigation comments in the routers.

2. **CR-02 / VALID-08**: Idempotency middleware ignores input. A client can replay the same idempotency key with mutated input and receive the stale cached response. Both a correctness bug (the second logical write never runs) and a soft security finding (replay surface).

3. **CR-03**: The tournament result entry route silently positions non-player callers to overwrite an arbitrary first-by-enteredAt player's result. A TD intending to correct player B can submit and corrupt player A.

4. **CR-04**: tournament.listPendingForPlayer is missing the role allowlist documented in its docstring. medical_staff, sparring_partner, academy_manager can probe via this procedure.

5. **CR-05**: editRecurring `all_in_series` scope bypasses D-83 past-data immutability. A user can move a recurring series's startsAt into the past, orphaning historical session_participants rows from the conceptual anchor.

6. **CR-06**: system_inbox has FORCE RLS but no INSERT policy. SECURITY DEFINER cron functions will silently fail to deposit nudge rows on Supabase (the platform's stack-recommended DB). D-67 ch2 + D-72 ch2 degrade to no-ops on production-target tier.

7. **CR-07**: system_inbox has no anti-duplicate constraint. Daily cron re-runs stack rows — 14 unread nudges per trainer per pending-score session by the end of the 14d window.

8. **CR-08**: nudge-banner.tsx + rrule-scope-picker-dialog.tsx use `dangerouslySetInnerHTML` to render i18n markdown markers. Users literally see `**2 trainingen**` with asterisks (no bold styling). Any future catalog change introducing real HTML renders unsanitised. Phase 3 conflict-banner.tsx already chose the safer JSX-split pattern; Phase 4 regressed.

9. **CR-09 / DOM-CAT-02**: `getAgeCategoryAt` uses UTC date slicing. Tournaments starting 2026-01-01 02:00 Brussels (= 2025-12-31 23:00 UTC) snapshot the wrong year's age-category row onto tournament_results.player_age_category_code with no auto-correction.

The 14 WARNINGs are quality defects (broken progress-bar, raw UUIDs displayed, hardcoded Dutch labels in routes that bypass i18n, savepoint vs outer-tx audit confusion, UTC-vs-Brussels date inconsistencies in six UI call sites, and several idempotency-key handling concerns) — they don't individually block the phase but compound to a fragile experience.

Several BLOCKERs are root-causally clustered: CR-01 and the rolled-back denied audits is one root cause across 4 call sites. CR-02 and CR-06/07 affect the same end-to-end inbox-notification surface from middleware through cron through table. The recommended approach for the next planning round (`/gsd-plan-phase --gaps`) is to group these by concern:

- **Concern A — Audit & forensics correctness (CR-01)**: 1 helper + 4 call-site refactor.
- **Concern B — Idempotency invariant (CR-02)**: middleware input-hashing + column rename + tests.
- **Concern C — Tournament entry route targeting (CR-03 + CR-04)**: page-level playerId param + listPendingForPlayer gate + parent-child probe.
- **Concern D — Recurring edit past-immutability (CR-05)**: all_in_series guard + i18n key.
- **Concern E — Inbox cron path & dedup (CR-06 + CR-07)**: INSERT policy + REVOKE app_user + unique index + ON CONFLICT.
- **Concern F — i18n XSS sinks + markdown markers (CR-08 + WR-05 + WR-06)**: drop dangerouslySetInnerHTML, t.rich pattern, and translate hardcoded Dutch labels + lookup codes.
- **Concern G — Brussels-anchored dates (CR-09 + WR-02)**: replace UTC slice with formatOccurrenceDate across 7 call sites + add lint rule.

Deferred items (UUID→name JOINs, typedRoutes, pre-existing test failures, HUMAN-UAT staging tests) are tracked elsewhere and not gating Phase 4 closure — but #4 (HUMAN-UAT) cannot run cleanly until CR-06, CR-07, CR-08, WR-09 are fixed (banner copy + chip overlay + cron path are observably broken until then).

**Recommendation:** Status `gaps_found`. Run `/gsd-plan-phase --gaps` against this VERIFICATION.md to plan the close-out cycle. Once the 9 BLOCKERs are resolved and the human UAT cycle completes against staging, the phase can be re-verified.

---

_Verified: 2026-05-19T10:30:00Z_
_Verifier: Claude (gsd-verifier)_
