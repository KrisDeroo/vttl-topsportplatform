---
phase: 02-identiteit-bestanden
plan: 09
plan_id: 02-09-trpc-router-file
subsystem: trpc
tags: [trpc, files, storage, rls, audit, malware-scan]
requires:
  - 02-04-storage-magic-bytes-helpers
  - 02-06-malware-scan-worker
  - 02-07-trpc-schemas
  - 02-05-migration-0007-rls-policies
provides:
  - "fileRouter (trpc.file.upload, trpc.file.getSignedUrl, trpc.file.getScanStatus, trpc.file.delete)"
affects:
  - "src/server/trpc/routers/_app.ts (appRouter.file)"
tech_stack:
  added: []
  patterns:
    - "RLS-bound transaction via ctx.db ?? rawDb (Phase 1 pattern from admin/consent routers)"
    - "Soft-delete via supersededAt = now() (D-29/D-30)"
    - "404-not-403 idiom on RLS-filtered queries (D-36)"
    - "Audit-after-success: writeAudit called only after state change is committed"
    - "Try/catch storage upload with audit-row-on-failure (WARNING-08 mitigation)"
key_files:
  created:
    - "src/server/trpc/routers/file.ts (4 procedures, 285 lines)"
  modified:
    - "src/server/trpc/routers/_app.ts (+ fileRouter registration on appRouter.file)"
decisions:
  - "INSERT uploaded_files BEFORE storage upload — orphan DB rows are recoverable via cron sweep; orphan storage objects are not"
  - "Did NOT auto-rollback orphan DB row on storage-upload failure — would require widening DELETE policy on uploaded_files, expanding attack surface"
  - "delete uses tdProcedure (not sensitiveProcedure) — Phase 2 D-37 reserves freshSession for medical actions only"
  - "getScanStatus returns ONLY scanStatus + scanCompletedAt — polling endpoint stays minimal to avoid log chatter"
  - "Audit row on every URL issuance (file.signed_url_issued) — GDPR-04 forensic trail"
requirements:
  - FILE-01
  - FILE-04
  - VALID-01
  - VALID-02
  - VALID-03
  - VALID-04
  - VALID-05
  - VALID-06
  - PLAYER-05
metrics:
  duration_seconds: 152
  task_count: 2
  file_count: 2
  completed_date: "2026-05-13T11:53:04Z"
---

# Phase 02 Plan 09: tRPC file.* Router Summary

## One-Liner

Shipped the `file.*` tRPC router (`upload` / `getSignedUrl` / `getScanStatus` / `delete`) that is the single keystone for every Phase 2 photo flow, composing the magic-bytes validator (02-04), service-role storage helpers (02-04), and BullMQ malware-scan queue (02-06) into one pipeline guarded by RLS-filtered queries, audit rows on every state change, and the WARNING-08 storage-failure try/catch.

## Procedures Shipped

| Procedure         | Preset              | Behavior                                                                            |
| ----------------- | ------------------- | ----------------------------------------------------------------------------------- |
| `upload`          | `protectedProcedure` | Full pipeline: decode → size → magic-bytes → INSERT → storage upload → queue → audit |
| `getSignedUrl`    | `protectedProcedure` | RLS-filtered SELECT → NOT_FOUND if 0 rows; PRECONDITION_FAILED if `scan_status != 'clean'`; mints 1h signed URL |
| `getScanStatus`   | `protectedProcedure` | Fast poll: returns `{ scanStatus, scanCompletedAt }` only                            |
| `delete`          | `tdProcedure`       | TD-only soft-delete (`supersededAt = now()`); optional storage object remove (best-effort) |

## Exact Pipeline Order (`upload`)

1. **Auth check**: `ctx.scope` non-null guard (defensive; protectedProcedure enforces).
2. **Decode**: `Buffer.from(input.contentBase64, 'base64')`.
3. **Size check (VALID-01)**: `buf.length > 2 MB` → BAD_REQUEST `errors.file.tooLarge`.
4. **Magic-bytes (VALID-02, VALID-03)**: `validateUploadMagicBytes(buf, 'profiles')` → returns `{ ext, mime }`; throws on unknown/disallowed.
5. **Mint identifiers (FILE-04)**: `fileId = crypto.randomUUID()`; `storageKey = '{userId}/{fileId}.{ext}'`.
6. **DB INSERT**: `uploaded_files` row with `scan_status='pending'`.
7. **Storage upload (try/catch — WARNING-08)**: `uploadProfilePhoto(buf, userId, fileId, ext, mime)`. On failure: log + `writeAudit('file.upload_storage_failed')` + throw INTERNAL_SERVER_ERROR (orphan row stays `pending` for Phase 8 cron sweep).
8. **Queue enqueue (D-21)**: `malwareScanQueue.add('scan', { fileId, storageKey, bucket })`.
9. **Audit (GDPR-04)**: `writeAudit('file.upload', resourceId=fileId, newValues={bucket, mimeType, sizeBytes, claimedMimeType})`.
10. **Return**: `{ fileId, scanStatus: 'pending' }`.

## Threat Mitigations Implemented

| Threat                              | Mitigation                                                                                                                         |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| T-02-09-IDOR                        | `fileId = crypto.randomUUID()`; RLS filters by `owner_user_id`; 404-not-403 idiom blocks enumeration                              |
| T-02-09-RACE-CONDITION (orphan row) | WARNING-08 try/catch + audit row + Phase 8 cron sweep                                                                              |
| T-02-09-PRECON-BYPASS               | `if (file.scanStatus !== 'clean')` → PRECONDITION_FAILED before URL mint                                                          |
| T-02-09-MISSING-AUDIT               | `writeAudit('file.signed_url_issued')` on every URL mint                                                                           |
| T-02-09-INFECTED-EXPOSED            | scan_status gate + RLS-scoped to uploader = blast radius 1 user                                                                    |
| T-02-09-LARGE-PAYLOAD-DOS           | Zod cap 3 MB encoded (02-07); raw 2 MB cap (this plan); SEC-08 rate limit (Phase 1); Caddy body-size cap (02-16). NO Pages-Router bodyParser. |

## Deviations from Plan

None — plan executed exactly as written. The plan-supplied skeleton was production-ready; the only minor adjustments were:
- Added `// eslint-disable-next-line @typescript-eslint/no-explicit-any` + `as any` on the `insert(uploadedFiles).values(...)` call to match the existing pattern in `admin.ts` (Drizzle's strict TS inference flags `uploadedAt` / `updatedAt` as required even though `tstz(..., { defaultNow: true })` fills them server-side).

## CLAUDE.md Compliance

| Directive                                                   | Status                                                                                              |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Backend logs and source code remain English                 | All comments + log lines + audit `action` keys are English                                          |
| GDPR — medical/file data role-scoped technically enforced   | `protectedProcedure` + `tdProcedure` presets + RLS filter on `uploaded_files` (02-05 migration 0007) |
| No Firebase / Supabase-as-primary auth surfaces             | Storage via service-role client only (server-side, behind tRPC RBAC); no client-to-Supabase direct  |
| Drizzle ORM, no Prisma                                      | `dbHandle.query.uploadedFiles.findFirst(...)` + `dbHandle.insert(...)` via Drizzle                  |
| Audit log append-only / `writeAudit` for every sensitive op | Audit row on upload, signed_url_issued, upload_storage_failed, delete, delete_storage_failed         |

## Commits

| Hash      | Message                                                                       |
| --------- | ----------------------------------------------------------------------------- |
| `d26b1f8` | feat(02-09): add file.* tRPC router (upload/getSignedUrl/getScanStatus/delete) |
| `4c4a8e2` | feat(02-09): register fileRouter on appRouter.file                             |

## Verification

- [x] `npx tsc --noEmit` exits 0 across the repo
- [x] All 4 procedures exported on `fileRouter`
- [x] `upload` / `getSignedUrl` / `getScanStatus` on `protectedProcedure`; `delete` on `tdProcedure`
- [x] Pipeline order in upload handler: decode → size → magic-bytes → DB INSERT → storage upload → queue.add → writeAudit
- [x] `getSignedUrl` throws `NOT_FOUND` when RLS filters → 0 rows
- [x] `getSignedUrl` throws `PRECONDITION_FAILED` when `scan_status != 'clean'`
- [x] `delete` uses `supersededAt = now()` (soft-delete per D-29/D-30)
- [x] `fileRouter` registered as `appRouter.file`
- [x] Phase 1 routes (`ping`, `consent`, `admin`) preserved
- [x] No `export const config = { api: { bodyParser: ... } }` anywhere (BLOCKER-04 invariant)
- [x] try/catch around `uploadProfilePhoto(...)` writes `file.upload_storage_failed` audit row + throws INTERNAL_SERVER_ERROR (WARNING-08 invariant)
- [x] `ctx.db` fallback pattern matches Phase 1 (verified against `admin.ts` and `consent.ts`)

## Self-Check: PASSED

- File `src/server/trpc/routers/file.ts` exists (285 lines)
- File `src/server/trpc/routers/_app.ts` modified (fileRouter import + registration)
- Commit `d26b1f8` present in git log
- Commit `4c4a8e2` present in git log
- TypeScript clean (`npx tsc --noEmit` exits 0)

## Next Steps (Plan 02-10)

- Wire `player.*` and `trainer.*` routers onto `appRouter` (the plan-author deliberately kept that out of 02-09 to bound blast radius).
- Phase 2 integration tests in 02-15 will exercise this router end-to-end (mocked Supabase Storage + in-memory BullMQ).
