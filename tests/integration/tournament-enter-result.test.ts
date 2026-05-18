/**
 * Phase 4 Wave 4 — tournament.enterResult happy path (D-69).
 *
 * Covers TOURN-03 + TOURN-04 + TOURN-05 + D-69 + D-73: player enters
 * (outcome, matches[]) atomically; the persisted row appears in
 * tournament.listResults for the caller; D-78 RLS branches surface it
 * to the academy peers as well.
 *
 * Analog: tests/integration/calendar-conflicts.test.ts (Phase 3 end-to-end
 * tRPC probe).
 */
import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { freshDb } from '../helpers/db';
import { seedPhase4, type Phase4SeededFixtures } from '../fixtures/phase4-seed';
import { appCaller } from '../helpers/trpc';

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

async function plantTournament(
  db: Awaited<ReturnType<typeof freshDb>>['db'],
  seeded: Phase4SeededFixtures,
): Promise<string> {
  const eventId = randomUUID();
  const endsAt = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);
  const startsAt = new Date(endsAt.getTime() - 8 * 60 * 60 * 1000);
  await db.execute(sql`
    INSERT INTO calendar_events
      (id, type_code, title, starts_at, ends_at, all_day, created_by)
    VALUES (
      ${eventId}::uuid, 'event_type_tournament', 'enterResult happy path',
      ${startsAt.toISOString()}, ${endsAt.toISOString()}, false,
      ${seeded.users.technical_director}::uuid
    )
  `);
  await db.execute(sql`
    INSERT INTO tournaments (event_id, city, country, age_category_code, tournament_type_code)
    VALUES (${eventId}::uuid, 'Antwerpen', 'BE', 'age_senior', 'tournament_belgium')
  `);
  await db.execute(sql`
    INSERT INTO calendar_event_participants (event_id, user_id, role_in_event, rsvp_status)
    VALUES (${eventId}::uuid, ${seeded.users.player}::uuid, 'participant', 'accepted')
  `);
  return eventId;
}

describe('tournament.enterResult happy path (D-69)', () => {
  let dbHandle: Awaited<ReturnType<typeof freshDb>> | undefined;
  let seeded: Phase4SeededFixtures | undefined;
  let dbReady = false;
  let tournamentId = '';

  beforeAll(async () => {
    dbReady = await canConnect();
    if (!dbReady) return;
    dbHandle = await freshDb();
    seeded = await seedPhase4(dbHandle.db);
    tournamentId = await plantTournament(dbHandle.db, seeded);

    // Run happy-path entry once so subsequent it() blocks can probe listResults.
    const player = appCaller({ userId: seeded.users.player, role: 'player' });
    await player.tournament.enterResult({
      tournamentEventId: tournamentId,
      playerUserId: seeded.users.player,
      outcome: 'outcome_last_8',
      matches: [
        {
          round: 'round_quarter',
          opponent: 'Happy Opp 1',
          opponentRanking: 350,
          matchDate: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
          setsWon: 3,
          setsLost: 2,
          videoLink: null,
        },
        {
          round: 'round_eighth',
          opponent: 'Happy Opp 2',
          opponentRanking: 420,
          matchDate: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
          setsWon: 3,
          setsLost: 1,
          videoLink: null,
        },
      ],
    });
  });

  afterAll(async () => {
    if (dbHandle) await dbHandle[Symbol.asyncDispose]();
  });

  it('player enters outcome + 2 matches — rows persisted', async () => {
    if (!dbReady || !dbHandle || !seeded) return;
    const tRows = (await dbHandle.db.execute(sql`
      SELECT outcome_level_code, entered_by FROM tournament_results
       WHERE tournament_event_id = ${tournamentId}::uuid
         AND player_user_id = ${seeded.users.player}::uuid
    `)) as unknown as Array<{ outcome_level_code: string; entered_by: string }>;
    const arr = Array.isArray(tRows) ? tRows : [];
    expect(arr.length).toBe(1);
    expect(arr[0]?.outcome_level_code).toBe('outcome_last_8');
    expect(arr[0]?.entered_by).toBe('player');

    const mRows = (await dbHandle.db.execute(sql`
      SELECT COUNT(*)::int AS c FROM match_results
       WHERE tournament_event_id = ${tournamentId}::uuid
         AND player_user_id = ${seeded.users.player}::uuid
    `)) as unknown as Array<{ c: number }>;
    expect(Array.isArray(mRows) ? mRows[0]?.c : 0).toBe(2);
  });

  it('result appears in tournament.listResults for the entering player', async () => {
    if (!dbReady || !seeded) return;
    const player = appCaller({ userId: seeded.users.player, role: 'player' });
    const list = await player.tournament.listResults({
      tournamentEventId: tournamentId,
    });
    expect(
      list.results.some(
        (r: { playerUserId: string }) => r.playerUserId === seeded?.users.player,
      ),
    ).toBe(true);
    // Both match rows surface in the matches array.
    const matchesForPlayer = list.matches.filter(
      (m: { playerUserId: string }) => m.playerUserId === seeded?.users.player,
    );
    expect(matchesForPlayer.length).toBe(2);
  });

  it('result visible to trainer-in-academy (D-78 Branch 3)', async () => {
    if (!dbReady || !seeded) return;
    const trainer = appCaller({ userId: seeded.users.trainer, role: 'trainer' });
    const list = await trainer.tournament.listResults({
      tournamentEventId: tournamentId,
    });
    expect(
      list.results.some(
        (r: { playerUserId: string }) => r.playerUserId === seeded?.users.player,
      ),
    ).toBe(true);
  });
});
