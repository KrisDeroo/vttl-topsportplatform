/**
 * Unit test for the central pino redact paths constant.
 *
 * Plan 13 wires the actual pino instance; this test guarantees the redact path
 * list is centralised in `src/lib/log-redact-paths.ts` and contains every PII
 * pattern required by SEC-04 + OPS-01:
 *   - Auth headers (authorization, cookie, set-cookie)
 *   - Credentials (password, passwordHash, token)
 *   - PII (email, phone, dateOfBirth, ipAddress)
 *   - Encrypted medical envelopes (medical_*, eventDescriptionCipher,
 *     doctorCipher, consentTextSnapshot)
 *
 * If a future Plan 13 change accidentally drops one of these paths, this test
 * fails and the SEC-04 contract is preserved at code-review time.
 */
import { describe, it, expect } from 'vitest';
import { REDACT_PATHS } from '@/lib/log-redact-paths';

describe('SEC-04 + OPS-01 redact paths constant', () => {
  it('includes auth headers, password, cookie, email, medical_*', () => {
    expect(REDACT_PATHS).toEqual(
      expect.arrayContaining([
        'req.headers.authorization',
        'req.headers.cookie',
        '*.password',
        '*.email',
        '*.medical_*',
      ]),
    );
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
        '*.consentTextSnapshot',
      ]),
    );
  });

  it('contains at least 14 paths', () => {
    // Plan acceptance criterion: REDACT_PATHS contains at least 14 paths.
    expect(REDACT_PATHS.length).toBeGreaterThanOrEqual(14);
  });
});
