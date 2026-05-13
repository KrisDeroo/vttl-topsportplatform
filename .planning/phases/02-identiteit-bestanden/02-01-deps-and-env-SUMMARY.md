---
phase: 02-identiteit-bestanden
plan: 01
subsystem: infra
tags: [supabase-storage, clamscan, env-validation, pino-redact, t3-env, gdpr]

# Dependency graph
requires:
  - phase: 01-fundament
    provides: typed env binding (src/lib/env.ts via @t3-oss/env-nextjs) + REDACT_PATHS contract (src/lib/log-redact-paths.ts) + pino logger pipeline + STUB_ENV test harness
provides:
  - "@supabase/supabase-js@2.105.4 installed and resolvable from working tree"
  - "clamscan@2.4.0 installed and resolvable from working tree (ships own types)"
  - "pnpm-lock.yaml committed for reproducible installs (was untracked at HEAD)"
  - "env.ts validates SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (min 40), CLAMAV_HOST (default 'clamav'), CLAMAV_PORT (coerced int, default 3310) as server-only"
  - ".env.example documents all 4 new keys with provenance hints"
  - "log-redact-paths.ts redacts emergency_contact_{name,phone,relation} in both camelCase and snake_case forms"
  - "tests/setup.ts STUB_ENV extended with placeholder values for all 4 new keys (unit-test boot path)"
affects: [02-04-storage-magic-bytes-helpers, 02-06-malware-scan-worker, 02-07-trpc-schemas, 02-09-trpc-router-file, 02-15-tests, 02-16-deployment-docs]

# Tech tracking
tech-stack:
  added: [@supabase/supabase-js@^2, clamscan@^2]
  patterns:
    - "Server-only env keys via @t3-oss/env-nextjs: declared in `server` block, mirrored into `runtimeEnv`, never given `NEXT_PUBLIC_` prefix"
    - "pino REDACT_PATHS as the single source of truth: same constant consumed by log.ts and sentry.ts; both casings (camel + snake) declared so Drizzle raw queries and typed-client outputs are both covered"
    - "Test stub-env mirrors production env shape: each new server var added to env.ts MUST be added to tests/setup.ts STUB_ENV in the same commit boundary or earlier"

key-files:
  created: [pnpm-lock.yaml]
  modified: [package.json, src/lib/env.ts, .env.example, src/lib/log-redact-paths.ts, tests/setup.ts]

key-decisions:
  - "Supabase service-role key stored only in server env (no NEXT_PUBLIC_SUPABASE_*) — mitigates T-02-01-ENV-LEAK; the server-only storage client will live in src/server/storage/client.ts (02-04) with `import 'server-only'` directive as a second guard"
  - "CLAMAV_HOST defaults to 'clamav' and CLAMAV_PORT to 3310 — matches the Coolify sidecar service name per D-22; .env.example documents the docker-run fallback for dev without a sidecar"
  - "pnpm-lock.yaml committed for reproducible installs — it was already in .gitignore-exempt territory but had never been staged before Phase 2; this plan corrects that omission"
  - "Test STUB_ENV extended with all 4 Phase 2 keys — required to keep Phase 1's unit tests booting through env validation; real client mocks for Supabase/ClamAV will land in 02-15"

patterns-established:
  - "Forbidden-deps explicit-check pattern: plan tasks enumerate deps they MUST NOT install (react-dropzone, @tanstack/react-table) and verify via `grep -c == 0` so future plans cannot accidentally re-introduce them"
  - "Pino redact wildcard scope: never use partial-segment globs (`medical_*`) — fast-redact treats them literally; enumerate the actual field names. Both casings declared for snake_case (raw queries) + camelCase (typed-client)."

requirements-completed: [VALID-04, FILE-01]

# Metrics
duration: 11min
completed: 2026-05-12
---

# Phase 2 Plan 01: Deps and Env Summary

**@supabase/supabase-js@2.105.4 + clamscan@2.4.0 installed, four server-only env vars (Supabase Storage URL+service-role key, ClamAV host+port) wired into t3-env validation, and pino redact-paths extended with six emergency-contact field patterns (camelCase + snake_case).**

## Performance

- **Duration:** 11 min 19 s
- **Started:** 2026-05-12T14:59:50Z
- **Completed:** 2026-05-12T15:11:09Z
- **Tasks:** 3
- **Files modified:** 5 (1 created)

## Accomplishments

- Phase 2 file pipeline runtime deps installed and lockfile pinned — Supabase Storage and clamd TCP clients are now resolvable, unblocking 02-04 (storage helpers), 02-06 (malware scan worker), and all downstream file-flow plans.
- `env.ts` Phase 1 → Phase 2 extension is fully type-safe and additive — every downstream Phase 2 plan can `import { env }` and reach `env.SUPABASE_SERVICE_ROLE_KEY` / `env.CLAMAV_HOST` with compile-time guarantees; missing-in-production fails at boot per the t3-env contract.
- Emergency-contact redaction landed BEFORE the schema lands — guaranteeing that the first time emergency-contact data flows through pino (in 02-09 router work + 02-15 tests), it can never leak. T-02-01-LOG-PII mitigation complete and asserted by the existing OPS-01 contract test (which loops `REDACT_PATHS` against pino's configured redact options).

## Task Commits

Each task was committed atomically:

1. **Task 1: Install @supabase/supabase-js + clamscan and lock** — `0ba4577` (chore)
2. **Task 2: Extend src/lib/env.ts with Supabase + ClamAV vars and document in .env.example** — `93f259c` (feat)
3. **Task 3: Expand log-redact-paths.ts to cover emergency-contact fields** — `2386c03` (feat — includes Rule 3 fix to tests/setup.ts)

## Files Created/Modified

- `package.json` — added `@supabase/supabase-js: ^2` (resolves to 2.105.4) and `clamscan: ^2` (resolves to 2.4.0) in dependencies
- `pnpm-lock.yaml` — **new file** (was untracked; now committed for reproducible installs across worktrees and CI)
- `src/lib/env.ts` — appended 4 server-only keys to `server` zod block + matching `runtimeEnv` entries; extended JSDoc header with Phase 2 rationale paragraph (D-22, FILE-01, VALID-04)
- `.env.example` — appended two sections: `# ── Supabase Storage (Phase 2, FILE-01) ──` with `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (provenance hint: Supabase Dashboard → API → service_role secret) and `# ── ClamAV (Phase 2, VALID-04) ──` with `CLAMAV_HOST` + `CLAMAV_PORT` (docker-run fallback for dev without sidecar)
- `src/lib/log-redact-paths.ts` — appended 6 redact path strings (3 camelCase + 3 snake_case) for emergency-contact name/phone/relation, with rationale block citing PLAYER-06
- `tests/setup.ts` — extended `STUB_ENV` with placeholder values for the 4 new env keys (Rule 3 fix; see Deviations)

## Decisions Made

- **Supabase server-only path confirmed (no NEXT_PUBLIC_SUPABASE_*)** — matches RESEARCH §Runtime State Inventory line 708. Service-role key bypasses Storage RLS by design; client must never see it. Mitigation T-02-01-ENV-LEAK enforced via t3-env's refusal to bundle `server` keys into the client.
- **CLAMAV_HOST/PORT defaults match Coolify sidecar shape** — `clamav:3310` matches the service-name pattern the deployment will use (D-22). Operators only need to override these in dev (when no sidecar runs locally).
- **Lockfile committed for the first time** — Phase 1 ran `pnpm install` but never committed `pnpm-lock.yaml`. Without a lockfile, version drift would cascade across every Phase 2 plan running in parallel worktrees. Fixed here as the natural touch-point.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Extended tests/setup.ts STUB_ENV with the 4 new Phase 2 env keys**
- **Found during:** Task 3 verification (running `tests/unit/log-redact.test.ts` after env.ts gained new required keys)
- **Issue:** Task 2 added `SUPABASE_URL` (no default) and `SUPABASE_SERVICE_ROLE_KEY` (no default, min 40 chars) as required server-only keys. The existing `tests/setup.ts` `STUB_ENV` did not include them, so every unit test that transitively imports `@/lib/env` (and therefore every test that goes through `src/lib/log.ts` or `src/lib/sentry.ts`) failed at boot with `Invalid environment variables`. The Phase 1 redact-contract test (`tests/unit/log-redact-paths.test.ts`) was directly affected.
- **Fix:** Appended 4 stub entries to `STUB_ENV` — `SUPABASE_URL=https://stub-project.supabase.co`, `SUPABASE_SERVICE_ROLE_KEY=stub-service-role-key-for-tests-must-be-40-chars-min` (52 chars, satisfies `.min(40)`), `CLAMAV_HOST=clamav`, `CLAMAV_PORT=3310`. Inline comment explains tests never touch the network with these — 02-04 mocks the Supabase client, 02-06 mocks the clamd socket. 02-15 will replace these stubs with real mocks once the clients are introduced.
- **Files modified:** `tests/setup.ts`
- **Verification:** `npx vitest run tests/unit/log-redact.test.ts tests/unit/log-redact-paths.test.ts` returns 7/7 pass after the fix; both files failed with the same `Invalid environment variables` error before the fix.
- **Committed in:** `2386c03` (folded into Task 3 commit; the redact-paths and stub-env changes are co-required to make Task 3's verification step pass)

---

**Total deviations:** 1 auto-fixed (Rule 3 blocking)
**Impact on plan:** The deviation is purely additive to test infrastructure. Production code is unchanged from the plan as written. No scope creep — the fix is the minimal one-line-per-key change needed to keep Phase 1 unit tests booting alongside the new Phase 2 env shape. The 02-15 test plan already calls out that real mocks for Supabase + ClamAV land there; this stub-env extension is the bridge until then.

## Issues Encountered

- **`pnpm` not on `$PATH`** — The worktree environment had Node 24 and corepack but no pre-installed `pnpm` symlink, and `corepack enable` failed with EACCES on `/usr/local/bin`. Resolved by symlinking the corepack-cached `pnpm@9.15.0` binary into `~/.local/bin/pnpm` and exporting `PATH=~/.local/bin:$PATH` for the install + lockfile commands. This is environment-level, not plan-level — no source files affected.
- **Pre-existing unit-test failures (out of scope)** — `tests/unit/worker-template.test.ts`, `tests/unit/medical-schema.test.ts`, `tests/unit/lookup-codes.test.ts`, and `tests/unit/timestamps.test.ts` show 16 failures both before and after this plan's changes (verified by reverting env.ts to merge-base `7f0a1f3` and re-running). These tests target features built by later Phase 2 plans (02-02, 02-08, 02-06's worker logic) and will pass when those plans land. Logged here for visibility — not in scope for plan 02-01 per the SCOPE BOUNDARY rule.

## User Setup Required

None — no external service configuration required for plan 02-01.

Note: real `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CLAMAV_HOST`, and `CLAMAV_PORT` values must be present in production Coolify Secrets before 02-04's storage client and 02-06's malware-scan worker can run; this is documented in 02-16 (deployment docs).

## Next Phase Readiness

- All Phase 2 plans that need Supabase Storage or ClamAV can now `import { env }` and get typed access to the keys.
- All Phase 2 plans that emit emergency-contact data through pino are automatically PII-safe.
- Phase 1's redact contract test passes against the extended REDACT_PATHS — no regression.
- `pnpm install --frozen-lockfile` is reproducible from the committed lockfile, which is essential for the parallel worktree execution model the orchestrator will use for the remaining waves of Phase 2.

## Self-Check: PASSED

- [x] `package.json` modified (verified: `git log --diff-filter=M -- package.json` shows `0ba4577`)
- [x] `pnpm-lock.yaml` created (verified: `git log --diff-filter=A -- pnpm-lock.yaml` shows `0ba4577`)
- [x] `src/lib/env.ts` modified (verified: `git log --diff-filter=M -- src/lib/env.ts` shows `93f259c`)
- [x] `.env.example` modified (verified: `git log --diff-filter=M -- .env.example` shows `93f259c`)
- [x] `src/lib/log-redact-paths.ts` modified (verified: `git log --diff-filter=M -- src/lib/log-redact-paths.ts` shows `2386c03`)
- [x] `tests/setup.ts` modified (verified: `git log --diff-filter=M -- tests/setup.ts` shows `2386c03`)
- [x] Commit `0ba4577` exists (Task 1)
- [x] Commit `93f259c` exists (Task 2)
- [x] Commit `2386c03` exists (Task 3 + Rule 3 fix)
- [x] `npx tsc --noEmit` exits 0
- [x] `pnpm install --frozen-lockfile` exits 0
- [x] `node -e "require('@supabase/supabase-js'); require('clamscan'); console.log('ok')"` prints `ok`
- [x] `grep -c "SUPABASE_SERVICE_ROLE_KEY" src/lib/env.ts` returns 3 (≥ 2 required)
- [x] `.env.example` documents all 4 new vars (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CLAMAV_HOST, CLAMAV_PORT)
- [x] `tests/unit/log-redact.test.ts` + `tests/unit/log-redact-paths.test.ts` pass 7/7

---
*Phase: 02-identiteit-bestanden*
*Plan: 01-deps-and-env*
*Completed: 2026-05-12*
