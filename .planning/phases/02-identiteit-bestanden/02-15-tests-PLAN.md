---
phase: 02-identiteit-bestanden
plan_id: 02-15-tests
plan: 15
type: execute
wave: 8
depends_on: [02-14-blocking-schema-push]
files_modified:
  - tests/unit/player-schemas.test.ts
  - tests/unit/trainer-schemas.test.ts
  - tests/unit/magic-bytes.test.ts
  - tests/unit/players-derive-age-category.test.ts
  - tests/unit/log-redact-paths.test.ts
  - tests/integration/player-router.test.ts
  - tests/integration/trainer-router.test.ts
  - tests/integration/file-upload.test.ts
  - tests/integration/age-category-history.test.ts
  - tests/integration/malware-scan.test.ts
  - tests/integration/rbac-matrix.test.ts
  - tests/rls/players-direct-query.test.ts
  - tests/e2e/photo-upload.spec.ts
autonomous: true
requirements:
  - PLAYER-01
  - PLAYER-04
  - PLAYER-05
  - PLAYER-06
  - PLAYER-07
  - TRAINER-03
  - FILE-01
  - FILE-04
  - VALID-01
  - VALID-02
  - VALID-03
  - VALID-04
  - VALID-05
  - VALID-06
  - DOM-CAT-01
  - DOM-CAT-02
  - USER-04
  - I18N-08

must_haves:
  truths:
    - "Unit: tests/unit/player-schemas.test.ts asserts .strict() rejection of statusCode in playerSelfUpdateInput (T-02-07-FIELD-SMUGGLING) + zod messages are i18n keys (I18N-08)"
    - "Unit: tests/unit/magic-bytes.test.ts covers PDF-renamed-as-JPG case + GIF rejection (VALID-02, VALID-03)"
    - "Unit: tests/unit/players-derive-age-category.test.ts covers boundary cases + age_unknown fallback (DOM-CAT-02)"
    - "Unit: tests/unit/log-redact-paths.test.ts extended to cover emergency_contact_phone redaction"
    - "Integration: tests/integration/player-router.test.ts covers PLAYER-01..07 + cross-academy 404 (D-36)"
    - "Integration: tests/integration/file-upload.test.ts covers FILE-01..04 + signed-URL refusal on pending/infected"
    - "Integration: tests/integration/age-category-history.test.ts covers parallel setAgeCategory race (Pitfall 6)"
    - "Integration: tests/integration/malware-scan.test.ts uses EICAR test buffer to verify infected path (VALID-04)"
    - "RBAC matrix: tests/integration/rbac-matrix.test.ts expanded from 7×5=35 to 7×7=49 cells, covering players + trainers + uploaded_files"
    - "RLS: tests/rls/players-direct-query.test.ts verifies wrong-academy trainer (direct DB) returns 0 rows (USER-04)"
    - "E2E: tests/e2e/photo-upload.spec.ts walks the visual states (idle → uploading → pending → clean) using EICAR fixture for infected branch"
  artifacts:
    - path: "tests/unit/players-derive-age-category.test.ts"
      provides: "Unit test for DOM-CAT-02 lookup math"
      contains: "deriveAgeCategory"
    - path: "tests/integration/player-router.test.ts"
      provides: "RBAC + RLS integration test for player.*"
      contains: "trainer sees only own-academy"
    - path: "tests/integration/rbac-matrix.test.ts"
      provides: "expanded RBAC matrix (7×7)"
      contains: "uploaded_files"
    - path: "tests/rls/players-direct-query.test.ts"
      provides: "Direct DB RLS test (USER-04)"
      contains: "wrong academy"
    - path: "tests/e2e/photo-upload.spec.ts"
      provides: "Playwright visual state walk"
      contains: "scanPending"
  key_links:
    - from: "tests/integration/*.test.ts"
      to: "tests/helpers/seed.ts (Phase 1)"
      via: "RBAC_EXPECTATIONS fixture + seed helpers"
      pattern: "seedTestUser\\|RBAC_EXPECTATIONS"
---

<objective>
Ship the test suite that converts Phase 2 from "compiles" to "verifiably correct". Test pyramid:

- **Unit (5 files)**: schema validation, magic-bytes, age-category math, log redaction — fast, no testcontainers.
- **Integration (5 files)**: tRPC router behaviors against testcontainers Postgres + Phase-1-seeded fixtures.
- **RBAC matrix expansion (1 file modified)**: from 7×5 = 35 cells to 7×7 = 49 cells, adding `players`, `trainers`, `uploaded_files`, `age_category_history` resources.
- **RLS direct-query (1 file)**: bypass tRPC, run as `app_user` Postgres role, verify wrong-academy trainer sees 0 player rows.
- **E2E (1 file)**: Playwright walks the PhotoUpload state machine using an EICAR-test fixture for the infected branch.

Wave placement: this plan sits at wave 8, AFTER the blocking schema push in 02-14, because every integration test requires the four new tables to exist in dev/staging Supabase. Tests are written as regression coverage against the already-implemented surface (02-09..02-13). (Earlier drafts referred to a "Wave-0 RED-on-day-one" strategy where empty test files would be authored before implementations; that strategy was dropped during planning because the integration tests cannot meaningfully run before the migrations are applied. The unit tests COULD have been written earlier, but the cohesion benefit of keeping all Phase 2 tests in one plan outweighs the lost RED-cycle signal.)

Output: 13 test files (10 new, 3 modified).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/phases/02-identiteit-bestanden/02-CONTEXT.md
@.planning/phases/02-identiteit-bestanden/02-RESEARCH.md
@.planning/phases/02-identiteit-bestanden/02-07-trpc-schemas-PLAN.md
@tests/integration/parent-child.test.ts
@tests/rls/medical-isolation.test.ts
@tests/helpers/seed.ts
@vitest.config.ts
@playwright.config.ts
@CLAUDE.md

<interfaces>
<!-- Phase 1 test infrastructure -->

```typescript
// tests/helpers/seed.ts (Phase 1)
export async function seedTestUser(role: Role, opts?: {...}): Promise<{userId, sessionToken, ...}>;
export const RBAC_EXPECTATIONS: Record<Role, Record<Resource, Outcome>>;

// testcontainers @testcontainers/postgresql — Phase 1 already in package.json
// EICAR test buffer (industry standard — public-domain signature):
const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="false">
  <name>Task 1: 5 unit test files (schemas + magic-bytes + age-category + log redact)</name>
  <read_first>
    - tests/unit/lookup-codes.test.ts (Phase 1 — sample unit test against Drizzle schema modules)
    - tests/unit/log-redact-paths.test.ts (Phase 1 — current shape; we EXTEND)
    - src/server/trpc/schemas/player.ts + trainer.ts + file.ts (02-07)
    - src/lib/players.ts (02-04)
    - src/server/storage/magic-bytes.ts (02-04)
  </read_first>
  <files>
    tests/unit/player-schemas.test.ts
    tests/unit/trainer-schemas.test.ts
    tests/unit/magic-bytes.test.ts
    tests/unit/players-derive-age-category.test.ts
    tests/unit/log-redact-paths.test.ts
  </files>
  <action>
    **`tests/unit/player-schemas.test.ts`** (new):

    ```typescript
    import { describe, it, expect } from 'vitest';
    import {
      playerCreateInput,
      playerSelfUpdateInput,
      playerSetAgeCategoryInput,
    } from '@/server/trpc/schemas/player';

    describe('playerSelfUpdateInput — D-37 field whitelist (T-02-07-FIELD-SMUGGLING)', () => {
      it('rejects statusCode (TD-only field)', () => {
        const result = playerSelfUpdateInput.safeParse({
          street: 'X', postalCode: '2000', city: 'Y', province: 'Z',
          statusCode: 'status_a',
        });
        expect(result.success).toBe(false);
      });

      it('rejects academyCode', () => {
        const result = playerSelfUpdateInput.safeParse({
          street: 'X', postalCode: '2000', city: 'Y', province: 'Z',
          academyCode: 'topsportschool',
        });
        expect(result.success).toBe(false);
      });

      it('rejects firstName / lastName / dateOfBirth / gender / school / club', () => {
        for (const field of ['firstName', 'lastName', 'dateOfBirth', 'gender', 'school', 'club']) {
          const result = playerSelfUpdateInput.safeParse({
            street: 'X', postalCode: '2000', city: 'Y', province: 'Z',
            [field]: 'whatever',
          });
          expect(result.success, `${field} should be rejected`).toBe(false);
        }
      });

      it('accepts the D-37 whitelist (street, postalCode, city, province, country, phone, email, emergency*)', () => {
        const result = playerSelfUpdateInput.safeParse({
          street: 'X', streetNumber: '1', postalCode: '2000',
          city: 'Y', province: 'Z', country: 'BE',
          phone: '+32 1234',  email: 'a@b.com',
          emergencyContactName: 'EC', emergencyContactPhone: '+32 9876',
          emergencyContactRelation: 'Parent',
        });
        expect(result.success).toBe(true);
      });
    });

    describe('playerCreateInput — Zod messages are i18n keys (I18N-08)', () => {
      it('emits errors.field.required for missing firstName', () => {
        const result = playerCreateInput.safeParse({});
        expect(result.success).toBe(false);
        if (!result.success) {
          const messages = result.error.issues.map((i) => i.message);
          // At least one message must be the canonical key.
          expect(messages).toContain('errors.field.required');
        }
      });

      it('emits errors.field.belgianPostalCode for non-4-digit postal codes', () => {
        const result = playerCreateInput.safeParse({
          userId: '00000000-0000-0000-0000-000000000000',
          firstName: 'A', lastName: 'B',
          dateOfBirth: '2010-01-01', gender: 'male',
          street: 'X', postalCode: 'NOT4DIGITS', city: 'Y', province: 'Z',
          statusCode: 'status_a', academyCode: 'topsportschool',
        });
        expect(result.success).toBe(false);
        if (!result.success) {
          const messages = result.error.issues.map((i) => i.message);
          expect(messages).toContain('errors.field.belgianPostalCode');
        }
      });

      it('emits errors.field.dateInPast for future DOB', () => {
        const future = new Date(Date.now() + 365 * 86400 * 1000).toISOString();
        const result = playerCreateInput.safeParse({
          userId: '00000000-0000-0000-0000-000000000000',
          firstName: 'A', lastName: 'B',
          dateOfBirth: future, gender: 'male',
          street: 'X', postalCode: '2000', city: 'Y', province: 'Z',
          statusCode: 'status_a', academyCode: 'topsportschool',
        });
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues.some((i) => i.message === 'errors.field.dateInPast')).toBe(true);
        }
      });
    });

    describe('playerSetAgeCategoryInput', () => {
      it('accepts a valid payload', () => {
        const result = playerSetAgeCategoryInput.safeParse({
          playerId: '00000000-0000-0000-0000-000000000000',
          ageCategoryCode: 'age_minor',
          categoryYear: 2026,
          effectiveFrom: '2026-01-01',
        });
        expect(result.success).toBe(true);
      });
    });
    ```

    **`tests/unit/trainer-schemas.test.ts`** (mirror player-schemas — assert `trainerSelfUpdateInput` rejects `diplomaCode` + `hasPedagogicalQualification`).

    **`tests/unit/magic-bytes.test.ts`** (new):
    ```typescript
    import { describe, it, expect } from 'vitest';
    import { validateUploadMagicBytes } from '@/server/storage/magic-bytes';

    // Minimal valid PNG header (8 bytes signature + IHDR).
    const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    // Minimal valid JPEG SOI marker.
    const JPEG_SIG = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    // Minimal valid PDF header (rejected for profiles bucket).
    const PDF_SIG = Buffer.from('%PDF-1.4\n', 'ascii');
    // GIF header (rejected for profiles bucket).
    const GIF_SIG = Buffer.from('GIF89a', 'ascii');

    describe('validateUploadMagicBytes — profiles bucket', () => {
      it('accepts PNG (VALID-02)', async () => {
        const { ext, mime } = await validateUploadMagicBytes(PNG_SIG, 'profiles');
        expect(ext).toBe('png');
        expect(mime).toBe('image/png');
      });

      it('accepts JPEG', async () => {
        const { ext, mime } = await validateUploadMagicBytes(JPEG_SIG, 'profiles');
        expect(ext).toBe('jpg');
        expect(mime).toBe('image/jpeg');
      });

      it('rejects PDF disguised in profiles bucket (VALID-03)', async () => {
        await expect(validateUploadMagicBytes(PDF_SIG, 'profiles')).rejects.toMatchObject({
          code: 'BAD_REQUEST',
          message: 'errors.file.disallowedType',
        });
      });

      it('rejects GIF in profiles bucket', async () => {
        await expect(validateUploadMagicBytes(GIF_SIG, 'profiles')).rejects.toMatchObject({
          code: 'BAD_REQUEST',
          message: 'errors.file.disallowedType',
        });
      });

      it('rejects random bytes (file-type returns undefined)', async () => {
        await expect(
          validateUploadMagicBytes(Buffer.from('random'), 'profiles'),
        ).rejects.toMatchObject({ code: 'BAD_REQUEST', message: 'errors.file.unknownType' });
      });
    });
    ```

    **`tests/unit/players-derive-age-category.test.ts`** (new):
    ```typescript
    import { describe, it, expect, beforeAll } from 'vitest';
    import { deriveAgeCategory, getAgeCategoryAt } from '@/lib/players';
    // Note: this test uses the seeded DB from testcontainers (Phase 1 vitest setup
    // spins one up). For pure-math testing we override the dbHandle.

    describe('deriveAgeCategory — DOM-CAT-02 lookup math', () => {
      // Use a stubbed handle that returns synthetic age_categories rows.
      const stubDb = {
        query: {
          ageCategories: {
            findMany: async () => [
              { code: 'age_pre_minor', sortOrder: 1, bornAfterOrEqual: 2014, bornBeforeOrEqual: 2016, active: true },
              { code: 'age_minor',     sortOrder: 2, bornAfterOrEqual: 2012, bornBeforeOrEqual: 2014, active: true },
              { code: 'age_senior',    sortOrder: 5, bornAfterOrEqual: 1962, bornBeforeOrEqual: 2007, active: true },
              { code: 'age_unknown',   sortOrder: 99, bornAfterOrEqual: null, bornBeforeOrEqual: null, active: true },
            ],
          },
        },
      } as never;

      it('returns age_minor for birth year 2013 (inclusive lower)', async () => {
        const r = await deriveAgeCategory(new Date('2013-06-15'), new Date('2026-05-01'), stubDb);
        expect(r.code).toBe('age_minor');
        expect(r.year).toBe(2026);
      });

      it('returns age_pre_minor for birth year 2014 — boundary belongs to LOWER bracket (sort order 1)', async () => {
        // 2014 is in both age_pre_minor [2014, 2016] AND age_minor [2012, 2014] —
        // the iteration order returns the FIRST match, which by sort_order ASC is
        // age_pre_minor. This is the documented semantic.
        const r = await deriveAgeCategory(new Date('2014-12-31'), new Date('2026-05-01'), stubDb);
        expect(r.code).toBe('age_pre_minor');
      });

      it('returns age_unknown when no bracket matches', async () => {
        // Birth year 1950 — outside all defined brackets.
        const r = await deriveAgeCategory(new Date('1950-01-01'), new Date('2026-05-01'), stubDb);
        expect(r.code).toBe('age_unknown');
      });

      it('returns age_minor (not age_unknown) when boundaries are NULL but sort_order favours age_minor', async () => {
        // BLOCKER-05 verification: the helper passes `orderBy: asc(sortOrder)` to
        // findMany. The stub must mimic that — return rows pre-sorted by
        // sortOrder ASC. With sortOrder: age_minor=2 < age_unknown=99,
        // age_minor is evaluated first; both rows have NULL boundaries so
        // both match the predicate; first-match wins → age_minor.
        //
        // Why this matters: without orderBy, Postgres returns rows in
        // arbitrary order — the helper could return age_unknown even when
        // age_minor fits. The test fails (assertion is .toBe('age_minor'))
        // if 02-04 ever drops the orderBy clause.
        const stubNullDb = {
          query: {
            ageCategories: {
              findMany: async (opts: { orderBy?: unknown }) => {
                // The stub asserts orderBy is requested by the helper.
                if (!opts.orderBy) {
                  throw new Error(
                    'deriveAgeCategory must call findMany with `orderBy: asc(sortOrder)` ' +
                    '(BLOCKER-05 — non-deterministic without ORDER BY)',
                  );
                }
                return [
                  { code: 'age_minor',   sortOrder: 2,  bornAfterOrEqual: null, bornBeforeOrEqual: null, active: true },
                  { code: 'age_unknown', sortOrder: 99, bornAfterOrEqual: null, bornBeforeOrEqual: null, active: true },
                ];
              },
            },
          },
        } as never;
        const r = await deriveAgeCategory(new Date('2010-01-01'), new Date('2026-05-01'), stubNullDb);
        expect(r.code).toBe('age_minor');  // BLOCKER-05 — deterministic
      });
    });

    describe('player.create inaugural age_category_history row — BLOCKER-07', () => {
      it('writes effective_from = TODAY (player creation date), NOT date-of-birth', async () => {
        // Set up a stubbed transaction that records what was inserted into
        // ageCategoryHistory. The assertion is that effective_from equals
        // the freeze-frame "now" we passed into player.create, not the DOB
        // we supplied as input.
        //
        // Why: DOM-CAT-02 says getAgeCategoryAt(playerId, tournament_date)
        // returns the category that was in effect on that date. If the
        // inaugural row claims effective_from = DOB (e.g. 2010-06-15), a
        // tournament held in 2014 would return today's category — wrong.
        // effective_from = creation date means tournament queries before
        // creation return null (correct: no platform record back then).
        const dob = new Date('2010-06-15');
        const freezeNow = new Date('2026-05-12T10:00:00Z');

        const insertedHistoryRows: Array<{ effectiveFrom: string; playerId: string }> = [];
        // ... transaction stub captures insertedHistoryRows ...
        // ... call player.create(...) with input.dateOfBirth=dob, time-frozen now=freezeNow ...

        expect(insertedHistoryRows).toHaveLength(1);
        expect(insertedHistoryRows[0]!.effectiveFrom).toBe('2026-05-12');   // today
        expect(insertedHistoryRows[0]!.effectiveFrom).not.toBe('2010-06-15'); // NOT dob
      });
    });
    ```

    **`tests/unit/log-redact-paths.test.ts`** (EXTEND existing):
    - Append new test cases asserting that pino's redact filter drops `emergencyContactPhone`, `emergencyContactName`, and snake_case variants
    - Use the existing test setup (Phase 1 already imports `REDACT_PATHS`)

    All unit tests run in <10s total against vitest.
  </action>
  <verify>
    <automated>for f in tests/unit/player-schemas.test.ts tests/unit/trainer-schemas.test.ts tests/unit/magic-bytes.test.ts tests/unit/players-derive-age-category.test.ts; do test -f "$f" || { echo "missing: $f"; exit 1; }; done && grep -q "emergency_contact_phone\|emergencyContactPhone" tests/unit/log-redact-paths.test.ts && pnpm test -- --run tests/unit/player-schemas 2>&1 | tail -10 | grep -qE "Test Files +1 passed" && pnpm test -- --run tests/unit/magic-bytes 2>&1 | tail -10 | grep -qE "Test Files +1 passed"</automated>
  </verify>
  <acceptance_criteria>
    - 4 new unit test files + 1 extended unit test
    - `pnpm test -- --run tests/unit/` exits 0 (with the 4 new files passing)
  </acceptance_criteria>
  <done>Unit-level coverage for schema validation, magic-bytes, age-category math, log redaction.</done>
</task>

<task type="auto" tdd="false">
  <name>Task 2: 5 integration test files (router/file-upload/age-history/malware/RBAC)</name>
  <read_first>
    - tests/integration/parent-child.test.ts (Phase 1 — pattern for tRPC integration with seeded users)
    - tests/integration/trainer-academy.test.ts (Phase 1 — academy_memberships seed pattern)
    - tests/helpers/seed.ts
    - .planning/phases/02-identiteit-bestanden/02-RESEARCH.md §Validation Architecture
  </read_first>
  <files>
    tests/integration/player-router.test.ts
    tests/integration/trainer-router.test.ts
    tests/integration/file-upload.test.ts
    tests/integration/age-category-history.test.ts
    tests/integration/malware-scan.test.ts
    tests/integration/rbac-matrix.test.ts
  </files>
  <action>
    All integration tests use the Phase 1 testcontainers Postgres + seeded users. Each file covers a focused area.

    **`tests/integration/player-router.test.ts`**: cover PLAYER-01..07, USER-04 trainer scope, D-36 enumeration, D-37 self-update whitelist. Cases:
    - TD creates a player → row exists with derived age_category + inaugural age_category_history row + isMinor computed
    - Player creates own with self-update → succeeds for whitelist fields; rejected with BAD_REQUEST for `statusCode`
    - Trainer in academy A tries player.get on player in academy B → NOT_FOUND (not FORBIDDEN — D-36)
    - Trainer in same academy as player → can READ but NOT update (D-37 — trainer.update_self only)
    - Parent of minor → can update on behalf via `playerOnBehalfOfInput`
    - Parent of A tries to update player B → NOT_FOUND
    - Creating a minor without emergency contact → CHECK constraint rejection (BAD_REQUEST with constraint name)

    **`tests/integration/trainer-router.test.ts`**: cover TRAINER-01..03. Cases:
    - TD creates trainer → row + linkAcademy via existing `admin.user.linkAcademy`
    - Trainer self-update succeeds for whitelist; rejected for `diplomaCode`
    - Trainer A in academy_x tries trainer.get on Trainer B in academy_y → NOT_FOUND (different academies); same academy → row visible
    - TD can update any trainer

    **`tests/integration/file-upload.test.ts`**: cover FILE-01..04, VALID-01..06. Cases:
    - Upload valid 1 KB PNG → row inserted with scan_status='pending' + storage object exists
    - Upload >2MB → BAD_REQUEST `errors.file.tooLarge`
    - Upload PDF claiming `image/jpeg` MIME → BAD_REQUEST `errors.file.disallowedType` (magic-bytes mismatch)
    - Upload GIF → BAD_REQUEST
    - getSignedUrl for `pending` file → PRECONDITION_FAILED `errors.file.scanNotClean`
    - getSignedUrl for `clean` file → returns URL with TTL ≤ 1h
    - getSignedUrl for cross-scope (different owner) → NOT_FOUND
    - storage_key uses UUID format (matches `^[uuid]/[uuid].(png|jpg)$`)
    - Direct fetch of bucket URL `https://[supabase]/storage/v1/object/profiles/...` without signature → 403

    **`tests/integration/age-category-history.test.ts`**: cover DOM-CAT-01 + Pitfall 6 race. Cases:
    - Single setAgeCategory call → closes old row (effective_to set) + inserts new row
    - getAgeCategoryAt for date BEFORE first effective_from → null
    - getAgeCategoryAt for date INSIDE first interval → returns first code
    - getAgeCategoryAt for date INSIDE second interval → returns second code
    - **Parallel race test**: two concurrent setAgeCategory calls with `Promise.all` → exactly one row ends up with `effective_to IS NULL` (SERIALIZABLE prevents dueling currents)

    **`tests/integration/malware-scan.test.ts`**: cover VALID-04. Strategy choice (from RESEARCH §Wave 0 Gaps line 1227):
    - If testcontainer ClamAV available (CI): full pipeline — enqueue scan with EICAR test buffer → assert scan_status flips to 'infected'
    - If no ClamAV available locally: mock the queue producer; verify `malwareScanQueue.add` was called with the expected payload AND directly invoke `processMalwareScan` with mocked clamscan client to assert the DB update.

    Use Phase 1 `worker-template.test.ts` pattern for the queue-mock approach.

    **`tests/integration/rbac-matrix.test.ts`** (MODIFY existing Phase 1 file):
    - Expand `RBAC_EXPECTATIONS` constant from 7 roles × 5 resources (Phase 1: users, consent_records, medical_events, audit_log, parent_child_links) to 7 × 7 (add `players`, `trainers`, `uploaded_files`, `age_category_history` — minus 2 that are merged in: keep `audit_log`/`parent_child_links` + add 4 new + keep `users`/`consent_records`/`medical_events` = 7 resources total) — count check below clarifies.
    - 7 roles × 7 resources × 1 read probe = 49 cells (per CONTEXT.md `<downstream_consumer>` note)
    - Each cell asserts: `(role, resource) → expected outcome (200/403/404)`
    - For `players` resource: TD/medical_staff → 200 (any); trainer/academy_manager → 200 if scope match else 404; player → 200 own / 404 others; parent → 200 child / 404 others; sparring → 404 always
    - For `trainers` resource: similar shape
    - For `uploaded_files` resource: 200 if owner or TD, else 404
    - For `age_category_history` resource: tracks parent (players) visibility — same as `players` shape

    Adjust the existing RBAC_EXPECTATIONS map to include the new resource columns and 7 × new = 28 additional cells; verify the test loops over `Object.entries(RBAC_EXPECTATIONS)` so adding rows/cols auto-expands the coverage.
  </action>
  <verify>
    <automated>for f in tests/integration/player-router.test.ts tests/integration/trainer-router.test.ts tests/integration/file-upload.test.ts tests/integration/age-category-history.test.ts tests/integration/malware-scan.test.ts; do test -f "$f" || { echo "missing: $f"; exit 1; }; done && test -f tests/integration/rbac-matrix.test.ts && grep -q "players\|uploaded_files" tests/integration/rbac-matrix.test.ts && grep -q "Promise.all" tests/integration/age-category-history.test.ts && grep -q "EICAR" tests/integration/malware-scan.test.ts && pnpm test -- --run tests/integration/player-router 2>&1 | tail -10 | grep -qE "Test Files +1 (passed|failed)"</automated>
  </verify>
  <acceptance_criteria>
    - 5 new integration tests + 1 modified RBAC matrix
    - RBAC matrix has ≥ 49 cells
    - Age-category-history test fires parallel calls and asserts single open row
    - Malware-scan test uses EICAR buffer (either real or mocked clamscan)
    - `pnpm test -- --run tests/integration/` exits 0
  </acceptance_criteria>
  <done>Integration coverage for every router + the file pipeline.</done>
</task>

<task type="auto" tdd="false">
  <name>Task 3: RLS direct-query test + Playwright photo-upload e2e</name>
  <read_first>
    - tests/rls/direct-query.test.ts (Phase 1 — pattern for app_user connection + GUC binding)
    - tests/rls/medical-isolation.test.ts (Phase 1 — RLS test against medical_events)
    - tests/e2e (Phase 1 e2e specs — Playwright config)
    - .planning/phases/02-identiteit-bestanden/02-UI-SPEC.md §Photo Upload Widget (visual states)
  </read_first>
  <files>
    tests/rls/players-direct-query.test.ts
    tests/e2e/photo-upload.spec.ts
  </files>
  <action>
    **`tests/rls/players-direct-query.test.ts`** (new): direct-DB RLS test (bypass tRPC).
    ```typescript
    /**
     * RLS backstop for USER-04: a trainer connected directly as `app_user`
     * with their UUID + role bound into app.user_id/app.user_role GUCs
     * cannot see players in other academies, even via raw SQL.
     */
    import { describe, it, expect, beforeAll } from 'vitest';
    import postgres from 'postgres';

    // Use Phase 1's testcontainer wiring helpers.
    let sql: ReturnType<typeof postgres>;

    beforeAll(async () => {
      // Connect as app_user (NOT the migration owner). Phase 1's test bootstrap
      // exposes `APP_USER_DSN` via testcontainers.
      sql = postgres(process.env.APP_USER_DSN!);
      // Seed: 2 academies, 1 trainer in academy_a, 2 players (one per academy).
      await seedTrainerInAcademyA(); // helper from tests/helpers/seed.ts (extend in Phase 2)
    });

    describe('USER-04 RLS — direct DB query as trainer', () => {
      it('returns only academy_a players when trainer is in academy_a', async () => {
        const trainerId = '<known fixture id>';
        const rows = await sql`
          SET LOCAL app.user_id = ${trainerId};
          SET LOCAL app.user_role = 'trainer';
          SELECT user_id, academy_code FROM players ORDER BY user_id;
        `;
        expect(rows.length).toBe(1);
        expect(rows[0]!.academyCode).toBe('academy_antwerpen');  // or whichever seed used
      });

      it('returns 0 rows when no academy membership matches', async () => {
        const orphanTrainerId = '<known fixture id>';
        const rows = await sql`
          SET LOCAL app.user_id = ${orphanTrainerId};
          SET LOCAL app.user_role = 'trainer';
          SELECT count(*)::int AS cnt FROM players;
        `;
        expect(rows[0]!.cnt).toBe(0);
      });
    });
    ```

    **`tests/e2e/photo-upload.spec.ts`** (new): Playwright visual state walk.
    ```typescript
    import { test, expect } from '@playwright/test';
    import path from 'node:path';

    test('photo upload — happy path (idle → uploading → pending → clean)', async ({ page }) => {
      // Phase 1 e2e auth helper logs in as TD and lands on /players/new.
      await loginAsTd(page);
      await page.goto('/nl/players/new');

      const uploadButton = page.getByRole('button', { name: /sleep een foto|drag a photo/i });
      await expect(uploadButton).toBeVisible();

      // Use a fixture PNG (under 2 MB).
      const filePath = path.resolve(__dirname, 'fixtures/test-avatar.png');
      await page.setInputFiles('input[type=file]', filePath);

      // Uploading state.
      await expect(page.getByText(/Bezig met uploaden|Uploading/)).toBeVisible({ timeout: 5_000 });

      // Pending scan state.
      await expect(page.getByText(/Foto wordt gescand|Scanning photo/)).toBeVisible({ timeout: 10_000 });

      // Clean state — toast appears.
      await expect(page.getByText(/Foto opgeslagen|Photo saved/)).toBeVisible({ timeout: 30_000 });
    });

    test('photo upload — infected branch with EICAR fixture', async ({ page }) => {
      await loginAsTd(page);
      await page.goto('/nl/players/new');

      // EICAR-as-PNG fixture (the bytes pass magic-bytes as PNG because the file
      // STARTS with PNG signature but contains the EICAR sequence later — built
      // by tests/fixtures/build-eicar-png.ts ahead of the test run).
      const filePath = path.resolve(__dirname, 'fixtures/eicar.png');
      await page.setInputFiles('input[type=file]', filePath);
      await expect(page.getByText(/afgekeurd|rejected/)).toBeVisible({ timeout: 30_000 });
    });
    ```

    Note: the EICAR-as-PNG fixture requires the test to ship the bytes. Phase 1's `tests/fixtures/` already exists. The fixture-builder script generates the file deterministically.

    Tests are RED until the Phase 2 implementation lands AND 02-14 push runs.
  </action>
  <verify>
    <automated>test -f tests/rls/players-direct-query.test.ts && test -f tests/e2e/photo-upload.spec.ts && grep -q "app.user_role.*trainer" tests/rls/players-direct-query.test.ts && grep -q "scanInfected\|afgekeurd\|rejected" tests/e2e/photo-upload.spec.ts && grep -q "EICAR\|eicar" tests/e2e/photo-upload.spec.ts</automated>
  </verify>
  <acceptance_criteria>
    - RLS direct-query test asserts trainer sees only own-academy players + 0 when no membership
    - E2E test walks the 4 happy-path states + the infected branch
    - Test files compile under vitest / playwright
  </acceptance_criteria>
  <done>RLS backstop + visual e2e proof.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Test data ↔ production safety | Tests run against testcontainers / dev Supabase; never production |
| EICAR fixture ↔ AV scanners | EICAR is the industry-standard non-malicious AV test string — safe to commit |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-02-15-FLAKY-RACE | Repudiation | Parallel setAgeCategory test occasionally passes on race | mitigate | Wrap in a 100-iteration loop in CI; if any iteration fails the test fails |
| T-02-15-CLAMAV-UNAVAILABLE | Availability | Test env lacks ClamAV daemon → false PASS | mitigate | Mock clamscan client in unit-level path; conditionally skip the full-pipeline integration if no daemon detected; CI ALWAYS runs the full version |
| T-02-15-FIXTURE-LEAK | Information Disclosure | EICAR fixture mistakenly committed as actual malicious binary | accept | EICAR is the standard AV-test string with no malicious payload; documented in `tests/fixtures/README.md` (created by this plan) |
</threat_model>

<verification>
- `pnpm test` exits 0 against the full Phase 2 suite
- `pnpm test:e2e tests/e2e/photo-upload.spec.ts` exits 0
- RBAC matrix has 49 cells
- All canonical i18n keys asserted in tests match the strings in 02-11
</verification>

<success_criteria>
- 13 test files (10 new, 3 modified)
- Schema validation + magic-bytes + age-category math covered at unit level
- All Phase 2 RBAC + RLS scenarios covered at integration level
- RLS backstop verifies USER-04 at DB level
- Visual state machine walked by Playwright
</success_criteria>

<output>
After completion, create `.planning/phases/02-identiteit-bestanden/02-15-SUMMARY.md` listing test counts (5 unit + 5 integration + 1 RLS + 1 e2e + RBAC expansion) and a brief assertion-coverage table.
</output>
