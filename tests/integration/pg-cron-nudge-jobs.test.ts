/**
 * Phase 4 Wave 0 — RED test stub for pg_cron nudge jobs (D-67, D-72).
 *
 * Covers D-67 channel 2 + D-72 channel 2: daily 18:00 Brussels pg_cron
 * jobs that materialize inbox messages for pending trainer scores
 * (daily_trainer_score_nudge) and pending player tournament results
 * (daily_player_tournament_result_nudge).
 *
 * Channel 2 deposits a row in `system_inbox` (Phase 4 minimal inbox,
 * Plan 04-07; replaced/migrated by Phase 6's full messaging UI).
 *
 * Analog: NO existing analog (Phase 4 introduces pg_cron driver pattern).
 * Pitfall ref: 04-RESEARCH.md §Pitfall 2 (mock pg_cron with manual SELECT).
 *
 * RED: this test is intentionally failing until Plan 04-07 ships the
 * pg_cron job definitions in migration 0019 and the system_inbox table
 * in migration 0020.
 */
import { describe, it, expect, beforeAll } from 'vitest';

import { seedPhase4 } from '../fixtures/phase4-seed';

describe('pg_cron daily nudge jobs (D-67 ch2, D-72 ch2)', () => {
  beforeAll(async () => {
    void seedPhase4;
  });

  it('daily_trainer_score_nudge materializes system_inbox rows for trainers with pending NULL scores', async () => {
    expect.fail('Not implemented: requires Plan 04-07 (daily_trainer_score_nudge pg_cron job)');
  });
  it('daily_player_tournament_result_nudge materializes system_inbox rows for players with missing results', async () => {
    expect.fail('Not implemented: requires Plan 04-07 (daily_player_tournament_result_nudge pg_cron job)');
  });

  it.todo('jobs schedule at 18:00 Europe/Brussels (CET/CEST DST-aware)');
  it.todo('idempotent re-run: replaying the cron tick does NOT duplicate inbox rows for the same day');
  it.todo('escalating tone copy resolved at materialization-time (nudge.trainerScore.day0to6 / day7to9 / day10to12)');
  it.todo('clearing the pending state (trainer scores all) removes the trainer from the next tick');
});
