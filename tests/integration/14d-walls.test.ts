/**
 * Phase 4 Wave 0 — RED test stub for 14-day walls (D-64 + D-71).
 *
 * Covers two absolute walls (no TD override on the trainer side, single
 * window on the player side):
 *   - D-64 trainer score wall (training.markAttendanceAndScore rejects
 *     when now() - ends_at > 14 days)
 *   - D-71 player tournament entry wall (tournament.enterResult rejects
 *     when now() - ends_at > 14 days for the player-initiated path;
 *     trainer-in-academy + TD remain unaffected per D-73)
 *
 * Boundary cases (FOURTEEN_DAYS exact):
 *   - day 13 → allowed
 *   - day 14 exact → allowed
 *   - day 14 + 1s → REJECTED with errors.training.scoreWindowExpired /
 *                                 errors.tournament.entryWindowExpired
 *   - day 15 → REJECTED
 *
 * Analog: tests/integration/calendar-rrule-horizon.test.ts (D-55 horizon
 * boundary probe).
 *
 * RED: this test is intentionally failing until Plan 04-03 (training
 * score wall) + Plan 04-04 (tournament entry wall) ship the wall checks.
 */
import { describe, it, expect, beforeAll } from 'vitest';

import { seedPhase4 } from '../fixtures/phase4-seed';

const FOURTEEN_DAYS = 14 * 24 * 60 * 60 * 1000;

describe('14-day score wall (D-64)', () => {
  beforeAll(async () => {
    void seedPhase4;
  });

  it('day 13: trainer can score session — allowed', async () => {
    void FOURTEEN_DAYS;
    expect.fail('Not implemented: requires Plan 04-03 (training.markAttendanceAndScore wall)');
  });
  it('day 14 exact: trainer can score session — allowed (boundary)', async () => {
    expect.fail('Not implemented: requires Plan 04-03 (training.markAttendanceAndScore wall)');
  });
  it('day 14 + 1s: rejected with errors.training.scoreWindowExpired (boundary)', async () => {
    expect.fail('Not implemented: requires Plan 04-03 (training.markAttendanceAndScore wall)');
  });
  it('day 15: rejected with errors.training.scoreWindowExpired', async () => {
    expect.fail('Not implemented: requires Plan 04-03 (training.markAttendanceAndScore wall)');
  });
});

describe('14-day tournament entry wall (D-71)', () => {
  it('day 13: player can enter result — allowed', async () => {
    expect.fail('Not implemented: requires Plan 04-04 (tournament.enterResult wall)');
  });
  it('day 14 exact: player can enter result — allowed (boundary)', async () => {
    expect.fail('Not implemented: requires Plan 04-04 (tournament.enterResult wall)');
  });
  it('day 14 + 1s: rejected with errors.tournament.entryWindowExpired (boundary)', async () => {
    expect.fail('Not implemented: requires Plan 04-04 (tournament.enterResult wall)');
  });
  it('day 15: rejected with errors.tournament.entryWindowExpired', async () => {
    expect.fail('Not implemented: requires Plan 04-04 (tournament.enterResult wall)');
  });

  it.todo('TZ correctness: wall computed against UTC ends_at; Brussels-local 14d window does NOT extend across DST end');
  it.todo('trainer-in-academy can still enter on day 15 (D-73 asymmetric backfill)');
  it.todo('TD can still enter on day 15 (D-73 unrestricted)');
});
