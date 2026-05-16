/**
 * Phase 4 Wave 0 — RED test stub for match_results UNIQUE constraint (VALID-07).
 *
 * Covers VALID-07: UNIQUE index on
 *   (player_user_id, tournament_event_id, round_code, opponent_text, datum)
 * prevents duplicate concurrent writes. Maps to errors.tournament.duplicateMatch
 * (TRPCError CONFLICT).
 *
 * Analog: tests/integration/calendar-exceptions.test.ts (Phase 3
 * (event_id, occurrence_date) UNIQUE probe).
 *
 * RED: this test is intentionally failing until Plan 04-04 ships the
 * UNIQUE constraint on match_results in migration 0015.
 */
import { describe, it, expect, beforeAll } from 'vitest';

import { seedPhase4 } from '../fixtures/phase4-seed';

describe('match_results UNIQUE constraint (VALID-07)', () => {
  beforeAll(async () => {
    void seedPhase4;
  });

  it('duplicate INSERT (same player/tournament/round/opponent/datum) violates UNIQUE (23505)', async () => {
    expect.fail('Not implemented: requires Plan 04-04 (match_results UNIQUE)');
  });
  it('TRPC layer maps 23505 to CONFLICT with errors.tournament.duplicateMatch', async () => {
    expect.fail('Not implemented: requires Plan 04-04 (CONFLICT mapping)');
  });

  it.todo('UNIQUE allows two matches in same round vs different opponents');
});
