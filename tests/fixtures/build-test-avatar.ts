/**
 * Build `tests/fixtures/test-avatar.png` — a deterministic 1x1 PNG used by
 * the photo-upload happy-path e2e spec.
 *
 * Usage:
 *   pnpm tsx tests/fixtures/build-test-avatar.ts
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// Minimal valid 1x1 grey PNG (67 bytes) — precomputed bytes.
const TINY_PNG = Buffer.from(
  '89504e470d0a1a0a' +
    // IHDR (1x1, 8-bit grayscale)
    '0000000d49484452' +
    '0000000100000001' +
    '08000000003a7e9b55' +
    // IDAT (single pixel)
    '0000000a4944415478da630001000005000' +
    '10d0a2db4' +
    // IEND
    '0000000049454e44ae426082',
  'hex',
);

const path = resolve(__dirname, 'test-avatar.png');
mkdirSync(dirname(path), { recursive: true });
writeFileSync(path, TINY_PNG);
console.log(`[fixtures] wrote ${TINY_PNG.length} bytes to ${path}`);
