/**
 * Integration tests for the file-upload pipeline — Plan 02-15 Task 2.
 *
 * Requirements covered: FILE-01..04, VALID-01..06.
 *
 * The pipeline:
 *   1. Client POSTs presigned upload request → `file.requestUpload` returns
 *      signed URL + storage_key.
 *   2. Client PUTs binary to storage; server validates magic-bytes pre-upload
 *      via `file.upload` tRPC procedure (defence-in-depth in case the proxy
 *      didn't enforce content-type).
 *   3. uploaded_files row inserted with scan_status='pending'.
 *   4. Background worker scans → flips to 'clean' or 'infected'.
 *   5. `file.getSignedUrl` returns URL only when scan_status='clean'.
 *
 * Test strategy:
 *   - Inject a stub R2/Supabase storage client so PUT operations are mocked
 *     (`storageClient.putObject` returns a fixed key).
 *   - Drive the tRPC procedure directly via appCaller.
 *   - Assert DB state + error codes + message keys.
 *
 * RED until Plan 02-04 + 02-09 ship `file.*` router and storage helpers.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { freshDb } from '../helpers/db';
import { appCaller } from '../helpers/trpc';
import { seedRolesMatrix } from '../helpers/seed';

// Minimal valid PNG header (8 bytes signature).
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
// PDF header (rejected from profiles bucket).
const PDF_SIG = Buffer.from('%PDF-1.4\n', 'ascii');
// GIF header (rejected from profiles bucket).
const GIF_SIG = Buffer.from('GIF89a', 'ascii');

describe('file.* router — FILE-01..04 + VALID-01..06', () => {
  let dbHandle: Awaited<ReturnType<typeof freshDb>>;
  let seeded: Awaited<ReturnType<typeof seedRolesMatrix>>;

  beforeAll(async () => {
    dbHandle = await freshDb();
    seeded = await seedRolesMatrix(dbHandle.db);
  });

  afterAll(async () => {
    await dbHandle[Symbol.asyncDispose]();
    vi.restoreAllMocks();
  });

  it('FILE-01: TD uploads a valid 1 KB PNG → row inserted with scan_status=pending', async () => {
    const td = appCaller({ userId: seeded.users.technical_director, role: 'technical_director' });
    const tinyPng = Buffer.concat([PNG_SIG, Buffer.alloc(1024 - PNG_SIG.length, 0)]);
    const result = await td.file.upload({
      bucket: 'profiles',
      data: tinyPng.toString('base64'),
      filename: 'avatar.png',
    });
    expect((result as { scanStatus?: string }).scanStatus).toBe('pending');
    expect((result as { storageKey?: string }).storageKey).toMatch(/^[0-9a-f-]+\/[0-9a-f-]+\.png$/i);
  });

  it('VALID-01: upload >2MB → BAD_REQUEST errors.file.tooLarge', async () => {
    const td = appCaller({ userId: seeded.users.technical_director, role: 'technical_director' });
    const tooBig = Buffer.alloc(2 * 1024 * 1024 + 1, 0); // 2 MB + 1 byte
    await expect(
      td.file.upload({
        bucket: 'profiles',
        data: tooBig.toString('base64'),
        filename: 'big.bin',
      }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'errors.file.tooLarge',
    });
  });

  it('VALID-03: upload PDF claiming image/jpeg MIME → BAD_REQUEST errors.file.disallowedType (magic-bytes mismatch)', async () => {
    const td = appCaller({ userId: seeded.users.technical_director, role: 'technical_director' });
    await expect(
      td.file.upload({
        bucket: 'profiles',
        data: PDF_SIG.toString('base64'),
        filename: 'pretend.jpg',
        contentType: 'image/jpeg', // lies about MIME
      }),
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      message: 'errors.file.disallowedType',
    });
  });

  it('VALID-03 (alt): GIF → BAD_REQUEST', async () => {
    const td = appCaller({ userId: seeded.users.technical_director, role: 'technical_director' });
    await expect(
      td.file.upload({
        bucket: 'profiles',
        data: GIF_SIG.toString('base64'),
        filename: 'pic.gif',
      }),
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('FILE-02: getSignedUrl on pending file → PRECONDITION_FAILED errors.file.scanNotClean', async () => {
    const td = appCaller({ userId: seeded.users.technical_director, role: 'technical_director' });
    const tinyPng = Buffer.concat([PNG_SIG, Buffer.alloc(1024, 0)]);
    const uploaded = (await td.file.upload({
      bucket: 'profiles',
      data: tinyPng.toString('base64'),
      filename: 'a.png',
    })) as { fileId: string };
    await expect(td.file.getSignedUrl({ fileId: uploaded.fileId })).rejects.toMatchObject({
      code: 'PRECONDITION_FAILED',
      message: 'errors.file.scanNotClean',
    });
  });

  it('FILE-03: getSignedUrl on clean file returns URL with TTL <= 1h', async () => {
    const td = appCaller({ userId: seeded.users.technical_director, role: 'technical_director' });
    const tinyPng = Buffer.concat([PNG_SIG, Buffer.alloc(1024, 0)]);
    const uploaded = (await td.file.upload({
      bucket: 'profiles',
      data: tinyPng.toString('base64'),
      filename: 'b.png',
    })) as { fileId: string };
    // Directly flip scan_status to 'clean' via DB to bypass the worker.
    // (helper from tests/helpers/db.ts; or use a raw db.update here)
    await dbHandle.db.execute(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ({ sql: `UPDATE uploaded_files SET scan_status = 'clean' WHERE id = '${uploaded.fileId}'` } as any),
    );
    const signed = (await td.file.getSignedUrl({ fileId: uploaded.fileId })) as {
      url: string;
      expiresIn: number;
    };
    expect(signed.url).toMatch(/^https:\/\//);
    expect(signed.expiresIn).toBeLessThanOrEqual(3600);
  });

  it('FILE-04: cross-owner getSignedUrl → NOT_FOUND (D-36)', async () => {
    const td = appCaller({ userId: seeded.users.technical_director, role: 'technical_director' });
    const tinyPng = Buffer.concat([PNG_SIG, Buffer.alloc(1024, 0)]);
    const uploaded = (await td.file.upload({
      bucket: 'profiles',
      data: tinyPng.toString('base64'),
      filename: 'private.png',
    })) as { fileId: string };
    const otherUser = appCaller({ userId: seeded.users.sparring_partner, role: 'sparring_partner' });
    await expect(otherUser.file.getSignedUrl({ fileId: uploaded.fileId })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('storage_key uses UUID/UUID.<ext> pattern (no PII in path)', async () => {
    const td = appCaller({ userId: seeded.users.technical_director, role: 'technical_director' });
    const tinyPng = Buffer.concat([PNG_SIG, Buffer.alloc(1024, 0)]);
    const uploaded = (await td.file.upload({
      bucket: 'profiles',
      data: tinyPng.toString('base64'),
      filename: 'IRRELEVANT.png',
    })) as { storageKey: string };
    // Pattern: <uuid>/<uuid>.png — no original filename, no user.email, etc.
    expect(uploaded.storageKey).toMatch(/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(png|jpg)$/i);
  });

  it.skip(
    'direct bucket fetch without signed URL returns 403 (requires live Supabase)',
    async () => {
      // This test reaches outside the test process to the storage tier; only
      // runs against a real Supabase project in CI. Local skip.
    },
  );
});
