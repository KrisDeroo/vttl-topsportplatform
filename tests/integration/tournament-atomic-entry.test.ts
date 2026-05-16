/**
 * Phase 4 Wave 0 — RED test stub for atomic tournament result entry (D-69, D-80).
 *
 * Covers: tournament.enterResult mutation commits {outcome, matches[]}
 * in a single PG transaction. Partial failure (e.g., one match CHECK
 * violation) must rollback the entire write — no tournament_results row
 * without ≥1 match_results row.
 *
 * Analog: tests/integration/age-category-history.test.ts (Phase 2 atomic
 * multi-table transaction shape).
 *
 * RED: this test is intentionally failing until Plan 04-04 ships
 * tournament.enterResult atomic transaction.
 */
import { describe, it, expect, beforeAll } from 'vitest';

import { seedPhase4 } from '../fixtures/phase4-seed';

describe('tournament.enterResult atomicity (D-69, D-80)', () => {
  beforeAll(async () => {
    void seedPhase4;
  });

  it('commits tournament_results + match_results in a single tx — happy path', async () => {
    expect.fail('Not implemented: requires Plan 04-04 (tournament.enterResult)');
  });

  it('rollback on partial failure: invalid match row causes the outcome row to NOT be persisted', async () => {
    expect.fail('Not implemented: requires Plan 04-04 (tournament.enterResult)');
  });

  it('rejects empty matches[] with errors.tournament.atLeastOneMatchRequired', async () => {
    expect.fail('Not implemented: requires Plan 04-04 (tournament.enterResult)');
  });

  it.todo('first-row round is derived from outcome (outcome_winner → round_final, outcome_last_4 → round_semi, etc.)');
  it.todo('emits audit code tournament_result_entered with outcome + matches snapshot');
});
