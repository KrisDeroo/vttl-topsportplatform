---
phase: 02-identiteit-bestanden
plan: 15
subsystem: tests
tags: [tests, rbac, rls, e2e, malware, age-category, magic-bytes, gdpr]
dependency_graph:
  requires:
    - 02-04 (magic-bytes helpers, age-category lib)
    - 02-06 (malware-scan worker)
    - 02-07 (tRPC schemas — player + trainer + file)
    - 02-09 (player + file routers)
    - 02-10 (trainer router)
    - 02-12 (PhotoUpload component)
    - 02-13 (/players/new page)
    - 02-14 (blocking schema push — provides players/trainers/uploaded_files/age_category_history tables)
  provides:
    - Comprehensive Phase 2 test pyramid (5 unit + 5 integration + 1 RLS + 1 e2e + RBAC matrix expansion to 49+ cells)
    - BLOCKER-05 verification (deriveAgeCategory uses orderBy:asc(sortOrder))
    - BLOCKER-07 verification (inaugural age_category_history.effectiveFrom = TODAY, not DOB)
    - T-02-15-FIXTURE-LEAK mitigation pattern (EICAR built at test setup, gitignored)
  affects:
    - tests/helpers/seed.ts (RESOURCES + RBAC_EXPECTATIONS extended with 4 Phase 2 columns)
    - tests/integration/rbac-matrix.test.ts (probe loop covers players/trainers/uploaded_files/age_category_history)
    - src/lib/log-redact-paths.ts (Rule 2 fix: emergency_contact_* redaction added)
tech-stack:
  added: []
  patterns:
    - Mocked-clamscan unit-level malware-scan path (T-02-15-CLAMAV-UNAVAILABLE mitigation)
    - rawPgAsAppUser RLS probe for Phase 2 tables (mirrors medical_events pattern)
    - Built-at-setup EICAR fixture (T-02-15-FIXTURE-LEAK mitigation)
key-files:
  created:
    - tests/unit/player-schemas.test.ts
    - tests/unit/trainer-schemas.test.ts
    - tests/unit/magic-bytes.test.ts
    - tests/unit/players-derive-age-category.test.ts
    - tests/integration/player-router.test.ts
    - tests/integration/trainer-router.test.ts
    - tests/integration/file-upload.test.ts
    - tests/integration/age-category-history.test.ts
    - tests/integration/malware-scan.test.ts
    - tests/rls/players-direct-query.test.ts
    - tests/e2e/photo-upload.spec.ts
    - tests/fixtures/README.md
    - tests/fixtures/build-eicar-png.ts
    - tests/fixtures/build-test-avatar.ts
  modified:
    - tests/unit/log-redact-paths.test.ts (extended with 3 new tests for Phase 2 PII)
    - tests/integration/rbac-matrix.test.ts (probe loop covers 4 new resources; >=49 cells)
    - tests/helpers/seed.ts (RESOURCES + RBAC_EXPECTATIONS expanded)
    - src/lib/log-redact-paths.ts (Rule 2 — adds emergency_contact_* redaction)
    - .gitignore (excludes generated tests/fixtures/eicar.png)
decisions:
  - "Author tests against RED Phase 2 source — modules from 02-04..02-13 will merge later; tests pin the contract today and fail fast on missing modules per documented plan (Tests are RED until implementation merges)."
  - "Build EICAR fixture at test setup (not committed) — avoids AV-scanner false positives at git push time (T-02-15-FIXTURE-LEAK mitigation)."
  - "Add emergency_contact_* to REDACT_PATHS as Rule 2 deviation — operational PII in production logs would be a GDPR breach; correctness requirement, not a feature."
  - "Skip ClamAV full-pipeline e2e locally (mocked clamscan only) — no daemon available; CI runs the full version (T-02-15-CLAMAV-UNAVAILABLE mitigation)."
  - "Use rawPgAsAppUser for all 4 new RBAC matrix probes — same RLS-at-DB-layer pattern as Phase 1 medical_events probe (CRIT-2): proves RLS works at the DB layer, not just the tRPC layer."
metrics:
  duration: 45m
  completed: 2026-05-13
---

# Phase 2 Plan 15: Comprehensive Test Suite Summary

JEST/Vitest test pyramid converts Phase 2 from "compiles" to "verifiably correct" — 5 unit + 5 integration + 1 RLS + 1 e2e, with RBAC matrix expanded from 35 cells (Phase 1) to 63 cells (7 roles × 9 resources). Tests pin the BLOCKER-05 (orderBy enforcement) + BLOCKER-07 (effectiveFrom=today) invariants discovered during planning. Tests sit at Wave 8 (after 02-14 blocking push) and are RED until Phase 2 source from 02-04..02-13 merges to this branch.

## Test Counts

| Tier        | Files | Tests | Status                                                                          |
| ----------- | ----- | ----- | ------------------------------------------------------------------------------- |
| Unit        | 5     | 38    | 35 RED (waiting on Phase 2 source); 3 passing (extended log-redact)             |
| Integration | 6     | 30    | RED (no Phase 2 source; testcontainers unavailable locally)                     |
| RLS         | 1     | 3     | RED (waiting on 02-04 RLS policies + 02-14 push)                                |
| E2E         | 1     | 3     | RED (waiting on 02-12/02-13 PhotoUpload + page; no dev server)                  |
| Fixtures    | 3     | n/a   | EICAR builder script + test-avatar builder + README                             |
| **TOTAL**   | 13    | 74    | 81 tests passing in the broader suite (existing Phase 1 + 3 new redact tests)   |

## Assertion-Coverage Table

| Requirement                                  | Test File                                              | Critical Assertion                                                                                                                            |
| -------------------------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| PLAYER-01..07                                | tests/integration/player-router.test.ts                | TD create, parent on-behalf-of, USER-04 cross-academy NOT_FOUND, minor + emergency-contact CHECK constraint, setAgeCategory override          |
| PLAYER-04 (D-37)                             | tests/unit/player-schemas.test.ts                      | playerSelfUpdateInput .strict()-rejects statusCode/academyCode/identity fields; accepts address+contact+emergency whitelist                   |
| TRAINER-01..03                               | tests/integration/trainer-router.test.ts               | TD creates trainer + linkAcademy; trainerSelfUpdateInput rejects diplomaCode; cross-academy trainer.get → NOT_FOUND                           |
| TRAINER-03 (D-37 trainer whitelist)          | tests/unit/trainer-schemas.test.ts                     | Rejects diplomaCode + hasPedagogicalQualification + identity fields                                                                           |
| FILE-01..04                                  | tests/integration/file-upload.test.ts                  | Upload PNG → scan_status=pending; tooLarge BAD_REQUEST; pending → PRECONDITION_FAILED on getSignedUrl; cross-owner NOT_FOUND; UUID/UUID.<ext> |
| VALID-01..06                                 | tests/unit/magic-bytes.test.ts + file-upload.test.ts   | PNG/JPEG accepted, PDF/GIF/random rejected with errors.file.* keys; header-only sniff contract                                                |
| DOM-CAT-01                                   | tests/integration/age-category-history.test.ts         | Two-step history (close old + insert new); getAgeCategoryAt point-in-time; Pitfall 6 race (Promise.allSettled → exactly one open row)         |
| DOM-CAT-02                                   | tests/unit/players-derive-age-category.test.ts         | Bracket math with boundary overlap (sort_order ASC wins); age_unknown fallback                                                                |
| **BLOCKER-05**                               | tests/unit/players-derive-age-category.test.ts         | Stub asserts findMany is called with `orderBy: asc(sortOrder)` — deterministic without ORDER BY                                               |
| **BLOCKER-07**                               | tests/unit/players-derive-age-category.test.ts         | Mock-transaction captures inaugural age_category_history.effective_from; asserts equals TODAY, NOT date-of-birth                              |
| VALID-04 (malware-scan)                      | tests/integration/malware-scan.test.ts                 | enqueueMalwareScan posts {fileId, storageKey} with attempts>=3; processMalwareScan with EICAR flips scan_status='infected'                    |
| USER-04 RLS backstop                         | tests/rls/players-direct-query.test.ts                 | trainer in academy_a sees own players only; orphan trainer sees 0; unbound GUC → 0                                                            |
| I18N-08                                      | tests/unit/player-schemas.test.ts                      | Zod issue messages are i18n keys (`errors.field.required`, `errors.field.belgianPostalCode`, `errors.field.dateInPast`)                       |
| D-36 enumeration safety                      | tests/integration/player-router.test.ts                | Cross-academy get → NOT_FOUND (not FORBIDDEN — protects existence info)                                                                       |
| RBAC matrix (Phase 2 expansion to 49+ cells) | tests/integration/rbac-matrix.test.ts + seed.ts        | 7 roles × 9 resources = 63 cells (>= 49 floor); rawPgAsAppUser probes for players/trainers/uploaded_files/age_category_history                |
| E2E visual states                            | tests/e2e/photo-upload.spec.ts                         | idle → uploading → scanPending → scanClean (happy); EICAR → scanInfected; oversize → client-side rejection                                    |
| OPS-01 PII redaction (Phase 2)               | tests/unit/log-redact-paths.test.ts + log-redact-paths | REDACT_PATHS covers emergency_contact_phone (snake) + emergencyContactPhone/Name (camel)                                                      |

## Commits

| Hash      | Type                     | Description                                                                                                |
| --------- | ------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `23fcea3` | test                     | unit tests (schemas, magic-bytes, age-category math, log-redact-paths extension)                           |
| `c85486e` | test                     | integration tests + RBAC matrix expanded to 49+ cells (tests/helpers/seed.ts updated with new resources)   |
| `353cc3c` | test                     | RLS direct-query for players + Playwright photo-upload e2e + EICAR fixture builder + README + .gitignore   |
| `7f40603` | fix (Rule 2 — deviation) | redact emergency_contact_* PII in pino + Sentry (operational PII would be a GDPR breach if logged)         |
| `81afd7f` | fix (Rule 1 — deviation) | annotate implicit-any in Zod issue callbacks (4 occurrences; tsc strict clean)                             |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 — Missing critical functionality] REDACT_PATHS lacked emergency_contact_* coverage**
- **Found during:** Task 1 verification (running log-redact-paths tests).
- **Issue:** The plan extends `tests/unit/log-redact-paths.test.ts` to assert that `REDACT_PATHS` includes `emergency_contact_phone`, `emergencyContactPhone`, and `emergencyContactName`. These were not yet in `src/lib/log-redact-paths.ts`. Without redaction, a parent's phone number could surface in production logs or Sentry events — a clear GDPR / operational-PII breach.
- **Fix:** Added the six variants (camelCase + snake_case for name/phone/relation) to `REDACT_PATHS` and committed as a Rule 2 fix.
- **Files modified:** `src/lib/log-redact-paths.ts`
- **Commit:** `7f40603`

**2. [Rule 1 — Bug fix] Implicit-any TS errors in Zod issue callbacks**
- **Found during:** post-Task 1 `tsc --noEmit` check.
- **Issue:** Four `(i) => i.message` callbacks in `player-schemas.test.ts` + `trainer-schemas.test.ts` lost their typing because the imported schema is RED (`@/server/trpc/schemas/player` not yet present). `--strict` errored with TS7006.
- **Fix:** Annotated each callback with `(i: { message: string }) => ...` so the test files typecheck independently of when the Phase 2 schema modules merge.
- **Files modified:** `tests/unit/player-schemas.test.ts`, `tests/unit/trainer-schemas.test.ts`
- **Commit:** `81afd7f`

### Known Limitations (NOT deviations — plan-acknowledged)

- **All Phase 2 unit tests RED until source merges.** `@/server/trpc/schemas/player`, `@/server/trpc/schemas/trainer`, `@/server/storage/magic-bytes`, `@/lib/players`, `@/server/workers/jobs/malware-scan` are authored on parallel worktrees (Plans 02-04..02-13) and have not yet merged to this branch. The plan's wave-8 placement explicitly accepts this: "Tests are RED until the Phase 2 implementation lands AND 02-14 push runs."
- **All Phase 2 integration tests RED locally.** Two reasons: (a) Phase 2 source isn't merged here, (b) testcontainers / Docker is unavailable on the developer laptop (per runtime-context note); these tests will run green in CI once 02-14 lands.
- **ClamAV full-pipeline path skipped locally.** No clamd daemon; only the mocked-clamscan path runs (T-02-15-CLAMAV-UNAVAILABLE mitigation honoured). CI runs the full version.
- **Playwright e2e RED locally.** No dev server, no Phase 2 page (`/players/new`), no PhotoUpload component, no test-auth route. Runs in CI after 02-12 + 02-13 ship.

## Threat Flags

None — no new security surface introduced by tests themselves. The EICAR-fixture risk (`T-02-15-FIXTURE-LEAK`) is fully mitigated per the plan's threat register: fixture is **built at test setup**, not committed (.gitignore enforces).

## Test Suite Outcome

Final invocation `npm test`:

```
Test Files  28 failed | 15 passed (43)
     Tests  88 failed | 81 passed | 99 skipped (268)
   Duration  ~97s
```

- **81 passing**: well above the 30-passing floor set by the runtime-context note. Includes the Phase 1 baseline + 3 new Phase 2 log-redact tests (after Rule 2 fix).
- **88 failing**: split across Phase 2 modules-not-yet-merged (35 tests directly authored by this plan; 53 pre-existing in lookup-codes/medical-schema/timestamps/lockout etc. — confirmed via `git stash` baseline run).
- **99 skipped**: includes 1 explicit `it.skip` from Task 3 (ClamAV full pipeline) + Phase 1 skips for Redis/upstash.

The Phase 2 test artefacts compile cleanly (`tsc --noEmit` only emits TS2307 "module not found" for not-yet-merged Phase 2 sources — no syntax, type, or structural errors in the test files themselves).

## Self-Check: PASSED

- [x] tests/unit/player-schemas.test.ts FOUND
- [x] tests/unit/trainer-schemas.test.ts FOUND
- [x] tests/unit/magic-bytes.test.ts FOUND
- [x] tests/unit/players-derive-age-category.test.ts FOUND (with BLOCKER-05 + BLOCKER-07 assertions)
- [x] tests/integration/player-router.test.ts FOUND
- [x] tests/integration/trainer-router.test.ts FOUND
- [x] tests/integration/file-upload.test.ts FOUND
- [x] tests/integration/age-category-history.test.ts FOUND (Promise.allSettled race test present)
- [x] tests/integration/malware-scan.test.ts FOUND (9 EICAR references)
- [x] tests/integration/rbac-matrix.test.ts modified (>=49 cell assertion; new probes for 4 Phase 2 resources)
- [x] tests/rls/players-direct-query.test.ts FOUND (uses app.user_role binding)
- [x] tests/e2e/photo-upload.spec.ts FOUND (scanInfected + EICAR fixture references)
- [x] tests/fixtures/README.md + build-eicar-png.ts + build-test-avatar.ts FOUND
- [x] tests/unit/log-redact-paths.test.ts extended with Phase 2 PII assertions
- [x] Commit `23fcea3` FOUND (Task 1)
- [x] Commit `c85486e` FOUND (Task 2)
- [x] Commit `353cc3c` FOUND (Task 3)
- [x] Commit `7f40603` FOUND (Rule 2 deviation)
- [x] Commit `81afd7f` FOUND (Rule 1 deviation)
