import 'server-only';

/**
 * Magic-bytes validation (VALID-02, D-23).
 *
 * Trusts the file's BYTES, never the user-agent's claim about MIME type
 * (which is trivially spoofable). The MIME_BY_BUCKET registry is the
 * single source of truth for "what files are accepted where".
 *
 * Returns TRPCError-friendly i18n-keyed errors per D-46. Callers (file.upload
 * tRPC mutation in 02-09) surface the `message` key through the next-intl
 * `useTranslations('errors')` adapter in src/lib/forms/zod-i18n.ts.
 *
 * Reference: .planning/phases/02-identiteit-bestanden/02-CONTEXT.md D-23
 *            .planning/phases/02-identiteit-bestanden/02-RESEARCH.md §Magic-bytes validation helper
 */
import { TRPCError } from '@trpc/server';
import { fileTypeFromBuffer } from 'file-type';

/**
 * Centralised MIME whitelist per bucket. Phase 2 only seeds `profiles`;
 * Phase 4 will append `evaluations`, Phase 5 will append `medical`.
 *
 * The shape `Record<string, readonly string[]>` is asserted (`satisfies`)
 * so consumers can `keyof typeof MIME_BY_BUCKET` to get the strict bucket
 * union, while still being able to extend it from a single source.
 */
export const MIME_BY_BUCKET = {
  profiles: ['image/jpeg', 'image/png'] as const,
  // Phase 4 adds 'evaluations': ['application/pdf', 'image/jpeg', 'image/png'].
  // Phase 5 adds 'medical': ['application/pdf', 'image/jpeg', 'image/png'].
} as const satisfies Record<string, readonly string[]>;

export type UploadBucket = keyof typeof MIME_BY_BUCKET;

/**
 * Verify that `buf`'s magic bytes match one of the MIME types whitelisted
 * for `bucket`. Throws BAD_REQUEST with an i18n key (never a literal
 * sentence) so the caller's error formatter can localise.
 *
 * Returns the detected `{ ext, mime }` so the caller can use them to
 * build the storage path (the canonical `ext` for the bytes, not the
 * user-supplied filename suffix).
 */
export async function validateUploadMagicBytes(
  buf: Buffer,
  bucket: UploadBucket,
): Promise<{ ext: string; mime: string }> {
  const detected = await fileTypeFromBuffer(buf);
  if (!detected) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'errors.file.unknownType',
    });
  }
  const allowed: readonly string[] = MIME_BY_BUCKET[bucket];
  if (!allowed.includes(detected.mime)) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'errors.file.disallowedType',
    });
  }
  return { ext: detected.ext, mime: detected.mime };
}
