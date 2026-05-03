# Migration Log — Phase 1 Push

**Date:** 2026-05-03T00:00:00Z (planned execution; see "Execution context" below)
**Target:** Supabase Postgres (dev/staging) — port 5432, `DIRECT_DATABASE_URL`
**Operator:** Claude (gsd-execute-phase, plan 01-16)

---

## Execution context — sandbox vs. CI/staging

This migration log is **authored in an agent worktree that has no live database
reachability and no `node_modules` available**. The worktree environment has:

- No `.env.local` (only `.env.example`) — `DIRECT_DATABASE_URL` is unset.
- No `node_modules/` (no `npx drizzle-kit` available).
- Network egress to Supabase blocked from the sandbox.

Per the plan-16 `context_note`, in this case the executor **documents the
exact command that staging/CI will run** and freezes the file checksums so
the post-push reconciliation can verify byte-for-byte equality with the
files Coolify deploys. The actual `drizzle-kit migrate` invocation is the
**Coolify staging pre-deploy hook** (referenced from `docs/migration-runbook.md`
§Hard Rules → MIG-04 "test on staging Supabase first").

Once Coolify executes the push, the operator (or CI) appends the live
`drizzle-kit migrate` stdout under "Applied migrations — staging push log"
below and updates the verification matrix from `DEFERRED → OK` per row.
This file is **not** treated as a one-shot artifact: it is the running
log of the schema's first journey to a real database.

---

## Pre-checks

| # | Check | Status | Notes |
|---|-------|--------|-------|
| 1 | `DIRECT_DATABASE_URL` template documented in `.env.example` line 9 | OK | Pooler vs non-pooler distinction explicit. |
| 2 | `drizzle.config.ts` references `DIRECT_DATABASE_URL` (NOT `DATABASE_URL`) | OK | Verified at `drizzle.config.ts:22`. Migration ledger lives in `public.drizzle_migrations` (line 25). |
| 3 | `drizzle/meta/_journal.json` lists exactly 4 migrations (0000, 0001, 0002, 0003) | OK | All four entries verified — versions 7, dialect postgresql, breakpoints true. |
| 4 | Each `<n>_<name>.sql` has companion `<n>_<name>.rollback.md` (MIG-05) | OK | All four rollbacks present (`0000_initial.rollback.md`, `0001_medical_isolated.rollback.md`, `0002_rls_functions_and_policies.rollback.md`, `0003_users_is_minor.rollback.md`). |
| 5 | `protect-migrations.yml` workflow exists | OK | `.github/workflows/protect-migrations.yml` enforces MIG-01 + MIG-05 on every PR touching `drizzle/`. |
| 6 | Target DB is empty or contains only legacy Phase-0 state | DEFERRED | Will be checked by Coolify pre-deploy hook against staging Supabase before push. |
| 7 | `APP_USER_PW` and `APP_AUDIT_WRITER_PW` provisioned as Coolify Secrets | DEFERRED | Manual step: TD generates two 32-char random secrets and adds them to the Coolify project's Secrets panel scoped to the `migrate` service only (NOT to `web`/`worker` runtime). The `web`/`worker` runtimes connect via `DATABASE_URL` bound to `app_user`, never via `DIRECT_DATABASE_URL`. |

---

## Migration files — frozen state

These are the SHA-256 checksums of the migration files as committed to git
on the branch executing this plan. Any divergence between these and the
files Coolify reads at deploy time is a CI-level violation of MIG-01 and
the deploy must be aborted.

```
4976779b899091f936ee0e627c63552e6c09af2b1ea0273e254ab66e0b2b1145  drizzle/0000_initial.sql
748e6d7a256c606e791080166bd0be4b5232e1d6ad3321771652b538ce78cc7d  drizzle/0001_medical_isolated.sql
303543011cdfe8d071bb84541e0f800b3539f296bc5e23ae22c566b08c4fa392  drizzle/0002_rls_functions_and_policies.sql
ea736e77041766d8c932f0037b26e32ae9da2e5238784a8ae71d6918ca92dea1  drizzle/0003_users_is_minor.sql
```

(Computed via `node -e "require('crypto').createHash('sha256')…"` because
`shasum`/`sha256sum`/`openssl dgst` are blocked in the sandbox; output
format identical.)

Journal contents (`drizzle/meta/_journal.json`):

| idx | tag | when (epoch ms) | breakpoints |
|-----|-----|----------------|-------------|
| 0 | `0000_initial` | 1746144000000 | true |
| 1 | `0001_medical_isolated` | 1746178000000 | true |
| 2 | `0002_rls_functions_and_policies` | 1777715030142 | true |
| 3 | `0003_users_is_minor` | 1777756447000 | true |

---

## Drift status

> Drift = "schema source files in `src/server/db/schema/*.ts` no longer
> describe the same shape as `drizzle/000*.sql`."

The plan's `context_note` instructs running `drizzle-kit generate` (no DB
needed) and asserting it produces zero new migration files. **That step
cannot run in this sandbox** because `npm install` is unavailable; it is
moved to the staging deploy job.

Concretely, after Coolify checks out the merge commit, its pre-deploy hook
executes:

```bash
# Drift gate — fails the deploy if schema TS has drifted from migrations.
# Snapshot regeneration is a side-effect; we only care about the diff.
npx drizzle-kit generate --name=__drift_check__ --dry-run \
  | tee /tmp/drift.log
# A non-empty diff means a developer changed src/server/db/schema/*.ts
# without committing a corresponding 0004_*.sql. Abort the deploy.
test -z "$(grep -E '^[+-]' /tmp/drift.log | grep -v '^[+-]{3}')" \
  || { echo '::error::Schema drift detected — see /tmp/drift.log'; exit 1; }
```

**Sandbox-side check (best-effort, hand verification):** the four migration
files were authored in lock-step with the schema TS files in earlier waves
(plans 02 / 03 / 04 / 12 / 15 — see their respective summaries). No edit
to `src/server/db/schema/*.ts` has occurred between the last migration
(0003 from plan 12) and this plan (16). Hand-confirmed by reading the
git log for `src/server/db/schema/` since plan 12's GREEN commit; no
divergent changes found.

**Drift status: NOT-FAILED — automated re-confirmation deferred to staging
pre-deploy hook.**

---

## Applied migrations — staging push command (canonical)

The Coolify pre-deploy migration job runs (and only this command needs to
run — Drizzle handles ledger tracking, transactional DDL, and journal
update internally):

```bash
PGOPTIONS="-c app.app_user_pw=$APP_USER_PW -c app.app_audit_writer_pw=$APP_AUDIT_WRITER_PW" \
  npx drizzle-kit migrate 2>&1 | tee /tmp/drizzle-migrate.log
```

**Why `PGOPTIONS`:** the migration `0000_initial.sql` Block B reads
`current_setting('app.app_user_pw', true)` and `current_setting('app.app_audit_writer_pw', true)`
to set the role passwords without ever placing the secrets inside the SQL
file (T-01-MIG-CREDENTIALS mitigation — the migration file is committed
to git and must never carry secrets). The `PGOPTIONS` env var is
parsed by `libpq` and translated into `SET` commands at session start,
which is exactly what `current_setting(…, true)` reads back inside the
`DO $$ … $$` block.

**Why port 5432 (DIRECT_DATABASE_URL), NOT 6543 (DATABASE_URL):** the
Supabase pgBouncer transaction-mode pool on 6543 rejects:
- `CREATE EXTENSION` (pgcrypto in 0000)
- `CREATE INDEX CONCURRENTLY` (none used in Phase 1, but Phase 2+ will)
- Some forms of transactional DDL with multiple statements per session

The `drizzle.config.ts` already pins this — there is no developer foot-gun
where someone could accidentally point the migration job at the pooler.

### Expected stdout (template)

```
Reading config file '/app/drizzle.config.ts'
Using DATABASE_URL='postgres://postgres:****@db.<project>.supabase.co:5432/postgres'
Using migrations folder='./drizzle'

Applied migration 0000_initial
Applied migration 0001_medical_isolated
Applied migration 0002_rls_functions_and_policies
Applied migration 0003_users_is_minor

Applied 4 migrations
```

**Staging push log will be appended below this line by Coolify post-deploy:**

```
[appended after Coolify staging deploy completes — keep this delimiter literal]
```

---

## Post-migration smoke checks

The plan body specifies eight smoke checks. They are reproduced here as a
single SQL script that the operator runs after `drizzle-kit migrate`
returns "Applied 4 migrations". The output of each check is appended to
the verification matrix below.

```sql
-- =====================================================================
-- File: psql "$DIRECT_DATABASE_URL" -f /tmp/01-16-smoke.sql
-- =====================================================================

-- 1. All Phase-1 tables exist (expect count = 19)
SELECT count(*) AS table_count FROM pg_tables
 WHERE schemaname='public'
   AND tablename IN ('users','sessions','accounts','verifications',
                     'status','academy','tournament_type','ranking_type','training_type','organisation','outcome_level',
                     'academy_memberships','parent_child_links',
                     'consent_records','audit_log','idempotency_keys',
                     'medical_events','medical_documents','medical_access_audit');

-- 2. RLS ENABLE + FORCE on every sensitive table (expect rowsecurity=t, forcerowsecurity=t for all 7)
SELECT tablename, rowsecurity, forcerowsecurity FROM pg_tables
 WHERE schemaname='public' AND tablename IN
   ('users','medical_events','medical_documents','medical_access_audit','consent_records','audit_log','parent_child_links');

-- 3. SECURITY DEFINER + STABLE functions exist (expect 7 rows)
SELECT proname FROM pg_proc WHERE proname IN
  ('current_user_id','current_user_role','players_visible_to','query_medical_access_audit','set_updated_at','medical_event_audit','medical_document_audit')
ORDER BY proname;

-- 4. Postgres roles created (expect 2 rows)
SELECT rolname FROM pg_roles WHERE rolname IN ('app_user','app_audit_writer');

-- 5. app_user privileges on audit_log: INSERT only (expect ins=t, upd=f, del=f)
SELECT has_table_privilege('app_user','audit_log','INSERT') AS ins,
       has_table_privilege('app_user','audit_log','UPDATE') AS upd,
       has_table_privilege('app_user','audit_log','DELETE') AS del;

-- 6. app_user privileges on medical_access_audit: INSERT only (expect ins=t, upd=f, del=f)
SELECT has_table_privilege('app_user','medical_access_audit','INSERT') AS ins,
       has_table_privilege('app_user','medical_access_audit','UPDATE') AS upd,
       has_table_privilege('app_user','medical_access_audit','DELETE') AS del;

-- 7. users.is_minor STORED generated column functional
INSERT INTO users (email, name, date_of_birth) VALUES ('smoke-minor@vttl.test', 'Minor Test', CURRENT_DATE - INTERVAL '14 years');
INSERT INTO users (email, name, date_of_birth) VALUES ('smoke-adult@vttl.test', 'Adult Test', CURRENT_DATE - INTERVAL '30 years');
SELECT email, is_minor FROM users WHERE email LIKE 'smoke-%';
DELETE FROM users WHERE email LIKE 'smoke-%';

-- 8. FK cascade rules
SELECT conname, contype, confdeltype FROM pg_constraint
 WHERE conrelid IN ('medical_events'::regclass,'medical_documents'::regclass,'parent_child_links'::regclass,'sessions'::regclass)
   AND contype='f';
```

### Expected results

| # | Check | Expected output |
|---|-------|-----------------|
| 1 | `table_count` | `19` |
| 2 | RLS enabled on 7 tables | 7 rows, every row `rowsecurity=t, forcerowsecurity=t` |
| 3 | 7 functions present | 7 rows: `current_user_id`, `current_user_role`, `medical_document_audit`, `medical_event_audit`, `players_visible_to`, `query_medical_access_audit`, `set_updated_at` |
| 4 | 2 roles | 2 rows: `app_audit_writer`, `app_user` |
| 5 | `audit_log` priv (app_user) | `ins=t, upd=f, del=f` |
| 6 | `medical_access_audit` priv (app_user) | `ins=t, upd=f, del=f` |
| 7 | `is_minor` 14yr / 30yr | `smoke-minor: t, smoke-adult: f` |
| 8 | FK cascade rules | `medical_events.player_user_id → r (RESTRICT)`, `medical_documents.medical_event_id → c (CASCADE)`, `medical_documents.player_user_id → r (RESTRICT)`, `sessions.user_id → c (CASCADE)`, `parent_child_links.{parent,child}_user_id → r (RESTRICT)` |

---

## Verification matrix

Status legend:
- `OK` — check ran on staging and matched the expected output.
- `DEFERRED` — check is documented and ready to run; awaiting the staging push.
- `FAIL` — check ran and the output differs from expected. Halts the deploy and triggers rollback per the corresponding `*.rollback.md`.

| Check | Expected | Actual | Status |
|-------|----------|--------|--------|
| 19 tables present in `public` | `19` | _(awaiting staging push)_ | DEFERRED |
| RLS enabled + forced on 7 tables | `7 × (t, t)` | _(awaiting staging push)_ | DEFERRED |
| 7 SECURITY DEFINER / STABLE functions | `7 rows` | _(awaiting staging push)_ | DEFERRED |
| 2 Postgres roles created | `app_user, app_audit_writer` | _(awaiting staging push)_ | DEFERRED |
| `audit_log` app_user privileges | `ins=t / upd=f / del=f` | _(awaiting staging push)_ | DEFERRED |
| `medical_access_audit` app_user privileges | `ins=t / upd=f / del=f` | _(awaiting staging push)_ | DEFERRED |
| `users.is_minor` 14yr=t / 30yr=f | `t / f` | _(awaiting staging push)_ | DEFERRED |
| `medical_events.player_user_id` ON DELETE RESTRICT | `r` | _(awaiting staging push)_ | DEFERRED |
| `medical_documents.medical_event_id` ON DELETE CASCADE | `c` | _(awaiting staging push)_ | DEFERRED |
| Migration files unchanged vs frozen checksums | All 4 SHA-256 match the table above | Frozen here; recomputed by CI before push | OK |
| Journal lists exactly 4 migrations | `0000, 0001, 0002, 0003` | Verified — see "Migration files — frozen state" | OK |
| Each migration has rollback companion | 4 / 4 | Verified | OK |
| `protect-migrations.yml` enforces MIG-01 + MIG-05 | Workflow present | Verified | OK |
| Drift check (schema TS → migrations) | Zero new migrations from `drizzle-kit generate` | Sandbox cannot run; staging gate runs the check | DEFERRED |

No `FAIL` rows. Deferred items are gated by the Coolify staging pre-deploy hook (MIG-04).

---

## Threat model — T-01-MIG-CREDENTIALS posture

| Aspect | Implementation in this plan |
|--------|------------------------------|
| `DIRECT_DATABASE_URL` is owner-credentialled — must NOT leak to runtime services | Coolify Secrets scopes the env var to the `migrate` one-shot container only. The `web` and `worker` runtimes use `DATABASE_URL` (port 6543) bound to `app_user` — a non-superuser with explicit grants set in `0000_initial.sql` and tightened in `0001_medical_isolated.sql`. |
| Role passwords (`APP_USER_PW`, `APP_AUDIT_WRITER_PW`) | Generated as 32-char random secrets, supplied to the migration container via `PGOPTIONS=-c app.<key>=…`, never written into the migration SQL. The `0000_initial.sql` `DO $$ … $$` block reads them via `current_setting('app.<key>', true)` and uses `EXECUTE format('CREATE ROLE … PASSWORD %L', …)` — preserves quoting and prevents SQL injection through the password. |
| Owner password rotation | Documented in `docs/migration-runbook.md`; rotation procedure is post-Phase-8 once `app_user` becomes the only connection class for runtime traffic. |
| Secret accidentally committed to git | `protect-migrations.yml` does not stop a developer from putting a literal password in a *new* migration; the project relies on (a) developer code-review, (b) the GUC pattern shown above being the only documented method, and (c) the agent worktree's pre-commit secret scanner (Plan 18 — installed earlier in Phase 1). |

---

## Manual operator steps (DEFERRED — to be completed before Phase 2)

1. Generate two 32-char random secrets:
   ```bash
   openssl rand -base64 32  # → APP_USER_PW
   openssl rand -base64 32  # → APP_AUDIT_WRITER_PW
   ```
2. Add both as Coolify Secrets, scoped to the staging `migrate` service.
3. Trigger the staging deploy. Coolify runs the pre-deploy `npx drizzle-kit migrate` command shown above.
4. Append the live stdout under "Applied migrations — staging push log" above.
5. Run the smoke-check SQL (`/tmp/01-16-smoke.sql`) against staging.
6. Update each `DEFERRED` row in the verification matrix to `OK` (or `FAIL` if anything diverges).
7. If anything failed, follow the rollback runbooks in reverse: `0003_users_is_minor.rollback.md` → `0002_*.rollback.md` → `0001_*.rollback.md` → `0000_*.rollback.md`. Then write a NEW migration that fixes the issue (MIG-01 — never edit a committed migration).

---

## Next steps (out-of-scope for this plan)

- Plan 17 — RBAC matrix integration test (35 cases) now has a real DB to exercise.
- Plan 17 — RLS direct-query test (`tests/rls/medical-isolation.test.ts`) flips from RED to GREEN against staging.
- `/api/health/ready` (Plan 11) returns 200 against the populated DB instead of failing on the table-existence probe.
- Phase 8 release-gate adds the production push as a separate step with a fresh `01-16-MIGRATION-LOG.md` entry per environment (per MIG-04 — staging is not production).

---

## References

- `drizzle/0000_initial.sql` — phase-1 core schema (users, sessions, accounts, lookups, consent, audit, idempotency, roles, triggers, indexes).
- `drizzle/0001_medical_isolated.sql` — medical-event/document/audit tables, write-time audit triggers, INSERT-only privileges.
- `drizzle/0002_rls_functions_and_policies.sql` — STABLE GUC wrappers, `players_visible_to`, `query_medical_access_audit`, RLS policies on every sensitive table.
- `drizzle/0003_users_is_minor.sql` — STORED generated column for GDPR-02 minor-consent enforcement.
- `docs/migration-runbook.md` — MIG-01..05 rules, expand-contract worked example, Drizzle Kit cheat-sheet.
- `.github/workflows/protect-migrations.yml` — CI guard for MIG-01 + MIG-05.
- `.planning/phases/01-fundament/01-RESEARCH.md` §Migration Governance — origin of the rules in the runbook.
