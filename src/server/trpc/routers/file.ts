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
 * WARNING-08 (Phase 2 code review): the `uploadProfilePhoto` call is wrapped
 * in a try/catch that writes a `file.upload_storage_failed` audit row and
 * surfaces an INTERNAL_SERVER_ERROR to the client. The orphan
 * `uploaded_files` row stays at `scan_status='pending'` until the Phase 8
 * OPS cron sweep cleans it (rows older than 5 minutes with no storage
 * object). The DELETE policy on `uploaded_files` is TD-only so a
 * defensive auto-rollback is not possible without widening DELETE surface
 * (rejected — keeps the policy minimal).
 *
 * BLOCKER-04 (Phase 2 code review): NO `export const config = { api: {
 * bodyParser: ... } }` here — that is Pages-Router syntax and a no-op in
 * App Router. Body-size protection is enforced at three other layers:
 *   1. `fileUploadInput.contentBase64.max(3 * 1024 * 1024)` (02-07 Zod)
 *   2. Caddy reverse-proxy `request_body { max_size }` (02-16 deployment)
 *   3. SEC-08 rate-limit on protectedProcedure (10/min/user, Phase 1)
 *
 * Reference: .planning/phases/02-identiteit-bestanden/02-CONTEXT.md §A
 *            .planning/phases/02-identiteit-bestanden/02-RESEARCH.md §file.upload
 *              tRPC mutation skeleton + §getSignedUrl
 */
import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';

import { log } from '@/lib/log';
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

import { writeAudit } from '../middleware/audit';
import { protectedProcedure, tdProcedure } from '../middleware/freshSession';
import {
  fileDeleteInput,
  fileGetScanStatusInput,
  fileGetSignedUrlInput,
  fileUploadInput,
} from '../schemas/file';
import { router } from '../trpc';

/** 2 MB raw cap per VALID-01. Decoded buffer length is the authoritative
 *  size — the Zod `contentBase64.max(3MB)` is the encoded-payload guard
 *  before this measurement. */
const MAX_PROFILE_PHOTO_BYTES = 2 * 1024 * 1024;

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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await dbHandle.insert(uploadedFiles).values({
        id: fileId,
        ownerUserId: userId,
        bucket: input.bucket,
        storageKey,
        originalFilename: input.originalFilename,
        mimeType: mime,
        sizeBytes: buf.length,
        scanStatus: 'pending',
      } as any);

      // 5. Service-role storage upload. WARNING-08 fix: if the upload
      //    throws, log + write a `file.upload_storage_failed` audit row +
      //    surface INTERNAL_SERVER_ERROR. The orphan `uploaded_files`
      //    row stays at scan_status='pending'; Phase 8 OPS cron sweeps
      //    stale `pending` rows (uploaded > 5 min, no storage object).
      //    The DELETE policy on uploaded_files is TD-only (02-05) so we
      //    cannot self-rollback the INSERT from `app_user` — widening
      //    DELETE surface would expand attack surface unnecessarily.
      try {
        await uploadProfilePhoto(buf, userId, fileId, ext, mime);
      } catch (uploadErr) {
        log.error(
          {
            fileId,
            storageKey,
            bucket: input.bucket,
            err:
              uploadErr instanceof Error
                ? uploadErr.message
                : String(uploadErr),
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

      // 7. Audit (GDPR-04). Captured AFTER the storage write succeeds
      //    so the audit row reflects "what actually happened", not
      //    "what we attempted".
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
        newValues: {
          supersededAt: new Date(),
          removeStorage: input.removeStorage,
        },
      });

      return { ok: true as const };
    }),
});
