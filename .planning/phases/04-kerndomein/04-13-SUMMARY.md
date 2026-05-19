---
phase: 04-kerndomein
plan: 13
subsystem: calendar / recurring-edit / training-scoring
tags: [rrule, d-83, past-immutability, needs-scoring, per-occurrence, cr-05, wr-09, gap-closure]
requires:
  - 04-06 (splitRRule + formatOccurrenceDate — Brussels-anchored YYYY-MM-DD)
  - 04-10 (writeAuditOutsideTx — denied-audit-survives-rollback helper)
  - 04-12 (Wave 7 messages/*.json predecessor — serialized to avoid merge conflicts)
provides:
  - cr_05_closed
  - wr_09_closed
  - d_83_invariant_held_across_all_three_edit_scopes
  - needsScoring_per_occurrence
  - errors_calendar_cannotMoveSeriesToPast_i18n_key
affects:
  - src/server/trpc/routers/calendar.ts (editRecurring all_in_series branch + needsScoring SQL)
  - messages/{nl,en,fr}.json (errors.calendar.cannotMoveSeriesToPast)
tech-stack:
  added: []
  patterns:
    - "two-query needsScoring pipeline (participant_count per event_id + scored_count per (event_id, occurrence_date))"
    - "writeAuditOutsideTx denied-audit emission on past-immutability rejection"
key-files:
  created:
    - tests/integration/rrule-all-in-series-past-immutable.test.ts
    - tests/integration/calendar-needs-scoring-per-occurrence.test.ts
  modified:
    - src/server/trpc/routers/calendar.ts
    - messages/nl.json
    - messages/en.json
    - messages/fr.json
decisions:
  - "router-level past-startsAt check chosen over a schema refinement so the TRPCError message can carry the i18n key cleanly (Zod refinements emit a different error shape than `code: FORBIDDEN, message: errors.*`)"
  - "needsScoring fallback for one-shot trainings: when inst.occurrenceDate is null, format inst.startsAt instead — matches the shape session_participants.occurrence_date stores for non-recurring events"
  - "Wave 8 / depends_on=[10,12] confirmed: writeAuditOutsideTx (04-10) consumed, messages/*.json append (04-12) ordered serially to dodge worktree merge conflicts"
  - "Phase4SeededFixtures has NO recurringTrainingEventId — both new tests plant their own fixture in beforeAll (FREQ=WEEKLY;BYDAY=TU + dtstart 21d ago)"
metrics:
  duration_minutes: 11
  completed: 2026-05-19
  tasks_completed: 4
  files_created: 2
  files_modified: 4
  lines_added: 533
  lines_removed: 31
  it_blocks_added: 7
---

# Phase 04 Plan 13: D-83 third-scope guard + needsScoring per-occurrence — Summary

Close CR-05 (Phase 4 VERIFICATION.md gap #2) and WR-09 (REVIEW.md lines 650-685) — the two
remaining Wave-7 spillovers that blocked HUMAN-UAT #3. CR-05 ships a Brussels-anchored
past-startsAt guard on `editRecurring`'s `all_in_series` branch (the `single` and
`this_and_future` branches already had one; the third scope did not). WR-09 rewrites
the `calendar.list` needsScoring SQL so the yellow ⚠ chip overlay decides per
(event_id, occurrence_date), not per event_id. Net: 2 router edits, 3 catalog updates,
2 integration tests.

## What Changed

### CR-05 — D-83 invariant across all three `editRecurring` scopes

`src/server/trpc/routers/calendar.ts` `event.editRecurring` `all_in_series` branch
(opens at line 2022) now checks `formatOccurrenceDate(input.edits.startsAt) <
formatOccurrenceDate(new Date())` BEFORE the rrule rebuild logic. On rejection:
- `writeAuditOutsideTx(ctx, { action: 'calendar_event_recurring_updated_all',
  outcome: 'denied', newValues: { reason: 'past_immutable', newStartsAt } })`
  — the Plan 04-10 helper strips `ctx.db` so the INSERT goes through the raw pool,
  surviving the implicit rollback of the (never-opened) tx.
- `throw new TRPCError({ code: 'FORBIDDEN', message: 'errors.calendar.cannotMoveSeriesToPast' })`.

Imports were already in place (writeAuditOutsideTx from Plan 04-10's import line 75;
formatOccurrenceDate from Plan 04-06's import block at line 47), no new imports needed.

### CR-05 i18n key

`errors.calendar.cannotMoveSeriesToPast` added to all 3 catalogs:
- **nl**: "Je kunt een reeks niet naar een datum in het verleden verplaatsen — historische sessies blijven onaangetast."
- **en**: "You cannot move a series to a past date — historical sessions remain unchanged."
- **fr**: "Vous ne pouvez pas déplacer une série vers une date passée — les sessions historiques restent inchangées."

Path-disjoint from Plan 04-12's `errors.tournament.*` additions; placed in the
existing `errors.calendar.*` block after `unknownScope`. i18n-catalog-completeness
unit test still passes (2/2).

### WR-09 — needsScoring per (event_id, occurrence_date)

`src/server/trpc/routers/calendar.ts` lines 721-833 replaces the single-query
`participant_count > scored_count per event_id` aggregate with a two-query pipeline:

1. **participantStats** — `COUNT(*) FROM calendar_event_participants` per
   `event_id` (calendar_event_participants is series-level; this count is constant
   across occurrences).
2. **scoredStats** — `COUNT(*) FROM session_participants WHERE quality_score IS NOT NULL
   GROUP BY sp.event_id, sp.occurrence_date::text`. The text cast aligns with the
   Brussels-anchored YYYY-MM-DD strings the rrule expansion produces.

The instance loop then decides per chip:
```ts
const occIso = inst.occurrenceDate
  ? formatOccurrenceDate(inst.occurrenceDate)
  : formatOccurrenceDate(inst.startsAt); // one-shot training fallback
const key = `${inst.id}|${occIso}`;
const scored = scoredByEventDate.get(key) ?? 0;
if (scored < participantCount) inst.needsScoring = true;
```

This closes the false-negative (a 12-week scored series with one unscored week was
masked because `scored_count(22) >= participant_count(2)` per event-id aggregate)
and the false-positive (a brand-new recurring series with no scored rows showed
the chip on every chip — the past-only candidate filter caught most of these but
not the boundary cases). Phase-4 invariants preserved:

- Trainer scope still gated to events where caller is the session trainer
  (`trainerSessionIds` Set unchanged). TD always sees the flag.
- T-04-53 RBAC mitigation upheld: player / parent / academy_manager never get
  `needsScoring=true` — the entire branch is trainer/TD-only.
- The 14d-elapsed-window candidate filter (`candidateTrainingIds` at lines
  708-719) is unchanged — past-only chip filtering still owned upstream; the
  new code does not duplicate it.

### Integration tests

**`tests/integration/rrule-all-in-series-past-immutable.test.ts` — 4 it-blocks**

1. all_in_series + past startsAt → `FORBIDDEN errors.calendar.cannotMoveSeriesToPast`.
2. all_in_series + future startsAt → `{ ok: true }`.
3. all_in_series with no startsAt edit (title-only) → `{ ok: true }` — guard only fires when startsAt is supplied.
4. denied-audit-survives-rollback cross-check: after the FORBIDDEN throw, an `audit_log`
   row with `action='calendar_event_recurring_updated_all'`, `outcome='denied'`,
   `actor_user_id=TD`, `resource_id=recurringTrainingEventId` exists when queried
   via `rawDb` — proving writeAuditOutsideTx works correctly here too.

**`tests/integration/calendar-needs-scoring-per-occurrence.test.ts` — 3 it-blocks**

1. session trainer caller — `needsScoring=true` ONLY on the wk3 chip (7d ago, no
   session_participants rows). wk2 (14d ago, both players scored) stays false.
2. TD caller — same wk3-only positive pattern (T-04-53 trainer/TD parity).
3. player caller — `needsScoring` never true on any returned chip.

Both tests plant their own recurring fixture in beforeAll (FREQ=WEEKLY;BYDAY=TU,
dtstart 21d ago) because `Phase4SeededFixtures` does not carry a
`recurringTrainingEventId` field — the existing seed only plants the non-recurring
`pastTrainingEventId`. Brussels-anchored YYYY-MM-DD dates (`wk1Iso`, `wk2Iso`,
`wk3Iso`) are pinned via `brusselsDateISO()` and used as both fixture INSERT
keys AND assertion lookup, so no spurious match risk from clock skew between
fixture and assertion.

## Why the router-level check, not a Zod refinement

The plan offered a `editRecurringEditsSchema.refine(...)` path as an alternative.
Two reasons the router-level check is preferred:

1. **Error shape** — Zod refinements throw `ZodError` shaped as `BAD_REQUEST` with
   `path` + `message` fields. The existing past-immutable guards on `single` /
   `this_and_future` throw `TRPCError({ code: 'FORBIDDEN', message: 'errors.calendar.*' })`.
   Parity across the three scopes matters: the client form handler in
   `(app)/calendar/*` reads `error.code === 'FORBIDDEN'` to drive the
   confirmation modal; a Zod refinement would slip past that gate.

2. **i18n message customisation** — a refinement's `message` is a plain string;
   the router-level throw carries the i18n key in `error.message`, which
   `useTRPCErrorMessage` already routes through `next-intl`.

The schema continues to enforce only structural rules (endsAt > startsAt; BYDAY
requires FREQ=WEEKLY; etc.).

## Deviations from Plan

None. The plan's actions were executed exactly as written, with one minor
refinement worth calling out:

**Refinement — needsScoring one-shot training fallback.** The plan's pseudocode
read `inst.occurrenceDate` directly. For non-recurring (one-shot) trainings,
`occurrenceDate` is `null` (calendar.ts:613). I added a fallback to
`formatOccurrenceDate(inst.startsAt)` so one-shot trainings also get correct
per-chip needsScoring evaluation. This matches the shape `session_participants.
occurrence_date` stores for non-recurring events (the phase4-seed plants
`pastTrainingOccurrenceDate = pastTrainingStarts.toISOString().slice(0, 10)`
which is the same Brussels-anchored YYYY-MM-DD). Documented in the inline
comment at the lookup site. This was an automatic Rule 2 correctness
addition — without it, one-shot trainings would have lost needsScoring
entirely.

## Auth Gates

None encountered.

## Test Pass/Skip Counts

| Suite | Pass | Skip | Fail |
|-------|------|------|------|
| `tests/unit/i18n-catalog-completeness.test.ts` | 2 | 0 | 0 |
| `tests/integration/rrule-edit-scopes.test.ts` (regression check) | 7 | 0 | 0 |
| `tests/integration/rrule-all-in-series-past-immutable.test.ts` (new) | 0 | 4 | 0 |
| `tests/integration/calendar-needs-scoring-per-occurrence.test.ts` (new) | 0 | 3 | 0 |

Both new tests SKIP cleanly on the worktree (no Docker → no testcontainer);
on CI / a real DB they execute their 4+3 = 7 it-blocks.

## Threat Surface Scan

No new threat surface introduced beyond what the plan's `<threat_model>` declared:

| Threat ID | Status |
|-----------|--------|
| T-04-CR05-01 (tampering: past-startsAt on all_in_series) | mitigated — router-level check + denied audit |
| T-04-WR09-01 (info disclosure: false needsScoring=true to non-session trainer) | mitigated — trainerSessionIds gate retained |
| T-04-WR09-02 (DoS: 2 queries replace 1) | accepted — both queries are indexed lookups, bounded by date range + RLS |

No new endpoints, no new auth paths, no schema changes, no trust-boundary crossings.

## Verification Cross-Reference

| Plan §verification | Outcome |
|--------------------|---------|
| `grep -c "cannotMoveSeriesToPast" calendar.ts` returns 1 | ✓ |
| `grep -c "cannotMoveSeriesToPast" messages/{nl,en,fr}.json` = 3 total | ✓ (1 + 1 + 1) |
| `grep -c "GROUP BY sp.event_id, sp.occurrence_date" calendar.ts` returns 1 | ✓ |
| `grep -c "scoredByEventDate" calendar.ts` >= 2 | ✓ (3 hits) |
| `npx tsc --noEmit` zero new errors | ✓ |
| `npx vitest run tests/unit/i18n-catalog-completeness.test.ts` passes | ✓ (2/2) |
| With DB: 4/4 + 3/3 + existing rrule-edit-scopes regression | deferred to CI |

## Pinned Fixture API (Reference)

The integration tests use the verified Phase 4 fixture surface:

```typescript
fixtures.users.player              // (NOT fixtures.player1)
fixtures.users.trainer             // (NOT fixtures.trainer1)
fixtures.users.technical_director  // (NOT fixtures.technicalDirector)
fixtures.extraUsers.playerA2       // academy-A peer; phase4-seed plants this
                                   // (NOT fixtures.player2 — not on Phase4SeededFixtures)

appCaller({ userId, role })        // tests/helpers/trpc.ts:49
                                   // (NOT fixtures.makeCtx — that helper does not exist)

import { canConnect, freshDb } from './_helpers';  // Plan 04-10 barrel
import { db as rawDb } from '@/server/db/client';  // for audit_log SELECTs
```

## HUMAN-UAT Status

HUMAN-UAT item #3 (yellow ⚠ chip overlay) is now MECHANICALLY VERIFIABLE end-to-end:

- needsScoring fires per occurrence, not per series.
- Trainer / TD see it; player / parent / academy_manager don't.
- The integration test pins the exact wk2 + wk3 occurrence dates so a regression
  would be caught at CI time, not at UAT.

The HUMAN-UAT step remains to confirm visual fidelity in the FullCalendar chip
overlay (cosmetic — outside this plan's scope).

## Wave Lineage

| Wave | Plan | Provides | Consumed by 04-13 |
|------|------|----------|-------------------|
| 5 | 04-10 | `writeAuditOutsideTx` helper | Task 1 denied audit |
| 7 | 04-12 | `messages/*.json` namespace additions | Serialized to avoid merge conflicts |
| 8 | 04-13 | CR-05 + WR-09 closure | — |

## Commits

| Hash | Type | Description |
|------|------|-------------|
| `815c7f9` | feat | CR-05 — D-83 past-immutable guard on all_in_series + i18n key |
| `ccdca92` | refactor | WR-09 — needsScoring per (event_id, occurrence_date) |
| `0dd9f76` | test | integration probe — all_in_series past-immutable (CR-05) |
| `edf4923` | test | integration probe — needsScoring per occurrence (WR-09) |

## Self-Check: PASSED

- src/server/trpc/routers/calendar.ts: present + 1 `cannotMoveSeriesToPast` + 1 `GROUP BY sp.event_id, sp.occurrence_date` + 3 `scoredByEventDate`.
- messages/nl.json + en.json + fr.json: each contains 1 `cannotMoveSeriesToPast`.
- tests/integration/rrule-all-in-series-past-immutable.test.ts: present, 4 it-blocks, vitest collected 4 tests (skipped without DB).
- tests/integration/calendar-needs-scoring-per-occurrence.test.ts: present, 3 it-blocks, vitest collected 3 tests (skipped without DB).
- All 4 commits findable in `git log --oneline`.
- `npx tsc --noEmit` clean.
- No STATE.md / ROADMAP.md modifications (per parallel-execution mandate).
