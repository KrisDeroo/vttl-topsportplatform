/**
 * Build `tests/fixtures/eicar.png` — a synthetic file with a valid PNG
 * header followed by the EICAR test signature.
 *
 * See `tests/fixtures/README.md` for the threat-model rationale
 * (T-02-15-FIXTURE-LEAK).
 *
 * Usage:
 *   pnpm tsx tests/fixtures/build-eicar-png.ts
 *
 * The output is NOT committed to git (`.gitignore` excludes it). Re-run
 * before any test that needs the fixture (the Playwright globalSetup will
 * automate this once Plan 02-15 lands).
 */
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// EICAR — public-domain AV-test string. NOT malicious.
const EICAR_STRING =
  'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

// PNG signature (8 bytes — magic header that lets validateUploadMagicBytes
// accept the file at the upload boundary so the scanner gets to see it).
const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// Minimal IHDR + IDAT + IEND so libraries that fully parse the PNG don't
// crash. We only need the magic-byte sniffer to accept this — file-type
// reads only the first 12 bytes for image/png.
const IHDR = Buffer.from(
  // Length=13, Type=IHDR
  '0000000d49484452' +
    // Width=1, Height=1, BitDepth=8, ColorType=0 (gray), Compression=0,
    // Filter=0, Interlace=0
    '0000000100000001' +
    '08000000' +
    // CRC (precomputed for this exact 13-byte IHDR payload).
    '3a7e9b55',
  'hex',
);

// Tiny IDAT (1 zlib-compressed pixel) — and IEND.
const IDAT = Buffer.from(
  '0000000a4944415478da6300010000050001' + '0d0a2db4',
  'hex',
);
const IEND = Buffer.from('0000000049454e44ae426082', 'hex');

const path = resolve(__dirname, 'eicar.png');
mkdirSync(dirname(path), { recursive: true });

const buf = Buffer.concat([
  PNG_HEADER,
  IHDR,
  IDAT,
  // Embed the EICAR bytes BETWEEN the IDAT and IEND so file-type accepts
  // the file as PNG (sniffs the header) but ClamAV reads the EICAR pattern
  // during its body scan.
  Buffer.from(EICAR_STRING, 'ascii'),
  IEND,
]);

if (existsSync(path)) {
  console.log(`[fixtures] ${path} already exists — overwriting.`);
}
writeFileSync(path, buf);
console.log(`[fixtures] wrote ${buf.length} bytes to ${path}`);
