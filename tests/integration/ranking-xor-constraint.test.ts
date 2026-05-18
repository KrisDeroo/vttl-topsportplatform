/**
 * Phase 4 Wave 4 — ranking_entries XOR CHECK constraint (D-86).
 *
 * Covers D-86: DB-level CHECK constraint
 *   `ranking_entries_value_xor` enforces
 *     (value_numeric IS NOT NULL AND value_classification_code IS NULL)
 *     OR
 *     (value_numeric IS NULL AND value_classification_code IS NOT NULL)
 *
 * Defense-in-depth alongside the Zod discriminated union at the API layer.
 *
 * Analog: tests/integration/calendar-exceptions.test.ts (CHECK violation
 * 23514 probe).
 */
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { freshDb } from '../helpers/db';
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

describe('ranking_entries XOR CHECK constraint (D-86)', () => {
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

  it('INSERT with BOTH value_numeric and value_classification_code → 23514', async () => {
    if (!dbReady || !seeded || !dbHandle) return;
    await expect(
      dbHandle.db.execute(sql`
        INSERT INTO ranking_entries
          (player_user_id, ranking_type_code, recorded_at, source,
           value_numeric, value_classification_code, entered_by)
        VALUES (
          ${seeded.users.player}::uuid, 'ranking_senior_world',
          now(), 'manual', 500, 'A12',
          ${seeded.users.player}::uuid
        )
      `),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('INSERT with NEITHER value column populated → 23514', async () => {
    if (!dbReady || !seeded || !dbHandle) return;
    await expect(
      dbHandle.db.execute(sql`
        INSERT INTO ranking_entries
          (player_user_id, ranking_type_code, recorded_at, source,
           value_numeric, value_classification_code, entered_by)
        VALUES (
          ${seeded.users.player}::uuid, 'ranking_senior_world',
          now(), 'manual', NULL, NULL,
          ${seeded.users.player}::uuid
        )
      `),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('INSERT with only value_numeric succeeds for ranking_senior_world', async () => {
    if (!dbReady || !seeded || !dbHandle) return;
    const before = (await dbHandle.db.execute(sql`
      SELECT COUNT(*)::int AS c FROM ranking_entries
       WHERE player_user_id = ${seeded.users.player}::uuid
         AND ranking_type_code = 'ranking_senior_world'
         AND value_numeric = 350
    `)) as unknown as Array<{ c: number }>;
    expect(Array.isArray(before) ? before[0]?.c : 0).toBe(0);
    await dbHandle.db.execute(sql`
      INSERT INTO ranking_entries
        (player_user_id, ranking_type_code, recorded_at, source,
         value_numeric, value_classification_code, entered_by)
      VALUES (
        ${seeded.users.player}::uuid, 'ranking_senior_world',
        now(), 'manual', 350, NULL,
        ${seeded.users.player}::uuid
      )
    `);
    const after = (await dbHandle.db.execute(sql`
      SELECT COUNT(*)::int AS c FROM ranking_entries
       WHERE player_user_id = ${seeded.users.player}::uuid
         AND ranking_type_code = 'ranking_senior_world'
         AND value_numeric = 350
    `)) as unknown as Array<{ c: number }>;
    expect(Array.isArray(after) ? after[0]?.c : 0).toBe(1);
  });

  it('INSERT with only value_classification_code succeeds for ranking_belgium', async () => {
    if (!dbReady || !seeded || !dbHandle) return;
    await dbHandle.db.execute(sql`
      INSERT INTO ranking_entries
        (player_user_id, ranking_type_code, recorded_at, source,
         value_numeric, value_classification_code, entered_by)
      VALUES (
        ${seeded.users.player}::uuid, 'ranking_belgium',
        now(), 'manual', NULL, 'B0',
        ${seeded.users.player}::uuid
      )
    `);
    const rows = (await dbHandle.db.execute(sql`
      SELECT value_classification_code FROM ranking_entries
       WHERE player_user_id = ${seeded.users.player}::uuid
         AND ranking_type_code = 'ranking_belgium'
         AND value_classification_code = 'B0'
    `)) as unknown as Array<{ value_classification_code: string }>;
    expect(Array.isArray(rows) ? rows[0]?.value_classification_code : '').toBe('B0');
  });

  it('CHECK ranking_entries_numeric_positive rejects value_numeric <= 0', async () => {
    if (!dbReady || !seeded || !dbHandle) return;
    await expect(
      dbHandle.db.execute(sql`
        INSERT INTO ranking_entries
          (player_user_id, ranking_type_code, recorded_at, source,
           value_numeric, value_classification_code, entered_by)
        VALUES (
          ${seeded.users.player}::uuid, 'ranking_senior_world',
          now(), 'manual', 0, NULL,
          ${seeded.users.player}::uuid
        )
      `),
    ).rejects.toMatchObject({ code: '23514' });
  });
});
