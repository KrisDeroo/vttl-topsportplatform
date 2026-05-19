---
phase: 04-kerndomein
plan: 11
subsystem: idempotency
tags: [idempotency, valid-08, security, replay, sha256, drizzle, migration, cr-02]
requires:
  - 04-03 (idempotency middleware factory shipped in Wave 1)
  - 04-04 (tournament.enterResult wires middleware at line 539)
  - 04-05 (ranking.addEntry wires middleware at line 128)
provides:
  - "request_hash binding on idempotency_keys — replay-different-input attacks return CONFLICT not stale response"
  - "errors.idempotency.inputMismatch i18n key in nl/en/fr"
  - "Drizzle migration 0021 (additive ALTER, no rename of response_hash)"
affects:
  - tournament.enterResult / training.markAttendanceAndScore / ranking.addEntry replay semantics
  - idempotency_keys table shape (additive)
tech-stack:
  added: []
  patterns:
    - "Sorted-keys JSON canonicalisation + sha256 for content-addressable cache binding"
    - "TRPCError CONFLICT raised on input-mismatch (rather than silent treat-as-miss)"
key-files:
  created:
    - drizzle/0021_phase4_idempotency_request_hash.sql
    - drizzle/0021_phase4_idempotency_request_hash.rollback.md
    - tests/integration/idempotency-input-binding.test.ts
  modified:
    - src/server/db/schema/idempotency.ts
    - src/server/trpc/middleware/idempotency.ts
    - messages/nl.json
    - messages/en.json
    - messages/fr.json
    - tests/unit/migration-format.test.ts
decisions:
  - "Add request_hash as a new column rather than reuse response_hash (preserves WR-08 v2-reserved response-tamper detection)"
  - "Migration is additive only; no backfill (raw input is unrecoverable from response_body; existing rows expire within 24h)"
  - "Mismatched hash on cache HIT raises CONFLICT (HTTP 409) — explicit error preferred over silent cache miss to surface client bugs and prevent double-execution side effects"
  - "Legacy rows (pre-fix, request_hash IS NULL) accepted without hash check during 24h grace window — middleware treats null as 'legacy: accept any input'"
metrics:
  duration: "~8 minutes wall clock"
  completed: "2026-05-19T09:52:20Z"
  tasks: 3
  commits: 3
  files_changed: 9
---

# Phase 4 Plan 11: Idempotency Input Binding (CR-02) Summary

## One-Liner

Bind tRPC idempotency cache lookups to canonicalised input via sha256 — same key with different input now returns CONFLICT instead of replaying the stale response.

## Goal Achievement

Closed Phase 4 VERIFICATION.md `gaps[1]` (CR-02 / VALID-08):

- **Before:** `idempotency_keys` cache lookup keyed only on `(key, userId, endpoint)`; same `_meta.idempotencyKey` with different input within 24h received the cached body of the first call. `responseHash: null` written on every insert and never read.
- **After:** Middleware computes `sha256(JSON.stringify(canonicaliseJson(raw)))` on every call. Cache HIT compares stored vs new hash; mismatch raises TRPCError CONFLICT with i18n message `errors.idempotency.inputMismatch`. Cache MISS persists the hash on insert.

T-04-25 replay-different-input attack surface closed. VALID-08 contract now matches the docstring ("Replay (same key + same user + same endpoint): middleware short-circuits, returns the cached response WITHOUT re-running the handler") and adds the missing input-identity constraint.

## Files Created

### `drizzle/0021_phase4_idempotency_request_hash.sql`
Additive ALTER adds `request_hash text` column (nullable on initial add for the 24h legacy-row grace window). Includes `COMMENT ON COLUMN` documenting the column purpose and reference to 04-VERIFICATION.md / 04-REVIEW.md.

### `drizzle/0021_phase4_idempotency_request_hash.rollback.md`
Standard rollback companion with Risk / Procedure / Verification headers (enforced by `tests/unit/migration-format.test.ts`). Risk: LOW — additive DDL, rollback drops a single column; no data loss on `response_body`.

### `tests/integration/idempotency-input-binding.test.ts`
Four it-blocks exercising `tournament.enterResult` through the tRPC caller:

1. **Same key + same input → cache HIT replay** — regression check that the existing replay marker (`__idempotency_replay: true`) still fires.
2. **Same key + DIFFERENT input → CONFLICT** — two mutation variants (outcome change, matches[].opponent change) each rejected with `{ code: 'CONFLICT', message: 'errors.idempotency.inputMismatch' }`.
3. **Different key + same input → cache MISS** — fresh handler execution, no replay marker.
4. **Object-key-order shuffle → cache HIT** — verifies the sorted-keys canonicalisation invariance (same logical input, different JS object key insertion order, same hash).

Plants its own future-tournament fixture in `beforeAll` because `phase4-seed.ts` only exposes past-tournament fixtures (`pastTournamentEventId` / `tournamentEntryWithMatchesEventId`).

Uses `appCaller({ userId, role })` from `tests/helpers/trpc.ts` and `fixtures.users.player` — NOT `fixtures.makeCtx()` or `fixtures.player1` which do not exist on `Phase4SeededFixtures`.

When run against a freshly-pushed dev/testcontainer DB: all 4 it-blocks should pass. When run without DB: describe block skips cleanly via `describe.skipIf(!dbReady)`.

## Files Modified

### `src/server/db/schema/idempotency.ts`
- Added `requestHash: text('request_hash')` column declaration between `endpoint` and `responseHash` (alphabetical-by-meaning).
- Preserved `responseHash: text('response_hash')` unchanged with annotation that it is v2-reserved (per WR-08).
- Extended JSDoc lifecycle bullet documenting the cache-HIT hash check.

### `src/server/trpc/middleware/idempotency.ts`
- New `canonicaliseJson(value)` helper at module scope — recursive sorted-keys object serialisation (arrays preserved, primitives passed through).
- New `hashInput(raw)` helper — `sha256(JSON.stringify(canonicaliseJson(raw)))`.
- Added `createHash` and `TRPCError` imports.
- `inputHash` computed after `_meta.idempotencyKey` is parsed (before any DB call — guard early-returns first to keep no-key callers cheap).
- Cache SELECT shape now retrieves `storedRequestHash: idempotencyKeys.requestHash`. Hash NOT added to WHERE chain — we want to find the row regardless of hash so a mismatch can be reported as CONFLICT (silent treat-as-miss would cause double-execution side effects).
- Cache HIT branch checks `stored !== null && stored !== inputHash` and throws `TRPCError({ code: 'CONFLICT', message: 'errors.idempotency.inputMismatch' })` before the existing audit + replay logic.
- Cache MISS insert now writes `requestHash: inputHash` alongside the existing `responseHash: null` (latter preserved as v2-reserved).

### `messages/{nl,en,fr}.json`
Added `errors.idempotency.inputMismatch` to all 3 catalogs with locale-appropriate copy:
- **nl:** "Idempotentiesleutel hergebruikt met andere invoer. Genereer een nieuwe sleutel of corrigeer de invoer."
- **en:** "Idempotency key reused with different input. Generate a new key or correct the payload."
- **fr:** "Clé d'idempotence réutilisée avec des entrées différentes. Générez une nouvelle clé ou corrigez la charge utile."

Key-set parity preserved — `tests/unit/i18n-catalog-completeness.test.ts` green.

### `tests/unit/migration-format.test.ts`
Extended Phase 4 expected manifest from 7 → 8 migration stems (adds `0021_phase4_idempotency_request_hash`). The `it.skipIf(!sqlExists)` guards mean the new manifest entry only asserts once the .sql file lands — both the .sql and its `.rollback.md` companion are now committed so both per-stem assertions evaluate.

## Behavioral Contract

**Cache HIT branches:**

| Stored request_hash | New input hash | Resolution |
| ---- | ---- | ---- |
| `null` (legacy pre-fix row) | any | Replay cached body (24h grace window) |
| matches `inputHash` | matches | Replay cached body + `__idempotency_replay: true` marker + `idempotency_replay` audit row |
| does NOT match `inputHash` | mismatched | `TRPCError({ code: 'CONFLICT', message: 'errors.idempotency.inputMismatch' })` |

**Cache MISS branch (no row for `(key, userId, endpoint)` within TTL):**

| Action | Stored values |
| ---- | ---- |
| Run handler, persist row | `key`, `userId`, `endpoint`, `responseBody`, `requestHash = inputHash`, `responseHash = null`, `createdAt = now`, `expiresAt = now + 24h` |

**Cache MISS with concurrent-insert race:** unchanged — PK violation on `idempotency_keys.key` swallowed; first commit wins; handler side-effects already committed in `next()`.

## Test-Owned Fixture

Per the plan, `phase4-seed.ts` does NOT expose `upcomingTournamentEventId`. The integration test plants its own future-tournament event in `beforeAll`:

- `event_type = 'event_type_tournament'`
- `starts_at = +1h from test start`
- `ends_at = +2h from test start`
- One `calendar_event_participants` row for `fixtures.users.player`
- One `tournaments` row with `city='Brussels', country='BE', age_category_code='age_senior', tournament_type_code='tournament_belgium'`

Owning the fixture inside the test keeps `phase4-seed.ts` unchanged (no Wave 5 sibling-plan conflict surface) and the assertion is self-contained.

## Pinned Fixture API

Per the plan interfaces block — confirmed in `tests/fixtures/phase4-seed.ts` and `tests/helpers/trpc.ts`:

- `fixtures.users.{player,trainer,technical_director,...}` — flat dict by role string, NOT `fixtures.player1` / `fixtures.player2`
- `appCaller({ userId, role })` from `tests/helpers/trpc.ts` — NOT `fixtures.makeCtx(user)`
- `seedPhase4(dbHandle.db, { includeTournamentResults: false })` — accepts opts object, returns `Phase4SeededFixtures`
- `freshDb()` returns `{ db, sql, [Symbol.asyncDispose] }` from `tests/helpers/db.ts`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Missing dependency] Inlined `canConnect` instead of importing from `./_helpers`**

- **Found during:** Task 3 (test file creation)
- **Issue:** Plan acceptance criterion says "File imports `canConnect, freshDb` from `./_helpers`" — but `tests/integration/_helpers.ts` is owned by Plan 04-10's Task 0 (sibling Wave 5 plan running in a separate worktree). At authoring time the barrel does not exist in this worktree, so the import would fail typecheck and the test file would not compile.
- **Fix:** Inlined `canConnect()` using the same exact pattern as the existing `tests/integration/idempotency-tournament.test.ts`. `freshDb` is imported directly from `../helpers/db` (the underlying source). When Plan 04-10 lands `_helpers.ts` on main, this file can be refactored to use the barrel — the test logic remains identical.
- **Files modified:** tests/integration/idempotency-input-binding.test.ts
- **Commit:** d8e7714
- **Rationale:** Plan explicitly acknowledges this coupling: "All 4 wave-5 plans (10, 11, 14, 16) ship in the same wave, but `_helpers.ts` is owned by Plan 04-10 — sibling tests reference it freely (no compile coupling between plans since they each ship their own test file)." The acknowledgement is correct that the test FILES are independent, but the import would still fail at typecheck time. Inlining preserves the test's behavioural contract; the import-style refactor is bookkeeping.

### Worktree Bootstrapping

The worktree was created without `node_modules`. To run `pnpm typecheck` / `pnpm test`, symlinked `node_modules` from the main repo. This is a worktree-only artifact (gitignored) and not committed.

## Authentication Gates

None. Plan was fully autonomous.

## Migration Push Status

Deferred to Plan 04-14's `pnpm db:push --force` batch (per the plan's "Coordinating migration numbering" section). Plan 04-11 (this plan), 04-14 (Concern E — system_inbox INSERT policy + dedup) all touch additive Drizzle DDL only — 0021 + 0022 + 0023 land together when the gap-closure batch merges to main. The integration test (Task 3) skip-gates handle the unpushed-DB case gracefully (all 4 it-blocks skip cleanly when no DB is reachable).

## Verification Results

All plan verification checks pass:

| # | Check | Result |
| ---- | ---- | ---- |
| 1 | `request_hash` count in 0021 SQL | 5 occurrences (≥ 2 required) |
| 2 | `requestHash:` in schema barrel | 1 (exact) |
| 3 | `errors.idempotency.inputMismatch` in nl.json | 1 |
| 4 | `inputMismatch` in en.json | 1 |
| 5 | `inputMismatch` in fr.json | 1 |
| 6 | `canonicaliseJson` in middleware | 4 (definition + 3 references) |
| 7 | `pnpm test tests/unit/i18n-catalog-completeness.test.ts` | PASS |
| 8 | `pnpm test tests/unit/idempotency-middleware.test.ts` | PASS (3 it.todo + 1 export check) |
| 9 | `pnpm test tests/unit/migration-format.test.ts` | PASS (29 tests including 0021 manifest assertion) |
| 10 | `pnpm typecheck` exit code | 0 (zero new errors) |
| 11 | `pnpm test tests/integration/idempotency-input-binding.test.ts` (no DB) | 4 skipped cleanly |
| 12 | `pnpm test tests/integration/idempotency-tournament.test.ts` (regression) | PASS (3 tests skip without DB) |

## Confirmation: response_hash remains v2-reserved (WR-08)

The plan and 04-REVIEW.md §WR-08 specify that `response_hash` is reserved for future v2 response-tamper detection (not response binding — that is now `request_hash`'s job). This contract is preserved:

- Migration 0021 does NOT rename, drop, or modify `response_hash`.
- Schema barrel declares `responseHash: text('response_hash')` unchanged (column name + nullability), with the comment updated to "v2-reserved for response-tamper detection (WR-08)".
- Middleware still writes `responseHash: null` on insert (intentional — v2 will compute and persist this).

WR-08 stays deferred to Phase 5+ per 04-REVIEW.md §WR-08 ("Once CR-02 is implemented, repurpose `response_hash` to `request_hash` OR add a separate `request_hash` column. Mark `response_hash` as `null`-by-default deferred."). We took the "add a separate column" branch.

## Threat Model Coverage

| Threat ID | Disposition | Implementation |
| ---- | ---- | ---- |
| T-04-CR02-01 (Tampering — cache HIT replay-different-input) | mitigated | `hashInput(raw)` compared against `storedRequestHash`; mismatch → TRPCError CONFLICT |
| T-04-CR02-02 (Spoofing — predictable client keys WR-14) | accept-with-test | Hash binding is layered defense; even predicted keys cannot replay a different write. WR-14 fallback cleanup deferred to Phase 5/8 |
| T-04-CR02-03 (Information disclosure — CONFLICT vs MISS timing) | accept | Both paths read the same row; timing difference is the network round-trip cost only |
| T-04-CR02-04 (Repudiation — legacy null-hash bypass) | accept | Documented in middleware comment + migration comment; 24h TTL purges legacy rows naturally |
| T-04-CR02-05 (DoS — canonicaliseJson on large input) | accept | tRPC HTTP transport already caps payload size; sha256 on bounded input is O(n); hash compute time << DB round-trip |

## Commits

| # | Hash | Message |
| ---- | ---- | ---- |
| 1 | 19aef34 | feat(04-11): add request_hash column for idempotency input binding (CR-02) |
| 2 | 2921465 | feat(04-11): bind idempotency cache to canonicalised input hash (CR-02) |
| 3 | d8e7714 | test(04-11): integration probe for idempotency input binding (CR-02) |

## Self-Check: PASSED

All files referenced in this SUMMARY exist on disk; all commits referenced are present in git history (verified post-commit). No items are missing.
