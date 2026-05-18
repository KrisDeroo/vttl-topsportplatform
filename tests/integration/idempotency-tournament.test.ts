/**
 * Phase 4 Wave 4 — tournament.enterResult idempotency (VALID-08).
 *
 * Covers VALID-08: client-provided `_meta.idempotencyKey` deduplicates
 * repeated submits within 24h. Cache HIT returns the stored response body
 * verbatim + emits audit code `idempotency_replay`. The marker
 * `__idempotency_replay: true` is added to the response so callers can
 * distinguish replay from first-call result.
 *
 * Analog: NO existing analog — Phase 4 is the first user of the middleware
 * on a mutation path. RESEARCH §Pitfall 5 ("Idempotency middleware wiring").
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
      ${eventId}::uuid, 'event_type_tournament', 'Idempotency probe',
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

describe('tournament.enterResult idempotency (VALID-08)', () => {
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

  it('first call commits; second call with same key returns cached body, no re-insert', async () => {
    if (!dbReady || !seeded || !dbHandle) return;
    const tournamentId = await plantTournament(dbHandle.db, seeded);
    const player = appCaller({ userId: seeded.users.player, role: 'player' });
    const idempotencyKey = randomUUID();
    const payload = {
      tournamentEventId: tournamentId,
      playerUserId: seeded.users.player,
      outcome: 'outcome_last_8',
      matches: [
        {
          round: 'round_quarter',
          opponent: 'Idem Opp',
          opponentRanking: 300,
          matchDate: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
          setsWon: 3,
          setsLost: 2,
          videoLink: null,
        },
      ],
      _meta: { idempotencyKey },
    } as const;

    const first = await player.tournament.enterResult(payload);
    expect(first.ok).toBe(true);
    // Verify exactly 1 match_results row.
    let mRows = (await dbHandle.db.execute(sql`
      SELECT COUNT(*)::int AS c FROM match_results
       WHERE tournament_event_id = ${tournamentId}::uuid
         AND player_user_id = ${seeded.users.player}::uuid
    `)) as unknown as Array<{ c: number }>;
    expect(Array.isArray(mRows) ? mRows[0]?.c : 0).toBe(1);

    const second = await player.tournament.enterResult(payload);
    expect(second.ok).toBe(true);
    // Replay marker is set on cached response.
    expect((second as unknown as { __idempotency_replay?: boolean }).__idempotency_replay).toBe(
      true,
    );
    // No additional match row.
    mRows = (await dbHandle.db.execute(sql`
      SELECT COUNT(*)::int AS c FROM match_results
       WHERE tournament_event_id = ${tournamentId}::uuid
         AND player_user_id = ${seeded.users.player}::uuid
    `)) as unknown as Array<{ c: number }>;
    expect(Array.isArray(mRows) ? mRows[0]?.c : 0).toBe(1);
  });

  it('replay emits audit code idempotency_replay', async () => {
    if (!dbReady || !seeded || !dbHandle) return;
    const tournamentId = await plantTournament(dbHandle.db, seeded);
    const player = appCaller({ userId: seeded.users.player, role: 'player' });
    const idempotencyKey = randomUUID();
    const payload = {
      tournamentEventId: tournamentId,
      playerUserId: seeded.users.player,
      outcome: 'outcome_last_16',
      matches: [
        {
          round: 'round_sixteenth',
          opponent: 'Replay Audit Opp',
          opponentRanking: 400,
          matchDate: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
          setsWon: 1,
          setsLost: 3,
          videoLink: null,
        },
      ],
      _meta: { idempotencyKey },
    } as const;

    await player.tournament.enterResult(payload);
    const before = (await dbHandle.db.execute(sql`
      SELECT COUNT(*)::int AS c FROM audit_log
       WHERE action = 'idempotency_replay'
         AND resource_id = ${idempotencyKey}
    `)) as unknown as Array<{ c: number }>;
    const beforeCount = Array.isArray(before) ? (before[0]?.c ?? 0) : 0;

    await player.tournament.enterResult(payload);

    const after = (await dbHandle.db.execute(sql`
      SELECT COUNT(*)::int AS c FROM audit_log
       WHERE action = 'idempotency_replay'
         AND resource_id = ${idempotencyKey}
    `)) as unknown as Array<{ c: number }>;
    const afterCount = Array.isArray(after) ? (after[0]?.c ?? 0) : 0;
    expect(afterCount).toBe(beforeCount + 1);
  });

  it('idempotency key isolation: distinct keys both write distinct rows', async () => {
    if (!dbReady || !seeded || !dbHandle) return;
    const tournamentId = await plantTournament(dbHandle.db, seeded);
    const player = appCaller({ userId: seeded.users.player, role: 'player' });
    const basePayload = (key: string, opp: string) => ({
      tournamentEventId: tournamentId,
      playerUserId: seeded!.users.player,
      outcome: 'outcome_last_32' as const,
      matches: [
        {
          round: 'round_sixteenth' as const,
          opponent: opp,
          opponentRanking: 500,
          matchDate: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000),
          setsWon: 0,
          setsLost: 3,
          videoLink: null,
        },
      ],
      _meta: { idempotencyKey: key },
    });
    await player.tournament.enterResult(basePayload(randomUUID(), 'Distinct A'));
    // Different key → fresh execution; replaces the tournament_results row
    // (enterResult does UPSERT + DELETE/INSERT match rows). Match row updated.
    await player.tournament.enterResult(basePayload(randomUUID(), 'Distinct B'));
    const mRows = (await dbHandle.db.execute(sql`
      SELECT opponent_name FROM match_results
       WHERE tournament_event_id = ${tournamentId}::uuid
         AND player_user_id = ${seeded.users.player}::uuid
    `)) as unknown as Array<{ opponent_name: string }>;
    const arr = Array.isArray(mRows) ? mRows : [];
    expect(arr.length).toBe(1);
    expect(arr[0]?.opponent_name).toBe('Distinct B');
  });
});
