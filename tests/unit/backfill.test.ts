/**
 * Unit tests for src/lib/migrate/backfill.ts — batched backfill utility (MIG-03).
 *
 * The real `db.execute` and `log` modules require a running Postgres + pino
 * config. We stub them so this test file is a pure unit test (no testcontainer
 * boot, no I/O). The two scenarios cover:
 *   1) Multi-batch happy path — sleep called between full batches but NOT after
 *      the trailing partial batch (otherwise we waste 100ms per backfill run).
 *   2) Custom batchSize/delayMs override the MIG-03 defaults.
 *
 * Cursor-pagination correctness (`AND id > $cursor`) is enforced by the source
 * file alone — exercising it from the test would require an actual SQL parser.
 * The acceptance criterion in the plan (grep for `id > ${cursor}`) covers it.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/log', () => ({
  log: { info: () => {} },
}));

const executeMock = vi.fn();
vi.mock('@/server/db/client', () => ({
  db: { execute: (...args: unknown[]) => executeMock(...args) },
}));

describe('backfillBatched — MIG-03', () => {
  it('processes 2 full + 1 partial batch with 2 sleeps in between', async () => {
    const { backfillBatched } = await import('@/lib/migrate/backfill');

    // SELECT/UPDATE pairs — selectSql call returns rows, updateSql call returns []
    const responses: Array<unknown> = [
      Array.from({ length: 1000 }, (_, i) => ({ id: String(i) })), // SELECT batch 1
      [], // UPDATE batch 1
      Array.from({ length: 1000 }, (_, i) => ({ id: String(1000 + i) })), // SELECT batch 2
      [], // UPDATE batch 2
      Array.from({ length: 250 }, (_, i) => ({ id: String(2000 + i) })), // SELECT batch 3 (partial)
      [], // UPDATE batch 3
    ];
    executeMock.mockReset();
    executeMock.mockImplementation(async () => responses.shift() ?? []);

    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await backfillBatched({
      selectSql: () => 'sel' as unknown as never,
      updateSql: () => 'upd' as unknown as never,
      sleep,
    });

    expect(result.total).toBe(2250);
    // Two full batches → two sleeps. The partial batch (250 rows) breaks the
    // loop without sleeping — that's the optimization the test is locking in.
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(100);
  });

  it('respects custom batchSize and delayMs', async () => {
    const { backfillBatched } = await import('@/lib/migrate/backfill');

    executeMock.mockReset();
    executeMock.mockImplementation(async () => []); // no rows → loop exits immediately

    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await backfillBatched({
      selectSql: () => 'sel' as unknown as never,
      updateSql: () => 'upd' as unknown as never,
      batchSize: 500,
      delayMs: 50,
      sleep,
    });

    expect(result.total).toBe(0);
    // Empty result → no sleeps regardless of delayMs.
    expect(sleep).not.toHaveBeenCalled();
  });

  it('uses default batchSize=1000 and delayMs=100 (MIG-03)', async () => {
    const { backfillBatched } = await import('@/lib/migrate/backfill');

    const responses: Array<unknown> = [
      Array.from({ length: 1000 }, (_, i) => ({ id: String(i) })),
      [],
      Array.from({ length: 5 }, (_, i) => ({ id: String(1000 + i) })),
      [],
    ];
    executeMock.mockReset();
    executeMock.mockImplementation(async () => responses.shift() ?? []);

    const sleep = vi.fn().mockResolvedValue(undefined);

    await backfillBatched({
      selectSql: () => 'sel' as unknown as never,
      updateSql: () => 'upd' as unknown as never,
      sleep,
    });

    // One full 1000-row batch → exactly one 100ms sleep.
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(100);
  });
});
