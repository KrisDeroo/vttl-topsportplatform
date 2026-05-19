/**
 * Integration test: daily inbox dedup constraint (CR-07).
 *
 * Asserts that calling the cron function (or the equivalent INSERT SQL)
 * TWICE in the same Brussels day yields ONE row per (user_id, kind),
 * not two. The partial unique index + ON CONFLICT DO NOTHING enforce
 * the dedup at the DB layer.
 *
 * Three probes:
 *   1. Same Brussels day + same kind + same user → ONE row (dedup fires).
 *   2. Same user + different kinds → TWO rows (different kinds don't collide).
 *   3. Same user + same kind + DIFFERENT Brussels day (via +25h offset) →
 *      TWO rows (the partial unique index's Brussels-tz expression bucket
 *      changes).
 *
 * Skip-on-no-DB: when DATABASE_URL is absent or unreachable, the suite
 * skips cleanly via describe.skipIf. Once the push lands on staging, all
 * 3 it-blocks run with full assertion power.
 *
 * NOTE: imports `canConnect` inline rather than from
 * `tests/integration/_helpers.ts` — that barrel is being introduced in
 * parallel by Plan 04-10 (sibling Wave 5). Once the barrel lands, this
 * test can be consolidated.
 *
 * Reference: .planning/phases/04-kerndomein/04-VERIFICATION.md §gaps[6]
 *            .planning/phases/04-kerndomein/04-REVIEW.md §CR-07
 */
import { sql } from 'drizzle-orm';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';

import { db as rawDb } from '@/server/db/client';

import { freshDb } from '../helpers/db';
import {
  seedPhase4,
  type Phase4SeededFixtures,
} from '../fixtures/phase4-seed';

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

d('system_inbox daily dedup (CR-07)', () => {
  let dbHandle: Awaited<ReturnType<typeof freshDb>> | undefined;
  let fixtures: Phase4SeededFixtures | undefined;

  beforeAll(async () => {
    if (!dbReady) return;
    dbHandle = await freshDb();
    fixtures = await seedPhase4(dbHandle.db, { includeNullScores: true });
  });

  afterAll(async () => {
    if (dbHandle) await dbHandle[Symbol.asyncDispose]();
  });

  beforeEach(async () => {
    if (!dbReady) return;
    // Reset inbox between tests so each it-block starts clean.
    await rawDb.execute(sql`DELETE FROM system_inbox`);
  });

  it('calling the trainer-nudge INSERT twice in same Brussels day yields ONE row', async () => {
    if (!dbReady || !fixtures) return;
    const insertSql = sql`
      INSERT INTO system_inbox (user_id, kind, payload)
      SELECT
        ts.trainer_id AS user_id,
        'trainer_score_nudge' AS kind,
        jsonb_build_object('pendingCount', COUNT(*), 'generatedAt', now()) AS payload
      FROM training_sessions ts
      JOIN calendar_events ce ON ce.id = ts.event_id
      JOIN session_participants sp ON sp.event_id = ts.event_id
       AND sp.quality_score IS NULL
      WHERE ce.ends_at < now()
        AND ce.ends_at >= now() - INTERVAL '14 days'
      GROUP BY ts.trainer_id
      ON CONFLICT ON CONSTRAINT "uq_system_inbox_daily" DO NOTHING
    `;
    await rawDb.execute(insertSql);
    await rawDb.execute(insertSql); // second call same day — should dedup

    const rows = await rawDb.execute<{ user_id: string; cnt: number }>(sql`
      SELECT user_id, COUNT(*)::int AS cnt
      FROM system_inbox
      WHERE kind = 'trainer_score_nudge'
      GROUP BY user_id
    `);
    const arr = Array.isArray(rows)
      ? (rows as Array<{ user_id: string; cnt: number }>)
      : ((rows as unknown as { rows?: Array<{ user_id: string; cnt: number }> }).rows ?? []);
    for (const r of arr) {
      expect(Number(r.cnt)).toBe(1);
    }
    expect(arr.length).toBeGreaterThan(0);
  });

  it('different kinds bypass the dedup (player_result_nudge + trainer_score_nudge separately)', async () => {
    if (!dbReady || !fixtures) return;
    // Plant a trainer nudge.
    await rawDb.execute(sql`
      INSERT INTO system_inbox (user_id, kind, payload)
      VALUES (${fixtures.users.trainer}, 'trainer_score_nudge', '{"x":1}'::jsonb)
      ON CONFLICT ON CONSTRAINT "uq_system_inbox_daily" DO NOTHING
    `);
    // Plant a player nudge — different kind, NOT a dedup collision.
    await rawDb.execute(sql`
      INSERT INTO system_inbox (user_id, kind, payload)
      VALUES (${fixtures.users.trainer}, 'player_result_nudge', '{"y":2}'::jsonb)
      ON CONFLICT ON CONSTRAINT "uq_system_inbox_daily" DO NOTHING
    `);

    const rows = await rawDb.execute<{ cnt: number }>(sql`
      SELECT COUNT(*)::int AS cnt FROM system_inbox WHERE user_id = ${fixtures.users.trainer}
    `);
    const arr = Array.isArray(rows)
      ? (rows as Array<{ cnt: number }>)
      : ((rows as unknown as { rows?: Array<{ cnt: number }> }).rows ?? []);
    expect(Number(arr[0]?.cnt)).toBe(2);
  });

  it('partial unique index Brussels-tz cast: a row 25 hours later gets a fresh slot', async () => {
    if (!dbReady || !fixtures) return;
    // Insert one row with default created_at (now()).
    await rawDb.execute(sql`
      INSERT INTO system_inbox (user_id, kind, payload, created_at)
      VALUES (${fixtures.users.trainer}, 'trainer_score_nudge', '{}'::jsonb, now())
    `);
    // Insert another row with created_at = +25 hours.
    // 25h is conservative — pushes the row unambiguously into the next
    // Brussels calendar day regardless of DST.
    await rawDb.execute(sql`
      INSERT INTO system_inbox (user_id, kind, payload, created_at)
      VALUES (${fixtures.users.trainer}, 'trainer_score_nudge', '{"day2": true}'::jsonb, now() + INTERVAL '25 hours')
      ON CONFLICT ON CONSTRAINT "uq_system_inbox_daily" DO NOTHING
    `);

    const rows = await rawDb.execute<{ cnt: number }>(sql`
      SELECT COUNT(*)::int AS cnt FROM system_inbox
      WHERE user_id = ${fixtures.users.trainer} AND kind = 'trainer_score_nudge'
    `);
    const arr = Array.isArray(rows)
      ? (rows as Array<{ cnt: number }>)
      : ((rows as unknown as { rows?: Array<{ cnt: number }> }).rows ?? []);
    // 2 rows expected — different Brussels days don't collide.
    expect(Number(arr[0]?.cnt)).toBe(2);
  });
});
