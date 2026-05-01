/**
 * Lookup tables — I18N-05 (codes only, labels via i18n catalogs).
 *
 * Each lookup table primary key is a snake_case language-neutral code
 * (`status_a`, `tournament_wtt_star`, `outcome_winner`). UI labels live
 * in `messages/{nl,en,fr}.json` under `lookups.<table>.<code>`. This
 * lets us:
 *
 *  - Translate UI copy without touching data
 *  - Avoid duplicating "Tournament WTT★" string across rows
 *  - Audit which codes are in use via SELECT DISTINCT
 *
 * Two structural variants:
 *  - `academy.canonicalName`: proper noun (academy name), NOT translated
 *    (I18N-06). Stored canonical so admin UI can show it without lookup.
 *  - `ranking_type.direction`: 'asc_is_better' (Belgium ranking — rank 1
 *    is best) vs 'desc_is_better' (Elo — higher is better). DOM-3, RISK-02:
 *    a single sort direction across both kinds of rankings would invert
 *    leaderboards on Elo-style rankings.
 *
 * `active=false` retires a code without deleting it (preserves FK integrity
 * for historical rows). Plan 03+ filters lookups by `active=true` in admin
 * UIs but keeps inactive codes joinable.
 *
 * Reference: .planning/phases/01-fundament/01-RESEARCH.md §Lookup table convention (lines 528-580)
 */
import { pgTable, text, integer, boolean } from 'drizzle-orm/pg-core';

export const status = pgTable('status', {
  code: text('code').primaryKey(), // 'status_a' | 'status_b' | 'status_c'
  sortOrder: integer('sort_order').notNull(),
  active: boolean('active').notNull().default(true),
});

export const academy = pgTable('academy', {
  code: text('code').primaryKey(), // 'topsportschool' | 'academy_antwerpen' | ...
  canonicalName: text('canonical_name').notNull(), // proper noun — NOT translated (I18N-06)
  sortOrder: integer('sort_order').notNull(),
  active: boolean('active').notNull().default(true),
});

export const tournamentType = pgTable('tournament_type', {
  code: text('code').primaryKey(), // 'tournament_wtt' | 'tournament_wtt_star' | ...
  sortOrder: integer('sort_order').notNull(),
  active: boolean('active').notNull().default(true),
});

export const rankingType = pgTable('ranking_type', {
  code: text('code').primaryKey(), // 'ranking_senior_world' | 'ranking_belgium' | ...
  direction: text('direction').notNull(), // 'asc_is_better' | 'desc_is_better' (DOM-3, RISK-02)
  sortOrder: integer('sort_order').notNull(),
  active: boolean('active').notNull().default(true),
});

export const trainingType = pgTable('training_type', {
  code: text('code').primaryKey(), // 'training_type_group' | 'training_type_individual' | ...
  sortOrder: integer('sort_order').notNull(),
  active: boolean('active').notNull().default(true),
});

export const organisation = pgTable('organisation', {
  code: text('code').primaryKey(), // 'org_private' | 'org_kbttb' | ...
  sortOrder: integer('sort_order').notNull(),
  active: boolean('active').notNull().default(true),
});

export const outcomeLevel = pgTable('outcome_level', {
  code: text('code').primaryKey(), // 'outcome_winner' | 'outcome_finalist' | 'outcome_last_4' | ...
  sortOrder: integer('sort_order').notNull(),
  active: boolean('active').notNull().default(true),
});
