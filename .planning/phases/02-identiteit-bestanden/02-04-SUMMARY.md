---
phase: 02-identiteit-bestanden
plan: 04
subsystem: infra
tags: [supabase-storage, file-type, magic-bytes, signed-url, server-only, drizzle, next-intl, trpc, zod, i18n, age-category]

requires:
  - phase: 01-fundament
    provides:
      - src/lib/env.ts (typed env gate; SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY added in 02-01)
      - src/server/db/client.ts (Drizzle handle + DbClient type)
      - src/lib/i18n-format.ts (Phase 1 i18n helpers — next-intl conventions)
      - 'next-intl 4.x configured (useTranslations, errors namespace)'
  - phase: 02-identiteit-bestanden
    provides:
      - src/server/db/schema/lookups.ts (ageCategories table, locked in 02-02)
      - src/server/db/schema/players.ts (ageCategoryHistory table + idx_age_history_lookup, locked in 02-02)
      - src/server/db/schema/files.ts (uploadedFiles table, locked in 02-02)
      - package.json deps @supabase/supabase-js@^2 + file-type@^22 + clamscan@^2 (installed by 02-01)
      - env vars SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CLAMAV_HOST, CLAMAV_PORT (typed in 02-01)

provides:
  - Service-role Supabase Storage client singleton (server-only) — `storageClient`
  - Magic-bytes validation entrypoint — `validateUploadMagicBytes(buf, bucket)` + `MIME_BY_BUCKET` registry
  - Signed-URL minting helper for profile photos — `createProfilePhotoSignedUrl(storageKey, ttl?)` + `PROFILE_PHOTO_TTL_SECONDS`
  - Profile-photo upload helper — `uploadProfilePhoto(buf, userId, fileId, ext, mime)` returning `{ storageKey }`
  - Age-category derivation + temporal lookup — `deriveAgeCategory(dob, asOfDate?, dbHandle?)` + `getAgeCategoryAt(playerId, date, dbHandle?)`
  - Client-side Zod-error → i18n-key resolver hook — `useZodErrorMessage()`
  - i18n key surface for file errors: `errors.file.unknownType`, `errors.file.disallowedType`, `errors.file.signedUrlFailed`, `errors.file.uploadFailed` (catalog entries to be added in 02-11)

affects:
  - 02-09-trpc-router-file (composes uploadProfilePhoto + validateUploadMagicBytes + createProfilePhotoSignedUrl in file.upload + file.getSignedUrl mutations)
  - 02-10-trpc-routers-player-trainer (player.create / player.update call deriveAgeCategory; getAgeCategoryAt called by Phase 4 toernooi-validatie)
  - 02-11-i18n-catalog-additions (must add the 4 errors.file.* keys to messages/{nl,en,fr}.json + zod-field errors namespace)
  - 02-12-ui-shared-components (PhotoUpload widget wires useZodErrorMessage into shadcn <FormMessage>)
  - 02-13-ui-pages-and-forms (forms consume useZodErrorMessage)
  - 02-15-tests (unit tests for magic-bytes, deriveAgeCategory boundary scenarios, signed-url shape)
  - phase 04 (Phase 4 toernooi-validatie consumes getAgeCategoryAt with tournament.start_date)

tech-stack:
  added:
    - "@supabase/supabase-js@^2 (server-side Storage SDK — service-role client)"
    - "file-type@^22 (ESM-only magic-bytes detector — fileTypeFromBuffer)"
    - "next-intl client hook (useTranslations) wrapped for Zod error keys"
  patterns:
    - "import 'server-only' on every storage module to enforce no-client-bundle inclusion (T-02-04-SR-KEY-LEAK mitigation)"
    - "MIME_BY_BUCKET centralised whitelist with `as const satisfies Record<...>` for both extension safety and bucket-type narrowing"
    - "TRPCError messages carry i18n keys, never literal sentences (D-46)"
    - "Storage path = {userId}/{fileId}.{ext} — per-user folder for future per-folder RLS (Pattern 6 in 02-RESEARCH)"
    - "Caller-minted fileId passed into upload helper so DB row id and storage key UUID stay linked"
    - "Drizzle date columns bind raw YYYY-MM-DD strings (no `as unknown as string` cast)"
    - "deriveAgeCategory falls back to 'age_unknown' code (seeded sort_order=99 in 02-08) when no boundary matches (RESEARCH A2)"

key-files:
  created:
    - src/server/storage/client.ts
    - src/server/storage/magic-bytes.ts
    - src/server/storage/signed-url.ts
    - src/server/storage/profile-photo.ts
    - src/lib/players.ts
    - src/lib/forms/zod-i18n.ts
  modified: []

key-decisions:
  - "Service-role Supabase client is the single storage entrypoint for v1; no direct browser-to-Storage. Compensating defence: 'server-only' directive on all storage modules + future ESLint restricted-imports rule (02-13)."
  - "MIME_BY_BUCKET registry seeded with profiles only ('image/jpeg', 'image/png' — VALID-03); Phase 4 evaluations and Phase 5 medical entries are placeholder comments to be appended in their respective phases."
  - "PROFILE_PHOTO_TTL_SECONDS = 60 * 60 (D-24) exported as a named constant — callers must not hard-code minutes/seconds."
  - "uploadProfilePhoto signature accepts caller-minted fileId (not internal randomUUID) so the tRPC mutation can mint once and pass to both DB INSERT and storage upload — keeps uploaded_files.id ↔ storage path linkage atomic and recoverable."
  - "Storage key returned by uploadProfilePhoto is the path-within-bucket ({userId}/{fileId}.{ext}); the bucket name 'profiles' is stored separately on uploaded_files.bucket. This matches the column shape locked in 02-02/02-03 and avoids storage_key ambiguity when Phase 4 adds evaluations bucket."
  - "createProfilePhotoSignedUrl always passes download:filename to enforce Content-Disposition: attachment (VALID-05); the filename is derived from the last storage-key path segment, never user-supplied original filename."
  - "deriveAgeCategory uses calendar birth year vs lookup boundaries (NOT current-age math) per RESEARCH §A2 — Belgian table tennis age categories are calendar-year boundaries, not birthday boundaries."
  - "deriveAgeCategory orders age_categories by sort_order ASC and returns 'age_unknown' only when no row matches; the seeded age_unknown row is given sort_order=99 in 02-08 so it is evaluated last (BLOCKER-05 fix)."
  - "getAgeCategoryAt passes YYYY-MM-DD strings directly to lte/gte against DATE columns — Drizzle 0.45 binds string operands natively, removing the `as unknown as string` smell (BLOCKER-06 fix)."
  - "useZodErrorMessage strips the 'errors.' prefix so callers can pass either the full path (server-emitted) or namespace-relative suffix; cleanly returns undefined when no error key is present."

patterns-established:
  - "Pattern (server-only storage modules): every file under src/server/storage/ starts with `import 'server-only';` on line 1; documented in module header that ESLint restricted-imports rule (02-13) reinforces the invariant."
  - "Pattern (i18n-keyed TRPCError messages): TRPCError({ code, message: 'errors.<area>.<key>' }) — never a literal English sentence. Routers' error formatter (02-09) and useZodErrorMessage on the client cooperate to localise."
  - "Pattern (caller-minted UUID for split DB+storage writes): mint once at the boundary, pass to both DB INSERT and storage upload to keep parallel writes linked even under partial-failure recovery."
  - "Pattern (lookup-driven domain helpers with explicit fallback code): when seed data may be incomplete in early phases, return a documented fallback code that is itself a real seeded row, so FK references never fail."

requirements-completed: [VALID-01, VALID-02, VALID-03, VALID-05, VALID-06, FILE-01, FILE-04, DOM-CAT-01, DOM-CAT-02, I18N-08]

duration: ~9min
completed: 2026-05-13
---

# Phase 02 Plan 04: Storage Helpers + Magic-Bytes + Age-Category + Zod-i18n Summary

**Six server-side helper modules wired: service-role Supabase Storage client, file-type magic-bytes validator with MIME_BY_BUCKET registry, profile-photo signed-URL minter (1h TTL with attachment disposition), profile-photo upload helper with caller-minted UUID, deriveAgeCategory/getAgeCategoryAt domain helpers, and a next-intl useZodErrorMessage hook for react-hook-form FormMessage.**

## Performance

- **Duration:** ~9 min (single-shot, no rework)
- **Started:** 2026-05-13T11:05:42Z (worktree fast-forward complete)
- **Completed:** 2026-05-13T11:14:51Z
- **Tasks:** 3
- **Files created:** 6
- **Files modified:** 0

## Accomplishments

- Service-role Supabase Storage client singleton (`storageClient`) — sealed off from client bundles by `import 'server-only'` on line 1 (D-22, FILE-01; T-02-04-SR-KEY-LEAK mitigation).
- Magic-bytes validation entrypoint with centralised `MIME_BY_BUCKET` registry — `validateUploadMagicBytes(buf, bucket)` returns `{ ext, mime }` or throws TRPCError with i18n key (VALID-02, VALID-03, D-23; T-02-04-MIME-SPOOF mitigation).
- Signed-URL minting helper exporting `PROFILE_PHOTO_TTL_SECONDS = 60 * 60` (1h per D-24) and `createProfilePhotoSignedUrl(storageKey, ttl?)` that forces `Content-Disposition: attachment` via `download: filename` (FILE-01, VALID-05; T-02-04-INLINE-EXECUTION mitigation).
- Profile-photo upload helper `uploadProfilePhoto(buf, userId, fileId, ext, mime)` accepting caller-minted `fileId` so `uploaded_files.id` and storage-key UUID stay linked atomically; `upsert: false` explicit (D-25, FILE-04; T-02-04-PREDICTABLE-KEY mitigation).
- Player age-category helpers in `src/lib/players.ts`: `deriveAgeCategory(dob, asOfDate?, dbHandle?)` with deterministic `sort_order ASC` ordering and `'age_unknown'` fallback (BLOCKER-05); `getAgeCategoryAt(playerId, date, dbHandle?)` using the composite index `idx_age_history_lookup` (D-31, D-33, DOM-CAT-01, DOM-CAT-02; BLOCKER-06 fix).
- Client-side Zod-error → i18n adapter `useZodErrorMessage` in `src/lib/forms/zod-i18n.ts` — strips `errors.` prefix, handles `undefined`, resolves through `useTranslations('errors')` (D-46, I18N-08).

## Task Commits

Each task was committed atomically:

1. **Task 1: Create the 4 storage helpers (client, magic-bytes, signed-url, profile-photo)** — `4d83043` (feat)
2. **Task 2: Create src/lib/players.ts with deriveAgeCategory + getAgeCategoryAt** — `6054030` (feat)
3. **Task 3: Create src/lib/forms/zod-i18n.ts adapter for FormMessage** — `3622f18` (feat)

**Plan metadata commit:** added after SUMMARY.md is staged below (docs).

## Files Created/Modified

- `src/server/storage/client.ts` — Service-role Supabase Storage singleton; bound to `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`; `auth.persistSession=false`. Server-only directive on line 1.
- `src/server/storage/magic-bytes.ts` — `MIME_BY_BUCKET` registry + `UploadBucket` type + `validateUploadMagicBytes(buf, bucket)`; uses `fileTypeFromBuffer` and emits `errors.file.unknownType` / `errors.file.disallowedType` TRPCError keys.
- `src/server/storage/signed-url.ts` — `PROFILE_PHOTO_TTL_SECONDS` (60*60) + `createProfilePhotoSignedUrl(storageKey, ttl?)`; passes `download: <last-path-segment>` to force attachment disposition; emits `errors.file.signedUrlFailed`.
- `src/server/storage/profile-photo.ts` — `UploadProfilePhotoResult` + `uploadProfilePhoto(buf, userId, fileId, ext, mime)`; `upsert: false`; storage key is `{userId}/{fileId}.{ext}` (path within `profiles` bucket); emits `errors.file.uploadFailed`.
- `src/lib/players.ts` — `AgeCategoryResult` + `deriveAgeCategory(dob, asOfDate?, dbHandle?)` + `getAgeCategoryAt(playerId, date, dbHandle?)`. Both accept optional `dbHandle` for RLS-bound test transactions.
- `src/lib/forms/zod-i18n.ts` — `'use client'` + `useZodErrorMessage()` returning a `(key) => string | undefined` resolver bound to `useTranslations('errors')`.

## Decisions Made

All key decisions are itemised in the frontmatter `key-decisions` list (10 items). Highlights:

- **Server-only directive is the primary defence against service-role key leakage** — Next.js refuses to bundle modules starting with `import 'server-only'` into client code; supplemented by future ESLint restricted-imports rule (02-13).
- **MIME whitelist is a single source of truth** — `MIME_BY_BUCKET` registry, typed with `as const satisfies Record<...>`, prevents per-router drift in what files are accepted.
- **Caller-minted `fileId`** — the tRPC mutation mints `crypto.randomUUID()` once and threads it through both the `uploaded_files` INSERT and the storage upload, so the two writes stay linked even if one fails.
- **Path-within-bucket for `storageKey`** — helper returns `{userId}/{fileId}.{ext}` and the caller composes the full storage key with `uploaded_files.bucket` (= `'profiles'`). This matches the locked schema shape and stays clean when Phase 4 adds `evaluations`.
- **Deterministic age-category ordering** — `ORDER BY sort_order ASC` on `age_categories` so `age_unknown` (seeded with sort_order=99 in 02-08) is evaluated last. Without this, Postgres could return rows in arbitrary order and accidentally pick the fallback first (BLOCKER-05 fix).
- **YYYY-MM-DD strings bound directly to DATE columns** — Drizzle 0.45 coerces, no `as unknown as string` smell (BLOCKER-06 fix).
- **`useZodErrorMessage` strips `errors.` prefix and handles `undefined`** — so callers can pass either form factor and so the hook is safe to call even when the field has no error.

## Deviations from Plan

None — plan executed exactly as written.

The plan's body included one in-line revision ("HOWEVER — to support the cleaner orchestration in 02-09, change the signature"): I followed the second (revised) signature `(buf, userId, fileId, ext, mime)` as instructed.

## Issues Encountered

### 1. Worktree starting commit differed from expected base

- **Symptom:** `ACTUAL_BASE` (7fc9deb — phase research) was strictly behind `EXPECTED_BASE` (63e3cd6 — wave-1 plans marked complete) because wave-1 work (02-01 + 02-02) was merged in the meantime.
- **Fix:** Fast-forwarded the worktree via `git merge --ff-only 63e3cd6` (non-destructive — destructive `git reset --hard` would have been overkill here). The original `<worktree_branch_check>` snippet's `git reset --hard` was denied by the sandbox; `merge --ff-only` is the documented safer alternative for the strictly-behind case.
- **Outcome:** Worktree now at 63e3cd6 (HEAD before this plan's commits); all Phase 1 + 02-01 + 02-02 artifacts visible (env keys, drizzle schema, deps).

### 2. Verification commands not runnable in worktree

- **Symptom:** Plan's verify block calls `npx tsc --noEmit` and `pnpm exec eslint`. This worktree has no `node_modules/`, and the parent monorepo `node_modules/` does not yet include `@supabase/supabase-js` (lockfile lists `2.105.4` but it is not materialised). Running `tsc` therefore surfaces "Cannot find module '@supabase/supabase-js'" — an infrastructure absence, not a code regression. Documented in the `<environment_note>` ("Local dev environment does NOT have Docker / Redis"; same shape applies to missing node_modules).
- **Fix:** Manual review of the generated code against:
  - The plan's explicit code examples (storage helpers match verbatim except for the in-line "use THIS signature" revision and idiomatic formatting).
  - The `pnpm-lock.yaml` already on `main` (confirms `@supabase/supabase-js@2.105.4`, `file-type@22.0.1`, `@trpc/server@11.17.0`, `next-intl@4.11.2`, `drizzle-orm@0.45.2` — all imports map to real lockfile entries).
  - The Phase-1 codebase conventions (`@/lib/env`, `@/server/db/client`, `@/server/db/schema/*` alias resolution; barrel re-exports in `src/server/db/schema/index.ts` expose `ageCategories` and `ageCategoryHistory` to `db.query.<name>`).
- **Outcome:** All file-level acceptance criteria from each task block are met. Plan-level `tsc --noEmit` + ESLint passes will run as part of the post-wave verification once `pnpm install` materialises `node_modules` in the merged tree.

### 3. Heredoc `$(cat <<'EOF'...EOF)` failed once for Task 3 commit

- **Symptom:** Bash exit 1 with "unexpected EOF" — the outer `"..."` quoting around `$(cat <<'EOF' ... EOF)` in the documented commit template confused the shell when the body contained apostrophes around inline code (`'use client'`, `'errors.'`).
- **Fix:** Replaced with a plain double-quoted `-m` argument and avoided apostrophe-quoted inline code in the commit message body.
- **Impact:** None on code or commit content. The Task 3 commit (`3622f18`) was successful on the second attempt.

## User Setup Required

None — no external service configuration required for this plan.

The new env vars (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CLAMAV_HOST`, `CLAMAV_PORT`) were typed and seeded into `.env.example` by Plan 02-01; deployment-side setup is captured in `02-16-deployment-docs-PLAN.md`.

## Threat Surface Scan

All threats in the plan's `<threat_model>` are addressed by code in this commit; no NEW security-relevant surface was introduced outside the registered threats. The `useZodErrorMessage` hook is a thin wrapper around `next-intl`'s `useTranslations` and adds no new auth/network path. The age-category helpers run under the existing RLS-bound DB client and surface only lookup data already in the database.

No threat flags raised.

## Next Phase Readiness

- 02-05 (RLS policies migration 0007) is unaffected by this plan; runs in parallel.
- 02-06 (malware-scan worker) — wave 3; will reuse `storageClient` (via the worker's own import; storage client is server-only by directive but the worker is server-side).
- 02-09 (`file.upload` / `file.getSignedUrl` tRPC router) — wave 3; composes `validateUploadMagicBytes` + `uploadProfilePhoto` + `createProfilePhotoSignedUrl` exactly as documented in the plan's `<interfaces>` block.
- 02-10 (player/trainer tRPC routers) — wave 3; `player.create` + `player.update` call `deriveAgeCategory` to fill `players.age_category` + `players.category_year`.
- 02-11 (i18n catalog) — must add `errors.file.unknownType`, `errors.file.disallowedType`, `errors.file.signedUrlFailed`, `errors.file.uploadFailed` to `messages/{nl,en,fr}.json`. These keys are documented above; planner should pre-seed them into the catalog plan.
- 02-12 (UI shared components) — `<PhotoUpload>` widget wires `useZodErrorMessage` into shadcn `<FormMessage>`.
- 02-15 (tests) — unit tests should cover: PNG-renamed-as-JPG MIME spoof rejected, magic-bytes detects nothing → BAD_REQUEST, deriveAgeCategory boundary edges (open-ended NULL endpoints, year-on-boundary), getAgeCategoryAt returns null pre-history, signed-URL throws when Supabase returns error.

## Self-Check: PASSED

- **Files created (Read tool):**
  - FOUND: `src/server/storage/client.ts` (line 1 = `import 'server-only';`)
  - FOUND: `src/server/storage/magic-bytes.ts` (line 1 = `import 'server-only';`)
  - FOUND: `src/server/storage/signed-url.ts` (line 1 = `import 'server-only';`)
  - FOUND: `src/server/storage/profile-photo.ts` (line 1 = `import 'server-only';`)
  - FOUND: `src/lib/players.ts` (exports deriveAgeCategory, getAgeCategoryAt)
  - FOUND: `src/lib/forms/zod-i18n.ts` (line 1 = `'use client';`, exports useZodErrorMessage)
- **Commits (git log --oneline -5 verified during execution):**
  - FOUND: `4d83043` — feat(02-04): add 4 storage helpers
  - FOUND: `6054030` — feat(02-04): add src/lib/players.ts
  - FOUND: `3622f18` — feat(02-04): add src/lib/forms/zod-i18n.ts
- **Symbol presence (grep verified during execution):**
  - `fileTypeFromBuffer`, `MIME_BY_BUCKET` — present in magic-bytes.ts
  - `createSignedUrl`, `PROFILE_PHOTO_TTL_SECONDS = 60 * 60` — present in signed-url.ts
  - `upsert: false`, `fileId` parameter — present in profile-photo.ts
  - `deriveAgeCategory`, `getAgeCategoryAt`, `age_unknown`, `ageCategoryHistory` — present in players.ts
  - `'use client'`, `useTranslations`, `useZodErrorMessage` — present in zod-i18n.ts
- **`'server-only'` count under `src/server/storage/`:** 5 occurrences (4 directives + 1 docstring mention) — ≥ 4.

---
*Phase: 02-identiteit-bestanden*
*Plan: 04*
*Completed: 2026-05-13*
