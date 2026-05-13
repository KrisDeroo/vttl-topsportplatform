# Rollback — 0007_phase2_rls_policies

**Risk:** Medium. Disabling RLS on `players`, `trainers`, `uploaded_files`, and `age_category_history` removes the database-level enforcement of role-based scope on the Phase 2 tables. The application layer in plans 02-09 / 02-10 still enforces scope through tRPC (`protectedProcedure` / `tdProcedure` / `withRlsContext`), so app-mediated requests remain gated. The exposure window is direct-DB queries — a wrong-scope caller with `app_user` credentials (or a leaked migration-owner password) could `SELECT *` from any of the four tables. For Phase 2 dev / staging this is acceptable for the rollback window; **production rollback should be paired with rotating the `app_user` password** to prevent direct-DB use during the gap. Storage bucket policies revert similarly; the `profiles` bucket row itself is intentionally left in place so existing uploaded objects do not orphan. Dropping the `mark_scan_result()` SECURITY DEFINER function will break the BullMQ malware-scan worker (plan 02-06) — every subsequent worker job will throw `function mark_scan_result does not exist` and BullMQ will retry until the job is dead-lettered. Roll back plan 02-06's worker registration FIRST if the worker is running in production.

**Pre-conditions:**

- Phase 2 application code is OFFLINE (Coolify `web` service scaled to 0, `worker` service scaled to 0). A live request hitting `playerRouter` / `trainerRouter` / `fileRouter` while RLS is being unwound would briefly leak unbounded data.
- If plan 02-06's malware-scan worker is registered, scale it to 0 BEFORE dropping `mark_scan_result()` so in-flight jobs do not enter an infinite-retry loop.
- A fresh DB snapshot has been taken < 5 minutes before this runs.
- The dependent Phase 2 migrations 0006 (schema) and 0008 (lookup seed) are NOT yet rolled back — those rollback runbooks reference the same tables and run AFTER this one (drop policies before dropping the tables they sit on).

**Order matters:** drop the SECURITY DEFINER function first (no other DB object depends on it), then storage.objects policies (independent of the new tables), then per-table policies, then DISABLE RLS. Mirrors the apply order in reverse.

**Procedure:**

1. Confirm Phase 2 application code is OFFLINE (web + worker services deactivated in Coolify) before disabling RLS. Otherwise live requests will see unbounded data.

2. Connect via `DIRECT_DATABASE_URL` (migration owner / `postgres` superuser — `app_user` lacks the privilege to ALTER TABLE … DISABLE ROW LEVEL SECURITY) and run:

   ```sql
   BEGIN;

   -- 1. Worker SECURITY DEFINER function first (no dependencies — drop early).
   REVOKE EXECUTE ON FUNCTION mark_scan_result(UUID, TEXT, TEXT, TIMESTAMPTZ) FROM app_user;
   DROP FUNCTION IF EXISTS mark_scan_result(UUID, TEXT, TEXT, TIMESTAMPTZ);

   -- 2. Storage policies (independent of the new tables).
   DROP POLICY IF EXISTS "profiles_td_all" ON storage.objects;
   DROP POLICY IF EXISTS "profiles_owner_write" ON storage.objects;
   DROP POLICY IF EXISTS "profiles_owner_read" ON storage.objects;

   -- 3. Table policies, reverse-creation order (idempotent — IF EXISTS).
   DROP POLICY IF EXISTS "age_category_history_delete" ON "age_category_history";
   DROP POLICY IF EXISTS "age_category_history_update" ON "age_category_history";
   DROP POLICY IF EXISTS "age_category_history_insert" ON "age_category_history";
   DROP POLICY IF EXISTS "age_category_history_select" ON "age_category_history";

   DROP POLICY IF EXISTS "uploaded_files_delete" ON "uploaded_files";
   DROP POLICY IF EXISTS "uploaded_files_update" ON "uploaded_files";
   DROP POLICY IF EXISTS "uploaded_files_insert" ON "uploaded_files";
   DROP POLICY IF EXISTS "uploaded_files_select" ON "uploaded_files";

   DROP POLICY IF EXISTS "trainers_delete" ON "trainers";
   DROP POLICY IF EXISTS "trainers_update" ON "trainers";
   DROP POLICY IF EXISTS "trainers_insert" ON "trainers";
   DROP POLICY IF EXISTS "trainers_select" ON "trainers";

   DROP POLICY IF EXISTS "players_delete" ON "players";
   DROP POLICY IF EXISTS "players_update" ON "players";
   DROP POLICY IF EXISTS "players_insert" ON "players";
   DROP POLICY IF EXISTS "players_select" ON "players";

   -- 4. Disable FORCE then RLS (mirror the apply order).
   ALTER TABLE "age_category_history" NO FORCE ROW LEVEL SECURITY;
   ALTER TABLE "age_category_history" DISABLE ROW LEVEL SECURITY;
   ALTER TABLE "uploaded_files" NO FORCE ROW LEVEL SECURITY;
   ALTER TABLE "uploaded_files" DISABLE ROW LEVEL SECURITY;
   ALTER TABLE "trainers" NO FORCE ROW LEVEL SECURITY;
   ALTER TABLE "trainers" DISABLE ROW LEVEL SECURITY;
   ALTER TABLE "players" NO FORCE ROW LEVEL SECURITY;
   ALTER TABLE "players" DISABLE ROW LEVEL SECURITY;

   -- Note: the profiles bucket row in storage.buckets is intentionally
   -- NOT dropped. DELETing it would orphan any existing uploaded objects
   -- (Supabase Storage references the bucket via FK); the bucket survives
   -- — it is harmless without any policies attached.

   COMMIT;
   ```

3. Update `drizzle/meta/_journal.json` to remove the `idx 7` entry (tag `0007_phase2_rls_policies`) and delete `drizzle/meta/0007_snapshot.json`.

4. `git revert` the commit that introduced 0007. This also reverts the `src/server/auth/permissions.ts` matrix extensions from plan 02-05 Task 3 — re-deploy the application from the reverted commit so the tRPC procedure presets (Task 3 in plans 02-09 / 02-10) do not call `hasPermission(role, 'players.read_any')` against a permission code that no longer exists.

**Verification:**

1. `psql "$DIRECT_DATABASE_URL" -c "SELECT polname FROM pg_policy WHERE polname LIKE 'players_%' OR polname LIKE 'trainers_%' OR polname LIKE 'uploaded_files_%' OR polname LIKE 'age_category_history_%' OR polname LIKE 'profiles_%'"` returns 0 rows.

2. `psql "$DIRECT_DATABASE_URL" -c "SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname IN ('players','trainers','uploaded_files','age_category_history')"` returns `f, f` for all 4.

3. `psql "$DIRECT_DATABASE_URL" -c "\df mark_scan_result"` returns an empty result set (function gone).

4. `psql "$DIRECT_DATABASE_URL" -c "SELECT id FROM storage.buckets WHERE id='profiles'"` returns 1 row (bucket survives so existing objects do not orphan).

5. `pnpm test -- migration-format` passes — the rollback companion's canonical markers (`**Risk:**`, `**Procedure:**`, `**Verification:**`) remain in this file even after revert, because the revert deletes the entire file (the test only checks SQL files that still exist on disk).

## When to roll back

Apply this rollback only if RLS policy semantics are wrong (e.g., over-blocking TD reads after a production cutover, or accidentally exposing cross-academy player rows due to a `players_visible_to()` regression). Wrong-direction policy errors (under-blocking) should be fixed with a NEW migration that `ALTER POLICY` / `DROP POLICY` + `CREATE POLICY` (per MIG-01 immutability), not by rolling back the whole file.

A `mark_scan_result()` defect specifically (e.g., wrong status value escaping the whitelist) should also be fixed by `CREATE OR REPLACE FUNCTION` in a new migration — the rollback path is only correct when the entire RLS surface is being removed.

## Background

The 19 policies + storage bootstrap + `mark_scan_result()` SECURITY DEFINER function were intentionally separated from the schema migration (0006) so a defective policy can be reverted without dropping the underlying data-bearing tables. RLS-related debugging is also faster against an isolated, named migration: a `\dp uploaded_files` against the live DB matches a single source file, not a smear across 0006/0007.

The SECURITY DEFINER bridge function lives in this migration (rather than its own file) because:

1. It is logically part of the RLS contract — the worker only needs it BECAUSE direct UPDATEs from `app_user` are gated by `uploaded_files_update`.
2. Splitting it would require an extra migration file with no schema diff (and `drizzle-kit generate` does not emit SECURITY DEFINER DDL either).
3. The rollback path is the same: drop the function in the same window the policies are dropped.

## If rollback fails

- "cannot drop function mark_scan_result — other objects depend on it" → an unexpected caller (e.g., a Phase 5 medical scan worker added later) wired itself to the same function. Identify the dependent via `psql -c "SELECT classid, objid, refclassid, refobjid FROM pg_depend WHERE refobjid = (SELECT oid FROM pg_proc WHERE proname='mark_scan_result' LIMIT 1)"`. Either drop the dependent first or use `DROP FUNCTION … CASCADE` (logs every dropped dependency at NOTICE — capture for the incident report).

- "permission denied to ALTER TABLE players" → the connection user is `app_user` (which has table CRUD but no ALTER). Reconnect as the migration owner / `postgres` superuser.

- "cannot drop policy because no policy exists" — already-partial rollback. Re-run the entire block; `DROP POLICY IF EXISTS` is idempotent.

- BullMQ worker stuck in retry loop after function dropped → scale the `worker` Coolify service to 0, run `redis-cli FLUSHDB` on the BullMQ Redis namespace, then re-deploy the worker code from the reverted commit (which removes the worker registration).
