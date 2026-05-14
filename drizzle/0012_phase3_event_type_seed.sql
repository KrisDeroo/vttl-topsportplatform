-- Migration 0012_phase3_event_type_seed.sql — Phase 3 Wave 1.
-- Lookup reference data for the 6 event types per UI3-D11 + D-47.
--
-- Codes are language-neutral per I18N-05 (CONTEXT canonical_refs). Display
-- labels live in messages/{nl,en,fr}.json under lookup.eventType.* — added
-- in Plan 03 (Wave 2 i18n catalog updates) per UI-SPEC §Lookup additions
-- (lines 524-535).
--
-- ON CONFLICT DO NOTHING makes the migration idempotent (re-runs are no-ops).
-- sort_order matches UI-SPEC presentation order in the event-type filter chips.

INSERT INTO "event_type" ("code", "sort_order", "active") VALUES
  ('event_type_training',          1, true),
  ('event_type_tournament',        2, true),
  ('event_type_meeting',           3, true),
  ('event_type_stage',             4, true),
  ('event_type_eval_conversation', 5, true),
  ('event_type_medical',           6, true)
ON CONFLICT ("code") DO NOTHING;
