/**
 * Phase 4 Wave 0 — RED test stub for training × medical conflict warning
 * (DOM-MED-CONFLICT-01).
 *
 * Covers DOM-MED-CONFLICT-01: when a training session is created with
 * participants, system checks for overlapping medical events and warns
 * the trainer. Piggy-backs on Phase 3 overlapping_events_for_users().
 *
 * Analog: tests/integration/calendar-conflicts.test.ts (Phase 3 conflict
 * detection probe).
 *
 * RED: this test is intentionally failing until Plan 04-03 wires the
 * medical-conflict path into the training-create/training-update flow.
 */
import { describe, it, expect, beforeAll } from 'vitest';

import { seedPhase4 } from '../fixtures/phase4-seed';

describe('training × medical conflict warning (DOM-MED-CONFLICT-01)', () => {
  beforeAll(async () => {
    void seedPhase4;
  });

  it('creating a training that overlaps a player\'s medical event surfaces a conflict warning', async () => {
    expect.fail('Not implemented: requires Plan 04-03 (training × medical conflict)');
  });

  it.todo('warning is non-blocking (trainer can force-save with audit code)');
  it.todo('non-overlapping medical event does NOT surface a warning');
});
