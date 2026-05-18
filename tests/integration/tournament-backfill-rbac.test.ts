/**
 * Phase 4 Wave 4 — asymmetric backfill RBAC (D-73).
 *
 * Covers DOM-RESULT-02 + D-73: after the player's 14d wall expires,
 * trainer-in-same-academy + TD can still enter/edit results with no wall.
 * `entered_by` attribution records who entered the row:
 *   - role=player → 'player'
 *   - role=trainer → 'trainer'
 *   - role=technical_director → 'td'
 *
 * Analog: tests/integration/rbac-matrix.test.ts.
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

async function plantTournamentEndingDaysAgo(
  db: Awaited<ReturnType<typeof freshDb>>['db'],
  seeded: Phase4SeededFixtures,
  daysAgo: number,
): Promise<string> {
  const eventId = randomUUID();
  const endsAt = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  const startsAt = new Date(endsAt.getTime() - 8 * 60 * 60 * 1000);
  await db.execute(sql`
    INSERT INTO calendar_events
      (id, type_code, title, starts_at, ends_at, all_day, created_by)
    VALUES (
      ${eventId}::uuid, 'event_type_tournament', 'Backfill-RBAC tournament',
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

describe('tournament backfill RBAC (D-73)', () => {
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

  it('trainer in player\'s academy can backfill on day 30 — entered_by = trainer', async () => {
    if (!dbReady || !seeded || !dbHandle) return;
    const tournamentId = await plantTournamentEndingDaysAgo(dbHandle.db, seeded, 30);
    const trainer = appCaller({ userId: seeded.users.trainer, role: 'trainer' });
    const result = await trainer.tournament.enterResult({
      tournamentEventId: tournamentId,
      playerUserId: seeded.users.player,
      outcome: 'outcome_last_16',
      matches: [
        {
          round: 'round_sixteenth',
          opponent: 'Backfill Opp',
          opponentRanking: 400,
          matchDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
          setsWon: 1,
          setsLost: 3,
          videoLink: null,
        },
      ],
    });
    expect(result.ok).toBe(true);
    expect(result.enteredBy).toBe('trainer');
  });

  it('trainer in DIFFERENT academy FORBIDDEN on day 30 (errors.tournament.trainerNotInAcademy)', async () => {
    if (!dbReady || !seeded || !dbHandle) return;
    // Plant a fresh trainer in academy B (not the player's academy).
    const crossTrainerId = randomUUID();
    await dbHandle.db.execute(sql`
      INSERT INTO users (id, email, name, role, preferred_locale, date_of_birth, active, email_verified)
      VALUES (
        ${crossTrainerId}::uuid, 'seed-phase4-cross-trainer-backfill@vttl.test',
        'Cross Trainer Backfill', 'trainer', 'nl', '1990-01-01', true, true
      )
      ON CONFLICT (email) DO NOTHING
    `);
    await dbHandle.db.execute(sql`
      INSERT INTO academy_memberships (user_id, academy_code, role, linked_by)
      VALUES (${crossTrainerId}::uuid, ${seeded.academyB}, 'trainer',
              ${seeded.users.technical_director}::uuid)
      ON CONFLICT DO NOTHING
    `);

    const tournamentId = await plantTournamentEndingDaysAgo(dbHandle.db, seeded, 30);
    const crossTrainer = appCaller({ userId: crossTrainerId, role: 'trainer' });
    await expect(
      crossTrainer.tournament.enterResult({
        tournamentEventId: tournamentId,
        playerUserId: seeded.users.player,
        outcome: 'outcome_last_32',
        matches: [
          {
            round: 'round_sixteenth',
            opponent: 'Cross-academy Opp',
            opponentRanking: 500,
            matchDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
            setsWon: 0,
            setsLost: 3,
            videoLink: null,
          },
        ],
      }),
    ).rejects.toThrow(/trainerNotInAcademy/);
  });

  it('TD can backfill on day 365 — entered_by = td', async () => {
    if (!dbReady || !seeded || !dbHandle) return;
    const tournamentId = await plantTournamentEndingDaysAgo(dbHandle.db, seeded, 365);
    const td = appCaller({
      userId: seeded.users.technical_director,
      role: 'technical_director',
    });
    const result = await td.tournament.enterResult({
      tournamentEventId: tournamentId,
      playerUserId: seeded.users.player,
      outcome: 'outcome_finalist',
      matches: [
        {
          round: 'round_final',
          opponent: 'Year-old final',
          opponentRanking: 100,
          matchDate: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000),
          setsWon: 3,
          setsLost: 2,
          videoLink: null,
        },
      ],
    });
    expect(result.ok).toBe(true);
    expect(result.enteredBy).toBe('td');
  });

  it('parent FORBIDDEN to enter result for their minor (role_not_allowed)', async () => {
    if (!dbReady || !seeded || !dbHandle) return;
    const tournamentId = await plantTournamentEndingDaysAgo(dbHandle.db, seeded, 5);
    const parent = appCaller({ userId: seeded.users.parent, role: 'parent' });
    await expect(
      parent.tournament.enterResult({
        tournamentEventId: tournamentId,
        playerUserId: seeded.victimId,
        outcome: 'outcome_last_8',
        matches: [
          {
            round: 'round_quarter',
            opponent: 'Parent-forge Opp',
            opponentRanking: 350,
            matchDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
            setsWon: 2,
            setsLost: 3,
            videoLink: null,
          },
        ],
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('academy_manager FORBIDDEN to enter result — only TD + trainer-in-academy per D-73', async () => {
    if (!dbReady || !seeded || !dbHandle) return;
    const tournamentId = await plantTournamentEndingDaysAgo(dbHandle.db, seeded, 5);
    const am = appCaller({
      userId: seeded.users.academy_manager,
      role: 'academy_manager',
    });
    await expect(
      am.tournament.enterResult({
        tournamentEventId: tournamentId,
        playerUserId: seeded.users.player,
        outcome: 'outcome_last_16',
        matches: [
          {
            round: 'round_sixteenth',
            opponent: 'AM-forge Opp',
            opponentRanking: 450,
            matchDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
            setsWon: 1,
            setsLost: 3,
            videoLink: null,
          },
        ],
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
