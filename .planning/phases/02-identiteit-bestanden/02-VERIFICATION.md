---
phase: 02-identiteit-bestanden
verified: 2026-05-13T18:00:00Z
status: gaps_found
score: 6/8 succescriteria verified
overrides_applied: 0
gaps:
  - truth: "System BLOCKS saving when a minor has no emergency contact (SC-5 / PLAYER-06)"
    status: failed
    reason: >
      The DB CHECK constraint `players_minor_emergency_contact` fires at the Postgres layer and
      raises a `23514` check_violation. The `player.create` router has NO try/catch that maps
      this pg error code to a TRPCError BAD_REQUEST with an i18n key. The constraint violation
      will surface to the client as INTERNAL_SERVER_ERROR (opaque 500), not a user-facing message
      that blocks saving. The integration test for this (player-router.test.ts line 156) expects
      `BAD_REQUEST` with an i18n key — this test is RED locally (infrastructure-skipped) and would
      fail on a live DB. Succescriterium 5 requires "het systeem BLOKKEERT opslaan" — a 500 that
      shows a generic toast does technically block save, but provides no actionable feedback.
    artifacts:
      - path: "src/server/trpc/routers/player.ts"
        issue: "create mutation lacks try/catch around the tx INSERT that catches pg code 23514 and re-throws as TRPCError BAD_REQUEST with message 'errors.field.emergencyContact'"
      - path: "tests/integration/player-router.test.ts"
        issue: "Test line 156 expects code:BAD_REQUEST + i18n message — will fail on live DB; currently passing only because testcontainers are skipped locally"
    missing:
      - "In player.create (and player.updateAsTd), wrap the transaction in try/catch, detect pg.code === '23514' and constraintName === 'players_minor_emergency_contact', re-throw as TRPCError({ code:'BAD_REQUEST', message:'errors.field.emergencyContact' })"
      - "Add corresponding 'errors.field.emergencyContact' key to all three i18n catalogs (nl/en/fr)"
      - "Add 'errors.field.emergencyContactPhone' key similarly"
  - truth: "Malware-scan worker flips scan_status from pending to clean/infected (SC-6 / VALID-04)"
    status: partial
    reason: >
      The worker implementation (malware-scan.ts) is substantive and correct. However ALL three
      integration tests that exercise the status-flip behaviour are marked it.skip with documented
      reasons: the test payloads were written with a `buffer` field that does not exist on
      MalwareScanJobData (the real payload is {fileId, storageKey, bucket}). The skip comments say
      "rewrite to mock storage download + sql execute via raw SQL" — meaning the tests were
      authored against a stale interface and were never made GREEN. The full-pipeline CI test is
      also skipped (requires ClamAV daemon). While the code is correct, VALID-04 has zero green
      test coverage of the status-flip behaviour.
    artifacts:
      - path: "tests/integration/malware-scan.test.ts"
        issue: "3 of 4 tests are it.skip with interface mismatch reason; 1 is it.skip for CI-only ClamAV; 0 tests run green for the scan-status flip path"
    missing:
      - "Rewrite the 3 skipped malware-scan tests to match actual MalwareScanJobData {fileId, storageKey, bucket} shape, mock storageClient.storage.from().download() and db.execute(sql`SELECT mark_scan_result(...)`) — remove the it.skip"
human_verification:
  - test: "Photo signed-URL 403 baseline"
    expected: "Accessing the raw Supabase storage URL (without a signed token) for a profiles/ object returns HTTP 403"
    why_human: "Requires a browser + live Supabase project. Bucket is confirmed public=false (smoke check 6) and storage.objects policies exist (smoke check 5) but actual HTTP response needs a real request to uxgqsaphmmzholxkuuym."
  - test: "Trainer academy-scoping end-to-end"
    expected: "A trainer logged in and assigned only to Academy Antwerpen sees only those players in the /players UI — not players of other academies"
    why_human: "RLS policies verified on DB (smoke check 4, 12) and playerRouter.list passes through withRlsContext. End-to-end verification requires a live session with trainer credentials."
  - test: "Emergency-contact blocker UX"
    expected: "When a TD tries to save a minor player without emergency contact phone, the UI shows a localised error message and prevents navigation away"
    why_human: "Currently surfaces as INTERNAL_SERVER_ERROR (see BLOCKER gap above). After the gap is fixed, the UX must be verified in a browser."
  - test: "Malware-scan full pipeline on staging"
    expected: "Upload an EICAR test file via the PhotoUpload widget; within ~30 s the avatar shows the 'infected' badge; upload a clean JPEG and it transitions to 'clean'"
    why_human: "ClamAV daemon required. Local environment has no Docker. Staging Supabase project (uxgqsaphmmzholxkuuym) has the tables but the BullMQ/ClamAV worker sidecar is not deployed yet."
---

# Phase 2: Identiteit & Bestanden — Verification Report

**Phase Goal:** Volledige speler- en trainerprofielen met foto-upload en correct gescopede bestandstoegang, zodat het dagelijks beheer van de spelerslijst operationeel is.
**Verified:** 2026-05-13T18:00:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification

---

## 1. Verdict

**PASS-WITH-GAPS**

The Phase 2 codebase delivers a substantive, well-engineered implementation across all 16 plans. All key artifacts exist, are non-stub, and are wired end-to-end. The three migrations (0006/0007/0008) are applied to the live Supabase dev/staging project (13/13 smoke checks passed). The i18n catalogs are in perfect three-language parity (190 leaf keys each). The RLS policies, tRPC routers, storage helpers, and malware-scan worker are all correct and connected.

Two gaps block a clean PASS:

1. **BLOCKER (SC-5 / PLAYER-06):** The system does not surface a user-actionable error when saving a minor without emergency contact. The DB CHECK enforces the constraint but the router lets the pg `23514` error bubble as a raw `INTERNAL_SERVER_ERROR`. The integration test for this is permanently RED.

2. **WARNING (SC-6 / VALID-04):** All three malware-scan status-flip integration tests are `it.skip` with documented interface-mismatch reasons. The worker code is correct but has zero green test coverage for the scan→status-flip path.

Four items require manual UAT (signed-URL 403 baseline, trainer scoping e2e, emergency-contact UX after fix, full scan pipeline on staging).

---

## 2. Succescriteria Coverage Matrix

| # | Criterium | Code path | Evidence | Status |
|---|-----------|-----------|----------|--------|
| 1 | TD kan volledig spelerprofiel aanmaken met foto; direct zichtbaar in spelerslijst | `player.create` (tdProcedure) + tx: INSERT players + academy_memberships + age_category_history. `player.list` RLS-scoped. `PlayerListTable` hydrates from server-side `player.list`. | `src/server/trpc/routers/player.ts:66–183` `src/app/[locale]/(app)/players/page.tsx:54–95` | VERIFIED |
| 2 | Trainer ziet alleen spelers van assigned academies | `players_select` RLS policy uses `players_visible_to(current_user_id(), current_user_role())` SECURITY DEFINER fn. `playerRouter.list` runs inside `withRlsContext`. Smoke check 12 confirmed TD sees 0 rows on fresh DB. RLS direct-query test (`tests/rls/players-direct-query.test.ts`) has 3 passing specs. | `drizzle/0007_phase2_rls_policies.sql:84–88` `02-14-MIGRATION-LOG.md:Check 12` | VERIFIED (manual UAT needed for e2e) |
| 3 | Speler kan eigen niet-gevoelige velden bewerken; niet status/academie | `updateSelf` procedure restricted to `role=player`; uses `playerSelfUpdateInput` (`.strict()` — no statusCode/academyCode). `trainers.updateSelf` mirrors pattern for TRAINER. | `src/server/trpc/routers/player.ts:228–303` `src/server/trpc/schemas/player.ts:118–129` | VERIFIED |
| 4 | Profielfoto's alleen via signed URLs; directe bucket-URL geeft 403 | Bucket `profiles` created with `public=false` (smoke check 6). `createProfilePhotoSignedUrl` sets `Content-Disposition: attachment` (VALID-05). `getSignedUrl` procedure checks `scan_status='clean'` before minting. RLS `profiles_owner_read/write/td_all` policies on `storage.objects`. | `src/server/storage/signed-url.ts:34–57` `drizzle/0007_phase2_rls_policies.sql:Section 6` `02-14-MIGRATION-LOG.md:Check 6` | VERIFIED (403 smoke needs human) |
| 5 | Noodcontact verplicht voor minderjarigen; systeem blokkeert opslaan als ontbreekt | DB CHECK `players_minor_emergency_contact` exists (smoke check 7). BUT router has no try/catch for pg code `23514` → surfaces as `INTERNAL_SERVER_ERROR`, not `BAD_REQUEST` with i18n key. Test at line 156 expects `BAD_REQUEST` — RED. | `src/server/db/schema/players.ts:89–95` `src/server/trpc/routers/player.ts` (no 23514 catch) `tests/integration/player-router.test.ts:156–179` | FAILED — BLOCKER |
| 6 | Magic-bytes verification weigert mis-typed bestanden | `validateUploadMagicBytes` uses `fileTypeFromBuffer`; MIME_BY_BUCKET whitelist for `profiles: [image/jpeg, image/png]`. `fileUploadInput.contentBase64.max(3MB)` Zod guard + 2MB decoded cap. Unit tests for magic-bytes pass (6 test cases). | `src/server/storage/magic-bytes.ts:45–64` `tests/unit/magic-bytes.test.ts` | VERIFIED |
| 7 | Malware-scan worker flipt scan_status pending→clean/infected | `processMalwareScan` is substantive (ClamAV TCP scan → `mark_scan_result` SECURITY DEFINER SQL). Worker wired in `src/server/workers/index.ts` with `malwareScanQueue`. `mark_scan_result` fn confirmed SECURITY DEFINER + app_user EXECUTE (smoke check 13). BUT all 3 status-flip integration tests are `it.skip` with interface mismatch — 0 green tests for this path. | `src/server/workers/jobs/malware-scan.ts:83–158` `tests/integration/malware-scan.test.ts` (all skip) | WARNING — PARTIAL |
| 8 | i18n catalogs hebben Phase 2 keys in nl/en/fr | `players`, `trainers`, `files.photo`, `errors.file`, `errors.field` namespaces all present. 190 leaf keys in nl = 190 in en = 190 in fr — zero missing keys. Lookup codes (status/academy/ageCategory/trainerDiploma) present as display labels. | `messages/nl.json`, `messages/en.json`, `messages/fr.json` — verified by script | VERIFIED |

**Score: 6/8 criteria verified.** 1 FAILED (BLOCKER), 1 PARTIAL (WARNING).

---

## 3. Requirements Coverage Matrix

| Requirement | Description | Code path | Status |
|-------------|-------------|-----------|--------|
| PLAYER-01 | Player profile fields (personal + address) | `players` schema + `playerCreateInput` — all fields present | SATISFIED |
| PLAYER-02 | Status A/B/C + academy assignment | `players.statusCode` FK → `status`; `players.academyCode` FK → `academy` | SATISFIED |
| PLAYER-03 | Club is free text, separate from academy (schema constraint) | `players.club text` (no FK) distinct from `players.academyCode` | SATISFIED |
| PLAYER-04 | Age category + category_year explicit columns, not derived on-read | `players.ageCategoryCode`, `players.categoryYear`; `deriveAgeCategory()` at create-time | SATISFIED |
| PLAYER-05 | Profile photo | `profilePhotoFileId FK → uploaded_files`; `PhotoUpload` widget; `getSignedUrl` | SATISFIED |
| PLAYER-06 | Emergency contact mandatory for minors | DB CHECK enforces; router has no application-layer mapping of 23514 to i18n BAD_REQUEST | PARTIAL — see BLOCKER gap |
| PLAYER-07 | Age-category history (DOM-CAT-01) | `ageCategoryHistory` table; `setAgeCategory` procedure; `getAgeCategoryAt` helper | SATISFIED |
| TRAINER-01 | Trainer profile fields | `trainers` schema + `trainerCreateInput` — all fields | SATISFIED |
| TRAINER-02 | Diploma codes (trainer_diploma lookup) | `trainers.diplomaCode FK → trainer_diploma`; 5 codes seeded | SATISFIED |
| TRAINER-03 | Academy linkage via academy_memberships | Re-uses Phase 1 `admin.user.linkAcademy`; `trainers_select` RLS joins `academy_memberships` | SATISFIED |
| FILE-01 | Signed URLs for profile photos, TTL 1h | `createProfilePhotoSignedUrl(key, 3600)` | SATISFIED |
| FILE-03 | Profiles bucket separate from medical; RLS on storage.objects | `profiles` bucket with dedicated policies; medical bucket deferred to Phase 5 per ROADMAP | SATISFIED |
| FILE-04 | UUID filenames (no user-supplied names in storage path) | `storageKey = ${userId}/${fileId}.${ext}` where `fileId = crypto.randomUUID()` | SATISFIED |
| VALID-01 | Size cap 2 MB for profile photos | `MAX_PROFILE_PHOTO_BYTES = 2 * 1024 * 1024`; decoded buffer check | SATISFIED |
| VALID-02 | Magic-bytes validation (no extension trust) | `fileTypeFromBuffer` before accept | SATISFIED |
| VALID-03 | MIME whitelist per bucket | `MIME_BY_BUCKET.profiles = ['image/jpeg','image/png']` | SATISFIED |
| VALID-04 | Malware scan; quarantine until clean | Worker code correct; status-flip test coverage zero (all skipped) | PARTIAL |
| VALID-05 | Content-Disposition: attachment on downloads | `createSignedUrl(key, ttl, { download: filename })` | SATISFIED |
| VALID-06 | Zod validation on all tRPC mutations; no client trust | All schemas use `.strict()`; error messages are i18n keys | SATISFIED |
| DOM-CAT-01 | Age category history tracking | `ageCategoryHistory` table + `setAgeCategory` SERIALIZABLE tx | SATISFIED |
| DOM-CAT-02 | Age category derived from birth year; boundaries in lookup table | `deriveAgeCategory()` reads `age_categories`; boundaries currently NULL (all players get `age_pre_minor` until TD confirms — documented as deferred to Phase 4) | SATISFIED (deferred known gap) |
| I18N-06 | Lookup codes have display labels in nl/en/fr | `messages/*/lookups.status/academy/ageCategory/trainerDiploma` all present | SATISFIED |
| I18N-08 | Zod error messages are i18n keys | All schema messages are `'errors.field.*'` keys; `useZodErrorMessage()` adapter in place | SATISFIED |

---

## 4. Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `drizzle/0006_phase2_profiles_and_files.sql` | Additive schema migration | VERIFIED | 6 tables, correct NOT NULL + CHECK constraints |
| `drizzle/0007_phase2_rls_policies.sql` | RLS policies + mark_scan_result | VERIFIED | 19 policies, SECURITY DEFINER fn, ENABLE+FORCE RLS — confirmed applied on Supabase |
| `drizzle/0008_phase2_lookup_seed.sql` | Lookup seed data | VERIFIED | 18 rows across 3 tables, idempotent ON CONFLICT DO NOTHING |
| `src/server/db/schema/players.ts` | players + ageCategoryHistory schema | VERIFIED | CHECK constraint for minor, composite index, all FKs with ON DELETE rules |
| `src/server/db/schema/trainers.ts` | trainers schema | VERIFIED | diplomaCode FK, academy scoping through memberships |
| `src/server/db/schema/files.ts` | uploaded_files schema | VERIFIED | scan_status enum CHECK, sha256 format CHECK, UUID PK |
| `src/server/storage/magic-bytes.ts` | validateUploadMagicBytes | VERIFIED | fileTypeFromBuffer, MIME_BY_BUCKET, i18n error keys |
| `src/server/storage/signed-url.ts` | createProfilePhotoSignedUrl | VERIFIED | 1h TTL, Content-Disposition: attachment |
| `src/server/storage/profile-photo.ts` | uploadProfilePhoto | VERIFIED | UUID path, upsert:false, correct bucket |
| `src/server/workers/jobs/malware-scan.ts` | processMalwareScan | VERIFIED (code) | ClamAV TCP, mark_scan_result SQL, graceful retry |
| `src/server/trpc/routers/player.ts` | playerRouter (7 procedures) | VERIFIED (with gap) | create/get/list/updateSelf/updateOnBehalfOf/updateAsTd/setAgeCategory — missing 23514 mapping |
| `src/server/trpc/routers/trainer.ts` | trainerRouter (5 procedures) | VERIFIED | create/get/list/updateSelf/updateAsTd |
| `src/server/trpc/routers/file.ts` | fileRouter (4 procedures) | VERIFIED | upload/getSignedUrl/getScanStatus/delete — full pipeline |
| `src/components/file/photo-upload.tsx` | PhotoUpload widget | VERIFIED | Full state machine (idle/dragging/uploading/scanPending/clean/infected/scanTimeout), polling, i18n |
| `src/components/players/player-create-form.tsx` | PlayerCreateForm | VERIFIED | Two-mutation chain (admin.user.create → player.create), all sections |
| `src/components/players/player-list-table.tsx` | PlayerListTable | VERIFIED | RLS-scoped SSR initialData, tRPC hydration |
| `src/components/players/player-edit-form.tsx` | PlayerEditForm | VERIFIED | Mode-based (td/academyManager/self/parent/readOnly) |
| `src/app/[locale]/(app)/players/page.tsx` | Players list page | VERIFIED | SSR via createCaller, RLS-scoped |
| `src/app/[locale]/(app)/players/[id]/page.tsx` | Player detail page | VERIFIED | Signed URL mint, NOT_FOUND on RLS miss |
| `src/app/[locale]/(app)/trainers/page.tsx` | Trainers list page | VERIFIED | Mirrors players pattern |
| `messages/nl.json`, `messages/en.json`, `messages/fr.json` | Phase 2 i18n keys | VERIFIED | 190 leaf keys each, perfect parity |
| `src/lib/forms/zod-i18n.ts` | useZodErrorMessage adapter | VERIFIED | Strips `errors.` prefix, resolves via next-intl |
| `src/lib/players.ts` | deriveAgeCategory + getAgeCategoryAt | VERIFIED | NULL-boundary logic correct (all-open matches first row; boundaries pending TD) |

---

## 5. Key Link Verification

| From | To | Via | Status |
|------|----|-----|--------|
| `file.upload` tRPC procedure | `uploadProfilePhoto` storage helper | Direct import + call in router | WIRED |
| `file.upload` | `malwareScanQueue.add('scan', ...)` | Direct import from workers/queues | WIRED |
| `file.getSignedUrl` | `createProfilePhotoSignedUrl` | Direct import + call in router | WIRED |
| `malwareScanWorker` | `processMalwareScan` | Registered in `src/server/workers/index.ts` with concurrency=2 | WIRED |
| `processMalwareScan` | `mark_scan_result(...)` SQL fn | `db.execute(sql\`SELECT mark_scan_result(...)\`)` | WIRED |
| `playerRouter.list` | RLS `players_select` policy | `withRlsContext` middleware binds GUCs; Drizzle `findMany` runs within that context | WIRED |
| `playerRouter.create` | `academy_memberships INSERT` (WARNING-02 fix) | Transaction step 2 in `player.create` mutation | WIRED |
| `PlayerListTable` | `trpc.player.list` | `initialData` from SSR + `useQuery` hydration | WIRED |
| `PlayerCreateForm` | `admin.user.create` + `player.create` | Two-mutation chain in `onSubmit` | WIRED |
| `PhotoUpload` | `trpc.file.upload` + `trpc.file.getScanStatus` | `uploadMutation` + `scanQuery` polling | WIRED |

---

## 6. Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `PlayerListTable` | `list.data` | `trpc.player.list` → `playerRouter.list` → `db.query.players.findMany` (RLS-scoped) | Yes — Drizzle query against live tables | FLOWING |
| `PlayerDetailPage` | `player` | `trpc.player.get` → `db.query.players.findFirst` | Yes | FLOWING |
| `PhotoUpload` | `scanQuery.data.scanStatus` | `trpc.file.getScanStatus` → `db.query.uploadedFiles.findFirst` | Yes | FLOWING |
| `PlayerDetailPage` | `photoUrl` | `trpc.file.getSignedUrl` → `createProfilePhotoSignedUrl` → Supabase Storage API | Yes (requires scan_status='clean') | FLOWING |

---

## 7. Behavioral Spot-Checks

Step 7b SKIPPED — no runnable server available locally (no Redis daemon, no ClamAV, no Supabase local instance). Static verification is authoritative for this environment.

---

## 8. Requirements Coverage

All 23 Phase 2 requirements verified above. PLAYER-06 and VALID-04 are PARTIAL (see gaps).

---

## 9. Anti-Patterns Found

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| `tests/rls/players-direct-query.test.ts:74` | `INSERT INTO players (user_id, status_code, academy_code)` omits all other NOT NULL columns (`first_name`, `last_name`, `date_of_birth`, `gender`, `street`, `postal_code`, `city`, `province`, `is_minor`) | Warning | This INSERT will fail on the live Supabase DB with a NOT NULL constraint violation. The test will be RED when testcontainers run. Needs a valid full-row seed (or a DEFAULT clause fix in 0006 — but the NOT NULL columns intentionally have no defaults). Fix: use the `seedRolesMatrix` helper or a helper that provides all required columns. |
| `drizzle/0008_phase2_lookup_seed.sql:32–40` | All `born_after_or_equal`/`born_before_or_equal` are NULL | Info | `deriveAgeCategory()` returns `age_pre_minor` for every player (first row, sort_order=1, both bounds open). Not `age_unknown`. This is documented as deferred to Phase 4 but the practical effect differs from what operators expect ("category shows as Preminiemen for all players"). |
| `tests/integration/malware-scan.test.ts:44,59,110,151` | 4× `it.skip` with documented interface mismatch | Blocker (for test coverage) | 0 green tests for VALID-04 scan-status flip. |

---

## 10. Human Verification Required

### 1. Signed-URL 403 Baseline

**Test:** Obtain a profile photo storage key from the `uploaded_files` table on the Supabase staging project. Construct the raw public URL: `https://<project>.supabase.co/storage/v1/object/public/profiles/<key>`. Open in a browser (no auth).
**Expected:** HTTP 403 — bucket is `public=false`, direct object URL blocked.
**Why human:** Requires a live HTTP request to `uxgqsaphmmzholxkuuym`. Smoke check 6 confirms `public=false` but does not make a network request.

### 2. Trainer Academy-Scoping End-to-End

**Test:** Log in as a trainer assigned only to Academy Antwerpen. Navigate to `/players`. Verify only players with `academy_code='academy_antwerpen'` appear.
**Expected:** Players from other academies (Brussel, OVl, WVl, Limburg) are absent. Direct API call to `trpc.player.list` also returns only scoped rows.
**Why human:** RLS verified at DB layer (smoke check 12) and test `players-direct-query.test.ts` covers the pattern, but actual login + UI flow requires a live session.

### 3. Emergency-Contact Blocker UX (after gap is fixed)

**Test:** After the BLOCKER gap (pg 23514 → BAD_REQUEST mapping) is fixed, as a TD create a new minor player without filling emergency contact fields. Click save.
**Expected:** The form shows a localised error message ("Noodcontactpersoon verplicht voor minderjarigen" or similar) in the active locale. The form does not submit successfully. No 500 toast appears.
**Why human:** Requires UI interaction + live DB constraint enforcement.

### 4. Full Malware-Scan Pipeline on Staging

**Test:** Deploy the BullMQ worker sidecar to the Coolify staging environment (see `docs/deployment.md`). Upload an EICAR-test PNG (tests/fixtures/build-eicar-png.ts) via the PhotoUpload widget. Verify the avatar transitions to the `infected` badge within ~30s. Then upload a clean JPEG and verify it transitions to `clean`.
**Expected:** `uploaded_files.scan_status` flips from `pending` → `infected` (EICAR) or `pending` → `clean` (clean file) in the Supabase dashboard.
**Why human:** Requires ClamAV TCP daemon (clamd), Redis (BullMQ), and the worker service running together. Not available in local dev environment per IMPORTANT_RUNTIME_CONTEXT.

---

## 11. Gaps Summary

**BLOCKER — SC-5 / PLAYER-06 (Emergency contact enforcement UX):**
The Postgres CHECK constraint correctly blocks the INSERT. However, neither `player.create` nor `player.updateAsTd` catches the `23514` check_violation error code from the pg driver and re-throws it as `TRPCError({ code: 'BAD_REQUEST', message: 'errors.field.emergencyContact' })`. The result is that a TD saving a minor without emergency contact gets a generic `INTERNAL_SERVER_ERROR` (500) response — the save is technically blocked but there is no actionable feedback. The integration test at player-router.test.ts:156 expects `BAD_REQUEST` and will be RED on a live DB. Fix: add a `catch (err)` block in the transaction wrapping `insert(players)`, check `err.code === '23514'` and `err.constraint === 'players_minor_emergency_contact'`, re-throw as `TRPCError BAD_REQUEST`. Add the error key to all three i18n catalogs.

**WARNING — SC-6 / VALID-04 (Malware-scan test coverage):**
The worker implementation is correct and wired. The gap is purely in test coverage: all 4 integration tests for the scan-status flip were authored with the wrong payload shape (a `buffer` field that does not exist on `MalwareScanJobData`) and are skipped with an explicit "rewrite needed" comment. This is an execution quality gap from Wave 8. The fix is to rewrite the 3 skipped tests to mock `storageClient.storage.from().download()` returning a Buffer and `db.execute(sql)` capturing the `mark_scan_result` call — then remove the `it.skip`.

**INFO — RLS direct-query test seed issue:**
`tests/rls/players-direct-query.test.ts:74` inserts into `players` with only 3 of ~15 columns. The table has 10+ NOT NULL columns without defaults. This test will fail on a live testcontainer DB. Low priority since the test is currently infrastructure-skipped, but it will need fixing before the tests can run in CI.

---

*Verified: 2026-05-13T18:00:00Z*
*Verifier: Claude (gsd-verifier)*
