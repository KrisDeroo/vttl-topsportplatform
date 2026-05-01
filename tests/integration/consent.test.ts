import { describe, it, expect } from 'vitest';
import { freshDb } from '../helpers/db';
import { recordConsent, getConsentText } from '@/lib/consent'; // RED until Plan 12

describe('consent — GDPR-01, I18N-09, D-04..07', () => {
  it('snapshot per locale: stores exact text + sha256 + policy_version', async () => {
    await using h = await freshDb();
    const text = await getConsentText('operational', '1.0.0', 'nl');
    const row = await recordConsent({
      userId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      category: 'operational',
      version: '1.0.0',
      locale: 'nl',
      textShown: text,
      ipAddress: '127.0.0.1',
      userAgent: 'vitest',
    });
    expect(row.consentTextSnapshot).toBe(text);
    expect(row.consentTextSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(row.policyVersion).toBe('1.0.0');
    expect(row.locale).toBe('nl');
  });

  it('version-bump scenario triggers re-consent', async () => {
    // Plan 12 implements the requireCurrentConsent middleware
  });
});
