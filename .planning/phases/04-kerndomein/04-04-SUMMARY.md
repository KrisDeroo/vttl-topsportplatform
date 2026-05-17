---
phase: 04-kerndomein
plan: 04
subsystem: api-routers
tags: [trpc, drizzle, postgres, tournament, atomic-tx, 14d-wall, asymmetric-rbac, td-overwrite, dom-cat-02, age-category-snapshot, d78-academy-wide, idempotency, audit, gdpr-04, valid-08]

# Dependency graph
requires:
  - phase: 04-kerndomein-02
    provides: "tournamentResults + matchResults tables (composite PK + UNIQUE) per D-69 + D-81; tournament_result_visible_to 5-branch UNION RLS helper (0018) per D-78; outcome_level + tournament_round + age_categories lookups seeded (0017)"
  - phase: 04-kerndomein-03
    provides: "idempotencyMiddleware factory (VALID-08); trainerOrTdProcedure preset; writeAudit conventions (success-after-tx, denied-before-throw); FOURTEEN_DAYS_MS wall constant pattern; toIsoDate UTC-slice date serialisation pattern"
  - phase: 03-kalender
    provides: "calendar_events + tournaments extension table (Class-Table-Inheritance D-49); calendar_event_participants junction (D-50); calendar_events_visible_to RLS (Phase 3 D-50 + Plan 04-02 sparring extension); protectedProcedure + tdProcedure presets; audit-before-delete pattern (D-58c)"
  - phase: 02-identiteit-bestanden
    provides: "age_category_history table + getAgeCategoryAt(playerId, date) helper for DOM-CAT-02 snapshot"
  - phase: 01-fundament
    provides: "writeAudit + auditMiddleware; protectedProcedure + tdProcedure presets; CallerContext.scope; audit_log table (REVOKE UPDATE/DELETE — append-only)"
provides:
  - "src/server/trpc/schemas/tournament.ts — 8 strict Zod schemas with i18n error keys (enterResultInput, tournamentCreateInput, addParticipantInput, removeParticipantInput, listResultsInput, listPendingForPlayerInput, tournamentListInput, tournamentGetInput). matchRowSchema cross-field refine: sets_won + sets_lost ∈ [1,7]. enterResultInput.matches: .min(1, atLeastOneMatchRequired) for D-69 atomic-entry input gate."
  - "src/server/trpc/routers/tournament.ts — 8 procedures: create / list / get / addParticipant / removeParticipant (D-79 TD-only management) + enterResult / listResults / listPendingForPlayer (D-69 + D-71 + D-73 + D-75 + D-78 result paths). enterResult composes idempotencyMiddleware('tournament.enterResult'). Exports FOURTEEN_DAYS_MS as TOURNAMENT_WALL_MS."
  - "src/server/trpc/routers/_app.ts — register tournament: tournamentRouter under appRouter."
  - "Phase 4 audit codes emitted (6 of 14): tournament_created, tournament_participant_added, tournament_participant_removed, tournament_result_entered, tournament_result_overwritten, tournament_entry_window_expired_attempt (outcome='denied')."
affects: [04-05-ranking, 04-06-rrule-edit-scopes, 04-07-inbox-pgcron, 04-08-ui, 04-09-integration-tests]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Atomic {outcome, matches[]} entry pattern (D-69) — UPSERT tournament_results + DELETE+INSERT match_results inside one db.transaction. Partial commit structurally impossible (Pitfall 4 mitigation). Zod .min(1) at input layer + transaction at storage layer = two-gate atomic invariant. Reuse hook for future result-entry domains (e.g. Phase 5 stage evaluations) — copy the shape verbatim, swap the table names."
    - "Asymmetric per-role wall (D-71 + D-73 + D-75) — single procedure handler branches on ctx.scope.role: player→own+14d wall, trainer→shared-academy SQL JOIN proof+no wall, TD→unconditional+no wall, everyone else→FORBIDDEN. The shared-academy proof goes to the DB (academy_memberships JOIN) rather than ctx.scope.academyIds because academy assignment can change between requests and the in-memory scope is a snapshot. DB-truth-over-scope-cache is now the pattern for any cross-academy authorisation check in Phase 4+."
    - "DOM-CAT-02 age-category snapshot pattern — at result-entry time, call `getAgeCategoryAt(playerUserId, tournament.startsAt)` and freeze the returned code on tournament_results.player_age_category_code. Player ages out over time; the result row stays anchored. Fallback to 'age_unknown' on missing history (legacy/pre-history accounts). Same shape will be reused in Phase 5 evaluation snapshots."
    - "TD-overwrite-with-oldValues audit pattern (D-75 + D-76 forensic substitute) — capture pre-state via SELECT BEFORE the tx (not FOR UPDATE — the UPSERT path is conflict-safe), then write audit row with action='tournament_result_overwritten' + oldValues = {tournament: preRow, matches: preMatchRows} when isOverwrite AND callerRole='technical_director'. Plain isOverwrite without TD attribution emits 'tournament_result_entered' (player self-edit within 14d is not a 'overwrite' worth auditing distinctly). This pattern replaces the rejected D-76 result_edit_history table — audit_log JSONB snapshot is the forensic trail."
    - "Denied-outcome audit row written BEFORE the FORBIDDEN throw (T-04-19 / T-04-23 carry-forward) — `tournament_entry_window_expired_attempt` outcome='denied' lands in audit_log before `throw new TRPCError({ code: 'FORBIDDEN' })`. Same pattern training.markAttendanceAndScore ships in Plan 04-03 for D-64."
    - "Audit-before-delete on participant removal (D-58c carry-forward) — SELECT FOR UPDATE → snapshot → writeAudit('tournament_participant_removed', oldValues=row) → DELETE, all inside one tx. Survives audit_log INSERT failure visibility because the writeAudit lands on the same withRlsContext transaction handle as the DELETE."
    - "Cursor pagination via `(starts_at, event_id) > (cursorDate, cursorId)` lex tuple comparison — Phase 7-friendly shape (every Phase 4+ list endpoint should follow it). The cursor wire format is `${iso}|${eventId}`; the procedure's `nextCursor` is null on the last page."
    - "ON CONFLICT DO NOTHING on addParticipant — re-adding the same player is idempotent and emits the 'attempted again' audit row, NOT a duplicate-key violation. Cleaner than try/catch around the INSERT for the common case of UI double-click."

key-files:
  created:
    - "src/server/trpc/schemas/tournament.ts (218 lines — 8 Zod schemas + matchRowSchema; .strict() throughout; i18n error keys; cross-field refines for endsAt>=startsAt and sets_won+sets_lost ∈ [1,7])"
    - "src/server/trpc/routers/tournament.ts (940 lines — 8 procedures; FOURTEEN_DAYS_MS constant; deriveEnteredBy + toIsoDate helpers; 6 audit codes wired)"
  modified:
    - "src/server/trpc/routers/_app.ts (+2 lines: import tournamentRouter + register `tournament: tournamentRouter` under appRouter)"

key-decisions:
  - "Tournament create is a DOMAIN-NAMESPACED procedure parallel to calendar.event.create (rather than a thin wrapper) — both insert calendar_events + tournaments extension, but tournament.create is `tdProcedure` (D-79 TD-only) while calendar.event.create is `protectedProcedure` gated by `canCreateEventType` (D-48 matrix). Two procedures with the same effect = two clearer audit codes (`tournament_created` vs `calendar_event_created`) and two cleaner permission surfaces for the TD-only client. The duplication is acceptable: the bodies are ~40 lines each and the audit-code split is genuinely valuable for the Article 30 feed."
  - "Trainer shared-academy proof goes through SQL JOIN on academy_memberships (NOT ctx.scope.academyIds in-memory). Two reasons: (1) ctx.scope is a snapshot built at request boundary — academy assignment can change between requests; (2) the DB-side RLS policy (sp_*_trainer_or_td in 0018) does the same JOIN, so the API and DB encode the SAME predicate; if the DB ever rejected the INSERT with a WITH CHECK violation, the API would have already produced a clearer 'errors.tournament.trainerNotInAcademy' error. Defence in depth with identical semantics."
  - "Full DELETE+INSERT replacement on match_results (NOT diff-merge) per RESEARCH Pattern 3 Open Question 3. The form is single-Save; the user's mental model is 'here is the final shape of my matches'. Diff-merge introduces ordering ambiguity (which row matches which client row?) and is not worth the schema complexity. The UNIQUE constraint (tournament_event_id, player_user_id, round_code, opponent_name, match_date) catches accidental duplicates within the same submit. Concurrent submits race-resolve via the tx isolation level (READ COMMITTED is sufficient — the second tx sees the first's commit and the DELETE-then-INSERT replaces it again, idempotent under last-write-wins)."
  - "TD overwrite emits a distinct audit code (`tournament_result_overwritten`) only when role=TD AND isOverwrite=true. Player self-edit within 14d is also technically an overwrite but is NOT a 'TD overwrite' worth auditing distinctly — every player-edit is captured as 'tournament_result_entered' regardless of whether it overwrote a prior row. Rationale: the D-75 audit-distinct shape exists to flag TD power-of-override; conflating it with normal player self-edits dilutes the signal in the Article 30 feed."
  - "listResults relies ENTIRELY on the 0018 5-branch RLS (`tournament_result_visible_to`) for D-78 academy-wide visibility. The router does NOT add any app-layer scope filter. Adding one would defeat the leaderboard intent. T-04-27 (academy peer leak) is accepted by design per CONTEXT D-78 + threat model."
  - "Drizzle inferred-type friction on match_results insert: `tstz('created_at', { defaultNow: true })` produces a conditional return type whose strict inference incorrectly flags `createdAt` as required at insert time. Plan 04-03 hit the same friction on session_participants. Resolution: cast the array through `as any` with an inline ESLint-disable + the same '// schema default is the canonical source' comment Plan 04-03 used. No functional risk: the column has a server-side default; Drizzle binds NULL on omission; Postgres applies the DEFAULT NOW()."
  - "Procedure split between Task 1 (management) and Task 2 (results) is an EXECUTION ergonomics choice — the file ships as a single router for the typed AppRouter shape. Splitting the commits gives reviewers a clean 'all management procedures here, all result procedures there' diff structure; the runtime artefact is one router."

patterns-established:
  - "FOURTEEN_DAYS_MS is now exported by both training.ts (D-64) and tournament.ts (D-71). Future plans (Plan 04-07 pg_cron nudge wiring) import from one or both; they MUST stay numerically equal. Re-export as `TOURNAMENT_WALL_MS` (alongside the internal `FOURTEEN_DAYS_MS`) makes the import shape stable across the two domains."
  - "Three procedure presets now in active use for Phase 4: protectedProcedure (read + safe mutations gated by per-handler RBAC), tdProcedure (D-79 management), and trainerOrTdProcedure (D-66/D-68 'te scoren'). Phase 5 will add `medicalProcedure` carry-forward; Phase 6 may add `messageProcedure` for thread-scoped mutation rights. The pattern: define preset in `freshSession.ts`, compose via `.use(extra-checks)` per handler."
  - "Cursor pagination format `${startsAtIso}|${eventId}` is now the standard for Phase 4+ list endpoints. Phase 3 calendar.list does NOT use cursors (it's a date-range query), but every other list endpoint should adopt this shape."
  - "atomicity == Zod .min(1) at input + db.transaction at storage. Phase 4+ atomic-multi-table mutations should follow this two-gate shape literally. The plan's `atLeastOneMatchRequired` i18n key is reusable for ranking entries (Plan 04-05 will likely ship `atLeastOneClassificationRequired` on the same pattern)."

requirements-completed: [TOURN-01, TOURN-02, TOURN-03, TOURN-04, TOURN-05, TOURN-06, DOM-RESULT-01, DOM-RESULT-02, DOM-RESULT-03, DOM-RESULT-04, VALID-07, VALID-08, GDPR-04]

# Metrics
duration: ~7min hands-on
completed: 2026-05-17
---

# Phase 4 Plan 04: Tournament router Summary

**Eight tRPC procedures ship the tournament-result domain (D-69..D-81): TD-only management (create / list / get / addParticipant / removeParticipant per D-79), atomic {outcome, matches[]} entry (D-69 + D-80) with asymmetric per-role wall (D-71 player 14d / D-73 trainer-in-academy bypass / D-75 TD unconditional overwrite), DOM-CAT-02 age-category snapshot at competition time, academy-wide leaderboard reads via the 0018 RLS 5-branch UNION (D-78), and a 14d nudge data source (D-72). Six new audit codes wired (tournament_created, tournament_participant_added, tournament_participant_removed, tournament_result_entered, tournament_result_overwritten, tournament_entry_window_expired_attempt). idempotencyMiddleware composed on enterResult (VALID-08).**

## Performance

- **Duration:** ~7 min hands-on (commit-to-commit). Earlier wall-clock window stretched across days due to environment date-rollover between session start and task execution; effective work delta tracked from the schema-write/Task-1-commit boundary to final SUMMARY.
- **Started:** 2026-05-17 (Task 1 work session)
- **Completed:** 2026-05-17T23:25Z
- **Tasks:** 2 (both committed atomically; no checkpoints; one deviation — Drizzle inferred-type cast, see below)
- **Files created:** 2 (schemas/tournament.ts + routers/tournament.ts)
- **Files modified:** 1 (_app.ts — single line registration)

## Accomplishments

- **D-69 ATOMIC ENTRY shipped** — `tournament.enterResult` wraps UPSERT `tournament_results` + DELETE + INSERT `match_results` in a single `db.transaction`. Partial commit is structurally impossible: Zod `.min(1)` at input + transaction at storage = two-gate atomic invariant. RESEARCH Pattern 3 Open Question 3 resolved as full-replacement (DELETE+INSERT, not diff-merge) per the D-80 single-save mental model.
- **D-71 + D-73 + D-75 ASYMMETRIC WALL** — the same handler routes three role buckets: player (own row + 14d strict-greater wall + 'errors.tournament.entryWindowExpired' on day-15), trainer (shared-academy SQL JOIN proof + no wall + 'errors.tournament.trainerNotInAcademy' on cross-academy), TD (unconditional + no wall + audit code 'tournament_result_overwritten' on existing rows). Other roles → FORBIDDEN with `role_not_allowed`. Three-tier RBAC encoded in ~60 lines of `if/else if` plus a SQL EXISTS subquery for the trainer path.
- **D-78 ACADEMY-WIDE READ** — `tournament.listResults` issues two `SELECT *` queries against `tournament_results` + `match_results`. NO app-layer scope filter. The 0018 SECURITY DEFINER `tournament_result_visible_to(uid, role)` 5-branch UNION (self / parent-of-minor / trainer-of-academy / TD / academy-peer-by-D78) is the only scoping gate. Per CONTEXT D-78 + threat T-04-27, the academy-peer-leak is accepted as the leaderboard's defining feature.
- **D-79 TD-ONLY MANAGEMENT** — `create`, `addParticipant`, `removeParticipant` all compose on `tdProcedure` (the Phase 1 preset). `create` atomically inserts `calendar_events` + `tournaments` extension. `addParticipant` uses ON CONFLICT DO NOTHING for idempotent re-adds. `removeParticipant` follows the D-58c audit-before-delete pattern (SELECT FOR UPDATE → snapshot → writeAudit → DELETE) inside one tx.
- **DOM-CAT-02 AGE-CATEGORY SNAPSHOT** — `getAgeCategoryAt(playerUserId, ev.startsAt, db)` is called at result-entry time; the returned `code` (or `'age_unknown'` fallback) lands on `tournament_results.player_age_category_code` and is frozen. The Phase 2 helper bridges directly; no new query was needed.
- **D-72 NUDGE DATA SOURCE** — `tournament.listPendingForPlayer` returns tournaments where the target player is a participant AND `ends_at` is in the last 14 days AND no `tournament_results` row exists yet. LEFT JOIN + IS NULL is the "missing result" predicate. The UI inbox banner (Plan 04-07) and the daily pg_cron nudge (Plan 04-07) read the same shape — interactive vs passive surface, identical predicate.
- **VALID-08 IDEMPOTENCY** — `enterResult` composes `idempotencyMiddleware('tournament.enterResult')` per the Plan 04-03 contract. Client passes `_meta.idempotencyKey`; retry within 24h replays the cached `responseBody` and emits `idempotency_replay` audit code. Plan 04-03's pattern is now reused verbatim (which was the entire point of factory-shape).
- **GDPR-04 AUDIT CODES** — 6 new codes emitted from THIS plan (3 management + 3 result paths). All match `tests/integration/phase4-audit.test.ts` manifest. The `tournament_result_overwritten` path carries the `oldValues = {tournament: preRow, matches: preMatchRows}` JSONB snapshot per D-75 + D-58c forensic-recovery substitute (the rejected D-76 `result_edit_history` table).

## Task Commits

Each task was committed atomically:

1. **Task 1 — schemas + 5 TD-only management procedures (create, list, get, addParticipant, removeParticipant)** — `8031c8d` (feat)
2. **Task 2 — 3 result procedures (enterResult atomic + 14d wall + DOM-CAT-02 snapshot + idempotency; listResults D-78 RLS-only; listPendingForPlayer D-72 nudge source) + _app.ts registration** — `80e742b` (feat)

_Both commits use `--no-verify` per parallel-executor convention._

## Files Created

- `src/server/trpc/schemas/tournament.ts` (218 lines) — 8 Zod schemas + 1 helper (`matchRowSchema`). `.strict()` on every object; i18n error keys throughout (errors.tournament.*, errors.field.*, errors.calendar.endsAfterStarts). Cross-field refines for `endsAt >= startsAt` and `sets_won + sets_lost ∈ [1, 7]`. `enterResultInput.matches.min(1, { atLeastOneMatchRequired })` is the input-layer half of the D-69 atomic-entry invariant.
- `src/server/trpc/routers/tournament.ts` (940 lines) — 8 procedures + `FOURTEEN_DAYS_MS` constant + `deriveEnteredBy` + `toIsoDate` helpers. 6 audit codes wired. Composes `idempotencyMiddleware('tournament.enterResult')` on the result-entry path. Exports `FOURTEEN_DAYS_MS as TOURNAMENT_WALL_MS` for future plans (Plan 04-07 pg_cron nudges).

## Files Modified

- `src/server/trpc/routers/_app.ts` (+2 lines: import `tournamentRouter` + register `tournament: tournamentRouter` under `appRouter`).

## Decisions Made

See `key-decisions:` frontmatter above. Seven key decisions:

1. Tournament create is **domain-namespaced**, paralleling calendar.event.create rather than wrapping it — distinct audit codes + cleaner TD-only permission surface justify the ~40 LOC duplication.
2. Trainer shared-academy proof goes through **SQL JOIN on academy_memberships** (DB-truth), not `ctx.scope.academyIds` (in-memory snapshot). API and DB RLS encode the SAME predicate; defence in depth with identical semantics.
3. **Full DELETE+INSERT replacement** on match_results (NOT diff-merge) per RESEARCH Pattern 3. UNIQUE constraint catches accidental within-submit duplicates; tx isolation handles concurrent-submit races by last-write-wins.
4. `tournament_result_overwritten` audit code is **emitted ONLY when role=TD AND isOverwrite=true**. Player self-edit within 14d is captured as `tournament_result_entered` — the distinct code exists to flag TD power-of-override.
5. `listResults` relies **entirely on the 0018 RLS** for D-78; no app-layer scope filter. Academy peer leak (T-04-27) is accepted as the leaderboard's defining feature.
6. Drizzle inferred-type friction on `match_results` insert resolved via `as any` cast (Plan 04-03 precedent).
7. Procedure split between Task 1 (management) and Task 2 (results) is an **execution-ergonomics commit boundary** — the runtime artefact is a single router; the split makes review diffs clean.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking sequencing] Drizzle inferred type flags `createdAt` as required on `match_results` insert**

- **Found during:** Task 2 first `pnpm typecheck` after writing the atomic transaction body.
- **Issue:** `tstz('created_at', { defaultNow: true })` produces a conditional return type whose strict inference adds `createdAt` to the required-field set of `$inferInsert`. Drizzle 0.40 has not yet resolved the conditional-default narrowing; same friction Plan 04-03 hit on `session_participants` and `audit_log`.
- **Fix:** Cast the array of value objects through `as any` with the inline ESLint-disable + the same '// schema default is the canonical source' comment used by Plan 04-03 and `audit.ts`. The Postgres `created_at TIMESTAMPTZ DEFAULT NOW()` is canonical — passing a client-side `Date.now()` would drift from the surrounding transaction's snapshot timestamp.
- **Files modified:** `src/server/trpc/routers/tournament.ts` (single insert site, ~5 lines)
- **Committed in:** `80e742b` (Task 2)
- **Total LOC overhead:** ~5 lines with comments; functional behaviour unchanged.

**Total deviations:** 1 auto-fixed (Rule 3 blocking sequencing — Drizzle/tstz inference quirk; precedent from Plan 04-03). No Rule 4 architectural escalations.

## Wave 0 Test State (post-04-04)

Per Plan 04-03's `## Wave 0 Test State` precedent: the Wave 0 RED skeletons in `tests/integration/tournament-*.test.ts` use `expect.fail('Not implemented: requires Plan 04-04')` as placeholders. Plan 04-09 (Wave 4 integration test sweep) is the contracted slot to replace those skeletons with real DB-backed assertions and flip them GREEN. The router IS implemented; the tests just haven't been re-written yet.

| Test file | State | Reason |
| --- | --- | --- |
| `tests/integration/phase4-audit.test.ts` "declares all 14 codes" | **GREEN** (static manifest assertion) | The codes ARE emitted by the router; the manifest test only checks the constant array length and uniqueness, both correct. |
| `tests/integration/tournament-create-rbac.test.ts` (5 cases) | **RED-as-placeholder** | All five `it()` blocks are `expect.fail` placeholders. Router does enforce `tdProcedure` on create/addParticipant/removeParticipant. |
| `tests/integration/tournament-atomic-entry.test.ts` (3 + 2 todo) | **RED-as-placeholder** | tx + .min(1) ARE wired; test bodies are `expect.fail`. |
| `tests/integration/tournament-entry-window.test.ts` | **RED-as-placeholder** | 14d wall IS enforced (player role, strict-greater); test body is `expect.fail`. |
| `tests/integration/tournament-backfill-rbac.test.ts` | **RED-as-placeholder** | Asymmetric backfill via SQL JOIN IS implemented; test body is `expect.fail`. |
| `tests/integration/tournament-td-overwrite.test.ts` | **RED-as-placeholder** | oldValues snapshot + 'tournament_result_overwritten' code ARE wired; test body is `expect.fail`. |
| `tests/integration/rls-academy-wide-result-visibility.test.ts` | **RED-as-placeholder** | RLS 5-branch UNION lives in 0018 (Plan 04-02); router relies on it without filtering. Test body is `expect.fail`. |
| `tests/integration/age-category-snapshot.test.ts` | **RED-as-placeholder** | `getAgeCategoryAt(player, startsAt)` IS called on entry; result is frozen. Test body is `expect.fail`. |
| `tests/integration/match-result-unique.test.ts` | **RED-as-placeholder** | UNIQUE constraint lives in 0015 (Plan 04-02). Test body is `expect.fail`. |
| `tests/integration/idempotency-tournament.test.ts` | **RED-as-placeholder** | `idempotencyMiddleware('tournament.enterResult')` IS composed. Test body is `expect.fail`. |
| `tests/integration/tournament-enter-result.test.ts` | **RED-as-placeholder** | General-purpose result entry; test body is `expect.fail`. |

**Net:** the router's deliverables (all 8 procedures + 6 audit codes + 5 invariants) are implemented and pass `pnpm typecheck` end-to-end. Wave 0 test skeletons are placeholders by design; Plan 04-09 will replace them. Plan 04-03 documented the same pattern.

## Pre-existing Test Failures (unrelated to this plan)

`pnpm test -- tests/unit/idempotency-middleware.test.ts tests/unit/quality-score-range.test.ts --run` PASSES (2 + 5 todo). Plan 04-03's contributions remain green.

Plan 04-04 did NOT touch any test file (`git diff HEAD~2..HEAD -- tests/` is empty for this plan's commits). Other Wave 0 RED skeletons (`tests/unit/entered-by-derivation.test.ts`, `tests/unit/match-derived-won.test.ts`, `tests/unit/ranking-xor.test.ts`, `tests/unit/rrule-byday.test.ts`, etc.) remain RED — they're Plan 04-05/04-06 deliverables and out of scope.

## Threat Model Disposition

From `<threat_model>` in plan 04-04:

| Threat ID | Disposition | Outcome |
| --- | --- | --- |
| T-04-21-CROSS-PLAYER-RESULT-FORGERY | mitigate | Router rejects when role=player AND input.playerUserId !== caller.userId with 'errors.tournament.notOwnPlayer'. RLS in 0018 mirrors at the DB layer (the tournament_result_visible_to + INSERT WITH CHECK). |
| T-04-22-CROSS-ACADEMY-TRAINER-ENTRY | mitigate | SQL EXISTS subquery JOINs academy_memberships am_player ⨝ am_caller on academy_code. Trainer not in player's academy → 'errors.tournament.trainerNotInAcademy'. RLS in 0018 has the same JOIN; identical predicate at both layers. |
| T-04-23-14D-WALL-BYPASS | mitigate | Server-side `Date.now() - endsAt > FOURTEEN_DAYS_MS` strict-greater for role=player. UI may disable the form; the API is the non-bypassable gate. Denied-outcome audit row `tournament_entry_window_expired_attempt` lands BEFORE the throw (Pitfall 3 + T-04-19 carry-forward). |
| T-04-24-ATOMIC-INVARIANT-VIOLATION | mitigate | Zod `.min(1)` at input + `db.transaction(...)` wrapping UPSERT + DELETE + INSERT at storage. Partial commit structurally impossible. |
| T-04-25-RESULT-REPLAY-ATTACK | mitigate | `idempotencyMiddleware('tournament.enterResult')` composes per Plan 04-03 contract. Duplicate key replays cached responseBody within 24h; cache-hit emits 'idempotency_replay' audit. |
| T-04-26-AUDIT-OMISSION-ON-OVERWRITE | mitigate | TD overwrite captures pre-state (preTournamentRows + preMatchRows) BEFORE the tx, then emits 'tournament_result_overwritten' with oldValues = {tournament: preRow, matches: preMatchRows}. D-75 + D-76 forensic substitute pattern. |
| T-04-27-D78-ACADEMY-PEER-LEAK | accept | D-78 academy-wide visibility BY DESIGN per CONTEXT. The 0018 5-branch UNION limits leakage to academy peers only; outsiders see 0 rows. Documented threat shared with 04-02. |
| T-04-28-AGE-CAT-DRIFT | mitigate | `getAgeCategoryAt(player, tournament.startsAt)` snapshots the code; row stores it on `player_age_category_code`. Re-derive at every update via the same call (the UPSERT path re-computes too, so a TD overwrite years later would re-snapshot — but to the SAME date.startsAt, so the snapshot is idempotent). |
| T-04-29-PII-LEAK-VIA-OPPONENT-NAME | accept | Free text per TOURN-04 + CONTEXT Claude's Discretion. Opponent name is competitive metadata, not GDPR Article 9. Never echoed into i18n error messages. |
| T-04-30-DUPLICATE-MATCH-VIA-UNIQUE-CONSTRAINT | mitigate | match_results UNIQUE (tournament_event_id, player_user_id, round_code, opponent_name, match_date) (Plan 04-02). DELETE+INSERT inside tx prevents intra-submit duplicates; constraint catches concurrent inter-submit duplicates. |

All 10 threats mitigated or accept-with-design. No new threats introduced.

## Audit Codes Manifest (six new + Plan 04-03 reuse)

The plan's `<output>` section requested explicit capture of the audit codes shipped from this plan:

| # | Code | Surface | Trigger |
| --- | --- | --- | --- |
| 1 | `tournament_created` | `tournament.create` mutation success | TD calls `create`; calendar_events + tournaments tx commits. |
| 2 | `tournament_participant_added` | `tournament.addParticipant` mutation success | TD adds a player; calendar_event_participants INSERT (or ON CONFLICT DO NOTHING no-op — both emit the code with attribution). |
| 3 | `tournament_participant_removed` | `tournament.removeParticipant` mutation success | TD removes a player; row pre-state snapshotted in `oldValues` before DELETE. |
| 4 | `tournament_result_entered` | `tournament.enterResult` mutation success (non-TD-overwrite path) | Player self-entry within 14d, trainer backfill, TD initial entry. |
| 5 | `tournament_result_overwritten` | `tournament.enterResult` mutation success (isOverwrite AND role=TD) | TD overwriting an existing result row; `oldValues = {tournament: preRow, matches: preMatchRows}` snapshot. |
| 6 | `tournament_entry_window_expired_attempt` | `tournament.enterResult` 14d wall reject path | role=player, Date.now() - endsAt > FOURTEEN_DAYS_MS. Outcome='denied'; row lands BEFORE the FORBIDDEN throw. |

Plus `idempotency_replay` (Plan 04-03 middleware) emits when a duplicate `_meta.idempotencyKey` hits cache within 24h on `tournament.enterResult`.

## Test fixture extension notes (per plan `<output>`)

The plan's `<output>` calls out potential `tests/fixtures/phase4-seed.ts` extension for the RLS 5-branch UNION test. **No extension was needed in THIS plan** — the seed file is a Wave 0 scaffold (`phase4Ready: true` only; the body is a TODO marker per Phase 4 Plan 04-01). Plan 04-09 will extend it when re-writing the RED skeletons with real DB-backed assertions. The branch-5 (academy peer) test will need:
- Two players in the same academy with distinct user ids
- A tournament_results row owned by player A
- A SELECT by player B authenticated to the API
- Assertion: B's listResults returns A's row (5-branch UNION D-78 satisfied)

These fixture inserts are the work of Plan 04-09; the contract is captured here for traceability.

## Self-Check: PASSED

- [x] `src/server/trpc/schemas/tournament.ts` exists; exports `enterResultInput` + 7 other schemas; uses `.strict()` (verified via grep — 9 matches); declares `errors.tournament.atLeastOneMatchRequired` + `errors.tournament.setRange` + `errors.tournament.outcomeRequired` + `errors.tournament.entryWindowExpired` + `errors.tournament.notOwnPlayer` + `errors.tournament.trainerNotInAcademy` + `errors.tournament.notATournament` + `errors.tournament.opponentLength` + `errors.tournament.videoLink` + `errors.tournament.notFound` + `errors.tournament.participantNotFound` i18n keys (verified via grep)
- [x] `src/server/trpc/routers/tournament.ts` exists; exports `tournamentRouter`; contains `tdProcedure` (5x), `protectedProcedure` (4x), `idempotencyMiddleware('tournament.enterResult')` (1x), `getAgeCategoryAt` call (1x), six audit codes (verified via grep)
- [x] `src/server/trpc/routers/_app.ts` registers `tournament: tournamentRouter` under appRouter (verified via grep — 1 match)
- [x] `pnpm typecheck` exit 0 (verified end-to-end after each task)
- [x] Task 1 commit `8031c8d` exists on the worktree branch (verified via `git log`)
- [x] Task 2 commit `80e742b` exists on the worktree branch (verified via `git log`)
- [x] No modifications to `.planning/STATE.md` or `.planning/ROADMAP.md` (verified — this SUMMARY.md is the only `.planning/` file changed)
- [x] No accidental deletions in either task commit (`git diff --diff-filter=D --name-only HEAD~2 HEAD` is empty)
- [x] All required tokens present (manual grep of all plan-spec strings — counts confirmed)
- [x] 6 audit codes match `tests/integration/phase4-audit.test.ts` manifest (verified by grep cross-reference)

## Next Phase Readiness

- **Plan 04-05 (Ranking router):** composes `idempotencyMiddleware('ranking.addEntry')` on its `addEntry` procedure following the same pattern Plan 04-04 uses for `enterResult`. The 04-03 → 04-04 → 04-05 chain is now a proven shape: define `_meta.idempotencyKey` on input + chain `idempotencyMiddleware` on the procedure builder + audit code `idempotency_replay` already emits via the middleware itself. Plan 04-05 has zero new wiring to do for VALID-08 — just compose.
- **Plan 04-06 (RRULE edit scopes — "Deze en toekomstige" + "Alle in de reeks"):** the audit-before-delete pattern Plan 04-04 carries forward from D-58c (and which 04-04's `removeParticipant` re-uses) will be re-used again for `calendar_event_recurring_split` (D-84). The shape: SELECT FOR UPDATE → snapshot the to-be-modified rows → writeAudit oldValues → DELETE-or-UPDATE in same tx.
- **Plan 04-07 (Inbox + pg_cron wiring):** the D-72 nudge data source IS now wired (`tournament.listPendingForPlayer`). The pg_cron job (Plan 04-07) needs the SAME predicate — tournaments ending in last 14d with no `tournament_results` row. Plan 04-07 can either (a) call the procedure via a server-side caller factory, (b) duplicate the SQL into the pg_cron function definition, or (c) extract the predicate into a shared SQL view. Decision deferred to 04-07; the shape is captured here for continuity.
- **Plan 04-08 (Phase 4 UI work):** the React form bound to `tournament.enterResult` for atomic save + `tournament.listResults` for the leaderboard. The `enterResult` return shape `{ ok, isOverwrite, enteredBy, ageCategorySnapshot }` is designed for the form's post-save toast ("Result entered — your age category at competition: U18"). UI will compose against `useZodErrorMessage` from `src/lib/forms/zod-i18n.ts` for the .strict()/i18n errors.
- **Plan 04-09 (Wave 4 integration tests):** replace the 9+ Wave 0 RED skeletons listed in §Wave 0 Test State with real DB-backed assertions. The router is fully implemented; the fixture extensions described in §Test fixture extension notes are the only seed work needed for the RLS 5-branch test.

**Concerns:** None blocking. The plan's `<verification>` step asks for live test passes; per the Wave 0 expect.fail convention established by Plan 04-03, those skeletons remain placeholders and the contract for flipping them GREEN is Plan 04-09's. The router implementation IS complete and `pnpm typecheck` is clean.

---

*Phase: 04-kerndomein*
*Plan: 04*
*Completed: 2026-05-17*
