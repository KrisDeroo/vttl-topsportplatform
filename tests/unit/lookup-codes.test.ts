/**
 * Lookup-table convention unit tests — I18N-05, DOM-3, RISK-02.
 *
 * - All 7 lookup tables MUST have a primary-key column named `code`
 *   (text, language-neutral). Display labels live in messages catalogs;
 *   the DB stores codes only so we can change "Tournament WTT★" copy
 *   without touching data.
 *
 * - `ranking_type` MUST carry a `direction` column distinguishing
 *   "ascending = better" (place: rank 1 is best) from "descending = better"
 *   (Elo: higher is better) — DOM-3, RISK-02.
 *
 * Drizzle's table object exposes its columns via the symbol-keyed
 * 'drizzle:Columns' / underscore-prefixed `_.columns` accessor; we
 * accept both to remain forward-compatible with library refactors.
 */
import { describe, it, expect } from 'vitest';

import {
  status,
  academy,
  tournamentType,
  rankingType,
  trainingType,
  organisation,
  outcomeLevel,
} from '@/server/db/schema/lookups';

type DrizzleTable = {
  [k: symbol]: { columns: Record<string, unknown> };
  _: { columns: Record<string, unknown> };
};

const cols = (t: unknown): Record<string, unknown> => {
  const tbl = t as DrizzleTable;
  return tbl[Symbol.for('drizzle:Columns')]?.columns ?? tbl._.columns;
};

describe('lookup tables — I18N-05', () => {
  it.each([
    ['status', status],
    ['academy', academy],
    ['tournament_type', tournamentType],
    ['ranking_type', rankingType],
    ['training_type', trainingType],
    ['organisation', organisation],
    ['outcome_level', outcomeLevel],
  ])('%s table has a "code" column (PK)', (_n, table) => {
    const c = cols(table);
    expect(c.code).toBeDefined();
  });

  it('ranking_type carries a `direction` column (DOM-3, RISK-02)', () => {
    const c = cols(rankingType);
    expect(c.direction).toBeDefined();
  });

  it('academy carries a `canonicalName` column (I18N-06 — proper noun)', () => {
    const c = cols(academy);
    expect(c.canonicalName).toBeDefined();
  });
});
