/**
 * Batched, cursor-paginated backfill helper for Drizzle migrations.
 *
 * Implements MIG-03 (`docs/migration-runbook.md`): every backfill MUST run in
 * 1000-row batches with a 100ms sleep between full batches. Naive single-shot
 * `UPDATE table SET ... WHERE col IS NULL` against a populated production table
 * causes lock contention; pgBouncer transaction-mode pools (Supabase 6543) make
 * the symptom worse because every retry holds an idle-in-transaction state.
 *
 * Cursor pagination (`AND id > $cursor`) is required — `OFFSET` is forbidden
 * because OFFSET cost grows linearly with table size and doesn't survive
 * concurrent writes during the backfill.
 *
 * Forward-declared dependency: `@/lib/log` is created in Plan 13. Until that
 * plan lands the import is unresolved at runtime; tests stub it out via
 * `vi.mock('@/lib/log', ...)`. The first real backfill (Phase 5+) is many
 * waves after Plan 13 ships.
 *
 * Reference: .planning/phases/01-fundament/01-RESEARCH.md §Backfill utility
 *            .planning/phases/01-fundament/01-RESEARCH.md §Migration Governance
 */
import { db } from '@/server/db/client';
import { sql, type SQL } from 'drizzle-orm';
import { log } from '@/lib/log';

export interface BackfillBatchedArgs<T extends { id: string }> {
  /**
   * Builds the SELECT query with the cursor clause already included.
   * Caller composes: `SELECT id FROM <table> WHERE <predicate> ${cursorClause} ORDER BY id LIMIT 1000`.
   * The cursorClause is `AND id > '<last-id>'` after the first batch and `AND TRUE`
   * on the first call (no leading WHERE — caller must provide their own).
   */
  selectSql: (cursorClause: SQL) => SQL;
  /**
   * Builds the UPDATE for a batch of ids returned by selectSql.
   * Caller composes: `UPDATE <table> SET <col>=<val> WHERE id IN (<ids>)`.
   */
  updateSql: (ids: string[]) => SQL;
  /** Default 1000 rows per batch (MIG-03). */
  batchSize?: number;
  /** Default 100ms sleep between full batches (MIG-03). */
  delayMs?: number;
  /** Injectable sleep — tests pass `vi.fn()` to assert call count without real timers. */
  sleep?: (ms: number) => Promise<void>;
}

export async function backfillBatched<T extends { id: string }>(
  args: BackfillBatchedArgs<T>,
): Promise<{ total: number }> {
  const batch = args.batchSize ?? 1000;
  const delay = args.delayMs ?? 100;
  const sleep = args.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));

  let cursor: string | null = null;
  let total = 0;

  for (;;) {
    const cursorClause: SQL = cursor ? sql`AND id > ${cursor}` : sql`AND TRUE`;
    const rows = (await db.execute<T>(args.selectSql(cursorClause))) as unknown as T[];
    if (rows.length === 0) break;

    await db.execute(args.updateSql(rows.map((r) => r.id)));

    cursor = rows[rows.length - 1]!.id;
    total += rows.length;
    log.info({ total, lastId: cursor, batch }, 'backfill.progress');

    // Sleep ONLY between full batches; on a partial batch we know the next
    // SELECT will return zero rows so the sleep would be wasted wall-clock.
    if (rows.length === batch) {
      await sleep(delay);
    } else {
      break;
    }
  }

  log.info({ total }, 'backfill.done');
  return { total };
}
