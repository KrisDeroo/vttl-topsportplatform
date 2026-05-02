# Rollback — 0001_medical_isolated.sql

**Risk:** This rollback DROPS every Article-9 special-category-data table
(`medical_events`, `medical_documents`, `medical_access_audit`) plus the
two write-time audit-trigger functions and the four FKs back to `users`.
Only execute on dev/staging or after a Point-In-Time Recovery has restored
the data from backup. **Never run in production with non-test medical
records** — this irrecoverably destroys data subject to the 30-year
retention obligation under the Belgian Patient Rights Act (1973/2002,
OPS-10) and to the 6-year medical-access-audit retention under OPS-02.
Doing so without a documented incident-commander sign-off is an
Article-32(b) accountability breach.

**Pre-conditions:**
- All later migrations that depend on these tables (Plan 04 RLS policies
  on medical_*, Plan 11 GUC plumbing, any Phase-5 medical-feature
  migrations) have ALREADY been rolled back via their own `*.rollback.md`
  runbooks. Specifically: Plan 04 attaches `pgPolicy()` to each medical
  table; running this file first would error with "cannot drop table —
  policy depends on it".
- The application is taken offline for the duration (Coolify: scale `web`
  and `worker` services to 0). The audit triggers fire under
  SECURITY DEFINER privileges; if a request lands mid-rollback, the
  trigger function may be partially deleted and an INSERT will fail with
  "function does not exist", which appears in production logs as a 500
  rather than the expected blocked-by-RLS 403.
- A fresh backup snapshot has been taken < 5 minutes before this runs —
  the only safe rollback path for medical data is one that can be
  re-restored via PITR if mid-rollback we discover unsoftd-eleted history
  we still needed.

**Order matters:** drop dependent objects (triggers, indexes) before
their parents; drop tables in reverse FK-creation order
(`medical_documents` → `medical_events` → `medical_access_audit`); the
audit-trigger functions go last so an inadvertent re-run does not leave
a function pointing at a non-existent table.

**Procedure:**

```sql
BEGIN;

-- 1. Triggers
DROP TRIGGER IF EXISTS trg_medical_document_audit ON medical_documents;
DROP TRIGGER IF EXISTS trg_medical_event_audit ON medical_events;
DROP TRIGGER IF EXISTS trg_medical_events_updated_at ON medical_events;

-- 2. Trigger functions (after their triggers are gone)
DROP FUNCTION IF EXISTS medical_document_audit();
DROP FUNCTION IF EXISTS medical_event_audit();

-- 3. Performance indexes (drops are idempotent; no-op if already gone via
--    Plan-04 rollback's RLS-policy unwind).
DROP INDEX IF EXISTS idx_maa_actor;
DROP INDEX IF EXISTS idx_maa_subject;
DROP INDEX IF EXISTS idx_medical_documents_player;
DROP INDEX IF EXISTS idx_medical_documents_event;
DROP INDEX IF EXISTS idx_medical_events_player_dates;
DROP INDEX IF EXISTS idx_medical_events_player;

-- 4. Tables. medical_documents has FKs into medical_events; drop docs first.
--    medical_access_audit has no FKs (intentional — it must outlive any
--    parent record so deletes are recorded), so it can be dropped at any
--    point after its referencing trigger functions are gone.
DROP TABLE IF EXISTS medical_documents;
DROP TABLE IF EXISTS medical_events;
DROP TABLE IF EXISTS medical_access_audit;

-- 5. Role-grant cleanup is implicit — the GRANT INSERT and REVOKE
--    UPDATE/DELETE on medical_access_audit go away when the table goes
--    away. Do NOT revoke them separately; that would error with "table
--    does not exist".

COMMIT;
```

**Verification:**

```sql
\d medical_events            -- expected: 'Did not find any relation named "medical_events".'
\d medical_documents         -- expected: same
\d medical_access_audit      -- expected: same
\df medical_event_audit      -- expected: empty result set
\df medical_document_audit   -- expected: empty result set

-- Re-confirm that the journal still references this migration so a
-- subsequent `drizzle-kit migrate` re-applies it (or, if you intend to
-- abandon the migration entirely, delete the journal entry per the
-- Snapshot reconstruction note below).
SELECT * FROM public.drizzle_migrations WHERE hash LIKE '%0001_medical_isolated%';
```

**If rollback fails:**

- "cannot drop table because other objects depend on it" → another
  migration (Plan 04 RLS policies, or a Phase-5 follow-on migration)
  attached an object to the medical_* table. Roll those back first via
  their own `*.rollback.md` runbooks; then retry this file.
- "permission denied for table medical_access_audit" → the connection
  user is `app_user` (which had INSERT-only). Reconnect as the migration
  owner / `postgres` superuser and retry.
- "function medical_event_audit() depends on table medical_access_audit"
  → drop order was inverted; run `DROP FUNCTION ... CASCADE` to force,
  but only after confirming no triggers remain attached.

**When the rollback is not enough:**

A full rollback removes the schema and the data; if the goal was to
preserve audit history (subjects' rows in `medical_access_audit` are the
only artifact that proves access happened to a particular player's
records), this file is the wrong tool — instead:

1. Disable writes (Plan 04 RLS policy: USING (false) on medical_events
   / medical_documents) so no new audit rows accrue.
2. Cold-export `medical_access_audit` rows to encrypted S3-compatible
   storage with 30-year retention.
3. THEN run this rollback.

The 30-year retention obligation under the Patient Rights Act applies
to the medical records themselves, not to the access audit; but
GDPR Article-32(b) accountability prefers we keep both available for
the supervisory authority on request.

**Snapshot reconstruction (post-rollback):**

After running this rollback, the `drizzle/meta/_journal.json` file in
the repo no longer matches the DB state. Either:
1. (Preferred) `git revert` the migration commit so journal + DB stay
   in sync; or
2. Manually delete the `0001_medical_isolated` entry in `_journal.json`
   AND run `npx drizzle-kit introspect` to regenerate the snapshot
   from the current (post-rollback) DB. Verify the introspect output
   does NOT include any `medical_*` tables before committing.

**Forward-compatibility note:**

This migration file was hand-authored in the agent worktree (Plan 03 of
Wave 3) because the agent sandbox could not run `npm install` /
`npx drizzle-kit generate`. Plan 16 (Wave 7) is the first place where
drizzle-kit actually executes against staging; it will:
1. Apply this SQL via `drizzle-kit migrate`
2. Run `drizzle-kit introspect` to reconstruct
   `drizzle/meta/0001_snapshot.json` from the live schema
3. Commit the snapshot in a follow-up if drift is detected

A zero-diff check is enforced at that point (RESEARCH §Migration
Governance, MIG-01: never edit a committed migration once applied to
staging).
