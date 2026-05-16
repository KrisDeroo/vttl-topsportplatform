/**
 * Phase 4 Wave 0 — RED test stub for player 14d entry window (D-71).
 *
 * Covers D-71 + DOM-RESULT-01 SUPERSEDED-BY D-74: single 14-day window
 * for player entry/edit. After 14 days, player path returns 403 with
 * errors.tournament.entryWindowExpired. No 48h sub-clock per D-74.
 *
 * Analog: tests/integration/calendar-rrule-horizon.test.ts (boundary
 * window probe).
 *
 * RED: this test is intentionally failing until Plan 04-04 ships the
 * player-side wall check on tournament.enterResult + tournament.updateResult.
 */
import { describe, it, expect, beforeAll } from 'vitest';

import { seedPhase4 } from '../fixtures/phase4-seed';

describe('tournament entry window — D-71 player 14d window', () => {
  beforeAll(async () => {
    void seedPhase4;
  });

  it('day 7 post-tournament: player can edit own result — allowed', async () => {
    expect.fail('Not implemented: requires Plan 04-04 (player 14d window)');
  });
  it('day 14 exact: player can still edit — allowed (boundary)', async () => {
    expect.fail('Not implemented: requires Plan 04-04 (player 14d window)');
  });
  it('day 15: player FORBIDDEN with errors.tournament.entryWindowExpired', async () => {
    expect.fail('Not implemented: requires Plan 04-04 (player 14d window)');
  });

  it.todo('14d window is enforced on both create AND update — single window per D-74');
});
