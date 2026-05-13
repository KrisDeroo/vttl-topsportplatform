import 'server-only';

/**
 * Server-side signed URL generation (FILE-01, D-24, VALID-05).
 *
 * Every signed URL caller MUST do its own RBAC check BEFORE calling this
 * helper (D-24 + RISK-FILE-SCOPE) — TTL alone is not a substitute. The
 * helper is intentionally dumb: given a storage_key + TTL, mint a URL.
 *
 * `download: storageKey-derived-filename` forces `Content-Disposition:
 * attachment` (VALID-05) so the browser cannot interpret an unexpected
 * file type as inline HTML/script.
 *
 * Reference: .planning/phases/02-identiteit-bestanden/02-CONTEXT.md D-24
 *            .planning/phases/02-identiteit-bestanden/02-RESEARCH.md §Open Questions
 */
import { TRPCError } from '@trpc/server';

import { storageClient } from './client';

/** D-24: 1 hour TTL for profile-photo signed URLs (FILE-01 ROADMAP). */
export const PROFILE_PHOTO_TTL_SECONDS = 60 * 60;

/**
 * Mint a time-limited signed URL for a profile photo. The caller is
 * responsible for confirming that the requesting user is allowed to
 * read this file — this helper does NOT check authorisation.
 *
 * Storage path convention is `profiles/{userId}/{uuid}.{ext}` (per D-25);
 * the bucket name `profiles` is hard-coded here because this helper is
 * profile-photo specific. Evaluations + medical buckets will get their
 * own helpers in Phase 4 / Phase 5 with their own TTLs.
 */
export async function createProfilePhotoSignedUrl(
  storageKey: string,
  ttlSeconds: number = PROFILE_PHOTO_TTL_SECONDS,
): Promise<{ url: string; expiresAt: Date }> {
  // Derive the filename suggestion from the storage key (last path segment).
  // Storage policy: storage_key is `{userId}/{uuid}.{ext}` (bucket = 'profiles').
  const filename = storageKey.split('/').pop() ?? 'photo.bin';

  const { data, error } = await storageClient.storage
    .from('profiles')
    .createSignedUrl(storageKey, ttlSeconds, { download: filename });

  if (error || !data) {
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'errors.file.signedUrlFailed',
    });
  }

  return {
    url: data.signedUrl,
    expiresAt: new Date(Date.now() + ttlSeconds * 1000),
  };
}
