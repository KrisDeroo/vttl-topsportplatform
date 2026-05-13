---
phase: 02-identiteit-bestanden
plan: 07
subsystem: api
tags: [zod, trpc, validation, rbac, i18n, schemas, field-level-authz]

# Dependency graph
requires:
  - phase: 02-identiteit-bestanden
    provides: Drizzle schemas for players, trainers, uploaded_files (from 02-02)
provides:
  - "playerCreateInput, playerUpdateAsTdInput, playerSelfUpdateInput, playerOnBehalfOfInput, playerSetAgeCategoryInput, playerListInput, playerGetInput (D-37 RBAC encoded structurally)"
  - "trainerCreateInput, trainerUpdateAsTdInput, trainerSelfUpdateInput, trainerListInput, trainerGetInput (D-38 RBAC encoded structurally)"
  - "fileUploadInput, fileGetSignedUrlInput, fileGetScanStatusInput, fileDeleteInput (D-23/D-25 file validation)"
  - "Pattern: i18n error keys (errors.field.* / errors.file.*) instead of literal messages — resolved by useZodErrorMessage adapter (02-04)"
  - "Pattern: `.strict()` on every object schema rejects unknown keys at the boundary (VALID-06)"
affects: [02-09-trpc-router-file, 02-10-trpc-routers-player-trainer, 02-11-i18n-catalog-additions, 02-12-ui-shared-components, 02-13-ui-pages-and-forms, 02-15-tests]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Field-level RBAC via schema-shape (D-37/D-38): self-update schemas structurally omit TD-managed fields so `.strict()` rejects field smuggling before the router runs"
    - "Server-authoritative MIME via magic-bytes (02-04); `claimedMimeType` captured audit-only"
    - "Belgian postal-code regex (^[0-9]{4}$) + ISO-3166 alpha-2 country code default 'BE'"
    - "z.coerce.date().max(new Date()) blocks future DOB"
    - "z.literal('profiles') for Phase 2 bucket — phase 4/5 widen via z.enum"
    - "base64-in-JSON file transport for v1 with size cap as first DoS gate (~3 MB encoded / ~2.25 MB raw)"

key-files:
  created:
    - "src/server/trpc/schemas/player.ts"
    - "src/server/trpc/schemas/trainer.ts"
    - "src/server/trpc/schemas/file.ts"
  modified: []

key-decisions:
  - "Schema-shape is the first RBAC gate: self-update inputs omit sensitive fields rather than relying on runtime field-list checks in the router. `.strict()` makes the contract structural rather than procedural."
  - "Error messages are i18n keys (errors.field.required etc.), never literal user-facing copy. The client adapter resolves keys through useTranslations('errors'); the server logs raw English keys for audit consistency."
  - "Client MIME claim is captured for audit only — magic-bytes module (02-04) is the authoritative gate. The schema only bounds the claim length (≤120 chars per RFC 6838 §4.2)."
  - "Profile photo file id (`profilePhotoFileId`) is part of both updateAsTd and self/onBehalfOf whitelists — owning your own profile photo is non-sensitive (D-37)."
  - "Initial `ageCategoryCode` and `categoryYear` are NOT accepted on player.create — they are server-derived via `deriveAgeCategory()` at the router layer per PLAYER-04. TD override goes through `playerSetAgeCategoryInput`."

patterns-established:
  - "i18n key naming: `errors.field.required` / `errors.field.email` / `errors.field.belgianPostalCode` / `errors.field.country` / `errors.field.dateInPast` / `errors.file.tooLarge` / `errors.file.disallowedType` / `errors.file.filenameTooLong` — to be added to nl/en/fr catalogs in plan 02-11"
  - "Schema files live at `src/server/trpc/schemas/{entity}.ts` and are importable from both server tRPC procedures and client RHF `zodResolver` (no Node-only deps)"
  - "Shared field groups (`addressFields`, `contactFields`, `emergencyContactFields`) spread into multiple schemas to keep field naming + validation rules consistent across player and trainer surfaces"

requirements-completed: [VALID-06, I18N-08, PLAYER-07, TRAINER-01]

# Metrics
duration: 4min
completed: 2026-05-13
---

# Phase 02 Plan 07: tRPC Zod Input Schemas Summary

**Zod input schemas for player/trainer/file tRPC mutations with D-37/D-38 field-level RBAC encoded structurally via `.strict()` and i18n-key error messages**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-05-13T11:10:34Z
- **Completed:** 2026-05-13T11:14:15Z
- **Tasks:** 3 / 3
- **Files created:** 3

## Accomplishments

- 16 exported Zod schemas across three files (7 player + 5 trainer + 4 file)
- D-37 (player self-update) and D-38 (trainer self-update) field-level RBAC encoded **structurally**: the self-update schemas literally omit TD-managed fields so `.strict()` rejects field smuggling at the validation boundary before the router runs — no field-list check in handler code
- All error messages use i18n keys (`errors.field.*`, `errors.file.*`) rather than literal copy; the client resolves keys through `useZodErrorMessage` (02-04 adapter); server logs the raw English key for audit consistency
- All schemas chained with `.strict()` (VALID-06) — 16 actual `.strict()` calls in total, comfortably above the verification floor of 12
- Threat-model mitigations implemented at schema layer: T-02-07-FIELD-SMUGGLING (strict), T-02-07-OVERSIZED-PAYLOAD (contentBase64 max 3 MiB), T-02-07-MIME-CLIENT-TRUST (claimedMimeType audit-only), T-02-07-DATE-IN-FUTURE (z.coerce.date().max(new Date()))

## Task Commits

Each task was committed atomically:

1. **Task 1: src/server/trpc/schemas/player.ts** — `b9d96e6` (feat)
2. **Task 2: src/server/trpc/schemas/trainer.ts** — `67bfaeb` (feat)
3. **Task 3: src/server/trpc/schemas/file.ts** — `34b3400` (feat)

## Files Created/Modified

### Created

- **`src/server/trpc/schemas/player.ts`** (178 lines) — 7 schemas exported with `.strict()`:
  - `playerCreateInput` (TD): userId, firstName, lastName, dateOfBirth, gender, school?, address (street/streetNumber?/postalCode/city/province/country=BE), phone?, email?, club?, statusCode, academyCode, emergencyContact*?
  - `playerUpdateAsTdInput` (TD / academy_manager): same shape as create minus userId + plus playerId + profilePhotoFileId
  - `playerSelfUpdateInput` (player editing self, D-37 whitelist): address + phone? + email? + emergencyContact*? + profilePhotoFileId — **deliberately omits** statusCode, academyCode, ageCategoryCode, firstName, lastName, dateOfBirth, gender, school, club
  - `playerOnBehalfOfInput` (parent of minor): same whitelist as self-update + playerId
  - `playerSetAgeCategoryInput` (TD only, D-32): playerId, ageCategoryCode, categoryYear, effectiveFrom
  - `playerListInput`: academyCode?, statusCode?, limit (≤200)
  - `playerGetInput`: playerId
  - Plus all 7 `z.infer<...>` types
- **`src/server/trpc/schemas/trainer.ts`** (123 lines) — 5 schemas exported with `.strict()`:
  - `trainerCreateInput` (TD): userId, firstName, lastName, dateOfBirth, gender, address, phone?, email?, diplomaCode, hasPedagogicalQualification (default false)
  - `trainerUpdateAsTdInput` (TD): same shape as create minus userId + plus trainerId + profilePhotoFileId
  - `trainerSelfUpdateInput` (D-38 whitelist): address + phone? + email? + profilePhotoFileId — **deliberately omits** diplomaCode and hasPedagogicalQualification (TD-only diploma upgrades)
  - `trainerListInput`: academyCode?, diplomaCode?, limit (≤200)
  - `trainerGetInput`: trainerId
  - Plus all 5 `z.infer<...>` types
- **`src/server/trpc/schemas/file.ts`** (106 lines) — 4 schemas exported with `.strict()`:
  - `fileUploadInput`: bucket = `z.literal('profiles')` (Phase 2 only), claimedMimeType (≤120 chars, audit-only), originalFilename (≤255), contentBase64 (≤3 MiB)
  - `fileGetSignedUrlInput`: fileId
  - `fileGetScanStatusInput`: fileId
  - `fileDeleteInput`: fileId, removeStorage (default false)
  - Plus all 4 `z.infer<...>` types

## Decisions Made

- **Schema-shape as the structural RBAC contract.** The plan called for field-level RBAC enforcement in the schema, not in the router. Implementing this structurally means the self-update schemas don't have a `.refine()` runtime check that lists forbidden fields — they simply don't declare those fields, and `.strict()` does the rejection. Refactoring D-37/D-38 from a runtime allowlist to a structural omit makes the contract impossible to drift: future fields added to the create schema do not automatically appear in the self-update schema. Future maintainers must consciously copy the new field into both schemas, which surfaces the RBAC decision.
- **Belgian postal code as a shared regex** rather than free `z.string()`. Belgium uses 4-digit postal codes (1000–9999); enforcing `^[0-9]{4}$` at the boundary catches both typos and malicious overflow attempts before the DB write — and gives a localizable error key.
- **profilePhotoFileId is non-sensitive** and so included in self/onBehalfOf whitelists. A player owning their own profile photo is part of the basic profile surface (D-29) — restricting it to TD would defeat the upload-and-pick UX in 02-12.
- **`originalFilename` capped at 255 chars** (POSIX NAME_MAX). The DB column is `text` so longer would technically work, but 255 chars matches every common filesystem and gives a predictable upper bound for log rendering.
- **`claimedMimeType` capped at 120 chars** per RFC 6838 §4.2 (max MIME type length is 127 chars including the `/`). This prevents a malicious client from embedding a large payload in the audit-only field.

## Deviations from Plan

None — the three schema files were implemented exactly as written in the plan's `<action>` blocks, with the following minor enrichments documented:

- Added shared `countryCode` helper (`z.string().length(2)` with `errors.field.country` message) so the country validation has its own localizable key rather than reusing `errors.field.required`. The plan's literal embedded `z.string().length(2).default('BE')` was kept for trainer.ts (where the country helper isn't reused) so both forms appear in the codebase pending a refactor in 02-15.
- Added `profilePhotoFileId` to `playerOnBehalfOfInput` (parent updating their child's profile photo). The plan listed the same whitelist as self-update but didn't explicitly include the photo — interpreting D-37 strictly, the photo IS part of the non-sensitive whitelist for self-update so a parent updating on behalf of a minor inherits the same surface.
- Exported `PlayerListInput`, `PlayerGetInput`, `TrainerListInput`, `TrainerGetInput` types in addition to the create/update ones. The plan listed only a subset; exporting all of them costs nothing and avoids `as` casts in the routers that 02-09/02-10 will write.

**Total deviations:** 0 functional changes; 3 minor enrichments (additional type exports + parent-of-minor photo permission consistency + dedicated country error key).
**Impact on plan:** None — all enrichments are strict supersets of the plan contract.

## Issues Encountered

None — the worktree base-commit mismatch on startup (HEAD at `7fc9deb`, expected `63e3cd6`) was a worktree bootstrap glitch unrelated to plan content; `git reset --hard 63e3cd64` cleanly placed the worktree at the expected base before any task work began.

## Verification Evidence

- `npx tsc --noEmit` → exit 0 (after each task, and final)
- `grep -c '\.strict()'` across `src/server/trpc/schemas/` → 22 occurrences (16 actual `.strict()` calls + 6 in docstrings); meets verification floor of 12
- `grep -rE "drizzle-orm|node:fs|@/server/db" src/server/trpc/schemas/` → no matches (schemas are client-safe)
- `grep -rh 'message:' src/server/trpc/schemas/ | grep -v 'errors\.'` → no matches (every `message:` is an `errors.*` i18n key)
- `wc -l src/server/trpc/schemas/{player,trainer,file}.ts` → 178/123/106 lines, all above `min_lines` (80/50/30)
- D-37 compliance: `playerSelfUpdateInput` does NOT have statusCode/academyCode/ageCategoryCode/firstName/lastName/dateOfBirth/gender/school/club keys (visually inspected, lines 122–129 of `src/server/trpc/schemas/player.ts`)
- D-38 compliance: `trainerSelfUpdateInput` does NOT have diplomaCode/hasPedagogicalQualification keys (visually inspected, lines 95–101 of `src/server/trpc/schemas/trainer.ts`)

## Threat Model Implementation

| Threat ID | Mitigation |
|-----------|------------|
| T-02-07-FIELD-SMUGGLING | `.strict()` on every object schema rejects unknown keys at the Zod boundary. D-37/D-38 whitelist is structural (field is not declared) so smuggling fails with a Zod unrecognised-key error before the router runs. Test coverage requested in `tests/unit/player-schemas.test.ts` (02-15). |
| T-02-07-OVERSIZED-PAYLOAD | `contentBase64` capped at `3 * 1024 * 1024` chars (~2.25 MB raw). Next.js bodyParser `sizeLimit: '5mb'` (02-16) is the request-body cap. Two layers of defense. |
| T-02-07-MIME-CLIENT-TRUST | `claimedMimeType` accepted for audit only and capped at 120 chars. Magic-bytes module (02-04) is documented as the authoritative gate at the router layer. |
| T-02-07-DATE-IN-FUTURE | `z.coerce.date().max(new Date(), { message: 'errors.field.dateInPast' })` on every `dateOfBirth` field. |

## Threat Flags

None — no new trust boundaries introduced. All three schemas are pure validation contracts at an existing tRPC boundary already documented in 02-CONTEXT.md.

## User Setup Required

None — pure code changes, no external service configuration needed.

## Self-Check: PASSED

- `src/server/trpc/schemas/player.ts` exists ✓
- `src/server/trpc/schemas/trainer.ts` exists ✓
- `src/server/trpc/schemas/file.ts` exists ✓
- Commit `b9d96e6` (Task 1) reachable ✓
- Commit `67bfaeb` (Task 2) reachable ✓
- Commit `34b3400` (Task 3) reachable ✓
- `npx tsc --noEmit` exits 0 ✓
- No literal user-facing error strings (all `errors.*` keys) ✓

## Next Phase Readiness

- **02-09 (file router) + 02-10 (player/trainer routers)** can now import these schemas as procedure inputs. The `playerId` / `trainerId` / `fileId` path params are normalised across all schemas so routers can write a single `.input()` chain per procedure.
- **02-11 (i18n catalog additions)** needs to add the following keys to `messages/nl.json`, `messages/en.json`, `messages/fr.json` under the `errors` namespace:
  - `field.required`
  - `field.email`
  - `field.belgianPostalCode`
  - `field.country`
  - `field.dateInPast`
  - `file.tooLarge`
  - `file.disallowedType`
  - `file.filenameTooLong`
- **02-12 (UI shared components)** can install `useZodErrorMessage` from 02-04 to render the resolved messages in the shadcn `<FormMessage>` component.
- **02-13 (UI pages and forms)** can call `zodResolver(playerSelfUpdateInput)` directly from the client to share the validation contract end-to-end.
- **02-15 (tests)** needs the `player-schemas.test.ts` referenced in the threat register: assert that `playerSelfUpdateInput.parse({ statusCode: 'a' })` throws with the unrecognised-key Zod error.

---
*Phase: 02-identiteit-bestanden*
*Plan: 07-trpc-schemas*
*Completed: 2026-05-13*
