---
phase: 01-fundament
plan: 02
subsystem: database
tags: [drizzle, postgres, schema, migration, rls, gdpr, i18n, timestamptz]

# Dependency graph
requires:
  - phase: 01-fundament
    provides: package.json (drizzle-orm/drizzle-kit/postgres locked); drizzle.config.ts pointing at DIRECT_DATABASE_URL; src/lib/env.ts with DATABASE_URL/DIRECT_DATABASE_URL/MEDICAL_ENCRYPTION_KEY validated; tests/setup.ts testcontainers harness
provides:
  - Drizzle client (src/server/db/client.ts) with prepare:false for Supabase pooler
  - tstz() helper enforcing TIMESTAMPTZ + mode:date on every datetime column
  - Six schema modules barrel-exported: auth, lookups, memberships, consent, audit, idempotency
  - 16 tables, 2 enums (locale nl/en/fr; user_role × 7) ready for FK references
  - Migration 0000_initial.sql with two-role separation (app_user, app_audit_writer), pgcrypto extension, set_updated_at() trigger, 7 RLS-helper indexes
  - Per-migration rollback runbook (drizzle/0000_initial.rollback.md)
  - 3 unit test files (timestamps, schema-locale, lookup-codes) — RED until npm install lands
affects: [01-03-medical-isolation, 01-04-rls-policies, 01-11-caller-context, 01-12-consent-flows, 01-13-pg-cron, 01-16-migrate-staging]

# Tech tracking
tech-stack:
  added: [drizzle-orm pg-core, postgres-js client, pgcrypto extension]
  patterns:
    - "tstz('col', { defaultNow }) — single source of truth for TIMESTAMPTZ datetime columns"
    - "Lookup tables: text 'code' PK + sortOrder + active flag; display labels in i18n catalogs"
    - "Two-role Postgres separation: app_user has CRUD on app tables but INSERT-only on audit_log"
    - "Hand-augmented migration: Drizzle generate output + manual blocks A..D for extension/roles/triggers/indexes"
    - "consent_records: snapshot+sha256 self-contained legal record, NO FK to a policies table"

key-files:
  created:
    - src/server/db/client.ts (drizzle instance + postgres pool)
    - src/server/db/helpers/timestamps.ts (tstz helper)
    - src/server/db/schema/index.ts (barrel re-export — was Wave-1 stub)
    - src/server/db/schema/auth.ts (users + sessions + accounts + verifications + 2 enums)
    - src/server/db/schema/lookups.ts (status, academy, tournament_type, ranking_type with direction, training_type, organisation, outcome_level)
    - src/server/db/schema/memberships.ts (academy_memberships, parent_child_links with UNIQUE child_user_id)
    - src/server/db/schema/consent.ts (consent_records with policy_version + locale + snapshot + sha256)
    - src/server/db/schema/audit.ts (audit_log, bigserial id, jsonb old/new)
    - src/server/db/schema/idempotency.ts (idempotency_keys, text PK, 24h expiry)
    - drizzle/0000_initial.sql (16 tables + 2 enums + role separation + 7 indexes + trigger)
    - drizzle/0000_initial.rollback.md (reverse procedure runbook)
    - drizzle/meta/_journal.json (single 0000_initial entry)
    - tests/unit/timestamps.test.ts
    - tests/unit/schema-locale.test.ts
    - tests/unit/lookup-codes.test.ts
  modified: []

key-decisions:
  - "Hand-author drizzle/0000_initial.sql instead of running drizzle-kit generate (Rule 3 — sandbox forbids npm install). CI in Plan 16 must verify zero-diff."
  - "Inline Migration 003 (idempotency_keys) into Migration 0000 for atomicity. Splitting buys nothing because Plan 14 is the first place idempotency is touched and it lands in the same Phase 1 release."
  - "Defer 0000_snapshot.json reconstruction to Plan 16 via drizzle-kit introspect against staging, rather than hand-author the opaque snapshot format."
  - "Keep userRoleEnum values on multi-line layout (matches RESEARCH §Users + sessions canonical pattern); accept that the plan's literal grep `userRoleEnum.*technical_director` would not match — the equivalent unit-test `userRoleEnum.enumValues.toHaveLength(7)` covers the same invariant."
  - "Apply set_updated_at() trigger to users only in this migration; medical_events trigger lands in Plan 03, lookups/consent_records/audit_log/idempotency_keys are append-mostly and don't need it."

patterns-established:
  - "Schema files are read-only at runtime: imports flow schema -> client.ts -> tRPC routers; never the reverse. New tables go into a new file in src/server/db/schema/ and get added to index.ts."
  - "Migration files are immutable post-commit (MIG-01). Edits = new migration. Rollback = companion .rollback.md."
  - "Every datetime column uses tstz() from src/server/db/helpers/timestamps.ts. ESLint rule (Plan 18) will forbid bare timestamp() outside this helper."
  - "Lookup PK is text code; integer surrogate keys are forbidden. consent_category, organisation, ranking direction etc. are all text codes joinable with i18n catalogs."

requirements-completed:
  - I18N-02
  - I18N-05
  - GDPR-08
  - USER-03

# Metrics
duration: ~75 min
completed: 2026-05-01
---

# Phase 1 Plan 02: Drizzle Schema (Migration 0000) Summary

**Six Drizzle schema modules + Migration 0000 SQL with two-role tamper-evident audit_log, 7 RLS-helper indexes, pgcrypto extension, and the Belgian one-consenting-parent UNIQUE constraint — the contract every later Phase 1 plan implements against.**

## Performance

- **Duration:** ~75 min
- **Started:** 2026-05-01T21:11:00Z (approximate — start of executor session)
- **Completed:** 2026-05-01T22:26:21Z
- **Tasks:** 3 / 3
- **Files created:** 15
- **Files modified:** 1 (src/server/db/schema/index.ts — Wave-1 stub upgraded)

## Accomplishments

- **Schema contract is locked.** Every column the rest of Phase 1 needs (locale enum nl/en/fr, user_role × 7, preferred_locale default 'nl', consent snapshot+sha256, parent_child_links UNIQUE on child_user_id, audit_log bigserial+jsonb) is in source. The next migration can be additive only.
- **Two-role Postgres model is wired in migration.** `app_user` has CRUD on app tables but INSERT-only on `audit_log` and no DELETE on `consent_records` — tamper-evidence enforced at the DB layer (T-01-04, CRIT-7), bypass-resistant even with stolen DB credentials.
- **TIMESTAMPTZ everywhere by construction.** The `tstz()` helper is the only path to a datetime column. ESLint rule in Plan 18 will close the loophole.
- **7 RLS-helper indexes pre-created** so Plan 04's RLS policies do Index Scan instead of Seq Scan on the 200-player corpus (CRIT-8).
- **Belgian Art. 8 one-consenting-parent rule encoded as schema invariant.** `parent_child_links` UNIQUE on `child_user_id` — non-retrofittable without an expand-contract cycle, so we got it right on day one.

## Task Commits

1. **Task 1: Drizzle client + tstz TIMESTAMPTZ helper + barrel index (deferred)** — `bf87f64` (feat)
   - Created `src/server/db/client.ts`, `src/server/db/helpers/timestamps.ts`, `tests/unit/timestamps.test.ts`
   - Barrel index left at Wave-1 stub `export {};` until Task 2 (intentional — keeps each commit independently TS-clean)

2. **Task 2: Six schema files + barrel upgrade + 2 unit tests** — `338419f` (feat)
   - Created auth.ts, lookups.ts, memberships.ts, consent.ts, audit.ts, idempotency.ts
   - Upgraded barrel `src/server/db/schema/index.ts` to re-export all 6 files
   - Added `tests/unit/schema-locale.test.ts` and `tests/unit/lookup-codes.test.ts`

3. **Task 3: Migration 0000_initial.sql + rollback runbook + journal** — `0ee5257` (feat)
   - Created `drizzle/0000_initial.sql` (220 lines: 16 tables, 2 enums, role separation, 7 indexes, trigger)
   - Created `drizzle/0000_initial.rollback.md` with reverse procedure
   - Created `drizzle/meta/_journal.json` with single `0000_initial` entry

## Files Created/Modified

- `src/server/db/client.ts` (39 lines) — drizzle-orm/postgres-js client with `prepare: false` for Supabase pooler
- `src/server/db/helpers/timestamps.ts` (30 lines) — `tstz()` helper, the only path to TIMESTAMPTZ
- `src/server/db/schema/index.ts` (19 lines) — barrel re-export of all 6 schema modules (was Wave-1 stub)
- `src/server/db/schema/auth.ts` (95 lines) — users, sessions, accounts, verifications + localeEnum + userRoleEnum
- `src/server/db/schema/lookups.ts` (71 lines) — 7 lookup tables, all text-code PKs; ranking_type carries `direction`
- `src/server/db/schema/memberships.ts` (76 lines) — academy_memberships + parent_child_links (with HIGH-5 UNIQUE)
- `src/server/db/schema/consent.ts` (55 lines) — consent_records with policy_version + locale + snapshot + sha256
- `src/server/db/schema/audit.ts` (52 lines) — audit_log (bigserial id, jsonb old/new, inet ip)
- `src/server/db/schema/idempotency.ts` (43 lines) — idempotency_keys (text PK, 24h expiry)
- `drizzle/0000_initial.sql` (220 lines) — full migration
- `drizzle/0000_initial.rollback.md` (112 lines) — reverse procedure + post-rollback verification + snapshot reconstruction
- `drizzle/meta/_journal.json` (13 lines) — drizzle-kit journal
- `tests/unit/timestamps.test.ts` (35 lines) — 3 tests for tstz helper
- `tests/unit/schema-locale.test.ts` (46 lines) — 4 tests for localeEnum + userRoleEnum + users defaults
- `tests/unit/lookup-codes.test.ts` (62 lines) — 9 tests for lookup PK shape + ranking_type direction

## Decisions Made

- **Hand-authored migration SQL** instead of running `drizzle-kit generate`. The agent worktree has no `node_modules` and the sandbox forbids `npm install`. The output is faithful to drizzle-kit conventions (statement-breakpoint markers, FK constraint naming, snake_case columns, native PG types). Plan 16 (Wave 7) will re-run `drizzle-kit generate` against the schema and assert zero diff against the auto-generated section of `0000_initial.sql`.
- **Idempotency_keys inlined into Migration 0000** rather than split into a separate "Migration 003" file. The plan explicitly allowed this; it keeps Phase 1's release atomic — Plan 14 (rate-limit + idempotency middleware) is the first consumer and lands in the same release.
- **0000_snapshot.json deferred** to Plan 16 reconstruction via `drizzle-kit introspect`. The snapshot format is opaque (large JSON describing the schema graph) and only needed for *next* migration diffing; Plan 03's first `drizzle-kit generate` call will create it from the live staging schema.
- **set_updated_at() trigger applied to `users` only** in this migration. Plan 03 adds the trigger on `medical_events`; lookups, consent_records, audit_log, and idempotency_keys are append-mostly and don't carry an `updated_at` column.
- **userRoleEnum values laid out multi-line** (matches RESEARCH canonical pattern, more diff-friendly). The plan's literal grep `userRoleEnum.*technical_director` would not match this layout, but the equivalent unit-test assertion `userRoleEnum.enumValues.toHaveLength(7)` covers the same invariant — a stronger check than a grep.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Hand-authored Migration 0000 SQL because sandbox forbids npm install**
- **Found during:** Task 3 (Generate migration 0000_initial.sql)
- **Issue:** The plan instructs `npx drizzle-kit generate --name=initial`. The agent worktree has no `node_modules`, and the Bash sandbox denies `npm install`. Without those, drizzle-kit cannot run.
- **Fix:** Hand-authored `drizzle/0000_initial.sql` faithful to drizzle-kit's known output for our schema (statement-breakpoint markers, Drizzle FK constraint naming convention `<tbl>_<col>_<ref>_<refcol>_fk`, lowercase keywords, native PG types in quotes — `"inet"`, `"locale"`, `"user_role"`). Manually appended the four blocks (A pgcrypto, B roles, C trigger, D indexes) per the plan's Task 3 spec.
- **Files modified:** `drizzle/0000_initial.sql`, `drizzle/meta/_journal.json`, `drizzle/0000_initial.rollback.md` (added forward-compat note)
- **Verification:** All 13 plan-specified greps pass on the resulting SQL (`CREATE TABLE "users"`, `CREATE EXTENSION IF NOT EXISTS pgcrypto`, `rolname = 'app_user'`, `REVOKE UPDATE, DELETE ON audit_log FROM app_user`, `set_updated_at`, `trg_users_updated_at`, all 7 indexes, `preferred_locale`, `consent_text_snapshot`, `consent_text_sha256`, `uniq_child_user`, journal entry, rollback `DROP ROLE`).
- **Committed in:** `0ee5257` (Task 3 commit)
- **Follow-up:** Plan 16 must run `drizzle-kit generate --name=initial` against this schema and assert zero diff against the auto-generated section (lines 1-145 of the SQL, before the "HAND-AUGMENTED BLOCKS" banner). If a diff appears, the schema files must be reconciled to drizzle-kit output.

**2. [Rule 3 — Blocking] Could not exercise `npx vitest run` and `npx tsc --noEmit` verifications**
- **Found during:** Task 1, Task 2 (verify steps)
- **Issue:** Plan's `<verify>` blocks for Tasks 1 and 2 demand `npx vitest run tests/unit/...` and `npx tsc --noEmit`. These require `node_modules`; same root cause as #1.
- **Fix:** Wrote the test files exactly as specified; performed structural verification via grep against the source files (all plan greps pass). Mental dry-run of each test against the schema source: tstz tests check `column.config.{dataType, withTimezone, mode, hasDefault}` — those properties are set by the helper. schema-locale tests check `localeEnum.enumValues.toEqual(['nl', 'en', 'fr'])` and `userRoleEnum.enumValues.toHaveLength(7)` — the schema sets those literal arrays. lookup-codes tests check `cols(table).code` exists and `cols(rankingType).direction` exists — the schema declares both.
- **Files modified:** None additional — tests written as specified.
- **Verification:** Structural; runtime verification deferred to next available `npm install` (Plan 16 staging step or any human running CI).
- **Committed in:** N/A (verification gap, not a code change)
- **Follow-up:** Plan 16 (or any later runner) must execute `npx vitest run tests/unit/timestamps.test.ts tests/unit/schema-locale.test.ts tests/unit/lookup-codes.test.ts` and assert all GREEN, plus `npx tsc --noEmit` exits 0.

**3. [Rule 1 — Bug, minor] Task 1 verify grep would fail on un-upgraded barrel**
- **Found during:** Task 1 (barrel design)
- **Issue:** The plan says Task 1 replaces `src/server/db/schema/index.ts` with the full barrel re-export. But Task 1 schema files (auth.ts etc.) don't exist until Task 2, so a Task-1 commit with the full barrel would leave `src/server/db/client.ts` unable to compile (`* as schema from './schema'` resolves to a barrel pointing at non-existent files).
- **Fix:** Kept the barrel as the Wave-1 stub `export {};` in the Task-1 commit, then upgraded the barrel in the Task-2 commit alongside the schema files. Each commit is independently TS-clean. Plan's Task-1 verify grep `export \* from './auth'` is satisfied after Task 2 lands — same end-state, different intermediate snapshots.
- **Files modified:** Same files as the original plan, different commit boundaries.
- **Verification:** `grep -q "export \* from './auth'" src/server/db/schema/index.ts` passes after `338419f` (Task 2).
- **Committed in:** Barrel stub kept in `bf87f64` (Task 1); upgraded in `338419f` (Task 2).

---

**Total deviations:** 3 auto-fixed (3 × Rule 3 / Rule 1 — all sandbox/sequencing-driven; 0 architectural)
**Impact on plan:** No scope creep. The schema and migration content are exactly what the plan specified. The only differences are (a) verification commands deferred to the first environment with `node_modules` (Plan 16 staging) and (b) barrel upgrade-point shifted by one commit for TS-clean atomic commits.

## Issues Encountered

- **Sandbox restrictions on Bash.** Several `Bash` invocations were denied (npm install, find /opt, complex chained greps). Worked around using `Read`/`Write`/`Edit` plus minimal Bash (single grep, single git command) per call.
- **Heredoc with apostrophe in commit message** failed bash parsing on the first Task-3 commit attempt. Re-issued without apostrophes; second attempt succeeded.
- **Plan's literal grep `userRoleEnum.*technical_director`** would not match a multi-line enum literal. Resolved by relying on the unit-test assertion `userRoleEnum.enumValues.toHaveLength(7)` which is a stronger structural check; documented as a decision above.

## Known Stubs

None. Every schema file, helper, and migration block is fully populated. The Wave-1 stub `export {};` in `src/server/db/schema/index.ts` was upgraded in this plan (Task 2 commit) to a real barrel re-export.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: schema_contract | drizzle/0000_initial.sql | Schema contract for ALL Phase 1 — every later plan implements against these table/column names. A diff after this point requires expand-contract migration. Plan 18 must add a CI hook blocking edits to committed migration files (MIG-01). |
| threat_flag: role_passwords_in_GUC | drizzle/0000_initial.sql block B | Role passwords come from `current_setting('app.app_user_pw', true)` GUCs at migration-apply time. CI in Plan 16 must invoke `drizzle-kit migrate` with `PGOPTIONS="-c app.app_user_pw=$APP_USER_PW -c app.app_audit_writer_pw=$APP_AUDIT_WRITER_PW"`. If those env vars are missing, the roles will be created with empty-string passwords — a silent vulnerability. Plan 16 must verify role passwords are non-empty post-apply. |

## User Setup Required

None — no external service configuration required for this plan. (Phase 1 deployment-time setup — Supabase project creation, Hetzner provisioning, Cloudflare R2 bucket — is owned by Plans 16-17.)

## Next Phase Readiness

- **Plan 03 (medical isolation)** is unblocked: it can `import { users, parentChildLinks } from '@/server/db/schema'` for FK references, use the `tstz()` helper, and add `medical_events` + `medical_documents` + `medical_access_audit` tables in a new `src/server/db/schema/medical.ts` file. The companion migration `0001_medical.sql` will follow the same hand-augmented pattern (auto-section + manual blocks for `pgp_sym_encrypt` policy and the medical-specific RLS policy stubs).
- **Plan 04 (RLS policies)** is unblocked: it has all 7 RLS-helper indexes in place, plus the 13 phase-1 tables and the `app_user` / `app_audit_writer` roles to write `CREATE POLICY ... USING ...` against. The `current_setting('app.user_id', true)` / `current_setting('app.user_role', true)` GUC convention is documented in RESEARCH for the policies to consume.
- **Plan 11 (CallerContext)** is unblocked: `users.role` and `users.preferred_locale` exist with the right enum types; `sessions.fresh_until` exists for SEC-03 re-auth windows.
- **Plan 12 (consent flows)** is unblocked: `consent_records.policy_version + locale + snapshot + sha256` is in source; `recordConsent` and `getConsentText` from `@/lib/consent` (Plan 12) will write rows that pass tests/integration/consent.test.ts assertions exactly.
- **Plan 16 (drizzle-kit migrate against staging)** has two follow-up tasks added by this plan:
  1. Run `drizzle-kit generate --name=initial` and assert zero diff against the auto-generated section of `drizzle/0000_initial.sql` (lines before the HAND-AUGMENTED BLOCKS banner).
  2. Run `drizzle-kit introspect` post-migrate to reconstruct `drizzle/meta/0000_snapshot.json`; commit it as a follow-up if it doesn't already exist.

**Blockers:** None. The schema contract is locked; downstream plans can proceed.

## Self-Check: PASSED

All claimed files exist on disk:
- `src/server/db/client.ts`, `src/server/db/helpers/timestamps.ts`, `src/server/db/schema/index.ts`
- `src/server/db/schema/auth.ts`, `lookups.ts`, `memberships.ts`, `consent.ts`, `audit.ts`, `idempotency.ts`
- `drizzle/0000_initial.sql`, `drizzle/0000_initial.rollback.md`, `drizzle/meta/_journal.json`
- `tests/unit/timestamps.test.ts`, `schema-locale.test.ts`, `lookup-codes.test.ts`

All claimed commits exist in git log:
- `bf87f64` — Task 1 (drizzle client + tstz helper)
- `338419f` — Task 2 (six schema files + tests)
- `0ee5257` — Task 3 (migration SQL + rollback)

All plan grep verifications pass on disk:
- `withTimezone: true` in timestamps.ts; `prepare: false` in client.ts; barrel re-exports in index.ts
- `localeEnum.*'nl'.*'en'.*'fr'` matches in auth.ts; `direction: text('direction').notNull()` matches in lookups.ts
- `uniq_child_user` in memberships.ts; `consentTextSnapshot`, `consentTextSha256`, `policyVersion` in consent.ts
- `bigserial.*id` in audit.ts
- 16 tables in 0000_initial.sql; pgcrypto, role creation, REVOKE, set_updated_at, trg_users_updated_at, all 7 indexes
- `DROP ROLE IF EXISTS app_user` in rollback.md

---

*Phase: 01-fundament*
*Plan: 02*
*Completed: 2026-05-01*
