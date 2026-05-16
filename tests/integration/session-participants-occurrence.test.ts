/**
 * Phase 4 Wave 0 — RED test stub for session_participants PK shape (D-82).
 *
 * Covers D-82: session_participants PK is (event_id, occurrence_date, user_id)
 * — each occurrence of a recurring training has its own attendance/score row.
 * Corrects Phase 3 D-51's sketch which omitted occurrence_date.
 *
 * Analog: tests/integration/calendar-exceptions.test.ts (Phase 3 D-54
 * (event_id, occurrence_date) UNIQUE constraint).
 *
 * RED: this test is intentionally failing until Plan 04-02 ships the
 * session_participants table in migration 0014.
 */
import { describe, it, expect, beforeAll } from 'vitest';

import { seedPhase4 } from '../fixtures/phase4-seed';

describe('session_participants — per-occurrence PK (D-82)', () => {
  beforeAll(async () => {
    void seedPhase4;
  });

  it('two rows: (event_id=X, occurrence_date=2026-03-10, user_id=Y) and (X, 2026-03-17, Y) coexist', async () => {
    expect.fail('Not implemented: requires Plan 04-02 (session_participants PK shape)');
  });
  it('duplicate PK violation: (X, 2026-03-10, Y) inserted twice → UNIQUE constraint violation 23505', async () => {
    expect.fail('Not implemented: requires Plan 04-02 (session_participants PK uniqueness)');
  });

  it.todo('quality_score column is nullable (attendance-only path)');
  it.todo('feedback_text column is nullable + max 2000 chars CHECK');
  it.todo('FK event_id → calendar_events.id with ON DELETE CASCADE');
});
