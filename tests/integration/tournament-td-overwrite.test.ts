/**
 * Phase 4 Wave 4 — TD unconditional overwrite (D-75).
 *
 * Covers D-75: TD can create, edit, or overwrite any tournament_results /
 * match_results row at any time. No approval queue. Every TD overwrite of
 * an existing row writes audit_log with action
 * `tournament_result_overwritten` and an `old_values` JSONB snapshot
 * (audit-before-overwrite per Pattern §2).
 *
 * Analog: tests/integration/calendar-audit.test.ts (audit_log probe shape).
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
  daysAgo: number,
): Promise<string> {
  const eventId = randomUUID();
  const endsAt = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  const startsAt = new Date(endsAt.getTime() - 8 * 60 * 60 * 1000);
  await db.execute(sql`
    INSERT INTO calendar_events
      (id, type_code, title, starts_at, ends_at, all_day, created_by)
    VALUES (
      ${eventId}::uuid, 'event_type_tournament', 'TD overwrite tournament',
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

describe('TD unconditional overwrite (D-75)', () => {
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

  it('TD overwrite of existing row emits tournament_result_overwritten with old_values JSONB', async () => {
    if (!dbReady || !seeded || !dbHandle) return;
    const tournamentId = await plantTournament(dbHandle.db, seeded, 2);

    // Step 1: player enters initial result.
    const player = appCaller({ userId: seeded.users.player, role: 'player' });
    await player.tournament.enterResult({
      tournamentEventId: tournamentId,
      playerUserId: seeded.users.player,
      outcome: 'outcome_last_16',
      matches: [
        {
          round: 'round_sixteenth',
          opponent: 'Initial Opp',
          opponentRanking: 400,
          matchDate: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
          setsWon: 1,
          setsLost: 3,
          videoLink: null,
        },
      ],
    });

    // Step 2: TD overwrites with a different outcome.
    const td = appCaller({
      userId: seeded.users.technical_director,
      role: 'technical_director',
    });
    const before = (await dbHandle.db.execute(sql`
      SELECT COUNT(*)::int AS c FROM audit_log
       WHERE action = 'tournament_result_overwritten'
         AND resource_id = ${`${tournamentId}:${seeded.users.player}`}
    `)) as unknown as Array<{ c: number }>;
    const beforeCount = Array.isArray(before) ? (before[0]?.c ?? 0) : 0;

    const result = await td.tournament.enterResult({
      tournamentEventId: tournamentId,
      playerUserId: seeded.users.player,
      outcome: 'outcome_last_4',
      matches: [
        {
          round: 'round_quarter',
          opponent: 'TD-corrected Opp',
          opponentRanking: 350,
          matchDate: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
          setsWon: 3,
          setsLost: 1,
          videoLink: null,
        },
      ],
    });
    expect(result.ok).toBe(true);
    expect(result.isOverwrite).toBe(true);
    expect(result.enteredBy).toBe('td');

    // Audit row: action = tournament_result_overwritten + old_values JSONB.
    const auditRows = (await dbHandle.db.execute(sql`
      SELECT old_values FROM audit_log
       WHERE action = 'tournament_result_overwritten'
         AND resource_id = ${`${tournamentId}:${seeded.users.player}`}
       ORDER BY occurred_at DESC LIMIT 1
    `)) as unknown as Array<{ old_values: unknown }>;
    expect(Array.isArray(auditRows) ? auditRows.length : 0).toBeGreaterThanOrEqual(1);
    const oldValues = (Array.isArray(auditRows) ? auditRows[0]?.old_values : undefined) as
      | { tournament?: { outcomeLevelCode?: string } }
      | undefined;
    expect(oldValues?.tournament?.outcomeLevelCode).toBe('outcome_last_16');

    // Count grew by exactly 1.
    const after = (await dbHandle.db.execute(sql`
      SELECT COUNT(*)::int AS c FROM audit_log
       WHERE action = 'tournament_result_overwritten'
         AND resource_id = ${`${tournamentId}:${seeded.users.player}`}
    `)) as unknown as Array<{ c: number }>;
    const afterCount = Array.isArray(after) ? (after[0]?.c ?? 0) : 0;
    expect(afterCount).toBe(beforeCount + 1);
  });

  it('TD edit beyond 14d wall is unblocked', async () => {
    if (!dbReady || !seeded || !dbHandle) return;
    const tournamentId = await plantTournament(dbHandle.db, seeded, 60);
    const td = appCaller({
      userId: seeded.users.technical_director,
      role: 'technical_director',
    });
    const result = await td.tournament.enterResult({
      tournamentEventId: tournamentId,
      playerUserId: seeded.users.player,
      outcome: 'outcome_last_32',
      matches: [
        {
          round: 'round_sixteenth',
          opponent: 'TD-late Opp',
          opponentRanking: 500,
          matchDate: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
          setsWon: 1,
          setsLost: 3,
          videoLink: null,
        },
      ],
    });
    expect(result.ok).toBe(true);
    expect(result.enteredBy).toBe('td');
  });

  it('player edit within 14d (own row) is NOT tagged as TD-overwrite', async () => {
    if (!dbReady || !seeded || !dbHandle) return;
    const tournamentId = await plantTournament(dbHandle.db, seeded, 2);
    const player = appCaller({ userId: seeded.users.player, role: 'player' });
    // Initial entry.
    await player.tournament.enterResult({
      tournamentEventId: tournamentId,
      playerUserId: seeded.users.player,
      outcome: 'outcome_group_stage',
      matches: [
        {
          round: 'round_group_stage',
          opponent: 'A',
          opponentRanking: 700,
          matchDate: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
          setsWon: 1,
          setsLost: 3,
          videoLink: null,
        },
      ],
    });
    // Player corrects.
    const result = await player.tournament.enterResult({
      tournamentEventId: tournamentId,
      playerUserId: seeded.users.player,
      outcome: 'outcome_last_64',
      matches: [
        {
          round: 'round_sixty_fourth',
          opponent: 'A-corrected',
          opponentRanking: 650,
          matchDate: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
          setsWon: 2,
          setsLost: 3,
          videoLink: null,
        },
      ],
    });
    expect(result.isOverwrite).toBe(true); // a row already existed
    expect(result.enteredBy).toBe('player');
    // Audit code should be tournament_result_entered (not overwritten) —
    // overwrite tag is reserved for TD.
    const overwriteRows = (await dbHandle.db.execute(sql`
      SELECT COUNT(*)::int AS c FROM audit_log
       WHERE action = 'tournament_result_overwritten'
         AND resource_id = ${`${tournamentId}:${seeded.users.player}`}
    `)) as unknown as Array<{ c: number }>;
    expect(Array.isArray(overwriteRows) ? overwriteRows[0]?.c : 0).toBe(0);
  });
});
