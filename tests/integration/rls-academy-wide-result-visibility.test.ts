/**
 * Phase 4 Wave 4 — tournament_result D-78 5-branch UNION RLS.
 *
 * Covers D-78 academy-wide tournament_result visibility via the SECURITY
 * DEFINER `tournament_result_visible_to(caller_id, caller_role)` helper
 * (migration 0018). Five UNION branches:
 *
 *   - Branch 1: TD (all)
 *   - Branch 2: own results (player_user_id = caller_id)
 *   - Branch 3: trainer/academy_manager via academy_memberships JOIN
 *   - Branch 4: parent via parent_child_links JOIN
 *   - Branch 5: NET-NEW — players sharing an academy with subject
 *               ("leaderboard energy" — D-78)
 *
 * Branch 5 is the critical net-new assertion: an academy peer of player A
 * SEES player A's results; a cross-academy player DOES NOT.
 *
 * Analog: tests/integration/calendar-rls.test.ts (Phase 3 D-50 5-branch RLS).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { freshDb, rawPgAsAppUser } from '../helpers/db';
import { seedPhase4, type Phase4SeededFixtures } from '../fixtures/phase4-seed';
import { sql } from 'drizzle-orm';

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

describe('tournament_result RLS — 5-branch UNION (D-78)', () => {
  let dbHandle: Awaited<ReturnType<typeof freshDb>> | undefined;
  let seeded: Phase4SeededFixtures | undefined;
  let dbReady = false;

  beforeAll(async () => {
    dbReady = await canConnect();
    if (!dbReady) return;
    dbHandle = await freshDb();
    seeded = await seedPhase4(dbHandle.db);
    // Plant parent_child_links from `parent` → `player` so Branch 4
    // (parent of subject) has data to assert.
    if (dbHandle && seeded) {
      await dbHandle.db.execute(sql`
        INSERT INTO parent_child_links
          (parent_user_id, child_user_id, consent_given_at, linked_by)
        VALUES (
          ${seeded.users.parent}::uuid, ${seeded.users.player}::uuid,
          now(), ${seeded.users.technical_director}::uuid
        )
        ON CONFLICT DO NOTHING
      `);
    }
  });

  afterAll(async () => {
    if (dbHandle) await dbHandle[Symbol.asyncDispose]();
  });

  /**
   * Returns the count of tournament_results rows visible to the given
   * (userId, role) under RLS via the `app_user` Postgres role binding.
   */
  async function visibleCount(
    userId: string,
    role: string,
    tournamentEventId: string,
    playerUserId: string,
  ): Promise<number> {
    const rows = await rawPgAsAppUser<{ c: number }>({
      userId,
      role,
      sql: `SELECT COUNT(*)::int AS c FROM tournament_results
             WHERE tournament_event_id = $1
               AND player_user_id = $2`,
      params: [tournamentEventId, playerUserId],
    });
    return Array.isArray(rows) ? Number(rows[0]?.c ?? 0) : 0;
  }

  it('Branch 1: TD sees the tournament_results row', async () => {
    if (!dbReady || !seeded) return;
    const c = await visibleCount(
      seeded.users.technical_director,
      'technical_director',
      seeded.tournamentEntryWithMatchesEventId,
      seeded.users.player,
    );
    expect(c).toBe(1);
  });

  it('Branch 2: own row — player sees own tournament_results', async () => {
    if (!dbReady || !seeded) return;
    const c = await visibleCount(
      seeded.users.player,
      'player',
      seeded.tournamentEntryWithMatchesEventId,
      seeded.users.player,
    );
    expect(c).toBe(1);
  });

  it('Branch 3a: trainer in player\'s academy sees the row', async () => {
    if (!dbReady || !seeded) return;
    const c = await visibleCount(
      seeded.users.trainer,
      'trainer',
      seeded.tournamentEntryWithMatchesEventId,
      seeded.users.player,
    );
    expect(c).toBe(1);
  });

  it('Branch 3b: academy_manager in player\'s academy sees the row', async () => {
    if (!dbReady || !seeded) return;
    const c = await visibleCount(
      seeded.users.academy_manager,
      'academy_manager',
      seeded.tournamentEntryWithMatchesEventId,
      seeded.users.player,
    );
    expect(c).toBe(1);
  });

  it('Branch 4: parent of subject sees the row', async () => {
    if (!dbReady || !seeded) return;
    const c = await visibleCount(
      seeded.users.parent,
      'parent',
      seeded.tournamentEntryWithMatchesEventId,
      seeded.users.player,
    );
    expect(c).toBeGreaterThanOrEqual(1);
  });

  it('Branch 5 (NET-NEW D-78): same-academy peer sees the row', async () => {
    if (!dbReady || !seeded) return;
    // playerA2 is in academy A — same as the role-matrix player.
    const c = await visibleCount(
      seeded.extraUsers.playerA2,
      'player',
      seeded.tournamentEntryWithMatchesEventId,
      seeded.users.player,
    );
    expect(c).toBe(1);
  });

  it('Branch 5 negative: cross-academy player CANNOT see the row', async () => {
    if (!dbReady || !seeded) return;
    // playerB is in academy B — different from player.
    const c = await visibleCount(
      seeded.extraUsers.playerB,
      'player',
      seeded.tournamentEntryWithMatchesEventId,
      seeded.users.player,
    );
    expect(c).toBe(0);
  });

  it('sparring_partner has no Branch — does not see the row', async () => {
    if (!dbReady || !seeded) return;
    const c = await visibleCount(
      seeded.users.sparring_partner,
      'sparring_partner',
      seeded.tournamentEntryWithMatchesEventId,
      seeded.users.player,
    );
    expect(c).toBe(0);
  });
});
