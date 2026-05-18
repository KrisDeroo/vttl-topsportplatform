/**
 * Phase 4 Wave 4 — ranking.addEntry idempotency (VALID-08).
 *
 * Covers VALID-08 on the ranking path. Same shape as
 * idempotency-tournament.test.ts — distinct route, distinct cache-key
 * namespace (endpoint='ranking.addEntry').
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

describe('ranking.addEntry idempotency (VALID-08)', () => {
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
    const player = appCaller({ userId: seeded.users.player, role: 'player' });
    const idempotencyKey = randomUUID();
    const payload = {
      playerUserId: seeded.users.player,
      rankingTypeCode: 'ranking_senior_world' as const,
      recordedAt: new Date(),
      source: 'manual' as const,
      value: { kind: 'numeric' as const, value: 260 },
      _meta: { idempotencyKey },
    };

    // Pre-state: count.
    const before = (await dbHandle.db.execute(sql`
      SELECT COUNT(*)::int AS c FROM ranking_entries
       WHERE player_user_id = ${seeded.users.player}::uuid
         AND value_numeric = 260
    `)) as unknown as Array<{ c: number }>;
    const beforeCount = Array.isArray(before) ? (before[0]?.c ?? 0) : 0;

    const first = await player.ranking.addEntry(payload);
    expect(first.ok).toBe(true);

    const second = await player.ranking.addEntry(payload);
    expect(second.ok).toBe(true);
    expect((second as unknown as { __idempotency_replay?: boolean }).__idempotency_replay).toBe(
      true,
    );

    // Row count grew by exactly 1, not 2.
    const after = (await dbHandle.db.execute(sql`
      SELECT COUNT(*)::int AS c FROM ranking_entries
       WHERE player_user_id = ${seeded.users.player}::uuid
         AND value_numeric = 260
    `)) as unknown as Array<{ c: number }>;
    const afterCount = Array.isArray(after) ? (after[0]?.c ?? 0) : 0;
    expect(afterCount).toBe(beforeCount + 1);
  });

  it('replay emits audit code idempotency_replay (one row per replay hit)', async () => {
    if (!dbReady || !seeded || !dbHandle) return;
    const player = appCaller({ userId: seeded.users.player, role: 'player' });
    const idempotencyKey = randomUUID();
    const payload = {
      playerUserId: seeded.users.player,
      rankingTypeCode: 'ranking_senior_world' as const,
      recordedAt: new Date(),
      source: 'manual' as const,
      value: { kind: 'numeric' as const, value: 290 },
      _meta: { idempotencyKey },
    };

    await player.ranking.addEntry(payload);
    const before = (await dbHandle.db.execute(sql`
      SELECT COUNT(*)::int AS c FROM audit_log
       WHERE action = 'idempotency_replay'
         AND resource_id = ${idempotencyKey}
    `)) as unknown as Array<{ c: number }>;
    const beforeCount = Array.isArray(before) ? (before[0]?.c ?? 0) : 0;

    await player.ranking.addEntry(payload);

    const after = (await dbHandle.db.execute(sql`
      SELECT COUNT(*)::int AS c FROM audit_log
       WHERE action = 'idempotency_replay'
         AND resource_id = ${idempotencyKey}
    `)) as unknown as Array<{ c: number }>;
    const afterCount = Array.isArray(after) ? (after[0]?.c ?? 0) : 0;
    expect(afterCount).toBe(beforeCount + 1);
  });

  it('different idempotency key → fresh execution', async () => {
    if (!dbReady || !seeded || !dbHandle) return;
    const player = appCaller({ userId: seeded.users.player, role: 'player' });
    const payloadBase = (val: number, key: string) => ({
      playerUserId: seeded!.users.player,
      rankingTypeCode: 'ranking_senior_world' as const,
      recordedAt: new Date(),
      source: 'manual' as const,
      value: { kind: 'numeric' as const, value: val },
      _meta: { idempotencyKey: key },
    });
    await player.ranking.addEntry(payloadBase(310, randomUUID()));
    await player.ranking.addEntry(payloadBase(320, randomUUID()));
    const rows = (await dbHandle.db.execute(sql`
      SELECT value_numeric FROM ranking_entries
       WHERE player_user_id = ${seeded.users.player}::uuid
         AND value_numeric IN (310, 320)
       ORDER BY value_numeric
    `)) as unknown as Array<{ value_numeric: string }>;
    const arr = Array.isArray(rows) ? rows : [];
    expect(arr.length).toBe(2);
  });
});
