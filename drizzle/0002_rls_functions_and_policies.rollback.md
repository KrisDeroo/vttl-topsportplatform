# Rollback — 0002_rls_functions_and_policies.sql

**Risk:** This rollback removes the row-level security backstop on every
sensitive table — `users`, `sessions`, `accounts`, `verifications`,
`parent_child_links`, `academy_memberships`, `consent_records`,
`idempotency_keys`, `audit_log`, `medical_events`, `medical_documents`,
`medical_access_audit`, plus the seven lookup tables. After this runbook
completes, the `app_user` Postgres role can `SELECT *` from every row in
every table — including foreign players' medical events, every consent
snapshot, the full audit log, and the tamper-evident
`medical_access_audit` (the table's `USING (false)` policy is gone).
Only execute during incident response with explicit incident-commander
sign-off (CRIT-1: defense-in-depth is a hard constraint of the platform's
security posture). Belgian DPA notification under Article 33 GDPR may be
required if rollback occurs in production with live medical data.

The `players_visible_to()` and `query_medical_access_audit()` functions
are dropped at the end. Code paths in Phase 5 + Phase 7 that depend on
these functions (training-plan visibility, TD audit-readback UI) will
fail with `function does not exist` until the migration is re-applied or
those code paths are scaffolded with a fallback. Roll back the dependent
phase migrations first.

**Pre-conditions:**
- All phases that added new RLS policies (Phase 2 player profile, Phase 5
  medical-injury-traffic-light VIEW, Phase 7 admin) have ALREADY been
  rolled back via their own `*.rollback.md` runbooks. Otherwise this
  runbook will leave orphan policies dangling on tables we re-DISABLE.
- The application is taken offline for the duration (Coolify: scale `web`
  and `worker` services to 0). A live request that hits a code path
  expecting RLS to enforce scoping will leak data while RLS is being
  unwound.
- Plan 11's tRPC middleware is still wired (it reads
  `current_user_id()` to build CallerContext) — rolling back this
  migration without first reverting Plan 11 would crash the request
  pipeline with `function current_user_id() does not exist`.
- A fresh backup snapshot has been taken < 5 minutes before this runs.

**Order matters:** drop policies BEFORE dropping the functions they
reference (`current_user_id()`, `current_user_role()`,
`players_visible_to()`); otherwise Postgres aborts with "cannot drop
function — policy depends on it". Then disable RLS on each table; then
drop the functions.

**Procedure:**

```sql
BEGIN;

-- 1. Drop every policy. Order within this block does not matter once
-- the dependent functions are dropped last.

-- USERS
DROP POLICY IF EXISTS users_self_or_td ON users;
DROP POLICY IF EXISTS users_td_writes ON users;
DROP POLICY IF EXISTS users_self_or_td_updates ON users;

-- SESSIONS
DROP POLICY IF EXISTS sessions_owner ON sessions;

-- ACCOUNTS
DROP POLICY IF EXISTS accounts_owner ON accounts;

-- VERIFICATIONS
DROP POLICY IF EXISTS verifications_anon_inserts ON verifications;
DROP POLICY IF EXISTS verifications_consume ON verifications;

-- PARENT_CHILD_LINKS
DROP POLICY IF EXISTS pcl_visible ON parent_child_links;
DROP POLICY IF EXISTS pcl_td_writes ON parent_child_links;
DROP POLICY IF EXISTS pcl_td_updates ON parent_child_links;
DROP POLICY IF EXISTS pcl_td_deletes ON parent_child_links;

-- ACADEMY_MEMBERSHIPS
DROP POLICY IF EXISTS am_visible ON academy_memberships;
DROP POLICY IF EXISTS am_td_writes ON academy_memberships;
DROP POLICY IF EXISTS am_td_updates ON academy_memberships;
DROP POLICY IF EXISTS am_td_deletes ON academy_memberships;

-- CONSENT_RECORDS
DROP POLICY IF EXISTS consent_visible ON consent_records;
DROP POLICY IF EXISTS consent_inserts ON consent_records;
DROP POLICY IF EXISTS consent_withdraw ON consent_records;

-- IDEMPOTENCY_KEYS
DROP POLICY IF EXISTS idempotency_owner ON idempotency_keys;

-- AUDIT_LOG
DROP POLICY IF EXISTS audit_log_no_select ON audit_log;
DROP POLICY IF EXISTS audit_log_inserts ON audit_log;

-- LOOKUPS
DROP POLICY IF EXISTS status_read ON status;
DROP POLICY IF EXISTS status_td_writes ON status;
DROP POLICY IF EXISTS academy_read ON academy;
DROP POLICY IF EXISTS academy_td_writes ON academy;
DROP POLICY IF EXISTS tt_read ON tournament_type;
DROP POLICY IF EXISTS tt_td_writes ON tournament_type;
DROP POLICY IF EXISTS rt_read ON ranking_type;
DROP POLICY IF EXISTS rt_td_writes ON ranking_type;
DROP POLICY IF EXISTS trt_read ON training_type;
DROP POLICY IF EXISTS trt_td_writes ON training_type;
DROP POLICY IF EXISTS org_read ON organisation;
DROP POLICY IF EXISTS org_td_writes ON organisation;
DROP POLICY IF EXISTS ol_read ON outcome_level;
DROP POLICY IF EXISTS ol_td_writes ON outcome_level;

-- MEDICAL_EVENTS
DROP POLICY IF EXISTS medical_events_read ON medical_events;
DROP POLICY IF EXISTS medical_events_write ON medical_events;
DROP POLICY IF EXISTS medical_events_update ON medical_events;

-- MEDICAL_DOCUMENTS
DROP POLICY IF EXISTS medical_documents_read ON medical_documents;
DROP POLICY IF EXISTS medical_documents_write ON medical_documents;
DROP POLICY IF EXISTS medical_documents_update ON medical_documents;

-- MEDICAL_ACCESS_AUDIT
DROP POLICY IF EXISTS maa_no_select ON medical_access_audit;
DROP POLICY IF EXISTS maa_insert ON medical_access_audit;

-- 2. Disable RLS on every table. ENABLE without FORCE would still
-- exempt the table owner; FORCE is the strict mode we DISABLE here.
-- DISABLE clears both flags.
ALTER TABLE users DISABLE ROW LEVEL SECURITY;
ALTER TABLE sessions DISABLE ROW LEVEL SECURITY;
ALTER TABLE accounts DISABLE ROW LEVEL SECURITY;
ALTER TABLE verifications DISABLE ROW LEVEL SECURITY;
ALTER TABLE parent_child_links DISABLE ROW LEVEL SECURITY;
ALTER TABLE academy_memberships DISABLE ROW LEVEL SECURITY;
ALTER TABLE consent_records DISABLE ROW LEVEL SECURITY;
ALTER TABLE idempotency_keys DISABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log DISABLE ROW LEVEL SECURITY;
ALTER TABLE status DISABLE ROW LEVEL SECURITY;
ALTER TABLE academy DISABLE ROW LEVEL SECURITY;
ALTER TABLE tournament_type DISABLE ROW LEVEL SECURITY;
ALTER TABLE ranking_type DISABLE ROW LEVEL SECURITY;
ALTER TABLE training_type DISABLE ROW LEVEL SECURITY;
ALTER TABLE organisation DISABLE ROW LEVEL SECURITY;
ALTER TABLE outcome_level DISABLE ROW LEVEL SECURITY;
ALTER TABLE medical_events DISABLE ROW LEVEL SECURITY;
ALTER TABLE medical_documents DISABLE ROW LEVEL SECURITY;
ALTER TABLE medical_access_audit DISABLE ROW LEVEL SECURITY;

-- 3. Drop the SECURITY DEFINER helper functions. Order: dependents
-- (query_medical_access_audit, players_visible_to) before the STABLE
-- wrappers. The wrappers are referenced only inside policies (which we
-- already dropped) and inside the players_visible_to body itself; once
-- both higher-level fns are gone, the wrappers can be dropped without
-- "cannot drop function — policy depends on it" errors.
DROP FUNCTION IF EXISTS query_medical_access_audit(UUID, TIMESTAMPTZ, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS players_visible_to(UUID, TEXT);
DROP FUNCTION IF EXISTS current_user_role();
DROP FUNCTION IF EXISTS current_user_id();

COMMIT;
```

**Verification:**

```sql
-- Every sensitive table should report Row security: off
\d+ users
\d+ medical_events
\d+ medical_access_audit
\d+ consent_records
\d+ audit_log

-- Functions should be gone
\df current_user_id        -- expected: empty result set
\df current_user_role      -- expected: empty result set
\df players_visible_to     -- expected: empty result set
\df query_medical_access_audit  -- expected: empty result set

-- Direct query that this migration was meant to block — should NOW
-- return rows for any caller (the smoking gun that RLS is gone):
SET app.user_id = '11111111-1111-1111-1111-111111111111';
SET app.user_role = 'trainer';
SELECT count(*) FROM medical_events;  -- expected: > 0 if data exists

-- Re-confirm the journal still references this migration so a
-- subsequent `drizzle-kit migrate` re-applies it (or, if you intend
-- to abandon the migration entirely, delete the journal entry per
-- the Snapshot reconstruction note below).
SELECT * FROM public.drizzle_migrations
 WHERE hash LIKE '%0002_rls_functions_and_policies%';
```

**If rollback fails:**

- "cannot drop function — N other objects depend on it" → a policy in
  a later phase still references `current_user_id()` /
  `current_user_role()` / `players_visible_to()`. Run the dependent
  phase's `*.rollback.md` first, OR temporarily issue
  `DROP FUNCTION … CASCADE` (logs every dropped policy at NOTICE
  level — capture that output for the incident report).
- "permission denied for table X" → the connection user is `app_user`
  (which has SELECT/INSERT/UPDATE/DELETE on the body of the table but
  not the privilege to ALTER it). Reconnect as the migration owner /
  `postgres` superuser.
- A trigger function failure mid-rollback (e.g.
  `medical_event_audit()` from Plan 03 fires while medical_events RLS
  is being unwound and tries to INSERT into medical_access_audit but
  RLS is mid-transition) → restart the rollback inside a single
  transaction, which is what the BEGIN/COMMIT block above ensures.
  If a partial rollback already committed, restore from the
  pre-rollback snapshot via PITR.

**Snapshot reconstruction (post-rollback):**

After running this rollback, the `drizzle/meta/_journal.json` file in
the repo no longer matches the DB state (the journal still claims
`0002_rls_functions_and_policies` is applied; the DB no longer has the
policies). Either:

1. (Preferred) `git revert` the migration commit so journal + DB stay
   in sync; the next `drizzle-kit migrate` is then a no-op.
2. Manually delete the `0002_rls_functions_and_policies` entry in
   `_journal.json` AND verify with `drizzle-kit introspect` that the
   reconstructed snapshot does NOT contain any of the policy/function
   definitions before committing.

**Forward-compatibility note:**

This migration file was hand-authored in the agent worktree (Plan 04 of
Wave 4) because raw RLS SQL is not auto-detected by drizzle-kit (RLS
isn't part of the schema barrel — policies live alongside CREATE TABLE
in raw SQL). Plan 16 (Wave 7) is the first place where drizzle-kit
actually executes against staging; it will:

1. Apply this SQL via `drizzle-kit migrate`.
2. Run the Wave-1 RLS direct-query test against the staging Postgres
   (`tests/rls/medical-isolation.test.ts`,
   `tests/rls/direct-query.test.ts`) and assert green.
3. Compute the SHA-256 of the migration body and store it in the
   journal entry as a tamper-evidence anchor.

A zero-diff check against `src/server/db/rls/{functions,policies}.sql`
is enforced at that point (RESEARCH §Migration Governance, MIG-01:
never edit a committed migration once applied to staging). If the
two readable artifacts and the migration body diverge, CI fails.
