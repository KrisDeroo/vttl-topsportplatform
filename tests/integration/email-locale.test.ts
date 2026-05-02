/**
 * I18N-04 — transactional email subject is rendered in the recipient's
 * preferred locale (NEVER the sender's).
 *
 * The Resend SDK is mocked at the module boundary (`vi.mock('resend')`) so
 * the test asserts the payload Resend would have received without making any
 * network calls. The mock captures the `subject` field passed to
 * `resend.emails.send(...)` and compares it against the locale-specific
 * literal.
 *
 * Plan 17 originally stubbed global `fetch` and parsed the body via
 * URLSearchParams; the Resend SDK posts JSON, not URL-encoded form data, so
 * URLSearchParams returned null for every key. Plan 06 fixed the assertion
 * mechanism (Rule 1 — bug) while preserving the original contract: the
 * subject literal per locale is what matters.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Reset the Resend client between tests (the implementation lazily caches it).
import {
  __resetResendClientForTest,
  sendEmailLocalized,
} from '@/server/email/send';

/**
 * Capture the most recent payload passed to `resend.emails.send(...)` so each
 * test can inspect the subject + locale without race conditions across the
 * three parametrised cases (vitest runs `it.each` cases serially in a single
 * suite).
 */
const sendCalls: Array<Record<string, unknown>> = [];

vi.mock('resend', () => {
  return {
    Resend: class {
      emails = {
        send: vi.fn(async (payload: Record<string, unknown>) => {
          sendCalls.push(payload);
          return { data: { id: 'mock-id' }, error: null };
        }),
      };
    },
  };
});

describe('email locale — I18N-04', () => {
  beforeEach(() => {
    sendCalls.length = 0;
    __resetResendClientForTest();
  });

  it.each(['nl', 'en', 'fr'] as const)(
    'verify-email subject in %s',
    async (locale) => {
      await sendEmailLocalized({
        to: 'a@b.test',
        locale,
        template: 'verify-email',
        data: { verifyUrl: 'http://x' },
      });

      const expected = {
        nl: 'Bevestig je e-mailadres',
        en: 'Verify your email',
        fr: 'Confirmez votre adresse e-mail',
      };

      expect(sendCalls).toHaveLength(1);
      expect(sendCalls[0]?.subject).toBe(expected[locale]);
    },
  );
});
