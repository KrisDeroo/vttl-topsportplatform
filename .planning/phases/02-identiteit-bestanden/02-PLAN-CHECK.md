---
phase: 02-identiteit-bestanden
artifact: PLAN-CHECK
status: FAIL
verdict: Requires plan revision before execution
generated: 2026-05-12
checker: gsd-plan-checker (agent run aaa1d7d9a9b4744c5)
---

# Phase 2 Plan Verification Report

**Phase:** Identiteit & Bestanden
**Plans checked:** 16 (02-01 through 02-16)
**Mode:** Goal-backward verification against ROADMAP success criteria
**Wave layout (post-fix):** 9 waves, 0 dependency violations

## Summary

| Severity | Count |
|----------|-------|
| BLOCKER | 10 |
| WARNING | 15 |
| INFO | 7 |
| **Total** | **32** |

**Verdict:** FAIL — execution would defeat Phase 2 succescriterium #1 (BLOCKER-01) and break DOM-CAT-02 invariant for Phase 4 (BLOCKER-07).

## Coverage matrix (ROADMAP requirements → plans)

| Requirement | Covering plans | Status |
|-------------|----------------|--------|
| PLAYER-01 | 02, 03, 10, 13, 15 | Covered |
| PLAYER-02 | 02, 03, 08, 10, 13 | Covered |
| PLAYER-03 | 02, 03, 10 | Covered (separate club + academy_code columns) |
| PLAYER-04 | 02, 03, 10, 15 | Covered |
| PLAYER-05 | 05, 09, 10, 11, 12, 13, 15 | Covered |
| PLAYER-06 | 02, 03, 10, 13, 15 | Covered |
| PLAYER-07 | 05, 07, 10, 11, 13, 15 | Covered |
| TRAINER-01 | 02, 03, 07, 10, 11, 13 | Covered |
| TRAINER-02 | 02, 03, 08, 10, 13 | Covered |
| TRAINER-03 | 10, 13, 15 | Covered (academy_memberships reuse, D-35) |
| FILE-01 | 01, 04, 09, 15 | Covered |
| FILE-02 | none | See BLOCKER-02 — Phase 2 vs Phase 5 boundary ambiguity |
| FILE-03 | 05 | Covered (storage.objects policies) |
| FILE-04 | 04, 09, 15 | Covered |
| FILE-05 | none | See WARNING-04 — ROADMAP/REQUIREMENTS drift |
| VALID-01 | 04, 09, 12, 15 | Covered |
| VALID-02 | 04, 09, 15 | Covered |
| VALID-03 | 04, 09, 12, 15 | Covered |
| VALID-04 | 01, 06, 09, 15, 16 | Covered (but BLOCKER-01 silent-failure risk) |
| VALID-05 | 04, 09, 15 | Covered |
| VALID-06 | 04, 07, 09, 15 | Covered |
| DOM-CAT-01 | 02, 03, 04, 08, 10 | Covered |
| DOM-CAT-02 | 04, 10, 15 | Covered (but BLOCKER-07 breaks invariant) |
| I18N-06 | 11, 13 | Covered |
| I18N-08 | 04, 07, 11, 12, 13, 15 | Covered |

## BLOCKERS

### BLOCKER-01 — Malware-scan worker DB UPDATE silently blocked by RLS

**Plans:** 02-05 (RLS policies), 02-06 (worker)
**Severity:** BLOCKER — defeats Phase 2 succescriterium #1

The `uploaded_files_update` policy:
```sql
USING (current_user_role() = 'technical_director' OR owner_user_id = current_user_id())
WITH CHECK (current_user_role() = 'technical_director' OR owner_user_id = current_user_id())
```

The worker's `db.update(uploadedFiles)` runs as `app_user` over the pooler with RLS enabled+forced, OUTSIDE `withRlsContext` and WITHOUT setting `app.user_id` / `app.user_role` GUCs. Result: every UPDATE returns 0 rows. `scan_status` never flips from `pending` to `clean`. Every uploaded photo stays in `pending` forever. The polling UI times out into `scanTimeout`. No photo ever shows.

Plan 02-05's comment "service-role key bypasses RLS" is wrong — that key is for the Storage HTTP API, not for direct Postgres connections.

**Fix options (architectural decision required):**
1. Add a worker-scoped RLS policy gated on a `SET LOCAL app.actor = 'worker'` GUC the worker sets in a transaction.
2. Use a separate Postgres role (`worker_user`) with `BYPASSRLS` or `NOLOGIN BYPASSRLS`, via second env var `WORKER_DATABASE_URL`.
3. SECURITY DEFINER function `mark_scan_result(file_id, status, sha256, scanned_at)` callable from `app_user`.

### BLOCKER-02 — FILE-02 (medical bucket separation) Phase 2 vs Phase 5 boundary

**Plans:** none claim it
**Severity:** BLOCKER

ROADMAP §Phase 2 Vereisten lists `FILE-01..05`. CONTEXT.md §Phase Boundary defers medical work to Phase 5. The two contradict.

**Fix options (product decision):**
1. Add a minimal task to plan 02-05: storage.objects RLS for `medical/` bucket (medical_staff-only SELECT/INSERT) — guarantees FILE-02 closure in Phase 2.
2. Amend ROADMAP §Phase 2 Vereisten to `FILE-01..04` and move FILE-02 + FILE-05 explicitly to Phase 5.

### BLOCKER-03 — Plan 02-13 references nonexistent `@/lib/trpc-server`

**Plans:** 02-13 Task 4

Plan imports `import { caller } from '@/lib/trpc-server';` — file does not exist. Phase 1 canonical pattern uses `appRouter.createCaller(await createContext())` (see `src/app/[locale]/(app)/admin/users/page.tsx:35-64`).

**Fix:** Update plan 02-13 Task 4 to use Phase 1 pattern. No new file needed.

### BLOCKER-04 — Pages-Router `bodyParser` config is no-op on App Router

**Plans:** 02-09 STRIDE T-02-09-LARGE-PAYLOAD-DOS, 02-16 docs

`export const config = { api: { bodyParser: { sizeLimit: '5mb' } } };` has no effect in App Router. The Zod `.max(3 * 1024 * 1024)` IS effective. The documentation gives operators false sense of protection.

**Fix:** Remove the `export const config = …` snippet. Document the real pattern: proxy-level limit (Coolify/Caddy) + Zod schema cap.

### BLOCKER-05 — `getAgeCategoryAt` no orderBy → arbitrary row returned

**Plans:** 02-04 Task 2, 02-15

`db.query.ageCategories.findMany({ where: eq(active, true) })` has no `ORDER BY`. Postgres returns rows in arbitrary order. Plan 02-15 even softens the test assertion to `expect(['age_unknown', 'age_minor']).toContain(r.code)` to accommodate the bug.

**Fix:** Add `orderBy: (t, { asc }) => [asc(t.sortOrder)]`. With `age_unknown` at sort_order=99 (last), strict ASC correctly evaluates it last. Tighten the test assertion to a single deterministic expectation.

### BLOCKER-06 — `as unknown as string` double-casts in age helpers

**Plans:** 02-04 Task 2

`lte(ageCategoryHistory.effectiveFrom, dateIso as unknown as string)` — Drizzle 0.40 accepts `Date` directly for `date` columns. Double-cast is a smell that the executor will improvise.

**Fix:** Pass `Date` objects directly. Remove `as unknown as string` casts. Verify with `tsc --noEmit`.

### BLOCKER-07 — Inaugural `age_category_history.effective_from = DOB` breaks DOM-CAT-02

**Plans:** 02-10 `player.create`

Plan sets `effectiveFrom = input.dateOfBirth.toISOString().slice(0, 10)`. For a player born 2010-06-15 created today, the history row claims they have been in their current age_category since 2010-06-15 — wrong. Tournament-time category queries (Phase 4) would return today's category for any historical tournament. Breaks DOM-CAT-02 invariant ("Tournament category validation uses player's category as of the tournament's start date").

**Fix:** Set `effectiveFrom = today` (player creation date in YYYY-MM-DD). Add 02-15 unit test asserting inaugural row's `effectiveFrom` ≠ DOB.

### BLOCKER-08 — ESLint `no-restricted-imports` scope contradicts itself

**Plans:** 02-13 Task 5

Plan globs `src/components/**/*.tsx` + `src/app/**/*.tsx` but its own acceptance_criteria says "must exclude Server Components — scope to `src/components/**/*.tsx` ONLY".

**Fix:** Lock the rule to `src/components/**/*.tsx`. Drop `src/app/**/*.tsx` from the glob.

### BLOCKER-09 — Plan 02-02 verify gate uses broken `node -e require(.ts)` pattern

**Plans:** 02-02 Task 5

`node -e "require('./src/server/db/schema').xyz"` cannot resolve `.ts` at runtime. Verify gate is broken; executor will improvise.

**Fix:** Replace with `npx tsc --noEmit` + `grep -E "export \*|ageCategoryHistory" src/server/db/schema/index.ts`.

### BLOCKER-10 — `players.is_minor` denormalised flag not refreshed on age-crossing

**Plans:** 02-02 (CHECK constraint), 02-10 (create/updateAsTd recompute; updateSelf does not touch DOB)

A 17-year-old created last year has `is_minor=true`. They turn 18 today. Nothing flips the flag. Downstream consumers (parent permissions, consent flow, future medical visibility) treat them as a minor incorrectly.

CONTEXT.md Pitfall 2 flags this risk; plans defer without acknowledging.

**Fix options (architectural decision required):**
1. Phase 8 daily cron sweep recomputing `is_minor` for all players (documented now, implemented Phase 8).
2. Replace denormalised `is_minor` column with a `current_is_minor(player_id)` SQL function used by RLS/policy paths.
3. Computed/generated column based on DOB and `now()` (Postgres 12+ generated columns are STORED only; not viable for time-dependent computation — actually NO, this option is invalid because generated columns can't reference `now()`).

## WARNINGS

### WARNING-01 — Plan 02-15 (tests) vs Wave-0 RED-on-day-one rhetoric contradiction

02-15 in wave 8, but plan text says "Wave-0 RED-on-day-one". Pick one: (a) drop the rhetoric, keep regression coverage at wave 8 (current), or (b) split: empty test scaffolding in Wave 0, full assertions in Wave 8.

### WARNING-02 — `players_visible_to()` may not return Phase 2 players

The function joins on `academy_memberships pa WHERE pa.role = 'player'`. Plan 02-10 `player.create` does NOT insert into `academy_memberships`. Phase 2 players will be invisible to trainers via the policy.

**Fix:** Either (a) `player.create` also inserts an `academy_memberships(user_id, academy_code, role='player')` row in the same transaction, OR (b) update `players_visible_to()` to query from `players.academy_code` instead.

### WARNING-03 — Potential N² in `players_select` RLS policy

Per-row `IN (SELECT … FROM players_visible_to(...))` may degrade. ROADMAP §RISK-RLS-PERF flags this. Add a loadtest in 02-15 covering ~500 players / ~50 trainers.

### WARNING-04 — FILE-05 ROADMAP/REQUIREMENTS drift

REQUIREMENTS.md line 351 → Phase 5. ROADMAP line 173 → Phase 2. Plans correctly defer (no plan claims it). Reconcile docs.

### WARNING-05 — Missing `players.fields.gender.*` i18n keys in plan 02-11

Plan 02-13 expects them; plan 02-11 doesn't add them. Add `male` / `female` / `x` keys for nl/en/fr.

### WARNING-06 — PhotoUpload `String.fromCharCode` loop is O(n²)

For a 2 MB file: ~200ms UI freeze. Use `FileReader.readAsDataURL` + slice off the prefix (already used for preview anyway).

### WARNING-07 — `(ctx.db as DbClient | undefined) ?? rawDb` fallback may bypass RLS

If `ctx.db` field name in Phase 1 is not exactly `db` (e.g. `dbTx`), the cast falls through to `rawDb` (pool handle, not RLS-bound). Verify Phase 1 ctx shape; drop the fallback.

### WARNING-08 — `file.upload` orphan-row tolerated until Phase 8

Storage upload failure leaves DB row at `pending` forever. Wrap INSERT+upload in try/catch with `db.delete(...)` on failure to make orphan transient.

### WARNING-09 — Brittle `grep -q "X = 60 \* 60"` verify gates

Loosen to value-based checks or runtime assertions.

### WARNING-10 — ClamAV concurrency=5 may exceed daemon throughput

Drop to 2 for Phase 2; raise later when load profile known.

### WARNING-11 — Plan 02-13 `redirect to /players` missing locale prefix

Phase 1 uses `redirect(\`/${locale}/...\`)`. Update plan 02-13 Task 4.

### WARNING-12 — `expiresAt: Date` may serialise as string without superjson

Verify Phase 1 superjson config in 02-09 task. If absent, return `expiresAtIso: string`.

### WARNING-13 — `player.updateSelf` audit captures only `updatedAt` — useless for forensics

Capture `changedFields: ['street', 'phone']` (field names, not values) for GDPR-04 accountability.

### WARNING-14 — `file.delete_storage_failed` audit may be lost if `writeAudit` itself throws

Wrap failure-audit in try/catch with pino warn fallback.

### WARNING-15 — DIRECT_DATABASE_URL not revoked after migration

Plan 02-14 should add a step: remove DIRECT_DATABASE_URL from runtime containers after migration. Document in 02-16.

## INFO

- INFO-01: `lookups.ageCategory.*` keys camelCase — consistent. No action.
- INFO-02: Avatar list initials-fallback is intentional N+1 avoidance. Document in summary.
- INFO-03: EICAR-as-PNG fixture builder referenced but no plan creates it. Add task to 02-15 or accept skipped e2e.
- INFO-04: `MAX_PROFILE_PHOTO_BYTES` duplicated across 02-04, 02-09, 02-12, 02-07. Single source of truth deferred.
- INFO-05: `--> statement-breakpoint` markers — consistent with Phase 1 examples.
- INFO-06: SERIALIZABLE in `setAgeCategory` — no tRPC retry documented; deferred (low traffic).
- INFO-07: `mode='parent'` player edit form lacks a parent-editing-child label; cosmetic.

## Next steps

1. Resolve BLOCKER-01 (worker RLS), BLOCKER-02 (FILE-02 boundary), BLOCKER-10 (is_minor strategy) — architectural decisions for user.
2. Apply mechanical fixes for BLOCKER-03..09 (plan-text edits only).
3. Apply warning fixes that are mechanical (WARNING-04..15).
4. Re-run plan-checker.
5. Commit revised plans.
6. Proceed to `/gsd-execute-phase 2`.

---

## Second-pass review (post-fixes)

**Re-checker:** gsd-plan-checker (second-pass)
**Date:** 2026-05-12
**Scope:** Verify the 10 BLOCKERs from the first pass are correctly resolved and check for regressions introduced by the fixes themselves.

### Summary

| Severity | Count |
|----------|-------|
| BLOCKER (new/unresolved) | 3 |
| WARNING (new/regression) | 4 |
| INFO | 1 |
| **Total new** | **8** |

**Verdict:** FAIL — revisions required before execution. Three BLOCKERs survived the fix pass (BLOCKER-06 partial application + BLOCKER-09 broken verify gate). The other 7 original BLOCKERs are correctly resolved.

### BLOCKER fix audit

| ID | Status | Notes |
|----|--------|-------|
| BLOCKER-01 (worker RLS) | RESOLVED | `mark_scan_result()` SECURITY DEFINER fn declared in 02-05 §Section 7 with status whitelist, idempotency guard, EXECUTE granted to app_user, REVOKE FROM PUBLIC, pinned `search_path`. 02-06 calls it via raw SQL; never touches `db.update(uploadedFiles)`. Rollback drops the fn in correct order. sha256 + updated_at columns added to schema in 02-02. |
| BLOCKER-02 (FILE-02 boundary) | PARTIAL | ROADMAP.md updated (FILE-02 + FILE-05 moved to Phase 5). But REQUIREMENTS.md line 348 still says `FILE-02 \| Phase 2`. Docs drift remains — see WARNING-2A. |
| BLOCKER-03 (trpc-server import) | RESOLVED | 02-13 interfaces block + read_first now reference Phase 1's `appRouter.createCaller(await createContext())` pattern. |
| BLOCKER-04 (bodyParser no-op) | RESOLVED | 02-09 STRIDE T-02-09-LARGE-PAYLOAD-DOS rewritten (Zod cap + Caddy + rate-limit layers). 02-16 docs now document the App Router reality explicitly with the Caddy snippet. |
| BLOCKER-05 (no orderBy) | RESOLVED | 02-04 `deriveAgeCategory` adds `orderBy: (t, { asc }) => [asc(t.sortOrder)]`. 02-15 includes a test that asserts findMany was called with orderBy (throws if missing) and tightens the `age_minor` deterministic outcome. |
| BLOCKER-06 (type casts) | **NOT FULLY APPLIED** | Cleared in 02-04 and `player.create`, but **5 casts remain in 02-10**: lines 461, 649, 756 still use `dateOfBirth: ...toISOString().slice(0,10) as unknown as string` in `player.updateAsTd`, `trainer.create`, `trainer.updateAsTd`; line 661 still uses `as unknown as typeof trainers.$inferInsert`. The fix narrative claimed "all casts removed". See NEW-BLOCKER-A. |
| BLOCKER-07 (effective_from=DOB) | RESOLVED | 02-10 `player.create` uses `effectiveFrom = todayIso` with an explicit comment block citing DOM-CAT-02 invariant. 02-15 has the unit test asserting `effectiveFrom === '2026-05-12'` and `!== '2010-06-15'`. |
| BLOCKER-08 (ESLint scope) | RESOLVED | 02-13 Task 5 ESLint rule scoped to `src/components/**/*.tsx` only. Inline comment explains why `src/app/**/*.tsx` is excluded. Verify gate matches. |
| BLOCKER-09 (broken verify) | **REGRESSION** | The replacement verify is itself broken: (a) greps for `export * from './age-categories'` but there is no separate `age-categories.ts` file — `ageCategories` lives in `lookups.ts`; (b) writes a tsx temp file to `/tmp/__schema_check.ts` then runs `npx tsx /tmp/__schema_check.ts` which uses `import * as schema from './src/server/db/schema/index'` — that relative path resolves to `/tmp/src/...` (does not exist). See NEW-BLOCKER-B. |
| BLOCKER-10 (is_minor drift) | RESOLVED | 02-16 deployment.md §"Phase 8 cron sweeps" documents `recompute_player_minor_flags()` with full SQL fn body + nightly cron schedule, deferred to Phase 8 with rationale why Phase 2 stance (create/update-time computation) is acceptable. |

### NEW BLOCKERS

#### NEW-BLOCKER-A — BLOCKER-06 only partially fixed in 02-10

**Plans:** 02-10 (player.updateAsTd, trainer.create, trainer.updateAsTd)

5 type casts that the fix manifest claimed to remove are still present:

| Line | Cast | Procedure |
|------|------|-----------|
| 461 | `as unknown as string` | `player.updateAsTd` |
| 649 | `as unknown as string` | `trainer.create` |
| 661 | `as unknown as typeof trainers.$inferInsert` | `trainer.create` |
| 756 | `as unknown as string` | `trainer.updateAsTd` |

The fix WAS applied to `player.create` (uses `dobIso` cleanly), but the three sibling mutations were missed. The executor will see the same "improvise toward `any`" signal that the original BLOCKER-06 flagged, plus the comment on line 497 of 02-04 ("Drizzle 0.40 binds string operands for `date` columns natively") explicitly contradicts the casts that remain in 02-10.

**Severity:** BLOCKER — same rationale as the original BLOCKER-06.
**Fix:** Replace each `... as unknown as string` with the bare string (`input.dateOfBirth.toISOString().slice(0, 10)` — Drizzle accepts strings for `date` columns). Drop the `as unknown as typeof trainers.$inferInsert` cast — the object literal already matches the inferred insert type once the dateOfBirth cast is removed.

#### NEW-BLOCKER-B — BLOCKER-09 verify gate is itself broken

**Plans:** 02-02 Task 5

The replacement verify command has two independent failures:

1. The grep `grep -qE "export \* from ['\"]\./age-categories['\"]" src/server/db/schema/index.ts` will never match. There is no `src/server/db/schema/age-categories.ts` file in Phase 2 — `ageCategories` is appended to `lookups.ts` (per 02-02 Task 2). The barrel export should be `./lookups` (which already exists from Phase 1) — not a new `./age-categories`. Verify gate fails at this grep before reaching the tsx step.

2. Even if the grep passed: the heredoc writes `/tmp/__schema_check.ts` containing `import * as schema from './src/server/db/schema/index'`. `tsx` resolves relative imports against the file's directory (`/tmp`), so this resolves to `/tmp/src/server/db/schema/index`, which does not exist. The check would fail with `Cannot find module`.

**Severity:** BLOCKER — the verify gate cannot pass; the executor either skips the gate (defeating the fix's purpose) or improvises.
**Fix:** Two options:
- (a) Drop the `./age-categories` grep entirely; rely on the existing `./lookups` (Phase 1) barrel re-export + the schema check inside the project.
- (b) Write the temp ts file INSIDE the repo (e.g., `scripts/__schema_check.ts`) so relative path resolves correctly, OR use an absolute path inside the import.
Recommend (a) + replace the tsx block with a simple `npx tsc --noEmit` over a check file kept in `scripts/` (committed once) — keeps the gate fast and robust.

#### NEW-BLOCKER-C — REQUIREMENTS.md still maps FILE-02 to Phase 2

**Docs:** REQUIREMENTS.md line 348

ROADMAP.md was correctly updated (Phase 2 Vereisten now lists only FILE-01/03/04; Phase 5 lists FILE-02 + FILE-05). But REQUIREMENTS.md line 348 still says `FILE-02 | Phase 2 — Identiteit & Bestanden | separate medical bucket/prefix`. This is the same kind of cross-document drift that produced the original BLOCKER-02 ambiguity in the first place. A future planner / verifier consulting REQUIREMENTS.md (which the orchestrator does on every phase) will re-discover this contradiction.

**Severity:** BLOCKER — the planning corpus is inconsistent; the fix is mechanical but it was not applied.
**Fix:** Update REQUIREMENTS.md line 348 to `FILE-02 | Phase 5 — Uitgebreid domein | separate medical bucket/prefix` (mirroring line 351 for FILE-05).

### NEW WARNINGS (regressions / fix-induced)

#### NEW-WARNING-1 — 02-05 acceptance criteria + rollback reference `idx 6` (should be `idx 7`)

**Plans:** 02-05 Task 1 acceptance_criteria + Task 2 rollback step 3

02-03 migration 0006 takes journal `idx 6` (Phase 1 ended at `idx 5`). 02-05 migration 0007 therefore takes `idx 7`. But 02-05 says:
- Acceptance criteria: "Migration registered in `drizzle/meta/_journal.json` as idx 6"
- Rollback step 3: "Update `drizzle/meta/_journal.json` to remove the `idx 6` entry"

Both should be `idx 7`. The action's actual journal-append code is correct (uses `journal.entries[journal.entries.length - 1].idx + 1`), so executor will produce idx=7 in the journal; only the audit text is wrong, but it will confuse the verify pass.

**Severity:** WARNING — code path correct; only the prose audit checkpoints need updating.

#### NEW-WARNING-2A — REQUIREMENTS.md FILE-02 drift (downgrade of NEW-BLOCKER-C if treated as docs-only)

Same as NEW-BLOCKER-C but if the orchestrator treats REQUIREMENTS.md as informational, this is a warning. We rate it as a BLOCKER above because the orchestrator does consume REQUIREMENTS.md for cross-validation; if your operational stance is "ROADMAP.md is the only source of truth", downgrade to WARNING. Calling it out so the user can choose.

#### NEW-WARNING-2 — 02-06 contains contradictory concurrency statements

**Plans:** 02-06

- Line 21 truths: "concurrency=2 (lowered from 5 per WARNING-10)"
- Line 385 action: `concurrency: 2,` (the actual implementation)
- Line 430 acceptance: "Same concurrency + backoffStrategy as consentWorker (Phase 1 pattern preserved)" — consentWorker has concurrency=5 per the interfaces block (line 100), so "same" is false
- Line 467 success_criteria: "Worker spawn invariant: concurrency=5, attempts=3, capped backoff"

Lines 430 and 467 contradict the actual fix. Executor working from acceptance_criteria + success_criteria would set concurrency=5 (the wrong value); executor working from the action snippet would set concurrency=2 (the right value). Ambiguity invites drift.

**Severity:** WARNING — cosmetic; the canonical source (the code block in the action) is correct. Fix: replace lines 430 and 467 with "concurrency=2 (clamd throughput; matches the truth in the frontmatter)".

#### NEW-WARNING-3 — 02-14 internal counts say "12 smoke checks" but matrix lists 13

**Plans:** 02-14 Task 1

- truths line 18: "13 smoke checks" (implicitly — lists `mark_scan_result` SECURITY DEFINER as the new check)
- action `<verify>` post-migration block: numbered 1..13 (mark_scan_result is item 13)
- verification matrix table: 13 rows
- acceptance_criteria: "All 13 smoke checks pass"
- `<verification>`: "12/12 smoke checks pass"  ← off-by-one
- success_criteria: "All 3 Phase 2 migrations live on dev/staging"  (silent on count, ok)

`<verification>` line should say "13/13".

**Severity:** WARNING — cosmetic.

#### NEW-WARNING-4 — 02-15 still says "Wave-0 RED-on-day-one" while sitting in wave 8 (carryover of original WARNING-01)

The original WARNING-01 in this report flagged the rhetoric mismatch. The fix manifest acknowledged it as deliberately deferred. Still flagging here so the user knows it survived.

**Severity:** WARNING — cosmetic.

### NEW INFO

#### NEW-INFO-1 — 02-03 audit checklist does not mention sha256 / updated_at columns

The schema fix in 02-02 added `uploaded_files.sha256` and `uploaded_files.updated_at`. Migration 0006 (02-03) is auto-generated from the TS schema by `drizzle-kit generate`, so the columns will be in the SQL automatically — no executor action needed. But 02-03's audit-the-generated-SQL block (Task 1 action) doesn't list them. The verify grep also doesn't check for them. Low-priority: the migration will be correct because the source-of-truth is the TS schema, not the plan checklist; only the audit completeness is off.

**Severity:** INFO.

### Wave layout verification (post-fix)

Re-confirmed deterministic dispatch:

| Wave | Plans | Validity |
|------|-------|----------|
| 1 | 02-01 (deps=[]), 02-02 (deps=[]) | ✓ |
| 2 | 02-03 (deps=02), 02-04 (deps=01), 02-07 (deps=02) | ✓ |
| 3 | 02-05 (deps=03), 02-06 (deps=01,02,04), 02-08 (deps=03), 02-11 (deps=[] — declared wave=3 despite no deps; harmless) | ✓ |
| 4 | 02-09 (deps=04,06,07,05), 02-10 (deps=07,05,04) | ✓ |
| 5 | 02-12 (deps=09,10,11,04) | ✓ |
| 6 | 02-13 (deps=12,11,10,09) | ✓ |
| 7 | 02-14 (deps=03,05,08,13) | ✓ |
| 8 | 02-15 (deps=14) | ✓ |
| 9 | 02-16 (deps=15,14) | ✓ |

No cycles; no forward references; all declared `wave` values consistent with `depends_on` (02-11 is the only over-declared wave, which is harmless — it could be wave=1).

### Coverage matrix (post-fix)

Still consistent with the original. FILE-02 / FILE-05 correctly out of Phase 2 scope per ROADMAP.md update. All other ROADMAP §Phase 2 Vereisten requirements remain covered by the plan set. **Exception:** REQUIREMENTS.md line 348 still claims FILE-02 ∈ Phase 2 (NEW-BLOCKER-C / NEW-WARNING-2A); fix that doc and the coverage matrix is fully coherent.

### Recommendation

3 BLOCKERs require revision before `/gsd-execute-phase 2`:

1. **NEW-BLOCKER-A (BLOCKER-06 carry-over)** — purge the 5 remaining `as unknown as` casts from 02-10 (lines 461, 649, 661, 756). Mechanical 1-line edits each.
2. **NEW-BLOCKER-B (BLOCKER-09 fix broken)** — 02-02 Task 5 verify gate. Drop the `./age-categories` grep, fix the tsx temp file's import path, or replace with a `tsc --noEmit` based check.
3. **NEW-BLOCKER-C (REQUIREMENTS.md FILE-02 drift)** — update REQUIREMENTS.md line 348 to `Phase 5`.

The 4 new WARNINGs and 1 INFO are non-blocking cosmetic / consistency cleanups that can ride with the BLOCKER fixes or be addressed in a follow-up.

After applying these 3 fixes, the plans should pass third-pass review cleanly. The architectural decisions (worker RLS, FILE-02 boundary, is_minor strategy) are all sound; the residual issues are purely mechanical drift from incomplete application of the first-pass fixes.

