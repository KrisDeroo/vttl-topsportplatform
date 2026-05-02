/**
 * Consent ledger contract — GDPR-01, I18N-09, D-04..07 (Plan 12).
 *
 * Plan 11 created this file as a RED stub (importing the throw-stubs from
 * `src/lib/consent.ts`); Plan 12 fills in the real expectations now that
 * `recordConsent` and `getConsentText` are implemented.
 *
 * Surface verified:
 *   - `getConsentText` reads the EXACT bytes of
 *     `public/locales/consent-{category}-{version}.{locale}.html`.
 *   - `recordConsent` stores those bytes in `consent_text_snapshot`,
 *     stamps a 64-char lowercase hex SHA-256, and persists `policy_version`
 *     + `locale` for legal proof.
 *   - The contract holds across all three locales (nl/en/fr), so the
 *     "snapshot per locale" matrix runs the same assertions on each.
 *
 * Why we insert a `users` row first: `consent_records.user_id` has an FK
 * to `users.id` with `ON DELETE RESTRICT`. The `freshDb()` helper
 * truncates with CASCADE, so we re-seed the user per test.
 */
import { describe, expect, it } from 'vitest';

import { CURRENT_POLICY, getConsentText, recordConsent } from '@/lib/consent';
import { users } from '@/server/db/schema/auth';

import { freshDb } from '../helpers/db';

describe('consent — GDPR-01, I18N-09, D-04..07', () => {
  it.each(['nl', 'en', 'fr'] as const)(
    'snapshot per locale: stores exact text + sha256 + policy_version (%s)',
    async (locale) => {
      await using h = await freshDb();
      // Cast through `any` mirrors `src/server/trpc/middleware/audit.ts`:
      // Drizzle 0.45's strict inference treats `defaultNow` columns as
      // required at insert time despite the DB providing the default.
      const [u] = await h.db
        .insert(users)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .values({
          email: `c-${locale}@vttl.test`,
          name: `Consent Tester ${locale}`,
          preferredLocale: locale,
        } as any)
        .returning();
      if (!u) throw new Error('seed user insert returned no row');

      const text = await getConsentText(
        'operational',
        CURRENT_POLICY.operational.version,
        locale,
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const row = await recordConsent({
        userId: u.id,
        category: 'operational',
        version: CURRENT_POLICY.operational.version,
        locale,
        textShown: text,
        ipAddress: '127.0.0.1',
        userAgent: 'vitest',
        db: h.db as any,
      });

      // Snapshot is byte-for-byte identical to what the user would have seen.
      expect(row.consentTextSnapshot).toBe(text);
      // Hash is 64 lowercase hex characters (SHA-256 hex digest contract).
      expect(row.consentTextSha256).toMatch(/^[a-f0-9]{64}$/);
      // policy_version is the literal value from CURRENT_POLICY at the time
      // of consent — a future bump must not change historical rows.
      expect(row.policyVersion).toBe('1.0.0');
      // Locale is persisted for the GDPR "show me the exact text I agreed
      // to in my language" obligation.
      expect(row.locale).toBe(locale);
    },
  );

  it('recomputed sha256 matches stored hash (tamper-evidence drill)', async () => {
    // T-01-08: a row whose snapshot has been edited but whose hash still
    // matches an earlier text can be detected at audit time by re-hashing
    // the snapshot and comparing with the stored hash. This test asserts
    // the contract holds for a freshly written row.
    await using h = await freshDb();
    const [u] = await h.db
      .insert(users)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .values({
        email: 'tamper-evidence@vttl.test',
        name: 'Tamper Evidence',
      } as any)
      .returning();
    if (!u) throw new Error('seed user insert returned no row');

    const text = await getConsentText(
      'operational',
      CURRENT_POLICY.operational.version,
      'nl',
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = await recordConsent({
      userId: u.id,
      category: 'operational',
      version: CURRENT_POLICY.operational.version,
      locale: 'nl',
      textShown: text,
      ipAddress: '127.0.0.1',
      userAgent: 'vitest',
      db: h.db as any,
    });

    const { createHash } = await import('node:crypto');
    const recomputed = createHash('sha256')
      .update(row.consentTextSnapshot, 'utf-8')
      .digest('hex');
    expect(recomputed).toBe(row.consentTextSha256);
  });
});
