/**
 * Phase 4 Wave 4 — player 14d entry window (D-71).
 *
 * Covers D-71 + DOM-RESULT-01 SUPERSEDED-BY D-74: single 14-day window for
 * player entry/edit. After 14 days, player path returns FORBIDDEN with
 * errors.tournament.entryWindowExpired. No 48h sub-clock per D-74.
 *
 * Analog: tests/integration/calendar-rrule-horizon.test.ts (boundary
 * window probe).
 */
import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { freshDb } from '../helpers/db';
import { seedPhase4, type Phase4SeededFixtures } from '../fixtures/phase4-seed';
import { appCaller } from '../helpers/trpc';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

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

async function plantTournamentEndingDaysAgo(
  db: Awaited<ReturnType<typeof freshDb>>['db'],
  seeded: Phase4SeededFixtures,
  daysAgo: number,
): Promise<string> {
  const eventId = randomUUID();
  const endsAt = new Date(Date.now() - daysAgo * ONE_DAY_MS);
  const startsAt = new Date(endsAt.getTime() - 8 * 60 * 60 * 1000);
  await db.execute(sql`
    INSERT INTO calendar_events
      (id, type_code, title, starts_at, ends_at, all_day, created_by)
    VALUES (
      ${eventId}::uuid, 'event_type_tournament', 'Entry-window tournament',
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

describe('tournament entry window — D-71 player 14d window', () => {
  let dbHandle: Awaited<ReturnType<typeof freshDb>> | undefined;
  let seeded: Phase4SeededFixtures | undefined;
  let dbReady = false;

  beforeAll(async () => {
    dbReady = await canConnect();
    if (!dbReady) return;
    dbHandle = await freshDb();
    seeded = await seedPhase4(dbHandle.db);
  });

  afterAll(async () => {
    if (dbHandle) await dbHandle[Symbol.asyncDispose]();
  });

  it('day 7 post-tournament: player can enter own result — allowed', async () => {
    if (!dbReady || !seeded || !dbHandle) return;
    const tournamentId = await plantTournamentEndingDaysAgo(dbHandle.db, seeded, 7);
    const player = appCaller({ userId: seeded.users.player, role: 'player' });
    const result = await player.tournament.enterResult({
      tournamentEventId: tournamentId,
      playerUserId: seeded.users.player,
      outcome: 'outcome_last_16',
      matches: [
        {
          round: 'round_sixteenth',
          opponent: 'Day-7 Opp',
          opponentRanking: 400,
          matchDate: new Date(Date.now() - 7 * ONE_DAY_MS),
          setsWon: 1,
          setsLost: 3,
          videoLink: null,
        },
      ],
    });
    expect(result.ok).toBe(true);
    expect(result.enteredBy).toBe('player');
  });

  it('day 14 exact: player can edit own result — allowed (boundary)', async () => {
    if (!dbReady || !seeded || !dbHandle) return;
    const tournamentId = await plantTournamentEndingDaysAgo(dbHandle.db, seeded, 14);
    const player = appCaller({ userId: seeded.users.player, role: 'player' });
    const result = await player.tournament.enterResult({
      tournamentEventId: tournamentId,
      playerUserId: seeded.users.player,
      outcome: 'outcome_last_32',
      matches: [
        {
          round: 'round_sixteenth',
          opponent: 'Day-14 Opp',
          opponentRanking: 480,
          matchDate: new Date(Date.now() - 14 * ONE_DAY_MS),
          setsWon: 0,
          setsLost: 3,
          videoLink: null,
        },
      ],
    });
    expect(result.ok).toBe(true);
  });

  it('day 15: player FORBIDDEN with errors.tournament.entryWindowExpired', async () => {
    if (!dbReady || !seeded || !dbHandle) return;
    const tournamentId = await plantTournamentEndingDaysAgo(dbHandle.db, seeded, 15);
    const player = appCaller({ userId: seeded.users.player, role: 'player' });
    await expect(
      player.tournament.enterResult({
        tournamentEventId: tournamentId,
        playerUserId: seeded.users.player,
        outcome: 'outcome_last_64',
        matches: [
          {
            round: 'round_other',
            opponent: 'Day-15 Opp',
            opponentRanking: 700,
            matchDate: new Date(Date.now() - 15 * ONE_DAY_MS),
            setsWon: 0,
            setsLost: 3,
            videoLink: null,
          },
        ],
      }),
    ).rejects.toThrow(/entryWindowExpired/);
  });

  it('player CANNOT enter another player\'s result (own-row gate, errors.tournament.notOwnPlayer)', async () => {
    if (!dbReady || !seeded || !dbHandle) return;
    const tournamentId = await plantTournamentEndingDaysAgo(dbHandle.db, seeded, 2);
    const player = appCaller({ userId: seeded.users.player, role: 'player' });
    await expect(
      player.tournament.enterResult({
        tournamentEventId: tournamentId,
        playerUserId: seeded.extraUsers.playerA2, // different player!
        outcome: 'outcome_last_16',
        matches: [
          {
            round: 'round_sixteenth',
            opponent: 'Forge',
            opponentRanking: null,
            matchDate: new Date(Date.now() - 2 * ONE_DAY_MS),
            setsWon: 0,
            setsLost: 3,
            videoLink: null,
          },
        ],
      }),
    ).rejects.toThrow(/notOwnPlayer/);
  });
});
