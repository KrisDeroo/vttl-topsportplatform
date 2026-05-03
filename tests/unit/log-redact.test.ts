/**
 * Unit test for the central pino redact paths constant.
 *
 * Plan 13 wires the actual pino instance; this test guarantees the redact path
 * list is centralised in `src/lib/log-redact-paths.ts` and contains every PII
 * pattern required by SEC-04 + OPS-01:
 *   - Auth headers (authorization, cookie, set-cookie)
 *   - Credentials (password, passwordHash, token)
 *   - PII (email, phone, dateOfBirth, ipAddress)
 *   - Encrypted medical envelopes (explicit medical_* keys per the WR-06
 *     fix — fast-redact does not support trailing-segment globs;
 *     enumerate every key the schema emits)
 *   - Cipher-suffix columns (eventDescriptionCipher, doctorCipher,
 *     originalFilenameCipher) and the consent snapshot
 *
 * If a future Plan 13 change accidentally drops one of these paths, this test
 * fails and the SEC-04 contract is preserved at code-review time.
 *
 * WR-06 fix (2026-05-01): the prior assertion expected the literal
 * `'*.medical_*'` glob — fast-redact (pino's redact engine) does NOT
 * support partial-segment wildcards in the trailing path component,
 * so that pattern matched a literal property called `medical_*` and
 * let real `medical_diagnosis` / `medical_history` keys flow through
 * unredacted. The constant now enumerates the medical-prefixed fields
 * explicitly; this test asserts a representative subset is present.
 */
import { describe, it, expect } from 'vitest';
import { REDACT_PATHS } from '@/lib/log-redact-paths';

describe('SEC-04 + OPS-01 redact paths constant', () => {
  it('includes auth headers, password, cookie, email', () => {
    expect(REDACT_PATHS).toEqual(
      expect.arrayContaining([
        'req.headers.authorization',
        'req.headers.cookie',
        '*.password',
        '*.email',
      ]),
    );
  });

  it('includes explicit medical_* fields (WR-06 — no trailing glob)', () => {
    expect(REDACT_PATHS).toEqual(
      expect.arrayContaining([
        '*.medical_diagnosis',
        '*.medical_diagnosis_cipher',
        '*.medical_doctor_cipher',
        '*.medical_event_description_cipher',
        '*.medical_history',
      ]),
    );
    // Belt-and-braces — assert the broken trailing-glob is GONE so a
    // regression cannot re-introduce it.
    expect(REDACT_PATHS as readonly string[]).not.toContain('*.medical_*');
  });

  it('includes credential and PII fields', () => {
    expect(REDACT_PATHS).toEqual(
      expect.arrayContaining([
        '*.passwordHash',
        '*.token',
        '*.phone',
        '*.dateOfBirth',
        '*.ipAddress',
      ]),
    );
  });

  it('includes encrypted medical envelopes and consent snapshot', () => {
    expect(REDACT_PATHS).toEqual(
      expect.arrayContaining([
        '*.eventDescriptionCipher',
        '*.doctorCipher',
        '*.originalFilenameCipher',
        '*.consentTextSnapshot',
      ]),
    );
  });

  it('contains at least 14 paths', () => {
    // Plan acceptance criterion: REDACT_PATHS contains at least 14 paths.
    // Post-WR-06 the list is significantly longer (medical_* enumerated).
    expect(REDACT_PATHS.length).toBeGreaterThanOrEqual(14);
  });
});
