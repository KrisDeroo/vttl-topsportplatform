-- Migration 0008_phase2_lookup_seed.sql — Phase 2 Wave 2.
-- Lookup reference data (idempotent ON CONFLICT DO NOTHING).
--
-- Phase 1 already seeded academy rows for 'topsportschool' and
-- 'academy_antwerpen' via test helpers; Phase 2 extends with the
-- remaining PLAYER-02 codes. Canonical names for the 4 new academies
-- are placeholders pending TD confirmation (RESEARCH A1) — once
-- confirmed, a future UPDATE-only migration will overwrite them.
--
-- age_categories: boundaries are intentionally NULL pending TD
-- confirmation (RESEARCH A2). deriveAgeCategory() returns 'age_unknown'
-- until at least one row has non-NULL boundaries.
--
-- trainer_diploma: 5 codes verbatim from TRAINER-02; no policy concerns.

-- ─── academy (extends Phase 1 seed) ───
INSERT INTO "academy" ("code", "canonical_name", "sort_order", "active") VALUES
  ('topsportschool',         'Topsportschool',         1, true),
  ('academy_antwerpen',      'Academy Antwerpen',      2, true),
  ('academy_brussel',        'Academy Brussel',        3, true),
  ('academy_oost_vlaanderen','Academy Oost-Vlaanderen',4, true),
  ('academy_west_vlaanderen','Academy West-Vlaanderen',5, true),
  ('academy_limburg',        'Academy Limburg',        6, true)
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint

-- ─── age_categories ───
-- 'age_unknown' is the safety fallback returned by deriveAgeCategory()
-- when no other row matches the player's birth year. Always kept active.
INSERT INTO "age_categories"
  ("code", "sort_order", "born_after_or_equal", "born_before_or_equal", "active")
VALUES
  ('age_pre_minor', 1, NULL, NULL, true),
  ('age_minor',     2, NULL, NULL, true),
  ('age_cadet',     3, NULL, NULL, true),
  ('age_junior',    4, NULL, NULL, true),
  ('age_senior',    5, NULL, NULL, true),
  ('age_veteran',   6, NULL, NULL, true),
  ('age_unknown',   99, NULL, NULL, true)
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint

-- ─── trainer_diploma ───
INSERT INTO "trainer_diploma" ("code", "sort_order", "active") VALUES
  ('diploma_none',           1, true),
  ('diploma_a',              2, true),
  ('diploma_b',              3, true),
  ('diploma_a_in_training',  4, true),
  ('diploma_b_in_training',  5, true)
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
