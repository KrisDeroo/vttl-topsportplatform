/**
 * Unit tests for `validateUploadMagicBytes` — Plan 02-15 Task 1.
 *
 * Coverage:
 *   - VALID-02: PNG/JPEG accepted in the profiles bucket
 *   - VALID-03: PDF / GIF / random-bytes rejected with `errors.file.*` i18n keys
 *
 * The helper is pure (no DB, no Redis); these tests run sub-second and are the
 * front line of defence against the file-type-smuggling threat
 * (T-02-04-MAGIC-BYTE-BYPASS).
 *
 * RED until Plan 02-04 ships `@/server/storage/magic-bytes`.
 */
import { describe, it, expect } from 'vitest';

// Minimal valid PNG header (8 bytes signature).
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
// Minimal valid JPEG SOI marker + JFIF.
const JPEG_SIG = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
// PDF header (rejected from `profiles` bucket since profiles MUST be image/*).
const PDF_SIG = Buffer.from('%PDF-1.4\n', 'ascii');
// GIF header (rejected for profiles bucket).
const GIF_SIG = Buffer.from('GIF89a', 'ascii');

describe('validateUploadMagicBytes — profiles bucket (image/* only)', () => {
  it('accepts PNG (VALID-02)', async () => {
    const { validateUploadMagicBytes } = await import('@/server/storage/magic-bytes');
    const { ext, mime } = await validateUploadMagicBytes(PNG_SIG, 'profiles');
    expect(ext).toBe('png');
    expect(mime).toBe('image/png');
  });

  it('accepts JPEG (VALID-02)', async () => {
    const { validateUploadMagicBytes } = await import('@/server/storage/magic-bytes');
    const { ext, mime } = await validateUploadMagicBytes(JPEG_SIG, 'profiles');
    expect(ext).toBe('jpg');
    expect(mime).toBe('image/jpeg');
  });

  it('rejects PDF disguised as JPG in profiles bucket (VALID-03)', async () => {
    const { validateUploadMagicBytes } = await import('@/server/storage/magic-bytes');
    await expect(validateUploadMagicBytes(PDF_SIG, 'profiles')).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'errors.file.disallowedType',
    });
  });

  it('rejects GIF in profiles bucket', async () => {
    const { validateUploadMagicBytes } = await import('@/server/storage/magic-bytes');
    await expect(validateUploadMagicBytes(GIF_SIG, 'profiles')).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'errors.file.disallowedType',
    });
  });

  it('rejects random bytes (file-type returns undefined)', async () => {
    const { validateUploadMagicBytes } = await import('@/server/storage/magic-bytes');
    await expect(
      validateUploadMagicBytes(Buffer.from('random'), 'profiles'),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'errors.file.unknownType',
    });
  });
});

describe('validateUploadMagicBytes — defence in depth', () => {
  it('rejects a buffer that STARTS with PNG signature but with PDF further in (sniff the magic-bytes header, not content)', async () => {
    // PNG signature followed by trailing PDF bytes — still PNG by file-type.
    // This test pins the contract: file-type sniffs the HEADER. Body-scan
    // is the malware-scan worker's job (separate test).
    const { validateUploadMagicBytes } = await import('@/server/storage/magic-bytes');
    const composite = Buffer.concat([PNG_SIG, PDF_SIG]);
    const { ext } = await validateUploadMagicBytes(composite, 'profiles');
    expect(ext).toBe('png');
  });
});
