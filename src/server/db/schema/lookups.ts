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
import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, pgTable, text } from 'drizzle-orm/pg-core';

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

/**
 * ranking_type — Phase 1 base; Phase 4 ADDs `value_shape` per D-86.
 *
 * Phase 4's split-column schema (RANK-01 amended) needs a per-type
 * declaration of which value column applies on `ranking_entries`:
 *   - `value_shape = 'numeric'`         → `ranking_entries.value_numeric`
 *   - `value_shape = 'classification'`  → `ranking_entries.value_classification_code`
 *
 * Defense in depth: the DB-level CHECK on `ranking_entries_value_xor`
 * guarantees exactly one of the two columns is populated. The API layer
 * (Plan 04-05) reads `value_shape` to decide which Zod branch to apply.
 *
 * 0016 migration adds the column with `DEFAULT 'numeric'`; 0017 seed
 * UPDATEs `ranking_belgium` to `'classification'` and drops the DEFAULT
 * so future inserts must specify explicitly.
 */
export const rankingType = pgTable('ranking_type', {
  code: text('code').primaryKey(), // 'ranking_senior_world' | 'ranking_belgium' | ...
  direction: text('direction').notNull(), // 'asc_is_better' | 'desc_is_better' (DOM-3, RISK-02)
  sortOrder: integer('sort_order').notNull(),
  active: boolean('active').notNull().default(true),
  // Phase 4 D-86 — DB-level CHECK enforced in 0016:
  //   value_shape IN ('numeric', 'classification')
  valueShape: text('value_shape').notNull(),
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

// ─── Phase 3 additions ──────────────────────────────────────────────────

/**
 * event_type — 6 calendar event types per UI3-D11 + D-47.
 *
 * Codes are language-neutral per I18N-05; labels live in
 * messages/{nl,en,fr}.json under lookup.eventType.*. The 6 codes are
 * seeded by migration 0012_phase3_event_type_seed.sql.
 *
 * Phase 4 does NOT add codes (D-51 schema freeze contract).
 */
export const eventType = pgTable('event_type', {
  code: text('code').primaryKey(), // 'event_type_training' | 'event_type_tournament' | ...
  sortOrder: integer('sort_order').notNull(),
  active: boolean('active').notNull().default(true),
});

// ─── Phase 4 additions ──────────────────────────────────────────────────

/**
 * tournament_round — 10 codes per TOURN-04 (round_final … round_other).
 *
 * Seeded by `0017_phase4_lookup_seeds.sql`. Used by `match_results.round_code`
 * (REFERENCES tournament_round(code) ON DELETE restrict). Labels live in
 * messages/{nl,en,fr}.json under `lookup.tournamentRound.*` (I18N-05).
 *
 * sort_order presents rounds in elimination order (final first, then semi,
 * etc.) for UI dropdowns; `round_group_stage` (9) and `round_other` (10)
 * end the list because they're non-elimination edge cases.
 */
export const tournamentRound = pgTable('tournament_round', {
  code: text('code').primaryKey(), // 'round_final' | 'round_semi' | ... | 'round_other'
  sortOrder: integer('sort_order').notNull(),
  active: boolean('active').notNull().default(true),
});

/**
 * belgium_classification — KBTTB hierarchical tier system (D-86).
 *
 * 67 codes seeded by `0017_phase4_lookup_seeds.sql`: A1..A50 (50 A-tier
 * sub-ranks), B0/B2/B4/B6, C0/C2/C4/C6, D0/D2/D4/D6, E0/E2/E4/E6, NC.
 *
 * Global `sort_order` 1..67 — single ordering across tiers (per Pitfall 8):
 *   A1=1, A2=2, ..., A50=50, B0=51, B2=52, ..., NC=67.
 * `tier` is a stable text grouping for UI/chart rendering (band colors per
 * tier in the Belgium timeline strip widget per D-87) — CHECK constraint
 * limits it to A/B/C/D/E/NC.
 *
 * `active=false` retires a code without breaking historical FK rows in
 * ranking_entries.value_classification_code (FK is ON DELETE restrict).
 *
 * Labels rendered as identity in i18n (A12 → "A12" in all 3 locales —
 * codes are federation proper nouns per I18N-06).
 */
export const belgiumClassification = pgTable(
  'belgium_classification',
  {
    code: text('code').primaryKey(), // 'A1' .. 'A50' | 'B0','B2','B4','B6' | ... | 'NC'
    sortOrder: integer('sort_order').notNull(),
    tier: text('tier').notNull(), // 'A' | 'B' | 'C' | 'D' | 'E' | 'NC'
    active: boolean('active').notNull().default(true),
  },
  (t) => [
    check(
      'belgium_classification_tier_enum',
      sql`${t.tier} IN ('A','B','C','D','E','NC')`,
    ),
    index('idx_belgium_classification_tier_sort').on(t.tier, t.sortOrder),
  ],
);
