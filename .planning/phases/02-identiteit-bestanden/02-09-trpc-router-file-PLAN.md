---
phase: 02-identiteit-bestanden
plan_id: 02-09-trpc-router-file
plan: 09
type: execute
wave: 4
depends_on: [02-04-storage-magic-bytes-helpers, 02-06-malware-scan-worker, 02-07-trpc-schemas, 02-05-migration-0007-rls-policies]
files_modified:
  - src/server/trpc/routers/file.ts
  - src/server/trpc/routers/_app.ts
autonomous: true
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

must_haves:
  truths:
    - "file.upload tRPC mutation runs the full pipeline: Zod → size → magic-bytes → INSERT uploaded_files (scan_status=pending) → Supabase Storage upload → BullMQ enqueue → writeAudit → return {fileId, scanStatus}"
    - "file.getSignedUrl checks RBAC FIRST (queries uploaded_files via RLS — 0 rows = NOT_FOUND), refuses when scan_status != 'clean', returns 1h TTL signed URL"
    - "file.getScanStatus is a fast polling endpoint (returns scan_status + scan_completed_at only)"
    - "file.delete (TD only) marks uploaded_files.superseded_at = now() and optionally removes storage object"
    - "fileRouter registered in src/server/trpc/routers/_app.ts under appRouter.file"
  artifacts:
    - path: "src/server/trpc/routers/file.ts"
      provides: "fileRouter with upload/getSignedUrl/getScanStatus/delete"
      contains: "malwareScanQueue.add"
      min_lines: 150
    - path: "src/server/trpc/routers/_app.ts"
      provides: "appRouter extended with file:"
      contains: "fileRouter"
  key_links:
    - from: "src/server/trpc/routers/file.ts (upload)"
      to: "src/server/storage/magic-bytes.ts (validateUploadMagicBytes)"
      via: "import + call in mutation handler"
      pattern: "validateUploadMagicBytes\\("
    - from: "src/server/trpc/routers/file.ts (upload)"
      to: "src/server/storage/profile-photo.ts (uploadProfilePhoto)"
      via: "import + call after DB INSERT"
      pattern: "uploadProfilePhoto\\("
    - from: "src/server/trpc/routers/file.ts (upload)"
      to: "src/server/workers/queues.ts (malwareScanQueue)"
      via: "malwareScanQueue.add('scan', {fileId, storageKey, bucket})"
      pattern: "malwareScanQueue\\.add"
    - from: "src/server/trpc/routers/file.ts (getSignedUrl)"
      to: "src/server/storage/signed-url.ts (createProfilePhotoSignedUrl)"
      via: "import + call after RBAC check"
      pattern: "createProfilePhotoSignedUrl\\("
---

<objective>
Ship the `file.*` tRPC router (4 procedures: `upload`, `getSignedUrl`, `getScanStatus`, `delete`). This is the keystone of the entire file pipeline — every Phase 2 photo flow goes through here.

**Upload pipeline (D-21, D-23, FILE-01..04, VALID-01..06):**
1. `protectedProcedure` enforces auth + RLS context.
2. Zod `fileUploadInput.parse(input)` (02-07).
3. Decode base64, check `buf.length <= 2 * 1024 * 1024` (VALID-01).
4. `validateUploadMagicBytes(buf, 'profiles')` (02-04, VALID-02 + VALID-03).
5. Mint `fileId = crypto.randomUUID()` and `storageKey = '{userId}/{fileId}.{ext}'`.
6. INSERT `uploaded_files` row with `scan_status='pending'`.
7. Call `uploadProfilePhoto(buf, userId, fileId, ext, mime)` (02-04) — service-role write.
8. `malwareScanQueue.add('scan', { fileId, storageKey, bucket })` (02-06).
9. `writeAudit(ctx, { action: 'file.upload', ... })` (Phase 1).
10. Return `{ fileId, scanStatus: 'pending' }`.

**Signed URL flow (FILE-01, D-24):**
1. `protectedProcedure`.
2. SELECT uploaded_files via RLS → 0 rows = `NOT_FOUND` (D-36 idiom).
3. If `scan_status != 'clean'` → `PRECONDITION_FAILED`.
4. Call `createProfilePhotoSignedUrl(storageKey, 3600)` (02-04, includes Content-Disposition).
5. Return `{ url, expiresAt }`.

Output: `file.ts` router file + `_app.ts` registration update.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/phases/02-identiteit-bestanden/02-CONTEXT.md
@.planning/phases/02-identiteit-bestanden/02-RESEARCH.md
@.planning/phases/02-identiteit-bestanden/02-04-storage-magic-bytes-helpers-PLAN.md
@.planning/phases/02-identiteit-bestanden/02-06-malware-scan-worker-PLAN.md
@.planning/phases/02-identiteit-bestanden/02-07-trpc-schemas-PLAN.md
@src/server/trpc/routers/admin.ts
@src/server/trpc/middleware/freshSession.ts
@src/server/trpc/middleware/audit.ts
@CLAUDE.md

<interfaces>
<!-- Phase 1 + Phase 2 primitives this router composes: -->

```typescript
// Procedures (Phase 1, src/server/trpc/middleware/freshSession.ts)
protectedProcedure  // auth + RLS + consent gate
tdProcedure         // protected + role('technical_director')
sensitiveProcedure  // protected + freshSession

// Audit (Phase 1, src/server/trpc/middleware/audit.ts)
writeAudit(ctx, { action, resourceType, resourceId, newValues, oldValues? })

// Storage helpers (Phase 2, 02-04)
validateUploadMagicBytes(buf: Buffer, bucket: 'profiles'): Promise<{ext, mime}>
uploadProfilePhoto(buf: Buffer, userId: string, fileId: string, ext: string, mime: string): Promise<{storageKey}>
createProfilePhotoSignedUrl(storageKey: string, ttl?: number): Promise<{url, expiresAt}>
storageClient: SupabaseClient   // for delete-storage-object

// Queue (Phase 2, 02-06)
malwareScanQueue.add('scan', { fileId, storageKey, bucket })

// Schemas (Phase 2, 02-07)
fileUploadInput, fileGetSignedUrlInput, fileGetScanStatusInput, fileDeleteInput

// DB schema (Phase 2, 02-02)
uploadedFiles
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="false">
  <name>Task 1: Create src/server/trpc/routers/file.ts with 4 procedures</name>
  <read_first>
    - src/server/trpc/routers/admin.ts (entire file — pattern for tdProcedure, writeAudit usage, ctx.db handle)
    - src/server/trpc/schemas/file.ts (02-07 — locked input shapes)
    - src/server/storage/*.ts (02-04 — helpers to compose)
    - src/server/workers/queues.ts (02-06 — malwareScanQueue export)
    - src/server/db/schema/files.ts (uploadedFiles type)
    - .planning/phases/02-identiteit-bestanden/02-RESEARCH.md §file.upload tRPC mutation skeleton (canonical sketch)
    - .planning/phases/02-identiteit-bestanden/02-CONTEXT.md D-21..D-25, D-36 (404 idiom)
  </read_first>
  <files>
    src/server/trpc/routers/file.ts
  </files>
  <action>
    ```typescript
    /**
     * file.* tRPC router (Phase 2 — D-21..D-25, VALID-01..06, FILE-01..04).
     *
     * Surface contract:
     *   - upload          — protectedProcedure. Full pipeline: validate → DB row
     *                       (scan_status=pending) → service-role storage upload
     *                       → BullMQ malware-scan enqueue → audit.
     *   - getSignedUrl    — protectedProcedure. RBAC-check via RLS, refuse if
     *                       scan_status != 'clean', mint 1h signed URL with
     *                       Content-Disposition: attachment (VALID-05).
     *   - getScanStatus   — protectedProcedure. Fast polling endpoint.
     *   - delete          — tdProcedure. Marks superseded_at = now(); optionally
     *                       removes the storage object.
     *
     * D-36 idiom: out-of-scope rows resolve via RLS to zero rows → throw
     * NOT_FOUND, not FORBIDDEN. Prevents enumeration.
     *
     * Reference: .planning/phases/02-identiteit-bestanden/02-CONTEXT.md §A
     *            .planning/phases/02-identiteit-bestanden/02-RESEARCH.md §file.upload
     *              tRPC mutation skeleton + §getSignedUrl
     */
    import { TRPCError } from '@trpc/server';
    import { eq } from 'drizzle-orm';

    import { db as rawDb, type DbClient } from '@/server/db/client';
    import { uploadedFiles } from '@/server/db/schema/files';
    import { storageClient } from '@/server/storage/client';
    import { validateUploadMagicBytes } from '@/server/storage/magic-bytes';
    import { uploadProfilePhoto } from '@/server/storage/profile-photo';
    import {
      createProfilePhotoSignedUrl,
      PROFILE_PHOTO_TTL_SECONDS,
    } from '@/server/storage/signed-url';
    import { malwareScanQueue } from '@/server/workers/queues';
    import {
      fileDeleteInput,
      fileGetScanStatusInput,
      fileGetSignedUrlInput,
      fileUploadInput,
    } from '../schemas/file';
    import { writeAudit } from '../middleware/audit';
    import { protectedProcedure, tdProcedure } from '../middleware/freshSession';
    import { router } from '../trpc';
    import { log } from '@/lib/log';

    const MAX_PROFILE_PHOTO_BYTES = 2 * 1024 * 1024;  // 2 MB per VALID-01

    export const fileRouter = router({
      /**
       * Upload a file. Pipeline order is load-bearing — fail fast on cheap
       * checks before paying for storage I/O. See D-23 + RESEARCH §Pattern 5.
       */
      upload: protectedProcedure
        .input(fileUploadInput)
        .mutation(async ({ ctx, input }) => {
          if (!ctx.scope) {
            throw new TRPCError({ code: 'UNAUTHORIZED' });
          }
          const userId = ctx.scope.userId;
          const dbHandle = (ctx.db as DbClient | undefined) ?? rawDb;

          // 1. Decode and size-check (VALID-01).
          const buf = Buffer.from(input.contentBase64, 'base64');
          if (buf.length > MAX_PROFILE_PHOTO_BYTES) {
            throw new TRPCError({
              code: 'BAD_REQUEST',
              message: 'errors.file.tooLarge',
            });
          }

          // 2. Magic-bytes (VALID-02, VALID-03 — bucket whitelist).
          const { ext, mime } = await validateUploadMagicBytes(buf, input.bucket);

          // 3. Mint identifiers (FILE-04 — UUID filename).
          const fileId = crypto.randomUUID();
          const storageKey = `${userId}/${fileId}.${ext}`;

          // 4. INSERT uploaded_files row FIRST (orphan DB row is recoverable;
          //    orphan storage object is harder — see RESEARCH §Open Q 3).
          await dbHandle.insert(uploadedFiles).values({
            id: fileId,
            ownerUserId: userId,
            bucket: input.bucket,
            storageKey,
            originalFilename: input.originalFilename,
            mimeType: mime,
            sizeBytes: buf.length,
            scanStatus: 'pending',
          });

          // 5. Service-role storage upload. WARNING-08 fix: if the upload
          //    throws, undo the INSERT so the orphan row stays transient
          //    rather than waiting for the Phase 8 cron sweep. The DELETE
          //    runs as `app_user`; the `uploaded_files_delete` policy
          //    permits TD-only, so we use a SECURITY DEFINER-light
          //    approach: the row we just inserted is owned by us, but the
          //    DELETE policy doesn't allow owner. So we have two options:
          //    (a) widen `uploaded_files_delete` to allow owner — but that
          //    expands DELETE surface unnecessarily, or (b) catch the
          //    failure and let the cron sweep clean it. We do (b): log
          //    loudly, surface a tRPC error, and rely on Phase 8 sweep.
          //    The row stays `scan_status='pending'`; UI shows
          //    "scan_pending" timeout state until cron cleans it.
          try {
            await uploadProfilePhoto(buf, userId, fileId, ext, mime);
          } catch (uploadErr) {
            log.error(
              {
                fileId,
                storageKey,
                bucket: input.bucket,
                err: uploadErr instanceof Error ? uploadErr.message : String(uploadErr),
              },
              'file.upload.storage_failed_orphan_row',
            );
            await writeAudit(ctx, {
              action: 'file.upload_storage_failed',
              resourceType: 'uploaded_file',
              resourceId: fileId,
              newValues: { bucket: input.bucket, sizeBytes: buf.length },
            });
            throw new TRPCError({
              code: 'INTERNAL_SERVER_ERROR',
              message: 'errors.file.uploadFailed',
            });
          }

          // 6. Enqueue malware scan (D-21).
          await malwareScanQueue.add('scan', {
            fileId,
            storageKey,
            bucket: input.bucket,
          });

          // 7. Audit (GDPR-04).
          await writeAudit(ctx, {
            action: 'file.upload',
            resourceType: 'uploaded_file',
            resourceId: fileId,
            newValues: {
              bucket: input.bucket,
              mimeType: mime,
              sizeBytes: buf.length,
              // claimedMimeType captured for forensics — original_filename
              // intentionally omitted from audit (PII).
              claimedMimeType: input.claimedMimeType,
            },
          });

          return { fileId, scanStatus: 'pending' as const };
        }),

      /**
       * Mint a signed URL for a clean file. D-24: 1 hour TTL; D-36: 404 not 403
       * for out-of-scope rows (RLS does the filtering for free).
       */
      getSignedUrl: protectedProcedure
        .input(fileGetSignedUrlInput)
        .query(async ({ ctx, input }) => {
          const dbHandle = (ctx.db as DbClient | undefined) ?? rawDb;

          // RLS filters this query — out-of-scope = 0 rows.
          const file = await dbHandle.query.uploadedFiles.findFirst({
            where: eq(uploadedFiles.id, input.fileId),
          });
          if (!file) {
            throw new TRPCError({ code: 'NOT_FOUND' });
          }
          if (file.scanStatus !== 'clean') {
            throw new TRPCError({
              code: 'PRECONDITION_FAILED',
              message: 'errors.file.scanNotClean',
            });
          }

          const { url, expiresAt } = await createProfilePhotoSignedUrl(
            file.storageKey,
            PROFILE_PHOTO_TTL_SECONDS,
          );

          // Audit (GDPR-04 — every URL issuance leaves a trail).
          await writeAudit(ctx, {
            action: 'file.signed_url_issued',
            resourceType: 'uploaded_file',
            resourceId: file.id,
            newValues: { ttlSeconds: PROFILE_PHOTO_TTL_SECONDS },
          });

          return { url, expiresAt };
        }),

      /**
       * Polling endpoint for the PhotoUpload widget (02-12). Returns minimal
       * fields to keep response small and not chatty in logs.
       */
      getScanStatus: protectedProcedure
        .input(fileGetScanStatusInput)
        .query(async ({ ctx, input }) => {
          const dbHandle = (ctx.db as DbClient | undefined) ?? rawDb;
          const file = await dbHandle.query.uploadedFiles.findFirst({
            where: eq(uploadedFiles.id, input.fileId),
            columns: {
              scanStatus: true,
              scanCompletedAt: true,
            },
          });
          if (!file) {
            throw new TRPCError({ code: 'NOT_FOUND' });
          }
          return file;
        }),

      /**
       * Mark a file as superseded. TD-only — Phase 2 does not expose generic
       * file delete to non-TD callers (audit-trail integrity).
       */
      delete: tdProcedure
        .input(fileDeleteInput)
        .mutation(async ({ ctx, input }) => {
          const dbHandle = (ctx.db as DbClient | undefined) ?? rawDb;
          const file = await dbHandle.query.uploadedFiles.findFirst({
            where: eq(uploadedFiles.id, input.fileId),
          });
          if (!file) {
            throw new TRPCError({ code: 'NOT_FOUND' });
          }

          await dbHandle
            .update(uploadedFiles)
            .set({ supersededAt: new Date() })
            .where(eq(uploadedFiles.id, input.fileId));

          if (input.removeStorage) {
            // Best-effort remove; failure does not roll back the DB update.
            const { error } = await storageClient.storage
              .from(file.bucket)
              .remove([file.storageKey]);
            if (error) {
              // Log via pino (auditable failure); do NOT throw — the row is
              // already soft-deleted and the storage object can be cleaned up
              // by a Phase 8 cron sweep.
              await writeAudit(ctx, {
                action: 'file.delete_storage_failed',
                resourceType: 'uploaded_file',
                resourceId: file.id,
                newValues: { error: error.message },
              });
            }
          }

          await writeAudit(ctx, {
            action: 'file.delete',
            resourceType: 'uploaded_file',
            resourceId: file.id,
            oldValues: { supersededAt: file.supersededAt },
            newValues: { supersededAt: new Date(), removeStorage: input.removeStorage },
          });

          return { ok: true as const };
        }),
    });
    ```

    Do NOT call `writeAudit` BEFORE the storage upload succeeds — audit semantics are "what actually happened", not "what we attempted".
    Do NOT log `input.contentBase64` or the buffer; the redact paths cover `*.password` etc. but not arbitrary base64. Pino redact + the explicit choice to never log `buf` here are the two layers.
    Do NOT return the `storageKey` from `getScanStatus` — keep the polling response minimal.
  </action>
  <verify>
    <automated>test -f src/server/trpc/routers/file.ts && grep -q "export const fileRouter = router" src/server/trpc/routers/file.ts && grep -q "validateUploadMagicBytes" src/server/trpc/routers/file.ts && grep -q "uploadProfilePhoto" src/server/trpc/routers/file.ts && grep -q "malwareScanQueue.add" src/server/trpc/routers/file.ts && grep -q "createProfilePhotoSignedUrl" src/server/trpc/routers/file.ts && grep -q "MAX_PROFILE_PHOTO_BYTES = 2 \* 1024 \* 1024" src/server/trpc/routers/file.ts && grep -q "writeAudit" src/server/trpc/routers/file.ts && grep -q "tdProcedure" src/server/trpc/routers/file.ts && grep -q "code: 'NOT_FOUND'" src/server/trpc/routers/file.ts && grep -q "code: 'PRECONDITION_FAILED'" src/server/trpc/routers/file.ts && grep -q "PROFILE_PHOTO_TTL_SECONDS" src/server/trpc/routers/file.ts && npx tsc --noEmit 2>&1 | (! grep -i "error.*routers/file\.ts")</automated>
  </verify>
  <acceptance_criteria>
    - 4 procedures exported on `fileRouter`: `upload`, `getSignedUrl`, `getScanStatus`, `delete`
    - `upload` uses `protectedProcedure`; `delete` uses `tdProcedure`
    - Pipeline order in upload handler: decode → size → magic-bytes → DB INSERT → storage upload → queue.add → writeAudit
    - `getSignedUrl` throws `NOT_FOUND` when RLS filters → 0 rows
    - `getSignedUrl` throws `PRECONDITION_FAILED` when scan_status != 'clean'
    - `delete` uses `supersededAt = now()` (soft-delete per D-29/D-30)
    - `npx tsc --noEmit` exits 0
  </acceptance_criteria>
  <done>fileRouter ready for _app.ts wiring + tests in 02-15.</done>
</task>

<task type="auto" tdd="false">
  <name>Task 2: Register fileRouter in src/server/trpc/routers/_app.ts</name>
  <read_first>
    - src/server/trpc/routers/_app.ts (current shape — Phase 1 has ping/consent/admin)
    - src/server/trpc/routers/file.ts (just created in Task 1)
  </read_first>
  <files>
    src/server/trpc/routers/_app.ts
  </files>
  <action>
    Add the import and register `file:` on `appRouter`:

    ```typescript
    import { fileRouter } from './file';

    export const appRouter = router({
      ping: publicProcedure.query(() => ({ ok: true, ts: Date.now() })),
      consent: consentRouter,
      admin: adminRouter,
      file: fileRouter,  // NEW (Phase 2)
    });
    ```

    Update the JSDoc header — under "Sub-routers attached" add:

    ```
     *   - file.*           — Phase 2 (upload / getSignedUrl / getScanStatus / delete)
    ```

    Do NOT register `player.*` or `trainer.*` here — those land in plan 02-10 to keep blast radius bounded.
  </action>
  <verify>
    <automated>grep -q "import { fileRouter } from './file'" src/server/trpc/routers/_app.ts && grep -q "file: fileRouter" src/server/trpc/routers/_app.ts && grep -q "appRouter = router" src/server/trpc/routers/_app.ts && npx tsc --noEmit 2>&1 | (! grep -i "error.*routers/_app\.ts")</automated>
  </verify>
  <acceptance_criteria>
    - `fileRouter` imported and attached as `file:`
    - Phase 1 routes (`ping`, `consent`, `admin`) preserved
    - `npx tsc --noEmit` exits 0
  </acceptance_criteria>
  <done>tRPC client now sees `trpc.file.upload`, `trpc.file.getSignedUrl`, etc.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Client base64 ↔ server buffer | All authoritative file checks happen after `Buffer.from(...)` on the server |
| `uploaded_files` row creation order ↔ storage write | DB row first (recoverable orphans), storage second |
| Signed URL minting ↔ RBAC | RLS filters BEFORE TTL — D-24 explicit |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-02-09-IDOR | Information Disclosure | Predictable fileId in getSignedUrl request | mitigate | `fileId` is `crypto.randomUUID()` (D-25); RLS-filter returns 0 rows for out-of-scope; D-36 idiom 404-not-403 |
| T-02-09-RACE-CONDITION | Tampering | DB row inserted but storage upload fails (orphan row) | mitigate | WARNING-08 fix: try/catch around storage upload writes a `file.upload_storage_failed` audit row and surfaces an INTERNAL_SERVER_ERROR to the client. Row stays `scan_status='pending'`; Phase 8 OPS cron sweeps stale `pending` rows (uploaded > 5 min, no storage object). Audit row gives operators correlation key. |
| T-02-09-PRECON-BYPASS | Information Disclosure | URL minted for `pending` file | mitigate | Explicit `if (file.scanStatus !== 'clean')` guard throws PRECONDITION_FAILED |
| T-02-09-MISSING-AUDIT | Repudiation | URL issued without audit row | mitigate | `writeAudit` call after URL mint; covered by integration test in 02-15 |
| T-02-09-INFECTED-EXPOSED | Malicious Code | `infected` file served via signed URL | mitigate | scan_status check returns PRECONDITION_FAILED; the row is also visible only to the uploader (RLS) so blast radius is 1 user |
| T-02-09-LARGE-PAYLOAD-DOS | Denial of Service | base64 > 3 MB hits the App Router request body | mitigate | BLOCKER-04 fix: the Pages-Router-style `config.api.bodyParser.sizeLimit` is a no-op on App Router and was misleading. Real defenses are: (a) Zod schema cap `contentBase64.max(3 * 1024 * 1024)` — application-level, type-safe; (b) Coolify/Caddy reverse-proxy body-size cap (set in 02-16 deployment doc); (c) SEC-08 rate limit on protectedProcedure (10/min/user — Phase 1). |
| T-02-09-FRESH-SESSION-MISSING | Elevation of Privilege | File delete done without re-auth on TD | accept | Phase 2 scope: TD file deletion is not in the "sensitive" set per Phase 1 D-37 (medical actions require freshSession). If post-launch we find this needs SEC-03, swap `tdProcedure` → `tdProcedure.use(requireFreshSession)`. |
</threat_model>

<verification>
- 4 procedures registered on the router; client gets typed `trpc.file.*` calls
- Pipeline order on upload is correct (cheap checks first)
- writeAudit called on every state-changing path
- `npx tsc --noEmit` exits 0
</verification>

<success_criteria>
- fileRouter compiled, wired into appRouter
- All VALID-01..06 + FILE-01..04 + PLAYER-05 enforcement points present
- D-36 404 idiom implemented
- 1-hour signed URL TTL with Content-Disposition: attachment
- Audit row on every upload + URL issuance + delete
</success_criteria>

<output>
After completion, create `.planning/phases/02-identiteit-bestanden/02-09-SUMMARY.md` listing the 4 procedures, their procedure presets, and the exact pipeline order in `upload`.
</output>
