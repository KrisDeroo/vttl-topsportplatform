# Rollback — 0006_phase2_profiles_and_files

**Risk:** Low. The migration is purely additive: dropping the 6 new tables removes Phase 2 schema entirely but leaves Phase 1 unmodified. The only externally-visible effect is that the application code in `src/server/trpc/routers/player.ts`, `trainer.ts`, and `file.ts` (deployed in Phase 2 Waves 3–4) will fail with "relation does not exist" errors on every request to those routers; the rest of the app (Phase 1 surfaces — login, admin user management, consent flow) continues working. RLS coverage from `0002_rls_functions_and_policies.sql` is untouched.

**Procedure:**

1. Confirm the application has been redeployed WITHOUT the Phase 2 router registrations (revert `src/server/trpc/routers/_app.ts` to its Phase 1 state — remove `playerRouter`, `trainerRouter`, `fileRouter` imports). Otherwise step 4 will leave a window where requests to those routers throw 500s instead of cleanly returning 404 at the route level.

2. If migration 0007 (RLS policies) has been applied, run its rollback FIRST — RLS policies reference the Phase 2 tables and will leave dangling `pg_policy` entries if dropped out of order.

3. If migration 0008 (lookup seed) has been applied, run its rollback FIRST — it inserts rows into `age_categories` and `trainer_diploma` which would block schema DROP without CASCADE.

4. Connect to the target Postgres via `DIRECT_DATABASE_URL` and run:

   ```sql
   BEGIN;
   DROP TABLE IF EXISTS public.age_category_history CASCADE;
   DROP TABLE IF EXISTS public.players CASCADE;
   DROP TABLE IF EXISTS public.trainers CASCADE;
   DROP TABLE IF EXISTS public.uploaded_files CASCADE;
   DROP TABLE IF EXISTS public.age_categories CASCADE;
   DROP TABLE IF EXISTS public.trainer_diploma CASCADE;
   COMMIT;
   ```

   Order rationale: `age_category_history` depends on `players` + `age_categories`; `players` and `trainers` depend on `uploaded_files` (`profile_photo_file_id` FK) and on the lookup tables. CASCADE on each DROP guards against dangling FK indexes/constraints — sequence order above keeps the explicit dependency unwound first so CASCADE is a belt-and-braces fallback, not the primary mechanism.

5. Update `drizzle/meta/_journal.json` to remove the `idx 6` entry and delete `drizzle/meta/0006_snapshot.json`.

6. `git revert` the commit that introduced migration 0006 (this restores the TS schema files too).

7. Run `pnpm test -- migration-format` to confirm the test suite still recognises the remaining migrations.

**Verification:**

1. `psql "$DIRECT_DATABASE_URL" -c "\d players"` reports `Did not find any relation named "players".`
2. `psql "$DIRECT_DATABASE_URL" -c "\d uploaded_files"` same.
3. `psql "$DIRECT_DATABASE_URL" -c "\d age_category_history"` same.
4. `psql "$DIRECT_DATABASE_URL" -c "\d trainers"` same.
5. `psql "$DIRECT_DATABASE_URL" -c "\d age_categories"` same.
6. `psql "$DIRECT_DATABASE_URL" -c "\d trainer_diploma"` same.
7. `psql "$DIRECT_DATABASE_URL" -c "SELECT count(*) FROM pg_tables WHERE schemaname='public'"` returns the Phase 1 count (19 tables — see `.planning/phases/01-fundament/01-16-MIGRATION-LOG.md` once present; until then, the count is `users`, `sessions`, `accounts`, `verifications`, `status`, `academy`, `tournament_type`, `ranking_type`, `training_type`, `organisation`, `outcome_level`, `academy_memberships`, `parent_child_links`, `consent_records`, `audit_log`, `idempotency_keys`, `medical_events`, `medical_documents`, `medical_access_audit`).
8. `npx drizzle-kit migrate` is a no-op (journal matches DB state).
9. Phase 1 surfaces (login, /admin/users) function normally — `curl http://localhost:3000/api/health/ready` returns 200.

## When to roll back

Use this procedure only if a defect in the 6-table schema would compromise production data integrity. Schema-level defects discovered before push to production (i.e., during 02-14) should be fixed by:

1. Adding a NEW migration 0007 that ALTERs/adds the corrective DDL (per MIG-01 — never edit committed 0006).
2. OR for pre-push fixes: `rm drizzle/0006_*` + `rm drizzle/meta/0006*` + revert the relevant `_journal.json` lines + fix the TS schema in 02-02 + re-run `drizzle-kit generate` (followed by manual filtering for additive-only diff — see the migration file header for the worktree pattern that produced the original).

## If rollback fails

- "cannot drop table because other objects depend on it" — migration 0007 (RLS policies) is still attached. Roll it back first via `drizzle/0007_*.rollback.md`, then retry this file.
- "permission denied for table players" — the connection user is `app_user` (which lacks DDL). Reconnect as the migration owner / `postgres` superuser and retry.
- Seed data conflict — migration 0008 has inserted rows into `age_categories` or `trainer_diploma`. Run `0008_*.rollback.md` first.

## Background

Phase 2 introduces the player/trainer identity domain. The schema is intentionally split across 3 migrations (0006 = additive schema, 0007 = RLS policies, 0008 = lookup seed) so each has an independent rollback path — a defect in the RLS policy set can be reverted without dropping the data-bearing tables, and a defect in the seed data can be reverted without dropping RLS.

## Forward-compatibility note

This migration file was hand-extracted in the agent worktree (Plan 02-03) because `drizzle-kit generate` with no prior snapshots in `drizzle/meta/` emits the full schema, not the additive diff. Plan 02-14 (Wave 7 — the first wave where drizzle-kit executes against staging) will reconcile via `drizzle-kit introspect` and `drizzle-kit migrate`, asserting zero diff between this file and the staging DB after apply. Same governance contract as the Phase 1 migrations (`0000_initial.sql`, `0001_medical_isolated.sql`, etc., which are also hand-authored — MIG-01: never edit a committed migration once applied to staging).
