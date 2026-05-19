/**
 * Integration test: idempotency middleware input binding (CR-02).
 *
 * Verifies the VALID-08 contract:
 *   - Same key + same input within 24h → cache HIT replay (existing
 *     behaviour, regression check).
 *   - Same key + DIFFERENT input within 24h → CONFLICT (errors.idempotency.inputMismatch).
 *   - Different key + same input → cache MISS, fresh handler execution.
 *   - Object-key-order shuffle with same logical input → cache HIT replay
 *     (canonicalisation invariance).
 *
 * Reference: .planning/phases/04-kerndomein/04-VERIFICATION.md §gaps[1]
 *            .planning/phases/04-kerndomein/04-REVIEW.md §CR-02
 *
 * NOTE: Plan 04-11 nominally imports `canConnect`/`freshDb` from
 * `./_helpers`, a barrel owned by Plan 04-10 (sibling Wave 5 plan). At
 * authoring time `./_helpers` does not yet exist in this worktree, so the
 * helpers are inlined using the same canConnect pattern as the existing
 * tests/integration/idempotency-tournament.test.ts. Once Plan 04-10 lands
 * its barrel on main, this file can be refactored to use it.
 */
import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { freshDb } from '../helpers/db';
import {
  seedPhase4,
  type Phase4SeededFixtures,
} from '../fixtures/phase4-seed';
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

const dbReady = await canConnect();
const d = describe.skipIf(!dbReady);

d('idempotency-input-binding (CR-02)', () => {
  let dbHandle: Awaited<ReturnType<typeof freshDb>> | undefined;
  let fixtures: Phase4SeededFixtures | undefined;
  // Test-owned future-tournament event (NOT in phase4-seed — the seed only
  // plants past-tournament fixtures).
  let upcomingTournamentEventId: string;

  beforeAll(async () => {
    if (!dbReady) return;
    dbHandle = await freshDb();
    fixtures = await seedPhase4(dbHandle.db, { includeTournamentResults: false });

    // Plant a future tournament event (ends 1 hour from now — well within
    // the 14d wall so enterResult succeeds on the happy path).
    upcomingTournamentEventId = randomUUID();
    const startsAt = new Date(Date.now() + 60 * 60 * 1000);
    const endsAt = new Date(startsAt.getTime() + 60 * 60 * 1000);

    await dbHandle.db.execute(sql`
      INSERT INTO calendar_events
        (id, type_code, title, starts_at, ends_at, all_day, created_by)
      VALUES (
        ${upcomingTournamentEventId}::uuid,
        'event_type_tournament',
        'CR-02 upcoming tournament fixture',
        ${startsAt.toISOString()},
        ${endsAt.toISOString()},
        false,
        ${fixtures.users.technical_director}::uuid
      )
    `);
    await dbHandle.db.execute(sql`
      INSERT INTO tournaments
        (event_id, city, country, age_category_code, tournament_type_code)
      VALUES (
        ${upcomingTournamentEventId}::uuid,
        'Brussels', 'BE', 'age_senior', 'tournament_belgium'
      )
    `);
    await dbHandle.db.execute(sql`
      INSERT INTO calendar_event_participants
        (event_id, user_id, role_in_event, rsvp_status)
      VALUES
        (${upcomingTournamentEventId}::uuid, ${fixtures.users.player}::uuid, 'participant', 'accepted')
    `);
  });

  afterAll(async () => {
    if (dbHandle) await dbHandle[Symbol.asyncDispose]();
  });

  it('same key + same input → replays cached response', async () => {
    if (!dbReady || !fixtures) return;
    const caller = appCaller({
      userId: fixtures.users.player,
      role: 'player',
    });
    const key = 'test-cr02-same-' + Date.now();
    const input = {
      tournamentEventId: upcomingTournamentEventId,
      playerUserId: fixtures.users.player,
      outcome: 'outcome_winner' as const,
      matches: [
        {
          round: 'round_final' as const,
          opponent: 'Test Opponent',
          opponentRanking: null,
          matchDate: new Date(),
          setsWon: 3,
          setsLost: 1,
          videoLink: null,
        },
      ],
      _meta: { idempotencyKey: key },
    };
    const first = await caller.tournament.enterResult(input);
    expect(first.ok).toBe(true);

    // Replay same input — should hit cache.
    const replay = await caller.tournament.enterResult(input);
    expect(
      (replay as unknown as { __idempotency_replay?: boolean }).__idempotency_replay,
    ).toBe(true);
  });

  it('same key + DIFFERENT input → CONFLICT', async () => {
    if (!dbReady || !fixtures) return;
    const caller = appCaller({
      userId: fixtures.users.player,
      role: 'player',
    });
    const key = 'test-cr02-diff-' + Date.now();
    const baseInput = {
      tournamentEventId: upcomingTournamentEventId,
      playerUserId: fixtures.users.player,
      outcome: 'outcome_winner' as const,
      matches: [
        {
          round: 'round_final' as const,
          opponent: 'Test Opponent A',
          opponentRanking: null,
          matchDate: new Date(),
          setsWon: 3,
          setsLost: 1,
          videoLink: null,
        },
      ],
      _meta: { idempotencyKey: key },
    };
    await caller.tournament.enterResult(baseInput);

    // Same key, different outcome — must reject CONFLICT.
    const mutated = {
      ...baseInput,
      outcome: 'outcome_last_16' as const,
    };
    await expect(caller.tournament.enterResult(mutated)).rejects.toMatchObject({
      code: 'CONFLICT',
      message: 'errors.idempotency.inputMismatch',
    });

    // Also verify mutating a different field (matches[].opponent) triggers CONFLICT.
    const mutated2 = {
      ...baseInput,
      matches: [{ ...baseInput.matches[0]!, opponent: 'Different Opponent' }],
    };
    await expect(caller.tournament.enterResult(mutated2)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('different key + same input → cache MISS, fresh execution', async () => {
    if (!dbReady || !fixtures) return;
    const caller = appCaller({
      userId: fixtures.users.player,
      role: 'player',
    });
    const baseInput = {
      tournamentEventId: upcomingTournamentEventId,
      playerUserId: fixtures.users.player,
      outcome: 'outcome_winner' as const,
      matches: [
        {
          round: 'round_final' as const,
          opponent: 'Opp',
          opponentRanking: null,
          matchDate: new Date(),
          setsWon: 3,
          setsLost: 0,
          videoLink: null,
        },
      ],
      _meta: { idempotencyKey: 'first-key-' + Date.now() },
    };
    const first = await caller.tournament.enterResult(baseInput);
    expect(first.ok).toBe(true);

    // Different key, same logical input — cache MISS, fresh execution.
    const secondInput = {
      ...baseInput,
      _meta: { idempotencyKey: 'second-key-' + Date.now() },
    };
    const second = await caller.tournament.enterResult(secondInput);
    expect(
      (second as unknown as { __idempotency_replay?: boolean }).__idempotency_replay,
    ).toBeUndefined();
    expect(second.ok).toBe(true);
  });

  it('canonicalisation: object key order does not affect hash', async () => {
    if (!dbReady || !fixtures) return;
    const caller = appCaller({
      userId: fixtures.users.player,
      role: 'player',
    });
    const key = 'test-cr02-order-' + Date.now();
    const matchDate = new Date();
    const inputA = {
      tournamentEventId: upcomingTournamentEventId,
      playerUserId: fixtures.users.player,
      outcome: 'outcome_winner' as const,
      matches: [
        {
          round: 'round_final' as const,
          opponent: 'X',
          opponentRanking: null,
          matchDate,
          setsWon: 3,
          setsLost: 0,
          videoLink: null,
        },
      ],
      _meta: { idempotencyKey: key },
    };
    await caller.tournament.enterResult(inputA);
    // Same data, different key order at JS layer — middleware canonicalises
    // so hash matches.
    const inputB = {
      _meta: { idempotencyKey: key },
      matches: inputA.matches,
      outcome: 'outcome_winner' as const,
      playerUserId: fixtures.users.player,
      tournamentEventId: upcomingTournamentEventId,
    };
    const replay = await caller.tournament.enterResult(inputB);
    expect(
      (replay as unknown as { __idempotency_replay?: boolean }).__idempotency_replay,
    ).toBe(true);
  });
});
