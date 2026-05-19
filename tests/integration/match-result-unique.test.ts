/**
 * Phase 4 Wave 4 — match_results UNIQUE constraint (VALID-07).
 *
 * Covers VALID-07: UNIQUE index on
 *   (tournament_event_id, player_user_id, round_code, opponent_name, match_date)
 * prevents duplicate writes. Raw-INSERT duplicate raises Postgres 23505.
 *
 * The router's enterResult atomic-replace pattern (DELETE-then-INSERT in
 * a single tx) sidesteps the constraint on retry, so we probe the
 * constraint directly at the DB layer for forensic correctness.
 *
 * Analog: tests/integration/calendar-exceptions.test.ts (Phase 3
 * (event_id, occurrence_date) UNIQUE probe).
 */
import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { freshDb } from '../helpers/db';
import { seedPhase4, type Phase4SeededFixtures } from '../fixtures/phase4-seed';

async function canConnect(): Promise<boolean> {
  const url = process.env.DATABASE_URL;
  if (!url || url.includes('stub')) return false;
  try {
    const h = await freshDb();
    await h[Symbol.asyncDispose]();
    return true;
  } catch {
    return false;
  }
}

describe('match_results UNIQUE constraint (VALID-07)', () => {
  let dbHandle: Awaited<ReturnType<typeof freshDb>> | undefined;
  let seeded: Phase4SeededFixtures | undefined;
  let dbReady = false;
  let tournamentId = '';

  beforeAll(async () => {
    dbReady = await canConnect();
    if (!dbReady) return;
    dbHandle = await freshDb();
    seeded = await seedPhase4(dbHandle.db);
    // Plant a fresh tournament for the constraint probe.
    tournamentId = randomUUID();
    const endsAt = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);
    const startsAt = new Date(endsAt.getTime() - 8 * 60 * 60 * 1000);
    await dbHandle.db.execute(sql`
      INSERT INTO calendar_events
        (id, type_code, title, starts_at, ends_at, all_day, created_by)
      VALUES (
        ${tournamentId}::uuid, 'event_type_tournament', 'UNIQUE probe',
        ${startsAt.toISOString()}, ${endsAt.toISOString()}, false,
        ${seeded.users.technical_director}::uuid
      )
    `);
    await dbHandle.db.execute(sql`
      INSERT INTO tournaments (event_id, city, country, age_category_code, tournament_type_code)
      VALUES (${tournamentId}::uuid, 'Antwerpen', 'BE', 'age_senior', 'tournament_belgium')
    `);
  });

  afterAll(async () => {
    if (dbHandle) await dbHandle[Symbol.asyncDispose]();
  });

  it('duplicate INSERT (same player/tournament/round/opponent/match_date) raises 23505', async () => {
    if (!dbReady || !seeded || !dbHandle) return;
    const matchDate = '2026-04-15';
    // First insert — succeeds.
    await dbHandle.db.execute(sql`
      INSERT INTO match_results
        (tournament_event_id, player_user_id, round_code,
         opponent_name, opponent_ranking, match_date, sets_won, sets_lost, video_link)
      VALUES (
        ${tournamentId}::uuid, ${seeded.users.player}::uuid, 'round_quarter',
        'Duplicate Opp', 300, ${matchDate}::date, 3, 2, NULL
      )
    `);
    // Duplicate — raises 23505.
    await expect(
      dbHandle.db.execute(sql`
        INSERT INTO match_results
          (tournament_event_id, player_user_id, round_code,
           opponent_name, opponent_ranking, match_date, sets_won, sets_lost, video_link)
        VALUES (
          ${tournamentId}::uuid, ${seeded.users.player}::uuid, 'round_quarter',
          'Duplicate Opp', 300, ${matchDate}::date, 3, 0, NULL
        )
      `),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('UNIQUE allows two matches in same round vs different opponents', async () => {
    if (!dbReady || !seeded || !dbHandle) return;
    const matchDate = '2026-04-16';
    await dbHandle.db.execute(sql`
      INSERT INTO match_results
        (tournament_event_id, player_user_id, round_code,
         opponent_name, opponent_ranking, match_date, sets_won, sets_lost, video_link)
      VALUES
        (${tournamentId}::uuid, ${seeded.users.player}::uuid, 'round_group_stage',
         'Group Opp A', 400, ${matchDate}::date, 3, 1, NULL),
        (${tournamentId}::uuid, ${seeded.users.player}::uuid, 'round_group_stage',
         'Group Opp B', 410, ${matchDate}::date, 3, 0, NULL)
    `);
    const rows = (await dbHandle.db.execute(sql`
      SELECT COUNT(*)::int AS c FROM match_results
       WHERE tournament_event_id = ${tournamentId}::uuid
         AND player_user_id = ${seeded.users.player}::uuid
         AND round_code = 'round_group_stage'
         AND match_date = ${matchDate}::date
    `)) as unknown as Array<{ c: number }>;
    expect(Array.isArray(rows) ? rows[0]?.c : 0).toBe(2);
  });

  it('match_results CHECK constraints: sets_won 0..4, sets_lost 0..4, total 1..7', async () => {
    if (!dbReady || !seeded || !dbHandle) return;
    // sets_won = 5 → CHECK match_results_sets_won_range rejects (23514).
    await expect(
      dbHandle.db.execute(sql`
        INSERT INTO match_results
          (tournament_event_id, player_user_id, round_code,
           opponent_name, opponent_ranking, match_date, sets_won, sets_lost, video_link)
        VALUES (
          ${tournamentId}::uuid, ${seeded.users.player}::uuid, 'round_other',
          'Set-overflow Opp', NULL, '2026-04-20'::date, 5, 0, NULL
        )
      `),
    ).rejects.toMatchObject({ code: '23514' });

    // sets_won + sets_lost = 0 → match_results_sets_total_range rejects.
    await expect(
      dbHandle.db.execute(sql`
        INSERT INTO match_results
          (tournament_event_id, player_user_id, round_code,
           opponent_name, opponent_ranking, match_date, sets_won, sets_lost, video_link)
        VALUES (
          ${tournamentId}::uuid, ${seeded.users.player}::uuid, 'round_other',
          'Zero-set Opp', NULL, '2026-04-21'::date, 0, 0, NULL
        )
      `),
    ).rejects.toMatchObject({ code: '23514' });
  });
});
