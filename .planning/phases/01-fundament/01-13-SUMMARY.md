---
phase: 01-fundament
plan: 13
subsystem: infra
tags: [pino, sentry, logging, observability, gdpr, redaction, drizzle, slow-query, logflare, axiom]

# Dependency graph
requires:
  - phase: 01-fundament
    provides: "Plan 01 — env validation gate (SENTRY_DSN, LOGFLARE_*, LOG_LEVEL, NODE_ENV) and tooling lock (pino@^10, @sentry/nextjs@^10, pino-pretty)"
  - phase: 01-fundament
    provides: "Plan 02 — base Drizzle client (postgres-js pool, pooler-compat) extended here with withTiming"
provides:
  - "src/lib/log.ts — pino instance configured with REDACT_PATHS (15 paths), service base 'vttl-topsport', pino-pretty in dev, env-gated Logflare transport"
  - "src/lib/log-redact-paths.ts — REDACT_PATHS single source of truth for pino + Sentry (forward-created here so Plan 05 can import directly)"
  - "src/lib/sentry.ts — initSentry() with PII-stripping beforeSend (user PII, auth + cookie headers, body password/token/email/phone/dateOfBirth/consentTextSnapshot/medical_*/Cipher fields)"
  - "sentry.{server,client,edge}.config.ts — three runtime entrypoints delegating to src/lib/sentry"
  - "src/server/db/client.ts — withTiming<T>(label, fn) slow-query gate at 500ms threshold (WARN db.slow_query / DEBUG db.query_timing)"
  - "docs/observability.md — OPS-02 retention table, REDACT_PATHS contract, slow-query thresholds at app + DB layer, OPS-03 log-shipping options"
affects: [phase-2-rls, phase-2-onwards-feature-development, phase-8-release-gates, plan-11-callercontext, plan-14-health-endpoints]

# Tech tracking
tech-stack:
  added: ["pino structured logger (worker-thread transport)", "@sentry/nextjs error tracking (EU region)", "pino-pretty (dev formatting)", "Logflare optional transport (env-gated)"]
  patterns: ["Single-source-of-truth redaction list shared by pino + Sentry", "Three-runtime Sentry init delegation pattern (server/client/edge → @/lib/sentry)", "withTiming wrapper for opt-in app-layer query timing aligned with DB log_min_duration_statement"]

key-files:
  created:
    - "src/lib/log.ts"
    - "src/lib/log-redact-paths.ts"
    - "src/lib/sentry.ts"
    - "sentry.server.config.ts"
    - "sentry.client.config.ts"
    - "sentry.edge.config.ts"
    - "docs/observability.md"
    - "tests/unit/log-redact-paths.test.ts"
    - "tests/unit/db-timing.test.ts"
  modified:
    - "src/server/db/client.ts"

key-decisions:
  - "Forward-create src/lib/log-redact-paths.ts in Wave 3 (Rule 3 — blocking dep). Plan 05's CSRF/log-redact integration test consumes the same constant when Plan 05 lands; no duplication."
  - "Sentry's beforeSend implements semantic equivalents of REDACT_PATHS in JS form (Sentry event shape ≠ pino path syntax, so wildcards re-expressed as for-loops + key prefix/suffix tests). The list of dangerous body keys mirrors the wildcard semantics in REDACT_PATHS."
  - "withTiming uses performance.now() (sub-ms precision, monotonic) and try/finally so timing is recorded on rejection too — slow failing queries are themselves a signal."
  - "500ms threshold matches Supabase log_min_duration_statement = 500 (Phase 8 release-gate config) so app + DB layers produce evidentially-aligned slow-query logs."
  - "Logflare picked as the OPS-03 primary aggregator (Supabase-native, EU dataset). Axiom retained as documented alternative; transport swap is one line in src/lib/log.ts."

patterns-established:
  - "Single-source-of-truth PII list: src/lib/log-redact-paths.ts. Adding a sensitive field to ONE redaction layer is a defect — must land in REDACT_PATHS first."
  - "Three Sentry runtime entrypoints (server/client/edge) all delegate to a single src/lib/sentry initSentry() so they can never drift on the PII rules."
  - "Drizzle slow-query timing is opt-in via withTiming(label, fn) wrapper, not a global Drizzle middleware, because the call-site label is more useful in dashboards than the raw SQL."
  - "tests for time-sensitive logic spy on performance.now() and feed deterministic values — never busy-wait or setTimeout (MAJOR-10)."

requirements-completed: [OPS-01, OPS-02, OPS-03, OPS-04, OPS-05]

# Metrics
duration: 11min
completed: 2026-05-02
---

# Phase 1 Plan 13: Observability — pino + Sentry Summary

**pino structured logger with PII redaction (REDACT_PATHS), Sentry EU error tracking with PII-stripping beforeSend, Drizzle withTiming 500ms slow-query gate, OPS-02 retention policy documented (30d/90d/6y).**

## Performance

- **Duration:** 11 min
- **Started:** 2026-05-02T09:18:36Z
- **Completed:** 2026-05-02T09:29:28Z
- **Tasks:** 2 (both TDD: RED + GREEN per task = 4 commits)
- **Files modified:** 10 (9 created, 1 modified)

## Accomplishments

- `src/lib/log.ts` pino instance configured with `REDACT_PATHS` consumed verbatim from `src/lib/log-redact-paths.ts`, `[REDACTED]` censor, ISO-time timestamps, `service: 'vttl-topsport'` base, pino-pretty in dev, env-gated Logflare transport for production (OPS-01, OPS-03).
- `src/lib/sentry.ts` `initSentry()` with PII-stripping `beforeSend` hook covering user PII (email/ip_address/username/name), auth + cookie headers (incl. `set-cookie` and capitalised variants), and dangerous body keys (password/token/email/phone/dateOfBirth/consentTextSnapshot, plus any `medical_*` prefixed or `*Cipher` suffixed key) — T-01-06 mitigation.
- Three Sentry runtime config files (`sentry.server.config.ts`, `sentry.client.config.ts`, `sentry.edge.config.ts`) all delegate to `initSentry()` so server / client / edge runtimes share one PII rule set.
- `src/server/db/client.ts` extended with `withTiming<T>(label, fn)` — 500ms threshold; WARN under tag `db.slow_query`; DEBUG under tag `db.query_timing`; uses `performance.now()` and `try/finally` so error paths still log + propagate (OPS-04, OPS-05).
- `docs/observability.md` documents the OPS-02 retention table (30d application logs, 90d `audit_log`, 6 years `medical_access_audit`, 90d Sentry); the REDACT_PATHS source-of-truth contract; the slow-query threshold at both app and DB layer; the OPS-03 log-shipping options (Logflare primary, Axiom alternate); and the I18N-11 backend-logs-English contract.
- Two passing unit test files: `tests/unit/log-redact-paths.test.ts` (2 tests — pino redact wiring + Sentry PII stripping) and `tests/unit/db-timing.test.ts` (4 tests — return value, slow path, fast path, error propagation).

## Task Commits

Each task was TDD with RED + GREEN commits:

1. **Task 1 RED — pino redact + Sentry beforeSend test** — `bcc59f6` (test)
2. **Task 1 GREEN — pino + Sentry observability** — `5dd94ae` (feat)
3. **Task 2 RED — withTiming slow-query test** — `ad1d4e4` (test)
4. **Task 2 GREEN — withTiming slow-query gate** — `4324d3d` (feat)

_TDD gate compliance:_ both tasks have a `test(...)` commit immediately preceding the matching `feat(...)` commit. No REFACTOR commits — implementation was clean as written.

## Files Created/Modified

- `src/lib/log-redact-paths.ts` — `REDACT_PATHS` const (15 paths). Single source of truth; wildcard syntax follows pino redact rules.
- `src/lib/log.ts` — pino instance + transport-builder helper (pino-pretty in dev, Logflare in prod under env flag, stdout fallback).
- `src/lib/sentry.ts` — `initSentry()` with `beforeSend` hook implementing the REDACT_PATHS-equivalent rules in JS form for the Sentry event envelope.
- `sentry.server.config.ts`, `sentry.client.config.ts`, `sentry.edge.config.ts` — three runtime entrypoints, each one-line delegation.
- `src/server/db/client.ts` — extended with `withTiming<T>(label, fn)` and `import { log } from '@/lib/log'`. The existing `db` and `DbClient` exports and the postgres-js pool config are unchanged.
- `docs/observability.md` — operational doc covering retention, redaction contract, slow-query thresholds, log shipping, and I18N-11.
- `tests/unit/log-redact-paths.test.ts` — pino redact + Sentry beforeSend assertions (2 tests).
- `tests/unit/db-timing.test.ts` — withTiming contract assertions, including error propagation (4 tests).

## Decisions Made

- **Forward-create `src/lib/log-redact-paths.ts` in Wave 3 (Rule 3).** Plan 05 (Better Auth) plans this constant but had not yet executed when Plan 13 was assigned. The plan's `must_haves` require importing `REDACT_PATHS` from this path. Creating it here unblocks Plan 13 without speculating on the rest of Plan 05's contents — when Plan 05 lands its CSRF/log-redact integration test will consume the same file.
- **Sentry beforeSend uses JS-side equivalents, not pino redact paths verbatim.** Sentry's event envelope is shaped differently from pino's log records (`event.user.email`, `event.request.headers.authorization`, body in `event.request.data`). Re-expressing the wildcard semantics — for-loops over `SENSITIVE_BODY_KEYS`, plus prefix `medical_` / suffix `Cipher` checks — keeps the rule list explicit and auditable.
- **`withTiming` is opt-in at the call site, not a global Drizzle middleware.** Drizzle's middleware surface is per-query but does not let the call site pass a logical label like `'evaluations.list-by-player'`. A wrapper makes labels first-class for dashboards and grep.
- **`try/finally` on withTiming so timing is logged on rejection.** A slow failing query is itself a signal — silently dropping its timing on the error path would be a regression in observability.
- **Logflare picked as primary, Axiom retained as alternative.** Logflare is Supabase-native and has an EU dataset on signup. The transport target is one line in `src/lib/log.ts` — swap is trivial if Logflare onboarding stalls (documented in `docs/observability.md`).
- **`pino.transport({ targets })` is built with a guard: empty target list returns `undefined`.** Calling `pino.transport({ targets: [] })` throws — the guard lets pino fall back to the default stdout sink when neither pino-pretty (dev) nor Logflare (prod) is configured. Coolify scrapes the container log stream as the interim path; production go-live MUST have Logflare configured (Phase 8 gate).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Forward-created `src/lib/log-redact-paths.ts`**

- **Found during:** Task 1 (pino instance + Sentry init)
- **Issue:** Plan 13's `must_haves` require importing `REDACT_PATHS` from `src/lib/log-redact-paths.ts`, but this file is planned by Plan 05 which has not yet executed (no SUMMARY for `01-05-better-auth-config-PLAN.md`). Without the file, `src/lib/log.ts` cannot compile and the test cannot import the constant.
- **Fix:** Created `src/lib/log-redact-paths.ts` with the exact contents specified in `01-05-better-auth-config-PLAN.md` (lines 491–510): 15 paths covering auth headers, password/token/cookie, email/phone/dateOfBirth/ipAddress, `*.medical_*`, `*.eventDescriptionCipher`, `*.doctorCipher`, `*.consentTextSnapshot`. Marked as `as const` so the array literal is preserved at the type level for downstream type checks.
- **Files modified:** `src/lib/log-redact-paths.ts` (created).
- **Verification:** Plan 13 unit test imports `REDACT_PATHS` and asserts every entry is present in pino's redact paths — passes (2/2 tests). Plan 05 will be able to import the same constant directly without redefinition when it lands.
- **Committed in:** `5dd94ae` (Task 1 GREEN commit; included in the same atomic commit as `src/lib/log.ts` since the two files form one shipping unit).

**2. [Rule 2 — Missing Critical] Added `set-cookie` to Sentry header strip + `Authorization`/`Cookie` capitalised variants**

- **Found during:** Task 1 (Sentry beforeSend implementation)
- **Issue:** The plan's example Sentry beforeSend (lines 154–160) deletes `event.request.headers.authorization` and `event.request.headers.cookie`. Real-world Node servers and proxies sometimes write headers with the canonical casing (`Authorization`, `Cookie`) and `set-cookie` is the response side that some Sentry SDK versions surface in `request.headers`. Without explicit defensive deletion the canonical-cased variants would slip through.
- **Fix:** Added `set-cookie`, `Authorization`, `Cookie` to a `SENSITIVE_HEADER_KEYS` constant iterated in beforeSend. Documented the rationale in the file-level comment.
- **Files modified:** `src/lib/sentry.ts`.
- **Verification:** Test asserts `set-cookie` is undefined post-beforeSend — passes. The capitalised variants are not exercised by the test (the Sentry SDK normalises in current versions) but the defensive deletion is cost-free and forward-compatible.
- **Committed in:** `5dd94ae` (Task 1 GREEN commit).

**3. [Rule 2 — Missing Critical] Added 4th withTiming test for error propagation**

- **Found during:** Task 2 (withTiming implementation)
- **Issue:** The plan specifies 3 tests for withTiming (return unchanged, WARN >500ms, DEBUG ≤500ms). The behaviour contract — that timing is recorded even when `fn()` rejects (try/finally) — was not directly tested. A regression that swallowed errors or skipped logging on rejection would not be caught.
- **Fix:** Added a 4th test that throws from `fn()` and asserts (a) the error propagates via `rejects.toBe(boom)` and (b) the WARN log fires with the recorded duration. This nails down the try/finally semantics that make slow failing queries observable.
- **Files modified:** `tests/unit/db-timing.test.ts`.
- **Verification:** 4/4 tests pass (vitest run).
- **Committed in:** `ad1d4e4` (RED) / `4324d3d` (GREEN).

---

**Total deviations:** 3 auto-fixed (1 Rule 3 blocking, 2 Rule 2 missing-critical).
**Impact on plan:** All three are correctness/security additions, zero scope creep. The Rule 3 forward-creation is the only one with cross-plan implications — it pre-pays the small artifact for Plan 05.

## Issues Encountered

- **No node_modules in the executor worktree.** The parallel-executor pattern stages this worktree off the main repo's git history but does not install dependencies. Vitest cannot resolve `pino` / `@sentry/nextjs` / etc. from the worktree's tree, and the global setup in `tests/setup.ts` boots a Postgres testcontainer (Docker not available in this environment).
  - **Mitigation:** Wrote a temporary `vitest.unit-plan13.config.ts` at the parent-repo root (where node_modules is reachable) targeting `--root` at the worktree's `tests/unit/` directory and bypassing the testcontainer global setup. This is a runner-side artifact only; it was deleted after final verification and is not committed in the worktree.
  - **Verification path:** all 6 Plan 13 tests run from the parent-repo's vitest binary against the worktree files (output captured: `Test Files 2 passed (2) / Tests 6 passed (6)`).
- **Pre-existing typecheck errors in unrelated files.** `tsc --noEmit` reports 3 errors in files outside Plan 13 scope: `src/server/workers/jobs/consent-version-bump.ts` (imports unwritten `@/server/email/send`, owned by Plan 06), `tests/integration/consent.test.ts` (imports unwritten `@/lib/consent`, owned by Plan 12), `tests/integration/email-locale.test.ts` (same Plan 06 dep). These are out of Plan 13 scope (unrelated plans not yet executed) and are logged here for the orchestrator's deferred-items tracker. **Plan 13 introduces zero new typecheck errors.**

## User Setup Required

Plan 13 wires the observability code; the external services it talks to require manual onboarding before production go-live. None of this blocks Phase 1 development on staging:

- **Sentry EU project**: register a Sentry project, choose the "EU (Frankfurt)" region, copy the DSN. Set `SENTRY_DSN` in the production env. The DSN host MUST end in `.ingest.de.sentry.io` — `.ingest.us.sentry.io` would route data through the US and break GDPR data residency.
- **Logflare or Axiom EU dataset**: register a Logflare project (Supabase-native, EU dataset selectable on signup) OR an Axiom EU dataset; copy the API key + source/dataset token. Set `LOGFLARE_API_KEY` + `LOGFLARE_SOURCE` (or the Axiom equivalents — the transport target swap is documented in `src/lib/log.ts`). When neither is set, pino logs to stdout and Coolify scrapes the container log stream as a working interim.
- **Supabase database setting**: `ALTER DATABASE postgres SET log_min_duration_statement = 500;` — manual configuration on the Supabase project (Phase 8 release-gate task; documented in `docs/observability.md`).

A9 verification (which aggregator was chosen): **Logflare** is the documented primary; Axiom is the documented alternative. The actual onboarding decision is **deferred to Phase 8** — Plan 13 ships the code that supports either, behind an env flag, so the choice can be made closer to go-live without further code changes.

## Threat Flags

None — Plan 13 strengthens the existing T-01-06 mitigation (PII leakage via logs / error tracking) and does not introduce new trust boundaries beyond those already in the plan's threat model. Both new outbound boundaries (App → Logflare/Axiom, App → Sentry) were anticipated and the redaction layers cover them.

## Self-Check: PASSED

**Files (created/modified) verified to exist on disk:**
- `src/lib/log.ts` — FOUND
- `src/lib/log-redact-paths.ts` — FOUND
- `src/lib/sentry.ts` — FOUND
- `sentry.server.config.ts` — FOUND
- `sentry.client.config.ts` — FOUND
- `sentry.edge.config.ts` — FOUND
- `docs/observability.md` — FOUND
- `src/server/db/client.ts` — FOUND (modified, `withTiming` exported)
- `tests/unit/log-redact-paths.test.ts` — FOUND
- `tests/unit/db-timing.test.ts` — FOUND

**Commits verified to exist in `git log`:**
- `bcc59f6` (test RED, Task 1) — FOUND
- `5dd94ae` (feat GREEN, Task 1) — FOUND
- `ad1d4e4` (test RED, Task 2) — FOUND
- `4324d3d` (feat GREEN, Task 2) — FOUND

**Tests verified to pass:**
- `tests/unit/log-redact-paths.test.ts` — 2/2 GREEN
- `tests/unit/db-timing.test.ts` — 4/4 GREEN
- combined run: 6/6 GREEN, 0 failures

## Next Phase Readiness

- **Plan 11 (CallerContext middleware)** can attach `requestId` + `userId` per request via `log.child({ requestId, userId })`. The base logger is already set up; `log.child(...)` is a pino built-in that inherits the redact + base config.
- **Plan 14 (health endpoints)** can `import { log } from '@/lib/log'` and emit health-probe pass/fail lines. The `/api/health/ready` Postgres probe should use `withTiming` to surface slow connectivity.
- **Plan 05 (Better Auth + CSRF)** can `import { REDACT_PATHS } from '@/lib/log-redact-paths'` directly when it lands — the constant is already in place. Plan 05's `tests/unit/log-redact.test.ts` becomes a no-mock import test for the same constant Plan 13 wires.
- **Phase 5 (medical follow-up)**: encrypted medical fields and `medical_*` columns will be redacted automatically on log emission AND on Sentry capture — REDACT_PATHS already covers the `*.medical_*` and `*Cipher` patterns. Phase 5 must add any additional new sensitive fields to REDACT_PATHS (single-source-of-truth contract).
- **Phase 8 (release gates)**: tasks remain to (a) onboard Logflare or Axiom EU dataset, (b) set `log_min_duration_statement = 500` on the Supabase database, (c) wire `pg_cron` for the 90-day audit_log purge job, (d) configure Better Stack alerts on error rate / latency / connection saturation. All four are documented in `docs/observability.md`.

---

*Phase: 01-fundament*
*Completed: 2026-05-02*
