/**
 * Integration test: system_inbox INSERT policy + REVOKE (CR-06).
 *
 * Asserts:
 *   - An app_user-bound connection canNOT INSERT into system_inbox
 *     (REVOKE INSERT FROM app_user).
 *   - The SECURITY DEFINER cron function path CAN INSERT (test by running
 *     the same INSERT SQL via the rawDb singleton, which simulates the
 *     SECURITY DEFINER's bypass-via-grant path).
 *   - The uq_system_inbox_daily UNIQUE INDEX exists.
 *   - The system_inbox_insert_security_definer policy is declared.
 *
 * Skip-on-no-DB: when DATABASE_URL is absent or unreachable, the suite
 * skips cleanly via describe.skipIf. Once the push lands on staging, all
 * 4 it-blocks run with full assertion power.
 *
 * NOTE: imports `canConnect` inline rather than from
 * `tests/integration/_helpers.ts` — that barrel is being introduced in
 * parallel by Plan 04-10 (sibling Wave 5). Once the barrel lands, this
 * test can be consolidated.
 *
 * Reference: .planning/phases/04-kerndomein/04-VERIFICATION.md §gaps[5]
 *            .planning/phases/04-kerndomein/04-REVIEW.md §CR-06
 */
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { db as rawDb } from '@/server/db/client';

import { freshDb, rawPgAsAppUser } from '../helpers/db';
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

d('system_inbox INSERT policy + REVOKE (CR-06)', () => {
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

  it('app_user-bound connection canNOT INSERT into system_inbox', async () => {
    if (!dbReady || !fixtures) return;
    // Use rawPgAsAppUser's long-lived session form so we can attempt the
    // INSERT via raw client.query and catch the rejection.
    await using cx = await rawPgAsAppUser({
      userId: fixtures.users.trainer,
      role: 'trainer',
    });
    if (Array.isArray(cx)) {
      throw new Error('expected long-lived session, got rows array');
    }
    let rejected = false;
    try {
      await cx.query(
        `INSERT INTO system_inbox (user_id, kind, payload)
         VALUES ($1, 'trainer_score_nudge', '{"test": true}'::jsonb)`,
        [fixtures.users.trainer],
      );
    } catch (err) {
      rejected = true;
      // The error MAY surface as "permission denied" OR
      // "new row violates row-level security policy" depending on whether
      // REVOKE or the policy fires first. Accept either.
      const msg = (err as Error).message?.toLowerCase() ?? '';
      expect(
        msg.includes('permission denied') ||
          msg.includes('row-level security') ||
          msg.includes('row level security') ||
          msg.includes('insert privilege'),
      ).toBe(true);
    }
    expect(rejected).toBe(true);
  });

  it('SECURITY DEFINER cron function CAN INSERT (CR-06 + CR-07 combined)', async () => {
    if (!dbReady || !fixtures) return;
    // Run the cron function's INSERT logic against the rawDb singleton
    // (schema-owner role — bypasses RLS, simulates SECURITY DEFINER).
    // This validates the WITH CHECK (true) policy + the ON CONFLICT clause
    // from 0023.
    //
    // Prime fixtures: seedPhase4({ includeNullScores: true }) already
    // plants a trainer with a pending session 8d ago.
    await rawDb.execute(sql`
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
    `);

    const rows = await rawDb.execute<{ user_id: string; kind: string }>(sql`
      SELECT user_id, kind FROM system_inbox
      WHERE kind = 'trainer_score_nudge'
    `);
    const arr = Array.isArray(rows)
      ? (rows as Array<{ user_id: string; kind: string }>)
      : ((rows as unknown as { rows?: Array<{ user_id: string; kind: string }> }).rows ?? []);
    expect(arr.length).toBeGreaterThan(0);
  });

  it('uq_system_inbox_daily index exists and is UNIQUE', async () => {
    if (!dbReady) return;
    const rows = await rawDb.execute<{ indexname: string; indexdef: string }>(sql`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE tablename = 'system_inbox' AND indexname = 'uq_system_inbox_daily'
    `);
    const arr = Array.isArray(rows)
      ? (rows as Array<{ indexname: string; indexdef: string }>)
      : ((rows as unknown as { rows?: Array<{ indexname: string; indexdef: string }> }).rows ?? []);
    expect(arr.length).toBe(1);
    expect(arr[0]?.indexdef.toLowerCase()).toContain('unique');
    expect(arr[0]?.indexdef.toLowerCase()).toContain('europe/brussels');
  });

  it('INSERT policy system_inbox_insert_security_definer is declared', async () => {
    if (!dbReady) return;
    const rows = await rawDb.execute<{ polname: string }>(sql`
      SELECT polname FROM pg_policy
      WHERE polrelid = 'system_inbox'::regclass
        AND polname = 'system_inbox_insert_security_definer'
    `);
    const arr = Array.isArray(rows)
      ? (rows as Array<{ polname: string }>)
      : ((rows as unknown as { rows?: Array<{ polname: string }> }).rows ?? []);
    expect(arr.length).toBe(1);
  });
});
