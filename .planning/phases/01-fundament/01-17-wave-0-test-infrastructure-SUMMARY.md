---
phase: 01-fundament
plan: 17
subsystem: testing
tags: [vitest, playwright, testcontainers, rbac, rls, ci, github-actions]

requires:
  - phase: 00
    provides: GSD planning artifacts (PLAN.md, REQUIREMENTS.md)
provides:
  - Vitest unit/integration harness with Testcontainers (Postgres 16) bootstrap
  - Playwright e2e config (chromium/firefox/webkit, locale=nl-BE, tz=Europe/Brussels)
  - Wave-0 RED tests covering RBAC matrix (35-cell), RLS direct-query and medical-isolation, locale resolution chain, email locale, consent snapshot+sha256, ratelimit chaos
  - .github/workflows/ci.yml with lint-typecheck → unit-integration → rbac-matrix-gate → e2e job pipeline
affects: 02, 03, 04, 05, 06, 07, 08, 09, 10, 11, 12, 13, 14, 15

tech-stack:
  added: [vitest, @vitest/coverage-v8, playwright, @playwright/test, testcontainers, @testcontainers/postgresql, postgres, drizzle-orm]
  patterns:
    - Forks pool with single-fork to share one Postgres container across tests; ephemeral schemas per test
    - RED test discipline: every test fails today by design and turns GREEN as Waves 2–6 land features
    - rbac-matrix.test.ts as the D-11 enforcement gate in CI

key-files:
  created:
    - vitest.config.ts
    - playwright.config.ts
    - tests/setup.ts
    - tests/helpers/db.ts
    - tests/helpers/seed.ts
    - tests/helpers/trpc.ts
    - tests/helpers/ratelimit-chaos.ts
    - tests/integration/rbac-matrix.test.ts
    - tests/integration/consent.test.ts
    - tests/integration/email-locale.test.ts
    - tests/integration/locale-resolve.test.ts
    - tests/integration/ratelimit.test.ts
    - tests/rls/direct-query.test.ts
    - tests/rls/medical-isolation.test.ts
    - tests/e2e/register-with-consent.spec.ts
    - tests/e2e/auth.spec.ts
    - tests/e2e/locale-switcher.spec.ts
    - tests/e2e/health.spec.ts
    - .github/workflows/ci.yml
  modified: []

key-decisions:
  - "Testcontainers PostgreSqlContainer postgres:16-alpine with shared_preload_libraries=pgcrypto so column-level encryption tests can run"
  - "Single-fork Vitest pool to amortize the ~10s container boot across the suite"
  - "@phase1 tag on Playwright specs so CI can scope the e2e job to phase-1 surface only"
  - "rbac-matrix-gate is a separate CI job that depends on unit-integration — D-11 cannot be skipped via reordering"

patterns-established:
  - "Wave-0 RED tests own the test files; later plans only add the production code that turns them green"
  - "tests/helpers/ratelimit-chaos.ts and tests/helpers/trpc.ts are RED stubs; Plan 09 (rate limit) and Plan 11 (caller context) fill them in"

requirements-completed:
  - I18N-03
  - I18N-04
  - I18N-09
  - GDPR-01
  - GDPR-03
  - SEC-07
  - USER-05
  - CRIT-1
  - CRIT-2
  - D-11
  - D-18

duration: ~6min
completed: 2026-05-01T17:27:12+02:00
---

# Phase 01 Plan 17: Wave-0 Test Infrastructure Summary

**Wave-0 RED test harness landed first, before any production code — Vitest+Testcontainers+Playwright wired into a 4-stage CI pipeline that gates merge on the D-11 RBAC matrix and CRIT-2 medical isolation.**

## Performance

- **Duration:** ~6 min (executor time, across 3 commits)
- **Started:** 2026-05-01T17:21:50+02:00
- **Completed:** 2026-05-01T17:27:12+02:00
- **Tasks:** 3 (harness, RED tests, CI workflow)
- **Files modified:** 19 created

## Accomplishments

- Vitest harness boots a single Postgres 16 container via Testcontainers, runs migrations, and tears down per suite — all integration tests share one container via the forks pool's `singleFork: true` setting.
- 35-cell RBAC matrix (`tests/integration/rbac-matrix.test.ts`) enumerated via `describe.each` over 7 roles × 5 resources, mirroring D-11.
- RLS gates: `tests/rls/direct-query.test.ts` runs raw `pg` as the application role to confirm middleware bypass still hits RLS (USER-05/CRIT-1); `tests/rls/medical-isolation.test.ts` verifies `medical_events` isolation (GDPR-03/CRIT-2).
- i18n coverage: locale-resolve walks the 4-step resolution chain (I18N-03), email-locale asserts nl/en/fr subject literals (I18N-04).
- Consent: snapshot + sha256 + version checks (GDPR-01/I18N-09).
- Rate-limit chaos test (SEC-07): fires 110 requests, asserts exactly 11 × 429 responses.
- 4 Playwright e2e specs scoped via `@phase1` grep tag.
- CI: `lint-typecheck → unit-integration → rbac-matrix-gate → e2e`, each job with explicit `needs:` dependencies. The rbac-matrix-gate job will fail the build if any of the 35 expectations regress.

## Self-Check: PASSED

All 19 files committed across 3 commits cherry-picked onto `main`. SUMMARY.md written by orchestrator after the executor agent's worktree was discarded due to base-mismatch (worktree was created on `origin/main`=`bb2a036`, 10 commits behind local `main`). The agent's commits were pure additions and applied cleanly.

## Notes

- `tests/setup.ts` references `MEDICAL_ENCRYPTION_KEY` in env — Plan 02 must export this from `src/lib/env.ts` for tests to resolve.
- The CI workflow assumes `pnpm` based on the planner's earlier convention — Plan 01 (setup-tooling) will lock the package manager choice.
- All tests are RED today (production code does not exist) and will sequentially turn GREEN as Waves 2–6 land features. The `rbac-matrix-gate` will go GREEN once Plan 04 (RLS) + Plan 11 (tRPC middleware) are merged.
