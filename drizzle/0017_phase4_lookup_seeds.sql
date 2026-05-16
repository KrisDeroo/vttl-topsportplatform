-- 0017_phase4_lookup_seeds.sql
-- Phase 4 — idempotent seed of every empty Phase 4 lookup table.
-- Pattern: INSERT … ON CONFLICT (code) DO NOTHING (per 0008/0012).
--
-- Seeds:
--   * outcome_level (9 codes — TOURN-03 + D-70)
--   * ranking_type  (5 codes — RANK-02; value_shape per D-86)
--   * training_type (4 codes — TRAIN-01)
--   * organisation  (6 codes — TRAIN-01)
--   * tournament_type (7 codes — TOURN-01)
--   * tournament_round (10 codes — TOURN-04)
--   * belgium_classification (67 codes — D-86; Pitfall 8 global sort_order)
--
-- Tail: drops the DEFAULT 'numeric' from ranking_type.value_shape so future
-- inserts MUST specify (expand-contract step c per MIG-02).
--
-- Reference: .planning/phases/04-kerndomein/04-CONTEXT.md §D-70, §D-86
--            .planning/phases/04-kerndomein/04-RESEARCH.md §Pitfall 8

-- ─── outcome_level (9 codes — TOURN-03 + D-70) ─────────────────────
INSERT INTO "outcome_level" ("code", "sort_order", "active") VALUES
  ('outcome_winner',       1, true),
  ('outcome_finalist',     2, true),
  ('outcome_last_4',       3, true),
  ('outcome_last_8',       4, true),
  ('outcome_last_16',      5, true),
  ('outcome_last_32',      6, true),
  ('outcome_last_64',      7, true),
  ('outcome_last_128',     8, true),
  ('outcome_group_stage',  9, true)
ON CONFLICT ("code") DO NOTHING;--> statement-breakpoint

-- ─── ranking_type (5 codes — RANK-02; value_shape set per D-86) ────
-- value_shape='numeric' for the 4 international ranking types; 'classification'
-- for ranking_belgium. The column has DEFAULT 'numeric' from 0016 so we can
-- still rely on it for safety, but we set explicitly here for clarity.
INSERT INTO "ranking_type" ("code", "direction", "sort_order", "active", "value_shape") VALUES
  ('ranking_senior_world',     'asc_is_better', 1, true, 'numeric'),
  ('ranking_youth_world',      'asc_is_better', 2, true, 'numeric'),
  ('ranking_senior_european',  'asc_is_better', 3, true, 'numeric'),
  ('ranking_youth_european',   'asc_is_better', 4, true, 'numeric'),
  ('ranking_belgium',          'asc_is_better', 5, true, 'classification')
ON CONFLICT ("code") DO NOTHING;--> statement-breakpoint

-- Belt-and-braces: if the rows above were already present (idempotent re-apply),
-- the ON CONFLICT DO NOTHING skipped the explicit value_shape assignment.
-- Force the ranking_belgium row to 'classification' regardless of prior state.
UPDATE "ranking_type"
   SET "value_shape" = 'classification'
 WHERE "code" = 'ranking_belgium'
   AND "value_shape" <> 'classification';--> statement-breakpoint

-- ─── training_type (4 codes — TRAIN-01) ────────────────────────────
INSERT INTO "training_type" ("code", "sort_order", "active") VALUES
  ('training_type_group',       1, true),
  ('training_type_individual',  2, true),
  ('training_type_physical',    3, true),
  ('training_type_mental',      4, true)
ON CONFLICT ("code") DO NOTHING;--> statement-breakpoint

-- ─── organisation (6 codes — TRAIN-01) ─────────────────────────────
INSERT INTO "organisation" ("code", "sort_order", "active") VALUES
  ('org_private',         1, true),
  ('org_kbttb',           2, true),
  ('org_topsportschool',  3, true),
  ('org_academie',        4, true),
  ('org_provinciaal',     5, true),
  ('org_club',            6, true)
ON CONFLICT ("code") DO NOTHING;--> statement-breakpoint

-- ─── tournament_type (7 codes — TOURN-01) ──────────────────────────
INSERT INTO "tournament_type" ("code", "sort_order", "active") VALUES
  ('tournament_wtt',           1, true),
  ('tournament_wtt_star',      2, true),
  ('tournament_ettu',          3, true),
  ('tournament_ejk',           4, true),
  ('tournament_wk',            5, true),
  ('tournament_international', 6, true),
  ('tournament_belgium',       7, true)
ON CONFLICT ("code") DO NOTHING;--> statement-breakpoint

-- ─── tournament_round (10 codes — TOURN-04) ────────────────────────
INSERT INTO "tournament_round" ("code", "sort_order", "active") VALUES
  ('round_final',                1, true),
  ('round_semi',                 2, true),
  ('round_quarter',              3, true),
  ('round_eighth',               4, true),
  ('round_sixteenth',            5, true),
  ('round_thirty_second',        6, true),
  ('round_sixty_fourth',         7, true),
  ('round_one_twenty_eighth',    8, true),
  ('round_group_stage',          9, true),
  ('round_other',               10, true)
ON CONFLICT ("code") DO NOTHING;--> statement-breakpoint

-- ─── belgium_classification (67 codes — D-86; Pitfall 8 sort_order) ─
-- Order: A1=1, A2=2, ..., A50=50, B0=51, B2=52, B4=53, B6=54,
--        C0=55, C2=56, C4=57, C6=58, D0=59, D2=60, D4=61, D6=62,
--        E0=63, E2=64, E4=65, E6=66, NC=67.
INSERT INTO "belgium_classification" ("code", "sort_order", "tier", "active") VALUES
  ('A1',  1,  'A', true), ('A2',  2,  'A', true), ('A3',  3,  'A', true), ('A4',  4,  'A', true), ('A5',  5,  'A', true),
  ('A6',  6,  'A', true), ('A7',  7,  'A', true), ('A8',  8,  'A', true), ('A9',  9,  'A', true), ('A10', 10, 'A', true),
  ('A11', 11, 'A', true), ('A12', 12, 'A', true), ('A13', 13, 'A', true), ('A14', 14, 'A', true), ('A15', 15, 'A', true),
  ('A16', 16, 'A', true), ('A17', 17, 'A', true), ('A18', 18, 'A', true), ('A19', 19, 'A', true), ('A20', 20, 'A', true),
  ('A21', 21, 'A', true), ('A22', 22, 'A', true), ('A23', 23, 'A', true), ('A24', 24, 'A', true), ('A25', 25, 'A', true),
  ('A26', 26, 'A', true), ('A27', 27, 'A', true), ('A28', 28, 'A', true), ('A29', 29, 'A', true), ('A30', 30, 'A', true),
  ('A31', 31, 'A', true), ('A32', 32, 'A', true), ('A33', 33, 'A', true), ('A34', 34, 'A', true), ('A35', 35, 'A', true),
  ('A36', 36, 'A', true), ('A37', 37, 'A', true), ('A38', 38, 'A', true), ('A39', 39, 'A', true), ('A40', 40, 'A', true),
  ('A41', 41, 'A', true), ('A42', 42, 'A', true), ('A43', 43, 'A', true), ('A44', 44, 'A', true), ('A45', 45, 'A', true),
  ('A46', 46, 'A', true), ('A47', 47, 'A', true), ('A48', 48, 'A', true), ('A49', 49, 'A', true), ('A50', 50, 'A', true),
  ('B0',  51, 'B', true), ('B2',  52, 'B', true), ('B4',  53, 'B', true), ('B6',  54, 'B', true),
  ('C0',  55, 'C', true), ('C2',  56, 'C', true), ('C4',  57, 'C', true), ('C6',  58, 'C', true),
  ('D0',  59, 'D', true), ('D2',  60, 'D', true), ('D4',  61, 'D', true), ('D6',  62, 'D', true),
  ('E0',  63, 'E', true), ('E2',  64, 'E', true), ('E4',  65, 'E', true), ('E6',  66, 'E', true),
  ('NC',  67, 'NC', true)
ON CONFLICT ("code") DO NOTHING;--> statement-breakpoint

-- ─── Drop DEFAULT on ranking_type.value_shape (expand-contract step c) ─
-- After seed UPDATEs/INSERTs have populated the column, drop the DEFAULT so
-- future inserts MUST specify a value_shape — guards against forgetful inserts
-- silently defaulting to 'numeric' for what should be a 'classification' row.
ALTER TABLE "ranking_type" ALTER COLUMN "value_shape" DROP DEFAULT;
