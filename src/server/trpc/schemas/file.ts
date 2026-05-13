/**
 * Zod input schemas for file.* tRPC mutations (Plan 02-09).
 *
 * Transport: base64-in-JSON for v1 (RESEARCH §Open Questions point 2).
 * A 2 MB raw payload inflates to ~2.66 MB when base64-encoded, which sits
 * within the Next.js bodyParser `sizeLimit: '5mb'` documented in 02-16.
 * Phase 5 medical PDFs (5 MB raw → ~6.66 MB encoded) will revisit the
 * transport choice and very likely move to direct-to-Supabase-Storage
 * uploads with a signed upload URL.
 *
 * Authority model:
 *   - The client `claimedMimeType` is captured for audit only ("user
 *     said it was X"). The magic-bytes helper module (02-04) is the
 *     authoritative gate — server reads the leading bytes from the
 *     decoded buffer and rejects mismatches with `errors.file.disallowedType`.
 *   - `contentBase64.max(3 * 1024 * 1024)` is the first DoS gate
 *     (T-02-07-OVERSIZED-PAYLOAD); the server-side decode-and-measure
 *     check (`Buffer.from(...,'base64').length`) enforces the raw 2 MB
 *     cap as the second gate.
 *
 * Reference: .planning/phases/02-identiteit-bestanden/02-CONTEXT.md
 *              D-23 (file constraints), D-25 (bucket model)
 *            .planning/phases/02-identiteit-bestanden/02-RESEARCH.md
 *              §file.upload tRPC mutation skeleton
 *              §Open Questions point 2 (base64-in-JSON transport)
 */
import { z } from 'zod';

/**
 * file.upload — server runs Zod validation → size check → magic-bytes
 * sniff → Supabase Storage upload → DB row insert → BullMQ enqueue.
 *
 * `bucket` is fixed to the literal `'profiles'` for Phase 2. Phase 4 adds
 * `'evaluations'` and Phase 5 adds `'medical'`; the literal is widened
 * via a `z.enum([...])` in those plans rather than passed through as
 * free text so the server never has to validate an unknown bucket.
 */
export const fileUploadInput = z
  .object({
    bucket: z.literal('profiles'), // Phase 2 only; Phase 4/5 widen via z.enum
    /**
     * Client claim — audit only. The magic-bytes module is authoritative.
     * Bounded at 120 chars so a malicious client cannot embed a giant
     * payload in this field (MIME type per RFC 6838 §4.2 is ≤ 127 chars).
     */
    claimedMimeType: z
      .string()
      .min(1, { message: 'errors.field.required' })
      .max(120, { message: 'errors.file.disallowedType' }),
    originalFilename: z
      .string()
      .min(1, { message: 'errors.field.required' })
      .max(255, { message: 'errors.file.filenameTooLong' }),
    /**
     * base64-encoded bytes; the server decodes via `Buffer.from(...,'base64')`
     * and measures the decoded length. The schema cap (~3 MB encoded) is
     * the first DoS gate; the router's raw-length check (2 MB) is the
     * second.
     */
    contentBase64: z
      .string()
      .min(1, { message: 'errors.field.required' })
      .max(3 * 1024 * 1024, { message: 'errors.file.tooLarge' }), // ~2.25 MB raw
  })
  .strict();

/**
 * file.getSignedUrl — caller must already have visibility on the
 * `uploaded_files` row (RLS enforces); the handler returns NOT_FOUND
 * (404) when RLS hides the row, so the response shape never leaks the
 * existence of a file the caller is not allowed to see.
 */
export const fileGetSignedUrlInput = z
  .object({
    fileId: z.string().uuid(),
  })
  .strict();

/**
 * file.getScanStatus — used for polling by the `<PhotoUpload>` widget
 * (02-12). Returns one of `'pending'`, `'clean'`, `'infected'`.
 */
export const fileGetScanStatusInput = z
  .object({
    fileId: z.string().uuid(),
  })
  .strict();

/**
 * file.delete — TD only (handler enforces). Marks `superseded_at = now()`
 * on the file row and optionally removes the underlying Supabase Storage
 * object when `removeStorage = true`. The default is soft-delete so the
 * audit trail (uploaded_files row + sha256) is preserved even after the
 * blob is reaped.
 */
export const fileDeleteInput = z
  .object({
    fileId: z.string().uuid(),
    removeStorage: z.boolean().default(false),
  })
  .strict();

export type FileUploadInput = z.infer<typeof fileUploadInput>;
export type FileGetSignedUrlInput = z.infer<typeof fileGetSignedUrlInput>;
export type FileGetScanStatusInput = z.infer<typeof fileGetScanStatusInput>;
export type FileDeleteInput = z.infer<typeof fileDeleteInput>;
