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

// ─── Phase 2 additions ──────────────────────────────────────────────────

/**
 * age_categories — Belgian table tennis age cohorts (DOM-CAT-01).
 *
 * Birth-year boundaries are inclusive on both sides. Phase 2's seed migration
 * (02-08) inserts placeholder NULLs until the TD confirms the canonical
 * boundaries (RESEARCH §Open Questions point 4 — ASSUMED A2). Until set,
 * `deriveAgeCategory()` returns the special `'age_unknown'` code (helper in
 * 02-04). Once confirmed, an UPDATE migration in the same migration chain
 * fills the boundaries.
 *
 * No per-locale display columns — labels live in `messages/{nl,en,fr}.json`
 * under `lookups.ageCategory.*` (I18N-06 / D-45 — proper nouns not in DB).
 */
export const ageCategories = pgTable('age_categories', {
  code: text('code').primaryKey(), // 'age_pre_minor' | 'age_minor' | 'age_cadet' | 'age_junior' | 'age_senior' | 'age_veteran' | 'age_unknown'
  sortOrder: integer('sort_order').notNull(),
  bornAfterOrEqual: integer('born_after_or_equal'), // null = open lower bound
  bornBeforeOrEqual: integer('born_before_or_equal'), // null = open upper bound
  active: boolean('active').notNull().default(true),
});

/**
 * trainer_diploma — 5-code lookup per TRAINER-02 (verbatim from REQUIREMENTS).
 *
 * Codes: 'diploma_none' | 'diploma_a' | 'diploma_b' | 'diploma_a_in_training'
 *        | 'diploma_b_in_training'.
 * Labels resolved via `messages/{nl,en,fr}.json` `lookups.trainerDiploma.*`.
 */
export const trainerDiploma = pgTable('trainer_diploma', {
  code: text('code').primaryKey(), // 'diploma_none' | 'diploma_a' | 'diploma_b' | 'diploma_a_in_training' | 'diploma_b_in_training'
  sortOrder: integer('sort_order').notNull(),
  active: boolean('active').notNull().default(true),
});
