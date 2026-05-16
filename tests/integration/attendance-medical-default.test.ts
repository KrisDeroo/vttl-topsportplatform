/**
 * Phase 4 Wave 0 — RED test stub for medical-aware attendance default
 * (DOM-MED-CONFLICT-02).
 *
 * Covers DOM-MED-CONFLICT-02: in the bulk attendance form, players with
 * an overlapping medical event get attendance pre-filled to "afwezig met
 * geldige reden" (absentMedical). Trainer can still override.
 *
 * Analog: tests/integration/calendar-conflicts.test.ts.
 *
 * RED: this test is intentionally failing until Plan 04-03 wires the
 * server-side default-derivation on session-load.
 */
import { describe, it, expect, beforeAll } from 'vitest';

import { seedPhase4 } from '../fixtures/phase4-seed';

describe('attendance default on medical overlap (DOM-MED-CONFLICT-02)', () => {
  beforeAll(async () => {
    void seedPhase4;
  });

  it('player with overlapping medical event has attendance pre-filled to absentMedical', async () => {
    expect.fail('Not implemented: requires Plan 04-03 (attendance default derivation)');
  });

  it.todo('trainer override of the default is persisted and audited as a normal mark');
  it.todo('player without overlapping medical event has attendance pending (no default)');
});
