/**
 * Phase 4 Wave 0 — RED test stub for session_participants RLS (D-61).
 *
 * Covers D-61 visibility rules:
 *   - WRITE: trainer (own session) + TD
 *   - READ: trainer + TD + academy_manager (player's academy) + player
 *           (own row) + parent (own child)
 *
 * Implemented via session_participants_visible_to(uid, role) SECURITY
 * DEFINER, mirroring Phase 3 D-50 calendar_events_visible_to.
 *
 * Analog: tests/integration/calendar-rls.test.ts.
 *
 * RED: this test is intentionally failing until Plan 04-03 ships
 * session_participants_visible_to() in migration 0018.
 */
import { describe, it, expect, beforeAll } from 'vitest';

import { seedPhase4 } from '../fixtures/phase4-seed';

describe('session_participants RLS (D-61)', () => {
  beforeAll(async () => {
    void seedPhase4;
  });

  it('player sees own session_participants row (READ)', async () => {
    expect.fail('Not implemented: requires Plan 04-03 (session_participants_visible_to)');
  });
  it('trainer of session sees all rows for that session (READ + WRITE)', async () => {
    expect.fail('Not implemented: requires Plan 04-03 (session_participants_visible_to)');
  });
  it('academy_manager of player\'s academy sees the row (READ)', async () => {
    expect.fail('Not implemented: requires Plan 04-03 (session_participants_visible_to)');
  });
  it('parent of minor player sees the row (READ)', async () => {
    expect.fail('Not implemented: requires Plan 04-03 (session_participants_visible_to)');
  });
  it('cross-academy trainer CANNOT see the row', async () => {
    expect.fail('Not implemented: requires Plan 04-03 (session_participants_visible_to)');
  });

  it.todo('player CANNOT write/update own session_participants row (D-61 — trainer/TD only write)');
});
