/**
 * Integration tests for age_category_history — Plan 02-15 Task 2.
 *
 * Requirements covered: DOM-CAT-01 (history primitive), Pitfall 6
 * (parallel setAgeCategory race — SERIALIZABLE prevents dueling currents).
 *
 * The contract:
 *   - Each player has exactly one open row (effective_to IS NULL) at any time.
 *   - setAgeCategory closes the open row (sets effective_to = newRow.effective_from)
 *     and inserts a new open row, inside a single SERIALIZABLE transaction.
 *   - Concurrent setAgeCategory calls SERIALIZE — one wins, the other retries or
 *     errors with a serialization failure. Test: 5 concurrent calls → exactly
 *     ONE open row exists in the end.
 *   - getAgeCategoryAt(playerId, date):
 *       - date < first.effective_from → null
 *       - date inside any interval → return that row
 *       - date >= newest.effective_from with effective_to NULL → newest
 *
 * RED until Plans 02-04 + 02-09 + 02-14 ship.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { freshDb } from '../helpers/db';
import { appCaller } from '../helpers/trpc';
import { seedRolesMatrix } from '../helpers/seed';

describe('age_category_history — DOM-CAT-01 + Pitfall 6 race', () => {
  let dbHandle: Awaited<ReturnType<typeof freshDb>>;
  let seeded: Awaited<ReturnType<typeof seedRolesMatrix>>;

  beforeAll(async () => {
    dbHandle = await freshDb();
    seeded = await seedRolesMatrix(dbHandle.db);
  });

  afterAll(async () => {
    await dbHandle[Symbol.asyncDispose]();
  });

  it('single setAgeCategory → closes old row, inserts new open row', async () => {
    const td = appCaller({ userId: seeded.users.technical_director, role: 'technical_director' });
    // First override: 2026 → age_minor.
    await td.player.setAgeCategory({
      playerId: seeded.victimId,
      ageCategoryCode: 'age_minor',
      categoryYear: 2026,
      effectiveFrom: '2026-01-01',
    });
    // Second override: 2026 → age_youth.
    await td.player.setAgeCategory({
      playerId: seeded.victimId,
      ageCategoryCode: 'age_youth',
      categoryYear: 2026,
      effectiveFrom: '2026-06-01',
    });

    const rows = await dbHandle.db.execute(sql`
      SELECT age_category_code, effective_from, effective_to
      FROM age_category_history
      WHERE player_id = ${seeded.victimId}
      ORDER BY effective_from ASC
    `);
    const fetched = rows as unknown as Array<{
      age_category_code: string;
      effective_from: string;
      effective_to: string | null;
    }>;
    expect(fetched.length).toBeGreaterThanOrEqual(2);
    // The oldest is closed.
    expect(fetched[0]!.effective_to).not.toBeNull();
    // Exactly one open row.
    const open = fetched.filter((r) => r.effective_to === null);
    expect(open).toHaveLength(1);
    expect(open[0]!.age_category_code).toBe('age_youth');
  });

  it('getAgeCategoryAt — point-in-time semantics', async () => {
    const td = appCaller({ userId: seeded.users.technical_director, role: 'technical_director' });
    // Date BEFORE the first effective_from returns null.
    const r1 = await td.player.getAgeCategoryAt({
      playerId: seeded.victimId,
      date: '2020-01-01',
    });
    expect(r1).toBeNull();

    // Date inside the first interval [2026-01-01, 2026-06-01) returns age_minor.
    const r2 = await td.player.getAgeCategoryAt({
      playerId: seeded.victimId,
      date: '2026-03-15',
    });
    expect((r2 as { ageCategoryCode: string }).ageCategoryCode).toBe('age_minor');

    // Date inside the second interval [2026-06-01, ∞) returns age_youth.
    const r3 = await td.player.getAgeCategoryAt({
      playerId: seeded.victimId,
      date: '2026-09-01',
    });
    expect((r3 as { ageCategoryCode: string }).ageCategoryCode).toBe('age_youth');
  });

  it('Pitfall 6: parallel setAgeCategory race → exactly one open row (SERIALIZABLE prevents dueling currents)', async () => {
    const td = appCaller({ userId: seeded.users.technical_director, role: 'technical_director' });
    // Reset history for the victim.
    await dbHandle.db.execute(sql`
      DELETE FROM age_category_history WHERE player_id = ${seeded.victimId}
    `);
    // Seed one open row first so the close-then-insert path is exercised.
    await td.player.setAgeCategory({
      playerId: seeded.victimId,
      ageCategoryCode: 'age_minor',
      categoryYear: 2026,
      effectiveFrom: '2026-01-01',
    });

    // Fire 5 setAgeCategory calls concurrently with different codes.
    // SERIALIZABLE should serialize them; some will retry (per Drizzle helper)
    // or throw 40001 — but the end state MUST be exactly one open row.
    const concurrent = await Promise.allSettled(
      ['age_youth', 'age_senior', 'age_pre_minor', 'age_minor', 'age_youth'].map((code, idx) =>
        td.player.setAgeCategory({
          playerId: seeded.victimId,
          ageCategoryCode: code,
          categoryYear: 2026,
          effectiveFrom: `2026-0${(idx % 9) + 1}-15`,
        }),
      ),
    );
    // At least one resolved successfully.
    expect(concurrent.some((r) => r.status === 'fulfilled')).toBe(true);

    const openRows = await dbHandle.db.execute(sql`
      SELECT count(*) AS cnt FROM age_category_history
      WHERE player_id = ${seeded.victimId} AND effective_to IS NULL
    `);
    const open = openRows as unknown as Array<{ cnt: number | string }>;
    const openCount = Number(open[0]!.cnt);
    expect(openCount).toBe(1);
  });
});
