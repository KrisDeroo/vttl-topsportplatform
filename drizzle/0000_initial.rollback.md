# Rollback — 0000_initial.sql

**Risk:** This rollback DROPS every Phase-1 table, both Postgres roles,
the trigger function, and the locale/user_role enums. Only run on
dev/staging after a full restore from PITR. **Never run in production**
without an explicit incident-commander sign-off.

**Procedure:** drop dependent objects (triggers, indexes) before their parents; drop tables in reverse FK-creation order (child tables first); drop enums last so column defaults referencing them have already been removed by the table drops. Run the SQL block below inside a single transaction. Pre-conditions follow.

**Pre-conditions:**
- All later migrations (0001+, e.g. Plan 03 medical, Plan 04 RLS) have
  ALREADY been rolled back via their own `*.rollback.md` runbooks.
  This file does NOT roll back RLS policies that other migrations
  attached to these tables — running it before unwinding them will
  error out.
- The DB is taken offline for the duration (Coolify: scale `web` to 0).

**Order matters:** drop dependent objects (triggers, indexes) before
their parents; drop tables in reverse FK-creation order (child tables
first); drop enums last so column defaults referencing them have already
been removed by the table drops.

```sql
BEGIN;

-- 1. Triggers + trigger function
DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
DROP FUNCTION IF EXISTS set_updated_at();

-- 2. Performance indexes
DROP INDEX IF EXISTS idx_audit_resource;
DROP INDEX IF EXISTS idx_audit_actor;
DROP INDEX IF EXISTS idx_consent_user;
DROP INDEX IF EXISTS idx_am_academy_role;
DROP INDEX IF EXISTS idx_am_user_role;
DROP INDEX IF EXISTS idx_pcl_child;
DROP INDEX IF EXISTS idx_pcl_parent;

-- 3. Tables that FK to users — drop these BEFORE users
DROP TABLE IF EXISTS idempotency_keys;
DROP TABLE IF EXISTS audit_log;
DROP TABLE IF EXISTS consent_records;
DROP TABLE IF EXISTS parent_child_links;
DROP TABLE IF EXISTS academy_memberships;
DROP TABLE IF EXISTS verifications;
DROP TABLE IF EXISTS accounts;
DROP TABLE IF EXISTS sessions;

-- 4. Users table itself
DROP TABLE IF EXISTS users;

-- 5. Lookup tables
DROP TABLE IF EXISTS outcome_level;
DROP TABLE IF EXISTS organisation;
DROP TABLE IF EXISTS training_type;
DROP TABLE IF EXISTS ranking_type;
DROP TABLE IF EXISTS tournament_type;
DROP TABLE IF EXISTS academy;
DROP TABLE IF EXISTS status;

-- 6. Enums (only after every column referencing them is gone)
DROP TYPE IF EXISTS user_role;
DROP TYPE IF EXISTS locale;

-- 7. Postgres roles — revoke first, then drop
REVOKE ALL ON SCHEMA public FROM app_user, app_audit_writer;
DROP ROLE IF EXISTS app_audit_writer;
DROP ROLE IF EXISTS app_user;

-- 8. pgcrypto extension is left in place — other migrations may rely on it.
-- Uncomment only if you're rolling back to a pre-Phase-1 state:
-- DROP EXTENSION IF EXISTS pgcrypto;

COMMIT;
```

**Verification after rollback:**

```sql
\d users          -- expected: 'Did not find any relation named "users".'
\du app_user      -- expected: empty result set
\dT locale        -- expected: 'Did not find any matching type'
```

**If rollback fails:**
- "cannot drop table because other objects depend on it" → another
  migration (Plan 03 / Plan 04) attached an RLS policy or function;
  roll that back first via its own `*.rollback.md`.
- "cannot drop role because some objects depend on it" → there are
  tables owned by `app_user` (unlikely with our setup); reassign
  ownership: `REASSIGN OWNED BY app_user TO postgres; DROP OWNED BY app_user;`

**Snapshot reconstruction (post-rollback):**

After running this rollback, the `drizzle/meta/_journal.json` file in
the repo no longer matches the DB state. Either:
1. (Preferred) `git revert` the migration commit so journal + DB stay in sync; or
2. Manually delete the journal entry for `0000_initial` AND run
   `npx drizzle-kit introspect` to regenerate `0000_snapshot.json`
   from the current (post-rollback, empty) DB.

**Forward-compatibility note:**

This migration file was hand-authored in the agent worktree (Plan 02 of
Wave 2) because the agent sandbox could not run `npm install` /
`npx drizzle-kit generate`. Plan 16 (Wave 7) is the first place where
drizzle-kit actually executes against staging; it will:
1. Apply this SQL via `drizzle-kit migrate`
2. Run `drizzle-kit introspect` to reconstruct
   `drizzle/meta/0000_snapshot.json` from the live schema
3. Commit the snapshot in a follow-up if drift is detected

A zero-diff check is enforced at that point (RESEARCH §Migration Governance,
MIG-01: never edit a committed migration once applied to staging).

**Verification:** After the rollback transaction commits, confirm:
1. `\dt` in `psql` shows none of the dropped tables (users, sessions, accounts, verifications, lookups, academy_memberships, parent_child_links, consent_records, audit_log, idempotency_keys).
2. `\dT+ user_role` and `\dT+ locale_code` return no rows (enums dropped).
3. `\df set_updated_at` returns no rows (trigger function dropped).
4. The application web tier remains scaled to 0 until 0000_initial.sql is re-applied — without the schema, every request 500s on the first DB call.
