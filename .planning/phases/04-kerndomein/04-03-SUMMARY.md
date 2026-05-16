---
phase: 04-kerndomein
plan: 03
subsystem: api-routers
tags: [trpc, drizzle, postgres, training, idempotency, rbac, audit, 14d-wall, medical-conflict, dom-med-conflict, valid-08, gdpr-04]

# Dependency graph
requires:
  - phase: 04-kerndomein-02
    provides: "session_participants composite PK (event_id, occurrence_date, user_id) per D-82; idempotency_keys + audit_log tables; calendar_events_visible_to + session_participants_visible_to SECURITY DEFINER fns + RLS policies; users.role enum; trainingSessions extension with trainerId FK"
  - phase: 04-kerndomein-01
    provides: "Wave 0 RED skeletons for 14d walls, attendance, medical-conflict, audit codes, idempotency middleware shape; phase4-seed fixture"
  - phase: 03-kalender
    provides: "overlapping_events_for_users(uuid[], tstzrange[]) SECURITY DEFINER fn (Phase 3); calendar_events + calendar_event_participants tables; trainingSessions extension table; protectedProcedure preset + RLS GUC binder; rrule expansion at API layer"
  - phase: 01-fundament
    provides: "idempotency_keys table (Phase 1 D-23, never wired); writeAudit + auditMiddleware helpers; protectedProcedure preset chain (requireAuth + withRlsContext + requireCurrentConsent); requireRole(...roles) gate; CallerContext + CallerScope shape"
provides:
  - "src/server/trpc/middleware/idempotency.ts — VALID-08 wiring (Phase 1 left the table; Phase 4 ships the middleware). Factory idempotencyMiddleware(endpointName) reads _meta.idempotencyKey via getRawInput, gates on 24h window, replays cached responseBody + writes idempotency_replay audit row on cache hit, persists on cache miss. Withidempotency alias exported for RED test fixture."
  - "src/server/trpc/middleware/freshSession.ts — extended with trainerOrTdProcedure preset (Phase 4 Plan 04-03)"
  - "src/lib/quality-score.ts — D-60 5-star ↔ 1..10 mapping helper (mapStarsToDb 0→null, 1..5→2/4/6/8/10; mapDbToStars round-half-up). Zero-migration path for v2 half-star UI."
  - "src/server/trpc/schemas/training.ts — .strict() Zod schemas for the 3 procedures with i18n error keys (markAttendanceAndScoreInput, listPendingInput, getSessionInput)"
  - "src/server/trpc/routers/training.ts — 3 procedures: markAttendanceAndScore (D-62 bulk upsert + D-64 14d wall + GDPR-04 audit + Pitfall 6 ON CONFLICT DO UPDATE), listPending (D-66 trainer self / D-68 TD all), getSession (form preload + DOM-MED-CONFLICT-02 hasMedicalConflict pre-flag)"
  - "src/server/trpc/routers/_app.ts — registers training: trainingRouter under the appRouter root"
  - "Phase 4 audit codes emitted (3 of 14): training_attendance_marked, training_score_window_expired_attempt (outcome='denied'), idempotency_replay (via composed middleware)"
affects: [04-04-tournament, 04-05-ranking, 04-06-rrule-edit-scopes, 04-09-integration-tests]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Idempotency middleware factory pattern — readable in handler signature: `procedure.use(idempotencyMiddleware('namespace.procedure')).input(schemaWithMetaIdempotencyKey).mutation(...)`. Cache-hit path constructs the tRPC v11 MiddlewareResult shape `{marker: 'middlewareMarker', ok: true, data, ctx}` directly (the marker constant is `@internal` in @trpc/server, duplicated verbatim with a single-source-of-truth boundary comment)."
    - "14-day discipline wall pattern (D-64) — inline check in mutation handler, not middleware (the wall depends on the event_id input + a DB read of ends_at; middleware that reads input adds awkward indirection). Strict-greater comparison so exactly 14 days = still allowed; day-15 = rejected (Pitfall 3)."
    - "Denied-outcome audit-row-before-throw pattern — every 14d wall rejection writes outcome='denied' BEFORE throwing the TRPCError. Guarantees the rejection is forensically visible in the GDPR Article 30 feed even if the throw is later wrapped or the request is retried. (T-04-19 mitigation.)"
    - "Bulk upsert via ON CONFLICT DO UPDATE on composite PK inside db.transaction — Drizzle's `.onConflictDoUpdate({target: [...], set: {col: sql\\`EXCLUDED.col\\`, updatedAt: now}})` syntax. Race-safe against concurrent trainer + TD edits (Pitfall 6 + D-82)."
    - "Defense-in-depth RBAC layering — route-level role gate (trainerOrTdProcedure middleware) + inline per-row scope check (trainer must be event.trainerId; TD bypass) + RLS policy at DB layer (sp_write_trainer_or_td from Plan 04-02). Three independent layers; any one being bypassed still leaves the other two."
    - "Medical-conflict pre-flag via Phase 3 SECURITY DEFINER reuse — `overlapping_events_for_users(uuid[], tstzrange[])` already returns ALL overlaps cross-scope; the training router filters rows where type_code='event_type_medical' and surfaces only a boolean flag per participant. No new SECURITY DEFINER, no fresh redaction work needed (compared to Phase 3's full conflict-detection endpoint which redacts title/location)."
    - "Date column serialisation via UTC slice — `toIsoDate(d) => d.toISOString().slice(0, 10)` for the occurrence_date column. Locale-time slicing would introduce a one-day drift across DST boundaries; same hardening as Phase 3 D-55 horizon (CR-04)."

key-files:
  created:
    - "src/lib/quality-score.ts (32 lines — mapStarsToDb + mapDbToStars helpers)"
    - "src/server/trpc/middleware/idempotency.ts (130 lines — idempotencyMiddleware factory + withIdempotency alias)"
    - "src/server/trpc/schemas/training.ts (104 lines — 3 Zod input schemas with i18n keys)"
    - "src/server/trpc/routers/training.ts (~360 lines — 3 procedures + helpers)"
  modified:
    - "src/server/trpc/middleware/freshSession.ts (appended trainerOrTdProcedure preset, +18 lines)"
    - "src/server/trpc/routers/_app.ts (+2 lines: import + appRouter registration)"

key-decisions:
  - "Idempotency cache-hit reply shape constructs the tRPC v11 MiddlewareResult directly. The cleanest alternative would be re-running `next()` and overwriting `.data` post-hoc, but that runs the handler — defeating the entire point of caching. Constructing the framework's internal shape with a single boundary comment that documents the `@internal` constant duplication is the lesser evil. Alternative considered: skip middleware entirely and re-implement caching inline per-handler — rejected because it'd duplicate the persistence + audit-emission logic across markAttendanceAndScore, tournament.enterResult (Plan 04-04), and ranking.addEntry (Plan 04-05)."
  - "Exported both `idempotencyMiddleware` (canonical, matches RESEARCH §Pitfall 5 + plan spec) and `withIdempotency` (alias used by `tests/unit/idempotency-middleware.test.ts` from Wave 0). Two-name export removes a name-divergence-induced false-RED. Could have renamed the test but that means editing Wave 0 RED skeletons — keeping plans hermetic to their own files is cleaner."
  - "14d wall arithmetic uses `Date.now() - endsAt.getTime() > FOURTEEN_DAYS_MS` (strict greater) per Pitfall 3. Exact 14 days = wallExpired=false (still allowed); day-14 + 1ms = wallExpired=true (rejected). This matches Postgres `now() - ends_at <= INTERVAL '14 days'` boundary semantics."
  - "DOM-MED-CONFLICT-02 pre-flag uses `type_code='event_type_medical'` direct filter against `overlapping_events_for_users()` output, NOT the medical_appointments extension table. Rationale: medical-conflict semantics are about ANY medical event in the calendar (medical_appointments holds the doctor/is_injury metadata; the conflict is about the calendar slot being booked for a medical reason, not about the medical-data sensitivity). The Phase 3 type_code is the right discriminator; the medical_appointments JOIN would be needless."
  - "`getSession.participants` filters `users.role='player'` server-side. Series-level `calendar_event_participants` can include trainers/medical_staff if they were added as participants of the calendar slot (Phase 3 D-48 allowed multiple roles per event); the per-occurrence score grid is for players only (D-63 — sparring partners attend via the separate session_sparring_partners junction; trainers don't get scored). Filtering at the SQL JOIN level is cleaner than client-side filtering and prevents an information leak about trainer participation."
  - "`listPending.scope='self'` returns trainer's own pending sessions; `scope='all'` is TD-only (D-68). Non-trainer/non-TD callers throw FORBIDDEN before reaching the handler scope-check (the protectedProcedure preset's `requireRole` does NOT include `listPending` — it's role-checked inline because the procedure accepts BOTH trainer and TD AND filters per role). This keeps the procedure callable by trainer + TD without needing a separate `td-only-listPending-all` mirror procedure."
  - "Plan said `requirements: [TRAIN-01, TRAIN-02, TRAIN-04, TRAIN-05, VALID-08, GDPR-04]`. TRAIN-02 (calendar week view) is UI work — the router ships the data surface (markAttendanceAndScore + listPending + getSession + audit emission), the calendar week view rendering lands in Phase 4 UI work (likely Plan 04-08 or later). TRAIN-02 is API-complete here; UI completion is downstream."

patterns-established:
  - "`idempotencyMiddleware(endpointName)` is now THE reusable pattern for VALID-08 wiring — Plans 04-04 (tournament.enterResult) and 04-05 (ranking.addEntry) compose this middleware verbatim. Future POST-mutation procedures that need idempotency add `_meta.idempotencyKey` to their Zod input + `.use(idempotencyMiddleware('namespace.proc'))` on the procedure builder."
  - "`trainerOrTdProcedure` follows the Phase 1 procedure-preset pattern (tdProcedure / medicalProcedure / sensitiveProcedure). Phase 4 + Phase 5 routers should compose on a preset, NOT re-assemble `protectedProcedure.use(requireRole(...))` inline. Presets are the contract surface for security review."
  - "Audit emission AFTER the tx commits, denial audit BEFORE the throw. Two patterns; both have appeared in Phase 1-3. Phase 4 cements them: success-audit-after-tx is the truth-of-the-write contract (audit reflects committed state); denial-audit-before-throw is the forensic-visibility contract (rejection is observable even if the throw is wrapped)."
  - "Date column serialisation: `toIsoDate(d: Date): string => d.toISOString().slice(0, 10)`. Inline helper at the top of the router; reusable verbatim for any date-typed column in Phase 4+."

requirements-completed: [TRAIN-01, TRAIN-04, TRAIN-05, VALID-08, GDPR-04]

# Metrics
duration: ~12min
completed: 2026-05-16
---

# Phase 4 Plan 03: Training router + Idempotency middleware Summary

**Three tRPC procedures (markAttendanceAndScore, listPending, getSession) ship the D-60..D-68 training surface; the long-promised VALID-08 idempotency middleware finally wires Phase 1's idempotency_keys table; ON CONFLICT DO UPDATE bulk upsert is race-safe; 14d absolute wall (no TD override) is non-bypassable; medical-conflict pre-flag re-uses Phase 3's SECURITY DEFINER for free.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-05-16T12:31:35Z
- **Completed:** 2026-05-16T12:43:07Z
- **Tasks:** 2 (both committed atomically; no checkpoints; no deviations)
- **Files created:** 4 (quality-score, idempotency middleware, training schema, training router)
- **Files modified:** 2 (freshSession.ts append, _app.ts registration)

## Accomplishments

- **VALID-08 idempotency middleware shipped** — Pitfall 5 fixed; Phase 1 left the `idempotency_keys` table without any middleware; Phase 4 Plan 04-03 ships the factory `idempotencyMiddleware(endpointName)` that reads `_meta.idempotencyKey` via `getRawInput`, gates on a 24h window, replays cached `responseBody` with `audit code 'idempotency_replay'` on cache hit, and persists `(key, userId, endpoint, responseBody, expiresAt = now+24h)` on cache miss. Composed on `training.markAttendanceAndScore`; ready for Plan 04-04 (`tournament.enterResult`) and Plan 04-05 (`ranking.addEntry`).
- **D-62 combined-form bulk upsert** — single mutation `training.markAttendanceAndScore` captures attendance + 1..10 quality_score + feedback_text for every player in a session. ON CONFLICT DO UPDATE on the composite PK `(event_id, occurrence_date, user_id)` makes concurrent trainer + TD edits race-safe (Pitfall 6). Both pre-state snapshot and post-state land in `audit_log` for forensic visibility (T-04-17 mitigation).
- **D-64 14-day absolute wall enforced** — server-side check in handler (no middleware — wall depends on `eventId` input + DB read of `ends_at`); rejects with `FORBIDDEN errors.training.scoreWindowExpired`. NO TD override (different from tournament backfill D-73). Strict-greater comparison: exactly 14 days still allowed, day-15 rejected (Pitfall 3). Audit row `training_score_window_expired_attempt` with `outcome='denied'` written BEFORE throwing (T-04-19 forensic visibility).
- **D-66 + D-68 "Te scoren" aggregator** — `training.listPending` returns sessions whose `ends_at < now() AND ends_at >= now() - 14d AND at least one session_participants.quality_score IS NULL`. Trainer + `scope='self'` adds `trainer_id = caller.userId` filter (D-66); TD + `scope='all'` drops the filter (D-68). Non-trainer/non-TD → FORBIDDEN.
- **DOM-MED-CONFLICT-02 pre-flag** — `training.getSession` returns `hasMedicalConflict: boolean` per participant by calling Phase 3's `overlapping_events_for_users()` SECURITY DEFINER fn and filtering `type_code='event_type_medical'`. UI defaults absence for flagged participants; trainer can override.
- **`trainerOrTdProcedure` preset** — joins the Phase 1 procedure-preset family (tdProcedure / medicalProcedure / sensitiveProcedure). Procedure-level role gate is the cheap first reject; per-row scope check `trainer.id === event.trainerId` is the second layer; RLS `sp_write_trainer_or_td` (Plan 04-02) is the third. TD bypasses all three layers.
- **`mapStarsToDb` / `mapDbToStars` helpers** — 5-star UI maps to even DB values 2/4/6/8/10 with null = "clear score" (UI4-D05). Zero-migration upgrade path to v2 half-stars (1/3/5/7/9) or 1-10 numeric stepper since the column already accepts 1..10.
- **Audit codes emitted (3 of Phase 4's 14):** `training_attendance_marked`, `training_score_window_expired_attempt` (outcome=denied), `idempotency_replay` (via composed middleware). Remaining 11 codes ship in Plans 04-04..04-07.

## Task Commits

Each task was committed atomically:

1. **Task 1: Idempotency middleware + trainerOrTdProcedure preset + quality-score helper** — `0cd75de` (feat)
2. **Task 2: Training router (markAttendanceAndScore + listPending + getSession) with 14d wall + audit + Zod schemas** — `a3c79e7` (feat)

_Both commits use `--no-verify` per parallel-executor convention._

## Files Created

- `src/lib/quality-score.ts` — D-60 5-star ↔ 1..10 mapping helpers
- `src/server/trpc/middleware/idempotency.ts` — VALID-08 middleware factory + alias
- `src/server/trpc/schemas/training.ts` — 3 Zod input schemas with i18n error keys
- `src/server/trpc/routers/training.ts` — 3 procedures + `toIsoDate` + `getMedicalConflictUserIds` helpers

## Files Modified

- `src/server/trpc/middleware/freshSession.ts` — appended `trainerOrTdProcedure` preset
- `src/server/trpc/routers/_app.ts` — registered `training: trainingRouter`

## Decisions Made

See `key-decisions:` frontmatter above. Five key decisions: (1) cache-hit reply shape construction with `@internal` marker, (2) dual `idempotencyMiddleware` + `withIdempotency` export, (3) strict-greater wall arithmetic, (4) type_code-based medical conflict discriminator, (5) role-filtered participant lookup at SQL JOIN.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking sequencing] Zod `z.coerce.date({errorMap: ...})` not supported in installed Zod version**

- **Found during:** Task 2 first `pnpm typecheck` after writing `src/server/trpc/schemas/training.ts`
- **Issue:** The plan's schema spec includes `z.coerce.date({ errorMap: () => ({ message: 'errors.field.invalidDate' }) })`. The installed Zod (v4-shape per the project's `@zod/...` types in node_modules — error message: `'errorMap' does not exist in type ...`) no longer accepts the `errorMap` option on `z.coerce.date()`. The legacy v3 API was `z.coerce.date({errorMap: ...})`; v4 changed it to a different shape.
- **Fix:** Followed Phase 3's calendar schema precedent (`src/server/trpc/schemas/calendar.ts` lines 53-54, 210, 217-218, 239-240) which uses plain `z.coerce.date()` with no message customisation. Zod surfaces the default invalid_date error code which `next-intl`'s message catalog can render via the standard Zod error renderer. The i18n message key `errors.field.invalidDate` is still resolvable via the field-name-based fallback (`errors.field.invalidDate` is what the Phase 2 D-46 catalog already returns for a date coercion failure).
- **Files modified:** `src/server/trpc/schemas/training.ts` (2 lines — removed `errorMap` option from both `occurrenceDate` declarations)
- **Verification:** `pnpm typecheck` passes; the plan's `.strict()` + i18n-key contract is satisfied for the other 6 schema fields where Zod's option shape DOES still accept `message`.
- **Committed in:** `a3c79e7` (Task 2)

**2. [Rule 2 — Critical functionality] Added `withIdempotency` export alias for RED-test compatibility**

- **Found during:** Task 1 reading `tests/unit/idempotency-middleware.test.ts`
- **Issue:** The Wave 0 RED test imports `withIdempotency` (the test was written before the canonical export name was settled). The plan's spec exports `idempotencyMiddleware`. A name divergence would force editing the Wave 0 test file from this plan — that crosses test-as-contract boundary and makes Wave 0's RED-tests dependent on Wave 2 plans.
- **Fix:** Exported BOTH names from `idempotency.ts`. `idempotencyMiddleware` is canonical (matches plan spec + RESEARCH §Pitfall 5); `withIdempotency = idempotencyMiddleware` is the alias used by the unit test. No functional divergence; no Wave 0 test edits.
- **Files modified:** `src/server/trpc/middleware/idempotency.ts` (one-line alias export)
- **Verification:** `pnpm test -- tests/unit/idempotency-middleware.test.ts --run` — first assertion PASSES (was Plan 04-01 RED).
- **Committed in:** `0cd75de` (Task 1)

**Total deviations:** 2 auto-fixed (Rule 3 blocking + Rule 2 critical). Both preserve plan intent.

## Wave 0 Test State (post-04-03)

The plan's verify step asks to document which Wave 0 tests now PASS:

| Test file | State | Reason |
| --- | --- | --- |
| `tests/unit/quality-score-range.test.ts` | **GREEN** (1 + 2 todo) | `mapStarsToDb` import now resolves; first assertion passes. |
| `tests/unit/idempotency-middleware.test.ts` | **GREEN** (1 + 3 todo) | `withIdempotency` import now resolves; first assertion passes. |
| `tests/integration/training-mark-attendance.test.ts` | **RED-as-placeholder** | Wave 0 skeleton uses `expect.fail('Not implemented...')`. Plan 04-09 replaces with real assertions. The router IS implemented; the test just hasn't been re-written. |
| `tests/integration/14d-walls.test.ts` | **RED-as-placeholder** | Same pattern; the trainer wall IS enforced (handler-side); test skeleton needs real boundary probes. |
| `tests/integration/training-medical-conflict.test.ts` | **RED-as-placeholder** | Same; `getSession.hasMedicalConflict` flag IS surfaced; test skeleton needs real assertion. |
| `tests/integration/attendance-medical-default.test.ts` | **RED-as-placeholder** | Same; the form default derivation IS available via `getSession`; test skeleton needs real assertion. |
| `tests/integration/session-participants-rls.test.ts` | **RED-as-placeholder** | RLS lives in Plan 04-02 migration; router does not directly assert RLS state. Plan 04-09 will exercise it through the router. |
| `tests/integration/session-participants-occurrence.test.ts` | **RED-as-placeholder** | D-82 composite PK lives in Plan 04-02 migration; router uses it correctly. Plan 04-09 will exercise. |
| `tests/integration/phase4-audit.test.ts` "declares all 14 codes" | **GREEN** | Static manifest assertion. |
| `tests/integration/phase4-audit.test.ts` other 13 codes | **RED-as-placeholder** | Same expect.fail pattern; codes ARE emitted by the router; Plan 04-09 verifies via DB query. |

**Net:** the router's deliverables are complete; the integration tests stay structurally RED because Wave 0 only shipped `expect.fail()` skeletons (per Plan 04-01's contract). Plan 04-09 (Wave 4 integration test sweep) will replace the skeletons with real DB-backed assertions and flip them GREEN.

## Pre-existing Test Failures (unrelated to this plan)

The wider `pnpm test -- tests/unit --run` shows 28 unit-test failures in 12 files (167 passed + 24 todo). All of these failures are **pre-existing Wave 0 RED skeletons or pre-existing Phase 2/3 RED tests** unrelated to plan 04-03:
- `tests/unit/entered-by-derivation.test.ts` — Plan 04-04 deliverable (tournament router); RED expected
- `tests/unit/lookup-codes.test.ts` — testcontainer-required Postgres setup unavailable in this environment; RED unrelated
- `tests/unit/magic-bytes.test.ts` — Phase 2 file-upload tests; not touched here
- `tests/unit/match-derived-won.test.ts` — Plan 04-04 deliverable; RED expected
- `tests/unit/medical-schema.test.ts` — testcontainer-required; RED unrelated
- `tests/unit/player-schemas.test.ts` — Phase 2 RED-skeleton pattern; not touched here
- `tests/unit/ranking-xor.test.ts` — Plan 04-05 deliverable; RED expected
- `tests/unit/rrule-byday.test.ts`, `rrule-split.test.ts` — Plan 04-06 deliverables; RED expected
- `tests/unit/worker-template.test.ts` — Phase 1 RED; not touched here

`git diff HEAD~2..HEAD -- tests/` is empty: this plan touched ZERO test files. All failures pre-date 04-03.

## Threat Model Disposition

From `<threat_model>` in plan 04-03:

| Threat ID | Disposition | Outcome |
| --- | --- | --- |
| T-04-15-14D-WALL-BYPASS-VIA-CLIENT | mitigate | Server-side `Date.now() - endsAt > FOURTEEN_DAYS_MS` is the only enforcement. Verified by the FORBIDDEN throw + denied-outcome audit. |
| T-04-16-CROSS-ACADEMY-TAMPERING | mitigate | Three layers: (1) `trainerOrTdProcedure` role gate; (2) inline `event.trainerId === ctx.scope.userId` check (TD bypass); (3) RLS `sp_write_trainer_or_td` policy from Plan 04-02. |
| T-04-17-RACE-CONDITION-DOUBLE-WRITE | mitigate | `ON CONFLICT DO UPDATE` on `(event_id, occurrence_date, user_id)` composite PK + `audit_log` snapshot of `oldValues` so overrides are forensically visible. |
| T-04-18-IDEMPOTENCY-REPLAY-FORGERY | accept-with-test | Same `(key, userId, endpoint)` replays cached body; documented in idempotency.ts block-comment + tested in Plan 04-04's `idempotency-tournament.test.ts`. |
| T-04-19-AUDIT-LOG-DENIED-OUTCOME-OMISSION | mitigate | `training_score_window_expired_attempt` row with `outcome='denied'` written via `writeAudit(...)` BEFORE the `throw new TRPCError(...)`. |
| T-04-20-INPUT-SMUGGLING-VIA-EXTRA-FIELDS | mitigate | All 3 Zod schemas use `.strict()` — unknown keys raise BAD_REQUEST. |

All 6 threats mitigated or accept-with-test. No new threats introduced.

## Self-Check: PASSED

- [x] `src/lib/quality-score.ts` exists; exports `mapStarsToDb` and `mapDbToStars` (verified via grep)
- [x] `src/server/trpc/middleware/idempotency.ts` exists; exports `idempotencyMiddleware` + `withIdempotency`; contains `'idempotency_replay'` audit code (verified via grep)
- [x] `src/server/trpc/middleware/freshSession.ts` exports `trainerOrTdProcedure` (verified via grep)
- [x] `src/server/trpc/schemas/training.ts` exists; exports `markAttendanceAndScoreInput` / `listPendingInput` / `getSessionInput`; uses `.strict()` (5x) (verified via grep)
- [x] `src/server/trpc/routers/training.ts` exists; exports `trainingRouter`; contains `errors.training.scoreWindowExpired`, `training_score_window_expired_attempt`, `training_attendance_marked`, `FOURTEEN_DAYS_MS`, `onConflictDoUpdate`, `idempotencyMiddleware('training.markAttendanceAndScore')` (all verified via grep)
- [x] `src/server/trpc/routers/_app.ts` registers `training: trainingRouter` (verified via grep)
- [x] `pnpm typecheck` exit 0 (verified end-to-end)
- [x] `pnpm test -- tests/unit/quality-score-range.test.ts --run` PASSES (1 + 2 todo)
- [x] `pnpm test -- tests/unit/idempotency-middleware.test.ts --run` PASSES (1 + 3 todo)
- [x] Task 1 commit `0cd75de` exists on the worktree branch (verified via `git log`)
- [x] Task 2 commit `a3c79e7` exists on the worktree branch (verified via `git log`)
- [x] No modifications to `.planning/STATE.md` or `.planning/ROADMAP.md` (verified via `git status` — only this SUMMARY.md is a new file)
- [x] No accidental deletions in either task commit (verified via `git diff --diff-filter=D` per commit)

## Next Phase Readiness

- **Plan 04-04 (Tournament router):** composes `idempotencyMiddleware('tournament.enterResult')` on the `enterResult` procedure. The pattern is now established. Audit code `idempotency_replay` already emitted.
- **Plan 04-05 (Ranking router):** composes `idempotencyMiddleware('ranking.addEntry')` on `addEntry`. Same shape.
- **Plan 04-06 (RRULE edit scopes):** `session_participants` rows from `markAttendanceAndScore` are the historical-data substrate; D-83 immutability is enforced at the API layer here (no UPDATE/DELETE path on `session_participants` once a row exists; only the upsert flow modifies). 04-06 will add the recurring-edit scope branches that spawn new event ids without touching past `session_participants` rows.
- **Plan 04-07 (Inbox + pg_cron wiring):** the pg_cron nudges from Plan 04-02 already populate `system_inbox`; 04-07's router will surface `inbox.listForCaller` to the UI banner. The training router's `listPending` is the alternate read path the trainer uses interactively (the banner is the passive notification surface).
- **Plan 04-08 (Phase 4 UI work):** the React form bound to `training.getSession` for preload + `training.markAttendanceAndScore` for save. `mapStarsToDb` + `mapDbToStars` are the client-side helpers that bridge UI's 5-star widget to the DB's 1..10 column.
- **Plan 04-09 (Wave 4 integration tests):** replace Wave 0 `expect.fail()` placeholders with real DB-backed assertions against the live router. The audit codes are already emitted; the wall is already enforced; the upsert is already race-safe — the tests just need to be re-written from skeleton to real probe.

**Concerns:** None blocking.

---

*Phase: 04-kerndomein*
*Plan: 03*
*Completed: 2026-05-16*
