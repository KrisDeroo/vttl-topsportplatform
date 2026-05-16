/**
 * Phase 4 Wave 0 — RED test stub for TD unconditional overwrite (D-75).
 *
 * Covers D-75: TD can create, edit, or overwrite any tournament_results
 * or match_results row at any time. No approval queue. Every TD edit
 * hits audit_log with action 'tournament_result_overwritten' and
 * oldValues JSONB snapshot (audit-before-overwrite per Pattern §2).
 *
 * Analog: tests/integration/calendar-audit.test.ts (audit_log probe).
 *
 * RED: this test is intentionally failing until Plan 04-04 ships
 * tournament.updateResult with TD overwrite branch.
 */
import { describe, it, expect, beforeAll } from 'vitest';

import { seedPhase4 } from '../fixtures/phase4-seed';

describe('TD unconditional overwrite (D-75)', () => {
  beforeAll(async () => {
    void seedPhase4;
  });

  it('TD overwrites an existing tournament_results row → audit_log emits tournament_result_overwritten with oldValues snapshot', async () => {
    expect.fail('Not implemented: requires Plan 04-04 (TD overwrite + audit-before-overwrite)');
  });

  it.todo('TD overwrites match_results — same audit pattern');
  it.todo('TD edit beyond 14d wall is unblocked (no wall for TD)');
});
