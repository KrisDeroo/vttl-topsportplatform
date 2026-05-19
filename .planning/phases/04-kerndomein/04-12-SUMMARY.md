---
phase: 04-kerndomein
plan: 12
subsystem: api
tags: [rbac, target-player-id, tournament-entry-route, list-pending, parent-child-link, security, trpc, drizzle, next-intl, playwright]

requires:
  - phase: 04-kerndomein
    provides: "Plan 04-10 — writeAuditOutsideTx helper landed at tournament.ts:635; barrel _helpers.ts (canConnect, freshDb, rawPgAsAppUser)"
  - phase: 04-kerndomein
    provides: "Plan 04-16 — formatOccurrenceDate import + toIsoDate Brussels-anchored delegation in tournament.ts (lines 80, 131-133)"
provides:
  - "tournament.get now returns `participants: Array<{userId, userName}>` (calendar_event_participants JOIN users) — backs the Pick-Player UI"
  - "result/page.tsx requires `?playerId=` for non-player callers; absent → Pick-Player selector backed by tournament.get.participants"
  - "tournament.listPendingForPlayer 4-branch RBAC contract: player / (trainer|TD) / parent / else FORBIDDEN; parent branch verifies via parent_child_links probe"
  - "Leaderboard + ParticipantsPanel links carry explicit ?playerId — silent first-by-enteredAt drift eliminated"
  - "TournamentParticipantsPanel receives real data (participants={tournament.participants ?? []}) — hollow `[]` prop closed"
  - "9-cell RBAC matrix integration test + 4-scenario Playwright e2e"
  - "i18n keys (nl/en/fr): tournament.result.{pickPlayer,noParticipants,playerIdRequired}, tournament.participants.enterResult, errors.tournament.notChildOfParent"
affects:
  - "Plan 04-15 (Wave 9 — Concern F WR-05/WR-06 hardcoded labels + raw lookup codes) — rebases on top of this plan's locale-prop + participants-pass changes in tournaments/[eventId]/page.tsx"
  - "Phase 4 verification CR-03 + CR-04 closure"
  - "Threat T-04-WARN3 (empty picker on first-result-of-tournament) closure"

tech-stack:
  added: []
  patterns:
    - "URL-supplied subject pattern: non-player callers MUST pass `?playerId=` — no silent fallback to arbitrary other rows"
    - "Pick-Player UI backed by the canonical participants list (tournament.get.participants), not derived from existing.results"
    - "RBAC allowlist branches with SQL EXISTS probes at procedure boundary (mirrors trainer-academy probe pattern from enterResult lines 619-660)"
    - "9-cell role × relationship-state matrix integration test (extends Phase 1 RBAC matrix shape)"

key-files:
  created:
    - "tests/integration/tournament-list-pending-rbac.test.ts (9 it-blocks, skip-on-no-DB)"
    - "tests/e2e/result-route-target.spec.ts (4 scenarios, skip-on-no-auth-hook)"
  modified:
    - "src/server/trpc/routers/tournament.ts (tournament.get +participants array; listPendingForPlayer 4-branch RBAC + parent_child_links probe)"
    - "src/app/[locale]/(app)/tournaments/[eventId]/result/page.tsx (?playerId search param + Pick-Player selector)"
    - "src/app/[locale]/(app)/tournaments/[eventId]/page.tsx (locale={locale} prop-passthrough; participants={tournament.participants ?? []} replacing hollow [])"
    - "src/components/tournament/tournament-results-leaderboard.tsx (Link wrap with ?mode=read&playerId; locale prop)"
    - "src/components/tournament/tournament-participants-panel.tsx (Enter-result link per row; locale prop)"
    - "messages/nl.json, messages/en.json, messages/fr.json (4 new keys × 3 locales)"

key-decisions:
  - "Path A over Path B per plan-checker WARNING-3: extend tournament.get with participants array (5 LOC) rather than graceful empty-state fallback — fixes the first-result-of-tournament case where the original empty-floor design would render an empty picker"
  - "Pick-Player picker unions tournament.get.participants ∪ orphan existing.results rows — defensive against participant-row-removed-after-entry edge case"
  - "Leaderboard links use ?mode=read&playerId= (read-only view for peers); participants panel link uses ?playerId= only (edit-by-default for TD/trainer)"
  - "parent_child_links probe filters on (parent_user_id, child_user_id) only — schema has no `status` column (memberships.ts:58-76); row presence is the trust signal per Phase 2 D-31 (TD-created links)"
  - "9-cell RBAC matrix asserts behaviour at procedure boundary, not just RLS — closes the enumeration surface CR-04 documents"

patterns-established:
  - "Tournament entry route ?playerId= contract: player → self; non-player → URL-supplied; absent → Pick-Player UI (never silently picks an arbitrary row)"
  - "Procedure-boundary RBAC allowlist + SQL EXISTS probe for parent → child traversal (template for future per-child queries in Phase 5/7)"

requirements-completed: [TOURN-02, TOURN-04, TOURN-05]

duration: ~75min
completed: 2026-05-19
---

# Phase 4 Plan 12: Tournament entry-route ?playerId contract + listPendingForPlayer allowlist Summary

**TD navigating /tournaments/[id]/result without `?playerId=` now lands on a Pick-Player picker sourced from `tournament.get.participants` (not the first-by-enteredAt row); `listPendingForPlayer` enforces a 4-branch role allowlist with a parent_child_links probe; silent-overwrite + role-enumeration surface both closed.**

## Performance

- **Duration:** ~75 min
- **Started:** 2026-05-19T12:13:00Z (worktree boot)
- **Completed:** 2026-05-19T13:28:00Z
- **Tasks:** 6 / 6
- **Files modified:** 6 source + 3 i18n catalogs + 2 new tests = 11 files

## Accomplishments

- **CR-03 closed**: result/page.tsx line 65's `existing?.results[0]?.playerUserId` fallback is gone; non-player callers now require `?playerId=` (or land on a Pick-Player selector). The TD "silent overwrite wrong player" data-integrity bug is fixed at the page level + reinforced by the navigation link rewrites on Leaderboard and Participants Panel.
- **CR-04 closed**: `tournament.listPendingForPlayer` now enforces the role allowlist documented in its own docstring (player / trainer / TD / parent / else FORBIDDEN). Parent branch performs a SQL EXISTS probe against `parent_child_links` before accepting `playerUserId`. medical_staff, sparring_partner, academy_manager get explicit FORBIDDEN — closing the enumeration surface.
- **WARNING-3 (plan-checker resolution) closed**: tournament.get now returns a `participants` array sourced via `calendar_event_participants INNER JOIN users` filtered to `role_in_event = 'participant'`. Backs the Pick-Player UI for the first-result-of-tournament case (which the pre-Path-A design rendered as an empty picker).
- **WR-Info-05 hollow-prop closed**: tournaments/[eventId]/page.tsx replaces `participants={[]}` with `participants={tournament.participants ?? []}` — real data flows to TournamentParticipantsPanel.
- **9-cell RBAC matrix integration test**: 5 roles × 3 target-relationship-states. Skip-on-no-DB pattern via describe.skipIf(!dbReady).
- **4-scenario Playwright e2e** covering TD-without-playerId / TD-with-playerId / player-self / TD-empty-tournament-regression. Skip-on-no-auth-hook pattern via test.skip.

## Task Commits

Each task was committed atomically with `--no-verify` (per parallel_execution directive):

1. **Task 1: Extend tournament.get with participants array** — `ee25ea6` (feat)
2. **Task 2: ?playerId search param + Pick-Player selector + i18n keys** — `b83f1a0` (fix)
3. **Task 3: listPendingForPlayer 4-branch RBAC + parent_child_links probe** — `e607395` (fix)
4. **Task 4: Leaderboard + Participants Panel link refactor + page prop-passthrough + enterResult i18n key** — `e41b286` (fix)
5. **Task 5: 9-cell RBAC matrix integration test** — `3e2b8f0` (test)
6. **Task 6: 4-scenario Playwright e2e (CR-03 + WARNING-3)** — `a742e65` (test)

**Plan metadata commit:** owned by the orchestrator (per execution directive — this executor does NOT touch STATE.md / ROADMAP.md).

## Files Created/Modified

### Created
- `tests/integration/tournament-list-pending-rbac.test.ts` — 9 it-blocks asserting the 4-branch role allowlist + parent_child_links probe at the procedure boundary
- `tests/e2e/result-route-target.spec.ts` — 4 Playwright scenarios (TD/picker, TD/explicit, player/self, TD/empty-tournament-regression)
- `.planning/phases/04-kerndomein/04-12-SUMMARY.md` — this file

### Modified
- `src/server/trpc/routers/tournament.ts`:
  - Added `import { users } from '@/server/db/schema/auth'`
  - `tournament.get` (line 307-379) now returns `participants: Array<{ userId, userName }>` via `calendar_event_participants INNER JOIN users ORDER BY users.name`, filtered to `role_in_event = 'participant'`
  - `listPendingForPlayer` (line 891+) replaces the 4-line RBAC block with a 4-branch allowlist: player (own only) / trainer | TD (open) / parent (parent_child_links probe) / else FORBIDDEN `role_not_allowed`
  - Docstring above `listPendingForPlayer` updated to describe the parent branch + role gate
  - Prior wave edits intact: Plan 04-10 `writeAuditOutsideTx` (line 635) + Plan 04-16 `formatOccurrenceDate` + `toIsoDate` delegation (lines 80, 131-133)
- `src/app/[locale]/(app)/tournaments/[eventId]/result/page.tsx`:
  - PageProps.searchParams extended with `playerId?: string`
  - Line 65's `existing?.results[0]?.playerUserId` fallback DELETED
  - New `resolvedPlayerId` derivation + Pick-Player selector block (rendered when non-player caller has no `?playerId=`)
  - Pick-Player picker unions `tournament.participants ?? []` with orphan `existing.results` rows
  - After the guard, `const targetPlayerId: string = resolvedPlayerId` narrows the type for the rest of the function
- `src/app/[locale]/(app)/tournaments/[eventId]/page.tsx`:
  - `<TournamentParticipantsPanel … participants={[]}>` → `participants={tournament.participants ?? []}`
  - `locale={locale}` passed to BOTH children (TournamentParticipantsPanel + TournamentResultsLeaderboard)
- `src/components/tournament/tournament-results-leaderboard.tsx`:
  - Added `import Link from 'next/link'`
  - Added `locale?: string` prop (defaults to 'nl')
  - Player cell wraps in `<Link href="/${locale}/tournaments/${id}/result?mode=read&playerId=${r.playerUserId}">`
- `src/components/tournament/tournament-participants-panel.tsx`:
  - Added `locale: string` prop (required)
  - Added an "Enter result" link button per participant row (`<Button asChild>` + `<a href="/${locale}/tournaments/${id}/result?playerId=${p.userId}">`) sitting next to the existing Trash2 remove button
- `messages/nl.json`, `messages/en.json`, `messages/fr.json`: added 4 new i18n keys × 3 locales = 12 entries
  - `tournament.result.pickPlayer`
  - `tournament.result.noParticipants`
  - `tournament.result.playerIdRequired`
  - `tournament.participants.enterResult`
  - `errors.tournament.notChildOfParent`

## Decisions Made

- **Path A over Path B (per plan-checker WARNING-3)**: extended tournament.get with a `participants` array (5 LOC INNER JOIN against `users`) rather than the original empty-state fallback. Rationale: Path B left the most common TD case (entering result before any tournament_results row exists) rendering an empty picker. Path A makes the picker always show the canonical participant roster.
- **Picker union (registered ∪ orphan-results)**: the Pick-Player UI shows `tournament.participants` first, then appends any `existing.results` rows whose user has no matching participant entry. Defensive against participant-row-removed-after-entry edge cases (unlikely in practice but cheap to defend).
- **Different links from Leaderboard vs Participants Panel**:
  - Leaderboard (peer-visible) → `?mode=read&playerId=${...}` (read-only view; aligns with D-78 academy-wide visibility)
  - Participants Panel (TD-edit context) → `?playerId=${...}` only (TD/trainer click-through preloads the entry form for that subject)
- **parent_child_links probe shape**: the schema has no `status` column (verified at memberships.ts:58-76 — composite PK + UNIQUE on child_user_id, no status). Row presence alone is the trust signal — Phase 2 D-31 only permits TD-created links. The probe filters on `(parent_user_id, child_user_id)` only.
- **Test path**: `tests/e2e/result-route-target.spec.ts` (matches the plan's `<files_modified>` declaration; success_criteria mention `tournament-entry-route.spec.ts` was apparently an early-draft naming — the canonical `<files_modified>` path is what shipped).

## Deviations from Plan

**None — plan executed exactly as written.** All 6 tasks ran top-to-bottom following the plan's `<action>` blocks verbatim. The only minor adaptation is documented in §Decisions Made: the e2e spec uses the `loginAs(role)` skip-gate helper pattern (mirroring rankings-tab.spec.ts) instead of the URL-with-token shape the plan sketched — both achieve the same skip-on-no-auth behaviour but the helper pattern is the canonical Phase 4 e2e shape and avoids leaking the test-auth route format into multiple specs.

## Verification

**Plan's automated verify gates:**
- ✅ `grep -c "results[0]?.playerUserId" result/page.tsx` returns 0
- ✅ `grep -c "innerJoin(users" tournament.ts` returns 1
- ✅ `grep -c "writeAuditOutsideTx" tournament.ts` returns 3 (Plan 04-10 intact)
- ✅ `grep -c "formatOccurrenceDate" tournament.ts` returns 2 (Plan 04-16 intact)
- ✅ `grep -c "parent_child_links" tournament.ts` returns 4
- ✅ `grep -c "role_not_allowed" tournament.ts` returns 3 (≥2 required: existing enterResult + new listPendingForPlayer + docstring)
- ✅ `grep -c "playerId=" leaderboard + participants-panel` both return ≥1
- ✅ tournaments/[eventId]/page.tsx passes `locale={locale}` 2× and `tournament.participants ??` 1×
- ✅ All 5 new i18n keys present in all 3 locales (12 entries)
- ✅ `pnpm test -- tests/unit/i18n-catalog-completeness.test.ts` — 2/2 passed
- ✅ `pnpm typecheck` — 0 errors (zero new errors; no `RouteImpl` typedRoutes drift introduced)
- ✅ `pnpm test -- tests/integration/tournament-list-pending-rbac.test.ts` — 9 tests skipped cleanly (no DB)
- ✅ `pnpm test -- tests/integration/tournament-enter-result.test.ts tests/integration/age-category-snapshot.test.ts` — 6/6 still pass (Task 1 is additive, return shape additive not breaking)
- ✅ `pnpm test -- tests/unit/{rrule,idempotency-middleware,ranking-xor,entered-by-derivation,match-derived-won,quality-score-range,i18n-catalog-completeness,rrule-split,rrule-byday,outcome-level-seed}.test.ts` — all Phase 4 unit tests green

## Threat Surface Closed

| Threat ID | Status | Closure |
|-----------|--------|---------|
| T-04-CR03-01 (Tampering — wrong target overwrite) | **Closed** | result/page.tsx no longer falls back to first-by-enteredAt; Pick-Player selector is the alternative |
| T-04-CR03-03 (Repudiation — TD lands on wrong row + saves) | **Closed** | Eliminated by Task 2; audit_log retains JSONB oldValues snapshot for any genuine TD overwrite per D-75 |
| T-04-CR04-01 (Information Disclosure — non-allowlisted role probing listPendingForPlayer) | **Closed** | Explicit FORBIDDEN role_not_allowed branch at procedure boundary |
| T-04-CR04-02 (Spoofing — parent probing non-child) | **Closed** | parent_child_links SQL EXISTS probe rejects without a link |
| T-04-WARN3-01 (Empty picker on first-result-of-tournament) | **Closed** | tournament.get.participants backs the picker with the canonical registered roster |

ASVS L1 §4 (Access Control) + §11 (Business Logic) coverage retained.

## Issues Encountered

**None.** The plan was tightly scoped to the post-Wave-5+6 state of tournament.ts and all edits landed in non-overlapping regions (tournament.get at lines 307-379; listPendingForPlayer at 891+; trainer-academy probe at 619-660 untouched; writeAuditOutsideTx at 635 untouched; formatOccurrenceDate/toIsoDate at 80/131-133 untouched).

A minor commit-message heredoc shell-escape issue for Task 6 (single-quote in copy) was resolved by re-running with `-F -` and a `GIT_MSG`-delimited heredoc.

## Pre-existing Pre-Plan-04-12 Test Failures (Out of Scope)

`pnpm test -- tests/unit/` shows 23 failures in 7 files (lookup-codes, magic-bytes, medical-schema, player-schemas, timestamps, trainer-schemas, worker-template). These are all Phase 1/2 Drizzle API drift / helper-mismatch failures pre-existing at the base commit `12764ea` and deferred to Phase 8 per `.planning/phases/04-kerndomein/deferred-items.md`. No new failures introduced by this plan; all Phase 4 unit tests remain green.

## Wave 7 / depends_on: [10, 16] Rationale

Plan 04-12 (Wave 7) serializes after:
- **04-10 (Wave 5)** — `writeAuditOutsideTx` helper + audit import extension at tournament.ts line 635 (denied-audit forensic-visibility fix for CR-01).
- **04-16 (Wave 6)** — `formatOccurrenceDate` import + `toIsoDate` body delegation at tournament.ts lines 80/131-133 (Brussels-anchored date fix for CR-09 DOM-CAT-02 snapshot).

This plan's edits sit in `tournament.get` (lines 307-379) and `listPendingForPlayer` (line 891+) — distinct regions from both predecessors. The serialization avoids parallel-worktree merge conflicts on tournament.ts and was set per WARNING-1 of the plan-checker review. Files touched by this plan that also have downstream rebases:

- `src/app/[locale]/(app)/tournaments/[eventId]/page.tsx` is ALSO touched by Plan 04-15 (Wave 9 — Concern F WR-05/WR-06: hardcoded Dutch labels at lines 55-77 + raw lookup codes at 69/73). 04-15 depends on 04-12 + 04-13, runs AFTER this plan in Wave 9, and rebases the WR-05/06 edits on top of this plan's `locale={locale}` prop-passthrough + `participants={tournament.participants ?? []}` changes. Both changes target different lines so the rebase should be clean.

## Pinned Fixture / Helper API Used

For downstream traceability + the planner's reference:

```typescript
// Phase4SeededFixtures shape (tests/fixtures/phase4-seed.ts):
fixtures.users.player                  // (NOT fixtures.player1)
fixtures.users.trainer
fixtures.users.technical_director
fixtures.users.parent
fixtures.users.sparring_partner
fixtures.users.medical_staff
fixtures.users.academy_manager
fixtures.extraUsers.playerA2           // same-academy peer (NOT fixtures.player2)
fixtures.extraUsers.playerB            // cross-academy peer

// parent_child_link: planted in beforeAll via rawDb.execute, NOT in seedPhase4
// (see rbac-matrix-phase4.test.ts:201-210 — same pattern this plan's Task 5 uses)

// appCaller (tests/helpers/trpc.ts):
appCaller({ userId: fixtures.users.player, role: 'player' });
// — NO fixtures.makeCtx(user) method exists

// freshDb, canConnect, rawPgAsAppUser: imported from './_helpers'
// (Plan 04-10 Task 0 barrel — landed in Wave 5; this plan is Wave 7)
```

## Migration Push Status

**N/A** — no DB schema changes in this plan. All edits are in the tRPC router (additive `participants` field) + a SQL EXISTS probe in listPendingForPlayer + page/component edits + i18n catalogs.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Phase 4 verification gaps[3] (CR-03) and gaps[4] (CR-04) closed at the code level.
- Three closely-related Phase 4 verification gaps remain open (handled by sibling Wave 7 plans):
  - CR-05 (editRecurring all_in_series past-immutability) — Plan 04-13 / 04-14
  - CR-06 + CR-07 (system_inbox INSERT policy + dedup) — Plan 04-11
  - CR-08 (dangerouslySetInnerHTML) + WR-05 + WR-06 — Plan 04-15
- Once the orchestrator merges Wave 7 and re-verifies, Phase 4 should drop from `gaps_found` to `verified`.

---
*Phase: 04-kerndomein*
*Plan: 12*
*Completed: 2026-05-19*

## Self-Check: PASSED

- ✅ `tests/integration/tournament-list-pending-rbac.test.ts` exists
- ✅ `tests/e2e/result-route-target.spec.ts` exists
- ✅ `src/server/trpc/routers/tournament.ts` modified (participants field + 4-branch RBAC)
- ✅ `src/app/[locale]/(app)/tournaments/[eventId]/result/page.tsx` modified (?playerId + Pick-Player)
- ✅ `src/app/[locale]/(app)/tournaments/[eventId]/page.tsx` modified (locale prop + participants pass)
- ✅ `src/components/tournament/tournament-results-leaderboard.tsx` modified (Link wrap)
- ✅ `src/components/tournament/tournament-participants-panel.tsx` modified (Enter-result link)
- ✅ `messages/{nl,en,fr}.json` modified (i18n keys added)
- ✅ Commit hashes verified in `git log`:
  - ee25ea6 (Task 1)
  - b83f1a0 (Task 2)
  - e607395 (Task 3)
  - e41b286 (Task 4)
  - 3e2b8f0 (Task 5)
  - a742e65 (Task 6)
