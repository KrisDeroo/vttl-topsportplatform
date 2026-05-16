/**
 * Phase 4 Wave 0 — RED test stub for TD-only tournament create + participant
 * registration (D-79).
 *
 * Covers TOURN-02 + D-79: tournament.create + tournament.addParticipant
 * + tournament.removeParticipant are TD-only. Distinct from result entry
 * (D-73 multi-role).
 *
 * Analog: tests/integration/rbac-matrix.test.ts.
 *
 * RED: this test is intentionally failing until Plan 04-04 ships the
 * tournament router with tdProcedure on these three procedures.
 */
import { describe, it, expect, beforeAll } from 'vitest';

import { seedPhase4 } from '../fixtures/phase4-seed';

describe('tournament create + participant RBAC (D-79)', () => {
  beforeAll(async () => {
    void seedPhase4;
  });

  it('TD can create tournament — allowed', async () => {
    expect.fail('Not implemented: requires Plan 04-04 (tournament.create tdProcedure)');
  });
  it('trainer FORBIDDEN to create tournament', async () => {
    expect.fail('Not implemented: requires Plan 04-04 (tournament.create tdProcedure)');
  });
  it('player FORBIDDEN to create tournament', async () => {
    expect.fail('Not implemented: requires Plan 04-04 (tournament.create tdProcedure)');
  });
  it('only TD can add a player to tournament via tournament.addParticipant', async () => {
    expect.fail('Not implemented: requires Plan 04-04 (tournament.addParticipant tdProcedure)');
  });
  it('only TD can remove a player via tournament.removeParticipant', async () => {
    expect.fail('Not implemented: requires Plan 04-04 (tournament.removeParticipant tdProcedure)');
  });

  it.todo('removing a participant cascades to tournament_results.player_user_id (D-79 + audit_log)');
});
