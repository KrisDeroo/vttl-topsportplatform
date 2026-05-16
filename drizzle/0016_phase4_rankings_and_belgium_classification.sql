-- 0016_phase4_rankings_and_belgium_classification.sql
-- Phase 4 — split-column ranking schema (D-86 / RANK-01 amended).
-- Belgium ranking is a hierarchical classification (A1..A50, B0..B6, ...,
-- NC), not a numeric ranking. The ranking_entries table accepts EITHER
-- value_numeric (international) OR value_classification_code (Belgium)
-- via a CHECK XOR constraint. ranking_type.value_shape declares which.
--
-- Tables in this migration:
--   * belgium_classification — KBTTB tier lookup (A1..NC), 67 rows seeded in 0017.
--   * ranking_entries        — time series per player per type; split-column XOR.
--
-- ALTER:
--   * ranking_type ADD COLUMN value_shape — 'numeric' | 'classification'.
--     Three-step expand-contract per MIG-02:
--       (a) ADD COLUMN with DEFAULT 'numeric' so existing rows backfill cleanly.
--       (b) 0017 seed UPDATEs ranking_belgium row to 'classification'.
--       (c) 0017 tail drops the DEFAULT so future inserts MUST specify.
--
-- Reference: .planning/phases/04-kerndomein/04-CONTEXT.md §D-86..D-90
--            .planning/phases/04-kerndomein/04-RESEARCH.md §Pattern 4

-- ─── belgium_classification lookup ─────────────────────────────────
CREATE TABLE "belgium_classification" (
  "code"        text    PRIMARY KEY,
  "sort_order"  integer NOT NULL,                              -- global ordinal (per Pitfall 8)
  "tier"        text    NOT NULL,                              -- 'A' | 'B' | 'C' | 'D' | 'E' | 'NC'
  "active"      boolean NOT NULL DEFAULT true,
  CONSTRAINT "belgium_classification_tier_enum"
    CHECK ("tier" IN ('A','B','C','D','E','NC'))
);--> statement-breakpoint

CREATE INDEX "idx_belgium_classification_tier_sort" ON "belgium_classification" ("tier", "sort_order");--> statement-breakpoint

COMMENT ON TABLE "belgium_classification" IS 'KBTTB hierarchical tier system (A1..A50 / B0/2/4/6 / C0/2/4/6 / D0/2/4/6 / E0/2/4/6 / NC). Global sort_order 1..67; tier groups per Pitfall 8.';--> statement-breakpoint

-- ─── ALTER ranking_type ADD COLUMN value_shape ────────────────────
-- Step (a): ADD with DEFAULT 'numeric'. Existing rows (seeded in 0017)
-- get 'numeric' until the explicit UPDATE in 0017 sets ranking_belgium
-- to 'classification'. Default is dropped at the tail of 0017.
ALTER TABLE "ranking_type" ADD COLUMN "value_shape" text NOT NULL DEFAULT 'numeric';--> statement-breakpoint
ALTER TABLE "ranking_type" ADD CONSTRAINT "ranking_type_value_shape_enum"
  CHECK ("value_shape" IN ('numeric', 'classification'));--> statement-breakpoint

-- ─── ranking_entries (time series — split-column XOR) ─────────────
CREATE TABLE "ranking_entries" (
  "id"                              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "player_user_id"                  uuid        NOT NULL REFERENCES "users"("id") ON DELETE restrict,
  "ranking_type_code"               text        NOT NULL REFERENCES "ranking_type"("code") ON DELETE restrict,
  "recorded_at"                     timestamptz NOT NULL,
  "source"                          text        NOT NULL,                  -- DOM-RANK-01
  "value_numeric"                   numeric,                                -- > 0 for international
  "value_classification_code"       text        REFERENCES "belgium_classification"("code") ON DELETE restrict,
  "entered_by"                      uuid        NOT NULL REFERENCES "users"("id") ON DELETE restrict,
  "entered_at"                      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "ranking_entries_source_enum"
    CHECK ("source" IN ('manual', 'federation_official')),
  CONSTRAINT "ranking_entries_value_xor"
    CHECK (
      ("value_numeric" IS NOT NULL AND "value_classification_code" IS NULL)
      OR
      ("value_numeric" IS NULL AND "value_classification_code" IS NOT NULL)
    ),
  CONSTRAINT "ranking_entries_numeric_positive"
    CHECK ("value_numeric" IS NULL OR "value_numeric" > 0)
);--> statement-breakpoint

CREATE INDEX "idx_ranking_entries_player_type_date" ON "ranking_entries" ("player_user_id", "ranking_type_code", "recorded_at" DESC);--> statement-breakpoint
CREATE INDEX "idx_ranking_entries_recorded_at"      ON "ranking_entries" ("recorded_at" DESC);--> statement-breakpoint

COMMENT ON TABLE "ranking_entries" IS 'Time-series rankings per player per type. Split-column XOR (D-86 — RANK-01 amended): exactly one of value_numeric (international) or value_classification_code (Belgium) is non-null. Cross-check value_shape <-> column at API layer per RESEARCH §Pattern 4.';
