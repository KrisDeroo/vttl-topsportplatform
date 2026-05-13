import 'server-only';

/**
 * Profile photo upload helper (D-25, FILE-04).
 *
 * Generates a UUID storage key, never the original filename — predictable
 * keys leak user-supplied content and can collide. The bucket path template
 * `profiles/{userId}/{uuid}.{ext}` co-locates a user's files under their
 * own folder so Phase 5+ can write per-folder RLS policies (Pattern 6).
 *
 * The caller (file.upload tRPC mutation in 02-09) inserts the
 * `uploaded_files` row BEFORE calling this helper; this function only
 * handles the bytes-to-storage write. To keep the DB row id and the
 * storage-key UUID linked, the caller mints the UUID once and passes it
 * here as `fileId`.
 *
 * Reference: .planning/phases/02-identiteit-bestanden/02-CONTEXT.md D-25
 *            .planning/phases/02-identiteit-bestanden/02-RESEARCH.md §Pattern 6
 */
import { TRPCError } from '@trpc/server';

import { storageClient } from './client';

export interface UploadProfilePhotoResult {
  /**
   * Path WITHIN the `profiles` bucket: `{userId}/{fileId}.{ext}`. The
   * fully-qualified storage_key stored on `uploaded_files` is composed
   * by the tRPC mutation (it joins the bucket name `profiles` with this
   * path). Keeping bucket separate from path matches the
   * `uploaded_files.bucket` column shape locked in 02-02 / 02-03.
   */
  storageKey: string;
}

/**
 * Upload `buf` to `profiles/{userId}/{fileId}.{ext}` with the detected
 * `mime` content-type. Caller must mint `fileId` (`crypto.randomUUID()`)
 * so the DB row id and the storage key UUID stay linked.
 *
 * `upsert: false` is explicit — UUID makes collisions impossible, and
 * silently overwriting an existing key would mask a bug.
 */
export async function uploadProfilePhoto(
  buf: Buffer,
  userId: string,
  fileId: string,
  ext: string,
  mime: string,
): Promise<UploadProfilePhotoResult> {
  const storageKey = `${userId}/${fileId}.${ext}`;

  const { error } = await storageClient.storage
    .from('profiles')
    .upload(storageKey, buf, {
      contentType: mime,
      upsert: false,
    });

  if (error) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'errors.file.uploadFailed',
    });
  }

  return { storageKey };
}
