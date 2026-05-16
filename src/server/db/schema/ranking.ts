/**
 * ranking — Phase 4 split-column ranking schema (D-86).
 *
 * RANK-01 amended: Belgium ranking is a hierarchical classification (A1..A50,
 * B0..B6, ..., NC), not a numeric ranking. The `ranking_entries` table
 * accepts EITHER `value_numeric` (international) OR `value_classification_code`
 * (Belgium) via a CHECK XOR constraint at the DB layer. `ranking_type.value_shape`
 * declares which column applies per type.
 *
 * Defense-in-depth pattern (per RESEARCH §Pattern 4):
 *   - DB layer:     CHECK ranking_entries_value_xor enforces XOR.
 *   - API layer:    Zod discriminated union on `value_shape` (Plan 04-05) so
 *                   value_numeric and value_classification_code are typed
 *                   distinctly per ranking type.
 *
 * source column (DOM-RANK-01): 'manual' | 'federation_official' — v1 only
 * accepts 'manual' from app paths; 'federation_official' reserved for v2
 * federation-sync feature (KBTTB/ETTU/ITTF APIs).
 *
 * RLS policies + audit emission live in the Wave 1 0018 RLS migration and
 * Plan 04-05 API layer.
 *
 * Reference: .planning/phases/04-kerndomein/04-CONTEXT.md §D §D-86..D-91
 *            drizzle/0016_phase4_rankings_and_belgium_classification.sql
 */
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  numeric,
  pgTable,
  text,
  uuid,
} from 'drizzle-orm/pg-core';

import { tstz } from '../helpers/timestamps';
import { users } from './auth';
import { belgiumClassification, rankingType } from './lookups';

export const rankingEntries = pgTable(
  'ranking_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    playerUserId: uuid('player_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    rankingTypeCode: text('ranking_type_code')
      .notNull()
      .references(() => rankingType.code, { onDelete: 'restrict' }),
    recordedAt: tstz('recorded_at').notNull(),
    source: text('source').notNull(), // DOM-RANK-01
    valueNumeric: numeric('value_numeric'), // > 0 for international
    valueClassificationCode: text('value_classification_code').references(
      () => belgiumClassification.code,
      { onDelete: 'restrict' },
    ),
    enteredBy: uuid('entered_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    enteredAt: tstz('entered_at', { defaultNow: true }).notNull(),
  },
  (t) => [
    check(
      'ranking_entries_source_enum',
      sql`${t.source} IN ('manual', 'federation_official')`,
    ),
    check(
      'ranking_entries_value_xor',
      sql`(${t.valueNumeric} IS NOT NULL AND ${t.valueClassificationCode} IS NULL) OR (${t.valueNumeric} IS NULL AND ${t.valueClassificationCode} IS NOT NULL)`,
    ),
    check(
      'ranking_entries_numeric_positive',
      sql`${t.valueNumeric} IS NULL OR ${t.valueNumeric} > 0`,
    ),
    index('idx_ranking_entries_player_type_date').on(
      t.playerUserId,
      t.rankingTypeCode,
      t.recordedAt.desc(),
    ),
    index('idx_ranking_entries_recorded_at').on(t.recordedAt.desc()),
  ],
);

export type RankingEntry = typeof rankingEntries.$inferSelect;
export type NewRankingEntry = typeof rankingEntries.$inferInsert;
