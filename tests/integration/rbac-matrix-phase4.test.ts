/**
 * Phase 4 Wave 0 — RED test stub for Phase 4 RBAC matrix (USER-04, D-61, D-73, D-79, D-89).
 *
 * Probes 7 roles × {session_participant, session_sparring_partner,
 * tournament_result, match_result, ranking_entry, tournament_participation}
 * × CRUD subset. Wave 1 ships the routers + RLS policies that make these
 * cells light up.
 *
 * Analog: tests/integration/rbac-matrix.test.ts (Phase 2 canonical RBAC
 * matrix probe shape).
 *
 * RED: this test is intentionally failing until Plan 04-03..04-06 ship
 * the Phase 4 routers + RLS helpers.
 */
import { describe, it, expect, beforeAll } from 'vitest';

import { seedPhase4 } from '../fixtures/phase4-seed';

describe('Phase 4 RBAC matrix — 7 roles × 6 resources (USER-04)', () => {
  beforeAll(async () => {
    // Wave 0 — seedPhase4 returns a stub; integration test cannot run real
    // DB probes yet. Marker test below documents the intended shape.
    void seedPhase4;
  });

  it('Phase 4 RBAC matrix integration probe lands in Plan 04-06 (covers D-61, D-73, D-79, D-89)', async () => {
    expect.fail('Not implemented: requires Plan 04-06 (RBAC matrix Phase 4 cells)');
  });

  it.todo('player can mark own attendance score row (D-61 read scope)');
  it.todo('trainer-in-academy can enter tournament_result on behalf of player (D-73)');
  it.todo('non-academy trainer FORBIDDEN to enter result for foreign player (D-73)');
  it.todo('TD can enter ranking_entry for any player (D-89)');
  it.todo('player can enter own ranking_entry (D-89)');
  it.todo('trainer FORBIDDEN to enter ranking_entry (D-89 — trainer NOT in entrant set)');
  it.todo('TD-only on tournament.create + tournament.addParticipant + tournament.removeParticipant (D-79)');
});
