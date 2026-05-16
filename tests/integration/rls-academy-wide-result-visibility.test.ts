/**
 * Phase 4 Wave 0 — RED test stub for 5-branch UNION RLS (D-78).
 *
 * Covers D-78 academy-wide tournament_result visibility — 5 UNION branches
 * in tournament_result_visible_to(caller_id, caller_role) SECURITY DEFINER:
 *
 *   - Branch 1: TD (all)
 *   - Branch 2: own results (player.user_id = caller_id)
 *   - Branch 3: trainer/academy_manager via academy_memberships JOIN
 *               (player's academy ∩ caller's academy ≠ ∅)
 *   - Branch 4: parent via parent_child_links JOIN (parent of subject minor)
 *   - Branch 5: NET-NEW per D-78 — players sharing an academy with the
 *               subject (leaderboard energy in elite training)
 *
 * Analog: tests/integration/calendar-rls.test.ts (Phase 3 D-50 5-branch
 * RLS pattern — same UNION shape).
 *
 * RED: this test is intentionally failing until Plan 04-04 ships
 * `tournament_result_visible_to()` SECURITY DEFINER in migration 0018.
 */
import { describe, it, expect, beforeAll } from 'vitest';

import { seedPhase4 } from '../fixtures/phase4-seed';

describe('tournament_result RLS — 5-branch UNION (D-78)', () => {
  beforeAll(async () => {
    void seedPhase4;
  });

  it('Branch 1: TD sees all tournament_results across academies', async () => {
    expect.fail('Not implemented: requires Plan 04-04 (D-78 Branch 1 — TD)');
  });
  it('Branch 2: player sees own tournament_results', async () => {
    expect.fail('Not implemented: requires Plan 04-04 (D-78 Branch 2 — own)');
  });
  it('Branch 3: trainer/academy_manager in player\'s academy sees the row', async () => {
    expect.fail('Not implemented: requires Plan 04-04 (D-78 Branch 3 — academy staff)');
  });
  it('Branch 4: parent of subject minor sees the row', async () => {
    expect.fail('Not implemented: requires Plan 04-04 (D-78 Branch 4 — parent)');
  });
  it('Branch 5: player sharing an academy with subject sees the row (academy peer)', async () => {
    expect.fail('Not implemented: requires Plan 04-04 (D-78 Branch 5 — academy peer net-new)');
  });

  it.todo('cross-academy player CANNOT see the row (no Branch 5 match)');
  it.todo('non-parent CANNOT see the row (no Branch 4 match)');
  it.todo('match_results visibility delegates to the parent tournament_result row');
});
