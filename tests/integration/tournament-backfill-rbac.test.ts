/**
 * Phase 4 Wave 0 — RED test stub for asymmetric backfill RBAC (D-73).
 *
 * Covers DOM-RESULT-02 + D-73: after the player's 14d wall expires,
 * trainer in the player's academy + TD can still enter/edit results on
 * the player's behalf with no wall. entered_by attribution records who
 * entered the row.
 *
 * Analog: tests/integration/rbac-matrix.test.ts (Phase 2 RBAC probe).
 *
 * RED: this test is intentionally failing until Plan 04-04 ships the
 * RBAC branching on tournament.enterResult.
 */
import { describe, it, expect, beforeAll } from 'vitest';

import { seedPhase4 } from '../fixtures/phase4-seed';

describe('tournament backfill RBAC (D-73)', () => {
  beforeAll(async () => {
    void seedPhase4;
  });

  it('trainer in player\'s academy can backfill on day 30 — entered_by = trainer', async () => {
    expect.fail('Not implemented: requires Plan 04-04 (asymmetric backfill)');
  });
  it('trainer in DIFFERENT academy FORBIDDEN on day 30', async () => {
    expect.fail('Not implemented: requires Plan 04-04 (asymmetric backfill)');
  });
  it('TD can backfill on day 365 — entered_by = td', async () => {
    expect.fail('Not implemented: requires Plan 04-04 (asymmetric backfill)');
  });

  it.todo('parent FORBIDDEN to enter result for their minor (parent has read access only)');
  it.todo('academy_manager FORBIDDEN to enter — only TD + trainer-in-academy per D-73');
});
