-- Migration 0005_consenting_party_not_null.sql — Phase 1 review fix.
-- WR-11: consent_records.consenting_party_user_id must be NOT NULL.
--
-- Background: Migration 0000 / src/server/db/schema/consent.ts declared
-- this column as nullable. The consent_inserts RLS policy (Migration
-- 0002 line 305-310) WITH CHECK clause is:
--   user_id = current_user_id()
--   OR consenting_party_user_id = current_user_id()
--   OR current_user_role() = 'technical_director'
-- which means a TD-context insert can leave consenting_party_user_id
-- NULL — orphaned consent with no attributable agent. Belgian Art. 8
-- requires this column to identify "who clicked agree", and the
-- CR-02 fix in src/server/trpc/routers/consent.ts now always sets it
-- to the caller's user_id, so the schema can match the runtime
-- contract.
--
-- Backfill: rows that already exist with NULL get
-- consenting_party_user_id = user_id (the safest assumption for a
-- pre-fix self-consent row). If any row in production carries a
-- different actual consenting party, that fact is now lost — but the
-- migration runs against a fresh phase-1 staging where no such rows
-- exist yet (this phase has not deployed). Producing a backfill that
-- preserves alternative consenting parties would require a
-- maintenance window and is out of scope here.
--
-- Hand-authored — same governance rule as the other migrations
-- (MIG-01, never edit in place).

UPDATE consent_records
   SET consenting_party_user_id = user_id
 WHERE consenting_party_user_id IS NULL;--> statement-breakpoint

ALTER TABLE consent_records
  ALTER COLUMN consenting_party_user_id SET NOT NULL;
