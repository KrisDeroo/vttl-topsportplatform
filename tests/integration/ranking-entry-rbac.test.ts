/**
 * Phase 4 Wave 0 — RED test stub for ranking.addEntry RBAC (D-89).
 *
 * Covers RANK-06 KEPT LITERAL + D-89: player can enter their own
 * rankings; TD can enter for any player; trainer CANNOT. Applies to all
 * 5 ranking types including Belgium classification.
 *
 * Analog: tests/integration/rbac-matrix.test.ts.
 *
 * RED: this test is intentionally failing until Plan 04-05 ships the
 * ranking router with inline RBAC + audit.
 */
import { describe, it, expect, beforeAll } from 'vitest';

import { seedPhase4 } from '../fixtures/phase4-seed';

describe('ranking.addEntry RBAC (D-89)', () => {
  beforeAll(async () => {
    void seedPhase4;
  });

  it('player enters own ranking — allowed (entered_by = self)', async () => {
    expect.fail('Not implemented: requires Plan 04-05 (ranking.addEntry RBAC)');
  });
  it('TD enters ranking for any player — allowed', async () => {
    expect.fail('Not implemented: requires Plan 04-05 (ranking.addEntry TD path)');
  });
  it('trainer FORBIDDEN to enter ranking_entry — even for own academy player', async () => {
    expect.fail('Not implemented: requires Plan 04-05 (ranking.addEntry trainer-denied)');
  });
  it('parent FORBIDDEN to enter ranking_entry for child', async () => {
    expect.fail('Not implemented: requires Plan 04-05 (ranking.addEntry parent-denied)');
  });

  it.todo('Belgium classification entry: player can self-report A12, B4, NC etc. — no Belgium-TD-only special-case');
  it.todo('audit code ranking_entry_added emitted with entered_by + ranking_type_code');
});
