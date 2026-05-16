/**
 * Phase 4 Wave 0 — RED test stub for training.markAttendanceAndScore (D-62, Pitfall 6).
 *
 * Covers D-62 single-form bulk upsert: trainer submits a single mutation
 * with rows {player_id, attendance, quality_score, feedback_text}. Mutation
 * uses ON CONFLICT DO UPDATE on (event_id, occurrence_date, user_id)
 * (Pitfall 6 — race-safe with concurrent retries).
 *
 * Analog: tests/integration/age-category-history.test.ts (Phase 2 atomic
 * multi-row upsert pattern).
 *
 * RED: this test is intentionally failing until Plan 04-03 ships the
 * training.markAttendanceAndScore router procedure.
 */
import { describe, it, expect, beforeAll } from 'vitest';

import { seedPhase4 } from '../fixtures/phase4-seed';

describe('training.markAttendanceAndScore (D-62)', () => {
  beforeAll(async () => {
    void seedPhase4;
  });

  it('bulk upsert: 5 participant rows persist in single transaction', async () => {
    expect.fail('Not implemented: requires Plan 04-03 (training.markAttendanceAndScore)');
  });
  it('idempotent re-submit: same payload twice → same row count, no duplicates (ON CONFLICT DO UPDATE)', async () => {
    expect.fail('Not implemented: requires Plan 04-03 (Pitfall 6 ON CONFLICT race-safe)');
  });

  it.todo('quality_score nullable: trainer can save attendance-only and revisit later');
  it.todo('audit code training_attendance_marked emitted with row count + event_id');
});
