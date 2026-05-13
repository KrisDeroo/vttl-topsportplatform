# Migration Log — Phase 2 Push

**Date:** 2026-05-13T17:21:31Z (start) → 2026-05-13T~17:43Z (final smoke pass)
**Target:** **dev/staging Supabase Postgres** — project `uxgqsaphmmzholxkuuym` (region `eu-west-1` Dublin)
**Endpoint:** `aws-0-eu-west-1.pooler.supabase.com:5432` (session-mode pooler — DDL-capable)
**User:** `postgres.uxgqsaphmmzholxkuuym` (Supabase pooler-only architecture; legacy `db.<ref>.supabase.co` removed)
**Operator:** Claude (gsd-execute-phase, plan 02-14)
**Phase 1 carry-over note:** This is **the very first** drizzle push against this project. Phase 1's plan-01-16 log was authored without a real target (deferred), so all 9 journal entries (idx 0..8) get applied in a single sweep here — not just the 3 Phase 2 migrations the plan body anticipated.

---

## Pre-checks

| # | Check | Status | Notes |
|---|-------|--------|-------|
| 1 | `DIRECT_DATABASE_URL` points at port 5432 (session-mode) | OK | Confirmed from `.env.local` (gitignored). Pooler-only architecture: port 5432 on the pooler is the session-mode endpoint; the legacy direct hostname `db.<ref>.supabase.co` was removed by Supabase for this project. |
| 2 | Journal lists 0006, 0007, 0008 (idx 6/7/8) | OK | `drizzle/meta/_journal.json` head verified: 9 entries (0000..0008), `version=7`, `dialect=postgresql`, `breakpoints=true`. |
| 3 | Phase 1 baseline: 19 tables present (pre-state) | **ADAPTED** | Pre-state baseline was **0 tables** (fresh project). The plan's expectation of "19 pre-existing tables" assumed Phase 1 had already been pushed to this target. It hadn't. All 9 migrations (Phase 1's 6 + Phase 2's 3) were applied in one `migrate()` sweep — see "Applied migrations" below. |
| 4 | `app_user` Postgres role exists (pre-state) | **ADAPTED** | Role did not exist on fresh project. 0000_initial.sql Block B created it (and `app_audit_writer`) using session GUC passwords supplied by the migration runner — see "Role-password GUC handling" below. |
| 5 | `drizzle.config.ts` targets `DIRECT_DATABASE_URL` and migration ledger lives in `public.drizzle_migrations` | OK | Verified at `drizzle.config.ts:22` and `:25`. |
| 6 | Each `<n>_<name>.sql` has companion `<n>_<name>.rollback.md` | OK | Verified by `ls drizzle/*.rollback.md` — 9 rollback companions present. |
| 7 | `.gitignore` excludes `.env.local` | OK | Confirmed at `.gitignore:6`. The migration runner's secrets file (`/private/tmp/phase2-secrets.env`) is on a path that is never committed. |

---

## Migration files — frozen state (SHA-256, computed via node:crypto)

```
6deba7f474950769b9768f39f814647a87161f6d0f920ec8102a9591ab858df6  drizzle/0000_initial.sql
748e6d7a256c606e791080166bd0be4b5232e1d6ad3321771652b538ce78cc7d  drizzle/0001_medical_isolated.sql
303543011cdfe8d071bb84541e0f800b3539f296bc5e23ae22c566b08c4fa392  drizzle/0002_rls_functions_and_policies.sql
c684c2db523b9c62d93c655389e2c4da88c2a563414809616d2214f6879ca216  drizzle/0003_users_is_minor.sql
e98b37a3089a2311c80b21a8e0562c1bc817bb2966037be1cd9bc413873b72e9  drizzle/0004_verifications_policy_tighten.sql
22f4670221672571e971d388362915c630bfba44c05882194df565eb6e1bfabf  drizzle/0005_consenting_party_not_null.sql
335e6239ddb8f9a33afe640249e4466e5b213e58fec1638c73357fec1adcac8c  drizzle/0006_phase2_profiles_and_files.sql
ae18f8a1038f7599fc28530abe4b928a39a09bbd29b894b0660a8eb35fbc67c7  drizzle/0007_phase2_rls_policies.sql
0a47629a45a150caba92f316d593a8c3a4602dccc5a6feb68252bf11ef84dd6d  drizzle/0008_phase2_lookup_seed.sql
```

These nine `hash` values are exactly the rows now stored in `public.drizzle_migrations` (verified post-push — see "Applied migrations").

**Drift from Phase 1 log:** the `0000_initial.sql` checksum recorded in `01-16-MIGRATION-LOG.md` was `4976779b89…`. The new checksum here is `6deba7f47…`. This reflects a single one-line bug-fix applied during this push — see "Deviations" §1 below. The migration had never been applied to any environment before this run, so the MIG-01 "never edit applied migrations" rule is not violated.

---

## Role-password GUC handling

Plan 01-16's design supplies the role passwords via libpq `PGOPTIONS="-c app.app_user_pw=… -c app.app_audit_writer_pw=…"`. Drizzle Kit's CLI (`drizzle-kit migrate`) instantiates its own connection from the URL and does NOT plumb a way to inject those GUCs at session start.

The runner used here (`scripts/_run-phase2-migrate.mjs`, NOT committed — gitignored under `scripts/_*.mjs`) instead:

1. Opens a `pg.Client` against `DIRECT_DATABASE_URL`.
2. Runs `SET app.app_user_pw TO '…'` and `SET app.app_audit_writer_pw TO '…'` on that session.
3. Sanity-probes via `SELECT current_setting('app.app_user_pw', true) IS NOT NULL` (returned `t/t` before migrate() ran).
4. Invokes `migrate(db, { migrationsFolder: 'drizzle', migrationsTable: 'drizzle_migrations', migrationsSchema: 'public' })` from `drizzle-orm/node-postgres/migrator`.

Both random 32-char (24-byte base64) passwords were generated **once for this session** via `node -e "require('crypto').randomBytes(24).toString('base64')"` and live only in `/private/tmp/phase2-secrets.env` (a non-committed tmpfile path). They are deleted after this push completes. For Coolify production deployment the operator MUST regenerate fresh secrets and feed them as Coolify Secrets scoped to the migration runner service only (per WARNING-15 / T-02-14-CREDENTIALS).

---

## Applied migrations — actual output

`drizzle-orm/node-postgres/migrator` produces less verbose output than the `drizzle-kit migrate` CLI (it returns silently on success); the runner records what's in `drizzle_migrations` after the call. Output captured to `/private/tmp/migrate-output.txt`:

```
Target: aws-0-eu-west-1.pooler.supabase.com:5432 db=postgres user=postgres.uxgqsaphmmzholxkuuym
Connecting…
Connected.
Setting session GUCs app.app_user_pw and app.app_audit_writer_pw…
GUCs set and round-tripped OK.
OK: migrate() completed in 11103 ms.   ← first apply on the fresh DB
Applied migrations recorded in drizzle_migrations: 9
  hash=6deba7f47495… created_at=2025-05-02T00:00:00.000Z   (0000_initial)
  hash=748e6d7a256c… created_at=2025-05-02T09:26:40.000Z   (0001_medical_isolated)
  hash=303543011cdf… created_at=2026-05-02T09:43:50.142Z   (0002_rls_functions_and_policies)
  hash=c684c2db523b… created_at=2026-05-02T21:14:07.000Z   (0003_users_is_minor)
  hash=e98b37a3089a… created_at=2026-05-03T21:20:00.000Z   (0004_verifications_policy_tighten)
  hash=22f467022167… created_at=2026-05-03T21:21:40.000Z   (0005_consenting_party_not_null)
  hash=335e6239ddb8… created_at=2026-05-13T11:11:59.010Z   (0006_phase2_profiles_and_files)
  hash=ae18f8a1038f… created_at=2026-05-13T11:28:49.617Z   (0007_phase2_rls_policies)
  hash=0a47629a45a1… created_at=2026-05-13T11:28:49.800Z   (0008_phase2_lookup_seed)
Done.

[Second invocation, idempotent re-run]
OK: migrate() completed in 235 ms.       ← drizzle saw "no pending"
```

The `created_at` values come from `_journal.json` `when` field (Drizzle's ledger format), not the wall-clock apply-time. Phase 1's 0000 carries a 2025-05-02 timestamp by historical accident; out of scope to retro-fix.

---

## Post-migration smoke checks — actual results

All 13 plan-mandated checks (+ 1 bonus role check) — captured to `/private/tmp/smoke-output.txt`:

```
-- Check 1: Phase 2 domain tables (expect 4)
   {"phase2_tables":4}

-- Check 2: Phase 2 lookup tables (expect 2)
   {"phase2_lookups":2}

-- Check 3a: All public.* tables incl. drizzle_migrations (expect 26)
   {"total_tables":26}

-- Check 3b: App-schema tables only (expect 25)
   {"app_tables":25}
   detail: academy, academy_memberships, accounts, age_categories,
           age_category_history, audit_log, consent_records, drizzle_migrations,
           idempotency_keys, medical_access_audit, medical_documents,
           medical_events, organisation, outcome_level, parent_child_links,
           players, ranking_type, sessions, status, tournament_type,
           trainer_diploma, trainers, training_type, uploaded_files, users,
           verifications

-- Check 4: RLS enabled+forced on 4 Phase 2 tables (expect 4 rows × t/t)
   {"tablename":"age_category_history","rowsecurity":true,"forcerowsecurity":true}
   {"tablename":"players","rowsecurity":true,"forcerowsecurity":true}
   {"tablename":"trainers","rowsecurity":true,"forcerowsecurity":true}
   {"tablename":"uploaded_files","rowsecurity":true,"forcerowsecurity":true}

-- Check 5: Named policies (expect 19)
   {"policy_count":19}
   detail: age_category_history_delete, age_category_history_insert,
           age_category_history_select, age_category_history_update,
           players_delete, players_insert, players_select, players_update,
           profiles_owner_read, profiles_owner_write, profiles_td_all,
           trainers_delete, trainers_insert, trainers_select, trainers_update,
           uploaded_files_delete, uploaded_files_insert, uploaded_files_select,
           uploaded_files_update

-- Check 6: profiles bucket (expect 1 row, public=false)
   {"id":"profiles","public":false}

-- Check 7: players_minor_emergency_contact CHECK (expect 1 row)
   {"conname":"players_minor_emergency_contact"}

-- Check 8: uploaded_files_scan_status_enum CHECK (expect 1 row)
   {"conname":"uploaded_files_scan_status_enum"}

-- Check 9: uniq_age_history_player_effective_from (expect 1 row)
   {"conname":"uniq_age_history_player_effective_from"}

-- Check 10: Lookup seed counts
   {"tbl":"academy","n":6}
   {"tbl":"age_categories","n":7}
   {"tbl":"trainer_diploma","n":5}

-- Check 11: players_visible_to function (expect 1 row)
   {"proname":"players_visible_to"}

-- Check 12: TD-role RLS smoke SELECT on players (expect succeed, 0 rows)
   {"visible_to_td":0}                  -- query ran inside a BEGIN with
                                        --   SET LOCAL app.user_id='00000000-…'
                                        --   SET LOCAL app.user_role='technical_director'
                                        -- returned 0 rows AND no error → RLS
                                        -- accepted the TD role's SELECT

-- Check 13a: mark_scan_result function (expect 1 row, prosecdef=true)
   {"proname":"mark_scan_result","owner":"postgres","prosecdef":true}

-- Check 13b: app_user EXECUTE on mark_scan_result (expect t)
   {"app_user_can_execute":true}

-- Bonus: Phase 1 roles (expect 2: app_audit_writer, app_user)
   {"rolname":"app_audit_writer"}
   {"rolname":"app_user"}
```

Note for Check 4: `pg_tables` no longer exposes `forcerowsecurity` in current Supabase Postgres builds (it moved to `pg_class.relforcerowsecurity` between Postgres 14 and 17). The check now queries `pg_class` directly — same semantics, more durable across version bumps.

---

## Verification matrix

| # | Check | Expected | Actual | Status |
|---|-------|----------|--------|--------|
| 1 | Phase 2 domain tables | 4 | 4 | PASS |
| 2 | Phase 2 lookup tables | 2 | 2 | PASS |
| 3 | Total tables | 25 app-schema | 25 app-schema (+1 ledger = 26 total) | PASS |
| 4 | RLS enabled+forced on 4 new tables | 4×t/t | 4×t/t (age_category_history, players, trainers, uploaded_files) | PASS |
| 5 | Named policies | 19 (16 table + 3 storage) | 19 | PASS |
| 6 | profiles bucket (public=false) | 1×public=false | 1×public=false | PASS |
| 7 | players CHECK `players_minor_emergency_contact` | 1 | 1 | PASS |
| 8 | uploaded_files scan_status CHECK | 1 | 1 | PASS |
| 9 | age_history UNIQUE | 1 | 1 | PASS |
| 10 | Lookup seeds | academy=6 / age=7 / diploma=5 | 6 / 7 / 5 | PASS |
| 11 | players_visible_to fn | 1 | 1 | PASS |
| 12 | TD RLS SELECT on players | 0 (success) | 0 (success, no error) | PASS |
| 13 | mark_scan_result fn + EXECUTE granted to app_user | 1 row, prosecdef=t, can-execute=t | 1, t, t | PASS |
| B | Phase 1 roles created (`app_user`, `app_audit_writer`) | 2 rows | 2 rows | PASS |

**13/13 plan checks + 1 bonus = 14/14 PASS. No FAIL rows.**

---

## Deviations

### 1. `[Rule 1 - Bug]` Fixed invalid sequence privilege `INSERT, DELETE` in `0000_initial.sql`

**Found during:** First attempt at `migrate()` — failure on Phase 1's `0000_initial.sql` Block B grant statement.

**Issue:**
```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL SEQUENCES IN SCHEMA public TO app_user;
```
Postgres rejects `INSERT` and `DELETE` on sequence objects — sequences only accept `USAGE`, `SELECT`, `UPDATE`. Server returned `0LP01 invalid privilege type INSERT for sequence` and the migration transaction rolled back, leaving the DB in its pre-state (empty).

**Why this slipped past Phase 1:** `01-16-MIGRATION-LOG.md` documents the staging push as **DEFERRED** — Phase 1 never ran `migrate()` against a real DB. The first real apply is this plan (02-14). MIG-01 protects against editing migrations that have been applied somewhere; this migration had never been applied anywhere, so the rule is not violated.

**Fix:** Changed the offending line to:
```sql
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO app_user;
```
(matches the documented intent — app_user reads & advances every public-schema sequence — and is consistent with the `ALTER DEFAULT PRIVILEGES … ON SEQUENCES` line three statements below which already uses only `USAGE`).

**Files modified:**
- `drizzle/0000_initial.sql` line 180 (rewritten as a 6-line block with explanatory comment, now lines 180–185)

**Impact:**
- `0000_initial.sql` SHA-256 changed from `4976779b89…` (Phase 1 frozen baseline) to `6deba7f47…` (new). The drizzle_migrations ledger row uses the new hash.
- No further migrations affected.
- Phase 1's `01-16-MIGRATION-LOG.md` will technically have a stale checksum row — it remains accurate as a description of the Phase 1 sandbox snapshot but no longer matches the file on disk. A future contractor reading both logs in sequence will see the discrepancy and reach this entry as the explanation.

**Commit:** see worktree commit hash recorded in plan SUMMARY.

### 2. `[Rule 3 - Blocking]` Replaced `drizzle-kit migrate` CLI with programmatic `drizzle-orm/node-postgres/migrator.migrate()`

**Found during:** Pre-flight inspection of how 0000_initial.sql Block B reads role passwords.

**Issue:** `drizzle-kit migrate` constructs its own connection from `dbCredentials.url` and provides no documented hook to set session GUCs before applying migrations. Phase 1's plan-16 documented passing them via `PGOPTIONS=-c app.<key>=…` but in practice the CLI's URL-only constructor never forwards `PGOPTIONS` into the libpq `options` startup parameter.

**Fix:** Wrote a single-purpose runner (`scripts/_run-phase2-migrate.mjs`, gitignored) that:
- Opens a `pg.Client` with the connection string from `.env.local`.
- Runs `SET app.app_user_pw TO '…'` and `SET app.app_audit_writer_pw TO '…'` on that session (sanity-probed via `current_setting()` before migrate).
- Invokes `migrate(db, { migrationsFolder, migrationsTable: 'drizzle_migrations', migrationsSchema: 'public' })` from `drizzle-orm/node-postgres/migrator` — same ledger semantics as the CLI, just with our session.

**Files modified (gitignored, NOT committed):**
- `scripts/_run-phase2-migrate.mjs` (one-shot operator tool — created here, will be deleted at end of run)
- `scripts/_run-phase2-smoke.mjs` (smoke-check runner)
- `scripts/_phase2-checksums.mjs` (SHA-256 generator)
- `/private/tmp/phase2-secrets.env` (random one-shot passwords — deleted)

**Files modified (committed):**
- `.gitignore` — added `scripts/_*.mjs` and `scripts/_*.ts` patterns (line below `tsconfig.tsbuildinfo`).

**Impact:** Migrations applied successfully on the first attempt with the bug-fix in §1 above. The runner sets session-level GUCs (NOT `SET LOCAL`) so they survive across the per-migration transactions Drizzle opens. For Coolify production runs, this same script (or the canonical `drizzle-kit migrate` once the upstream gains a session-init hook) needs the same SET pattern — the production runbook should reference this log.

### 3. `[Adaptation]` Pre-check #3 (19-table baseline) interpreted as "fresh DB, will catch up"

**Found during:** Pre-flight on the dev/staging target.

**Issue:** Plan-02-14 pre-check #3 assumed Phase 1 had been pushed to this target (would-be baseline: 19 tables). The target had 0 public tables (Phase 1 was a documented DEFERRED).

**Action:** Re-interpreted the pre-check as "fresh DB — `migrate()` will walk the whole journal (idx 0..8) in one sweep, ending at 25 app-schema tables + 1 ledger = 26 public.* tables." Total time on first apply: 11.1 s. The expected end-state count was unchanged.

**No file changes** — purely a pre-check interpretation.

### 4. `[Adaptation]` Check 4 query rewritten — `pg_tables.forcerowsecurity` not available

**Found during:** First smoke-check run, error on Check 4.

**Issue:** `pg_tables` view in the Supabase Postgres build at the target does not expose `forcerowsecurity`. (The column has bounced in and out of the view across Postgres versions 14→17.)

**Fix:** Rewrote Check 4 to read `pg_class.relrowsecurity` and `pg_class.relforcerowsecurity` directly, joining `pg_namespace` for the public-schema filter. Same semantics; more durable.

**Files modified (gitignored):** `scripts/_run-phase2-smoke.mjs`.

**Impact:** Check 4 passes — RLS is ENABLE-d and FORCE-d on all 4 Phase 2 domain tables. The plan's documented expectation row remains correct.

### 5. `[Plan-text clarification]` Check 3 expected count

**Plan text:** "Total tables — expect 25" (= 19 Phase 1 + 6 Phase 2).

**Actual:** 26 rows in `pg_tables WHERE schemaname='public'` because the Drizzle migration-ledger table (`public.drizzle_migrations`, see `drizzle.config.ts:25`) is intentionally placed in the public schema.

**Resolution:** Recorded both numbers in the verification matrix:
- `Check 3a`: 26 (all public.* rows).
- `Check 3b`: 25 (excluding `drizzle_migrations`) — matches plan expectation.

**No file changes** — pure documentation alignment.

---

## Credential revocation (WARNING-15)

This plan's scope is **dev/staging only**. The `DIRECT_DATABASE_URL` carrying the Supabase owner credential lives in `.env.local` (developer machine — gitignored, never committed). There is no Coolify deployment of this app yet, so there is no runtime container env var to revoke.

**For the eventual production push** (a separate plan, gated by the Phase 8 release gate), the runbook is unchanged from the original plan body:

```
1. coolify env unset DIRECT_DATABASE_URL --app vttl-web
2. coolify env unset DIRECT_DATABASE_URL --app vttl-worker
3. Confirm via   coolify env list --app vttl-web | grep -i direct   returns nothing
4. Restart both apps to pick up the smaller env set
```

`DATABASE_URL` (transaction pooler, port 6543, bound to `app_user` — RLS-enabled) stays — that's the runtime path.

---

## Threat model — closing posture

| Threat | Disposition this run |
|--------|---------------------|
| T-02-14-CREDENTIALS (DIRECT_DATABASE_URL leaks) | Never echoed in this log. Passwords for `app_user` / `app_audit_writer` were random, session-scoped via `/private/tmp/phase2-secrets.env`, and never appeared in any committed artifact. The tmpfile is deleted as part of plan close-out. |
| T-02-14-PARTIAL-APPLY | The §1 bug-fix proved this works: the failing GRANT rolled back inside its own transaction (Drizzle default), leaving the DB in its pre-state. After the fix, all 9 migrations applied transactionally and the ledger reflects 9 rows. |
| T-02-14-WRONG-TARGET | Runner prints `Target: aws-0-eu-west-1.pooler.supabase.com:5432 db=postgres user=postgres.uxgqsaphmmzholxkuuym` before connecting and rejects port 6543 (transaction pooler) outright. Operator-confirmed match against `.env.local`. |

---

## Next steps (out-of-scope for this plan)

- Plan **02-15** integration tests now have live tables to query — RBAC matrix + RLS smoke can flip from RED to GREEN.
- Plan **02-16** deployment docs reference this log as the canonical staging-push record.
- Production push remains gated by the Phase 8 release-gate; that plan will spawn a fresh MIGRATION-LOG.md against the production project (per MIG-04 — staging is not production).
- The Phase 1 `01-16-MIGRATION-LOG.md` checksum for `0000_initial.sql` is now stale (it described the pre-bug-fix file). A doc-only sweep — outside this plan's scope — could append a "see 02-14-MIGRATION-LOG.md §Deviations §1" backref so future readers find this explanation quickly.

---

## References

- `drizzle/0000_initial.sql` — Phase 1 core schema (this run: bug-fixed sequence grant on line 180).
- `drizzle/0001_medical_isolated.sql` — Medical-event/document/audit tables (Phase 1).
- `drizzle/0002_rls_functions_and_policies.sql` — STABLE GUC wrappers and RLS policies (Phase 1).
- `drizzle/0003_users_is_minor.sql` — GDPR-02 minor-consent STORED column (Phase 1).
- `drizzle/0004_verifications_policy_tighten.sql` — Verifications RLS tightening (Phase 1).
- `drizzle/0005_consenting_party_not_null.sql` — consent_records NOT NULL hardening (Phase 1).
- `drizzle/0006_phase2_profiles_and_files.sql` — Phase 2 new tables, indexes, CHECK constraints.
- `drizzle/0007_phase2_rls_policies.sql` — Phase 2 RLS, storage.objects policies, `mark_scan_result()`.
- `drizzle/0008_phase2_lookup_seed.sql` — Phase 2 lookup seed data (academy +4, age_categories ×7, trainer_diploma ×5).
- `.planning/phases/01-fundament/01-16-MIGRATION-LOG.md` — Phase 1 (DEFERRED) log; structural template for this file.
- `docs/migration-runbook.md` — MIG-01..05 hard rules.
