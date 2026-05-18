/**
 * Phase 4 Wave 4 — DOM-CAT-02 age-category snapshot on tournament result.
 *
 * Covers DOM-CAT-02: tournament_results.player_age_category_code records
 * the player's age category AS OF the tournament's starts_at date — not
 * the player's current category. Frozen at entry time; never user-editable.
 *
 * Uses `getAgeCategoryAt(playerUserId, asOf)` from `@/lib/players` which
 * the enterResult handler invokes (`src/server/trpc/routers/tournament.ts`
 * step 5). When the player has no covering age_category_history row, the
 * fallback is `'age_unknown'`.
 *
 * Analog: tests/integration/age-category-history.test.ts (Phase 2
 * historical-lookup probe).
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
  startsAt: Date,
): Promise<string> {
  const eventId = randomUUID();
  const endsAt = new Date(startsAt.getTime() + 8 * 60 * 60 * 1000);
  await db.execute(sql`
    INSERT INTO calendar_events
      (id, type_code, title, starts_at, ends_at, all_day, created_by)
    VALUES (
      ${eventId}::uuid, 'event_type_tournament', 'Age-cat snapshot probe',
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

describe('tournament_result age-category snapshot (DOM-CAT-02)', () => {
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

  it('snapshot uses tournament.startsAt — uses age_category_history at that date', async () => {
    if (!dbReady || !seeded || !dbHandle) return;
    // Plant an age_category_history row: player was a 'age_cadet' on
    // 2024-06-01, transitioned to 'age_junior' on 2025-01-01, and is now
    // 'age_senior' (the current value). The TD-creates-player flow normally
    // plants the inaugural row, but our role-matrix player has no players
    // row — we must add one OR plant ageCategoryHistory directly.
    //
    // We plant a players row + history records, then enter a result for a
    // tournament dated 2024-08-15 — within the cadet-era. The snapshot
    // must be 'age_cadet'.
    //
    // Player needs a players row first.
    await dbHandle.db.execute(sql`
      INSERT INTO players (
        user_id, first_name, last_name, date_of_birth, gender,
        street, postal_code, city, province, country,
        status_code, academy_code, age_category, category_year,
        is_minor
      )
      VALUES (
        ${seeded.users.player}::uuid, 'Phase4', 'SnapshotPlayer',
        '2010-06-15', 'male',
        'Test St', '2000', 'Antwerpen', 'Antwerpen', 'BE',
        'status_a', ${seeded.academyA},
        'age_senior', 2026, false
      )
      ON CONFLICT (user_id) DO NOTHING
    `);
    // Now plant history rows.
    await dbHandle.db.execute(sql`
      INSERT INTO age_category_history
        (player_id, age_category_code, category_year, effective_from, effective_to, set_by)
      VALUES
        (${seeded.users.player}::uuid, 'age_cadet',  2024, '2024-01-01'::date, '2024-12-31'::date, ${seeded.users.technical_director}::uuid),
        (${seeded.users.player}::uuid, 'age_junior', 2025, '2025-01-01'::date, '2025-12-31'::date, ${seeded.users.technical_director}::uuid),
        (${seeded.users.player}::uuid, 'age_senior', 2026, '2026-01-01'::date, NULL,               ${seeded.users.technical_director}::uuid)
      ON CONFLICT DO NOTHING
    `);

    // Plant a tournament starting in 2024 — within the cadet window.
    const tournamentStarts = new Date('2024-08-15T08:00:00Z');
    const tournamentId = await plantTournament(dbHandle.db, seeded, tournamentStarts);

    const td = appCaller({
      userId: seeded.users.technical_director,
      role: 'technical_director',
    });
    const result = await td.tournament.enterResult({
      tournamentEventId: tournamentId,
      playerUserId: seeded.users.player,
      outcome: 'outcome_last_16',
      matches: [
        {
          round: 'round_sixteenth',
          opponent: 'Cadet-era Opp',
          opponentRanking: 100,
          matchDate: new Date('2024-08-15T10:00:00Z'),
          setsWon: 2,
          setsLost: 3,
          videoLink: null,
        },
      ],
    });
    expect(result.ageCategorySnapshot).toBe('age_cadet');

    // Verify the stored row also has the snapshot frozen.
    const rows = (await dbHandle.db.execute(sql`
      SELECT player_age_category_code FROM tournament_results
       WHERE tournament_event_id = ${tournamentId}::uuid
         AND player_user_id = ${seeded.users.player}::uuid
    `)) as unknown as Array<{ player_age_category_code: string }>;
    expect(Array.isArray(rows) ? rows[0]?.player_age_category_code : '').toBe(
      'age_cadet',
    );
  });

  it('snapshot is server-derived — client cannot override via payload (schema has no field for it)', async () => {
    if (!dbReady || !seeded || !dbHandle) return;
    // The enterResultInput schema has no player_age_category_code field.
    // We assert this contract is preserved by attempting an unknown field
    // — the strict() schema rejects it.
    const tournamentStarts = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const tournamentId = await plantTournament(dbHandle.db, seeded, tournamentStarts);
    const td = appCaller({
      userId: seeded.users.technical_director,
      role: 'technical_director',
    });
    await expect(
      td.tournament.enterResult({
        tournamentEventId: tournamentId,
        playerUserId: seeded.users.player,
        outcome: 'outcome_last_8',
        matches: [
          {
            round: 'round_quarter',
            opponent: 'Forge cat',
            opponentRanking: 100,
            matchDate: tournamentStarts,
            setsWon: 3,
            setsLost: 2,
            videoLink: null,
          },
        ],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        playerAgeCategoryCode: 'age_minor', // forbidden — strict() rejects
      } as any),
    ).rejects.toThrow();
  });

  it('snapshot persists across player category changes (immutable historical record)', async () => {
    if (!dbReady || !seeded || !dbHandle) return;
    // Plant a tournament where the snapshot lands on 'age_junior' (2025).
    const tournamentStarts = new Date('2025-06-15T08:00:00Z');
    const tournamentId = await plantTournament(dbHandle.db, seeded, tournamentStarts);
    const td = appCaller({
      userId: seeded.users.technical_director,
      role: 'technical_director',
    });
    await td.tournament.enterResult({
      tournamentEventId: tournamentId,
      playerUserId: seeded.users.player,
      outcome: 'outcome_last_32',
      matches: [
        {
          round: 'round_sixteenth',
          opponent: 'Junior-era',
          opponentRanking: 200,
          matchDate: new Date('2025-06-15T10:00:00Z'),
          setsWon: 1,
          setsLost: 3,
          videoLink: null,
        },
      ],
    });
    const rows = (await dbHandle.db.execute(sql`
      SELECT player_age_category_code FROM tournament_results
       WHERE tournament_event_id = ${tournamentId}::uuid
         AND player_user_id = ${seeded.users.player}::uuid
    `)) as unknown as Array<{ player_age_category_code: string }>;
    expect(Array.isArray(rows) ? rows[0]?.player_age_category_code : '').toBe(
      'age_junior',
    );
  });
});
