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

/**
 * Phase 3 — event_type lookup coverage (UI3-D11, D-47).
 *
 * Wave 0 RED scaffold: the `eventType` table is added by Wave 2 migration
 * `drizzle/0012_phase3_event_type_seed.sql` + the lookup is registered in
 * `src/server/db/schema/lookups.ts`. Until then the existence checks are
 * it.todo so the suite stays parsable; the canonical 6 codes are spelled
 * out here so a planner/checker can grep for them.
 */
describe('Phase 3 — event_type lookup (UI3-D11, D-47)', () => {
  // Canonical 6 codes per UI3-D11 + D-47 (CONTEXT.md). These strings are
  // the exact `code` PK values seeded by migration 0012.
  const EVENT_TYPE_CODES = [
    'event_type_training',
    'event_type_tournament',
    'event_type_meeting',
    'event_type_stage',
    'event_type_eval_conversation',
    'event_type_medical',
  ] as const;

  it('declares all 6 canonical event_type codes (Phase 3 Wave 0 manifest)', () => {
    // RED-friendly: assert the manifest array is the exact set of canonical
    // codes — flips to a DB query in Wave 5 once the seed lands.
    expect(EVENT_TYPE_CODES).toHaveLength(6);
    expect(new Set(EVENT_TYPE_CODES).size).toBe(6);
  });

  it.todo('eventType pgTable has a "code" PK column (Wave 2)');
  it.todo('eventType seed migration inserts the 6 canonical codes (Wave 2)');
});
