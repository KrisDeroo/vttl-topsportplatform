/**
 * Phase 4 Wave 0 — RED test stub for tournament.enterResult happy path (D-69).
 *
 * Covers TOURN-03 + TOURN-04 + TOURN-05 + D-69 + D-73: player enters
 * (outcome, matches[]) atomically; mutation returns the persisted result
 * row + match rows; the row appears in tournament.listResults for the
 * caller and for academy peers (D-78).
 *
 * Analog: tests/integration/calendar-conflicts.test.ts (Phase 3 end-to-end
 * tRPC probe).
 *
 * RED: this test is intentionally failing until Plan 04-04 ships
 * tournament.enterResult + tournament.listResults.
 */
import { describe, it, expect, beforeAll } from 'vitest';

import { seedPhase4 } from '../fixtures/phase4-seed';

describe('tournament.enterResult happy path (D-69)', () => {
  beforeAll(async () => {
    void seedPhase4;
  });

  it('player enters outcome + 2 matches → both rows persisted, ids returned', async () => {
    expect.fail('Not implemented: requires Plan 04-04 (tournament.enterResult happy path)');
  });

  it.todo('result appears in tournament.listResults for the entering player (own row)');
  it.todo('result visible to trainer-in-academy (D-78 branch 3)');
  it.todo('result visible to academy peer-player (D-78 branch 5 — leaderboard energy)');
});
