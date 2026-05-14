# Rollback — 0012_phase3_event_type_seed

**Risk:** Low. Deleting the 6 event_type rows leaves the `event_type` table empty. Any subsequent `calendar.event.create` request will fail at the `calendar_events.type_code` FK with "key is not present in table 'event_type'", which surfaces as a Zod-level validation error if the lookup code is empty. Existing `calendar_events` rows referencing a code that is being deleted will block the DELETE (ON DELETE RESTRICT FK) — this is intentional safety.

**Procedure:**

1. Confirm no live `calendar_events` rows reference the codes being removed:
   ```sql
   SELECT type_code, count(*) FROM calendar_events GROUP BY type_code;
   ```
   If any group has count > 0, do NOT proceed — either roll back the parent calendar migrations first OR keep this seed migration applied.
2. Connect via DIRECT_DATABASE_URL and run:
   ```sql
   BEGIN;
   DELETE FROM "event_type" WHERE "code" IN (
     'event_type_training', 'event_type_tournament', 'event_type_meeting',
     'event_type_stage', 'event_type_eval_conversation', 'event_type_medical'
   );
   COMMIT;
   ```

**Verification:**

1. `SELECT count(*) FROM event_type;` returns the count of remaining seeded rows (0 if no later migration added more).
2. `SELECT 1 FROM event_type WHERE code = 'event_type_training';` returns 0 rows.
