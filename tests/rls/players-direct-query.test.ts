/**
 * RLS direct-query backstop for `players` — Plan 02-15 Task 3.
 *
 * Requirement: USER-04 — a trainer connected directly to Postgres as the
 * `app_user` role, with their UUID + role bound into `app.user_id` and
 * `app.user_role` session GUCs, MUST NOT see player rows in academies they
 * are not linked to. This is the database-layer defence behind the tRPC
 * scope checks: even if a future bug skipped the application-level filter,
 * the RLS policy blocks the rows.
 *
 * Two probes:
 *   1. trainer linked to academy_a → SELECT FROM players returns exactly the
 *      players in academy_a (1 row in the seed below).
 *   2. trainer with NO academy membership → SELECT FROM players returns 0
 *      rows.
 *
 * Strategy:
 *   - Use `freshDb()` to truncate tables.
 *   - Seed via raw `dbHandle.db` (Drizzle schema-owner connection, bypasses
 *     RLS by design — used to plant fixture rows).
 *   - Drive the probe via `rawPgAsAppUser({ userId, role })` which connects
 *     as `app_user` and binds the session GUCs inside a transaction.
 *
 * RED until Plans 02-04 (migration 0007 — players RLS policies) +
 * 02-14 (push) ship.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { freshDb, rawPgAsAppUser } from '../helpers/db';

describe('USER-04 RLS — direct DB query as trainer (Phase 2)', () => {
  let dbHandle: Awaited<ReturnType<typeof freshDb>>;
  const trainerInA = '11111111-1111-1111-1111-111111111111';
  const trainerWithNoMembership = '22222222-2222-2222-2222-222222222222';
  const playerInA = '33333333-3333-3333-3333-333333333333';
  const playerInB = '44444444-4444-4444-4444-444444444444';

  beforeAll(async () => {
    dbHandle = await freshDb();
    // Phase 1 + Phase 2 seed plant fixtures via Drizzle schema-owner (bypasses RLS).
    await dbHandle.db.execute(sql`
      INSERT INTO academy (code, canonical_name, sort_order, active)
      VALUES ('academy_a', 'Academy A', 10, true), ('academy_b', 'Academy B', 20, true)
      ON CONFLICT (code) DO NOTHING
    `);

    // Phase 2 seed — uses .planning/phases/02-... migration tables (players,
    // age_category_history, academy_memberships). The actual schema names are
    // pinned by migration 0006; this test pins them at the test layer too —
    // any drift fails fast.
    await dbHandle.db.execute(sql`
      INSERT INTO users (id, email, name, role, preferred_locale, active, email_verified, date_of_birth)
      VALUES
        (${trainerInA}, 'trainer-a@vttl.test', 'Trainer A', 'trainer', 'nl', true, true, '1985-01-01'),
        (${trainerWithNoMembership}, 'orphan@vttl.test', 'Trainer Orphan', 'trainer', 'nl', true, true, '1985-01-01'),
        (${playerInA}, 'player-a@vttl.test', 'Player A', 'player', 'nl', true, true, '2010-01-01'),
        (${playerInB}, 'player-b@vttl.test', 'Player B', 'player', 'nl', true, true, '2010-01-01')
      ON CONFLICT (id) DO NOTHING
    `);

    // academy_memberships link the trainer in A and the players to their
    // respective academies. The orphan trainer is intentionally NOT linked.
    await dbHandle.db.execute(sql`
      INSERT INTO academy_memberships (user_id, academy_code, role)
      VALUES
        (${trainerInA}, 'academy_a', 'trainer'),
        (${playerInA}, 'academy_a', 'player'),
        (${playerInB}, 'academy_b', 'player')
      ON CONFLICT DO NOTHING
    `);

    // players rows (Phase 2 table).
    await dbHandle.db.execute(sql`
      INSERT INTO players (user_id, status_code, academy_code)
      VALUES
        (${playerInA}, 'status_a', 'academy_a'),
        (${playerInB}, 'status_a', 'academy_b')
      ON CONFLICT (user_id) DO NOTHING
    `);
  });

  afterAll(async () => {
    await dbHandle[Symbol.asyncDispose]();
  });

  it('returns only academy_a players when trainer is linked to academy_a', async () => {
    await using cx = (await rawPgAsAppUser({
      userId: trainerInA,
      role: 'trainer',
    })) as Exclude<Awaited<ReturnType<typeof rawPgAsAppUser>>, unknown[]>;
    const r = await cx.query<{ user_id: string; academy_code: string }>(
      'SELECT user_id, academy_code FROM players ORDER BY user_id',
    );
    expect(r.rows.length).toBe(1);
    expect(r.rows[0]!.user_id).toBe(playerInA);
    expect(r.rows[0]!.academy_code).toBe('academy_a');
  });

  it('returns 0 rows when trainer has no academy membership (orphan)', async () => {
    await using cx = (await rawPgAsAppUser({
      userId: trainerWithNoMembership,
      role: 'trainer',
    })) as Exclude<Awaited<ReturnType<typeof rawPgAsAppUser>>, unknown[]>;
    const r = await cx.query<{ cnt: number }>('SELECT count(*)::int AS cnt FROM players');
    expect(r.rows[0]!.cnt).toBe(0);
  });

  it('returns 0 rows when the GUC is not bound (default-deny baseline)', async () => {
    // Connect WITHOUT binding any GUC — RLS evaluates with empty user/role.
    // Expected: deny-by-default (no rows leak when caller is unknown).
    const { Client } = await import('pg');
    const url = new URL(process.env.DATABASE_URL!);
    const client = new Client({
      host: url.hostname,
      port: Number(url.port),
      user: 'app_user',
      password: process.env.APP_USER_PASSWORD ?? 'app_user_pw',
      database: url.pathname.slice(1),
    });
    try {
      await client.connect();
      // No GUC binding — the policy must deny.
      const r = await client.query<{ cnt: number }>('SELECT count(*)::int AS cnt FROM players');
      expect(r.rows[0]!.cnt).toBe(0);
    } finally {
      await client.end();
    }
  });
});
