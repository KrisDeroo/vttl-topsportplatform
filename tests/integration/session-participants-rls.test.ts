/**
 * Phase 4 Wave 4 — session_participants RLS (D-61).
 *
 * Covers D-61 visibility rules at the DB layer via the
 * `session_participants_visible_to(uid, role)` SECURITY DEFINER helper
 * (migration 0018):
 *
 *   - WRITE: trainer (own session) + TD
 *   - READ:  trainer + TD + academy_manager (player's academy)
 *            + player (own row) + parent (own child)
 *
 * We probe READ via the `rawPgAsAppUser` helper so RLS evaluates on a real
 * connection bound to `app.user_id` / `app.user_role`; this is the
 * canonical CRIT-2 pattern shipped with Phase 1.
 *
 * Analog: tests/integration/calendar-rls.test.ts (Phase 3 D-50 5-branch RLS).
 */
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { freshDb, rawPgAsAppUser } from '../helpers/db';
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

describe('session_participants RLS (D-61)', () => {
  let dbHandle: Awaited<ReturnType<typeof freshDb>> | undefined;
  let seeded: Phase4SeededFixtures | undefined;
  let dbReady = false;

  beforeAll(async () => {
    dbReady = await canConnect();
    if (!dbReady) return;
    dbHandle = await freshDb();
    seeded = await seedPhase4(dbHandle.db);
    // Ensure the role-matrix player has a session_participants row planted
    // (the canonical seed plants 2 rows on pastTrainingEventId; we verify
    // existence here so the assertions below are deterministic).
    if (dbHandle && seeded) {
      const rows = (await dbHandle.db.execute(sql`
        SELECT COUNT(*)::int AS c FROM session_participants
         WHERE event_id = ${seeded.pastTrainingEventId}::uuid
           AND user_id = ${seeded.users.player}::uuid
      `)) as unknown as Array<{ c: number }>;
      const c = Array.isArray(rows) ? (rows[0]?.c ?? 0) : 0;
      expect(c).toBeGreaterThanOrEqual(1);
    }
  });

  afterAll(async () => {
    if (dbHandle) await dbHandle[Symbol.asyncDispose]();
  });

  it('player sees own session_participants row (READ)', async () => {
    if (!dbReady || !seeded) return;
    const rows = await rawPgAsAppUser<{ user_id: string }>({
      userId: seeded.users.player,
      role: 'player',
      sql: `SELECT user_id::text FROM session_participants
             WHERE event_id = $1
               AND user_id = $2`,
      params: [seeded.pastTrainingEventId, seeded.users.player],
    });
    expect(Array.isArray(rows) ? rows.length : 0).toBeGreaterThanOrEqual(1);
  });

  it('trainer of session sees all rows for that session (READ)', async () => {
    if (!dbReady || !seeded) return;
    const rows = await rawPgAsAppUser<{ user_id: string }>({
      userId: seeded.users.trainer,
      role: 'trainer',
      sql: `SELECT user_id::text FROM session_participants
             WHERE event_id = $1`,
      params: [seeded.pastTrainingEventId],
    });
    expect(Array.isArray(rows) ? rows.length : 0).toBeGreaterThanOrEqual(2);
  });

  it('academy_manager of player\'s academy sees the row (READ)', async () => {
    if (!dbReady || !seeded) return;
    const rows = await rawPgAsAppUser<{ user_id: string }>({
      userId: seeded.users.academy_manager,
      role: 'academy_manager',
      sql: `SELECT user_id::text FROM session_participants
             WHERE event_id = $1
               AND user_id = $2`,
      params: [seeded.pastTrainingEventId, seeded.users.player],
    });
    expect(Array.isArray(rows) ? rows.length : 0).toBeGreaterThanOrEqual(1);
  });

  it('parent of minor player sees the row (READ)', async () => {
    if (!dbReady || !seeded || !dbHandle) return;
    // The seedRolesMatrix parent is linked to victimId, not the role-matrix
    // player. Plant a parent_child_links row from `parent` → `player` so
    // the parent branch lights up for our pastTrainingEventId fixture.
    await dbHandle.db.execute(sql`
      INSERT INTO parent_child_links
        (parent_user_id, child_user_id, consent_given_at, linked_by)
      VALUES (
        ${seeded.users.parent}::uuid, ${seeded.users.player}::uuid,
        now(), ${seeded.users.technical_director}::uuid
      )
      ON CONFLICT DO NOTHING
    `);

    const rows = await rawPgAsAppUser<{ user_id: string }>({
      userId: seeded.users.parent,
      role: 'parent',
      sql: `SELECT user_id::text FROM session_participants
             WHERE event_id = $1
               AND user_id = $2`,
      params: [seeded.pastTrainingEventId, seeded.users.player],
    });
    // Parent visibility may depend on the implementation pulling the child
    // user_id via parent_child_links. The RLS policy is asymmetric — in
    // Phase 4 D-61 the parent CAN read session_participants of their child.
    expect(Array.isArray(rows) ? rows.length : 0).toBeGreaterThanOrEqual(1);
  });

  it('cross-academy trainer CANNOT see the row', async () => {
    if (!dbReady || !seeded || !dbHandle) return;
    // Plant a fresh trainer in academy B (cross-academy of the
    // pastTrainingEventId's player). The trainer should NOT see the row.
    const crossTrainerRows = (await dbHandle.db.execute(sql`
      INSERT INTO users (email, name, role, preferred_locale,
                          date_of_birth, active, email_verified)
      VALUES (
        'seed-phase4-cross-trainer@vttl.test', 'Cross Trainer', 'trainer',
        'nl', '1990-01-01', true, true
      )
      ON CONFLICT (email) DO UPDATE SET email = excluded.email
      RETURNING id::text
    `)) as unknown as Array<{ id: string }>;
    const crossTrainerId = (Array.isArray(crossTrainerRows)
      ? crossTrainerRows[0]?.id
      : undefined);
    if (!crossTrainerId) {
      throw new Error('Failed to plant cross-academy trainer');
    }
    await dbHandle.db.execute(sql`
      INSERT INTO academy_memberships (user_id, academy_code, role, linked_by)
      VALUES (${crossTrainerId}::uuid, ${seeded.academyB}, 'trainer',
              ${seeded.users.technical_director}::uuid)
      ON CONFLICT DO NOTHING
    `);

    const rows = await rawPgAsAppUser<{ user_id: string }>({
      userId: crossTrainerId,
      role: 'trainer',
      sql: `SELECT user_id::text FROM session_participants
             WHERE event_id = $1`,
      params: [seeded.pastTrainingEventId],
    });
    expect(Array.isArray(rows) ? rows.length : 0).toBe(0);
  });

  it.todo('player CANNOT write/update own session_participants row (D-61 — trainer/TD only write)');
});
