# Deferred items — Phase 01-fundament

Items discovered during plan execution that are out-of-scope for the plan they were found in. Each entry should reference the discovering plan and a target plan/phase for resolution.

## Pre-existing test isolation bug — `tests/unit/worker-template.test.ts`

**Discovered during:** Plan 06 (`01-06-better-auth-i18n-emails`)
**Owner:** Plan 10 (`01-10-async-jobs-bullmq-upstash`) — author of the test file
**Impact:** 3 of 7 tests in `tests/unit/worker-template.test.ts` fail when the file is run as a whole (the `processConsentVersionBump idempotency` describe block).

**Root cause:**
- The first describe (`BullMQ worker template — D-15`) test "worker entrypoint registers SIGTERM + SIGINT handlers" calls `vi.doMock('@/server/workers/jobs/consent-version-bump', () => ({ processConsentVersionBump: vi.fn() }))`.
- The describe's `afterEach` does NOT include `vi.doUnmock('@/server/workers/jobs/consent-version-bump')`.
- `vi.resetModules()` clears the imported module cache but does NOT clear the `vi.doMock` registry.
- All subsequent tests therefore receive the stub `processConsentVersionBump = vi.fn()` (returns `undefined`) instead of the real function.

**Fix (one line):** Add `vi.doUnmock('@/server/workers/jobs/consent-version-bump');` to the `afterEach` of the first describe block in `tests/unit/worker-template.test.ts`.

**Why deferred:** Out of scope for Plan 06 per the SCOPE BOUNDARY rule (only auto-fix issues directly caused by the current task's changes). This bug is independent of the email module — it manifests identically whether `@/server/email/send` exists or not.

**Verification:** Running the idempotency block in isolation (`vitest run tests/unit/worker-template.test.ts -t "idempotency"`) passes 3/3, confirming the test logic is correct and the bug is purely sequence-dependent.
