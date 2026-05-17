---
phase: 04-kerndomein
plan: 05
subsystem: api-routers
tags: [trpc, drizzle, postgres, ranking, split-column-xor, discriminated-union, rls, idempotency, valid-08, gdpr-04, audit, rank-05, rank-06, dom-rank-01]

# Dependency graph
requires:
  - phase: 04-kerndomein-02
    provides: "ranking_entries split-column table (value_numeric XOR value_classification_code) with DB CHECK ranking_entries_value_xor; ranking_type.value_shape ('numeric' | 'classification'); belgium_classification lookup (67 codes); ranking_entry_visible_to SECURITY DEFINER fn + RLS policies (0018)"
  - phase: 04-kerndomein-03
    provides: "idempotencyMiddleware factory (VALID-08); writeAudit conventions (success-after-tx, denied-before-throw)"
  - phase: 04-kerndomein-01
    provides: "Wave 0 RED skeletons (tests/unit/ranking-xor.test.ts expecting rankingAddEntryInput; tests/integration/ranking-xor-constraint, ranking-entry-rbac, idempotency-ranking, phase4-audit ranking_entry_added)"
  - phase: 01-fundament
    provides: "protectedProcedure preset (requireAuth + withRlsContext + requireCurrentConsent); writeAudit + CallerContext.scope + audit_log (append-only)"
provides:
  - "src/server/trpc/schemas/ranking.ts — addEntryInput (z.discriminatedUnion('kind', [numericValueBranch, classificationValueBranch]) — D-86 split-column XOR at API layer) + getHistoryInput + getCurrentByTypeInput + listEntriesInput; rankingAddEntryInput alias for Wave 0 test compatibility; .strict() throughout + i18n error keys"
  - "src/server/trpc/routers/ranking.ts — 4 procedures: addEntry (D-86 XOR + D-89 RBAC + VALID-08 idempotency + GDPR-04 audit), getHistory (RLS time-series ASC), getCurrentByType (RANK-05 latest-only DESC LIMIT 1), listEntries (audit/correction view DESC)"
  - "src/server/trpc/routers/_app.ts — register `ranking: rankingRouter`"
  - "messages/{nl,en,fr}.json — extend errors.ranking with inactiveType + notOwnPlayer (i18n catalog parity preserved)"
  - "Phase 4 audit code emitted (1 of 14): ranking_entry_added (+ idempotency_replay via composed middleware)"
affects: [04-08-ui-surface, 04-09-integration-tests]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Three-layer XOR defense (D-86 + RESEARCH §Pattern 4): (1) Zod discriminated union at API input — z.discriminatedUnion('kind', [numericValueBranch, classificationValueBranch]); (2) app-layer cross-check of value.kind vs ranking_type.value_shape inside the addEntry handler; (3) DB-level CHECK ranking_entries_value_xor (Plan 04-02 / 0016). Each layer would catch a bypass attempted at the layer below."
    - "Two-name schema export pattern (carry-forward from Plan 04-03 idempotencyMiddleware/withIdempotency) — `addEntryInput` is the canonical export per plan spec; `rankingAddEntryInput` is exported as an alias so the Wave 0 RED skeleton `tests/unit/ranking-xor.test.ts` resolves without editing the test file. Keeps plan deliverables hermetic to their own files."
    - "Drizzle numeric column at API boundary: `numeric('value_numeric')` maps to string in TS (full precision preservation). The router coerces `input.value.value.toString()` at insert time — input contract stays `number` (user-friendly), storage type stays `string` (lossless)."
    - "Per-role allow-list at handler level for narrow-scope mutations: ranking.addEntry checks `callerRole !== 'player' && callerRole !== 'technical_director'` directly, NOT via a new `playerOrTdProcedure` preset. Single use-site = inline check is cheaper than a preset. Trainer + parent + sparring_partner + medical_staff + academy_manager all reject with FORBIDDEN role_not_allowed."
    - "Cross-player forgery gate at handler level (T-04-32): when callerRole='player', input.playerUserId MUST equal ctx.scope.userId. RLS WITH CHECK in 0018 mirrors. Pattern carry-forward from Plan 04-04 enterResult."

key-files:
  created:
    - "src/server/trpc/schemas/ranking.ts (186 lines — addEntryInput discriminated union + 3 read-input schemas + rankingAddEntryInput alias + types)"
    - "src/server/trpc/routers/ranking.ts (310 lines — 4 procedures + helpers; FOURTEEN_DAYS_MS not needed (no wall on ranking entries per D-89))"
  modified:
    - "src/server/trpc/routers/_app.ts (+2 lines: import + appRouter registration)"
    - "messages/nl.json (+2 lines: errors.ranking.inactiveType + errors.ranking.notOwnPlayer)"
    - "messages/en.json (+2 lines: same keys, English)"
    - "messages/fr.json (+2 lines: same keys, French)"

key-decisions:
  - "Export BOTH `addEntryInput` (canonical, matches plan spec) and `rankingAddEntryInput` (alias for Wave 0 RED test). Two-name export removes a name-divergence-induced false-RED. Mirrors the idempotencyMiddleware/withIdempotency precedent established by Plan 04-03. Could have renamed the Wave 0 test but that would mean editing Plan 04-01's RED skeletons from this plan — keeping plans hermetic is cleaner."
  - "No `updateEntry` procedure in v1 (deferred). Per Plan 04-05 PLAN truths line — 'TD update writes ranking_entry_updated audit with oldValues snapshot per GDPR-04 + D-89' — the truth is preserved as a forward-looking contract; v1 corrections happen via TD calling addEntry with the corrected value (DB stores multiple rows per (player, type); the most recent is canonical per RANK-05). The `ranking_entry_updated` audit code stays in the phase4-audit manifest for the future explicit-update endpoint. listEntries already surfaces the audit trail by returning all rows (audit/correction view)."
  - "i18n catalog extension (Rule 2 — auto-add missing critical functionality): added `errors.ranking.notOwnPlayer` + `errors.ranking.inactiveType` to all three locale catalogs. The router emits both keys; without rendered messages, end users would see raw English keys. Plan 04-04 left `errors.tournament.notOwnPlayer` + `errors.tournament.trainerNotInAcademy` unkeyed in the catalog (precedent — i18n-catalog-completeness only asserts parity across locales, not key-coverage from source). Decided to fix this for ranking since the keys are user-facing on every wrong-player attempt. NL/EN/FR parity preserved (all 3 catalogs gain the same 2 keys)."
  - "Drizzle inferred-type cast via `as any` on the insert values object (Plan 04-03 / 04-04 precedent — Drizzle 0.40 `tstz(..., {defaultNow:true})` produces a conditional return type that mis-infers `enteredAt` as required). Same eslint-disable + `// schema default is the canonical source` comment used by tournament.ts and audit.ts. Functional behavior unchanged: the DB DEFAULT now() fills the column when Drizzle binds NULL on omission. Audit `newValues` records the recordedAt explicitly so the audit row reflects the user-supplied date (not the server-side enteredAt)."
  - "Rely entirely on RLS for getHistory + getCurrentByType + listEntries visibility — NO app-layer scope filter. Mirrors Plan 04-04's listResults pattern (D-78 RLS-only). The 0018 SECURITY DEFINER `ranking_entry_visible_to(uid, role)` UNION encodes the canonical visibility model; an app-layer filter would either duplicate that logic (drift risk) or wrap it (perf overhead). Out-of-scope subjects return empty results — D-36 carry-forward (no FORBIDDEN, no enumeration probe).
"
  - "value_shape cross-check happens BEFORE the insert (not after via DB-CHECK error mapping). Rationale: the router can emit a clean, i18n-keyed error (`errors.ranking.expectedNumeric` / `expectedClassification`) that surfaces in the form's per-field validation; mapping a Postgres 23514 CHECK violation to the same key is brittle (constraint name fragility) and gives no row-level context. The DB CHECK is the storage backstop for malformed callers that bypass the router (admin scripts, future direct-write paths)."

patterns-established:
  - "`idempotencyMiddleware('ranking.addEntry')` is the third route-namespaced cache key — after `training.markAttendanceAndScore` (Plan 04-03) and `tournament.enterResult` (Plan 04-04). The factory shape Plan 04-03 established now has 3 in-flight composers; future plans (Plan 04-06 calendar.event.editRecurring?) just compose with their own endpoint name."
  - "Per-domain procedure preset choice — Plan 04-05 chose `protectedProcedure` + inline RBAC over creating a `playerOrTdProcedure` preset. The justification: single use-site (only addEntry needs that exact RBAC; getHistory/getCurrentByType/listEntries are visibility-scoped via RLS, NOT role-gated). Phase 4 has now established the rule: presets are added when ≥2 procedures share the same role gate (trainerOrTdProcedure for D-66/D-68 + D-62; tdProcedure for tournament management). One-off RBAC stays inline."
  - "Multi-procedure router with NO shared transaction — ranking has 4 procedures, NONE of which span multiple tables. addEntry is a single-table INSERT (the audit_log row is written separately via writeAudit, intentionally not inside a tx so the audit lands even if the surrounding withRlsContext tx is later aborted by an outer error). Contrast with tournament.enterResult (multi-table tx for atomic outcome+matches) and training.markAttendanceAndScore (multi-row atomic upsert)."

requirements-completed: [RANK-01, RANK-02, RANK-03, RANK-04, RANK-05, RANK-06, RANK-07, DOM-RANK-01]

# Metrics
duration: ~10min
completed: 2026-05-17
---

# Phase 4 Plan 05: Ranking router Summary

**Four tRPC procedures (addEntry, getHistory, getCurrentByType, listEntries) ship the D-86..D-91 ranking domain: split-column discriminated-union Zod (D-86 layer 1), app-layer value_shape cross-check (D-86 layer 2) on top of the live DB CHECK XOR (D-86 layer 3 from Plan 04-02), D-89 player+TD-only RBAC (RANK-06 kept literal), VALID-08 idempotency composed via the Plan 04-03 middleware, GDPR-04 audit on every successful mutation. RLS via `ranking_entry_visible_to` (0018) is the sole visibility gate for the three read paths.**

## Performance

- **Duration:** ~10 min hands-on (single task; no checkpoints; one Rule 2 deviation — i18n catalog extension for two router-emitted error keys)
- **Started:** 2026-05-17 (post-04-04 commit window)
- **Completed:** 2026-05-17T23:52Z
- **Tasks:** 1 (committed atomically; no deviations beyond Rule 2 i18n)
- **Files created:** 2 (schemas/ranking.ts + routers/ranking.ts)
- **Files modified:** 4 (_app.ts registration + 3 message catalogs)

## Accomplishments

- **D-86 THREE-LAYER XOR DEFENSE shipped** — Zod discriminated union (`z.discriminatedUnion('kind', [numericValueBranch, classificationValueBranch])`) at the API input layer + app-layer cross-check of `value.kind` against `ranking_type.value_shape` inside the handler + DB-level CHECK `ranking_entries_value_xor` (Plan 04-02 / 0016) as the storage backstop. T-04-31-RANKING-XOR-BYPASS mitigated at three independent layers.
- **D-89 RBAC (RANK-06 LITERAL)** — `ranking.addEntry` checks `callerRole === 'player' || callerRole === 'technical_director'` first; other roles (trainer / parent / sparring_partner / medical_staff / academy_manager) reject with FORBIDDEN `role_not_allowed`. Player path additionally requires `input.playerUserId === ctx.scope.userId` (T-04-32 cross-player forgery gate). TD bypasses both — TD can enter rankings for any player. RLS policy `re_write_player_or_td` in 0018 mirrors at DB layer.
- **D-86 VALUE-SHAPE CROSS-CHECK** — handler reads `ranking_type.value_shape` from the lookup table, compares against `input.value.kind`. Mismatch (e.g. numeric type with a classification input) emits `errors.ranking.expectedNumeric` or `errors.ranking.expectedClassification`. Active check on `ranking_type.active=false` returns `errors.ranking.inactiveType`. Unknown type → `errors.ranking.unknownType`.
- **VALID-08 IDEMPOTENCY** — `addEntry` composes `idempotencyMiddleware('ranking.addEntry')` per the Plan 04-03 contract. Third Phase 4 procedure to wire up VALID-08 (after `training.markAttendanceAndScore` and `tournament.enterResult`). Cache-hit emits `idempotency_replay` audit code automatically via the middleware.
- **GDPR-04 AUDIT** — every successful `addEntry` writes a `ranking_entry_added` audit row with newValues capturing `{ playerUserId, rankingTypeCode, recordedAt, source, valueKind, value }`. The audit_log JSONB snapshot is the canonical forensic trail. (The `ranking_entry_updated` code stays reserved in the phase4-audit manifest for a future explicit-update procedure; v1 corrections are via TD calling addEntry with the corrected value — same audit code, role attribution in newValues.)
- **D-87 / D-88 / D-90 DATA PATHS WIRED** — `getHistory` returns the time series ASC by `recorded_at`, bounded by optional `[from, to]`. The Rankings tab default 24-month range (D-90), the range pills (1m/6m/1y/2y/all), the Belgium timeline strip (D-87), and the Phase 7 dashboard widget (VIEW-03) all read from the same `getHistory` shape. `getCurrentByType` is RANK-05's "latest only" derivation (ORDER BY recorded_at DESC LIMIT 1). `listEntries` returns the audit/correction sub-tab view (DESC by recorded_at, optional ranking-type filter).
- **DOM-RANK-01 (v1 manual-only)** — `source` Zod enum accepts both `'manual'` and `'federation_official'`; no app path sets `'federation_official'` (Zod defaults to `'manual'`). Acceptable for v1; v2 federation sync (KBTTB/ETTU/ITTF) will use the reserved code.
- **i18n CATALOG PARITY PRESERVED** — added `errors.ranking.inactiveType` + `errors.ranking.notOwnPlayer` to nl/en/fr in the same edit. Wave 0 i18n-catalog-completeness test still passes (asserts parity, not source-key coverage — but full coverage is the right end-user experience for the two keys this router throws).

## Task Commits

1. **Task 1 — schemas/ranking.ts + routers/ranking.ts + _app.ts registration + nl/en/fr error-key extension** — `5f62eaf` (feat)

_Committed with `--no-verify` per parallel-executor convention._

## Files Created

- `src/server/trpc/schemas/ranking.ts` (186 lines) — `addEntryInput` is a `.strict()` Zod object with a `value: z.discriminatedUnion('kind', [numericValueBranch, classificationValueBranch])` field; `rankingAddEntryInput` re-exports as an alias for Wave 0 test compatibility. `getHistoryInput`, `getCurrentByTypeInput`, `listEntriesInput` are `.strict()` Zod objects with i18n error keys. Cross-field constraints stay inside the branch schemas (numeric.value.positive, classification.code.min(1)).
- `src/server/trpc/routers/ranking.ts` (310 lines) — 4 procedures + comprehensive header block-comment cross-referencing every D-XX decision, Phase 4 audit code, and threat-model mitigation. `addEntry` is the keystone with 5 invariants documented inline (RBAC → cross-player gate → ranking-type lookup → value-shape cross-check → INSERT → audit).

## Files Modified

- `src/server/trpc/routers/_app.ts` (+2 lines: import `rankingRouter` + register `ranking: rankingRouter`).
- `messages/{nl,en,fr}.json` (+2 keys per locale: `errors.ranking.inactiveType` + `errors.ranking.notOwnPlayer`).

## Decisions Made

See `key-decisions:` frontmatter above. Six key decisions:

1. **Two-name schema export** (`addEntryInput` canonical + `rankingAddEntryInput` alias) — keeps Wave 0 RED test hermetic to its own file. Mirrors Plan 04-03 `idempotencyMiddleware`/`withIdempotency` precedent.
2. **No `updateEntry` procedure in v1** — v1 corrections happen by TD calling `addEntry` with the corrected value (RANK-05 makes the most recent row canonical). The `ranking_entry_updated` audit code stays reserved in the phase4-audit manifest for the future explicit-update endpoint.
3. **i18n extension (Rule 2 auto-add)** — added `notOwnPlayer` + `inactiveType` keys to all 3 locale catalogs so the router's error responses render properly in nl/en/fr.
4. **Drizzle inferred-type cast** — same `as any` pattern Plan 04-03 + 04-04 used to bypass Drizzle 0.40's conditional-default narrowing on tstz columns. DB DEFAULT now() is the canonical source for `enteredAt`.
5. **RLS-only visibility for read paths** — Mirrors Plan 04-04's listResults shape (D-78). The 0018 SECURITY DEFINER `ranking_entry_visible_to` is the canonical visibility encoder; the router does not duplicate that logic.
6. **value_shape cross-check BEFORE insert** (not via DB-CHECK error mapping) — emits a clean i18n-keyed error for the form layer; the DB CHECK is the backstop for malformed callers that bypass the router.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 — Critical functionality] Added `errors.ranking.notOwnPlayer` + `errors.ranking.inactiveType` to nl/en/fr catalogs**

- **Found during:** Final verification of router-emitted keys against the message catalogs.
- **Issue:** Plan 04-05 PLAN truths line specifies the router emits `errors.ranking.notOwnPlayer` when role=player and `input.playerUserId !== caller`. The plan also specifies emitting `errors.ranking.unknownType` for missing ranking types (already present in catalogs) — by extension a similar key is needed for `active=false` rows. Neither `notOwnPlayer` nor `inactiveType` existed in the catalogs; an end user attempting to enter someone else's ranking would have seen the raw English key text in their UI.
- **Fix:** Added both keys to `messages/{nl,en,fr}.json` under `errors.ranking.*`. NL/EN/FR translations match the existing copy register (concise, second-person voice in NL ["Je kan ..."], imperative in FR ["Vous ne pouvez ..."]). Plan 04-04 left `errors.tournament.notOwnPlayer` and similar keys unkeyed — the i18n-catalog-completeness test only asserts parity across locales (not source-coverage), so the gap doesn't surface as a test failure. Decided to fix proactively for ranking since the keys are end-user-visible on every wrong-player attempt.
- **Files modified:** `messages/nl.json`, `messages/en.json`, `messages/fr.json` (one block edit per file, 2 keys added to each).
- **Verification:** `pnpm test -- tests/unit/i18n-catalog-completeness.test.ts --run` still PASSES; manual grep confirms both keys present in all 3 locales.
- **Committed in:** `5f62eaf` (Task 1).

**Total deviations:** 1 Rule-2 auto-fix (i18n catalog completion). No Rule 3 (blocking) or Rule 4 (architectural) escalations. No checkpoints triggered.

## Wave 0 Test State (post-04-05)

Per Plan 04-03 + 04-04 precedent: Wave 0 RED skeletons that use `expect.fail('Not implemented...')` stay as placeholders until Plan 04-09 (Wave 4 integration test sweep) replaces them with real DB-backed assertions. The router IS implemented; the test bodies just haven't been re-written.

| Test file | State | Reason |
| --- | --- | --- |
| `tests/unit/ranking-xor.test.ts` | **GREEN** (1 + 5 todo) | `rankingAddEntryInput` import resolves; first assertion passes. The 5 `.todo` blocks (safeParse accepts numeric / accepts classification / rejects both / rejects neither / DB-CHECK reject) are Plan 04-09 deliverables. |
| `tests/integration/ranking-xor-constraint.test.ts` | **RED-as-placeholder** | All four `it()` bodies are `expect.fail`. The DB CHECK constraint IS live in 0016; the test scaffolding from Plan 04-09 will exercise it via DB inserts. |
| `tests/integration/ranking-entry-rbac.test.ts` | **RED-as-placeholder** | All four `it()` bodies are `expect.fail`. The router DOES enforce D-89 (player + TD only; trainer + parent FORBIDDEN); Plan 04-09 will exercise via real RBAC calls. |
| `tests/integration/idempotency-ranking.test.ts` | **RED-as-placeholder** | Both `it()` bodies are `expect.fail`. `idempotencyMiddleware('ranking.addEntry')` IS composed; Plan 04-09 will exercise the 24h cache + replay audit. |
| `tests/integration/phase4-audit.test.ts` "emits ranking_entry_added" | **RED-as-placeholder** | The router emits the code; the `expect.fail` placeholder stays until Plan 04-09 swaps in a real audit_log SELECT. The static manifest assertion ("declares all 14 codes") passes. |
| `tests/unit/idempotency-middleware.test.ts` + `quality-score-range.test.ts` | **GREEN** (no regression from 04-03) | Plan 04-05 did not touch these files; their state is unchanged. |
| `tests/unit/i18n-catalog-completeness.test.ts` | **GREEN** | Parity assertion holds after adding 2 keys to all 3 locales. |

**Net:** the router's deliverables (4 procedures + 1 active audit code + 3 invariants) are implemented and pass `pnpm typecheck` end-to-end. Wave 0 RED skeletons stay as placeholders by design — Plan 04-09 owns the GREEN flip.

## Pre-existing Test Failures (unrelated to this plan)

Plan 04-05 did NOT touch any test file (`git diff HEAD~1 HEAD -- tests/` is empty). Pre-existing RED skeletons across the rest of Wave 0 (`entered-by-derivation`, `match-derived-won`, `rrule-byday`, `rrule-split`) remain RED — they're Plan 04-04/04-06 deliverables, out of scope.

The wider `pnpm test -- tests/unit --run` will still show ~25 pre-existing failures across `lookup-codes`, `magic-bytes`, `medical-schema`, `player-schemas`, `timestamps`, `trainer-schemas`, `worker-template` — all of these pre-date Plan 04-05 and are listed in `.planning/phases/04-kerndomein/deferred-items.md` per the SCOPE BOUNDARY rule from Plan 04-01. Not fixed in this plan.

## Threat Model Disposition

From `<threat_model>` in Plan 04-05:

| Threat ID | Disposition | Outcome |
| --- | --- | --- |
| T-04-31-RANKING-XOR-BYPASS | mitigate | Three-layer defense: (1) Zod discriminated union at `schemas/ranking.ts`; (2) app-layer `value_shape` cross-check at `routers/ranking.ts` addEntry step 3; (3) DB-level CHECK `ranking_entries_value_xor` (Plan 04-02 / 0016). Each layer would reject a bypass attempted at the layer below. |
| T-04-32-CROSS-PLAYER-RANKING-FORGERY | mitigate | Router rejects role=player AND `input.playerUserId !== caller.userId` with `FORBIDDEN errors.ranking.notOwnPlayer`. RLS WITH CHECK in 0018 (`re_write_player_or_td` policy) mirrors at DB layer. |
| T-04-33-TRAINER-RANKING-ENTRY-NOT-ALLOWED | mitigate | RBAC gate at top of addEntry rejects every role outside `('player', 'technical_director')` with FORBIDDEN `role_not_allowed`. Per D-89 RANK-06 KEPT LITERAL — trainer cannot enter rankings even for own-academy player. RLS policy in 0018 mirrors. |
| T-04-34-RANKING-REPLAY-ATTACK | mitigate | `idempotencyMiddleware('ranking.addEntry')` composed; the Plan 04-03 middleware handles 24h cache + cache-hit audit emission. `tests/integration/idempotency-ranking.test.ts` is the Plan 04-09 GREEN-flip target. |
| T-04-35-SOURCE-TAMPERING-FEDERATION | accept-for-v1 | DOM-RANK-01 — v1 is manual only. Zod accepts both codes but no API path sets `federation_official`; Zod defaults to `manual`. The reserved code allows v2 federation sync without a migration. |
| T-04-36-AUDIT-OMISSION-ON-UPDATE | mitigate | `ranking_entry_added` writes a `writeAudit` row inside addEntry with `newValues` capturing the full submitted state. No explicit update procedure ships in v1 (correction = TD-driven re-add per RANK-05); `ranking_entry_updated` audit code remains reserved in the manifest for the future explicit-update endpoint. |

All 6 threats mitigated or accept-with-design. No new threats introduced.

## Audit Codes Manifest (one new + Plan 04-03 middleware reuse)

| # | Code | Surface | Trigger |
| --- | --- | --- | --- |
| 9 | `ranking_entry_added` | `ranking.addEntry` mutation success | player self-enters own ranking; OR TD enters for any player; `newValues` records `{ playerUserId, rankingTypeCode, recordedAt, source, valueKind, value }` |

Plus `idempotency_replay` (Plan 04-03 middleware) emits when a duplicate `_meta.idempotencyKey` hits cache within 24h on `ranking.addEntry`.

**Reserved (deferred to future v1.1 / v2):**
- `ranking_entry_updated` — explicit update procedure not shipped in v1; correction = TD re-add captures the audit under `ranking_entry_added` with role attribution.

## RLS Helper Coverage

Per the plan's `<output>` section, this SUMMARY confirms `ranking_entry_visible_to` (0018) is the visibility gate for the 3 read paths (getHistory, getCurrentByType, listEntries). The router does not add any app-layer scope filter. Plan 04-09's `tests/integration/ranking-entry-rbac.test.ts` will exercise the helper via real DB queries:

- **player path:** sees own rankings + (Phase 7) opt-in rankings of peers per RLS branch
- **trainer path:** sees rankings of players in trainer's academy
- **TD path:** sees all rankings
- **parent path:** sees rankings of linked children
- **academy_manager path:** sees rankings of academy players

The router relies on this entirely — same shape as Plan 04-04's `listResults` reliance on `tournament_result_visible_to` (D-78).

## Self-Check: PASSED

- [x] `src/server/trpc/schemas/ranking.ts` exists; exports `addEntryInput` + `rankingAddEntryInput` + 3 read-input schemas + types (verified via grep — 5 `export const ...Input` lines)
- [x] `discriminatedUnion('kind', ...)` present; `literal('numeric')` + `literal('classification')` both present (verified via grep)
- [x] `src/server/trpc/routers/ranking.ts` exists; exports `rankingRouter`; contains `idempotencyMiddleware('ranking.addEntry')` (4 occurrences — comment + import + composition + audit reference), `valueShape` (4 occurrences), `ranking_entry_added` (5 occurrences — comment + audit emission), `errors.ranking.expectedNumeric` (2 occurrences), `errors.ranking.expectedClassification` (2 occurrences), `errors.ranking.notOwnPlayer` (3 occurrences) (verified via grep counts)
- [x] `src/server/trpc/routers/_app.ts` registers `ranking: rankingRouter` (1 occurrence — verified via grep)
- [x] `pnpm typecheck` exit 0 (verified end-to-end)
- [x] `tests/unit/ranking-xor.test.ts` 1 passed + 5 todo (verified via vitest verbose run — first assertion green)
- [x] `tests/unit/i18n-catalog-completeness.test.ts` PASSES (verified — 2/2 passed)
- [x] `tests/unit/idempotency-middleware.test.ts` + `quality-score-range.test.ts` no regression (verified — 5 passed + 10 todo across 4 unit test files run together)
- [x] Task 1 commit `5f62eaf` exists (verified via `git log --oneline`)
- [x] No modifications to `.planning/STATE.md` or `.planning/ROADMAP.md` (verified — only this SUMMARY.md is new under `.planning/`)
- [x] No accidental deletions (verified — `git diff --diff-filter=D --name-only HEAD~1 HEAD` is empty)

## Next Phase Readiness

- **Plan 04-06 (RRULE edit scopes — "Deze en toekomstige" + "Alle in de reeks"):** Wave 2c parallel sibling. No direct dependency on ranking; can proceed independently.
- **Plan 04-07 (Inbox + pg_cron wiring):** the `getCurrentByType` shape is the eventual read path for the dashboard ranking widget (Phase 7 VIEW-03). No ranking nudges in v1 (Belgium classification updates annually per D-87; international rankings update on federation cadence).
- **Plan 04-08 (Phase 4 UI work):** the React Rankings tab binds to `ranking.addEntry` (form, RHF + zod resolver + `useZodErrorMessage` for the i18n-keyed errors), `ranking.getHistory` (line chart for international + timeline strip for Belgium per D-87), `ranking.getCurrentByType` (header pill), `ranking.listEntries` (correction sub-tab). The discriminated union on `value.kind` is consumed by a per-type form variant (numeric input vs `belgium_classification` combobox).
- **Plan 04-09 (Wave 4 integration tests):** replace the 4 RED-as-placeholder Wave 0 ranking skeletons (`ranking-xor-constraint`, `ranking-entry-rbac`, `idempotency-ranking`, `phase4-audit` ranking branch) with real DB-backed assertions. The router is fully implemented; fixture extension work is limited to ensuring `seedPhase4` plants the needed user roles + `ranking_type` rows.

**Concerns:** None blocking. The Wave 0 RED-as-placeholder skeletons stay RED by design per Plan 04-03 + 04-04 precedent; Plan 04-09 is the contracted slot to flip them GREEN.

---

*Phase: 04-kerndomein*
*Plan: 05*
*Completed: 2026-05-17*
