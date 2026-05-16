/**
 * Phase 4 Wave 0 — RED test stub for age-category snapshot on tournament result (DOM-CAT-02).
 *
 * Covers DOM-CAT-02: tournament_results.player_age_category_code records
 * the player's age category as of the tournament's starts_at date
 * (NOT the current category). Snapshot at entry-time, not user-editable.
 * Uses Phase 2's deriveAgeCategoryAt(player_id, on_date) helper.
 *
 * Analog: tests/integration/age-category-history.test.ts (Phase 2
 * historical-lookup probe).
 *
 * RED: this test is intentionally failing until Plan 04-04 ships the
 * snapshot logic in tournament.enterResult.
 */
import { describe, it, expect, beforeAll } from 'vitest';

import { seedPhase4 } from '../fixtures/phase4-seed';

describe('tournament_result age-category snapshot (DOM-CAT-02)', () => {
  beforeAll(async () => {
    void seedPhase4;
  });

  it('snapshot uses tournament.starts_at, not now() — player who aged up after the tournament still records the old category', async () => {
    expect.fail('Not implemented: requires Plan 04-04 (DOM-CAT-02 snapshot)');
  });
  it('snapshot is auto-populated by the mutation; cannot be overridden by client payload', async () => {
    expect.fail('Not implemented: requires Plan 04-04 (DOM-CAT-02 server-only snapshot)');
  });

  it.todo('snapshot persists across player category changes (immutable historical record)');
});
