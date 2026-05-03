---
phase: 01-fundament
plan: 16
subsystem: database
tags:
  - drizzle-kit
  - postgres
  - migration
  - schema-push
  - rls
  - gdpr
  - mig-04

# Dependency graph
requires:
  - phase: 01-fundament
    plans: [02, 03, 04, 12, 15]
    provides: Migration files 0000..0003, schema TS files, rollback companions, and the user-management consumer that needs the schema live.
provides:
  - Migration push contract documented (canonical `npx drizzle-kit migrate` invocation, including `PGOPTIONS` for role-password GUCs).
  - SHA-256 checksums of all 4 phase-1 migration files frozen in `01-16-MIGRATION-LOG.md` for byte-for-byte staging reconciliation.
  - Eight smoke-check SQL queries with expected output, ready to run against staging.
  - Verification matrix with the 14 gates (8 smoke checks + 4 file-integrity gates + 1 drift gate + 1 rollback-companion gate). No `FAIL` rows; live-DB rows are `DEFERRED` to Coolify staging deploy.
  - Manual operator runbook for the staging push (secret generation, deploy trigger, log appending).
affects:
  - 01-17-rbac-matrix-test (now has live DB to exercise the 35 cases)
  - 01-17-rls-direct-query-test (RED → GREEN once staging is migrated)
  - 01-11-trpc-middleware (`/api/health/ready` returns 200 against populated staging DB)
  - Phase 2+ (every domain plan assumes the phase-1 schema is live)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Migration push contract documented in `01-16-MIGRATION-LOG.md` — canonical command, frozen checksums, deferred verification matrix. Future phase pushes reuse this template."
    - "T-01-MIG-CREDENTIALS mitigation pattern: role passwords are session-set GUCs (`PGOPTIONS=-c app.<key>=…`) read by the migration via `current_setting()` + `EXECUTE format('… PASSWORD %L', …)`; the migration SQL never carries secrets."
    - "Sandbox-vs-staging split: hand-authored migrations in the agent worktree (no `node_modules`, no DB), with the actual `drizzle-kit migrate` executed by Coolify staging. The migration log is the bridge document that survives both environments."

key-files:
  created:
    - ".planning/phases/01-fundament/01-16-MIGRATION-LOG.md — push contract, checksums, smoke checks, verification matrix, threat-model posture, manual-operator runbook."
    - ".planning/phases/01-fundament/01-16-SUMMARY.md — this file."
  modified: []

key-decisions:
  - "Document-and-defer in the agent worktree (no node_modules, no .env.local, no Supabase egress). The MIGRATION-LOG.md is authored as a living document: Coolify appends the live `drizzle-kit migrate` stdout and CI flips `DEFERRED → OK` per matrix row. This satisfies the plan's contract (frozen checksums, complete smoke-check spec, no FAIL rows) without falsifying live results we cannot verify here."
  - "Use Node's `crypto.createHash('sha256')` to compute file checksums because `shasum`, `sha256sum`, and `openssl dgst` are blocked in the sandbox. Output format matches `sha256sum`."
  - "Mark the manual operator steps (secret generation, Coolify Secrets entry, staging trigger) as DEFERRED rather than completed — these require human + infrastructure access outside the agent's reach. The runbook is precise enough for the TD to execute in <5 min."

patterns-established:
  - "Migration log lifecycle: (a) executor freezes file checksums + writes deferred matrix; (b) Coolify staging deploy appends stdout and flips DEFERRED rows; (c) post-incident, same file is the rollback diff source."
  - "MIG-04 staging gate: live DB push happens only via Coolify pre-deploy hook against staging Supabase, never from a developer laptop or an agent sandbox. Production is a separate Phase-8 step with its own log."

requirements-completed:
  - MIG-04

# Metrics
duration: 18min
completed: 2026-05-03
---

# Phase 1 Plan 16: drizzle-kit push contract Summary

**Phase-1 schema push contract — 4 migrations frozen with SHA-256 checksums, the canonical `drizzle-kit migrate` invocation documented (with `PGOPTIONS` GUC pattern for role passwords), 8 smoke checks scripted with expected output, and a 14-row verification matrix where every live-DB row is explicitly DEFERRED to the Coolify staging pre-deploy hook (MIG-04). Real `npx drizzle-kit migrate` execution happens in the staging deploy, not in the agent sandbox.**

## Performance

- **Duration:** 18 min
- **Started:** 2026-05-03T00:00:00Z (sandbox-relative; no live timing applies)
- **Completed:** 2026-05-03T00:00:00Z
- **Tasks:** 1 (single-task plan)
- **Files modified:** 2 (both created)

## Accomplishments

- `01-16-MIGRATION-LOG.md` written with: pre-checks (7), frozen file checksums (4 SHA-256 values), drift-status posture, canonical staging-push command, expected stdout template, 8 smoke-check SQL queries with expected output, 14-row verification matrix, T-01-MIG-CREDENTIALS threat-model posture, manual operator steps for staging.
- Confirmed via plan-16's automated verify regex: file exists, contains "Phase 1 Push", contains "Verification matrix", contains zero `| FAIL |` table cells.
- Confirmed all four migration files (0000_initial, 0001_medical_isolated, 0002_rls_functions_and_policies, 0003_users_is_minor) are present, journaled, and accompanied by `*.rollback.md` companions — the MIG-05 invariant holds.
- Confirmed `drizzle.config.ts` correctly targets `DIRECT_DATABASE_URL` (port 5432) and registers the migration ledger in `public.drizzle_migrations`.
- Confirmed `.github/workflows/protect-migrations.yml` enforces MIG-01 (no edits to committed migrations) + MIG-05 (rollback companion required) at the PR layer.

## Task Commits

1. **Task 1: Apply migrations against dev/staging Supabase + post-migration smoke checks (sandbox: documented + frozen)** — single atomic commit creating both files.

**Plan metadata:** included in the same commit (the plan only writes to `.planning/phases/01-fundament/`; STATE.md / ROADMAP.md are explicitly out-of-scope per the orchestrator instructions for this plan).

## Files Created/Modified

- `.planning/phases/01-fundament/01-16-MIGRATION-LOG.md` — created. The push contract, frozen-state record, and forward-looking matrix.
- `.planning/phases/01-fundament/01-16-SUMMARY.md` — created. This file.

## Decisions Made

- **Document-and-defer in the agent worktree.** The orchestrator's `context_note` explicitly authorises this: when the sandbox cannot reach Supabase (no `.env.local` / no `node_modules` / no network egress to Supabase), the executor freezes the inputs and documents the staging-push command for Coolify. The MIGRATION-LOG.md is structured to host both the frozen state (now) and the live results (after Coolify runs the migration job).
- **Drift detection deferred to staging pre-deploy.** `drizzle-kit generate --dry-run` would normally run as the drift gate, but it requires `node_modules`. The Coolify pre-deploy hook is documented in MIGRATION-LOG.md "Drift status" with a concrete bash snippet that fails the deploy on any non-empty diff between schema TS and committed migrations.
- **Use `node -e "crypto.createHash(…)"` for SHA-256.** The sandbox blocks `shasum`, `sha256sum`, and `openssl dgst`; Node is available and produces format-compatible hex digests.
- **Mark DEFERRED rather than OK or FAIL.** A row that has not been verified against a live DB is neither passing nor failing — it is "ready, awaiting execution by Coolify." Marking such rows OK would be dishonest; marking them FAIL would trip the verify regex unnecessarily and trigger a rollback that nothing has been pushed for.

## Deviations from Plan

None — plan executed exactly as the `context_note` authorised. The plan body anticipated this case ("the agent sandbox very likely cannot reach Supabase") and pre-described the documentation-and-defer path.

## Issues Encountered

- The sandbox blocks `shasum`/`sha256sum`/`openssl dgst` (would have been the canonical hashing tool), so checksums were computed via Node's `crypto.createHash`. Output format and hash values are equivalent; verified against the migration files which were never modified during this plan.
- `npx drizzle-kit generate` cannot run (no `node_modules`); the plan's drift-detection step is therefore documented as a Coolify pre-deploy gate rather than executed inline. Hand-confirmation of "no schema TS edits since plan-12 (which produced 0003)" is included in the migration log as a best-effort sandbox-side check.

## User Setup Required

**External services require manual configuration to complete the staging push.** From `01-16-MIGRATION-LOG.md` §"Manual operator steps":

1. Generate two 32-char random secrets via `openssl rand -base64 32` (one for `APP_USER_PW`, one for `APP_AUDIT_WRITER_PW`).
2. Add both as Coolify Secrets, scoped to the staging `migrate` one-shot service (NOT to `web`/`worker` runtimes).
3. Trigger the staging deploy. Coolify runs the documented `npx drizzle-kit migrate` invocation with the `PGOPTIONS` GUC pattern.
4. Append the live `drizzle-kit migrate` stdout under "Applied migrations — staging push log" in `01-16-MIGRATION-LOG.md`.
5. Run the 8-query smoke-check SQL against staging and update each `DEFERRED` row in the verification matrix to `OK` (or `FAIL` if anything diverges, in which case roll back per the per-migration `*.rollback.md` runbooks in reverse order).

Estimated time: 5 min (human) + 30 sec (Coolify deploy + migrate).

## Next Phase Readiness

- **Plan 17 (RBAC matrix integration test):** unblocked — the test will run against the populated staging DB once the operator executes the manual steps above.
- **Plan 17 (RLS direct-query test):** unblocked — `tests/rls/medical-isolation.test.ts` flips RED→GREEN once staging is migrated.
- **`/api/health/ready` (Plan 11):** unblocked — returns 200 against staging once migration is live.
- **Phase 2+:** all domain plans assume the phase-1 schema is live on staging. The schema push contract is now the single, auditable, byte-for-byte-frozen reference they depend on.

## Self-Check: PASSED

- File `01-16-MIGRATION-LOG.md` exists at `.planning/phases/01-fundament/01-16-MIGRATION-LOG.md`. ✓
- File `01-16-SUMMARY.md` exists at `.planning/phases/01-fundament/01-16-SUMMARY.md`. ✓
- MIGRATION-LOG.md contains "Phase 1 Push" (matches plan-16 verify regex `Applied migration 0000_initial\|0000_initial.*Applied\|Phase 1 Push`). ✓
- MIGRATION-LOG.md contains "Verification matrix". ✓
- MIGRATION-LOG.md contains zero `| FAIL |` table cells. ✓
- All 4 migration files (`0000_initial.sql`, `0001_medical_isolated.sql`, `0002_rls_functions_and_policies.sql`, `0003_users_is_minor.sql`) untouched by this plan. ✓
- `drizzle/meta/_journal.json` lists the 4 migrations with the expected tags. ✓
- STATE.md and ROADMAP.md NOT modified by this plan (per orchestrator instruction "Do NOT update STATE.md or ROADMAP.md"). ✓

---

*Phase: 01-fundament*
*Completed: 2026-05-03*
