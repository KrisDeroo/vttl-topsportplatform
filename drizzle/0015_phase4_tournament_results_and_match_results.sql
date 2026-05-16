-- 0015_phase4_tournament_results_and_match_results.sql
-- Phase 4 — tournament results (level 1) + match results (level 2).
-- Per D-77 (DOM-RESULT-04 SUPERSEDED): no status lifecycle column.
-- Per D-76 (DOM-RESULT-03 SUPERSEDED): no edit_history table — audit_log
--   JSONB snapshot pattern (GDPR-04) is the forensic recovery path.
-- Per D-81 (TOURN-04 partial supersede): set tally — won/lost is derived at
--   query time from `sets_won > sets_lost`, never stored.
--
-- Tables in this migration:
--   * tournament_round       — 10-code lookup (round_final … round_other).
--   * tournament_results     — final ranking per player per tournament
--                              (atomic with ≥1 match_results row per D-69).
--   * match_results          — per-match record within a tournament (TOURN-04).
--
-- Order matters: tournament_round must be created BEFORE match_results FKs it.
--
-- Reference: .planning/phases/04-kerndomein/04-CONTEXT.md §B + §D-69..D-81
--            .planning/REQUIREMENTS.md VALID-07 (UNIQUE on match_results)

-- ─── tournament_round lookup (10 codes — seeded in 0017) ───────────
-- Created first so match_results FK resolves at apply time.
CREATE TABLE "tournament_round" (
  "code"        text    PRIMARY KEY,
  "sort_order"  integer NOT NULL,
  "active"      boolean NOT NULL DEFAULT true
);--> statement-breakpoint

COMMENT ON TABLE "tournament_round" IS 'Tournament round codes (TOURN-04). 10 codes seeded by 0017_phase4_lookup_seeds.';--> statement-breakpoint

-- ─── tournament_results (level 1: final ranking per player per tournament) ───
CREATE TABLE "tournament_results" (
  "tournament_event_id"      uuid        NOT NULL REFERENCES "calendar_events"("id") ON DELETE cascade,
  "player_user_id"           uuid        NOT NULL REFERENCES "users"("id") ON DELETE restrict,
  "outcome_level_code"       text        NOT NULL REFERENCES "outcome_level"("code") ON DELETE restrict,
  "player_age_category_code" text        NOT NULL REFERENCES "age_categories"("code") ON DELETE restrict,  -- DOM-CAT-02 snapshot
  "entered_by"               text        NOT NULL,   -- 'player' | 'trainer' | 'td'
  "entered_by_user_id"       uuid        NOT NULL REFERENCES "users"("id") ON DELETE restrict,
  "entered_at"               timestamptz NOT NULL DEFAULT now(),
  "updated_at"               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "tournament_results_pkey" PRIMARY KEY ("tournament_event_id", "player_user_id"),
  CONSTRAINT "tournament_results_entered_by_enum"
    CHECK ("entered_by" IN ('player', 'trainer', 'td'))
);--> statement-breakpoint

CREATE INDEX "idx_tournament_results_player"     ON "tournament_results" ("player_user_id");--> statement-breakpoint
CREATE INDEX "idx_tournament_results_tournament" ON "tournament_results" ("tournament_event_id");--> statement-breakpoint

COMMENT ON TABLE "tournament_results" IS 'Final ranking per player per tournament (D-69 atomic with match_results); DOM-CAT-02 snapshot in player_age_category_code; entered_by attribution per DOM-RESULT-02 / D-73. No status column (D-77).';--> statement-breakpoint

-- ─── match_results (level 2: per-match within a tournament) ────────
CREATE TABLE "match_results" (
  "id"                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tournament_event_id" uuid        NOT NULL REFERENCES "calendar_events"("id") ON DELETE cascade,
  "player_user_id"      uuid        NOT NULL REFERENCES "users"("id") ON DELETE restrict,
  "round_code"          text        NOT NULL REFERENCES "tournament_round"("code") ON DELETE restrict,
  "opponent_name"       text        NOT NULL,
  "opponent_ranking"    integer,                              -- optional numeric ranking of opponent
  "match_date"          date        NOT NULL,
  "sets_won"            smallint    NOT NULL,
  "sets_lost"           smallint    NOT NULL,
  "video_link"          text,
  "created_at"          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "match_results_sets_won_range"   CHECK ("sets_won"  BETWEEN 0 AND 4),
  CONSTRAINT "match_results_sets_lost_range"  CHECK ("sets_lost" BETWEEN 0 AND 4),
  CONSTRAINT "match_results_sets_total_range" CHECK ("sets_won" + "sets_lost" BETWEEN 1 AND 7),
  CONSTRAINT "match_results_opponent_name_length"
    CHECK (char_length("opponent_name") BETWEEN 1 AND 200),
  CONSTRAINT "match_results_video_link_length"
    CHECK ("video_link" IS NULL OR char_length("video_link") <= 500),
  CONSTRAINT "match_results_unique_player_round_opponent_date"
    UNIQUE ("tournament_event_id", "player_user_id", "round_code", "opponent_name", "match_date")  -- VALID-07
);--> statement-breakpoint

CREATE INDEX "idx_match_results_tournament_player" ON "match_results" ("tournament_event_id", "player_user_id");--> statement-breakpoint
CREATE INDEX "idx_match_results_player_date"       ON "match_results" ("player_user_id", "match_date" DESC);--> statement-breakpoint

COMMENT ON TABLE "match_results" IS 'Per-match record within a tournament (TOURN-04). Won/lost derived at query time from sets_won > sets_lost (D-81). VALID-07 unique constraint prevents duplicate concurrent writes.';
