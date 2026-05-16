/**
 * tournament — Phase 4 operational results tables on top of Phase 3 calendar.
 *
 * tournament_results (D-69, D-77, DOM-CAT-02):
 *   - Composite PK (tournament_event_id, player_user_id) — one final-ranking
 *     row per (player, tournament).
 *   - `outcome_level_code` FKs the 9-code outcome_level lookup (D-70).
 *   - `player_age_category_code` is a DOM-CAT-02 snapshot: derived from
 *     age_category_history at `tournament.starts_at` and frozen at entry-time
 *     (Plan 04-04 entry mutation).
 *   - `entered_by` enum-via-CHECK ('player' | 'trainer' | 'td') captures
 *     attribution per DOM-RESULT-02 / D-73 (asymmetric backfill RBAC).
 *   - NO `status` column (D-77 supersedes DOM-RESULT-04); every saved row
 *     counts for Phase 5 ambition comparison.
 *   - NO `result_edit_history` companion (D-76 supersedes DOM-RESULT-03);
 *     audit_log JSONB snapshot pattern (GDPR-04) is forensic recovery.
 *
 * match_results (TOURN-04 amended by D-81):
 *   - Surrogate UUID PK + composite UNIQUE for VALID-07 (tournament_event_id,
 *     player_user_id, round_code, opponent_name, match_date).
 *   - Set tally (sets_won, sets_lost) instead of per-set scores. Won/lost
 *     derived at query time from `sets_won > sets_lost` (D-81); never stored
 *     as a boolean. v2 may add `score_sets jsonb` for AI-video correlation
 *     without breaking changes.
 *   - CHECK 0..4 per side; CHECK 1..7 total (best-of-5/7 envelope).
 *   - `opponent_name` is free text (1..200 chars per D-80 + Claude's discretion).
 *   - `video_link` optional URL (≤500 chars); Zod `.url()` at API layer.
 *
 * tournament_round (lookup table — 10 codes seeded by 0017) is exported from
 * `./lookups.ts` to keep lookup tables co-located with their peers (status,
 * academy, event_type, etc.).
 *
 * RLS policies + audit emission live in the Wave 1 0018 RLS migration and
 * Plan 04-04 API layer respectively.
 *
 * Reference: .planning/phases/04-kerndomein/04-CONTEXT.md §B §D-69..D-81
 *            drizzle/0015_phase4_tournament_results_and_match_results.sql
 */
import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  smallint,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { tstz } from '../helpers/timestamps';
import { users } from './auth';
import { calendarEvents } from './calendar';
import { ageCategories, outcomeLevel, tournamentRound } from './lookups';

export const tournamentResults = pgTable(
  'tournament_results',
  {
    tournamentEventId: uuid('tournament_event_id')
      .notNull()
      .references(() => calendarEvents.id, { onDelete: 'cascade' }),
    playerUserId: uuid('player_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    outcomeLevelCode: text('outcome_level_code')
      .notNull()
      .references(() => outcomeLevel.code, { onDelete: 'restrict' }),
    playerAgeCategoryCode: text('player_age_category_code')
      .notNull()
      .references(() => ageCategories.code, { onDelete: 'restrict' }), // DOM-CAT-02
    enteredBy: text('entered_by').notNull(), // 'player' | 'trainer' | 'td'
    enteredByUserId: uuid('entered_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    enteredAt: tstz('entered_at', { defaultNow: true }).notNull(),
    updatedAt: tstz('updated_at', { defaultNow: true }).notNull(),
  },
  (t) => [
    primaryKey({
      name: 'tournament_results_pkey',
      columns: [t.tournamentEventId, t.playerUserId],
    }),
    check(
      'tournament_results_entered_by_enum',
      sql`${t.enteredBy} IN ('player', 'trainer', 'td')`,
    ),
    index('idx_tournament_results_player').on(t.playerUserId),
    index('idx_tournament_results_tournament').on(t.tournamentEventId),
  ],
);

export const matchResults = pgTable(
  'match_results',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tournamentEventId: uuid('tournament_event_id')
      .notNull()
      .references(() => calendarEvents.id, { onDelete: 'cascade' }),
    playerUserId: uuid('player_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    roundCode: text('round_code')
      .notNull()
      .references(() => tournamentRound.code, { onDelete: 'restrict' }),
    opponentName: text('opponent_name').notNull(),
    opponentRanking: integer('opponent_ranking'),
    matchDate: date('match_date').notNull(),
    setsWon: smallint('sets_won').notNull(),
    setsLost: smallint('sets_lost').notNull(),
    videoLink: text('video_link'),
    createdAt: tstz('created_at', { defaultNow: true }).notNull(),
  },
  (t) => [
    check('match_results_sets_won_range', sql`${t.setsWon} BETWEEN 0 AND 4`),
    check('match_results_sets_lost_range', sql`${t.setsLost} BETWEEN 0 AND 4`),
    check(
      'match_results_sets_total_range',
      sql`${t.setsWon} + ${t.setsLost} BETWEEN 1 AND 7`,
    ),
    check(
      'match_results_opponent_name_length',
      sql`char_length(${t.opponentName}) BETWEEN 1 AND 200`,
    ),
    check(
      'match_results_video_link_length',
      sql`${t.videoLink} IS NULL OR char_length(${t.videoLink}) <= 500`,
    ),
    unique('match_results_unique_player_round_opponent_date').on(
      t.tournamentEventId,
      t.playerUserId,
      t.roundCode,
      t.opponentName,
      t.matchDate,
    ),
    index('idx_match_results_tournament_player').on(
      t.tournamentEventId,
      t.playerUserId,
    ),
    index('idx_match_results_player_date').on(
      t.playerUserId,
      t.matchDate.desc(),
    ),
  ],
);

export type TournamentResult = typeof tournamentResults.$inferSelect;
export type NewTournamentResult = typeof tournamentResults.$inferInsert;
export type MatchResult = typeof matchResults.$inferSelect;
export type NewMatchResult = typeof matchResults.$inferInsert;
