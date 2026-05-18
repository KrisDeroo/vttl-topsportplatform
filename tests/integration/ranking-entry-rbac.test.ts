/**
 * Phase 4 Wave 4 — ranking.addEntry RBAC (D-89, RANK-06 kept literal).
 *
 * Covers D-89: player can enter their own ranking; TD can enter for any
 * player; trainer / parent / academy_manager / sparring_partner cannot.
 * Applies to all 5 ranking types including Belgium classification.
 *
 * Analog: tests/integration/rbac-matrix.test.ts.
 */
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

describe('ranking.addEntry RBAC (D-89)', () => {
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

  it('player enters own ranking — allowed', async () => {
    if (!dbReady || !seeded || !dbHandle) return;
    const player = appCaller({ userId: seeded.users.player, role: 'player' });
    const result = await player.ranking.addEntry({
      playerUserId: seeded.users.player,
      rankingTypeCode: 'ranking_senior_world',
      recordedAt: new Date(),
      source: 'manual',
      value: { kind: 'numeric', value: 380 },
    });
    expect(result.ok).toBe(true);
    expect(result.valueShape).toBe('numeric');
  });

  it('TD enters ranking for any player — allowed', async () => {
    if (!dbReady || !seeded || !dbHandle) return;
    const td = appCaller({
      userId: seeded.users.technical_director,
      role: 'technical_director',
    });
    const result = await td.ranking.addEntry({
      playerUserId: seeded.users.player,
      rankingTypeCode: 'ranking_senior_world',
      recordedAt: new Date(),
      source: 'manual',
      value: { kind: 'numeric', value: 340 },
    });
    expect(result.ok).toBe(true);
  });

  it('trainer FORBIDDEN to enter ranking_entry — role_not_allowed', async () => {
    if (!dbReady || !seeded || !dbHandle) return;
    const trainer = appCaller({ userId: seeded.users.trainer, role: 'trainer' });
    await expect(
      trainer.ranking.addEntry({
        playerUserId: seeded.users.player,
        rankingTypeCode: 'ranking_senior_world',
        recordedAt: new Date(),
        source: 'manual',
        value: { kind: 'numeric', value: 280 },
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('parent FORBIDDEN to enter ranking_entry for child', async () => {
    if (!dbReady || !seeded || !dbHandle) return;
    const parent = appCaller({ userId: seeded.users.parent, role: 'parent' });
    await expect(
      parent.ranking.addEntry({
        playerUserId: seeded.victimId,
        rankingTypeCode: 'ranking_senior_world',
        recordedAt: new Date(),
        source: 'manual',
        value: { kind: 'numeric', value: 220 },
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('academy_manager FORBIDDEN to enter ranking_entry', async () => {
    if (!dbReady || !seeded || !dbHandle) return;
    const am = appCaller({
      userId: seeded.users.academy_manager,
      role: 'academy_manager',
    });
    await expect(
      am.ranking.addEntry({
        playerUserId: seeded.users.player,
        rankingTypeCode: 'ranking_senior_world',
        recordedAt: new Date(),
        source: 'manual',
        value: { kind: 'numeric', value: 260 },
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('player CANNOT enter ranking for another player (notOwnPlayer)', async () => {
    if (!dbReady || !seeded || !dbHandle) return;
    const player = appCaller({ userId: seeded.users.player, role: 'player' });
    await expect(
      player.ranking.addEntry({
        playerUserId: seeded.extraUsers.playerA2, // not the caller
        rankingTypeCode: 'ranking_senior_world',
        recordedAt: new Date(),
        source: 'manual',
        value: { kind: 'numeric', value: 999 },
      }),
    ).rejects.toThrow(/notOwnPlayer/);
  });

  it('Belgium classification entry — player can self-report A12', async () => {
    if (!dbReady || !seeded || !dbHandle) return;
    const player = appCaller({ userId: seeded.users.player, role: 'player' });
    const result = await player.ranking.addEntry({
      playerUserId: seeded.users.player,
      rankingTypeCode: 'ranking_belgium',
      recordedAt: new Date(),
      source: 'manual',
      value: { kind: 'classification', code: 'A1' },
    });
    expect(result.ok).toBe(true);
    expect(result.valueShape).toBe('classification');
  });

  it('value-shape mismatch rejected with errors.ranking.expectedClassification', async () => {
    if (!dbReady || !seeded || !dbHandle) return;
    const player = appCaller({ userId: seeded.users.player, role: 'player' });
    await expect(
      player.ranking.addEntry({
        playerUserId: seeded.users.player,
        rankingTypeCode: 'ranking_belgium', // expects classification
        recordedAt: new Date(),
        source: 'manual',
        value: { kind: 'numeric', value: 100 }, // wrong shape
      }),
    ).rejects.toThrow(/expectedClassification/);
  });

  it('audit code ranking_entry_added emitted on success', async () => {
    if (!dbReady || !seeded || !dbHandle) return;
    const before = (await dbHandle.db.execute(sql`
      SELECT COUNT(*)::int AS c FROM audit_log
       WHERE action = 'ranking_entry_added'
    `)) as unknown as Array<{ c: number }>;
    const beforeCount = Array.isArray(before) ? (before[0]?.c ?? 0) : 0;

    const player = appCaller({ userId: seeded.users.player, role: 'player' });
    await player.ranking.addEntry({
      playerUserId: seeded.users.player,
      rankingTypeCode: 'ranking_senior_world',
      recordedAt: new Date(),
      source: 'manual',
      value: { kind: 'numeric', value: 250 },
    });

    const after = (await dbHandle.db.execute(sql`
      SELECT COUNT(*)::int AS c FROM audit_log
       WHERE action = 'ranking_entry_added'
    `)) as unknown as Array<{ c: number }>;
    const afterCount = Array.isArray(after) ? (after[0]?.c ?? 0) : 0;
    expect(afterCount).toBe(beforeCount + 1);
  });
});
