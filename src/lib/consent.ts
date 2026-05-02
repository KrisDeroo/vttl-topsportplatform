/**
 * Consent module — RED stub for Plan 12.
 *
 * Plan 11 (this commit) imports ONLY `CURRENT_POLICY` so the
 * `requireCurrentConsent` middleware (src/server/trpc/middleware/requireConsent.ts)
 * can compile and execute. The full implementation — `recordConsent`,
 * `getConsentText`, hash + locale snapshot logic, version bump triggers — is
 * the responsibility of Plan 12 (consent flow + GDPR-01 / I18N-09 contract).
 *
 * Until Plan 12 lands:
 *   - `CURRENT_POLICY` carries the Phase-1 draft policy versions per category.
 *     The middleware uses these strings inside a SQL parameter so it can scan
 *     `consent_records` for an active row at the current version.
 *   - `recordConsent` and `getConsentText` are throw-stubs (T12-RED). Calling
 *     them at runtime crashes the request — this is intentional and tracks the
 *     RED state of `tests/integration/consent.test.ts` (which imports them).
 *
 * Reference: .planning/phases/01-fundament/01-CONTEXT.md §B (D-04..07)
 *            .planning/phases/01-fundament/01-12 will replace this file.
 */

/**
 * Per-category active policy version. Plan 12 will move this constant to a
 * locale-aware structure (text catalogs per nl/en/fr per category) and add a
 * version-bump trigger that forces re-consent. For Phase 1 we ship draft
 * versions and fail the legal-review gate before production (D-04).
 */
export const CURRENT_POLICY = {
  operational: { version: '1.0.0-draft' },
  medical_processing: { version: '1.0.0-draft' },
  photo_video: { version: '1.0.0-draft' },
} as const;

/**
 * RED stub — Plan 12 will implement.
 *
 * Throws on any call so the consent integration test (Plan 12 RED contract)
 * fails loudly until the proper consent ledger writer lands.
 */
export async function recordConsent(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _input: {
    userId: string;
    category: 'operational' | 'medical_processing' | 'photo_video';
    version: string;
    locale: 'nl' | 'en' | 'fr';
    textShown: string;
    ipAddress: string;
    userAgent: string;
  },
): Promise<{
  consentTextSnapshot: string;
  consentTextSha256: string;
  policyVersion: string;
  locale: 'nl' | 'en' | 'fr';
}> {
  throw new Error(
    'recordConsent not implemented yet — Plan 12 (consent flow + GDPR-01/I18N-09)',
  );
}

/**
 * RED stub — Plan 12 will implement.
 *
 * Returns the canonical consent text for a category × policy version × locale
 * combination so the UI can show it AND `recordConsent` can snapshot the
 * exact bytes the user agreed to.
 */
export async function getConsentText(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _category: 'operational' | 'medical_processing' | 'photo_video',
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _version: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _locale: 'nl' | 'en' | 'fr',
): Promise<string> {
  throw new Error(
    'getConsentText not implemented yet — Plan 12 (consent flow + GDPR-01/I18N-09)',
  );
}
